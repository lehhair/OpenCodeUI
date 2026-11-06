/**
 * ChatPane — The single chat surface primitive.
 *
 * Single-pane and split-pane both render ChatPane. The only difference is displayMode:
 * single mode uses the full header and app viewport, split mode uses PaneHeader and a
 * compact viewport wrapper.
 */

import { memo, useRef, useEffect, useState, useCallback, useMemo, useDeferredValue, useSyncExternalStore, type CSSProperties } from 'react'
import { Trans, useTranslation } from 'react-i18next'

import { ChatArea, Header, InputBox, PermissionDialog, QuestionDialog, type ChatAreaHandle } from '.'
import { BtwDialog } from '../../components/BtwDialog'
import { type ModelSelectorHandle } from './ModelSelector'
import { OutlineIndex } from '../../components/OutlineIndex'
import { PaneHeader } from './PaneHeader'
import { PaneDropOverlay, resolveDropZone, type DropZone, type PaneDropOverlayHandle } from './PaneDropOverlay'
import {
  ChatWidthHandle,
  CHAT_COLUMN_WIDTH_VAR,
  CHAT_INPUT_WIDTH_VAR,
  MIN_CHAT_CONTENT_WIDTH,
  DEFAULT_INPUT_WIDTH,
} from './ChatWidthHandle'
import { useFolderProjectDrop } from './useFolderProjectDrop'
import { FolderProjectDropOverlay } from './FolderProjectDropOverlay'
import { useChatSession, useModels, useModelSelection, useSessionModelRestore } from '../../hooks'
import { useServerStore } from '../../hooks/useServerStore'
import { useCancelHint } from '../../hooks/useCancelHint'
import { makeSessionKey, sessionKeyToServerId, splitSessionKey } from '../../utils/sessionKey'
import { serverStore, subscribeServerStore } from '../../store/serverStore'
import { InlineToolRequestContext, partitionUnclaimedRequests, type InlineToolRequestContextValue } from './InlineToolRequestContext'
import { ChatViewportProvider, canUseSplitPane, useChatViewportMaybe, type ChatViewportValue } from './chatViewport'
import { useChatPageViewModel } from './useChatPageViewModel'
import { findBlockingBackgroundTasks, mergeRunningShells, useRunningShells } from './backgroundTasks'
import { projectQueueEchoes } from './chatAreaVisibility'
import { backgroundSession } from '../../api/client'
import { WebsearchDock } from './WebsearchDock'
import { SessionNavigationContext } from '../../contexts/SessionNavigationContext'
import { useDirectory } from '../../contexts/useDirectory'
import { paneLayoutStore } from '../../store/paneLayoutStore'
import { autoApproveStore } from '../../store/autoApproveStore'
import { messageStore, paneControllerStore, useHiddenModelKeys, childSessionStore } from '../../store'
import { restoreModelSelection } from '../../utils/sessionHelpers'
import { uiErrorHandler } from '../../utils'
import { findModelByKey, getModelKey } from '../../utils/modelUtils'
import { useTheme } from '../../hooks/useTheme'
import type { Attachment } from '../../api'
import type { APIError } from '../../types/api/common'
import { getInternalDragSnapshot, subscribeInternalDrag, subscribeInternalDrop } from '../../lib/internalDragCore'
import { ErrorBoundary } from '../../components/ErrorBoundary'

interface ChatPaneProps {
  paneId: string
  sessionId: string | null
  isFocused: boolean
  paneCount: number
  displayMode: 'single' | 'split'
  isPaneFullscreen?: boolean
  onOpenSidebar?: () => void
  onToggleRightPanel?: () => void
  onOpenSettings?: () => void
  showSidebarButton?: boolean
  onSplitPane?: () => void
  onTogglePaneFullscreen?: () => void
  navigatePaneToSession: (paneId: string, sessionId: string, directory?: string) => void
  navigatePaneHome: (paneId: string) => void
}

// ============================================
// Compact viewport shell for split panes.
// Layout/presentation stay fixed; enableCollapsedInputDock is inherited from the
// app viewport so the desktop "collapse input dock" setting still works in split.
// ============================================
const PANE_VIEWPORT: ChatViewportValue = {
  presentation: {
    surfaceVariant: 'compact',
    isCompact: true,
  },
  interaction: {
    mode: 'pointer',
    touchCapable: false,
    sidebarBehavior: 'overlay',
    rightPanelBehavior: 'overlay',
    bottomPanelBehavior: 'overlay',
    outlineInteraction: 'pointer',
    enableCollapsedInputDock: false,
  },
  layout: {
    viewportWidth: 800,
    viewportHeight: 600,
    surfaceWidth: 800,
    surfaceMinWidth: 380,
    sidebar: {
      railWidth: 0,
      requestedWidth: 0,
      openWidth: 0,
      dockedWidth: 0,
      overlayWidth: 0,
      hardMinWidth: 0,
      preferredMinWidth: 0,
      maxWidth: 0,
      resizeMaxWidth: 0,
    },
    rightPanel: {
      requestedWidth: 0,
      dockedWidth: 0,
      hardMinWidth: 0,
      maxWidth: 0,
      resizeMaxWidth: 0,
    },
    bottomPanel: {
      maxHeight: 0,
    },
  },
  actions: {
    setSidebarRequestedWidth: () => {},
  },
}

let splitSessionNavigationToken = 0

function scheduleSplitSessionNavigation(callback: () => void) {
  const token = ++splitSessionNavigationToken

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (token !== splitSessionNavigationToken) return
      splitSessionNavigationToken = 0
      callback()
    })
  })
}

function cancelPendingSplitSessionNavigation() {
  if (splitSessionNavigationToken !== 0) {
    splitSessionNavigationToken += 1
  }
}

