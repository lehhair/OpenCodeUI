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
} from '../hooks'
import { usePermissions, usePermissionHandler, useMessageAnimation, useDirectory, useSessionContext } from '../hooks'
import { useNotification } from './useNotification'
import { notificationEventSettingsStore } from '../store/notificationEventSettingsStore'
import {
  sendMessageAsync,
  getSessionMessages,
  abortSession,
  getSelectableAgents,
  getPendingPermissions,
  getPendingForms,
  prefetchCommands,
  prefetchRootDirectory,
  getSessionChildren,
  executeCommand,
  summarizeSession,
  forkSession,
  type ApiFormInfo,
  type ApiPermissionRequest,
  type ApiSession,
  type ApiAgent,
  type Attachment,
  type Model,
} from '../api'
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
import { clearSessionRuntimeState } from '../utils/sessionLifecycle'
import { serverStorage } from '../utils/perServerStorage'
import { sessionKeyToServerId, splitSessionKey } from '../utils/sessionKey'
import { createMessageId } from '../utils/identifier'
import { serverStore } from '../store/serverStore'
import { STORAGE_KEY_SELECTED_AGENT } from '../constants'
import type { ChatAreaHandle } from '../features/chat'
import { followupQueueStore, useFollowupQueue } from '../store/followupQueueStore'
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
} as const

