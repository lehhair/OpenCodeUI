// ============================================
// useChatSession - 聊天会话管理
// ============================================

import { useState, useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import {
  messageStore,
  useSessionFamily,
  useSessionState,
  autoApproveStore,
  childSessionStore,
  useActiveSessionStore,
  type RevertHistoryItem,
} from '../store'
import {
  useSessionManager,
  registerSessionConsumer,
  updateConsumerSessionId,
  hasOtherConsumerForSession,
  flushPendingRequests,
} from '../hooks'
import { usePermissions, usePermissionHandler, useMessageAnimation, useDirectory, useSessionContext, useAgents } from '../hooks'
import { useNotification } from './useNotification'
import { notificationEventSettingsStore } from '../store/notificationEventSettingsStore'
import { notificationStore } from '../store/notificationStore'
import { shellInventoryStore } from '../store/shellInventoryStore'
import {
  sendMessageAsync,
  getSessionMessages,
  abortSession,
  getPendingPermissions,
  getPendingForms,
  prefetchCommands,
  prefetchRootDirectory,
  getSessionChildren,
  executeCommand,
  summarizeSession,
  forkSession,
  exportSession,
  getSessionInbox,
  cancelInboxItem,
  updateInboxDelivery,
  executeSessionShell,
  type ApiFormInfo,
  type ApiPermissionRequest,
  type ApiSession,
  type Attachment,
  type Model,
} from '../api'
import { sendAdmission, outboxAdd, outboxHas, outboxTryRollback } from '../api/sendAdmission'
import { buildEditedPromptInput, confirmQueueEdit, queuedPromptAttachments, rewriteQueueOrder } from '../api/queue'
import { queueMutationSettled, type QueueMutation } from '../features/chat/queueProjection'
import { buildPromptParts } from '../api/message'
import i18n from '../i18n'
import { sessionDisplayTitle } from '../utils/sessionTitle'
import {
  assistantText,
  isAssistantMessage,
  isUserMessage,
  type PromptAgentAttachment,
  type PromptFileAttachment,
  type SessionMessageInfo,
  type UserMessage,
} from '../types/api/message'
import type { APIError } from '../types/api/common'
import { clipboardErrorHandler, copyTextToClipboard, createErrorHandler } from '../utils'
import { saveData } from '../utils/downloadUtils'
import { clearSessionRuntimeState } from '../utils/sessionLifecycle'
import { scheduleIdle } from '../utils/scheduleIdle'
import { serverStorage } from '../utils/perServerStorage'
import { makeSessionKey, sessionKeyToServerId, splitSessionKey } from '../utils/sessionKey'
import { sweepTaskChildBindings, verifyTaskChildBindings } from '../utils/taskChildBinding'
import { createMessageId } from '../utils/identifier'
import { serverStore } from '../store/serverStore'
import { STORAGE_KEY_SELECTED_AGENT } from '../constants'
import type { ChatAreaHandle } from '../features/chat'
import { inboxStore, useInboxUserPrompts, useInboxCompactions, queuedPromptText } from '../store/inboxStore'
import type { QueuedUserPrompt } from '../store/inboxStore'
import { themeStore } from '../store/themeStore'

const handleError = createErrorHandler('session')

/**
 * Stable empty session state singleton.
 *
 * When routeSessionId is null (e.g. an empty split pane), useChatSession
 * uses this instead of creating a new object on every render.  A fresh
 * literal `{ messages: [], ... }` would give a different reference each
 * time, defeating React.memo on ChatArea and causing pointless re-renders
 * of the entire message tree.
 */
const EMPTY_SESSION_STATE = {
  messages: [] as SessionMessageInfo[],
  isStreaming: false,
  loadState: 'idle' as const,
  loadError: undefined as APIError | undefined,
  revertState: null,
  canUndo: false,
  canRedo: false,
  redoSteps: 0,
  revertedContent: null,
  hasMoreHistory: false,
  directory: '',
  title: null,
  model: undefined,
} as const

interface UseChatSessionOptions {
  paneId: string
  chatAreaRef: React.RefObject<ChatAreaHandle | null>
  currentModel: Model | undefined
  refetchModels: () => Promise<void>
  sessionId: string | null
  navigateToSession: (sessionId: string, directory?: string) => void
  navigateHome: () => void
  /** /btw 侧问请求（官方 session.btw 同款）：打开侧问对话框，args 预填问题 */
  onBtwRequest?: (question?: string) => void
}

interface LiveRetryStatus {
  sessionID: string
  attempt: number
  message: string
  next: number
}

export function useChatSession({
  paneId,
  chatAreaRef,
  currentModel,
  refetchModels,
  sessionId: routeSessionId,
  navigateToSession,
  navigateHome,
  onBtwRequest,
}: UseChatSessionOptions) {
  const { statusMap } = useActiveSessionStore()
  const { queueFollowupMessages } = useSyncExternalStore(themeStore.subscribe, themeStore.getSnapshot)

  // busy 时的投递方式（PiUI 输入栏 steer/follow-up 切换同款）：默认跟随全局
  // queueFollowupMessages 设置，流式期间可在输入栏即时切换
  const [busyDelivery, setBusyDelivery] = useState<'queue' | 'steer'>(queueFollowupMessages ? 'queue' : 'steer')
  useEffect(() => {
    setBusyDelivery(queueFollowupMessages ? 'queue' : 'steer')
  }, [queueFollowupMessages])

  // 队列编辑状态（官方 queue.edit 的 editing 同款）：
  // item=正在编辑的队列条目；stashRestoreNonce=取消编辑时恢复输入框暂存的触发键
  const [queueEditing, setQueueEditing] = useState<{ item: QueuedUserPrompt; nonce: number } | null>(null)
  const [stashRestoreNonce, setStashRestoreNonce] = useState(0)
  // 队列 mutation 投影（官方 rows() 的 mutation.isPending 窗口同款）：
  // 编辑/重排期间队列直接显示期望形态，服务端事件落地无跳变
  const [queueMutation, setQueueMutation] = useState<QueueMutation | null>(null)

  // Agents
  const [selectedAgent, setSelectedAgentRaw] = useState<string>(
    () => serverStorage.get(`${STORAGE_KEY_SELECTED_AGENT}:${paneId}`) || '',
  )
  const [restoredContent, setRestoredContent] = useState<{ sessionId: string; content: RevertHistoryItem } | null>(null)

  const setSelectedAgent = useCallback(
    (agentName: string) => {
      setSelectedAgentRaw(agentName)
      serverStorage.set(`${STORAGE_KEY_SELECTED_AGENT}:${paneId}`, agentName)
    },
    [paneId],
  )

  // Hooks
  const { resetPermissions } = usePermissions()
  const { currentDirectory } = useDirectory()
  const { createSession, sessions } = useSessionContext()
  const { sendNotification } = useNotification()

  const routeStatus = routeSessionId ? statusMap[routeSessionId] : undefined
  const routeSessionIdRef = useRef(routeSessionId)

  useEffect(() => {
    routeSessionIdRef.current = routeSessionId
  }, [routeSessionId])

  /**
   * 当前 pane 绑定的服务器（sessionId 为复合 key，split 出 serverId；home 状态跟随 active server）。
   * 约定：凡发起服务器作用域请求的 memo/effect/回调都必须声明 paneServerId——
   * 它的值会在 pane 生命周期内变化（切会话、活动服务器切换、WSL sidecar 就绪后切回），
   * 漏声明就会把请求打到旧服务器。被 routeSessionId 守卫的单元除外：此时 paneServerId 是它的纯函数。
   */
  const activeServerId = useSyncExternalStore(
    cb => serverStore.subscribe(cb),
    () => serverStore.getActiveServerId(),
    () => serverStore.getActiveServerId(),
  )
  const paneServerId = useMemo(
    () => (routeSessionId ? sessionKeyToServerId(routeSessionId) : activeServerId),
    [routeSessionId, activeServerId],
  )

  // agents 目录：共享 store（按 server+directory 缓存，多 pane 不重复拉取）；
  // 健康度兜底与事件刷新由 useGlobalEvents 统一驱动（对齐官方 location store）
  const { agents, refetch: refetchAgents } = useAgents(currentDirectory, paneServerId)

  const handleMissingRouteSession = useCallback(
    (missingSessionId: string) => {
      if (routeSessionIdRef.current !== missingSessionId) return
      clearSessionRuntimeState(missingSessionId)
      navigateHome()
    },
    [navigateHome],
  )

  // 服务端 inbox 队列（官方 session.pending 的对应物）：排队中的用户 prompt
  const inboxUserPrompts = useInboxUserPrompts(routeSessionId)
  // 队列视图只列 queue 条目（官方 queue.ts:83 同款过滤）；steer 条目是瞬态的，
  // 其回声由转写投影（projectQueueEchoes）挪到末尾展示
  const queuedPrompts = useMemo(() => inboxUserPrompts.filter(item => item.delivery === 'queue'), [inboxUserPrompts])
  // 排队中的压缩（官方 CompactionQueued 行）：只在服务端已接收、尚未开始时存在
  const queuedCompactions = useInboxCompactions(routeSessionId)

  const perSessionStateRaw = useSessionState(routeSessionId)
  const perSessionState = perSessionStateRaw ?? EMPTY_SESSION_STATE

  const messages = perSessionState.messages
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  const isStreaming = perSessionState.isStreaming
  const sessionDirectory = perSessionState.directory
  /** durable 会话级模型（进入会话时对齐输入框模型的权威来源） */
  const sessionModel = perSessionState.model
  const canUndo = perSessionState.canUndo
  const canRedo = perSessionState.canRedo
  const redoSteps = perSessionState.redoSteps
  const revertedContent = perSessionState.revertedContent
  const hasMoreHistory = perSessionState.hasMoreHistory
  const loadState = routeSessionId ? perSessionState.loadState : ('idle' as const)
  const loadError = routeSessionId ? perSessionState.loadError : undefined

  // OpenAPI SessionStatus.retry: { attempt, message, next }
  const retryStatus = useMemo<LiveRetryStatus | null>(() => {
    if (!routeSessionId || routeStatus?.type !== 'retry') return null
    return {
      sessionID: routeSessionId,
      attempt: routeStatus.attempt,
      message: routeStatus.message,
      next: routeStatus.next,
    }
  }, [routeSessionId, routeStatus])

  // 注意：不能用 Boolean(routeStatus) 判断忙——{type:'idle'} 也是真值，
  // 会让会话在出现任何状态条目后永久"忙"，所有消息进队列且永不发出。
  const isSessionBusy = useMemo(
    () => routeStatus?.type === 'busy' || routeStatus?.type === 'retry' || isStreaming,
    [routeStatus, isStreaming],
  )

  const getSessionTitle = useCallback(
    (sessionId?: string) => {
      const session = sessions.find(s => s.id === sessionId)
      if (session) {
        // 官方 displayLabel 同款兜底（无标题/历史时间戳标题 → 简洁标签）
        return sessionDisplayTitle(session, {
          newSession: i18n.t('commands:sessions.newSession'),
          childSession: i18n.t('commands:sessions.childSession'),
        })
      }
      return 'OpenCode'
    },
    [sessions],
  )

  const buildNotificationTitle = useCallback(
    (sessionId: string | undefined, label: string) => {
      const base = getSessionTitle(sessionId)
      return `${base} - ${label}`
    },
    [getSessionTitle],
  )

  // Session family for permission polling
  const sessionFamily = useSessionFamily(routeSessionId)

  // Session Manager
  const { loadSession, loadMoreHistory, handleUndo, handleRedo, handleRedoAll, clearRevert } = useSessionManager({
    sessionId: routeSessionId,
    directory: currentDirectory,
    onSessionMissing: handleMissingRouteSession,
  })

  // Permission handling
  const {
    pendingPermissionRequests,
    pendingQuestionRequests: pendingFormRequests,
    setPendingPermissionRequests,
    setPendingQuestionRequests,
    handlePermissionReply,
    handleFormReply,
    handleFormCancel,
    refreshPendingRequests,
    resetPendingRequests,
    markPermissionResolved,
    isPermissionResolved,
    isReplying,
  } = usePermissionHandler(paneServerId)

  // v2 的表单按 metadata.kind 分流（官方 requests/model.ts:44-58）：
  // websearch.provider → 专用 dock；其余 → 通用 QuestionDialog
  const pendingWebsearchRequest = useMemo(
    () => pendingFormRequests.find(form => (form.metadata as Record<string, unknown> | undefined)?.kind === 'websearch.provider'),
    [pendingFormRequests],
  )
  const pendingQuestionRequests = useMemo(
    () => pendingFormRequests.filter(form => (form.metadata as Record<string, unknown> | undefined)?.kind !== 'websearch.provider'),
    [pendingFormRequests],
  )

  // Prevent infinite retry loops when auto-approve API calls fail
  // but the server may have already processed the request (lost response).
  const autoRetriedIdsRef = useRef(new Set<string>())

  // Message animations
  const { registerMessage, registerInputBox, animateUndo, animateRedo } = useMessageAnimation()

  // Effective directory (used in multiple places)
  const effectiveDirectory = sessionDirectory || currentDirectory

  const fullAutoMode = useSyncExternalStore(
    cb => autoApproveStore.onFullAutoChange(cb),
    () => autoApproveStore.getPaneFullAutoMode(paneId),
  )
  const approvePendingOnFullAuto = useSyncExternalStore(
    autoApproveStore.subscribe,
    () => autoApproveStore.approvePendingOnFullAuto,
  )

  const replyPermissionOnceAutomatically = useCallback(
    (request: ApiPermissionRequest) => {
      if (!autoApproveStore.claimAutoReply(request.id)) return

      void handlePermissionReply(request.id, 'once', effectiveDirectory, request.sessionID).then(success => {
        if (!success) {
          autoApproveStore.releaseAutoReply(request.id)
          // Retry once on failure. handlePermissionReply already retries 3× via withRetry,
          // but the server may have processed the request and the response was lost.
          // Force effect re-run by creating a new array reference.
          if (!autoRetriedIdsRef.current.has(request.id)) {
            autoRetriedIdsRef.current.add(request.id)
            setPendingPermissionRequests(prev => [...prev])
          }
        }
      })
    },
    [effectiveDirectory, handlePermissionReply, setPendingPermissionRequests],
  )

  // Clear retry tracking on each auto-approve batch
  useEffect(() => {
    autoRetriedIdsRef.current.clear()
  }, [approvePendingOnFullAuto, fullAutoMode])

  useEffect(() => {
    if (!routeSessionId || !approvePendingOnFullAuto || fullAutoMode !== 'session') return
    void refreshPendingRequests(sessionFamily, effectiveDirectory)
  }, [
    approvePendingOnFullAuto,
    effectiveDirectory,
    fullAutoMode,
    refreshPendingRequests,
    routeSessionId,
    sessionFamily,
  ])

  useEffect(() => {
    if (!approvePendingOnFullAuto || fullAutoMode === 'off' || pendingPermissionRequests.length === 0) return

    for (const request of pendingPermissionRequests) {
      replyPermissionOnceAutomatically(request)
    }
  }, [approvePendingOnFullAuto, fullAutoMode, pendingPermissionRequests, replyPermissionOnceAutomatically])

  const buildLocalQueuedMessage = useCallback(
    (input: {
      sessionId: string
      messageId: string
      text: string
      attachments: Attachment[]
      agent?: string
      model: { providerID: string; modelID: string; variant?: string }
      createdAt: number
    }): UserMessage => {
      // v2 的用户消息自带 text / files / agents（不再有 parts 数组）
      const files: PromptFileAttachment[] = []
      const agents: PromptAgentAttachment[] = []

      for (const attachment of input.attachments) {
        const mention = attachment.textRange
          ? {
              start: attachment.textRange.start,
              end: attachment.textRange.end,
              text: attachment.textRange.value,
            }
          : undefined

        if (attachment.type === 'agent') {
          agents.push({
            name: attachment.agentName || attachment.displayName,
            mention,
          })
          continue
        }

        if (attachment.type !== 'file' && attachment.type !== 'folder') continue

        files.push({
          // 本地乐观消息只用于展示；真实的 prompt 由 sendMessageAsync 组装，
          // 因此 data 留空、URL 走 source.uri（与 AttachmentPartViews 的读取一致）
          data: '',
          mime: attachment.mime || (attachment.type === 'folder' ? 'application/x-directory' : 'text/plain'),
          source: attachment.url ? { type: 'uri', uri: attachment.url } : { type: 'inline' },
          name: attachment.displayName,
          mention,
        })
      }

      return {
        id: input.messageId,
        type: 'user',
        time: { created: input.createdAt },
        text: input.text,
        ...(files.length > 0 ? { files } : {}),
        ...(agents.length > 0 ? { agents } : {}),
      }
    },
    [],
  )

  /**
   * 本地 inbox 条目（官方 queue.ts 的 admitLocal 同款）：busy 时发送的那一刻
   * 就把条目塞进 inboxStore，转写投影立刻隐藏回声 → 队列气泡一步到位，
   * 不会先闪一下实心用户气泡再跳回队列。
   * 服务端 session.inbox.enqueued 到达时以同一 inboxID upsert，字段补齐。
   */
  const admitLocalInboxItem = useCallback(
    (
      sessionId: string,
      item: {
        inboxId: string
        text: string
        delivery: 'queue' | 'steer'
        attachments: Attachment[]
        agent?: string
      },
    ) => {
      const files: PromptFileAttachment[] = []
      const agents: PromptAgentAttachment[] = []
      for (const attachment of item.attachments) {
        const mention = attachment.textRange
          ? {
              start: attachment.textRange.start,
              end: attachment.textRange.end,
              text: attachment.textRange.value,
            }
          : undefined
        if (attachment.type === 'agent') {
          agents.push({ name: attachment.agentName || attachment.displayName, mention })
          continue
        }
        if (attachment.type !== 'file' && attachment.type !== 'folder') continue
        files.push({
          data: '',
          mime: attachment.mime || (attachment.type === 'folder' ? 'application/x-directory' : 'text/plain'),
          source: attachment.url ? { type: 'uri', uri: attachment.url } : { type: 'inline' },
          name: attachment.displayName,
          mention,
        })
      }
      inboxStore.upsertItem(sessionId, {
        id: item.inboxId,
        sessionID: sessionId,
        time: { created: Date.now() },
        type: 'user',
        delivery: item.delivery,
        payload: {
          text: item.text,
          ...(files.length > 0 ? { files } : {}),
          ...(agents.length > 0 ? { agents } : {}),
        },
      } as Parameters<typeof inboxStore.upsertItem>[1])
    },
    [],
  )

  // ============================================
  // SSE 事件回调（permission / question / scroll / idle / error / reconnect）
  // 每个 pane 都注册自己的 consumer，由 App 顶层统一建立 SSE 连接
  // ============================================

  /**
   * 请求所属 session 是否就是本 pane 正在看的会话（含其子 / 孙会话）。
   *
   * 用于系统通知去重：属于当前会话 family 的权限 / 提问会**挂在这个 pane 的
   * 界面上**（主会话里的子会话权限就是这种），用户在看着它，不该再收到一条
   * 通知。父子关系从子会话创建起就存在（session.created 与 REST session
   * 列表同源），这里直接复用 childSessionStore 的判定。
   */
  const isWithinCurrentSession = useCallback(
    (sessionId: string) => {
      if (!routeSessionId) return false
      const scoped = sessionId.includes('::') ? sessionId : makeSessionKey(paneServerId, sessionId)
      if (scoped === routeSessionId) return true
      return childSessionStore.belongsToSession(scoped, routeSessionId)
    },
    [routeSessionId, paneServerId],
  )

  const sseCallbacks = useMemo(
    () => ({
      onPermissionAsked: (request: import('../api').ApiPermissionRequest) => {
        // 已在本端处理过的请求不再上屏：SSE 重连回放 / 旧快照补投可能重复送达
        if (isPermissionResolved(request.id)) return

        // Full Auto 会话级：当前 session 的 handler 天然只处理当前 session 的请求
        const effectiveFullAutoMode = autoApproveStore.getPaneFullAutoMode(paneId)
        if (effectiveFullAutoMode === 'session') {
          replyPermissionOnceAutomatically(request)
          return
        }

        // 自动批准检查（实验性功能）
        if (
          autoApproveStore.enabled &&
          autoApproveStore.shouldAutoApprove(request.sessionID, request.action, request.resources)
        ) {
          // 匹配规则，自动用 once 批准，不弹框
          replyPermissionOnceAutomatically(request)
          return
        }

        setPendingPermissionRequests(prev => {
          if (prev.some(r => r.id === request.id)) return prev
          return [...prev, request]
        })

        // 系统通知只在「这条请求不在你眼前的会话里」时才发：
        // 请求所属 session 的父链上就是这个 pane 正在看的会话 → 权限卡片已经
        // 挂在当前界面（主会话里的子会话就属于这种），再弹通知就是重复打扰。
        // 父子关系从子会话创建起就存在（session.created / session 列表同源），
        // 这里直接复用 childSessionStore 的判定即可。
        const permDesc = request.resources?.length ? `${request.action}: ${request.resources[0]}` : request.action
        if (notificationEventSettingsStore.isSystemEnabled('permission') && !isWithinCurrentSession(request.sessionID)) {
          const title = buildNotificationTitle(request.sessionID, 'Permission Required')
          sendNotification(title, permDesc, {
            sessionId: request.sessionID,
            directory: effectiveDirectory,
          })
        }
        // 应用内 toast 已在 useGlobalEvents 中统一处理
      },
      onPermissionReplied: (data: { sessionID: string; requestID: string }) => {
        // 不管是本 pane 回复还是别处（全局自动放行 / 另一个客户端）处理，
        // 都记下来：后续 refresh 拿到的旧快照不能把它捡回来
        markPermissionResolved(data.requestID)
        setPendingPermissionRequests(prev =>
          prev.some(r => r.id === data.requestID) ? prev.filter(r => r.id !== data.requestID) : prev,
        )
      },
      onFormCreated: (form: ApiFormInfo) => {
        setPendingQuestionRequests(prev => {
          if (prev.some(r => r.id === form.id)) return prev
          return [...prev, form]
        })

        // 同权限：本 pane 就会展示的提问不再重复发系统通知
        const questionDesc = form.title || 'AI is waiting for your input'
        if (notificationEventSettingsStore.isSystemEnabled('question') && !isWithinCurrentSession(form.sessionID)) {
          const title = buildNotificationTitle(form.sessionID, 'Question')
          sendNotification(title, questionDesc, {
            sessionId: form.sessionID,
            directory: effectiveDirectory,
          })
        }
        // 应用内 toast 已在 useGlobalEvents 中统一处理
      },
      onFormReplied: (data: { sessionID: string; formID: string }) => {
        setPendingQuestionRequests(prev => prev.filter(r => r.id !== data.formID))
      },
      onFormCancelled: (data: { sessionID: string; formID: string }) => {
        setPendingQuestionRequests(prev => prev.filter(r => r.id !== data.formID))
      },
      onScrollRequest: () => {
        chatAreaRef.current?.scrollToBottomIfAtBottom()
      },
      onSessionIdle: (sessionID: string) => {
        // 页面不在前台时发送浏览器通知
        const title = buildNotificationTitle(sessionID, 'Session completed')
        if (notificationEventSettingsStore.isSystemEnabled('completed')) {
          sendNotification(title, 'Session completed', {
            sessionId: sessionID,
            directory: effectiveDirectory,
          })
        }
        // 应用内 toast 已在 useGlobalEvents 中统一处理
      },
      onExecutionFailed: (sessionID: string) => {
        // 页面不在前台时通知用户 session 出错（v2：execution.failed）
        const title = buildNotificationTitle(sessionID, 'Session error')
        if (notificationEventSettingsStore.isSystemEnabled('error')) {
          sendNotification(title, 'Session error', {
            sessionId: sessionID,
            directory: effectiveDirectory,
          })
        }
        // 应用内 toast 已在 useGlobalEvents 中统一处理
      },
      onReconnected: (_reason: 'network' | 'server-switch') => {
        messageStore.markAllSessionsStale()
        // 断连期间新建的子会话没收到 session.created：作废「已确认」标记，
        // 让首屏落地后的关系恢复重新问一次（每个会话也只多一次）
        childSessionStore.resetChildrenScans()

        // SSE 重连后重新加载当前会话，补齐断连期间可能丢失的消息
        if (routeSessionId) {
          // 使用 force 模式，确保覆盖本地可能不完整的数据
          loadSession(routeSessionId, { force: true })
          // 重连后刷新待处理的权限请求和问题，避免用户错过后台产生的请求
          refreshPendingRequests(sessionFamily, effectiveDirectory)
          // 断连期间的 inbox 增删事件已丢失，补拉队列快照（官方 pending.sync 同款）
          void syncInboxSnapshotRef.current(routeSessionId)
        }
        refetchModels().catch(() => {})
        // 重新获取 agents 列表（切换后端时 currentDirectory 可能没变，useEffect 不会触发）
        refetchAgents().catch(() => {})
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs and stable functions
    [
      paneId,
      paneServerId,
      effectiveDirectory,
      routeSessionId,
      sessionFamily,
      currentDirectory,
      replyPermissionOnceAutomatically,
      setPendingPermissionRequests,
      setPendingQuestionRequests,
      buildNotificationTitle,
      sendNotification,
      isWithinCurrentSession,
      isPermissionResolved,
      markPermissionResolved,
      loadSession,
      refreshPendingRequests,
      refetchModels,
      refetchAgents,
    ],
  )

  // 保存 callbacks ref 供 consumer 注册使用（避免频繁重新注册）
  const sseCallbacksRef = useRef(sseCallbacks)
  useEffect(() => {
    sseCallbacksRef.current = sseCallbacks
  }, [sseCallbacks])

  // 注册 pane 级 consumer，SSE 事件按 sessionId 分发到此
  useEffect(() => {
    const unregister = registerSessionConsumer(paneId, routeSessionId, {
      onPermissionAsked: req => sseCallbacksRef.current.onPermissionAsked(req),
      onPermissionReplied: data => sseCallbacksRef.current.onPermissionReplied(data),
      onFormCreated: form => sseCallbacksRef.current.onFormCreated(form),
      onFormReplied: data => sseCallbacksRef.current.onFormReplied(data),
      onFormCancelled: data => sseCallbacksRef.current.onFormCancelled(data),
      onScrollRequest: () => sseCallbacksRef.current.onScrollRequest(),
      onSessionIdle: sid => sseCallbacksRef.current.onSessionIdle(sid),
      onExecutionFailed: sid => sseCallbacksRef.current.onExecutionFailed(sid),
      onReconnected: reason => sseCallbacksRef.current.onReconnected(reason),
    })

    return unregister
  }, [paneId, routeSessionId])

  // sessionId 变化时更新 consumer 关注的 session（无需重新注册）
  useEffect(() => {
    updateConsumerSessionId(paneId, routeSessionId)
  }, [paneId, routeSessionId])

  const handleVisibleMessageIdsChange = useCallback((_ids: string[]) => {
    // No-op: parts are always in memory now
  }, [])

  // Preload @ root directory and / commands for current session directory.
  // 依赖只跟目录/服务器走：同目录切会话不该重发这两次请求
  //（缓存 TTL 只有 10s，挂在 routeSessionId 上等于每次切会话都打穿）。
  useEffect(() => {
    if (!effectiveDirectory) return

    prefetchRootDirectory(effectiveDirectory, paneServerId).catch(() => {})
    prefetchCommands(effectiveDirectory, paneServerId).catch(() => {})
  }, [effectiveDirectory, paneServerId])

  // 只有当前打开的会话目录主动水合 shell 库存（刷新后恢复后台 shell 行）。
  // 侧边栏里其它会话只吃全局 shell 事件，不因为出现在列表里就替用户
  // 打开那个工作区——见 shellInventoryStore 的 hydrateRefs 说明。
  useEffect(() => {
    if (!effectiveDirectory) return
    return shellInventoryStore.trackDirectory(effectiveDirectory)
  }, [effectiveDirectory])

  // agents 列表加载后，校验当前选中的 agent 是否存在于列表中
  // 选择值统一为 agent **id**（v2 API 用 id）；历史存储的显示名会被归一化成 id
  useEffect(() => {
    if (agents.length === 0) return
    const primaryAgents = agents.filter(a => a.mode !== 'subagent' && !a.hidden)
    if (primaryAgents.length === 0) return

    const matched = selectedAgent
      ? primaryAgents.find(a => a.id === selectedAgent || a.name === selectedAgent)
      : undefined
    if (matched) {
      if (matched.id !== selectedAgent) {
        const frameId = requestAnimationFrame(() => setSelectedAgent(matched.id))
        return () => cancelAnimationFrame(frameId)
      }
      return
    }

    // 否则选第一个 primary agent
    const frameId = requestAnimationFrame(() => {
      setSelectedAgent(primaryAgents[0].id)
    })

    return () => cancelAnimationFrame(frameId)
  }, [agents, selectedAgent, setSelectedAgent])

  // ============================================
  // 会话切换：先清掉旧会话残留，恢复动作延后到首屏消息落地
  // ============================================
  //
  // 这里原来在切会话时同步发起 getSessionChildren + 全量权限 + 全量表单 +
  // task 卡片绑定校验（内部最多 12 次 message.list）。这些请求会和首屏
  // getSession / message.list 抢同源连接槽，直接把「进入会话」拖慢。
  //
  // 现在分两段：
  //   1. 立即清空上一个会话的待处理请求（纯内存操作，防串台）
  //   2. 首屏消息落地（loaded / error）后再恢复关系与权限，绑定校验放到空闲时
  //
  // 功能不减：刷新后子会话关系、权限弹窗、task 卡片绑定照样恢复，只是
  // 不再挡在首屏前面。官方同样把子会话 sync 留在真正需要时
  //（app/src/session/timeline/controller.tsx:301）。
  useEffect(() => {
    resetPendingRequests()
  }, [routeSessionId, resetPendingRequests])

  useEffect(() => {
    if (!routeSessionId) return

    // 首屏还没落地：先让消息占满带宽（idle / loading 直接返回）。
    if (loadState !== 'loaded' && loadState !== 'error') return

    let cancelled = false
    let cancelBindingScan: (() => void) | null = null

    async function restoreSessionRelations() {
      const sessionKey = routeSessionId!
      const knownChildren = childSessionStore.getChildSessionIds(sessionKey)
      // 子会话关系只能靠 REST 问清楚（列表和事件都不保证覆盖历史子会话）。
      // 但每个会话问一次就够：问过之后要么 store 里已有子会话，要么确认没有；
      // 之后新建的子会话会由 session.created 直接注册进来。
      //
      // 早先的做法是靠「消息里有没有 task 卡片 + 有没有更多历史」推断，
      // 那是有概率漏判的（导入的会话树、卡片在未加载的历史页）。
      // 记住「问过了」既省掉重复请求，又不依赖推断。
      const shouldQueryChildren = knownChildren.length === 0 && !childSessionStore.hasScannedChildren(sessionKey)

      if (shouldQueryChildren) {
        try {
          const children = await getSessionChildren(sessionKey, effectiveDirectory, paneServerId)
          if (cancelled) return
          for (const child of children) {
            childSessionStore.registerChildSession(child, paneServerId)
          }
          // 请求成功才落「已确认」：失败（离线、瞬时 5xx）下次进入还会再问
          childSessionStore.markChildrenScanned(sessionKey)
          // 父子关系刚由 REST 建立：此前因「不知道子会话归属」而只弹了 toast、
          // 被缓存下来的权限/表单请求，现在补投进 pane（否则要刷新页面才挂上）
          flushPendingRequests()
        } catch {
          // 获取子 session 失败不影响主流程
        }
      }

      if (cancelled) return

      // 完整的 session family（主 session + 所有子孙）
      const family = new Set(childSessionStore.getSessionAndDescendants(sessionKey))
      // family 是复合 key；API 返回的 sessionID 是原始 id，兼容两种形式比较
      const familyRaw = new Set([...family].map(k => splitSessionKey(k).sessionId))
      const matchesFamily = (rawSessionId: string) =>
        familyRaw.has(rawSessionId) || familyRaw.has(splitSessionKey(rawSessionId).sessionId)

      // 待处理请求：GET /permission 和 GET /question 返回全量数据，
      // 不传 sessionId 避免 N 次重复请求
      const [allPerms, allQuestions] = await Promise.all([
        getPendingPermissions(undefined, effectiveDirectory, paneServerId).catch(() => []),
        getPendingForms(undefined, effectiveDirectory, paneServerId).catch(() => []),
      ])

      if (cancelled) return

      // 只保留属于当前 session family 的请求。
      // OMO background subagents may publish permission.asked over SSE before
      // /permission can list it for this routed instance. Refresh 时序下子 session 关系
      // 可能尚未注册（family 不含子 session），因此 SSE 已知请求必须无条件保留，
      // 否则刷新后子任务的权限弹窗会被 family 过滤误删。
      // 本端已经处理掉的请求不得从旧快照里复活（见 usePermissionHandler 的 resolvedIdsRef）。
      const nextPerms = allPerms.filter(
        (p: ApiPermissionRequest) => matchesFamily(p.sessionID) && !isPermissionResolved(p.id),
      )
      setPendingPermissionRequests(prev => {
        const merged = new Map(nextPerms.map((p: ApiPermissionRequest) => [p.id, p]))
        for (const request of prev) {
          if (isPermissionResolved(request.id)) continue
          if (!merged.has(request.id)) merged.set(request.id, request)
        }
        return Array.from(merged.values())
      })
      setPendingQuestionRequests(prev => {
        const merged = new Map(
          allQuestions.filter((q: ApiFormInfo) => matchesFamily(q.sessionID)).map((q: ApiFormInfo) => [q.id, q]),
        )
        for (const q of prev) {
          if (!merged.has(q.id)) merged.set(q.id, q)
        }
        return Array.from(merged.values())
      })

      if (cancelled) return

      // 刷新/重进后运行中的 task 卡片 metadata 里没有 sessionID（progress 不落库）：
      // 先一对一同步直绑，剩下的用 input.prompt 与子 session 首条用户消息
      // 逐字比对精确绑定（在线时由 tool.progress 的 metadata.sessionID 精确下发，
      // 这里是离线恢复通道——绝不用 agent/title 做概率性配对，会挂错会话）。
      //
      // 这一步最多发 12 次 message.list，纯恢复性质：放到空闲时，别和用户
      // 紧接着的操作抢连接。
      cancelBindingScan = scheduleIdle(() => {
        if (cancelled) return
        sweepTaskChildBindings(paneServerId, sessionKey)
        void verifyTaskChildBindings(paneServerId, sessionKey, async childKey => {
          try {
            const childMessages = await getSessionMessages(childKey, undefined, undefined, paneServerId)
            const firstUser = childMessages.find(m => m.type === 'user')
            return firstUser?.type === 'user' ? firstUser.text : undefined
          } catch {
            return undefined
          }
        })
      })
    }

    void restoreSessionRelations()

    return () => {
      cancelled = true
      cancelBindingScan?.()
    }
  }, [
    routeSessionId,
    loadState,
    effectiveDirectory,
    paneServerId,
    resetPendingRequests,
    setPendingPermissionRequests,
    setPendingQuestionRequests,
    isPermissionResolved,
  ])

  const sendMessageNow = useCallback(
    async (input: {
      sessionId?: string | null
      content: string
      attachments: Attachment[]
      directory: string
      model: { providerID: string; modelID: string }
      options?: { agent?: string; variant?: string }
      delivery?: 'queue' | 'steer'
      allowCreateSession?: boolean
    }) => {
      let sessionId = input.sessionId ?? routeSessionId

      if (sessionId && input.allowCreateSession) {
        const state = messageStore.getSessionState(sessionId)
        if (state?.loadState === 'error' && state.messages.length === 0) {
          clearSessionRuntimeState(sessionId)
          sessionId = null
        }
      }

      let rollbackSnapshot = sessionId ? messageStore.createSendRollbackSnapshot(sessionId) : null

      try {
        if (!sessionId) {
          if (!input.allowCreateSession) return false
          // context 的 createSession 会带上当前目录（normalizeToForwardSlash(currentDirectory)）
          const newSession = await createSession()
          sessionId = newSession.id
          navigateToSession(sessionId, newSession.location?.directory)
        }

        if (rollbackSnapshot) {
          messageStore.truncateAfterRevert(sessionId)
        }

        // 乐观上屏（官方 data.ts:1539-1575 同款）：客户端铸造消息 id 并立即
        // 插入本地用户消息，POST 时把同一 id 交给服务端 —— durable 行与乐观行
        // 同 id 对账，inbox.enqueued 回声 upsert 补齐 files/skills。
        // 不等 POST、不等 SSE，用户消息即时可见。
        const messageId = createMessageId()
        // fresh 判定（官方 data.ts:1550-1552）：只对新 id 乐观准入，
        // 重试复用已渲染/已确认 id 时不得重插，也不得回滚已确认状态
        const fresh =
          !(messageStore.getSessionState(sessionId)?.messages.some(message => message.id === messageId) ?? false) &&
          !inboxStore.getItems(sessionId).some(item => item.id === messageId)
        if (fresh) {
          outboxAdd(messageId)
          // 先 admit 本地 inbox 条目（官方 admitLocal）：队列气泡一步到位，
          // 不会先闪一下实心用户气泡。inboxID 与乐观消息 id 同值——服务端
          // 回声、durable 行、投影三者靠它对齐。
          if (input.delivery) {
            admitLocalInboxItem(sessionId, {
              inboxId: messageId,
              text: input.content,
              delivery: input.delivery,
              attachments: input.attachments,
              agent: input.options?.agent,
            })
          }
          messageStore.upsertLocalMessage(
            sessionId,
            buildLocalQueuedMessage({
              sessionId,
              messageId,
              text: input.content,
              attachments: input.attachments,
              agent: input.options?.agent,
              model: { ...input.model, variant: input.options?.variant },
              createdAt: Date.now(),
            }),
          )
        }

        // 记录发送前的消息数量，作为判断 SSE 是否推送新消息的基线
        const msgCountBeforeSend = messageStore.getSessionState(sessionId)?.messages.length ?? 0

        // 不要在 send 前 setStreaming：新 user 往往还没入列，过程折叠会把
        // 「上一轮已收工」误判成最新 Working 再展开，造成一闪。
        // streaming 在 send 成功后、或 SSE 推到 assistant 时再打开。
        const admittedSessionId = sessionId
        // 发送载荷提取成函数：失败后要按原样幂等重试一次
        const postAdmission = () =>
          sendAdmission(admittedSessionId, () =>
            sendMessageAsync(
              {
                sessionId: admittedSessionId,
                id: messageId,
                text: input.content,
                attachments: input.attachments,
                model: input.model,
                agent: input.options?.agent,
                variant: input.options?.variant,
                delivery: input.delivery,
                directory: input.directory,
              },
              paneServerId,
            ),
          )
        try {
          // 同会话发送串行化（官方 sendAdmission）：等待上一次 POST 落定，
          // 避免 switchModel/switchAgent/prompt 与另一次发送交错
          await postAdmission()
        } catch {
          // 幂等自动重试一次（官方 composer submit.ts 同款）：消息 ID 由
          // 客户端铸造、服务端按 ID 幂等入场，同 payload 重试不会重复。
          // 覆盖「请求已到服务端、响应在断网中丢失」的假象失败——不重试
          // 直接回滚会把服务端已收到的消息撤掉，用户重发后变成重复消息。
          try {
            await postAdmission()
          } catch (error) {
            // 官方同款回滚守卫（data.ts:1578-1583）：只撤本次乐观插入、且
            // 服务端尚未确认的行；回声已到达的行属于服务端状态，绝不能撤
            if (fresh && outboxTryRollback(messageId)) {
              messageStore.removeMessage(sessionId, messageId)
              if (input.delivery) inboxStore.removeItem(sessionId, messageId)
            }
            throw error
          }
        }

        messageStore.setStreaming(sessionId, true)

        // 兜底：等待短暂时间后检查 SSE 是否已推送用户消息，
        // 若未收到则主动拉取补齐，避免 SSE 断流导致用户消息不显示
        const pullSessionId = sessionId
        const pullDir = input.directory
        setTimeout(() => {
          const state = messageStore.getSessionState(pullSessionId)
          if (!state) return
          // 消息数量增加了，说明 SSE 已正常推送
          if (state.messages.length > msgCountBeforeSend) return

          getSessionMessages(pullSessionId, 5, pullDir, paneServerId)
            .then(apiMessages => {
              // v2 的消息自带 content（没有独立的 part 事件），
              // 因此整条替换即可，content 由投影层转成 UI parts。
              for (const msg of apiMessages) {
                messageStore.handleMessageUpdated(msg, pullSessionId)
              }
            })
            .catch(() => {
              // 拉取失败不影响主流程，SSE 重连后仍可补齐
            })
        }, 1500)

        return true
      } catch (error) {
        handleError('send message', error)
        // 用户可见反馈（修复「吞消息」无感知问题）：乐观气泡被回滚后
        // 必须有明确提示，否则用户看到的就是"消息发了又消失"。
        // 输入框草稿本就在失败时保留，用户可直接重发。
        notificationStore.push(
          'error',
          i18n.t('chat:inputArea.sendFailed'),
          error instanceof Error && error.message ? error.message : i18n.t('chat:inputArea.sendFailedHint'),
          sessionId ?? '',
          input.directory,
        )
        if (sessionId) {
          if (rollbackSnapshot) {
            messageStore.restoreSendRollback(sessionId, rollbackSnapshot)
            rollbackSnapshot = null
          } else {
            messageStore.setStreaming(sessionId, false)
          }
        }

        return false
      }
    },
    [routeSessionId, navigateToSession, createSession, paneServerId, buildLocalQueuedMessage, admitLocalInboxItem],
  )

  // Send message handler
  const handleSend = useCallback(
    async (content: string, attachments: Attachment[], options?: { agent?: string; variant?: string }) => {
      if (!currentModel) {
        handleError('send message', new Error('No model selected'))
        return false
      }

      // 队列编辑确认（官方 confirmEdit 同款）：发送走的是「替换提交」，
      // 不是新 prompt——admit 替换条目（新 id）→ cancel 原条目 →
      // rewrite 放回原来的位置；内容与原文一致则视为未修改，仅取消编辑
      const editing = queueEditing
      if (editing && routeSessionId) {
        const original = editing.item
        const originalAttachments = queuedPromptAttachments(original)
        const pristine =
          content.trim() === queuedPromptText(original).trim() && attachments.length === originalAttachments.length
        if (pristine && original.delivery === 'queue') {
          setQueueEditing(null)
          setStashRestoreNonce(Date.now())
          return true
        }
        try {
          // 投影先行（官方 rows() 同款）：mutation 期间队列直接显示
          // 期望形态，服务端 admit/cancel 事件落地时无视觉跳变
          setQueueMutation({
            expected: queuedPrompts.map(entry =>
              entry.id === original.id ? content : queuedPromptText(entry),
            ),
          })
          const edited = buildEditedPromptInput({
            sessionId: routeSessionId,
            text: content,
            attachments,
            original,
            delivery: original.delivery,
            request: buildPromptParts(attachments),
          })
          await confirmQueueEdit({
            sessionId: routeSessionId,
            original,
            edited,
            queueIds: queuedPrompts.map(entry => entry.id),
            serverId: paneServerId,
          })
          setQueueEditing(null)
          return true
        } catch (error) {
          setQueueMutation(null)
          handleError('confirm queue edit', error)
          return false
        }
      }

      // 投递方式（官方 queue.ts:217 同款）：busy 时按输入栏当前选择排队或插队，
      // idle 时不传走服务端默认（steer 立即处理）。排队条目由服务端在当前
      // 回合排空后自动投递，无需客户端排空逻辑。
      const delivery = routeSessionId && isSessionBusy ? busyDelivery : undefined

      return sendMessageNow({
        sessionId: routeSessionId,
        content,
        attachments,
        model: {
          providerID: currentModel.providerID,
          modelID: currentModel.id,
        },
        options,
        delivery,
        directory: effectiveDirectory || '',
        allowCreateSession: true,
      })
    },
    [
      currentModel,
      routeSessionId,
      busyDelivery,
      isSessionBusy,
      effectiveDirectory,
      sendMessageNow,
      queueEditing,
      queuedPrompts,
      paneServerId,
    ],
  )

  // New chat handler
  const handleNewChat = useCallback(() => {
    if (routeSessionId) {
      inboxStore.clearSession(routeSessionId)
      if (!hasOtherConsumerForSession(routeSessionId, paneId)) {
        messageStore.clearSession(routeSessionId)
      }
    }
    resetPermissions()
    resetPendingRequests()
  }, [routeSessionId, paneId, resetPermissions, resetPendingRequests])

  // inbox 快照打底（官方 pending.sync）：进入会话与 SSE 重连时各拉一次，之后靠 SSE 增量维护。
  // 快照里的排队条目也要物化进转写（官方 data.ts:1427-1430）——服务端转写里
  // 投递前并没有这些行，不物化的话刷新后它们只在队列气泡里、投递时无处可落。
  // 快照合并（官方 pendingUpdates + inflight 同款）：拉取期间到达的事件先记账
  // 再合并；本地已 admit、回声未确认（outbox 在途）的条目必须保留——快照可能
  // 早于 admit 发出，直接整体替换会把它们抹掉（气泡消失 + 回滚失效）。
  // 重连复刷（官方 session-resolution「queued inputs ride along」同款）：
  // 断连期间的 inbox 增删事件已丢失，不补拉就会一直显示断连前的队列。
  const syncInboxSnapshot = useCallback(
    (sessionId: string) => {
      inboxStore.beginSnapshot(sessionId)
      return getSessionInbox(sessionId, paneServerId)
        .then(items => {
          inboxStore.setItems(sessionId, items, { keepIf: id => outboxHas(id) })
          for (const item of inboxStore.getItems(sessionId)) messageStore.materializeInboxMessage(sessionId, item)
        })
        .catch(() => {
          // 拉取失败不影响主流程，SSE 事件仍会增量维护
          inboxStore.endSnapshot(sessionId)
        })
    },
    [paneServerId],
  )
  const syncInboxSnapshotRef = useRef(syncInboxSnapshot)
  syncInboxSnapshotRef.current = syncInboxSnapshot

  useEffect(() => {
    if (!routeSessionId) return
    void syncInboxSnapshot(routeSessionId)
  }, [routeSessionId, syncInboxSnapshot])

  // 取消排队条目（官方 queue.remove：回声会把转写里的用户消息一并撤下）
  const handleCancelQueuedPrompt = useCallback(
    (inboxID: string) => {
      if (!routeSessionId) return
      cancelInboxItem(routeSessionId, inboxID, paneServerId).catch(error =>
        handleError('cancel queued prompt', error),
      )
    },
    [routeSessionId, paneServerId],
  )

  // 排队条目插队（官方 queue.steer：inbox.update delivery=steer）
  const handleSteerQueuedPrompt = useCallback(
    (item: QueuedUserPrompt) => {
      if (!routeSessionId) return
      updateInboxDelivery(routeSessionId, item.id, 'steer', paneServerId).catch(error =>
        handleError('steer queued prompt', error),
      )
    },
    [routeSessionId, paneServerId],
  )

  // 装载队列条目到编辑器（官方 queue.edit 同款）：
  // 不取消服务端条目，只把文本+附件注入编辑器并暂存当前输入；
  // 确认时走「替换提交」（handleSend 的 editing 分支）
  const handleEditQueuedPrompt = useCallback((item: QueuedUserPrompt) => {
    setQueueEditing({ item, nonce: Date.now() })
  }, [])

  // 取消队列编辑（官方 cancelEdit 同款）：恢复输入框暂存
  const handleCancelQueueEdit = useCallback(() => {
    setQueueEditing(null)
    setStashRestoreNonce(Date.now())
  }, [])

  // 队列条目消失（被投递/取消）时自动退出编辑态（官方 createEffect 同款）
  useEffect(() => {
    if (!queueEditing) return
    if (inboxUserPrompts.some(item => item.id === queueEditing.item.id)) return
    setQueueEditing(null)
  }, [queueEditing, inboxUserPrompts])

  // composerDraft：编辑器注入内容（装载=编辑草稿 / 恢复=取消后的暂存）
  const composerDraft = useMemo(() => {
    if (queueEditing) {
      return {
        content: {
          text: queuedPromptText(queueEditing.item),
          attachments: queuedPromptAttachments(queueEditing.item),
        },
        nonce: queueEditing.nonce,
        restoreStash: false,
      }
    }
    if (stashRestoreNonce > 0) {
      return { content: null, nonce: stashRestoreNonce, restoreStash: true }
    }
    return null
  }, [queueEditing, stashRestoreNonce])

  // 队列重排（官方 queue.reorder 同款）：inbox 没有重排端点，
  // 用 rewriteQueueOrder（后缀重写）保序替换；投影先行避免事件落地抖动
  const handleReorderQueuedPrompts = useCallback(
    (inboxIDs: string[]) => {
      if (!routeSessionId) return
      // 期望的最终文本序列（投影先行：重写换 id 期间数量/顺序恒定）
      const byId = new Map(queuedPrompts.map(entry => [entry.id, entry]))
      const expected = inboxIDs.flatMap(id => {
        const entry = byId.get(id)
        return entry ? [queuedPromptText(entry)] : []
      })
      if (expected.length === inboxIDs.length) setQueueMutation({ expected })
      rewriteQueueOrder(routeSessionId, inboxIDs, paneServerId).catch(error => {
        setQueueMutation(null)
        handleError('reorder queued prompts', error)
      })
    },
    [routeSessionId, paneServerId, queuedPrompts],
  )

  // 队列 mutation 落地即清除投影；超时兜底防悬挂
  useEffect(() => {
    if (!queueMutation) return
    if (!queueMutationSettled(queuedPrompts, queueMutation)) return
    setQueueMutation(null)
  }, [queueMutation, queuedPrompts])
  useEffect(() => {
    if (!queueMutation) return
    const timer = setTimeout(() => setQueueMutation(null), 10_000)
    return () => clearTimeout(timer)
  }, [queueMutation])

  // `!` shell 命令（官方 composer shell mode）：无会话时先建会话再执行，
  // shell 消息经 session.shell.started/ended 事件流入转写，无需本地乐观插入
  const handleShellCommand = useCallback(
    async (command: string) => {
      let sessionId = routeSessionId
      try {
        const isNewSession = !sessionId
        if (!sessionId) {
          const newSession = await createSession()
          sessionId = newSession.id
          navigateToSession(sessionId, newSession.location?.directory)
        }
        await executeSessionShell(sessionId, command, paneServerId)

        if (isNewSession) {
          // 新会话竞态：navigate 触发的 loadSession 快照可能取在 shell 消息
          // 落库之前，随后的 setMessages 会把事件插入的 shell 消息抹掉。
          // 延迟补拉一次兜底（与 sendMessageNow 的 fallback 同款）。
          const pullSessionId = sessionId
          setTimeout(() => {
            getSessionMessages(pullSessionId, 5, undefined, paneServerId)
              .then(msgs => {
                for (const msg of msgs) {
                  messageStore.handleMessageUpdated(msg, pullSessionId)
                }
              })
              .catch(() => {
                // 拉取失败不影响主流程，SSE 重连后仍可补齐
              })
          }, 1500)
        }
        return true
      } catch (error) {
        handleError('run shell command', error)
        return false
      }
    },
    [routeSessionId, createSession, navigateToSession, paneServerId],
  )

  const handleForkMessage = useCallback(
    async (message: SessionMessageInfo, forkMessageId?: string) => {
      if (!routeSessionId) return
      const targetMessageId = forkMessageId || message.id

      try {
        if (isAssistantMessage(message)) {
          // 后端 fork 语义：messageID 指定的消息**不包含**在新 session 里。
          // 要保留这条 assistant 回复，需要传它之后的下一条用户消息 ID；
          // 如果它已经是最末尾，不传 messageID，fork 整个 session。
          const currentMessages = messagesRef.current
          const idx = currentMessages.findIndex(m => m.id === targetMessageId)
          let forkAtMessageId: string | undefined
          if (idx >= 0) {
            for (let i = idx + 1; i < currentMessages.length; i++) {
              const candidate = currentMessages[i]
              if (isUserMessage(candidate)) {
                forkAtMessageId = candidate.id
                break
              }
            }
          }
          const forkedSession = await forkSession(routeSessionId, forkAtMessageId, effectiveDirectory, paneServerId)
          setRestoredContent(null)
          navigateToSession(forkedSession.id, forkedSession.location?.directory)
          return
        }

        // compaction 分叉：新 session 包含这条压缩消息（即带着压缩后的上下文继续），
        // 边界传它之后的第一条消息；已是末尾则不传，fork 整个 session。
        if (message.type === 'compaction') {
          const currentMessages = messagesRef.current
          const idx = currentMessages.findIndex(m => m.id === targetMessageId)
          const forkAtMessageId = idx >= 0 ? currentMessages[idx + 1]?.id : undefined
          const forkedSession = await forkSession(routeSessionId, forkAtMessageId, effectiveDirectory, paneServerId)
          setRestoredContent(null)
          navigateToSession(forkedSession.id, forkedSession.location?.directory)
          return
        }

        if (!isUserMessage(message)) return

        // v2 的用户消息没有 model / agent（那是会话级状态），
        // 与 store 的 RevertHistoryItem 保持同一口径
        const sessionState = messageStore.getSessionState(routeSessionId)
        const sessionModel = sessionState?.model
        const restoredText = messageStore.extractUserText(message)
        const restoredAttachments = messageStore.extractUserAttachments(message)
        const forkedSession = await forkSession(routeSessionId, targetMessageId, effectiveDirectory, paneServerId)

        setRestoredContent({
          sessionId: forkedSession.id,
          content: {
            messageId: message.id,
            text: restoredText,
            attachments: restoredAttachments,
            model: sessionModel
              ? { providerID: sessionModel.providerID, modelID: sessionModel.id, variant: sessionModel.variant }
              : undefined,
            variant: sessionModel?.variant,
            agent: sessionState?.agent,
          },
        })

        navigateToSession(forkedSession.id, forkedSession.location?.directory)
      } catch (error) {
        handleError('fork session', error)
      }
    },
    [effectiveDirectory, navigateToSession, paneServerId, routeSessionId],
  )

  // Abort handler
  const handleAbort = useCallback(async () => {
    if (!routeSessionId) return
    try {
      const directory = sessionDirectory || currentDirectory
      await abortSession(routeSessionId, directory, paneServerId)
      messageStore.handleSessionIdle(routeSessionId)
    } catch (error) {
      handleError('abort session', error)
    }
  }, [routeSessionId, sessionDirectory, currentDirectory, paneServerId])

  // Command handler (slash commands)
  const handleCommand = useCallback(
    async (commandStr: string) => {
      // 解析命令："/help arg1 arg2" => command="help", args="arg1 arg2"
      const trimmed = commandStr.trim()
      const withoutSlash = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed
      const spaceIndex = withoutSlash.indexOf(' ')
      const command = spaceIndex > 0 ? withoutSlash.slice(0, spaceIndex) : withoutSlash
      const args = spaceIndex > 0 ? withoutSlash.slice(spaceIndex + 1) : ''

      if (!command) return false

      if (command === 'new') {
        navigateHome()
        handleNewChat()
        return true
      }

      // 客户端命令族（官方 use-session-commands 同款，不走后端 command 路由）：
      // undo/redo/fork/export 由本端处理
      if (command === 'undo') {
        if (!routeSessionId) return false
        const lastUser = [...messagesRef.current].reverse().find(isUserMessage)
        if (!lastUser) return false
        await handleUndo(lastUser.id)
        return true
      }

      if (command === 'redo') {
        if (!routeSessionId || !canRedo) return false
        await handleRedo()
        return true
      }

      if (command === 'fork') {
        if (!routeSessionId) return false
        // 不传 messageID = fork 整个会话（官方 session.fork 同款）
        const forkedSession = await forkSession(routeSessionId, undefined, effectiveDirectory, paneServerId)
        setRestoredContent(null)
        navigateToSession(forkedSession.id, forkedSession.location?.directory)
        return true
      }

      if (command === 'export') {
        if (!routeSessionId) return false
        // 官方 session.export 同款：{info, messages} 转写下载为 JSON
        // （文件名取 title/slug，官方 sessionExportFilename 同款清洗）
        const transfer = await exportSession(routeSessionId, effectiveDirectory, paneServerId)
        const state = messageStore.getSessionState(routeSessionId)
        const raw = state?.title || ''
        const name = raw.toLowerCase().replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '')
        saveData(
          new TextEncoder().encode(JSON.stringify(transfer, null, 2)),
          `${name || routeSessionId.split('::').pop()}.json`,
          'application/json',
        )
        return true
      }

      // /btw 侧问（官方 session/btw 同款）：打开侧问对话框；
      // 带参数时预填问题自动提问
      if (command === 'btw') {
        if (!routeSessionId) return false
        onBtwRequest?.(args || undefined)
        return true
      }

      let sessionId = routeSessionId

      try {
        if (sessionId) {
          const state = messageStore.getSessionState(sessionId)
          if (state?.loadState === 'error' && state.messages.length === 0) {
            clearSessionRuntimeState(sessionId)
            sessionId = null
          }
        }

        // Create session if needed (like handleSend does)
        if (!sessionId) {
          const newSession = await createSession()
          sessionId = newSession.id
          navigateToSession(sessionId, newSession.location?.directory)
        }

        if (command === 'compact') {
          if (!currentModel) {
            handleError('execute command', new Error('No model selected'))
            return false
          }

          // Commands should count as sent once they are accepted for execution.
          // Do not keep the draft alive until the long-running compaction finishes.
          void summarizeSession(
            sessionId,
            { providerID: currentModel.providerID, modelID: currentModel.id },
            effectiveDirectory,
            paneServerId,
          ).catch(err => {
            handleError('execute command', err)
          })

          return true
        }

        // Keep command submission semantics aligned with normal messages:
        // once the command is dispatched, clear the draft immediately.
        void executeCommand(sessionId, command, args, effectiveDirectory, paneServerId).catch(err => {
          handleError('execute command', err)
        })

        return true
      } catch (err) {
        handleError('execute command', err)
        return false
      }
    },
    [
      routeSessionId,
      effectiveDirectory,
      createSession,
      navigateToSession,
      currentModel,
      navigateHome,
      handleNewChat,
      paneServerId,
      handleUndo,
      handleRedo,
      canRedo,
      onBtwRequest,
    ],
  )

  // Undo with animation
  const handleUndoWithAnimation = useCallback(
    async (userMessageId: string) => {
      const currentMessages = messagesRef.current
      const messageIndex = currentMessages.findIndex(m => m.id === userMessageId)
      if (messageIndex === -1) return

      const messageIdsToRemove = currentMessages.slice(messageIndex).map(m => m.id)

      await animateUndo(messageIdsToRemove)
      await handleUndo(userMessageId)
    },
    [animateUndo, handleUndo],
  )

  // Redo with animation
  const handleRedoWithAnimation = useCallback(async () => {
    await animateRedo()
    await handleRedo()
  }, [animateRedo, handleRedo])

  // Session selection
  const handleSelectSession = useCallback(
    (session: ApiSession) => {
      navigateToSession(session.id, session.location?.directory)
    },
    [navigateToSession],
  )

  // New session
  const handleNewSession = useCallback(() => {
    navigateHome()
    handleNewChat()
  }, [navigateHome, handleNewChat])

  // Navigate to previous session
  const handlePreviousSession = useCallback(() => {
    if (!sessions.length) return
    const currentIndex = sessions.findIndex(s => s.id === routeSessionId)
    if (currentIndex > 0) {
      const target = sessions[currentIndex - 1]
      navigateToSession(target.id, target.location?.directory)
    } else if (currentIndex === -1 && sessions.length > 0) {
      // Not in any session, go to first
      navigateToSession(sessions[0].id, sessions[0].location?.directory)
    }
  }, [sessions, routeSessionId, navigateToSession])

  // Navigate to next session
  const handleNextSession = useCallback(() => {
    if (!sessions.length) return
    const currentIndex = sessions.findIndex(s => s.id === routeSessionId)
    if (currentIndex >= 0 && currentIndex < sessions.length - 1) {
      const target = sessions[currentIndex + 1]
      navigateToSession(target.id, target.location?.directory)
    }
  }, [sessions, routeSessionId, navigateToSession])

  // Toggle agent (cycle through primary agents only, matching toolbar display)
  const handleToggleAgent = useCallback(() => {
    const primaryAgents = agents.filter(a => a.mode !== 'subagent' && !a.hidden)
    if (primaryAgents.length <= 1) return
    const currentIndex = primaryAgents.findIndex(a => a.id === selectedAgent || a.name === selectedAgent)
    const nextIndex = (currentIndex + 1) % primaryAgents.length
    setSelectedAgent(primaryAgents[nextIndex].id)
  }, [agents, selectedAgent, setSelectedAgent])

  // 从消息中恢复 agent 选择（用于切换 session 时）
  const restoreAgentFromMessage = useCallback(
    (agentName: string | null | undefined) => {
      if (!agentName) return
      // 消息里的 agent 可能是 id 也可能是显示名，归一化为 id 再恢复
      const matched = agents.find(
        a => (a.id === agentName || a.name === agentName) && a.mode !== 'subagent' && !a.hidden,
      )
      if (matched) {
        setSelectedAgent(matched.id)
      }
    },
    [agents, setSelectedAgent],
  )

  // Copy last AI response to clipboard
  const handleCopyLastResponse = useCallback(async () => {
    const lastAssistant = [...messages].reverse().find(isAssistantMessage)
    if (!lastAssistant) return

    const text = assistantText(lastAssistant)
    if (text) {
      try {
        await copyTextToClipboard(text)
      } catch (err) {
        clipboardErrorHandler('copy last response', err)
      }
    }
  }, [messages])

  const clearRestoredContent = useCallback(() => {
    setRestoredContent(null)
    clearRevert()
  }, [clearRevert])

  const activeRestoredContent = useMemo(() => {
    if (!restoredContent || !routeSessionId) return null
    // restoredContent.sessionId 是 fork 接口返回的原始 id（ses_x），而 routeSessionId
    // 是带服务器前缀的复合 key（local::ses_x），直接全等比较永远不匹配，导致 fork 后
    // 输入框预填丢失。按原始 id 比较，对带前缀/不带前缀的 routeSessionId 都成立。
    if (restoredContent.sessionId !== splitSessionKey(routeSessionId).sessionId) return null
    return restoredContent.content
  }, [restoredContent, routeSessionId])

  return {
    // State
    messages,
    // UI 活跃态：对齐官方 webui 的 session_working（session.status busy/retry）
    // 不能只信 messageStore.isStreaming——多步 agent 间隙消息可能已 completed，但 session 仍 busy
    isStreaming: isSessionBusy,
    /** 消息级流式（不含 session.status）；一般 UI 用 isStreaming 即可 */
    messageIsStreaming: isStreaming,
    sessionDirectory,
    canUndo,
    canRedo,
    redoSteps,
    revertedContent,
    restoredContent: activeRestoredContent,
    loadState,
    loadError,
    sessionModel,
    hasMoreHistory,
    retryStatus,
    agents,
    selectedAgent,
    setSelectedAgent,
    routeSessionId,
    effectiveDirectory,

    // Permissions
    pendingPermissionRequests,
    pendingQuestionRequests,
    pendingWebsearchRequest,
    queuedPrompts,
    inboxUserPrompts,
    queuedCompactions,
    busyDelivery,
    setBusyDelivery,
    composerDraft,
    queueEditing,
    queueMutation,
    handleCancelQueueEdit,
    handleCancelQueuedPrompt,
    handleSteerQueuedPrompt,
    handleEditQueuedPrompt,
    handleReorderQueuedPrompts,
    handleShellCommand,
    handlePermissionReply,
    handleFormReply,
    handleFormCancel,
    isReplying,

    // Session management
    loadMoreHistory,
    handleRedoAll,
    clearRevert: clearRestoredContent,

    // Animation
    registerMessage,
    registerInputBox,

    // Handlers
    handleSend,
    handleAbort,
    handleCommand,
    handleUndoWithAnimation,
    handleRedoWithAnimation,
    handleForkMessage,
    handleSelectSession,
    handleNewSession,
    handleVisibleMessageIdsChange,
    handlePreviousSession,
    handleNextSession,
    handleToggleAgent,
    handleCopyLastResponse,
    restoreAgentFromMessage,
  }
}