export const ChatPane = memo(function ChatPane({
  paneId,
  sessionId,
  isFocused,
  paneCount,
  displayMode,
  isPaneFullscreen = false,
  onOpenSidebar,
  onToggleRightPanel,
  onOpenSettings,
  showSidebarButton = false,
  onSplitPane,
  onTogglePaneFullscreen,
  navigatePaneToSession,
  navigatePaneHome,
}: ChatPaneProps) {
  const { t } = useTranslation(['chat', 'common'])
  const showCompactShell = displayMode === 'split' && !isPaneFullscreen

  // Read the outer (App-level) viewport BEFORE this component's own Provider shadows it.
  // When fullscreen we pass this through so children keep the real desktop viewport;
  // in normal split mode we use the static PANE_VIEWPORT instead.
  const outerViewport = useChatViewportMaybe()
  const splitPaneEnabled = canUseSplitPane(outerViewport ?? PANE_VIEWPORT)

  // ============================================
  // Refs
  // ============================================
  const chatAreaRef = useRef<ChatAreaHandle>(null)
  const modelSelectorRef = useRef<ModelSelectorHandle>(null)
  const { addDirectory } = useDirectory()

  // 当前 pane 绑定的服务器（sessionId 为复合 key，split 出 serverId；home 状态跟随 active server 实时变化）
  const activeServerId = useSyncExternalStore(
    subscribeServerStore,
    () => serverStore.getActiveServerId(),
    () => serverStore.getActiveServerId(),
  )
  const paneServerId = useMemo(
    () => (sessionId ? sessionKeyToServerId(sessionId) : activeServerId),
    [sessionId, activeServerId],
  )

  // ============================================
  // Models（per-server：模型列表跟随当前 pane 绑定的服务器）
  // ============================================
  const { models, providers, isLoading: modelsLoading, refetch: refetchModels } = useModels(paneServerId)
  const { activeServer, getHealth } = useServerStore()
  const activeServerHealth = activeServer ? getHealth(activeServer.id) : null
  const hiddenModelKeys = useHiddenModelKeys()
  const visibleModels = useMemo(
    () => models.filter(model => !hiddenModelKeys.includes(getModelKey(model))),
    [models, hiddenModelKeys],
  )
  const {
    selectedModelKey,
    selectedVariant,
    currentModel,
    handleModelChange,
    handleVariantChange,
    restoreFromMessage,
  } = useModelSelection({ models: visibleModels, sessionId })

  // ============================================
  // Full Auto Hint
  // ============================================
  const [fullAutoHint, setFullAutoHint] = useState<string | null>(null)
  const fullAutoHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return autoApproveStore.onFullAutoChange((mode, changePaneId) => {
      // 只响应全局变更（changePaneId 为 undefined）或本 pane 的变更
      if (changePaneId && changePaneId !== paneId) return
      if (fullAutoHintTimerRef.current) clearTimeout(fullAutoHintTimerRef.current)
      const label =
        mode === 'global'
          ? t('chat:hints.autoApproveAll')
          : mode === 'session'
            ? t('chat:hints.autoApproveSession')
            : t('chat:hints.autoApproveOffHint')
      setFullAutoHint(label)
      fullAutoHintTimerRef.current = setTimeout(() => setFullAutoHint(null), 2000)
    })
  }, [t, paneId])

  // ============================================
  // Pane-local navigation
  // ============================================
  /** 规范化 session 标识为复合 key：已是复合 key 则原样，原始 id 用 pane 的服务器合成 */
  const normalizeSessionKey = useCallback(
    (sid: string): string => {
      return sid.includes('::') ? sid : makeSessionKey(paneServerId, sid)
    },
    [paneServerId],
  )

  const navigateToSession = useCallback(
    (sid: string, directory?: string) => {
      navigatePaneToSession(paneId, normalizeSessionKey(sid), directory)
    },
    [paneId, navigatePaneToSession, normalizeSessionKey],
  )

  const navigateHome = useCallback(() => {
    navigatePaneHome(paneId)
  }, [paneId, navigatePaneHome])

  // ============================================
  // Visible Message IDs (for outline index)
  // ============================================
  const [visibleMessageIds, setVisibleMessageIds] = useState<string[]>([])
  const visibleMessageIdsRef = useRef<string[]>([])
  const setVisibleMessageIdsStable = useCallback((ids: string[]) => {
    const prev = visibleMessageIdsRef.current
    if (prev.length === ids.length && prev.every((id, i) => id === ids[i])) return
    visibleMessageIdsRef.current = ids
    setVisibleMessageIds(ids)
  }, [])
  const [isAtBottom, setIsAtBottom] = useState(true)

  const handleOutlineScrollToMessage = useCallback((messageId: string) => {
    chatAreaRef.current?.scrollToMessageId(messageId)
  }, [])

  // ============================================
  // Input Box Height
  // ============================================
  const [inputBoxHeight, setInputBoxHeight] = useState(0)
  const inputBoxWrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = inputBoxWrapperRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        setInputBoxHeight(entry.contentRect.height)
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ============================================
  // Chat Session
  // ============================================
  const {
    messages,
    isStreaming, // session busy（statusMap busy/retry || message streaming）
    canUndo,
    canRedo,
    redoSteps,
    revertedContent,
    restoredContent,
    agents,
    selectedAgent,
    setSelectedAgent,
    routeSessionId,
    loadState,
    loadError,
    sessionModel,
    hasMoreHistory,
    retryStatus,
    effectiveDirectory,

    pendingPermissionRequests,
    pendingQuestionRequests,
    pendingWebsearchRequest,
    queuedPrompts,
    queuedCompactions,
    inboxUserPrompts,
    busyDelivery,
    setBusyDelivery,
    composerDraft,
    queueEditing,
    queueMutation,
    handleCancelQueueEdit,
    handleReorderQueuedPrompts,
    handleCancelQueuedPrompt,
    handleSteerQueuedPrompt,
    handleEditQueuedPrompt,
    handleShellCommand,
    handlePermissionReply,
    handleFormReply,
    handleFormCancel,
    isReplying,

    loadMoreHistory,
    handleRedoAll,
    clearRevert,

    registerMessage,
    registerInputBox,

    handleSend,
    handleAbort,
    handleCommand,
    handleUndoWithAnimation,
    handleRedoWithAnimation,
    handleForkMessage,
    handleNewSession,
    handleVisibleMessageIdsChange,
    handlePreviousSession,
    handleNextSession,
    handleCopyLastResponse,
    restoreAgentFromMessage,
  } = useChatSession({
    paneId,
    chatAreaRef,
    currentModel,
    refetchModels,
    sessionId,
    navigateToSession,
    navigateHome,
    onBtwRequest: question => {
      setBtwQuestion(question)
      setBtwNonce(Date.now())
      setBtwOpen(true)
    },
  })

  const shouldDeferMessages = displayMode === 'split' && !isStreaming && messages.length > 20

  // /btw 侧问对话框（官方 session/btw 同款）
  const [btwOpen, setBtwOpen] = useState(false)
  const [btwQuestion, setBtwQuestion] = useState<string | undefined>(undefined)
  const [btwNonce, setBtwNonce] = useState<number | undefined>(undefined)

  // ============================================
  // 后台化阻塞任务（v2 session.background，官方 requests/model.ts:90）
  // 最新未完成 assistant 回合里有 running 的 shell/task 工具 → 允许转后台；
  // 并入服务端 running shells（官方 background.ts:100-109 同款）
  // ============================================
  const runningShells = useRunningShells(routeSessionId, isStreaming, effectiveDirectory, paneServerId)

  // 当前回合开始的时间点：这之前启动、还挂在后台的 shell 属于上一回合，
  // 不能算作阻塞当前回合、也不该继续提示「移到后台」。
  const currentTurnStartedAt = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i]
      if (message.type === 'user' && typeof message.time?.created === 'number') return message.time.created
    }
    return undefined
  }, [messages])

  // 刚被移到后台的任务：服务端 shell 仍是 running，本地先摘掉，避免入口一直挂着。
  const [movedBackgroundKeys, setMovedBackgroundKeys] = useState<ReadonlySet<string>>(() => new Set())
  useEffect(() => {
    setMovedBackgroundKeys(new Set())
  }, [routeSessionId, currentTurnStartedAt])

  const blockingBackgroundTasks = useMemo(() => {
    if (!isStreaming || !routeSessionId) return []
    const { sessionId: rawSessionId } = splitSessionKey(routeSessionId)
    const merged = mergeRunningShells(
      findBlockingBackgroundTasks(messages),
      runningShells,
      rawSessionId ?? routeSessionId,
      { notBefore: currentTurnStartedAt },
    )
    if (movedBackgroundKeys.size === 0) return merged
    return merged.filter(
      task =>
        !movedBackgroundKeys.has(`${task.type}:${task.id}`) && !movedBackgroundKeys.has(`label:${task.label}`),
    )
  }, [isStreaming, routeSessionId, messages, runningShells, currentTurnStartedAt, movedBackgroundKeys])

  const [backgroundMoving, setBackgroundMoving] = useState(false)
  const handleMoveToBackground = useCallback(async () => {
    if (!routeSessionId || backgroundMoving) return
    const snapshot = blockingBackgroundTasks
    setBackgroundMoving(true)
    try {
      await backgroundSession(routeSessionId, paneServerId)
      if (snapshot.length > 0) {
        setMovedBackgroundKeys(prev => {
          const next = new Set(prev)
          for (const task of snapshot) {
            next.add(`${task.type}:${task.id}`)
            next.add(`label:${task.label}`)
          }
          return next
        })
      }
    } catch (e) {
      uiErrorHandler('background session', e)
    } finally {
      setBackgroundMoving(false)
    }
  }, [routeSessionId, paneServerId, backgroundMoving, blockingBackgroundTasks])
  const messageView = useMemo(() => ({ sessionId: routeSessionId, messages }), [routeSessionId, messages])
  // Streaming never consumes the deferred value, so do not feed every token into a
  // second low-priority render lane.
  const deferredMessageView = useDeferredValue(shouldDeferMessages ? messageView : null)
  const renderedMessagesView = shouldDeferMessages && deferredMessageView ? deferredMessageView : messageView
  const renderedMessages = renderedMessagesView.sessionId === routeSessionId ? renderedMessagesView.messages : []
  const isRenderingDeferredMessages = renderedMessages !== messages
  // 队列回声投影（官方 visibleTimelineMessages 同款）：
  // queue 回声隐藏（由队列气泡呈现），steer 回声挪到转写末尾
  const projectedMessages = useMemo(
    () => projectQueueEchoes(renderedMessages, inboxUserPrompts),
    [renderedMessages, inboxUserPrompts],
  )
  const renderedLoadState = loadState === 'loaded' && isRenderingDeferredMessages ? 'loading' : loadState
  // 对齐 oc：session 消息 ready 后再 mount ChatArea，避免空 virtualizer 先建再跳
  const messagesReady = !routeSessionId || loadState === 'loaded' || loadState === 'error'
  // 已有可显示消息就先挂出来（官方 createTimelineModel 的 ready 同款：
  // 任意一条非 pending 消息即视为可渲染，enrich 之后补）。
  // 缓存命中 / SSE 先到 / 重连刷新时，没必要为了一次元信息回读让整页空白。
  const hasRenderableMessages = renderedMessages.length > 0
  const chatAreaMountKey = messagesReady || hasRenderableMessages ? (routeSessionId ?? 'home') : null
  const inputDisabled = !!routeSessionId && loadState === 'error' && messages.length === 0
  // 切 session remount 时默认视为贴底，避免回底按钮闪一下
  useEffect(() => {
    if (chatAreaMountKey == null) return
    setIsAtBottom(true)
    setVisibleMessageIdsStable([])
  }, [chatAreaMountKey, setVisibleMessageIdsStable])

  const connectionError = useMemo<APIError | undefined>(() => {
    if (!activeServer) {
      return {
        type: 'APIError',
        message: 'No active OpenCode server is selected',
      }
    }

    if (!activeServerHealth || activeServerHealth.status === 'checking' || activeServerHealth.status === 'online') {
      return undefined
    }

    const lines = [
      `Server: ${activeServer.name}`,
      // 用生效地址而不是 activeServer.url：后者只是地址列表第一行的镜像，
      // 降级到备用入口时会把报错指向一个当前根本没在用的地址
      `URL: ${serverStore.getActiveBaseUrl()}`,
      `Status: ${activeServerHealth.status}`,
      activeServerHealth.error ? `Error: ${activeServerHealth.error}` : '',
      activeServerHealth.status === 'error' || activeServerHealth.status === 'offline'
        ? 'Expected /global/health to return OpenCode health JSON.'
        : '',
    ].filter(Boolean)

    const responseBody = [
      lines.join('\n'),
      activeServerHealth.details ? `Raw diagnostics:\n${activeServerHealth.details}` : '',
    ]
      .filter(Boolean)
      .join('\n\n')

    return {
      type: 'APIError',
      message: activeServerHealth.error || `Unable to connect to ${activeServer.name}`,
      status: activeServerHealth.status === 'unauthorized' ? 401 : undefined,
      ...(responseBody ? { response: { body: responseBody } } : {}),
    }
  }, [activeServer, activeServerHealth])

  const navigationCtx = useMemo(
    () => ({ navigateToSession, currentSessionId: routeSessionId, currentDirectory: effectiveDirectory }),
    [navigateToSession, routeSessionId, effectiveDirectory],
  )

  // ============================================
  // Protect session from eviction while this pane is viewing it
  // ============================================
  useEffect(() => {
    if (routeSessionId) {
      messageStore.protectSession(routeSessionId)
    }
    return () => {
      if (routeSessionId) {
        messageStore.unprotectSession(routeSessionId)
      }
    }
  }, [routeSessionId])

  // ============================================
  // Cancel Hint
  // ============================================
  const { showCancelHint, handleCancelMessage } = useCancelHint(isStreaming, handleAbort)

  // ============================================
  // Visible IDs bridge
  // ============================================
  const handleVisibleMessageIdsChangeRef = useRef<((ids: string[]) => void) | null>(null)
  useEffect(() => {
    handleVisibleMessageIdsChangeRef.current = handleVisibleMessageIdsChange
  }, [handleVisibleMessageIdsChange])

  const handleVisibleIdsChange = useCallback(
    (ids: string[]) => {
      handleVisibleMessageIdsChangeRef.current?.(ids)
      setVisibleMessageIdsStable(ids)
    },
    [setVisibleMessageIdsStable],
  )

  // ============================================
  // Agent Change with Model Sync
  // ============================================
  const syncModelForAgent = useCallback(
    (agentRef: string) => {
      // 选择值是 agent id；兼容显示名
      const agent = agents.find(a => a.id === agentRef || a.name === agentRef)
      if (agent?.model) {
        const modelKey = `${agent.model.providerID}:${agent.model.id}`
        const model = findModelByKey(visibleModels, modelKey)
        if (model) {
          handleModelChange(modelKey, model)
        }
      }
    },
    [agents, visibleModels, handleModelChange],
  )

  const handleAgentChange = useCallback(
    (agentName: string) => {
      setSelectedAgent(agentName)
      syncModelForAgent(agentName)
    },
    [setSelectedAgent, syncModelForAgent],
  )

  const handleToggleAgentWithSync = useCallback(() => {
    const primaryAgents = agents.filter(a => a.mode !== 'subagent' && !a.hidden)
    if (primaryAgents.length <= 1) return
    const currentIndex = primaryAgents.findIndex(a => a.id === selectedAgent || a.name === selectedAgent)
    const nextIndex = (currentIndex + 1) % primaryAgents.length
    handleAgentChange(primaryAgents[nextIndex].id)
  }, [agents, selectedAgent, handleAgentChange])

  // ============================================
  // Model Restoration Effect
  // --
  // 只在 session 切换（routeSessionId 变化）或 revert/undo 恢复时执行一次。
  // 流式输出期间 messages 变化不会触发，避免覆盖用户的模型选择。
  // ============================================
  const inputRestoreContent = revertedContent ?? restoredContent

  // revert/undo 恢复：inputRestoreContent 变化时立即恢复
  useEffect(() => {
    if (!inputRestoreContent?.model) return
    const modelSelection = restoreModelSelection(
      inputRestoreContent.model,
      inputRestoreContent.variant ?? null,
      visibleModels,
    )
    if (modelSelection) {
      restoreFromMessage(inputRestoreContent.model, inputRestoreContent.variant)
    }
  }, [inputRestoreContent, visibleModels, restoreFromMessage])

  // session 切换：只在 routeSessionId 变化时，恢复该会话当前的模型。
  // v2 的用户消息**不带** model / agent（那是会话级状态，由
  // session.model.selected / session.agent.selected 维护在 messageStore 上），
  // 因此这里读会话级状态（缺失时用最后一条助手消息的 model 兜底）。
  // 详见 useSessionModelRestore：快照/目录没就绪时不落锁，避免把「还没读到」
  // 当成「这个会话没有模型」而永远恢复不了。
  useSessionModelRestore({
    sessionId: routeSessionId,
    messages,
    loadState,
    sessionModel,
    models: visibleModels,
    restoreFromMessage,
  })

  // ============================================
  // Agent Restoration Effect
  // ============================================
  useEffect(() => {
    if (inputRestoreContent?.agent) {
      restoreAgentFromMessage(inputRestoreContent.agent)
    }
  }, [inputRestoreContent, restoreAgentFromMessage])

  const restoredAgentSessionRef = useRef<string | null>(null)
  useEffect(() => {
    if (!routeSessionId || restoredAgentSessionRef.current === routeSessionId) return
    // 同模型恢复：等会话加载完（空会话以 loadState 为准）
    if (messages.length === 0 && loadState !== 'loaded') return

    restoredAgentSessionRef.current = routeSessionId
    // 同模型恢复：v2 的 agent 也是会话级状态
    restoreAgentFromMessage(messageStore.getSessionState(routeSessionId)?.agent)
    // Streaming only changes message content; agent restoration follows session/load boundaries.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeSessionId, messages.length, loadState, restoreAgentFromMessage])

  // ============================================
  // Focus handling
  // ============================================
  const handlePaneFocus = useCallback(() => {
    paneLayoutStore.focusPane(paneId)
  }, [paneId])

  // ============================================
  // Drag & Drop — receive a session dragged from the sidebar list
  // Center drop → replace current session; edge drops → split in that direction
  //
  // IMPORTANT: zone state lives in PaneDropOverlay (imperative handle). We do
  // NOT put it in ChatPane state — dragover fires every mouse move, and
  // re-rendering ChatPane on each move is very expensive once several panes
  // exist (ChatArea / messages / hooks). rAF also throttles DOM writes to one
  // per frame for smoothness.
  //
  // Zone resolution has two refs on purpose:
  //   - pendingZoneRef: written synchronously by every dragover (most recent)
  //   - currentZoneRef: what the overlay is actually showing (written by rAF)
  // drop() prefers the pending value so it never loses a last-frame move.
  // ============================================
  const overlayRef = useRef<PaneDropOverlayHandle>(null)
  const paneRootRef = useRef<HTMLDivElement>(null)
  // 桌面端：文件夹拖到信息流 → 添加项目（输入框区域让给附件逻辑）
  const isFolderDropActive = useFolderProjectDrop(paneRootRef, addDirectory)
  const currentZoneRef = useRef<DropZone | null>(null)
  const pendingZoneRef = useRef<DropZone | null>(null)
  const dropRafRef = useRef<number | null>(null)

  const writeZone = useCallback((zone: DropZone | null) => {
    if (currentZoneRef.current === zone) return
    currentZoneRef.current = zone
    overlayRef.current?.setZone(zone)
  }, [])

  const cancelPendingZone = useCallback(() => {
    if (dropRafRef.current !== null) {
      cancelAnimationFrame(dropRafRef.current)
      dropRafRef.current = null
    }
    pendingZoneRef.current = null
  }, [])

  const resetDropState = useCallback(() => {
    cancelPendingZone()
    writeZone(null)
  }, [cancelPendingZone, writeZone])

  useEffect(() => {
    return () => {
      if (dropRafRef.current !== null) cancelAnimationFrame(dropRafRef.current)
    }
  }, [])

  const updateSessionDropZoneAt = useCallback(
    (clientX: number, clientY: number) => {
      if (!splitPaneEnabled) return null
      const element = paneRootRef.current
      if (!element) return null
      const rect = element.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return null
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null

      const xRel = (clientX - rect.left) / rect.width
      const yRel = (clientY - rect.top) / rect.height
      const zone = resolveDropZone({ xRel, yRel })
      pendingZoneRef.current = zone

      if (dropRafRef.current === null) {
        dropRafRef.current = requestAnimationFrame(() => {
          dropRafRef.current = null
          writeZone(pendingZoneRef.current)
        })
      }

      return zone
    },
    [splitPaneEnabled, writeZone],
  )

  const clearSessionDropZoneAt = useCallback(
    (clientX: number, clientY: number) => {
      const element = paneRootRef.current
      if (!element) return resetDropState()
      const rect = element.getBoundingClientRect()
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
        resetDropState()
      }
    },
    [resetDropState],
  )

  const handleSessionDrop = useCallback(
    (payload: { sessionId: string; serverId?: string; directory?: string }, zone: DropZone) => {
      resetDropState()
      cancelPendingSplitSessionNavigation()

      // 拖拽 payload 带源服务器：用它合成复合 key（否则会用目标 pane 的服务器，拖错服务器）
      const sessionKey = payload.serverId
        ? makeSessionKey(payload.serverId, payload.sessionId)
        : normalizeSessionKey(payload.sessionId)
      if (sessionKey === routeSessionId && zone === 'center') return

      if (zone === 'center') {
        navigatePaneToSession(paneId, sessionKey, payload.directory)
        return
      }

      const previousFocusedPaneId = paneLayoutStore.getFocusedPaneId()
      const newPaneId = paneLayoutStore.splitPaneToSide(paneId, zone, null)
      if (newPaneId) {
        if (previousFocusedPaneId && paneLayoutStore.findLeaf(previousFocusedPaneId)) {
          paneLayoutStore.focusPane(previousFocusedPaneId)
        }

        scheduleSplitSessionNavigation(() => {
          if (!paneLayoutStore.findLeaf(newPaneId)) return
          navigatePaneToSession(newPaneId, sessionKey, payload.directory)
        })
      }
    },
    [paneId, routeSessionId, navigatePaneToSession, resetDropState, normalizeSessionKey],
  )

  useEffect(() => {
    return subscribeInternalDrag(() => {
      const active = getInternalDragSnapshot().active
      if (!active || active.payload.kind !== 'session') {
        resetDropState()
        return
      }

      const zone = updateSessionDropZoneAt(active.current.x, active.current.y)
      if (!zone) clearSessionDropZoneAt(active.current.x, active.current.y)
    })
  }, [clearSessionDropZoneAt, resetDropState, updateSessionDropZoneAt])

  useEffect(() => {
    return subscribeInternalDrop(event => {
      if (event.payload.kind !== 'session') return
      const zone = updateSessionDropZoneAt(event.point.x, event.point.y)
      if (!zone) {
        resetDropState()
        return
      }

      handleSessionDrop(
        {
          sessionId: event.payload.sessionId,
          serverId: event.payload.serverId,
          directory: event.payload.directory,
        },
        zone,
      )
    })
  }, [handleSessionDrop, resetDropState, updateSessionDropZoneAt])

  const handleToggleFullAuto = useCallback(() => {
    autoApproveStore.cyclePaneFullAutoMode(paneId)
  }, [paneId])

  const openModelSelector = useCallback(() => {
    modelSelectorRef.current?.openMenu()
  }, [])

  const contextLimit = currentModel?.limit?.context

  const controllerActionsRef = useRef({
    newSession: handleNewSession,
    previousSession: handlePreviousSession,
    nextSession: handleNextSession,
    toggleAgent: handleToggleAgentWithSync,
    copyLastResponse: handleCopyLastResponse,
    cancelMessage: handleCancelMessage,
    openModelSelector,
    toggleFullAuto: handleToggleFullAuto,
  })

  useEffect(() => {
    controllerActionsRef.current = {
      newSession: handleNewSession,
      previousSession: handlePreviousSession,
      nextSession: handleNextSession,
      toggleAgent: handleToggleAgentWithSync,
      copyLastResponse: handleCopyLastResponse,
      cancelMessage: handleCancelMessage,
      openModelSelector,
      toggleFullAuto: handleToggleFullAuto,
    }
  }, [
    handleNewSession,
    handlePreviousSession,
    handleNextSession,
    handleToggleAgentWithSync,
    handleCopyLastResponse,
    handleCancelMessage,
    openModelSelector,
    handleToggleFullAuto,
  ])

  const stableControllerActions = useMemo(
    () => ({
      newSession: () => controllerActionsRef.current.newSession(),
      previousSession: () => controllerActionsRef.current.previousSession(),
      nextSession: () => controllerActionsRef.current.nextSession(),
      toggleAgent: () => controllerActionsRef.current.toggleAgent(),
      copyLastResponse: () => controllerActionsRef.current.copyLastResponse(),
      cancelMessage: () => controllerActionsRef.current.cancelMessage(),
      openModelSelector: () => controllerActionsRef.current.openModelSelector(),
      toggleFullAuto: () => controllerActionsRef.current.toggleFullAuto(),
    }),
    [],
  )

  useEffect(() => {
    return () => {
      paneControllerStore.removeController(paneId)
    }
  }, [paneId])

  useEffect(() => {
    paneControllerStore.setController(paneId, {
      paneId,
      sessionId: routeSessionId,
      effectiveDirectory: effectiveDirectory || '',
      contextLimit,
      newSession: stableControllerActions.newSession,
      previousSession: stableControllerActions.previousSession,
      nextSession: stableControllerActions.nextSession,
      toggleAgent: stableControllerActions.toggleAgent,
      copyLastResponse: stableControllerActions.copyLastResponse,
      cancelMessage: stableControllerActions.cancelMessage,
      openModelSelector: stableControllerActions.openModelSelector,
      toggleFullAuto: stableControllerActions.toggleFullAuto,
      isStreaming,
    })
  }, [paneId, routeSessionId, effectiveDirectory, contextLimit, stableControllerActions, isStreaming])

  // ============================================
  // Dialog Collapsed State
  // ============================================
  const [permissionCollapsed, setPermissionCollapsed] = useState(false)
  const [questionCollapsed, setQuestionCollapsed] = useState(false)
  const [websearchCollapsed, setWebsearchCollapsed] = useState(false)

  const {
    inlineToolRequests,
    outlineCurrentHighlight,
    isWideMode,
    chatContentWidth,
    setChatContentWidth,
    chatInputWidth,
    setChatInputWidth,
    showTimelineNotices,
    showQueuedCompaction,
  } = useTheme()

  // 提示行开关参与可见性过滤：关掉后这些消息不进入时间线
  const chatPageViewModel = useChatPageViewModel(projectedMessages, showTimelineNotices)

  // ── 对话列/输入框宽度（左缘拖拽调宽，两个独立把手）──
  // 样式与交互抄 dsh ConversationWidthControls，按需求收窄成左缘单把手 × 2：
  // 把手（调整入口）只在桌面端单 panel / pane 全屏时挂载（分屏空间太碎不给拖），
  // 但调出来的自定义宽度对所有场景生效，分屏小 panel 也按它渲染
  // （pane 装不下时由 CSS 的 min(100%,…) 收到 100%）。
  // 两个宽度走 pane 根上的两个 CSS 变量，ChatArea 消息列、InputBox、
  // 各级 dock 的 max-width 都引用它们，拖拽期间直接写变量零 React 渲染。
  // 恢复默认 = 设置里切换宽屏模式（开或关都会清掉两个自定义宽度，themeStore.setWideMode）。
  const isDesktopSurface = outerViewport ? !outerViewport.presentation.isCompact : false
  const canAdjustChatWidth = isDesktopSurface && (displayMode === 'single' || isPaneFullscreen)
  const [paneWidth, setPaneWidth] = useState(0)
  useEffect(() => {
    const el = paneRootRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width
      if (width) setPaneWidth(Math.round(width))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const outerViewportWidth = outerViewport?.layout.viewportWidth ?? 0
  // 默认宽度对齐原 Tailwind 类：窄 max-w-2xl(672)；宽 max-w-[95%] xl:max-w-6xl
  // （xl 断点看视口宽而非 pane 宽，≥1280 时才收 72rem=1152 的上限）
  const defaultChatColumnWidth = isWideMode
    ? paneWidth > 0
      ? outerViewportWidth >= 1280
        ? Math.min(paneWidth * 0.95, 1152)
        : paneWidth * 0.95
      : 1152
    : 672
  const customChatColumnWidth = chatContentWidth
  const customChatInputWidth = chatInputWidth
  // 两侧各留 48px gutter：把手条带贴在内容列外 24px、宽 10px，拖拽到最宽时把手仍不贴边。
  // 只在可调模式 clamp——分屏等不可调场景保持原行为（CSS 的 min(100%,…) 自然兜住溢出）
  const maxChatColumnWidth =
    canAdjustChatWidth && paneWidth > 0 ? Math.max(MIN_CHAT_CONTENT_WIDTH, paneWidth - 96) : Number.MAX_SAFE_INTEGER
  const chatColumnWidth = Math.min(
    Math.max(customChatColumnWidth ?? defaultChatColumnWidth, MIN_CHAT_CONTENT_WIDTH),
    maxChatColumnWidth,
  )
  // 输入框宽度独立调整；默认固定 3xl(768)
  const resolvedChatInputWidth = Math.min(
    Math.max(customChatInputWidth ?? DEFAULT_INPUT_WIDTH, MIN_CHAT_CONTENT_WIDTH),
    maxChatColumnWidth,
  )

  // inline 模式下未被任何工具卡片认领的 family 请求仍走底部会话级弹窗——
  // 典型场景：刷新后运行中的子代理要权限（progress 不落库，metadata.sessionID
  // 丢失）、OMO 后台子代理没有可见卡片。不兜底的话请求彻底不可见、会话假死。
  // 官方同款：权限 dock 按 sessionID 子树收集，与卡片匹配无关。
  const childSessionVersion = useSyncExternalStore(childSessionStore.subscribe, childSessionStore.getVersion)
  const allPendingForms = useMemo(
    () => (pendingWebsearchRequest ? [...pendingQuestionRequests, pendingWebsearchRequest] : pendingQuestionRequests),
    [pendingQuestionRequests, pendingWebsearchRequest],
  )
  const unclaimed = useMemo(
    () => {
      // childSessionVersion 是绑定表版本号：卡片↔子会话绑定变化不改任何入参引用，
      // 但认领判定会变——引用它让依赖数组语义完整（也让 memo 正确失效）
      void childSessionVersion
      return inlineToolRequests && routeSessionId
        ? partitionUnclaimedRequests(messages, pendingPermissionRequests, allPendingForms, paneServerId, routeSessionId)
        : { permissions: [], questions: [] }
    },
    [
      inlineToolRequests,
      routeSessionId,
      messages,
      pendingPermissionRequests,
      allPendingForms,
      paneServerId,
      childSessionVersion,
    ],
  )
  const isWebsearchForm = (form: (typeof allPendingForms)[number]) =>
    (form.metadata as Record<string, unknown> | undefined)?.kind === 'websearch.provider'
  // inline 模式底部只渲染未认领的；非 inline 模式维持原样（全量会话级弹窗）。
  // 提问维持原有优先级：有待处理权限时提问排队不弹。
  const visiblePermissionRequests = inlineToolRequests ? unclaimed.permissions : pendingPermissionRequests
  const visibleQuestionRequests =
    visiblePermissionRequests.length === 0
      ? inlineToolRequests
        ? unclaimed.questions.filter(form => !isWebsearchForm(form))
        : pendingQuestionRequests
      : []
  const visibleWebsearchRequest =
    visiblePermissionRequests.length === 0
      ? inlineToolRequests
        ? visibleQuestionRequests.length === 0
          ? unclaimed.questions.find(isWebsearchForm)
          : undefined
        : pendingWebsearchRequest
      : undefined

  // 新请求出现（含 inline 模式底部兜底）时解除折叠
  const permissionRequestId = visiblePermissionRequests[0]?.id
  const questionRequestId = visibleQuestionRequests[0]?.id
  const websearchRequestId = visibleWebsearchRequest?.id
  useEffect(() => {
    if (permissionRequestId) setPermissionCollapsed(false)
  }, [permissionRequestId])
  useEffect(() => {
    if (questionRequestId) setQuestionCollapsed(false)
  }, [questionRequestId])
  useEffect(() => {
    if (websearchRequestId) setWebsearchCollapsed(false)
  }, [websearchRequestId])

  const inlineToolRequestCtx = useMemo<InlineToolRequestContextValue>(
    () => ({
      // 子 session 请求匹配必须用 pane 绑定的服务器，而不是全局活动服务器（多服务器 / WSL 下两者不同）
      serverId: paneServerId,
      pendingPermissions: pendingPermissionRequests,
      pendingQuestions: pendingQuestionRequests,
      onPermissionReply: (requestId, reply) => {
        const request = pendingPermissionRequests.find(r => r.id === requestId)
        return handlePermissionReply(requestId, reply, effectiveDirectory, request?.sessionID)
      },
      onFormReply: (form, answer) => handleFormReply(form, answer),
      onFormCancel: form => handleFormCancel(form),
      isReplying,
    }),
    [
      paneServerId,
      pendingPermissionRequests,
      pendingQuestionRequests,
      handlePermissionReply,
      handleFormReply,
      handleFormCancel,
      isReplying,
      effectiveDirectory,
    ],
  )

  const revertedMessage = inputRestoreContent
    ? {
        text: inputRestoreContent.text,
        attachments: inputRestoreContent.attachments as Attachment[],
      }
    : undefined
  const fileCapabilities = useMemo(
    () =>
      currentModel
        ? {
            image: currentModel.capabilities?.input?.includes('image') ?? false,
            pdf: currentModel.capabilities?.input?.includes('pdf') ?? false,
            audio: currentModel.capabilities?.input?.includes('audio') ?? false,
            video: currentModel.capabilities?.input?.includes('video') ?? false,
          }
        : undefined,
    [currentModel],
  )
  const handleScrollToBottom = useCallback(() => {
    chatAreaRef.current?.scrollToBottom()
  }, [])

  // ============================================
  // Render
  // ============================================
  const chatContent = (
    <div className="flex-1 relative overflow-hidden flex flex-col min-h-0">
      {displayMode === 'single' && (
        <div className="absolute top-0 left-0 right-0 z-20 pointer-events-none">
          <div className="pointer-events-auto">
            <Header
              models={visibleModels}
              providers={providers}
              modelsLoading={modelsLoading}
              selectedModelKey={selectedModelKey}
              onModelChange={handleModelChange}
              onOpenSidebar={onOpenSidebar}
              onToggleRightPanel={onToggleRightPanel}
              onSplitPane={onSplitPane}
              isPaneFullscreen={isPaneFullscreen}
              onTogglePaneFullscreen={onTogglePaneFullscreen}
              modelSelectorRef={modelSelectorRef}
            />
          </div>
        </div>
      )}

      <div className="absolute inset-0">
        <InlineToolRequestContext.Provider value={inlineToolRequestCtx}>
          <ErrorBoundary onOpenSettings={onOpenSettings}>
            {chatAreaMountKey == null ? (
              <div className="h-full flex items-center justify-center">
                <div className="flex flex-col items-center gap-3 text-text-400 session-loading-indicator">
                  <span className="w-5 h-5 border-2 border-text-400/30 border-t-text-400 rounded-full animate-spin" />
                </div>
              </div>
            ) : (
              <ChatArea
                key={chatAreaMountKey}
                ref={chatAreaRef}
                messages={projectedMessages}
                visibleMessageEntries={chatPageViewModel.visibleMessageEntries}
                visibleMessages={chatPageViewModel.visibleMessages}
                forkTargetIdMap={chatPageViewModel.forkTargetIdMap}
                turnDurationMap={chatPageViewModel.turnDurationMap}
                turnLatestAssistantIds={chatPageViewModel.turnLatestAssistantIds}
                sessionId={routeSessionId}
                isStreaming={isStreaming}
                allowStreamingLayoutAnimation={isAtBottom}
                loadState={renderedLoadState}
                loadError={loadError}
                connectionError={connectionError}
                onOpenSettings={onOpenSettings}
                hasMoreHistory={hasMoreHistory}
                onLoadMore={loadMoreHistory}
                onUndo={handleUndoWithAnimation}
                onFork={handleForkMessage}
                canUndo={canUndo}
                registerMessage={registerMessage}
                retryStatus={retryStatus}
                queuedFollowUps={queuedPrompts}
                queuedCompactions={showQueuedCompaction ? queuedCompactions : undefined}
                queueEditingId={queueEditing?.item.id}
                queueMutation={queueMutation}
                onQueueSteer={handleSteerQueuedPrompt}
                onQueueEdit={item => (queueEditing?.item.id === item.id ? handleCancelQueueEdit() : handleEditQueuedPrompt(item))}
                onQueueRemove={item => handleCancelQueuedPrompt(item.id)}
                onQueueReorder={handleReorderQueuedPrompts}
                bottomPadding={inputBoxHeight}
                onVisibleMessageIdsChange={handleVisibleIdsChange}
                onAtBottomChange={setIsAtBottom}
              />
            )}
          </ErrorBoundary>
        </InlineToolRequestContext.Provider>
      </div>

      <OutlineIndex
        sourceEntries={chatPageViewModel.outlineSourceEntries}
        ownerByMessageId={chatPageViewModel.outlineOwnerByMessageId}
        visibleMessageIds={visibleMessageIds}
        currentHighlightEnabled={outlineCurrentHighlight}
        onScrollToMessageId={handleOutlineScrollToMessage}
      />

      <div ref={inputBoxWrapperRef} className="absolute bottom-0 left-0 right-0 z-10 pointer-events-none">
        {(showCancelHint || (fullAutoHint && !showCancelHint)) && (
          <div className="absolute bottom-full inset-x-0 flex justify-center pb-2 pointer-events-none z-20">
            <div className="px-3 py-1.5 glass border border-border-200/60 rounded-lg shadow-lg text-[length:var(--fs-sm)] text-text-300 animate-in fade-in slide-in-from-bottom-2 duration-150">
              {showCancelHint ? (
                <Trans
                  i18nKey="chat:hints.pressEscAgain"
                  components={{
                    1: (
                      <kbd className="mx-0.5 px-1.5 py-0.5 bg-bg-200 border border-border-200 rounded text-[length:var(--fs-xs)] font-mono font-medium text-text-200" />
                    ),
                  }}
                />
              ) : (
                fullAutoHint
              )}
            </div>
          </div>
        )}
        <InputBox
          paneId={paneId}
          onSend={handleSend}
          onAbort={handleAbort}
          onCommand={handleCommand}
          onShell={handleShellCommand}
          onNewChat={handleNewSession}
          disabled={inputDisabled}
          isStreaming={isStreaming}
          agents={agents}
          selectedAgent={selectedAgent}
          onAgentChange={handleAgentChange}
          variants={currentModel?.variants?.map(variant => variant.id) ?? []}
          selectedVariant={selectedVariant}
          onVariantChange={handleVariantChange}
          fileCapabilities={fileCapabilities}
          models={visibleModels}
          providers={providers}
          selectedModelKey={selectedModelKey}
          onModelChange={handleModelChange}
          modelsLoading={modelsLoading}
          modelSelectorRef={modelSelectorRef}
          rootPath={effectiveDirectory}
          sessionId={routeSessionId}
          serverId={paneServerId}
          revertedText={revertedMessage?.text}
          revertedAttachments={revertedMessage?.attachments}
          composerDraft={composerDraft}
          busyDelivery={busyDelivery}
          onBusyDeliveryChange={setBusyDelivery}
          backgroundTasks={blockingBackgroundTasks}
          onMoveToBackground={() => void handleMoveToBackground()}
          backgroundMoving={backgroundMoving}
          canRedo={canRedo}
          revertSteps={redoSteps}
          onRedo={handleRedoWithAnimation}
          onRedoAll={handleRedoAll}
          onClearRevert={clearRevert}
          registerInputBox={registerInputBox}
          isAtBottom={isAtBottom}
          showScrollToBottom={!isAtBottom}
          onScrollToBottom={handleScrollToBottom}
          collapsedPermission={
            visiblePermissionRequests.length > 0 && permissionCollapsed
              ? {
                  label: t('chat:permissionDialog.permission', {
                    permission: visiblePermissionRequests[0].action,
                  }),
                  queueLength: visiblePermissionRequests.length,
                  onExpand: () => setPermissionCollapsed(false),
                }
              : undefined
          }
          collapsedQuestion={
            visiblePermissionRequests.length === 0 && visibleQuestionRequests.length > 0 && questionCollapsed
              ? {
                  label: t('chat:questionDialog.title'),
                  queueLength: visibleQuestionRequests.length,
                  onExpand: () => setQuestionCollapsed(false),
                }
              : undefined
          }
          collapsedWebsearch={
            visibleWebsearchRequest && websearchCollapsed
              ? {
                  label: t('chat:websearch.title'),
                  queueLength: 1,
                  onExpand: () => setWebsearchCollapsed(false),
                }
              : undefined
          }
        />
        {/* 输入框左缘拖拽把手（与对话列把手独立，各调各的宽度） */}
        {canAdjustChatWidth && paneWidth > 0 && (
          <ChatWidthHandle
            rootRef={paneRootRef}
            width={resolvedChatInputWidth}
            maxWidth={maxChatColumnWidth}
            onCommit={setChatInputWidth}
            cssVar={CHAT_INPUT_WIDTH_VAR}
            title={t('inputWidthDragHint')}
            className="inset-y-0 pointer-events-auto"
            style={{ right: `calc(50% + var(${CHAT_INPUT_WIDTH_VAR}) / 2 + 24px)` }}
          />
        )}
      </div>

      <BtwDialog
        isOpen={btwOpen}
        onClose={() => setBtwOpen(false)}
        sessionId={routeSessionId}
        serverId={paneServerId}
        initialQuestion={btwQuestion}
        askNonce={btwNonce}
      />

      {visiblePermissionRequests.length > 0 && (
        <PermissionDialog
          request={visiblePermissionRequests[0]}
          onReply={reply =>
            handlePermissionReply(
              visiblePermissionRequests[0].id,
              reply,
              effectiveDirectory,
              visiblePermissionRequests[0].sessionID,
            )
          }
          queueLength={visiblePermissionRequests.length}
          isReplying={isReplying}
          currentSessionId={routeSessionId}
          collapsed={permissionCollapsed}
          onCollapsedChange={setPermissionCollapsed}
        />
      )}

      {visiblePermissionRequests.length === 0 && visibleQuestionRequests.length > 0 && (
        <QuestionDialog
          form={visibleQuestionRequests[0]}
          onReply={(_formId, answer) => handleFormReply(visibleQuestionRequests[0], answer)}
          onCancel={() => handleFormCancel(visibleQuestionRequests[0])}
          queueLength={visibleQuestionRequests.length}
          isReplying={isReplying}
          collapsed={questionCollapsed}
          onCollapsedChange={setQuestionCollapsed}
        />
      )}

      {/* websearch.provider 表单 → 与权限/提问同一个请求区（同款卡片、同样能收起成胶囊） */}
      {visibleWebsearchRequest && (
        <WebsearchDock
          form={visibleWebsearchRequest}
          directory={effectiveDirectory}
          onReply={handleFormReply}
          isReplying={isReplying}
          collapsed={websearchCollapsed}
          onCollapsedChange={setWebsearchCollapsed}
        />
      )}

    </div>
  )

  const content = (
    <SessionNavigationContext.Provider value={navigationCtx}>
      <div
        ref={paneRootRef}
        data-chat-pane-root="true"
        style={
          {
            [CHAT_COLUMN_WIDTH_VAR]: `${chatColumnWidth}px`,
            [CHAT_INPUT_WIDTH_VAR]: `${resolvedChatInputWidth}px`,
          } as CSSProperties
        }
        className={
          showCompactShell
            ? `relative h-full flex flex-col overflow-hidden rounded-lg transition-colors duration-200 ${
                isFocused
                  ? 'ring-1 ring-accent-main-100/60 bg-bg-100'
                  : 'ring-1 ring-border-200/30 bg-bg-100 hover:ring-border-200/50'
              }`
            : 'relative h-full flex flex-col overflow-hidden bg-bg-100'
        }
        onClick={handlePaneFocus}
      >
        {showCompactShell && (
          <PaneHeader
            paneId={paneId}
            sessionId={routeSessionId}
            isFocused={isFocused}
            paneCount={paneCount}
            showSidebarButton={showSidebarButton}
            onOpenSidebar={onOpenSidebar}
            onToggleRightPanel={onToggleRightPanel}
            canSplitPane={splitPaneEnabled}
            isPaneFullscreen={isPaneFullscreen}
            onTogglePaneFullscreen={onTogglePaneFullscreen}
            onFocus={handlePaneFocus}
          />
        )}
        {chatContent}
        {canAdjustChatWidth && paneWidth > 0 && (
          <ChatWidthHandle
            rootRef={paneRootRef}
            width={chatColumnWidth}
            maxWidth={maxChatColumnWidth}
            onCommit={setChatContentWidth}
            cssVar={CHAT_COLUMN_WIDTH_VAR}
            title={t('widthDragHint')}
            className="top-10 bottom-0"
            style={{ right: `calc(50% + var(${CHAT_COLUMN_WIDTH_VAR}) / 2 + 24px)` }}
          />
        )}
        <PaneDropOverlay ref={overlayRef} />
        <FolderProjectDropOverlay active={isFolderDropActive} />
      </div>
    </SessionNavigationContext.Provider>
  )

  // Always wrap with ChatViewportProvider to keep the React tree structure stable
  // across fullscreen toggles. Only the value changes — compact pane vs full viewport.
  // Split shell keeps compact presentation, but must inherit the input-dock setting
  // from the outer viewport (previously hardcoded false, so PC split never collapsed).
  const viewportValue = useMemo((): ChatViewportValue => {
    if (!showCompactShell) return outerViewport ?? PANE_VIEWPORT
    const enableCollapsedInputDock = outerViewport?.interaction.enableCollapsedInputDock ?? false
    if (enableCollapsedInputDock === PANE_VIEWPORT.interaction.enableCollapsedInputDock) {
      return PANE_VIEWPORT
    }
    return {
      ...PANE_VIEWPORT,
      interaction: {
        ...PANE_VIEWPORT.interaction,
        enableCollapsedInputDock,
      },
    }
  }, [showCompactShell, outerViewport])

  return <ChatViewportProvider value={viewportValue}>{content}</ChatViewportProvider>
})
