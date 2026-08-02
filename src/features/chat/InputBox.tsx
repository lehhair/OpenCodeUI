import { useState, useRef, useEffect, useCallback, useMemo, useSyncExternalStore, useLayoutEffect, memo } from 'react'
import { useTranslation } from 'react-i18next'
import { AttachmentPreview, type Attachment } from '../attachment'
import {
  MentionMenu,
  detectMentionTrigger,
  getFileName,
  normalizePath,
  toFileUrl,
  type MentionMenuHandle,
  type MentionItem,
} from '../mention'
import { SlashCommandMenu, type SlashCommandMenuHandle } from '../slash-command'
import { InputToolbar } from './input/InputToolbar'
import type { ModelSelectorHandle } from './ModelSelector'
import { InputFooter } from './input/InputFooter'
import { FloatingActions, CollapsedCapsule } from './input/InputActions'
import { QueuedMessagesBar } from './input/QueuedMessagesBar'
import { useMobileCollapse } from './input/useMobileCollapse'
import type { QueuedFollowupDraft } from '../../store/followupQueueStore'
import { useAttachmentRail } from './input/useAttachmentRail'
import { useInputHistory } from './input/useInputHistory'
import {
  TEXT_STYLE,
  bytesToDataUrl,
  detectSlashTrigger,
  ensureFileMime,
  getMimeFromPath,
  isFileSupported,
  readFileAsDataUrl,
} from './input/inputUtils'
import { keybindingStore, matchesKeybinding } from '../../store/keybindingStore'
import { themeStore } from '../../store/themeStore'
import { useChatViewport } from './chatViewport'
import type { ApiAgent } from '../../api/client'
import type { ModelInfo, FileCapabilities } from '../../api'
import type { Command } from '../../api/command'
import {
  getDroppedPathsInfo,
  isTauriDropPointInsideElement,
  subscribeTauriDragDrop,
  type DroppedPathInfo,
  type TauriDragDropEvent,
} from '../../lib/tauriDragDrop'
import {
  getInternalDragSnapshot,
  isPointInsideElement as isInternalPointInsideElement,
  subscribeInternalDrag,
  subscribeInternalDrop,
} from '../../lib/internalDragCore'

// ============================================
// Types
// ============================================

interface HistoryEntry {
  text: string
  attachments: Attachment[]
}

interface DraggedFileInfo {
  type: 'file' | 'folder'
  path: string
  absolute: string
  name: string
}

const TEXTAREA_MIN_HEIGHT = 24
const TEXTAREA_VERTICAL_CHROME = 24
const INPUT_TOOLBAR_FALLBACK_HEIGHT = 36
const INPUT_FOOTER_FALLBACK_HEIGHT = 32
const COMPOSER_MIN_HEIGHT = 144
const COMPOSER_DESKTOP_MAX_HEIGHT = 420
const COMPOSER_COMPACT_MAX_HEIGHT = 320

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function getComposerPaneHeight(anchor: HTMLElement | null): number {
  const paneRoot = anchor?.closest<HTMLElement>('[data-chat-pane-root]')
  const paneHeight = paneRoot?.getBoundingClientRect().height
  if (paneHeight && paneHeight > 0) return paneHeight
  return window.innerHeight || 800
}

function getComposerMaxHeight(paneHeight: number, isCompact: boolean): number {
  const ratio = isCompact ? 0.44 : 0.4
  const hardMax = isCompact ? COMPOSER_COMPACT_MAX_HEIGHT : COMPOSER_DESKTOP_MAX_HEIGHT
  const availableMax = Math.max(COMPOSER_MIN_HEIGHT, paneHeight - 96)
  return clamp(Math.floor(paneHeight * ratio), COMPOSER_MIN_HEIGHT, Math.min(hardMax, availableMax))
}

function getMentionPathForDroppedPath(absolutePath: string, rootPath: string): string {
  const normalizedPath = normalizePath(absolutePath)
  const normalizedRoot = normalizePath(rootPath).replace(/\/+$/, '')
  if (!normalizedRoot) return normalizedPath

  const caseInsensitive = /^[a-zA-Z]:/.test(normalizedPath) || /^[a-zA-Z]:/.test(normalizedRoot)
  const comparablePath = caseInsensitive ? normalizedPath.toLowerCase() : normalizedPath
  const comparableRoot = caseInsensitive ? normalizedRoot.toLowerCase() : normalizedRoot

  if (comparablePath === comparableRoot) {
    return getFileName(normalizedPath)
  }

  if (comparablePath.startsWith(`${comparableRoot}/`)) {
    return normalizedPath.slice(normalizedRoot.length + 1)
  }

  return normalizedPath
}

export interface CollapsedDialogInfo {
  label: string
  queueLength: number
  onExpand: () => void
}

export interface InputBoxProps {
  paneId: string
  onSend: (
    text: string,
    attachments: Attachment[],
    options?: { agent?: string; variant?: string },
  ) => Promise<boolean> | boolean
  onAbort?: () => void
  onCommand?: (command: string) => Promise<boolean> | boolean // 斜杠命令回调，接收完整命令字符串如 "/help"
  onNewChat?: () => void // 新建对话回调
  disabled?: boolean
  isStreaming?: boolean
  agents?: ApiAgent[]
  selectedAgent?: string
  onAgentChange?: (agentName: string) => void
  variants?: string[]
  selectedVariant?: string
  onVariantChange?: (variant: string | undefined) => void
  supportsImages?: boolean // 保留向后兼容（deprecated，优先用 fileCapabilities）
  fileCapabilities?: FileCapabilities
  // Model（移动端 InputToolbar 用）
  models?: ModelInfo[]
  selectedModelKey?: string | null
  onModelChange?: (modelKey: string, model: ModelInfo) => void
  modelsLoading?: boolean
  modelSelectorRef?: React.RefObject<ModelSelectorHandle | null>
  rootPath?: string
  sessionId?: string | null
  // Undo/Redo
  revertedText?: string
  revertedAttachments?: Attachment[]
  canRedo?: boolean
  revertSteps?: number
  onRedo?: () => void
  onRedoAll?: () => void
  onClearRevert?: () => void
  // Animation
  registerInputBox?: (element: HTMLElement | null) => void
  isAtBottom?: boolean
  showScrollToBottom?: boolean
  onScrollToBottom?: () => void
  // Collapsed dialog capsules
  collapsedPermission?: CollapsedDialogInfo
  collapsedQuestion?: CollapsedDialogInfo
  // Queued messages — data + callbacks
  queuedItems?: QueuedFollowupDraft[]
  queuedFailedId?: string
  queuedSendingId?: string
  onQueuedRemove?: (id: string) => void
  onQueuedCancelFailed?: (id: string) => void
  onQueuedSendNow?: (id: string) => void
}

