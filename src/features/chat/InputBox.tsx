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
import { getCommands } from '../../api/command'
import { InputToolbar } from './input/InputToolbar'
import type { ModelSelectorHandle } from './ModelSelector'
import { InputFooter } from './input/InputFooter'
import { FloatingActions, CollapsedCapsule } from './input/InputActions'
import { useMobileCollapse } from './input/useMobileCollapse'
import { useAndroidImeSafeTextarea } from './input/useAndroidImeSafeTextarea'
import { useAttachmentRail } from './input/useAttachmentRail'
import { useInputHistory } from './input/useInputHistory'
import { promptHistoryStore } from '../../store/promptHistoryStore'
import { useCurrentSessionId, useSessionPromptHistory } from '../../store/messageStoreHooks'
import { usePersistedDraft, draftStorageKey, clearPersistedDraft, readPersistedDraft } from './input/usePersistedDraft'
import {
  TEXT_STYLE,
  MAX_UPLOAD_BYTES,
  bytesToDataUrl,
  detectSlashTrigger,
  ensureFileMime,
  getMimeFromPath,
  readFileAsDataUrl,
  routeAttachment,
} from './input/inputUtils'
import { formatFileSize } from '../../utils/formatUtils'
import {
  canReferenceLocalPath,
  splitDroppedItems,
  uploadFileAsAttachment,
  uploadPathAsAttachment,
  decideNativeFileRoute,
  type NativeFileDecision,
  type UploadFailure,
} from './input/attachmentUpload'
import { createUploadId } from '../../api/file'
import { notificationStore } from '../../store/notificationStore'
import { LOCAL_SERVER_ID, serverStore, subscribeServerStore } from '../../store/serverStore'
import { sessionKeyToServerId } from '../../utils/sessionKey'
import { keybindingStore, matchesKeybinding } from '../../store/keybindingStore'
import { themeStore } from '../../store/themeStore'
import { useChatViewport } from './chatViewport'
import type { ApiAgent } from '../../api/client'
import type { Model, Provider, FileCapabilities } from '../../api'
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

/**
 * 一次待上传的来源。
 *
 * 浏览器/粘贴只能给 `File`；桌面端拖入与选择器给的是**本机绝对路径**——
 * 那条走 Rust 流式上传（不读进渲染进程，也有进度）。
 */
type PendingUpload =
  | {
      kind: 'file'
      file: File
      filename: string
      mime: string
      size: number
      pathOnly: boolean
    }
  | {
      kind: 'path'
      path: string
      filename: string
      mime: string
      size: number
      pathOnly: boolean
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
  onShell?: (command: string) => Promise<boolean> | boolean // `!` shell 命令回调（官方 composer shell mode）
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
  models?: Model[]
  providers?: Provider[]
  selectedModelKey?: string | null
  onModelChange?: (modelKey: string, model: Model) => void
  modelsLoading?: boolean
  modelSelectorRef?: React.RefObject<ModelSelectorHandle | null>
  rootPath?: string
  sessionId?: string | null
  /** pane 绑定的服务器 id（附件上传目标；缺省回落到活动服务器） */
  serverId?: string
  // Undo/Redo
  revertedText?: string
  revertedAttachments?: Attachment[]
  /** 队列编辑回填：nonce 变化时把 text 注入输入框并聚焦（PiUI backToInput） */
  /**
   * 队列编辑草稿（官方 queue.edit 的 stash 同款）：
   * - restoreStash=false：装载编辑草稿。首次装载前自动暂存当前输入，
   *   之后连续装载（换条目编辑）不覆盖暂存
   * - restoreStash=true：恢复暂存内容（取消编辑）
   * - 发送成功时丢弃暂存（发送的内容就是编辑结果，官方 confirmEdit 同款）
   * nonce 变化才触发，允许重复注入同内容
   */
  composerDraft?: {
    content: { text: string; attachments: Attachment[] } | null
    nonce: number
    restoreStash: boolean
  } | null
  /** 阻塞中的后台任务（非空时页脚显示「移到后台」入口） */
  backgroundTasks?: Array<{ label: string }>
  onMoveToBackground?: () => void
  backgroundMoving?: boolean
  /** busy 时的投递方式：steer=插队本轮 / queue=排队下轮（流式期间输入栏可切换） */
  busyDelivery?: 'queue' | 'steer'
  onBusyDeliveryChange?: (delivery: 'queue' | 'steer') => void
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
  collapsedWebsearch?: CollapsedDialogInfo
}

// ============================================
// InputBox Component
// ============================================

