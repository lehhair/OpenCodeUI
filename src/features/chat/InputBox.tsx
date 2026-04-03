import { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react'
import { useTranslation } from 'react-i18next'
import { AttachmentPreview, type Attachment } from '../attachment'
import {
  MentionMenu,
  detectMentionTrigger,
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
import { useMobileCollapse } from './input/useMobileCollapse'
import { useAttachmentRail } from './input/useAttachmentRail'
import { useInputHistory } from './input/useInputHistory'
import { TEXT_STYLE, detectSlashTrigger, isFileSupported, ensureFileMime, readFileAsDataUrl } from './input/inputUtils'
import { keybindingStore, matchesKeybinding } from '../../store/keybindingStore'
import { useChatViewport } from './chatViewport'
import type { ApiAgent } from '../../api/client'
import type { ModelInfo, FileCapabilities } from '../../api'
import type { Command } from '../../api/command'

// ============================================
// Types
// ============================================

interface HistoryEntry {
  text: string
  attachments: Attachment[]
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
  const dragCounterRef = useRef(0)

  const { presentation, interaction } = useChatViewport()
  const isCompact = presentation.isCompact

  // Refs
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const inputContainerRef = useRef<HTMLDivElement>(null)
  const attachmentRailRef = useRef<HTMLDivElement>(null)
  const mentionMenuRef = useRef<MentionMenuHandle>(null)
  const slashMenuRef = useRef<SlashCommandMenuHandle>(null)
  const prevRevertedTextRef = useRef<string | undefined>(undefined)
  const latestDraftRef = useRef<HistoryEntry>({ text: '', attachments: [] })
  const contentWrapRef = useRef<HTMLDivElement>(null)
  const footerRef = useRef<HTMLDivElement>(null)

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

  // 自动调整 textarea 高度
  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return

    // 只有真正空字符串时才重置高度；保留仅空格/空行时的换行高度
    if (text.length === 0) {
      textarea.style.height = '24px'
      return
    }

    textarea.style.height = 'auto'
    const scrollHeight = textarea.scrollHeight
    // 原生层已处理键盘 resize，window.innerHeight 即可用高度
    const viewportH = window.innerHeight
    // 可用高度 = viewport - header(48px) - toolbar/padding/footer(~100px) - 安全余量
    const maxH = isCompact ? Math.max(80, viewportH - 48 - 100 - 72) : viewportH * 0.35
    textarea.style.height = Math.max(24, Math.min(scrollHeight, maxH)) + 'px'
  }, [text, isCompact])

  // 计算
  const inputDisabled = !!disabled || isSubmitting
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
        return
      }

      // 发送消息（读取 keybinding 配置）
      const sendKey = keybindingStore.getKey('sendMessage')
      if (sendKey && matchesKeybinding(e.nativeEvent, sendKey)) {
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
      // 内部拖拽（FileExplorer）或原生文件拖拽都高亮
      if (
        e.dataTransfer.types.includes('application/opencode-file') ||
        (supportsAnyFile && e.dataTransfer.types.includes('Files'))
      ) {
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
  const insertDraggedFile = useCallback(
    (fileInfo: { type: 'file' | 'folder'; path: string; absolute: string; name: string }) => {
      const relativePath = normalizePath(fileInfo.path)
      const mentionText = `@${relativePath}`
      const cursorPos = textareaRef.current?.selectionStart ?? text.length

      // 在光标位置插入 @mention 文本
      const beforeCursor = text.slice(0, cursorPos)
      const afterCursor = text.slice(cursorPos)
      // 如果光标前不是空格或空文本，插入空格分隔
      const needSpaceBefore = beforeCursor.length > 0 && !beforeCursor.endsWith(' ') && !beforeCursor.endsWith('\n')
      const prefix = needSpaceBefore ? ' ' : ''
      const newText = beforeCursor + prefix + mentionText + ' ' + afterCursor
      const mentionStart = cursorPos + prefix.length

      // 创建附件
      const attachment: Attachment = {
        id: crypto.randomUUID(),
        type: fileInfo.type,
        displayName: fileInfo.name,
        relativePath,
        url: toFileUrl(fileInfo.absolute),
        mime: fileInfo.type === 'file' ? 'text/plain' : undefined,
        textRange: {
          value: mentionText,
          start: mentionStart,
          end: mentionStart + mentionText.length,
        },
      }

      setText(newText)
      setAttachments(prev => [...prev, attachment])

      // 聚焦并移动光标到 @mention 之后
      requestAnimationFrame(() => {
        if (!textareaRef.current) return
        const newCursorPos = mentionStart + mentionText.length + 1
        textareaRef.current.setSelectionRange(newCursorPos, newCursorPos)
        textareaRef.current.focus()
      })
    },
    [text],
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragCounterRef.current = 0
      setIsDragging(false)

      // 来自 FileExplorer 的内部拖拽（自定义 data type）
      const opencodeData = e.dataTransfer.getData('application/opencode-file')
      if (opencodeData) {
        try {
          insertDraggedFile(JSON.parse(opencodeData))
        } catch (err) {
          console.warn('[InputBox] Failed to parse opencode-file drag data:', err)
        }
        return
      }

      // 原生文件拖拽（从操作系统拖入）
      if (supportsAnyFile && e.dataTransfer.files.length > 0) {
        void handleFilesSelected(Array.from(e.dataTransfer.files))
      }
    },
    [supportsAnyFile, handleFilesSelected, insertDraggedFile],
  )

  // 滚动同步（备用，overlay 内部也监听了 scroll）
  const handleScroll = useCallback(() => {
    // overlay 通过 useEffect 自动同步，这里留空
  }, [])

  // ============================================
  // Render
  // ============================================

  // 计算已选择的 items (用于过滤菜单)
  const excludeValues = new Set<string>()
  attachments.forEach(a => {
    if (a.url) excludeValues.add(a.url)
    if (a.agentName) excludeValues.add(a.agentName)
  })

  const bottomDockPadding = isCollapsed
    ? 'calc(var(--safe-area-inset-bottom, 0px) + 12px)'
    : 'var(--safe-area-inset-bottom, 0px)'

  return (
    <div className="w-full">
      <div
        className={`mx-auto max-w-3xl pointer-events-auto transition-[max-width] duration-300 ease-in-out ${isCompact ? 'px-2' : 'px-4'}`}
        style={{ paddingBottom: bottomDockPadding }}
      >
        <div
          ref={contentWrapRef}
          onPointerDown={handleContainerPointerDown}
          className={`relative flex flex-col gap-2 ${isCollapsed ? 'justify-end' : ''}`}
          style={isCollapsed && expandedHeight > 0 ? { minHeight: expandedHeight } : undefined}
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
            />
          )}

          {!isCollapsed && (
            <>
              {/* Wrapper — 菜单在 glass 容器外，避免嵌套 backdrop-filter 导致模糊失效 */}
              <div className="relative z-30">
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
                  onPointerDown={handleContainerPointerDown}
                  onDragEnter={handleDragEnter}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={`glass rounded-2xl relative transition-all focus-within:outline-none shadow-lg ${
                    isDragging
                      ? 'border border-accent-main-100 ring-2 ring-accent-main-100/30'
                      : isStreaming
                        ? 'border border-accent-main-100/50 animate-border-pulse'
                        : 'border border-border-200/60'
                  }`}
                >
                  {/* Drop overlay */}
                  {isDragging && (
                    <div className="absolute inset-0 z-50 rounded-2xl bg-accent-main-100/5 backdrop-blur-[1px] flex items-center justify-center pointer-events-none">
                      <span className="text-sm text-accent-main-100 font-medium">{t('inputBox.dropFilesHere')}</span>
                    </div>
                  )}

                  <div className="relative">
                    <div className="overflow-hidden">
                      {/* Attachments Preview - 显示在输入框上方 */}
                      <div
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
                            maxHeight: isCompact ? 'calc(var(--app-height, 100vh) - 220px)' : '35vh',
                          }}
                          rows={1}
                        />
                      </div>

                      {/* Bottom Bar -> InputToolbar */}
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
            </>
          )}
        </div>

        {/* Footer: 输入框下方固定高度区域，内容垂直水平居中 */}
        {!isCollapsed && (
          <div
            ref={footerRef}
            onPointerDown={handleContainerPointerDown}
            className="h-8 flex items-center justify-center"
          >
            <InputFooter
              paneId={paneId}
              sessionId={sessionId}
              onNewChat={onNewChat}
              inputContainerRef={inputContainerRef}
            />
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================
// Export with memo for performance optimization
// ============================================

export const InputBox = memo(InputBoxComponent)