// ============================================
// InputBox Component
// ============================================

function InputBoxComponent({
  paneId,
  onSend,
  onAbort,
  onCommand,
  onNewChat,
  disabled,
  isStreaming,
  agents = [],
  selectedAgent,
  onAgentChange,
  variants = [],
  selectedVariant,
  onVariantChange,
  supportsImages = false,
  fileCapabilities: fileCapabilitiesProp,
  models = [],
  selectedModelKey = null,
  onModelChange,
  modelsLoading = false,
  modelSelectorRef,
  rootPath = '',
  sessionId,
  revertedText,
  revertedAttachments,
  canRedo = false,
  revertSteps = 0,
  onRedo,
  onRedoAll,
  onClearRevert,
  registerInputBox,
  isAtBottom = true,
  showScrollToBottom = false,
  onScrollToBottom,
  collapsedPermission,
  collapsedQuestion,
  queuedItems = [],
  queuedFailedId,
  queuedSendingId,
  onQueuedRemove,
  onQueuedCancelFailed,
  onQueuedSendNow,
}: InputBoxProps) {
  const { t } = useTranslation('chat')
  // 合并文件能力：优先用 fileCapabilities，回退到 supportsImages
  const fileCaps: FileCapabilities = useMemo(
    () =>
      fileCapabilitiesProp ?? {
        image: supportsImages,
        pdf: false,
        audio: false,
        video: false,
      },
    [fileCapabilitiesProp, supportsImages],
  )
  const { externalFileDropMode } = useSyncExternalStore(themeStore.subscribe, themeStore.getSnapshot)

  // 是否有任何文件附件能力
  const supportsAnyFile = fileCaps.image || fileCaps.pdf || fileCaps.audio || fileCaps.video

  // 文本状态
  const [text, setText] = useState('')
  // 附件状态（图片、文件、文件夹、agent）
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)

  // @ Mention 状态
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionStartIndex, setMentionStartIndex] = useState(-1)

  // / Slash Command 状态
  const [slashOpen, setSlashOpen] = useState(false)
  const [slashQuery, setSlashQuery] = useState('')
  const [slashStartIndex, setSlashStartIndex] = useState(-1)

  // 拖拽状态
  const [isDragging, setIsDragging] = useState(false)
  const [isInternalFileDragging, setIsInternalFileDragging] = useState(false)
  const dragCounterRef = useRef(0)
  const lastTauriDropAtRef = useRef(0)

  const { presentation, interaction } = useChatViewport()
  const isCompact = presentation.isCompact

  // Refs
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const inputContainerRef = useRef<HTMLDivElement>(null)
  const attachmentRailRef = useRef<HTMLDivElement>(null)
  const attachmentSectionRef = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const mentionMenuRef = useRef<MentionMenuHandle>(null)
  const slashMenuRef = useRef<SlashCommandMenuHandle>(null)
  const prevRevertedTextRef = useRef<string | undefined>(undefined)
  const latestDraftRef = useRef<HistoryEntry>({ text: '', attachments: [] })
  const contentWrapRef = useRef<HTMLDivElement>(null)
  const footerRef = useRef<HTMLDivElement>(null)
  const isComposingRef = useRef(false)
  const compositionEndTimerRef = useRef<number | null>(null)
  const [composerMaxHeight, setComposerMaxHeight] = useState(280)
  const [inputContainerMaxHeight, setInputContainerMaxHeight] = useState(240)
  const [textareaMaxHeight, setTextareaMaxHeight] = useState(180)

  // 附件横向轨道
  const {
    overflowing: attachmentsOverflowing,
    showLeftFade: showAttachmentLeftFade,
    showRightFade: showAttachmentRightFade,
    handleScroll: syncAttachmentRailState,
    handleWheel: handleAttachmentRailWheel,
  } = useAttachmentRail({ attachmentCount: attachments.length, railRef: attachmentRailRef })

  // ============================================
  // 历史消息导航（类终端体验，逻辑在 useInputHistory hook 中）
  // ============================================
  const { handleHistoryKeyDown, handleHistoryChange, resetHistoryIndex } = useInputHistory({ textareaRef })

  // ============================================
  // Mobile Input Dock: 滚动收起/展开（逻辑在 useMobileCollapse hook 中）
  // ============================================
  const hasContent = text.trim().length > 0 || attachments.length > 0
  const { isCollapsed, expandedHeight, handleExpandInput, handleFocus, handleBlur, handleContainerPointerDown } =
    useMobileCollapse({
      enabled: interaction.enableCollapsedInputDock,
      hasContent,
      isAtBottom,
      textareaRef,
      inputContainerRef,
      contentWrapRef,
      footerRef,
      registerInputBox,
      collapsedPermission,
      collapsedQuestion,
    })

  // 处理 revert 恢复
  useEffect(() => {
    latestDraftRef.current = { text, attachments }
  }, [text, attachments])

  useEffect(() => {
    let frameId: number | null = null

    if (revertedText !== undefined) {
      frameId = requestAnimationFrame(() => {
        setText(revertedText)
        setAttachments(revertedAttachments || [])
        // 聚焦并移动光标到末尾
        if (textareaRef.current) {
          textareaRef.current.focus()
          textareaRef.current.setSelectionRange(revertedText.length, revertedText.length)
        }
      })
    } else if (prevRevertedTextRef.current !== undefined && revertedText === undefined && !isSubmitting) {
      frameId = requestAnimationFrame(() => {
        setText('')
        setAttachments([])
      })
    }

    prevRevertedTextRef.current = revertedText

    return () => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId)
      }
    }
  }, [revertedText, revertedAttachments, isSubmitting])

  useEffect(
    () => () => {
      if (compositionEndTimerRef.current !== null) {
        clearTimeout(compositionEndTimerRef.current)
      }
    },
    [],
  )

  const updateComposerHeightBudget = useCallback(() => {
    const paneHeight = getComposerPaneHeight(inputContainerRef.current ?? contentWrapRef.current)
    const nextComposerMaxHeight = getComposerMaxHeight(paneHeight, isCompact)
    const attachmentHeight = attachments.length > 0 ? (attachmentSectionRef.current?.offsetHeight ?? 0) : 0
    const toolbarHeight = toolbarRef.current?.offsetHeight || INPUT_TOOLBAR_FALLBACK_HEIGHT
    const footerHeight = isCollapsed ? 0 : footerRef.current?.offsetHeight || INPUT_FOOTER_FALLBACK_HEIGHT
    const inputContainerChrome = attachmentHeight + toolbarHeight + TEXTAREA_VERTICAL_CHROME
    const nextInputContainerMaxHeight = Math.max(
      TEXTAREA_MIN_HEIGHT + TEXTAREA_VERTICAL_CHROME + toolbarHeight,
      nextComposerMaxHeight - footerHeight,
    )
    const nextTextareaMaxHeight = Math.max(
      TEXTAREA_MIN_HEIGHT,
      nextInputContainerMaxHeight - inputContainerChrome,
    )

    setComposerMaxHeight(prev => (Math.abs(prev - nextComposerMaxHeight) < 1 ? prev : nextComposerMaxHeight))
    setInputContainerMaxHeight(prev =>
      Math.abs(prev - nextInputContainerMaxHeight) < 1 ? prev : nextInputContainerMaxHeight,
    )
    setTextareaMaxHeight(prev => (Math.abs(prev - nextTextareaMaxHeight) < 1 ? prev : nextTextareaMaxHeight))
  }, [attachments.length, isCollapsed, isCompact])

  useLayoutEffect(() => {
    updateComposerHeightBudget()
  }, [updateComposerHeightBudget, text])

  useEffect(() => {
    updateComposerHeightBudget()

    const observed = [
      inputContainerRef.current?.closest<HTMLElement>('[data-chat-pane-root]'),
      inputContainerRef.current,
      attachmentSectionRef.current,
      toolbarRef.current,
      footerRef.current,
    ].filter((element): element is HTMLElement => !!element)

    // 同帧多次 RO/resize 合并为一次高度预算计算，避免布局连环读
    let budgetRaf: number | null = null
    const scheduleBudgetUpdate = () => {
      if (budgetRaf !== null) return
      budgetRaf = requestAnimationFrame(() => {
        budgetRaf = null
        updateComposerHeightBudget()
      })
    }

    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(scheduleBudgetUpdate) : null
    observed.forEach(element => observer?.observe(element))
    window.addEventListener('resize', scheduleBudgetUpdate)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', scheduleBudgetUpdate)
      if (budgetRaf !== null) cancelAnimationFrame(budgetRaf)
    }
  }, [updateComposerHeightBudget])

  // 自动调整 textarea 高度
  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return

    // 只有真正空字符串时才重置高度；保留仅空格/空行时的换行高度
    if (text.length === 0) {
      textarea.style.height = `${TEXTAREA_MIN_HEIGHT}px`
      return
    }

    textarea.style.height = 'auto'
    const scrollHeight = textarea.scrollHeight
    textarea.style.height = Math.max(TEXTAREA_MIN_HEIGHT, Math.min(scrollHeight, textareaMaxHeight)) + 'px'
  }, [text, textareaMaxHeight])

  // 计算
  const inputDisabled = !!disabled
  const canSend = (text.trim().length > 0 || attachments.length > 0) && !inputDisabled

  // ============================================
  // Handlers
  // ============================================

  const resetDraft = useCallback(() => {
    latestDraftRef.current = { text: '', attachments: [] }
    setText('')
    setAttachments([])
    resetHistoryIndex()
  }, [resetHistoryIndex])

  const restoreDraft = useCallback(
    (draft: HistoryEntry) => {
      latestDraftRef.current = draft
      setText(draft.text)
      setAttachments(draft.attachments)
      resetHistoryIndex()

      requestAnimationFrame(() => {
        if (!textareaRef.current) return
        const cursorPos = draft.text.length
        textareaRef.current.focus()
        textareaRef.current.setSelectionRange(cursorPos, cursorPos)
      })
    },
    [resetHistoryIndex],
  )

  const submitCommandOptimistically = useCallback(
    (commandStr: string) => {
      if (!onCommand) return

      const draftSnapshot: HistoryEntry = {
        text,
        attachments: [...attachments],
      }

      resetDraft()
      requestAnimationFrame(() => {
        if (!textareaRef.current) return
        textareaRef.current.focus()
        textareaRef.current.setSelectionRange(0, 0)
      })

      void (async () => {
        let result: boolean | void
        try {
          result = await onCommand(commandStr)
        } catch {
          result = false
        }

        if (result !== false) {
          onClearRevert?.()
          return
        }

        const currentDraft = latestDraftRef.current
        if (currentDraft.text.length === 0 && currentDraft.attachments.length === 0) {
          restoreDraft(draftSnapshot)
        }
      })()
    },
    [attachments, onClearRevert, onCommand, resetDraft, restoreDraft, text],
  )

  const runSubmit = useCallback(
    async (submit: () => Promise<boolean | void> | boolean | void, onSuccess?: () => void, onFailure?: () => void) => {
      if (isSubmitting) return false

      setIsSubmitting(true)
      try {
        const result = await submit()
        if (result === false) {
          onFailure?.()
          return false
        }

        onSuccess?.()
        return true
      } finally {
        setIsSubmitting(false)
      }
    },
    [isSubmitting],
  )

  const handleSend = useCallback(() => {
    if (!canSend || isSubmitting) return

    // 检测 command attachment
    const commandAttachment = attachments.find(a => a.type === 'command')
    if (commandAttachment && commandAttachment.commandName) {
      if (!onCommand) return

      // 提取命令后的参数文本
      const textRange = commandAttachment.textRange
      const afterCommand = textRange ? text.slice(textRange.end).trim() : ''
      const commandStr = `/${commandAttachment.commandName}${afterCommand ? ' ' + afterCommand : ''}`
      submitCommandOptimistically(commandStr)
      return
    }

    // 从 attachments 中找 agent mention
    const agentAttachment = attachments.find(a => a.type === 'agent')
    const mentionedAgent = agentAttachment?.agentName

    void runSubmit(
      () =>
        onSend(text, attachments, {
          agent: mentionedAgent || selectedAgent,
          variant: selectedVariant,
        }),
      () => {
        resetDraft()
        onClearRevert?.()
      },
    )
  }, [
    attachments,
    canSend,
    isSubmitting,
    onCommand,
    onClearRevert,
    onSend,
    resetDraft,
    runSubmit,
    selectedAgent,
    selectedVariant,
    submitCommandOptimistically,
    text,
  ])

  // 更新 @ 查询文本（用于进入/退出文件夹）
  const updateMentionQuery = useCallback(
    (newQuery: string) => {
      if (!textareaRef.current) return

      const beforeAt = text.slice(0, mentionStartIndex)
      const afterQuery = text.slice(mentionStartIndex + 1 + mentionQuery.length)
      const newText = beforeAt + '@' + newQuery + afterQuery

      setText(newText)
      setMentionQuery(newQuery)

      // 移动光标到 @ 查询末尾
      requestAnimationFrame(() => {
        if (!textareaRef.current) return
        const pos = mentionStartIndex + 1 + newQuery.length
        textareaRef.current.setSelectionRange(pos, pos)
        textareaRef.current.focus()
      })
    },
    [text, mentionStartIndex, mentionQuery],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const nativeEvent = e.nativeEvent
      const isImeComposing = isComposingRef.current || nativeEvent.isComposing || nativeEvent.keyCode === 229

      if (isImeComposing && (e.key === 'Enter' || e.key === 'Tab')) return

      // Slash Command 菜单打开时，拦截导航键
      if (slashOpen && slashMenuRef.current) {
        switch (e.key) {
          case 'ArrowUp':
            e.preventDefault()
            slashMenuRef.current.moveUp()
            return
          case 'ArrowDown':
            e.preventDefault()
            slashMenuRef.current.moveDown()
            return
          case 'Enter':
          case 'Tab':
            e.preventDefault()
            slashMenuRef.current.selectCurrent()
            return
          case 'Escape':
            e.preventDefault()
            setSlashOpen(false)
            return
        }
      }

      // Mention 菜单打开时，拦截导航键
      if (mentionOpen && mentionMenuRef.current) {
        switch (e.key) {
          case 'ArrowUp':
            e.preventDefault()
            mentionMenuRef.current.moveUp()
            return
          case 'ArrowDown':
            e.preventDefault()
            mentionMenuRef.current.moveDown()
            return
          case 'ArrowRight': {
            // 进入文件夹
            const selected = mentionMenuRef.current.getSelectedItem()
            if (selected?.type === 'folder') {
              e.preventDefault()
              const basePath = (selected.relativePath || selected.displayName).replace(/\/+$/, '')
              const folderPath = basePath + '/'
              updateMentionQuery(folderPath)
            }
            return
          }
          case 'ArrowLeft': {
            // 返回上一级
            if (mentionQuery.includes('/')) {
              e.preventDefault()
              const parts = mentionQuery.replace(/\/$/, '').split('/')
              // 记住当前目录名，返回后定位到它
              const folderName = parts[parts.length - 1]
              if (folderName) {
                mentionMenuRef.current.setRestoreFolder(folderName)
              }
              parts.pop()
              const parentPath = parts.length > 0 ? parts.join('/') + '/' : ''
              updateMentionQuery(parentPath)
            }
            return
          }
          case 'Enter':
          case 'Tab':
            e.preventDefault()
            mentionMenuRef.current.selectCurrent()
            return
          case 'Escape':
            e.preventDefault()
            setMentionOpen(false)
            return
        }
      }

      // Tab 键：mention 菜单关闭时，不做任何事（阻止跳到工具栏）
      if (e.key === 'Tab') {
        e.preventDefault()
        return
      }

      // 历史消息导航（类终端体验）
      const historyResult = handleHistoryKeyDown(e, text, attachments)
      if (historyResult) {
        setText(historyResult.text)
        setAttachments(historyResult.attachments)
        requestAnimationFrame(() => {
          if (!textareaRef.current) return
          const cursorPos = historyResult.cursor === 'start' ? 0 : historyResult.text.length
          textareaRef.current.focus()
          textareaRef.current.setSelectionRange(cursorPos, cursorPos)
        })
        return
      }

      // 发送消息（读取 keybinding 配置）
      const sendKey = keybindingStore.getKey('sendMessage')
      if (sendKey && !isImeComposing && matchesKeybinding(nativeEvent, sendKey)) {
        e.preventDefault()
        handleSend()
      }
    },
    [mentionOpen, slashOpen, mentionQuery, updateMentionQuery, handleSend, text, attachments, handleHistoryKeyDown],
  )

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newText = e.target.value
      setText(newText)

      // 用户修改了内容，检查是否应退出历史模式
      handleHistoryChange(newText)

      // 同步检测 mention 是否被破坏/删除
      // 比对 attachments 的 textRange：如果文本中对应位置不再匹配，删除该 attachment
      setAttachments(prev => {
        const surviving = prev.filter(a => {
          if (!a.textRange) return true // 图片等无 textRange 的保留
          const { start, end, value } = a.textRange
          const actual = newText.slice(start, end)
          return actual === value
        })
        // 只在数量变化时更新（避免不必要的 re-render）
        return surviving.length === prev.length ? prev : surviving
      })

      // 检测 @ 触发
      const cursorPos = e.target.selectionStart || 0
      const trigger = detectMentionTrigger(newText, cursorPos, '@')

      if (trigger) {
        setMentionQuery(trigger.query)
        setMentionStartIndex(trigger.startIndex)
        setMentionOpen(true)
        setSlashOpen(false) // 关闭斜杠菜单
      } else {
        setMentionOpen(false)

        // 检测 / 触发（只在行首或空白后）
        const slashTrigger = detectSlashTrigger(newText, cursorPos)
        if (slashTrigger) {
          setSlashQuery(slashTrigger.query)
          setSlashStartIndex(slashTrigger.startIndex)
          setSlashOpen(true)
        } else {
          setSlashOpen(false)
        }
      }
    },
    [handleHistoryChange],
  )

  const handleCompositionStart = useCallback(() => {
    if (compositionEndTimerRef.current !== null) {
      clearTimeout(compositionEndTimerRef.current)
      compositionEndTimerRef.current = null
    }
    isComposingRef.current = true
  }, [])

  const handleCompositionEnd = useCallback(() => {
    if (compositionEndTimerRef.current !== null) {
      clearTimeout(compositionEndTimerRef.current)
    }

    compositionEndTimerRef.current = window.setTimeout(() => {
      isComposingRef.current = false
      compositionEndTimerRef.current = null
    }, 0)
  }, [])

  // @ Mention 选择处理
  const handleMentionSelect = useCallback(
    (item: MentionItem & { _enterFolder?: boolean }) => {
      if (!textareaRef.current) return

      // 如果是进入文件夹
      if (item._enterFolder && item.type === 'folder') {
        const basePath = (item.relativePath || item.displayName).replace(/\/+$/, '')
        const folderPath = basePath + '/'
        updateMentionQuery(folderPath)
        return
      }

      // 构建 @ 文本
      const mentionText = item.type === 'agent' ? `@${item.displayName}` : `@${item.relativePath || item.displayName}`

      // 计算新文本
      const beforeAt = text.slice(0, mentionStartIndex)
      const afterQuery = text.slice(mentionStartIndex + 1 + mentionQuery.length)
      const newText = beforeAt + mentionText + ' ' + afterQuery

      // 创建附件
      const attachment: Attachment = {
        id: crypto.randomUUID(),
        type: item.type,
        displayName: item.displayName,
        relativePath: item.relativePath,
        url: item.type !== 'agent' ? item.value : undefined,
        mime: item.type !== 'agent' ? 'text/plain' : undefined,
        agentName: item.type === 'agent' ? item.displayName : undefined,
        textRange: {
          value: mentionText,
          start: mentionStartIndex,
          end: mentionStartIndex + mentionText.length,
        },
      }

      setText(newText)
      setAttachments(prev => [...prev, attachment])
      setMentionOpen(false)

      // 移动光标到 mention 后
      requestAnimationFrame(() => {
        if (!textareaRef.current) return
        const newCursorPos = mentionStartIndex + mentionText.length + 1
        textareaRef.current.setSelectionRange(newCursorPos, newCursorPos)
        textareaRef.current.focus()
      })
    },
    [text, mentionStartIndex, mentionQuery, updateMentionQuery],
  )

  const handleMentionClose = useCallback(() => {
    setMentionOpen(false)
    textareaRef.current?.focus()
  }, [])

  // / Slash Command 选择处理 - 类似 @ mention
  const handleSlashSelect = useCallback(
    (command: Command) => {
      if (command.source === 'frontend') {
        if (!onCommand) return

        setSlashOpen(false)
        submitCommandOptimistically(`/${command.name}`)
        requestAnimationFrame(() => textareaRef.current?.focus())
        return
      }

      if (!textareaRef.current) return

      // 构建 /command 文本
      const commandText = `/${command.name}`

      // 计算新文本：替换 /query 为 /command
      const beforeSlash = text.slice(0, slashStartIndex)
      const afterQuery = text.slice(slashStartIndex + 1 + slashQuery.length)
      const newText = beforeSlash + commandText + ' ' + afterQuery

      // 创建 command attachment
      const attachment: Attachment = {
        id: crypto.randomUUID(),
        type: 'command',
        displayName: command.name,
        commandName: command.name,
        textRange: {
          value: commandText,
          start: slashStartIndex,
          end: slashStartIndex + commandText.length,
        },
      }

      setText(newText)
      setAttachments(prev => [...prev, attachment])
      setSlashOpen(false)

      // 移动光标到命令后
      requestAnimationFrame(() => {
        if (!textareaRef.current) return
        const newCursorPos = slashStartIndex + commandText.length + 1
        textareaRef.current.setSelectionRange(newCursorPos, newCursorPos)
        textareaRef.current.focus()
      })
    },
    [text, slashStartIndex, slashQuery, onCommand, submitCommandOptimistically],
  )

  const handleSlashClose = useCallback(() => {
    setSlashOpen(false)
    textareaRef.current?.focus()
  }, [])

  // 通用文件上传 — 根据模型能力判断是否接受
  const handleFilesSelected = useCallback(
    async (files: File[]) => {
      if (files.length === 0 || !supportsAnyFile || isSubmitting) return

      const nextAttachments: Attachment[] = []

      for (const rawFile of files) {
        const file = ensureFileMime(rawFile)

        // 按 MIME 类型检查模型能力
        if (!isFileSupported(file.type, fileCaps)) continue

        try {
          const dataUrl = await readFileAsDataUrl(file)

          nextAttachments.push({
            id: crypto.randomUUID(),
            type: 'file',
            displayName: file.name,
            url: dataUrl,
            mime: file.type,
          })
        } catch (err) {
          console.warn('[InputBox] Failed to process file:', err)
        }
      }

      if (nextAttachments.length > 0) {
        setAttachments(prev => [...prev, ...nextAttachments])
      }
    },
    [supportsAnyFile, fileCaps, isSubmitting],
  )

  // 删除附件
  const handleRemoveAttachment = useCallback(
    (id: string) => {
      if (isSubmitting) return

      const attachment = attachments.find(a => a.id === id)
      if (!attachment) return

      // 如果有 textRange，从文本中删除 @mention
      if (attachment.textRange) {
        const { value } = attachment.textRange
        // 删除 @mention 和后面的空格
        const newText = text.replace(value + ' ', '').replace(value, '')
        setText(newText)
      }

      setAttachments(prev => prev.filter(a => a.id !== id))
    },
    [attachments, isSubmitting, text],
  )

  // 粘贴处理 — 根据模型能力过滤可粘贴的文件类型
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      if (supportsAnyFile) {
        const items = e.clipboardData?.items
        const files: File[] = []

        if (items) {
          for (let i = 0; i < items.length; i++) {
            if (items[i].kind === 'file') {
              const file = items[i].getAsFile()
              if (file && isFileSupported(ensureFileMime(file).type, fileCaps)) files.push(file)
            }
          }
        }

        if (files.length > 0) {
          e.preventDefault()
          void handleFilesSelected(files)
          return
        }
      }

      // 文本粘贴：让 textarea 默认处理（天然支持换行和 undo）
    },
    [supportsAnyFile, fileCaps, handleFilesSelected],
  )

  // 拖拽文件到输入框
  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragCounterRef.current++
      if (supportsAnyFile && e.dataTransfer.types.includes('Files')) {
        setIsDragging(true)
      }
    },
    [supportsAnyFile],
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current--
    if (dragCounterRef.current === 0) {
      setIsDragging(false)
    }
  }, [])

  // 将拖入的文件信息插入为 @mention 附件
  const insertDraggedFiles = useCallback(
    (fileInfos: DraggedFileInfo[]) => {
      if (fileInfos.length === 0) return

      const currentText = textareaRef.current?.value ?? text
      const cursorPos = textareaRef.current?.selectionStart ?? currentText.length
      const beforeCursor = currentText.slice(0, cursorPos)
      const afterCursor = currentText.slice(cursorPos)
      const needSpaceBefore = beforeCursor.length > 0 && !beforeCursor.endsWith(' ') && !beforeCursor.endsWith('\n')
      const prefix = needSpaceBefore ? ' ' : ''
      const mentions = fileInfos.map(fileInfo => {
        const relativePath = normalizePath(fileInfo.path)
        return {
          fileInfo,
          relativePath,
          mentionText: `@${relativePath}`,
        }
      })
      const insertedText = `${prefix}${mentions.map(item => item.mentionText).join(' ')} `
      const newText = beforeCursor + insertedText + afterCursor
      let mentionStart = cursorPos + prefix.length

      const nextAttachments: Attachment[] = mentions.map(({ fileInfo, relativePath, mentionText }) => {
        const start = mentionStart
        mentionStart += mentionText.length + 1

        return {
          id: crypto.randomUUID(),
          type: fileInfo.type,
          displayName: fileInfo.name,
          relativePath,
          url: toFileUrl(fileInfo.absolute),
          mime: fileInfo.type === 'file' ? 'text/plain' : undefined,
          textRange: {
            value: mentionText,
            start,
            end: start + mentionText.length,
          },
        }
      })

      setText(newText)
      setAttachments(prev => [...prev, ...nextAttachments])

      requestAnimationFrame(() => {
        if (!textareaRef.current) return
        const newCursorPos = cursorPos + insertedText.length
        textareaRef.current.setSelectionRange(newCursorPos, newCursorPos)
        textareaRef.current.focus()
      })
    },
    [text],
  )

  const insertDraggedFile = useCallback((fileInfo: DraggedFileInfo) => insertDraggedFiles([fileInfo]), [insertDraggedFiles])

  useEffect(() => {
    const updateInternalFileDragState = () => {
      const active = getInternalDragSnapshot().active
      if (!active || active.payload.kind !== 'file-mention') {
        setIsInternalFileDragging(false)
        return
      }
      setIsInternalFileDragging(isInternalPointInsideElement(active.current, inputContainerRef.current))
    }

    updateInternalFileDragState()
    return subscribeInternalDrag(updateInternalFileDragState)
  }, [])

  useEffect(() => {
    return subscribeInternalDrop(event => {
      if (event.payload.kind !== 'file-mention') return
      if (!isInternalPointInsideElement(event.point, inputContainerRef.current)) return
      insertDraggedFile(event.payload.file)
    })
  }, [insertDraggedFile])

  const buildDraggedFileInfo = useCallback(
    (fileInfo: DroppedPathInfo): DraggedFileInfo => ({
      type: fileInfo.type,
      path: getMentionPathForDroppedPath(fileInfo.path, rootPath),
      absolute: fileInfo.path,
      name: fileInfo.name || getFileName(fileInfo.path),
    }),
    [rootPath],
  )

  const createUploadAttachmentFromDroppedPath = useCallback(
    async (fileInfo: DroppedPathInfo): Promise<Attachment | null> => {
      if (fileInfo.type !== 'file') return null

      const mime = getMimeFromPath(fileInfo.path)
      if (!isFileSupported(mime, fileCaps)) return null

      try {
        const { readFile } = await import('@tauri-apps/plugin-fs')
        const bytes = await readFile(fileInfo.path)
        return {
          id: crypto.randomUUID(),
          type: 'file',
          displayName: fileInfo.name || getFileName(fileInfo.path),
          url: bytesToDataUrl(bytes, mime),
          mime,
        }
      } catch (err) {
        console.warn('[InputBox] Failed to read dropped file for upload:', err)
        return null
      }
    },
    [fileCaps],
  )

  const handleTauriExternalDrop = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0 || isSubmitting) return

      try {
        const droppedPaths = await getDroppedPathsInfo(paths)
        const uploadAttachments: Attachment[] = []
        const mentionFiles: DraggedFileInfo[] = []

        for (const droppedPath of droppedPaths) {
          if (externalFileDropMode === 'mention') {
            mentionFiles.push(buildDraggedFileInfo(droppedPath))
            continue
          }

          const uploadAttachment = await createUploadAttachmentFromDroppedPath(droppedPath)
          if (uploadAttachment) {
            uploadAttachments.push(uploadAttachment)
          } else {
            mentionFiles.push(buildDraggedFileInfo(droppedPath))
          }
        }

        if (uploadAttachments.length > 0) {
          setAttachments(prev => [...prev, ...uploadAttachments])
        }

        insertDraggedFiles(mentionFiles)
      } catch (err) {
        console.warn('[InputBox] Failed to process Tauri dropped paths:', err)
      }
    },
    [buildDraggedFileInfo, createUploadAttachmentFromDroppedPath, externalFileDropMode, insertDraggedFiles, isSubmitting],
  )

  const handleTauriDragDropEvent = useCallback(
    (event: TauriDragDropEvent) => {
      if (event.type === 'leave') {
        dragCounterRef.current = 0
        setIsDragging(false)
        return
      }

      const insideInput = isTauriDropPointInsideElement(event.position, inputContainerRef.current)

      if (event.type === 'enter' || event.type === 'over') {
        setIsDragging(insideInput)
        return
      }

      dragCounterRef.current = 0
      setIsDragging(false)
      if (insideInput) {
        lastTauriDropAtRef.current = Date.now()
        void handleTauriExternalDrop(event.paths)
      }
    },
    [handleTauriExternalDrop],
  )

  useEffect(() => subscribeTauriDragDrop(handleTauriDragDropEvent), [handleTauriDragDropEvent])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragCounterRef.current = 0
      setIsDragging(false)

      // 原生文件拖拽（从操作系统拖入）
      if (e.dataTransfer.files.length > 0) {
        if (Date.now() - lastTauriDropAtRef.current < 750) return
        void handleFilesSelected(Array.from(e.dataTransfer.files))
      }
    },
    [handleFilesSelected],
  )

  // 滚动同步（备用，overlay 内部也监听了 scroll）
  const handleScroll = useCallback(() => {
    // overlay 通过 useEffect 自动同步，这里留空
  }, [])

  // ============================================
  // Render
  // ============================================

  // 计算已选择的 items (用于过滤菜单)
  const excludeValues = useMemo(() => {
    const set = new Set<string>()
    attachments.forEach(a => {
      if (a.url) set.add(a.url)
      if (a.agentName) set.add(a.agentName)
    })
    return set
  }, [attachments])

  // 底部 padding 计算：
  // 核心约束：收起/展开态的总底部缓冲必须相等，否则折叠时 inputBoxHeight 变化
  // → bottomPadding 变化 → virtualizer paddingEnd 变化（virtual-core 不补偿 paddingEnd）
  // → dist 平移 → isCollapsed 翻转回 → 振荡闪烁。
  //
  // 展开态总缓冲 = Footer(h-8=2rem) + padding = 2rem + max(0, env-2rem) = max(2rem, env)
  // 收起态总缓冲 = 0(无 Footer) + padding → padding 必须 = max(2rem, env)
  //
  // - env ≥ 2rem（iPhone home indicator）：收起 = env，胶囊贴 safe-area 顶，无多截
  // - env < 2rem（PC / 部分 Android）：收起 = 2rem，胶囊与展开态 Footer 位置对齐
  //
  // 但 2rem(32px) 对胶囊来说视觉上离底部太远，下方用 translateY 把收起态内容
  // 整体下移补偿——transform 不影响布局高度，inputBoxHeight 不变，不破坏上述约束。
  const bottomDockPadding = isCollapsed
    ? 'max(2rem, var(--safe-area-inset-bottom, 0px))'
    : 'max(0px, calc(var(--safe-area-inset-bottom, 0px) - 2rem))'
  // 收起态视觉下移：把 2rem 撑出的多余缓冲吃掉，只留 0.75rem(12px) 呼吸空间
  const collapsedVisualOffset = isCollapsed
    ? 'translateY(calc(2rem - 0.75rem))'
    : 'none'

  return (
    <div className="w-full">
      <div
        className={`mx-auto max-w-3xl transition-[max-width] duration-300 ease-in-out ${isCompact ? 'px-2' : 'px-4'} ${
          isCollapsed ? 'pointer-events-none' : 'pointer-events-auto'
        }`}
        style={{ paddingBottom: bottomDockPadding }}
      >
        <div
          ref={contentWrapRef}
          onPointerDown={handleContainerPointerDown}
          className={`relative flex flex-col gap-2 ${isCollapsed ? 'justify-end' : ''}`}
          style={
            isCollapsed && expandedHeight > 0
              ? { minHeight: expandedHeight, maxHeight: composerMaxHeight, transform: collapsedVisualOffset }
              : { maxHeight: composerMaxHeight }
          }
        >
          {/* FloatingActions — 
              展开态：absolute 定位在内容区上方，不占文档流，避免显隐变化影响高度导致滚动抖动
              收起态：正常文档流，紧贴胶囊上方
              始终同一 DOM 节点，切换时 FloatingActions 不 remount，避免入场动画闪烁 */}
          <div
            data-floating-actions
            className={
              isCollapsed
                ? 'flex justify-center pb-2'
                : 'absolute bottom-full left-0 right-0 flex justify-center pb-2 pointer-events-none'
            }
          >
            <div className={isCollapsed ? undefined : 'pointer-events-auto'}>
              <FloatingActions
                showScrollToBottom={showScrollToBottom}
                isCollapsed={isCollapsed}
                canRedo={canRedo}
                revertSteps={revertSteps}
                onRedo={onRedo}
                onRedoAll={onRedoAll}
                onScrollToBottom={onScrollToBottom}
                collapsedPermission={collapsedPermission}
                collapsedQuestion={collapsedQuestion}
              />
            </div>
          </div>

          {/* Collapsed Capsule - 移动端收起状态 */}
          {isCollapsed && (
            <CollapsedCapsule
              onExpand={handleExpandInput}
              showScrollToBottom={showScrollToBottom}
              onScrollToBottom={onScrollToBottom}
              queuedCount={queuedItems.length}
            />
          )}

          {/* Wrapper — 菜单在 glass 容器外，避免嵌套 backdrop-filter 导致模糊失效。
              收起态只做视觉隐藏，不能卸载输入区，否则移动端虚拟键盘会随焦点元素销毁而关闭。 */}
          <div
            className={`z-30 transition-[opacity,transform] duration-200 ease-out ${
              isCollapsed
                ? 'pointer-events-none absolute inset-x-0 bottom-0 opacity-0 scale-95'
                : 'relative opacity-100 scale-100'
            }`}
          >
            {/* Queued Messages Bar — 在输入框展开时显示 */}
            {!isCollapsed && queuedItems.length > 0 && (
              <div className="pb-2">
                <QueuedMessagesBar
                  items={queuedItems}
                  failedId={queuedFailedId}
                  sendingId={queuedSendingId}
                  onRemove={onQueuedRemove!}
                  onCancelFailed={onQueuedCancelFailed!}
                  onSendNow={onQueuedSendNow!}
                />
              </div>
            )}

            {/* @ Mention Menu */}
            <MentionMenu
              ref={mentionMenuRef}
              isOpen={mentionOpen}
              query={mentionQuery}
              agents={agents}
              rootPath={rootPath}
              excludeValues={excludeValues}
              onSelect={handleMentionSelect}
              onNavigate={updateMentionQuery}
              onClose={handleMentionClose}
            />

            {/* / Slash Command Menu */}
            <SlashCommandMenu
              ref={slashMenuRef}
              isOpen={slashOpen}
              query={slashQuery}
              rootPath={rootPath}
              onSelect={handleSlashSelect}
              onClose={handleSlashClose}
            />

            {/* Input Container */}
            <div
              ref={inputContainerRef}
              data-input-box
              data-pane-id={paneId}
              onPointerDown={handleContainerPointerDown}
              onDragEnter={handleDragEnter}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`glass rounded-2xl relative overflow-hidden focus-within:outline-none shadow-lg ${
                isDragging || isInternalFileDragging
                  ? 'border border-accent-main-100 ring-2 ring-accent-main-100/30'
                  : isStreaming
                    ? 'border border-accent-main-100/50 animate-border-pulse'
                    : 'border border-border-200/60'
              }`}
              style={{ maxHeight: inputContainerMaxHeight }}
            >
              {/* Drop overlay */}
              {(isDragging || isInternalFileDragging) && (
                <div className="absolute inset-0 z-50 rounded-2xl bg-accent-main-100/5 backdrop-blur-[1px] flex items-center justify-center pointer-events-none">
                  <span className="text-[length:var(--fs-base)] text-accent-main-100 font-medium">{t('inputBox.dropFilesHere')}</span>
                </div>
              )}

              <div className="relative">
                <div className="overflow-hidden">
                  {/* Attachments Preview - 显示在输入框上方 */}
                  <div
                    ref={attachmentSectionRef}
                    className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${
                      attachments.length > 0 ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                    }`}
                  >
                    <div className="overflow-hidden">
                      <div className="px-4 pt-3 pb-1">
                        <div className="relative">
                          <div
                            ref={attachmentRailRef}
                            onScroll={syncAttachmentRailState}
                            onWheel={handleAttachmentRailWheel}
                            className="overflow-x-auto overflow-y-hidden overscroll-x-contain no-scrollbar touch-pan-x"
                            style={{ WebkitOverflowScrolling: 'touch' }}
                          >
                            <AttachmentPreview
                              attachments={attachments}
                              onRemove={handleRemoveAttachment}
                              variant="rail"
                              className={isSubmitting ? 'pr-4 pointer-events-none opacity-70' : 'pr-4'}
                            />
                          </div>

                          {attachmentsOverflowing && showAttachmentLeftFade && (
                            <div className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-bg-000/50 to-transparent" />
                          )}

                          {attachmentsOverflowing && showAttachmentRightFade && (
                            <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-bg-000/50 to-transparent" />
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Text Input - 简单的 textarea，直接显示文本 */}
                  <div className="pt-4 pb-2">
                    <textarea
                      ref={textareaRef}
                      value={text}
                      onChange={handleChange}
                      onKeyDown={handleKeyDown}
                      onCompositionStart={handleCompositionStart}
                      onCompositionEnd={handleCompositionEnd}
                      onPaste={handlePaste}
                      onScroll={handleScroll}
                      onFocus={handleFocus}
                      onBlur={handleBlur}
                      disabled={inputDisabled}
                      placeholder={isCompact ? t('inputBox.replyToAgentMobile') : t('inputBox.replyToAgent')}
                      className={`w-full resize-none focus:outline-none focus:ring-0 bg-transparent text-text-100 placeholder:text-text-400 custom-scrollbar ${isCompact ? 'px-3' : 'px-4'}`}
                      style={{
                        ...TEXT_STYLE,
                        minHeight: '24px',
                        maxHeight: textareaMaxHeight,
                      }}
                      rows={1}
                    />
                  </div>

                  {/* Bottom Bar -> InputToolbar */}
                  <div ref={toolbarRef}>
                    <InputToolbar
                      agents={agents}
                      selectedAgent={selectedAgent}
                      onAgentChange={onAgentChange}
                      variants={variants}
                      selectedVariant={selectedVariant}
                      onVariantChange={onVariantChange}
                      fileCapabilities={fileCaps}
                      onFilesSelected={handleFilesSelected}
                      isStreaming={isStreaming}
                      isSending={isSubmitting}
                      onAbort={onAbort}
                      canSend={canSend || false}
                      onSend={handleSend}
                      models={models}
                      selectedModelKey={selectedModelKey}
                      onModelChange={onModelChange}
                      modelsLoading={modelsLoading}
                      inputContainerRef={inputContainerRef}
                      modelSelectorRef={modelSelectorRef}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer: 常驻 DOM，收起用 hidden。避免 isCollapsed 抖一下时卸载整行（自动放行/免责声明闪烁） */}
        <div
          ref={footerRef}
          onPointerDown={handleContainerPointerDown}
          className={`h-8 flex items-center justify-center ${isCollapsed ? 'hidden' : ''}`}
          aria-hidden={isCollapsed || undefined}
        >
          <InputFooter
            paneId={paneId}
            sessionId={sessionId}
            onNewChat={onNewChat}
            inputContainerRef={inputContainerRef}
          />
        </div>
      </div>
    </div>
  )
}

// ============================================
// Export with memo for performance optimization
// ============================================

export const InputBox = memo(InputBoxComponent)