function InputBoxComponent({
  paneId,
  onSend,
  onAbort,
  onCommand,
  onShell,
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
  providers,
  selectedModelKey = null,
  onModelChange,
  modelsLoading = false,
  modelSelectorRef,
  rootPath = '',
  sessionId,
  serverId: serverIdProp,
  revertedText,
  revertedAttachments,
  composerDraft,
  busyDelivery,
  onBusyDeliveryChange,
  backgroundTasks,
  onMoveToBackground,
  backgroundMoving,
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
  collapsedWebsearch,
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
  const { externalFileDropMode, queueDeliveryChipVisible } = useSyncExternalStore(themeStore.subscribe, themeStore.getSnapshot)

  // 注意：这里**不再**有「模型无原生文件能力就丢弃文件」的闸门（旧 supportsAnyFile）。
  // 白名单外的文件现在会走服务端上传（Issue #182），能不能内联只影响形态，不影响能否添加。

  // ============================================
  // 附件上传（Issue #182）
  // ============================================

  /** 上传目标：pane 绑定的服务器 + 当前工作目录 */
  const uploadTarget = useMemo(
    () => ({
      serverId: serverIdProp ?? (sessionId ? sessionKeyToServerId(sessionId) : undefined),
      directory: rootPath || undefined,
    }),
    [rootPath, serverIdProp, sessionId],
  )

  /**
   * 服务端是否与客户端同机（需求二）。
   *
   * 同机时**不走上传**：桌面端拖入的文件直接沿用原有的引用方式
   * （原生媒体内联；其余退化成 `@` 引用，服务端自己能读到那个路径）。
   * 浏览器里永远拿不到真实路径，所以同机也照旧上传（issue #182 的主场景）。
   *
   * 依赖生效地址：多地址服务器降级到内网 IP 后不再同机（Issue #183），
   * 所以订阅运行时状态快照让判定跟着地址变化重算，否则会拿旧结论
   * 去引用一个服务端根本读不到的宿主路径。
   */
  const endpointStates = useSyncExternalStore(
    subscribeServerStore,
    () => serverStore.getEndpointStates(),
    () => serverStore.getEndpointStates(),
  )
  const serverIsLocal = useMemo(
    // 判定本身只有一处真源（serverStore.isLocalServer 按生效地址判）；
    // endpointStates 作为依赖只为在地址切换后触发重算
    () => serverStore.isLocalServer(uploadTarget.serverId),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 见上：仅作重算触发器
    [uploadTarget.serverId, endpointStates],
  )

  /** 应用自己拉起的服务（`local` 条目）：必然同机，引用时免探测 */
  const pinnedLocalServer = useMemo(
    () => (uploadTarget.serverId ?? serverStore.getActiveServerId()) === LOCAL_SERVER_ID,
    [uploadTarget.serverId],
  )

  /** 在途上传（id → 完成信号）。发送前必须清空，避免把半个附件发出去 */
  const pendingUploadsRef = useRef(new Map<string, Promise<void>>())
  /** 失败后可重试的上传源（id → 源 + 路由结果） */
  const uploadSourcesRef = useRef(new Map<string, PendingUpload>())
  const [uploadingCount, setUploadingCount] = useState(0)

  const notifyAttachmentError = useCallback(
    (title: string, body: string) => {
      notificationStore.push('error', title, body, sessionId ?? '', rootPath || undefined)
    },
    [rootPath, sessionId],
  )

  /** 失败原因文案（拿不到具体原因时回落成服务端/浏览器给的原文） */
  const uploadFailureBody = useCallback(
    (name: string, failure: UploadFailure) =>
      t('attachment.uploadFailed.body', {
        name,
        reason: t(`attachment.uploadFailed.reason.${failure.reason}`, { defaultValue: failure.message }),
      }),
    [t],
  )

  /**
   * 跑一次上传：完成后把占位附件**原地替换**成路径型附件（保持 id，chip 不跳），
   * 失败则标记 failed 并弹出可见错误——issue #182 明确要求不静默吞掉。
   */
  const runAttachmentUpload = useCallback(
    (attachmentId: string, entry: PendingUpload) => {
      const task = (async () => {
        const options = {
          ...uploadTarget,
          pathOnly: entry.pathOnly,
          // 浏览器走 XHR、桌面端走 Rust 命令，两条都能推真实进度；
          // 拿不到进度时回调不触发 → 胶囊保持不确定态转圈
          onProgress: (fraction: number) => {
            setAttachments(prev =>
              prev.map(item => {
                if (item.id !== attachmentId) return item
                // 百分比没变就不换引用，避免每个 progress 事件都触发重渲染
                if (item.progress !== undefined && Math.round(item.progress * 100) === Math.round(fraction * 100)) {
                  return item
                }
                return { ...item, progress: fraction }
              }),
            )
          },
        }

        const { attachment, failure } =
          entry.kind === 'file'
            ? await uploadFileAsAttachment(entry.file, options)
            : await uploadPathAsAttachment(entry.path, entry.filename, entry.mime, options)

        if (attachment) {
          setAttachments(prev =>
            prev.map(item => (item.id === attachmentId ? { ...attachment, id: attachmentId } : item)),
          )
          return
        }

        setAttachments(prev =>
          prev.map(item => (item.id === attachmentId ? { ...item, uploadStatus: 'failed' as const } : item)),
        )
        notifyAttachmentError(
          t('attachment.uploadFailed.title', { name: entry.filename }),
          uploadFailureBody(entry.filename, failure ?? { reason: 'unknown', message: '' }),
        )
      })()

      const settled = task.finally(() => {
        pendingUploadsRef.current.delete(attachmentId)
        setUploadingCount(count => Math.max(0, count - 1))
      })

      pendingUploadsRef.current.set(attachmentId, settled)
      setUploadingCount(count => count + 1)
      void settled
    },
    [notifyAttachmentError, t, uploadFailureBody, uploadTarget],
  )

  /**
   * 插入占位附件并开始上传。
   *
   * 顺序很重要：**先把占位插进 state，再开上传**。上传进度用的是函数式
   * `setAttachments`，React 会按入队顺序应用，因此这里不会出现"进度先到、
   * 占位还没落地 → 进度丢失"的竞态。
   */
  const startAttachmentUpload = useCallback(
    (entry: PendingUpload) => {
      const attachmentId = createUploadId()
      uploadSourcesRef.current.set(attachmentId, entry)

      setAttachments(prev => [
        ...prev,
        {
          id: attachmentId,
          type: 'file',
          displayName: entry.filename,
          mime: entry.mime,
          size: entry.size,
          uploadStatus: 'uploading',
          ...(entry.pathOnly ? { pathOnly: true } : {}),
        },
      ])

      runAttachmentUpload(attachmentId, entry)
    },
    [runAttachmentUpload],
  )

  /** 重试失败的上传（保留同一个 chip 与 id） */
  const retryAttachmentUpload = useCallback(
    (attachmentId: string) => {
      const entry = uploadSourcesRef.current.get(attachmentId)
      if (!entry) return

      setAttachments(prev =>
        prev.map(item => (item.id === attachmentId ? { ...item, uploadStatus: 'uploading' as const } : item)),
      )
      runAttachmentUpload(attachmentId, entry)
    },
    [runAttachmentUpload],
  )

  // 文本状态
  const [text, setText] = useState('')
  // shell mode（官方 composer `!` 模式）：text 即命令本身（不含前导 `!`），
  // 提交走 onShell → session.shell，esc / 空文本退格退出
  const [shellMode, setShellMode] = useState(false)
  // 附件状态（图片、文件、文件夹、agent）
  const [attachments, setAttachments] = useState<Attachment[]>([])

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
  // 数据源：当前会话自己的历史用户输入（在该会话里翻这个会话发过的内容），
  // 新会话/无消息时回退全局持久化 prompt 历史（官方 composer/history 同款）
  // + 当前会话/工作区的持久化草稿（空输入按 ↑ 先召回草稿）
  // ============================================
  const draftKey = useMemo(() => draftStorageKey(sessionId, rootPath), [sessionId, rootPath])
  const draftKeyRef = useRef<string | null>(null)
  draftKeyRef.current = draftKey
  const focusedSessionId = useCurrentSessionId()
  const sessionPromptHistory = useSessionPromptHistory()
  // shell 轨道没有会话内来源（shell 命令是独立消息类型），保持全局轨道
  const historyEntries =
    !shellMode && sessionId && sessionId === focusedSessionId ? sessionPromptHistory : null
  const { handleHistoryKeyDown, handleHistoryChange, resetHistoryIndex } = useInputHistory({
    textareaRef,
    mode: shellMode ? 'shell' : 'normal',
    recallDraft: useCallback(() => readPersistedDraft(draftKeyRef.current), []),
    sessionEntries: historyEntries,
  })

  // 草稿持久化（按会话/工作区作用域，官方 composer persistence 的存储维度；
  // 但不预填：切换会话/工作区清空输入框，草稿按 ↑ 召回，发送成功清空）
  usePersistedDraft({ storageKey: draftKey, text, attachments, setText, setAttachments })

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
      collapsedWebsearch,
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
    } else if (prevRevertedTextRef.current !== undefined && revertedText === undefined) {
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
  }, [revertedText, revertedAttachments])

  // 队列编辑草稿：装载（暂存当前输入）/ 恢复（取消编辑），nonce 为触发键
  const draftStashRef = useRef<{ text: string; attachments: Attachment[] } | null>(null)
  useEffect(() => {
    if (!composerDraft) return
    if (composerDraft.restoreStash) {
      // 恢复暂存（官方 cancelEdit 同款）
      const stash = draftStashRef.current
      draftStashRef.current = null
      setText(stash?.text ?? '')
      setAttachments(stash?.attachments ?? [])
    } else if (composerDraft.content) {
      // 装载编辑草稿：只在未暂存时暂存当前输入（官方 stash 只在首次 edit 时建立）
      draftStashRef.current ??= { text, attachments }
      setText(composerDraft.content.text)
      setAttachments(composerDraft.content.attachments)
    }
    const frameId = requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.focus()
        const end = textareaRef.current.value.length
        textareaRef.current.setSelectionRange(end, end)
      }
    })
    return () => cancelAnimationFrame(frameId)
    // 以 nonce 为触发键，允许重复注入同内容
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composerDraft?.nonce])

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
    const toolbarHeight = toolbarRef.current?.offsetHeight || INPUT_TOOLBAR_FALLBACK_HEIGHT
    const footerHeight = isCollapsed ? 0 : footerRef.current?.offsetHeight || INPUT_FOOTER_FALLBACK_HEIGHT

    // 输入框里除 textarea 之外的固定高度：上方留白 + 间距 + 工具条 + 边框。
    // 用常量估会差几像素，内容到顶时工具条就会被 overflow 裁掉，所以直接按布局位置量。
    const containerEl = inputContainerRef.current
    const textareaEl = textareaRef.current
    const toolbarEl = toolbarRef.current
    let containerChrome = TEXTAREA_MIN_HEIGHT + TEXTAREA_VERTICAL_CHROME + toolbarHeight
    if (containerEl && textareaEl && toolbarEl) {
      const boxRect = containerEl.getBoundingClientRect()
      const textareaRect = textareaEl.getBoundingClientRect()
      const toolbarRect = toolbarEl.getBoundingClientRect()
      const style = getComputedStyle(containerEl)
      const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)
      containerChrome =
        Math.max(0, textareaRect.top - boxRect.top) +
        Math.max(0, toolbarRect.top - textareaRect.bottom) +
        toolbarRect.height +
        border
    }

    const nextInputContainerMaxHeight = Math.max(
      TEXTAREA_MIN_HEIGHT + containerChrome,
      nextComposerMaxHeight - footerHeight,
    )
    const nextTextareaMaxHeight = Math.max(TEXTAREA_MIN_HEIGHT, nextInputContainerMaxHeight - containerChrome)

    setComposerMaxHeight(prev => (Math.abs(prev - nextComposerMaxHeight) < 1 ? prev : nextComposerMaxHeight))
    setInputContainerMaxHeight(prev =>
      Math.abs(prev - nextInputContainerMaxHeight) < 1 ? prev : nextInputContainerMaxHeight,
    )
    setTextareaMaxHeight(prev => (Math.abs(prev - nextTextareaMaxHeight) < 1 ? prev : nextTextareaMaxHeight))
  }, [isCollapsed, isCompact])

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

  // Android WebView 的 IME 兜底：全选删除后重建 textarea 节点
  const clearImeText = useCallback(() => setText(''), [])
  const { imeResetKey } = useAndroidImeSafeTextarea({ textareaRef, onCleared: clearImeText })

  // 自动调整 textarea 高度
  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return

    // 一行的高度必须跟着真实行高走。TEXTAREA_MIN_HEIGHT 是 24，
    // 但字号调大后一行会超过 24，输入第一个字就会把盒子撑高，
    // 看起来像"没换行却变高"。
    const computed = getComputedStyle(textarea)
    const lineHeight = Number.parseFloat(computed.lineHeight)
    const fontSize = Number.parseFloat(computed.fontSize)
    const oneLine = Math.max(
      TEXTAREA_MIN_HEIGHT,
      Math.ceil(
        Number.isFinite(lineHeight) ? lineHeight : Number.isFinite(fontSize) ? fontSize * 1.43 : TEXTAREA_MIN_HEIGHT,
      ),
    )

    textarea.style.minHeight = `${oneLine}px`

    // 只有真正空字符串时才重置高度；保留仅空格/空行时的换行高度
    if (text.length === 0) {
      textarea.style.height = `${oneLine}px`
      return
    }

    textarea.style.height = 'auto'
    const scrollHeight = textarea.scrollHeight
    textarea.style.height = Math.max(oneLine, Math.min(scrollHeight, textareaMaxHeight)) + 'px'
  }, [text, textareaMaxHeight])

  // 计算
  const inputDisabled = !!disabled
  // 有在途上传时不允许发送：附件还没落到服务端，发出去的 prompt 会缺文件
  //（官方 composer 也是等 uploads.pending 清空才提交）
  const hasPendingUploads = uploadingCount > 0
  const canSend = (text.trim().length > 0 || attachments.length > 0) && !inputDisabled && !hasPendingUploads

  // ============================================
  // Handlers
  // ============================================

  const resetDraft = useCallback(() => {
    latestDraftRef.current = { text: '', attachments: [] }
    setText('')
    setAttachments([])
    // 发送成功/命令提交 → 草稿键同步删除（官方草稿随提交清空同款）
    clearPersistedDraft(draftKeyRef.current)
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

  /**
   * 提交即清空、后台发送、失败恢复（官方 composer submit.ts 同款时序：
   * clearSubmission → void sending → failSubmission(restore)）。
   *
   * 之前用 runSubmit 等 POST 落定（switchModel → switchAgent → prompt 三个
   * 串行 RTT）才清输入框，按回车后文本要在框里「粘」几百毫秒——不优雅的
   * 体感来源。现在提交瞬间清空，发送在后台跑；失败时输入框还没被新内容
   * 占用才恢复旧草稿（sendMessageNow 另有失败通知）。
   */
  const submitOptimistically = useCallback(
    (submit: () => Promise<boolean | void> | boolean | void, opts?: { onSuccess?: () => void; onFailure?: () => void }) => {
      const draftSnapshot: HistoryEntry = { text, attachments: [...attachments] }
      resetDraft()
      void (async () => {
        let ok: boolean
        try {
          ok = (await submit()) !== false
        } catch {
          ok = false
        }
        if (ok) {
          opts?.onSuccess?.()
          return
        }
        opts?.onFailure?.()
        const currentDraft = latestDraftRef.current
        if (currentDraft.text.length === 0 && currentDraft.attachments.length === 0) {
          restoreDraft(draftSnapshot)
        }
      })()
    },
    [attachments, resetDraft, restoreDraft, text],
  )

  const handleSend = useCallback(() => {
    if (!canSend) return

    // shell mode：原样提交命令给 session.shell，保持 shell mode（类终端连续输入）
    if (shellMode) {
      const command = text.trim()
      if (!command || !onShell) return
      // shell 轨道历史记账（官方 history.add 同款：发送即记账、失败移除）
      promptHistoryStore.add(command, [], 'shell')
      submitOptimistically(() => onShell(command), {
        onFailure: () => promptHistoryStore.remove(command, [], 'shell'),
      })
      return
    }

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

    // 正常发送（普通消息 / 附件消息）
    const sendCurrent = () => {
      // 从 attachments 中找 agent mention
      const agentAttachment = attachments.find(a => a.type === 'agent')
      const mentionedAgent = agentAttachment?.agentName

      // v2 的 switchAgent 需要 agent **id**（'build'），而界面选择/mention 存的
      // 可能是显示名（'Build'）——服务端不校验、收下后执行直接失败且静默。
      // 发送边界统一把 name 解析回 id。
      const agentRef = mentionedAgent || selectedAgent
      const agentObj = agentRef ? agents.find(a => a.id === agentRef || a.name === agentRef) : undefined

      // normal 轨道历史记账（官方 history.add 同款：发送即记账、失败移除）
      promptHistoryStore.add(text, attachments, 'normal')
      submitOptimistically(
        () =>
          onSend(text, attachments, {
            agent: agentObj?.id ?? agentRef,
            variant: selectedVariant,
          }),
        {
          onSuccess: () => {
            // 队列编辑草稿发送成功 → 丢弃暂存（官方 confirmEdit 同款：
            // 发送的内容就是编辑结果，不再恢复旧输入）
            draftStashRef.current = null
            onClearRevert?.()
          },
          onFailure: () => promptHistoryStore.remove(text, attachments, 'normal'),
        },
      )
    }

    // 纯文本斜杠命令兜底（官方 composer 同款：手敲 /cmd args 不从菜单
    // 选择也按命令路由，而不是当普通消息发出去）。getCommands 有 10s
    // 缓存，未知命令名回退正常发送。
    const trimmedText = text.trim()
    const slashMatch = /^\/([a-z][\w-]*)(?:\s+([\s\S]+))?$/.exec(trimmedText)
    if (slashMatch && onCommand && attachments.length === 0) {
      const name = slashMatch[1].toLowerCase()
      void getCommands(rootPath || undefined)
        .then(known => known.some(c => c.name.toLowerCase() === name))
        .catch(() => false)
        .then(isCommand => {
          if (isCommand) {
            submitCommandOptimistically(trimmedText)
          } else {
            // 不是已知命令 → 按普通消息发送
            sendCurrent()
          }
        })
      return
    }

    sendCurrent()
  }, [
    agents,
    attachments,
    canSend,
    onCommand,
    onClearRevert,
    onSend,
    onShell,
    rootPath,
    selectedAgent,
    selectedVariant,
    shellMode,
    submitCommandOptimistically,
    submitOptimistically,
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

      // shell mode（官方 machine.ts:232 + submit.ts:147）：Enter 直接执行，
      // esc / 空文本退格退回普通模式
      if (shellMode) {
        if (e.key === 'Escape') {
          e.preventDefault()
          setShellMode(false)
          setText('')
          return
        }
        if (e.key === 'Backspace' && text.length === 0) {
          e.preventDefault()
          setShellMode(false)
          // 「其实想输入 !」的退路：删掉 shell 模式，把进入时被消费的 `!` 还回来，
          // 光标放到末尾好继续打（官方只退模式不还原，这里比官方宽容）
          setText('!')
          requestAnimationFrame(() => {
            if (!textareaRef.current) return
            textareaRef.current.focus()
            textareaRef.current.setSelectionRange(1, 1)
          })
          return
        }
        if (e.key === 'Enter' && !e.shiftKey && !isImeComposing) {
          e.preventDefault()
          handleSend()
          return
        }
      }

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
    [mentionOpen, slashOpen, mentionQuery, updateMentionQuery, handleSend, text, attachments, handleHistoryKeyDown, shellMode],
  )

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newText = e.target.value

      // 空输入框敲入 `!` 进入 shell mode（官方 machine.ts:109 同款：`!` 被消费，不进文本）。
      // 额外要求之前是空文本（官方是 value === "!" 就触发）：从 `!x` 删除回 `!`
      // 不该重新进 shell——那是编辑普通文本，不是想跑命令。
      if (!shellMode && newText === '!' && text === '' && onShell) {
        setShellMode(true)
        setText('')
        setMentionOpen(false)
        setSlashOpen(false)
        return
      }

      setText(newText)

      // 移动端 IME 兜底：全选删除时 compositionend 可能不触发（已知的
      // 移动端输入法行为），isComposingRef 会永久卡在 true——之后回车
      // 发送永远被 isImeComposing 拦截。文本被清空说明 composition 已
      // 被中断，强制复位。
      if (isComposingRef.current && newText.length === 0) {
        isComposingRef.current = false
        if (compositionEndTimerRef.current !== null) {
          clearTimeout(compositionEndTimerRef.current)
          compositionEndTimerRef.current = null
        }
      }

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

      // 检测 @ 触发（shell mode 下不做提及/斜杠检测，命令原样发送）
      const cursorPos = e.target.selectionStart || 0
      const trigger = shellMode ? null : detectMentionTrigger(newText, cursorPos, '@')

      if (trigger) {
        setMentionQuery(trigger.query)
        setMentionStartIndex(trigger.startIndex)
        setMentionOpen(true)
        setSlashOpen(false) // 关闭斜杠菜单
      } else {
        setMentionOpen(false)

        // 检测 / 触发（只在行首或空白后；shell mode 跳过）
        const slashTrigger = shellMode ? null : detectSlashTrigger(newText, cursorPos)
        if (slashTrigger) {
          setSlashQuery(slashTrigger.query)
          setSlashStartIndex(slashTrigger.startIndex)
          setSlashOpen(true)
        } else {
          setSlashOpen(false)
        }
      }
    },
    [handleHistoryChange, shellMode, onShell, text],
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

      // 构建 @ 文本（reference 用挂载名，官方 model.ts:159 content 即 `@name`；
      // skill 用技能 id，官方 model.ts:200 content 即 `@skill.id`）
      const mentionText =
        item.type === 'agent' || item.type === 'reference'
          ? `@${item.displayName}`
          : item.type === 'skill'
            ? `@${item.value}`
            : `@${item.relativePath || item.displayName}`

      // 计算新文本
      const beforeAt = text.slice(0, mentionStartIndex)
      const afterQuery = text.slice(mentionStartIndex + 1 + mentionQuery.length)
      const newText = beforeAt + mentionText + ' ' + afterQuery

      // 创建附件（reference 按目录附件插入，值为引用目录的绝对路径——官方 mime 是 application/x-directory）
      // url 必须是合法 file:// URL（服务端 readFileAttachment 用 new URL + protocol==='file:' 校验，
      // 裸绝对路径 `E:/...` 会被解析成 `e:` 协议直接 400——侧边栏拖入走 toFileUrl 所以没事，
      // 这里对齐官方 request.ts:109 的 `file://${encodeFilePath(path)}`）
      const attachType = item.type === 'reference' ? 'folder' : item.type
      const attachment: Attachment = {
        id: crypto.randomUUID(),
        type: attachType,
        displayName: item.displayName,
        relativePath: item.type === 'reference' ? item.value : item.relativePath,
        url: item.type !== 'agent' && item.type !== 'skill' ? toFileUrl(item.value) : undefined,
        mime: item.type === 'reference' ? 'application/x-directory' : item.type !== 'agent' ? 'text/plain' : undefined,
        agentName: item.type === 'agent' ? item.displayName : undefined,
        skillId: item.type === 'skill' ? item.value : undefined,
        // 物理路径引用只写路径（官方 composer 的 path 部件）：`@path` 已在文本里，
        // 进 prompt.files[] 只会让服务端把整份文件读进内存，还撞 20MB 上限。
        ...(attachType === 'file' || attachType === 'folder' ? { pathOnly: true } : {}),
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
        // 带参数直发（/btw 问题）：query 里命令名之后的部分是参数
        //（官方 composer 对 /cmd args 的解析同款）
        const query = slashQuery.trim()
        const args = query.toLowerCase().startsWith(command.name.toLowerCase())
          ? query.slice(command.name.length).trim()
          : ''
        submitCommandOptimistically(`/${command.name}${args ? ' ' + args : ''}`)
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

  // 通用文件分发 — 原生媒体内联；其余（白名单外 / 超限）上传到服务端临时目录
  // 并以路径附件发送（Issue #182）。三路规则见 inputUtils.routeAttachment。
  const handleFilesSelected = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return

      const inlineAttachments: Attachment[] = []

      for (const rawFile of files) {
        const file = ensureFileMime(rawFile)
        const mime = file.type || getMimeFromPath(file.name) || 'application/octet-stream'

        // 浏览器里永远拿不到文件的真实路径（安全边界），所以即使服务端在本机
        // 也只能上传——references 需要 nativePath，这里不传自然落到 upload。
        const route = routeAttachment({ mime, size: file.size, caps: fileCaps, serverIsLocal })

        if (route.kind === 'inline') {
          try {
            const dataUrl = await readFileAsDataUrl(file)

            inlineAttachments.push({
              id: crypto.randomUUID(),
              type: 'file',
              displayName: file.name,
              url: dataUrl,
              mime: file.type,
              size: file.size,
            })
          } catch (err) {
            console.warn('[InputBox] Failed to process file:', err)
            notifyAttachmentError(
              t('attachment.readFailed.title', { name: file.name }),
              t('attachment.readFailed.body'),
            )
          }
          continue
        }

        if (route.kind === 'reject') {
          notifyAttachmentError(
            t('attachment.tooLarge.title', { name: file.name }),
            t('attachment.tooLarge.body', { max: formatFileSize(MAX_UPLOAD_BYTES) }),
          )
          continue
        }

        // 上传：占位与启动都在 startAttachmentUpload 里（保证进度不会先于占位落地）
        startAttachmentUpload({
          kind: 'file',
          file,
          filename: file.name,
          mime,
          size: file.size,
          pathOnly: route.pathOnly,
        })
      }

      if (inlineAttachments.length > 0) {
        setAttachments(prev => [...prev, ...inlineAttachments])
      }
    },
    [fileCaps, notifyAttachmentError, serverIsLocal, startAttachmentUpload, t],
  )

  // 删除附件
  const handleRemoveAttachment = useCallback(
    (id: string) => {
      const attachment = attachments.find(a => a.id === id)
      if (!attachment) return

      // 如果有 textRange，从文本中删除 @mention
      if (attachment.textRange) {
        const { value } = attachment.textRange
        // 删除 @mention 和后面的空格
        const newText = text.replace(value + ' ', '').replace(value, '')
        setText(newText)
      }

      // 失败/在途的上传源不再需要（在途任务完成时会自行丢弃结果）
      uploadSourcesRef.current.delete(id)
      setAttachments(prev => prev.filter(a => a.id !== id))
    },
    [attachments, text],
  )

  // 粘贴处理 — 文件项交给三路分发（白名单外会上传到服务端，不再被丢弃）
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      {
        const items = e.clipboardData?.items
        const files: File[] = []

        if (items) {
          for (let i = 0; i < items.length; i++) {
            if (items[i].kind === 'file') {
              const file = items[i].getAsFile()
              if (file) files.push(file)
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
    [handleFilesSelected],
  )

  // 拖拽文件到输入框
  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragCounterRef.current++
      if (e.dataTransfer.types.includes('Files')) {
        setIsDragging(true)
      }
    },
    [],
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

  /**
   * 将拖入的文件信息插入为 @mention 附件。
   *
   * `pathOnly`：只把路径写进 prompt 文本，不进 `prompt.files[]`。外部拖入的本机
   * 文件走这条（对齐官方 composer 的 `path` 部件）：服务端不必把整份文件读进内存、
   * 也不会撞上 20MB 上限，模型按需用工具读。侧边栏内部拖拽仍传 files[]。
   */
  const insertDraggedFiles = useCallback(
    (fileInfos: DraggedFileInfo[], options: { pathOnly?: boolean } = {}) => {
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
          ...(options.pathOnly ? { pathOnly: true } : {}),
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

  /**
   * 桌面端拖入的**本机文件** → 附件。
   *
   * 桌面端拿到的是本机绝对路径，服务端可能在远端，所以只有「服务端与本机
   * 同机」时才谈得上直引（需求二）。本期一律走：原生媒体且未超限 → 读成
   * data URL 内联；其余 → 上传到服务端临时目录后作路径附件（Issue #182）。
   */
  const createUploadAttachmentFromDroppedPath = useCallback(
    async (fileInfo: DroppedPathInfo): Promise<Attachment | 'skip' | null> => {
      if (fileInfo.type !== 'file') return null

      const name = fileInfo.name || getFileName(fileInfo.path)
      const mime = getMimeFromPath(fileInfo.path)

      const rejectTooLarge = () => {
        notifyAttachmentError(
          t('attachment.tooLarge.title', { name }),
          t('attachment.tooLarge.body', { max: formatFileSize(MAX_UPLOAD_BYTES) }),
        )
        return 'skip' as const
      }

      const inlineAttachment = (bytes: Uint8Array, byteLength: number): Attachment => ({
        id: crypto.randomUUID(),
        type: 'file',
        displayName: name,
        url: bytesToDataUrl(bytes, mime),
        mime,
        size: byteLength,
      })

      try {
        const { readFile, stat } = await import('@tauri-apps/plugin-fs')

        // 先探大小：内联判定与上传上限都要它，也避免把超大文件读进内存
        let size = -1
        try {
          const info = await stat(fileInfo.path)
          size = Number(info.size ?? -1)
        } catch {
          size = -1
        }

        const decideRoute = (byteLength: number) =>
          decideNativeFileRoute({
            mime,
            size: byteLength,
            caps: fileCaps,
            serverIsLocal,
            nativePath: fileInfo.path,
          })

        // 判定 + 确认，只算一次：'mention' 分支还要问服务端「这个路径你读得到吗」，
        // 读不到就不能沿用本机引用（容器转发 / 真远端），改走上传。
        let decided: NativeFileDecision | null = null
        const resolveRoute = async (byteLength: number) => {
          if (!decided) {
            const route = decideRoute(byteLength)
            decided =
              route.kind === 'mention' && !(await canReferenceLocalPath({
                path: fileInfo.path,
                pinnedLocal: pinnedLocalServer,
                directory: uploadTarget.directory,
                serverId: uploadTarget.serverId,
              }))
                ? { kind: 'upload', pathOnly: true }
                : route
          }
          return decided
        }

        if (size >= 0) {
          const route = await resolveRoute(size)
          // 'mention' = 服务端读得到这个本机路径 → 交回调用方退化成 @ 引用（原行为）
          if (route.kind === 'mention') return null
          if (route.kind === 'reject') return rejectTooLarge()
          if (route.kind === 'inline') return inlineAttachment(await readFile(fileInfo.path), size)
        }

        const bytes = await readFile(fileInfo.path)
        size = size >= 0 ? size : bytes.byteLength

        const route = await resolveRoute(size)
        if (route.kind === 'mention') return null
        if (route.kind === 'reject') return rejectTooLarge()
        if (route.kind === 'inline') return inlineAttachment(bytes, size)

        // 上传：不把字节交给渲染进程，直接把本机路径交给 Rust 流式发送
        // （占位 chip 与进度都由 startAttachmentUpload 负责）
        startAttachmentUpload({
          kind: 'path',
          path: fileInfo.path,
          filename: name,
          mime,
          size,
          pathOnly: route.pathOnly,
        })
        return 'skip'
      } catch (err) {
        // 读取失败可能是权限/瞬时问题：退化为 @mention（本机服务端仍可能读到）
        console.warn('[InputBox] Failed to process dropped file:', err)
        return null
      }
    },
    [
      fileCaps,
      notifyAttachmentError,
      pinnedLocalServer,
      serverIsLocal,
      startAttachmentUpload,
      t,
      uploadTarget,
    ],
  )

  /**
   * 桌面端「拿到本机路径」的统一入口：拖入与点回形针选文件共用同一条判定链
   * （原生媒体内联 / 本机实例 `@` 引用 / 远端上传）。
   *
   * `respectMentionMode`：只有拖入响应「拖入文件始终使用 @」设置；选择器是显式
   * 动作，一律按判定链走。
   */
  const addTauriPaths = useCallback(
    async (paths: string[], options: { respectMentionMode: boolean }) => {
      if (paths.length === 0) return

      try {
        const infos = await getDroppedPathsInfo(paths)
        const uploadAttachments: Attachment[] = []
        const mentionFiles: DraggedFileInfo[] = []

        for (const info of infos) {
          if (options.respectMentionMode && externalFileDropMode === 'mention') {
            mentionFiles.push(buildDraggedFileInfo(info))
            continue
          }

          const result = await createUploadAttachmentFromDroppedPath(info)
          if (result === 'skip') {
            // 两种「不用再加东西」的情况：
            // 1) 走上传：占位 chip 已由 startAttachmentUpload 插入，进度也归它管
            // 2) 超限 / 上传失败：已弹过可见提示，不能再退化成 @mention
            //    （服务端在远端时那个本机路径读不到）
            continue
          }
          if (result) {
            uploadAttachments.push(result)
          } else if (info.type === "folder") {
            // 文件夹：不上传。只有服务端真能读到这个路径（本机实例）才退化为 @ 引用；
            // 连远端实例时本机目录对它没有意义，明确拒绝，别塞一个没用的路径引用过去
            const readable = await canReferenceLocalPath({
              path: info.path,
              pinnedLocal: serverIsLocal,
              directory: uploadTarget.directory,
              serverId: uploadTarget.serverId,
            })
            if (readable) {
              mentionFiles.push(buildDraggedFileInfo(info))
            } else {
              notifyAttachmentError(
                t('attachment.folderUnsupported.title'),
                t('attachment.folderUnsupported.body', { names: info.name }),
              )
            }
          } else {
            // 服务端读不到该路径：退化为 @ 引用
            mentionFiles.push(buildDraggedFileInfo(info))
          }
        }

        if (uploadAttachments.length > 0) {
          setAttachments(prev => [...prev, ...uploadAttachments])
        }

        // 外部拖入的本机文件只作路径引用（官方 composer 的 `path` 部件）：
        // 路径已经在 prompt 文本里，再进 files[] 会让服务端把整份文件读进内存，
        // 超过 20MB 还会让整条 prompt 以 AttachmentError 失败。
        insertDraggedFiles(mentionFiles, { pathOnly: true })
      } catch (err) {
        console.warn('[InputBox] Failed to process dropped paths:', err)
      }
    },
    [
      buildDraggedFileInfo,
      createUploadAttachmentFromDroppedPath,
      externalFileDropMode,
      insertDraggedFiles,
      notifyAttachmentError,
      serverIsLocal,
      t,
      uploadTarget,
    ],
  )

  const handleTauriExternalDrop = useCallback(
    (paths: string[]) => addTauriPaths(paths, { respectMentionMode: true }),
    [addTauriPaths],
  )

  /** 桌面端点回形针选中的文件：与拖入同一条链路 */
  const handlePickedPaths = useCallback(
    (paths: string[]) => addTauriPaths(paths, { respectMentionMode: false }),
    [addTauriPaths],
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
      // 先按 entry 分流：文件夹（浏览器里表现为 size 0 的假 File）必须在上传前拦掉，
      // 否则会得到一个空附件，请求还会被浏览器安全策略挡掉（ERR_ACCESS_DENIED）。
      // 注意兜底只给"没有 items 可用"的环境，不能在拣完只剩文件夹时回退到 files
      const dropped = splitDroppedItems(
        Array.from(e.dataTransfer.items ?? []),
        Array.from(e.dataTransfer.files),
      )

      if (dropped.folderNames.length > 0) {
        notifyAttachmentError(
          t('attachment.folderUnsupported.title'),
          t('attachment.folderUnsupported.body', { names: dropped.folderNames.join(', ') }),
        )
      }

      if (dropped.files.length > 0) {
        if (Date.now() - lastTauriDropAtRef.current < 750) return
        void handleFilesSelected(dropped.files)
      }
    },
    [handleFilesSelected, notifyAttachmentError, t],
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
        className={`mx-auto max-w-[min(100%,var(--oc-chat-input-width,48rem))] transition-[max-width] duration-300 ease-in-out ${isCompact ? 'px-2' : 'px-4'} ${
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
                collapsedWebsearch={collapsedWebsearch}
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

          {/* Wrapper — 菜单在 glass 容器外，避免嵌套 backdrop-filter 导致模糊失效。
              收起态只做视觉隐藏，不能卸载输入区，否则移动端虚拟键盘会随焦点元素销毁而关闭。 */}
          <div
            className={`z-30 transition-[opacity,transform] duration-200 ease-out ${
              isCollapsed
                ? 'pointer-events-none absolute inset-x-0 bottom-0 opacity-0 scale-95'
                : 'relative opacity-100 scale-100'
            }`}
          >
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
              data-busy={isStreaming || undefined}
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

              {/* 忙碌时的描边光：模糊光晕层，玻璃外观下才可见 */}
              <span aria-hidden data-glass-beam-bloom />

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
                              onRetry={retryAttachmentUpload}
                              variant="rail"
                              className="pr-4"
                            />
                          </div>

                          {attachmentsOverflowing && showAttachmentLeftFade && (
                            <div className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-bg-000/50 [-webkit-mask-image:linear-gradient(to_right,black,transparent)] [mask-image:linear-gradient(to_right,black,transparent)]" />
                          )}

                          {attachmentsOverflowing && showAttachmentRightFade && (
                            <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-bg-000/50 [-webkit-mask-image:linear-gradient(to_left,black,transparent)] [mask-image:linear-gradient(to_left,black,transparent)]" />
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Text Input - 简单的 textarea，直接显示文本 */}
                  <div className="pt-4 pb-2">
                    {shellMode && (
                      <div className={`mb-1 flex items-center ${isCompact ? 'px-3' : 'px-4'}`}>
                        <span className="px-1.5 py-0.5 rounded bg-bg-200 text-[length:var(--fs-xs)] font-medium text-text-300 font-mono">
                          {t('inputBox.shellMode')}
                        </span>
                      </div>
                    )}
                    <textarea
                      key={imeResetKey}
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
                      data-shell-mode={shellMode ? '' : undefined}
                      placeholder={
                        shellMode
                          ? t('inputBox.shellPlaceholder')
                          : isCompact
                            ? t('inputBox.replyToAgentMobile')
                            : t('inputBox.replyToAgent')
                      }
                      className={`w-full resize-none focus:outline-none focus:ring-0 bg-transparent text-text-100 placeholder:text-text-400 custom-scrollbar ${isCompact ? 'px-3' : 'px-4'} ${shellMode ? 'font-mono' : ''}`}
                      style={{
                        ...TEXT_STYLE,
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
                      onPickedPaths={handlePickedPaths}
                      isStreaming={isStreaming}
                      busyDelivery={busyDelivery}
                      onBusyDeliveryChange={onBusyDeliveryChange}
                      deliveryChipVisible={queueDeliveryChipVisible}
                      onAbort={onAbort}
                      canSend={canSend || false}
                      onSend={handleSend}
                      models={models}
                      providers={providers}
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
            backgroundTasks={backgroundTasks}
            onMoveToBackground={onMoveToBackground}
            backgroundMoving={backgroundMoving}
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