interface UseChatSessionOptions {
  paneId: string
  chatAreaRef: React.RefObject<ChatAreaHandle | null>
  currentModel: Model | undefined
  refetchModels: () => Promise<void>
  sessionId: string | null
  navigateToSession: (sessionId: string, directory?: string) => void
  navigateHome: () => void
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
}: UseChatSessionOptions) {
  const { statusMap } = useActiveSessionStore()
  const { queueFollowupMessages } = useSyncExternalStore(themeStore.subscribe, themeStore.getSnapshot)

  // Agents
  const [agents, setAgents] = useState<ApiAgent[]>([])
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

  const handleMissingRouteSession = useCallback(
    (missingSessionId: string) => {
      if (routeSessionIdRef.current !== missingSessionId) return
      clearSessionRuntimeState(missingSessionId)
      navigateHome()
    },
    [navigateHome],
  )

  const {
    items: queuedFollowups,
    sendingId: queuedFollowupSendingId,
    failedId: queuedFollowupFailedId,
  } = useFollowupQueue(routeSessionId)

  const perSessionStateRaw = useSessionState(routeSessionId)
  const perSessionState = perSessionStateRaw ?? EMPTY_SESSION_STATE

  const messages = perSessionState.messages
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  const isStreaming = perSessionState.isStreaming
  const sessionDirectory = perSessionState.directory
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
      if (session?.title) return session.title
      if (sessionId) return `Session ${sessionId.slice(0, 6)}`
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
    pendingQuestionRequests,
    setPendingPermissionRequests,
    setPendingQuestionRequests,
    handlePermissionReply,
    handleFormReply,
    handleFormCancel,
    refreshPendingRequests,
    resetPendingRequests,
    isReplying,
  } = usePermissionHandler(paneServerId)

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

  // ============================================
  // SSE 事件回调（permission / question / scroll / idle / error / reconnect）
  // 每个 pane 都注册自己的 consumer，由 App 顶层统一建立 SSE 连接
  // ============================================
  const sseCallbacks = useMemo(
    () => ({
      onPermissionAsked: (request: import('../api').ApiPermissionRequest) => {
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

        // 页面不在前台时通知用户有权限请求等待批准
        const permDesc = request.resources?.length ? `${request.action}: ${request.resources[0]}` : request.action
        const title = buildNotificationTitle(request.sessionID, 'Permission Required')
        if (notificationEventSettingsStore.isSystemEnabled('permission')) {
          sendNotification(title, permDesc, {
            sessionId: request.sessionID,
            directory: effectiveDirectory,
          })
        }
        // 应用内 toast 已在 useGlobalEvents 中统一处理
      },
      onPermissionReplied: (data: { sessionID: string; requestID: string }) => {
        setPendingPermissionRequests(prev =>
          prev.some(r => r.id === data.requestID) ? prev.filter(r => r.id !== data.requestID) : prev,
        )
      },
      onFormCreated: (form: ApiFormInfo) => {
        setPendingQuestionRequests(prev => {
          if (prev.some(r => r.id === form.id)) return prev
          return [...prev, form]
        })

        // 页面不在前台时通知用户有表单等待回答
        const questionDesc = form.title || 'AI is waiting for your input'
        const title = buildNotificationTitle(form.sessionID, 'Question')
        if (notificationEventSettingsStore.isSystemEnabled('question')) {
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

        // SSE 重连后重新加载当前会话，补齐断连期间可能丢失的消息
        if (routeSessionId) {
          // 使用 force 模式，确保覆盖本地可能不完整的数据
          loadSession(routeSessionId, { force: true })
          // 重连后刷新待处理的权限请求和问题，避免用户错过后台产生的请求
          refreshPendingRequests(sessionFamily, effectiveDirectory)
        }
        refetchModels().catch(() => {})
        // 重新获取 agents 列表（切换后端时 currentDirectory 可能没变，useEffect 不会触发）
        getSelectableAgents(currentDirectory, paneServerId)
          .then(setAgents)
          .catch(() => {})
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
      loadSession,
      refreshPendingRequests,
      refetchModels,
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

  // Load agents
  useEffect(() => {
    getSelectableAgents(currentDirectory, paneServerId)
      .then(setAgents)
      .catch(err => handleError('fetch agents', err))
  }, [currentDirectory, paneServerId])

  // Preload @ root directory and / commands for current session directory
  useEffect(() => {
    if (!routeSessionId || !effectiveDirectory) return

    prefetchRootDirectory(effectiveDirectory, paneServerId).catch(() => {})
    prefetchCommands(effectiveDirectory, paneServerId).catch(() => {})
  }, [routeSessionId, effectiveDirectory, paneServerId])

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

  // Load child sessions and pending permissions on session change
  // 页面刷新时 childSessionStore 是空的，需要先从 API 恢复子 session 关系
  // 然后再加载权限请求（包括子 session 的权限）
  // 切换 session 时同样要清空旧 session 的 pending 权限/问题，否则 A 会话的请求会残留在 B 会话
  useEffect(() => {
    resetPendingRequests()
    if (!routeSessionId) {
      return
    }

    let cancelled = false

    async function loadChildSessionsAndPermissions() {
      // Step 1: 恢复子 session 关系（如果 store 中还没有）
      const existingChildren = childSessionStore.getChildSessionIds(routeSessionId!)
      if (existingChildren.length === 0) {
        try {
          const children = await getSessionChildren(routeSessionId!, effectiveDirectory, paneServerId)
          if (cancelled) return
          // 注册所有子 session 到 store
          for (const child of children) {
            childSessionStore.registerChildSession(child, paneServerId)
          }
        } catch {
          // 获取子 session 失败不影响主流程
        }
      }

      if (cancelled) return

      // Step 2: 获取完整的 session family（主 session + 所有子孙）
      const family = new Set(childSessionStore.getSessionAndDescendants(routeSessionId!))
      // family 是复合 key；API 返回的 sessionID 是原始 id，兼容两种形式比较
      const familyRaw = new Set([...family].map(k => splitSessionKey(k).sessionId))
      const matchesFamily = (rawSessionId: string) =>
        familyRaw.has(rawSessionId) || familyRaw.has(splitSessionKey(rawSessionId).sessionId)

      // Step 3: 获取所有待处理请求，然后用 family 过滤
      // GET /permission 和 GET /question 返回全量数据，不传 sessionId 避免 N 次重复请求
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
      const nextPerms = allPerms.filter((p: ApiPermissionRequest) => matchesFamily(p.sessionID))
      setPendingPermissionRequests(prev => {
        const merged = new Map(nextPerms.map((p: ApiPermissionRequest) => [p.id, p]))
        for (const request of prev) {
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
    }

    loadChildSessionsAndPermissions()

    return () => {
      cancelled = true
    }
  }, [
    routeSessionId,
    effectiveDirectory,
    paneServerId,
    resetPendingRequests,
    setPendingPermissionRequests,
    setPendingQuestionRequests,
  ])

  const sendMessageNow = useCallback(
    async (input: {
      sessionId?: string | null
      content: string
      attachments: Attachment[]
      directory: string
      model: { providerID: string; modelID: string }
      options?: { agent?: string; variant?: string }
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

        // 记录发送前的消息数量，作为判断 SSE 是否推送新消息的基线
        const msgCountBeforeSend = messageStore.getSessionState(sessionId)?.messages.length ?? 0

        // 不要在 send 前 setStreaming：新 user 往往还没入列，过程折叠会把
        // 「上一轮已收工」误判成最新 Working 再展开，造成一闪。
        // streaming 在 send 成功后、或 SSE 推到 assistant 时再打开。
        try {
          await sendMessageAsync(
            {
              sessionId,
              id: messageId,
              text: input.content,
              attachments: input.attachments,
              model: input.model,
              agent: input.options?.agent,
              variant: input.options?.variant,
              directory: input.directory,
            },
            paneServerId,
          )
        } catch (error) {
          // 官方同款回滚：POST 失败只撤掉本次乐观插入、服务端未确认的行
          messageStore.removeMessage(sessionId, messageId)
          throw error
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
    [routeSessionId, navigateToSession, createSession, paneServerId, buildLocalQueuedMessage],
  )

  // Send message handler
  const handleSend = useCallback(
    async (content: string, attachments: Attachment[], options?: { agent?: string; variant?: string }) => {
      if (!currentModel) {
        handleError('send message', new Error('No model selected'))
        return false
      }

      // 如果队列头有失败项，用户重新发送时先清掉失败项（内容已恢复到输入框）
      if (routeSessionId && queuedFollowupFailedId) {
        followupQueueStore.remove(routeSessionId, queuedFollowupFailedId)
      }

      const shouldQueueFollowup =
        !!routeSessionId && (queuedFollowups.length > 0 || (queueFollowupMessages && isSessionBusy))

      if (shouldQueueFollowup) {
        const queued = followupQueueStore.enqueue({
          sessionId: routeSessionId,
          directory: effectiveDirectory || '',
          text: content,
          attachments,
          model: {
            providerID: currentModel.providerID,
            modelID: currentModel.id,
            variant: options?.variant,
          },
          variant: options?.variant,
          agent: options?.agent,
        })
        messageStore.upsertLocalMessage(
          queued.sessionId,
          buildLocalQueuedMessage({
            sessionId: queued.sessionId,
            messageId: queued.id,
            text: queued.text,
            attachments: queued.attachments,
            agent: queued.agent,
            model: queued.model,
            createdAt: queued.createdAt,
          }),
        )
        return true
      }

      return sendMessageNow({
        sessionId: routeSessionId,
        content,
        attachments,
        model: {
          providerID: currentModel.providerID,
          modelID: currentModel.id,
        },
        options,
        directory: effectiveDirectory || '',
        allowCreateSession: true,
      })
    },
    [
      currentModel,
      routeSessionId,
      queuedFollowups.length,
      queuedFollowupFailedId,
      queueFollowupMessages,
      isSessionBusy,
      effectiveDirectory,
      buildLocalQueuedMessage,
      sendMessageNow,
    ],
  )

  const sendQueuedFollowup = useCallback(
    async (draftId: string, sessionId: string) => {
      const draft = followupQueueStore.getItem(sessionId, draftId)
      if (!draft) return false
      if (!followupQueueStore.startSending(draft.sessionId, draft.id)) return false

      // 发送前先移除占位消息，让 sendMessageNow 走和正常发送完全一样的路径
      messageStore.removeMessage(draft.sessionId, draft.id)

      const ok = await sendMessageNow({
        sessionId: draft.sessionId,
        content: draft.text,
        attachments: draft.attachments,
        model: {
          providerID: draft.model.providerID,
          modelID: draft.model.modelID,
        },
        options: {
          agent: draft.agent,
          variant: draft.variant,
        },
        directory: draft.directory,
      })

      followupQueueStore.finishSending(draft.sessionId, draft.id)

      if (ok) {
        followupQueueStore.remove(draft.sessionId, draft.id)
      } else {
        // 标记失败，阻塞后续队列项
        followupQueueStore.markFailed(draft.sessionId, draft.id)
        // 移除剩余排队消息的本地占位，恢复队头到输入框
        const remaining = followupQueueStore.getItems(draft.sessionId)
        for (const item of remaining) {
          messageStore.removeMessage(draft.sessionId, item.id)
        }
        setRestoredContent({
          sessionId: draft.sessionId,
          content: {
            messageId: draft.id,
            text: draft.text,
            attachments: draft.attachments,
            model: draft.model,
            variant: draft.variant ?? draft.model.variant,
            agent: draft.agent,
          },
        })
      }

      return ok
    },
    [sendMessageNow],
  )

  useEffect(() => {
    if (!routeSessionId) return

    const nextQueued = queuedFollowups[0]
    if (!nextQueued) return
    if (queuedFollowupSendingId) return
    if (queuedFollowupFailedId) return
    if (isSessionBusy) return

    void sendQueuedFollowup(nextQueued.id, routeSessionId)
  }, [
    routeSessionId,
    queuedFollowups,
    queuedFollowupSendingId,
    queuedFollowupFailedId,
    isSessionBusy,
    sendQueuedFollowup,
  ])

  // New chat handler
  const handleNewChat = useCallback(() => {
    if (routeSessionId) {
      followupQueueStore.clearSession(routeSessionId)
      if (!hasOtherConsumerForSession(routeSessionId, paneId)) {
        messageStore.clearSession(routeSessionId)
      }
    }
    resetPermissions()
    resetPendingRequests()
  }, [routeSessionId, paneId, resetPermissions, resetPendingRequests])

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
    if (!restoredContent || restoredContent.sessionId !== routeSessionId) return null
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
    queuedFollowups,
    queuedFollowupSendingId,
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
