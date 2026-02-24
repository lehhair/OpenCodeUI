// ============================================
// useSessionManager - Session 加载和状态管理
// ============================================
// 
// 职责：
// 1. 加载 session 消息（初始加载 + 懒加载历史）
// 2. 处理 undo/redo（调用 API + 更新 store）
// 3. 同步路由和 store 的 currentSessionId

import { useCallback, useEffect, useRef } from 'react'
import { messageStore, type RevertState, type SessionState } from '../store'
import {
  getSessionMessages,
  getSession,
  revertMessage,
  unrevertSession,
  extractUserMessageContent,
  type ApiUserMessage,
  type ApiMessageWithParts,
} from '../api'
import { sessionErrorHandler } from '../utils'
import { INITIAL_MESSAGE_LIMIT, HISTORY_LOAD_BATCH_SIZE, MAX_HISTORY_MESSAGES } from '../constants'

interface UseSessionManagerOptions {
  sessionId: string | null
  directory?: string  // 当前项目目录
  onLoadComplete?: () => void
  onError?: (error: Error) => void
}

function mergeWithLocalStreamingMessages(
  apiMessages: ApiMessageWithParts[],
  localState?: SessionState
): ApiMessageWithParts[] {
  if (!localState?.isStreaming || localState.messages.length === 0) return apiMessages

  const apiIds = new Set(apiMessages.map(m => m.info.id))
  const localOnly = localState.messages
    .filter(m => !apiIds.has(m.info.id))
    .map(m => ({ info: m.info as any, parts: m.parts as any[] })) as ApiMessageWithParts[]

  if (localOnly.length === 0) return apiMessages

  return [...apiMessages, ...localOnly].sort((a, b) => {
    const aCreated = a.info.time?.created ?? 0
    const bCreated = b.info.time?.created ?? 0
    return aCreated - bCreated
  })
}

function serializeApiMessageIds(messages: ApiMessageWithParts[]): string {
  return JSON.stringify(messages.map(m => m.info.id))
}

function getStateMessageIds(state: SessionState): string[] {
  return state.messages.map(m => m.info.id)
}

function serializeStateMessageIds(state: SessionState): string {
  return JSON.stringify(getStateMessageIds(state))
}

export function useSessionManager({
  sessionId,
  directory,
  onLoadComplete,
  onError,
}: UseSessionManagerOptions) {
  const loadSequenceRef = useRef<Map<string, number>>(new Map())
  const historyLimitRef = useRef<Map<string, number>>(new Map())
  const historyJsonRef = useRef<Map<string, string>>(new Map())
  const loadSessionRef = useRef<(sid: string, options?: { force?: boolean }) => Promise<void>>(async () => {})
  
  // 使用 ref 保存 directory，避免依赖变化
  const directoryRef = useRef(directory)
  directoryRef.current = directory

  // ============================================
  // Load Session
  // ============================================

  const loadSession = useCallback(async (sid: string, options?: { force?: boolean }) => {
    const force = options?.force ?? false

    const seq = (loadSequenceRef.current.get(sid) ?? 0) + 1
    loadSequenceRef.current.set(sid, seq)
    const isStale = () => loadSequenceRef.current.get(sid) !== seq

    const dir = directoryRef.current

    // 检查是否已有消息（SSE 可能已经推送了）
    const existingState = messageStore.getSessionState(sid)
    const hasExistingMessages = existingState && existingState.messages.length > 0
    const hasLoadedBaseline = existingState?.loadState === 'loaded'
    
    // 如果已经有消息且正在 streaming，不能覆盖消息，但仍需加载元数据
    // 仅在「已经完整加载过」时才跳过覆盖；
    // 对于仅靠 SSE 暂存出来的 session（loadState=idle），仍要做一次完整拉取
    // force 模式下也不覆盖正在 streaming 且已加载的消息
    if (hasExistingMessages && existingState.isStreaming && hasLoadedBaseline) {
      // 异步加载 session 元数据（不阻塞）
      const dir = directoryRef.current
      Promise.all([
        getSession(sid, dir).catch(() => null),
        getSessionMessages(sid, INITIAL_MESSAGE_LIMIT, dir)
          .then((messages) => ({ ok: true as const, messages }))
          .catch(() => ({ ok: false as const, messages: [] as ApiMessageWithParts[] })),
      ]).then(([sessionInfo, messagesResult]) => {
        if (isStale()) return

        if (messagesResult.ok) {
          historyLimitRef.current.set(sid, Math.max(INITIAL_MESSAGE_LIMIT, messagesResult.messages.length))
          historyJsonRef.current.set(sid, serializeApiMessageIds(messagesResult.messages))
        }

        messageStore.updateSessionMetadata(sid, {
          ...(messagesResult.ok ? { hasMoreHistory: messagesResult.messages.length >= INITIAL_MESSAGE_LIMIT } : {}),
          directory: sessionInfo?.directory ?? dir ?? '',
          shareUrl: sessionInfo?.share?.url,
        })
      }).catch(() => {
        // 元数据加载失败不影响 streaming，静默忽略
      })
      if (!isStale()) {
        onLoadComplete?.()
      }
      return
    }

    messageStore.setLoadState(sid, 'loading')

    try {
      // 并行加载 session 信息和消息（传递 directory）
      const [sessionInfo, apiMessages] = await Promise.all([
        getSession(sid, dir).catch(() => null),
        getSessionMessages(sid, INITIAL_MESSAGE_LIMIT, dir),
      ])

      if (isStale()) return

      // 再次检查：加载期间 SSE 可能已经推送了更多消息
      // force 模式下（重连）始终用服务器数据覆盖，因为本地数据可能不完整
      const currentState = messageStore.getSessionState(sid)
      const shouldKeepStreamingOnly =
        !force &&
        !!currentState &&
        currentState.loadState === 'loaded' &&
        currentState.messages.length > apiMessages.length

      if (shouldKeepStreamingOnly) {
        // SSE 推送的消息比 API 返回的多，说明有新消息，跳过覆盖
        // 但仍需更新元数据，否则 hasMoreHistory 等状态可能停留在默认值
        messageStore.updateSessionMetadata(sid, {
          hasMoreHistory: apiMessages.length >= INITIAL_MESSAGE_LIMIT,
          directory: sessionInfo?.directory ?? dir ?? '',
          loadState: 'loaded',
          shareUrl: sessionInfo?.share?.url,
        })
        onLoadComplete?.()
        historyLimitRef.current.set(sid, Math.max(INITIAL_MESSAGE_LIMIT, apiMessages.length))
        return
      }

      const mergedMessages = mergeWithLocalStreamingMessages(apiMessages, currentState)

      // 设置消息到 store
      messageStore.setMessages(sid, mergedMessages, {
        directory: sessionInfo?.directory ?? dir ?? '',
        hasMoreHistory: apiMessages.length >= INITIAL_MESSAGE_LIMIT,
        revertState: sessionInfo?.revert ?? null,
        shareUrl: sessionInfo?.share?.url,
      })

      historyLimitRef.current.set(sid, Math.max(INITIAL_MESSAGE_LIMIT, apiMessages.length))
      historyJsonRef.current.set(sid, serializeApiMessageIds(apiMessages))

      // force 模式（如 SSE 重连）只静默刷新数据，不触发滚动
      if (!force) {
        onLoadComplete?.()
      }
    } catch (error) {
      if (isStale()) return
      sessionErrorHandler('load session', error)
      messageStore.setLoadState(sid, 'error')
      onError?.(error instanceof Error ? error : new Error(String(error)))
    }
  }, [onLoadComplete, onError])

  // 保持 ref 同步，避免 effect 依赖 loadSession 导致重复触发
  useEffect(() => {
    loadSessionRef.current = loadSession
  }, [loadSession])

  // ============================================
  // Load More History
  // ============================================

  const loadMoreHistory = useCallback(async () => {
    if (!sessionId) return
    
    const state = messageStore.getSessionState(sessionId)
    if (!state) return

    if (state.messages.length >= MAX_HISTORY_MESSAGES) {
      console.warn(`[SessionManager] loadMore:blocked-by-cap session=${sessionId} localCount=${state.messages.length} cap=${MAX_HISTORY_MESSAGES}`)
      messageStore.prependMessages(sessionId, [], false)
      return
    }

    const dir = state.directory || directoryRef.current

    try {
      let currentLimit = historyLimitRef.current.get(sessionId)
        ?? Math.max(INITIAL_MESSAGE_LIMIT, state.messages.length)
      let currentJson = historyJsonRef.current.get(sessionId) ?? serializeStateMessageIds(state)

      console.log(`[SessionManager] loadMore:start session=${sessionId} limit=${currentLimit} localCount=${state.messages.length} localHasMore=${state.hasMoreHistory} first=${state.messages[0]?.info.id ?? 'none'} last=${state.messages[state.messages.length - 1]?.info.id ?? 'none'}`)

      while (true) {
        const targetLimit = Math.min(currentLimit + HISTORY_LOAD_BATCH_SIZE, MAX_HISTORY_MESSAGES)

        if (targetLimit <= currentLimit) {
          console.log(`[SessionManager] loadMore:no-more session=${sessionId} reason=limit-cap currentLimit=${currentLimit}`)
          messageStore.prependMessages(sessionId, [], false)
          return
        }

        const apiMessages = await getSessionMessages(sessionId, targetLimit, dir)
        const nextJson = serializeApiMessageIds(apiMessages)
        historyLimitRef.current.set(sessionId, targetLimit)
        historyJsonRef.current.set(sessionId, nextJson)

        console.log(`[SessionManager] loadMore:fetched session=${sessionId} targetLimit=${targetLimit} apiCount=${apiMessages.length} jsonChanged=${currentJson !== nextJson} first=${apiMessages[0]?.info.id ?? 'none'} last=${apiMessages[apiMessages.length - 1]?.info.id ?? 'none'}`)

        // 核心规则：新拉取 JSON 与本地缓存 JSON 相同 => 没有更多历史
        if (currentJson === nextJson) {
          console.log(`[SessionManager] loadMore:no-more session=${sessionId} reason=json-unchanged apiCount=${apiMessages.length}`)
          messageStore.prependMessages(sessionId, [], false)
          return
        }

        const latestState = messageStore.getSessionState(sessionId)
        if (!latestState) return

        const existingIds = new Set(getStateMessageIds(latestState))
        const oldestCreated = latestState.messages[0]?.info.time.created ?? Number.POSITIVE_INFINITY
        const prependCandidates = apiMessages
          .filter(m => !existingIds.has(m.info.id))
          .filter(m => (m.info.time?.created ?? Number.POSITIVE_INFINITY) <= oldestCreated)

        const hasMore = apiMessages.length >= targetLimit && targetLimit < MAX_HISTORY_MESSAGES

        if (prependCandidates.length > 0) {
          console.log(`[SessionManager] loadMore:prepend session=${sessionId} prependCount=${prependCandidates.length} hasMore=${hasMore} first=${prependCandidates[0]?.info.id ?? 'none'} last=${prependCandidates[prependCandidates.length - 1]?.info.id ?? 'none'}`)
          messageStore.prependMessages(sessionId, prependCandidates, hasMore)
          return
        }

        // JSON 有变化但暂无可前插历史：继续扩大 limit 强拉
        console.log(`[SessionManager] loadMore:changed-no-prepend-continue session=${sessionId} targetLimit=${targetLimit} apiCount=${apiMessages.length} hasMore=${hasMore}`)

        if (!hasMore) {
          messageStore.prependMessages(sessionId, [], false)
          return
        }

        currentLimit = targetLimit
        currentJson = nextJson
      }
    } catch (error) {
      console.error('[SessionManager] loadMore:error', { sessionId, error })
      sessionErrorHandler('load more history', error)
    }
  }, [sessionId])

  // ============================================
  // Undo
  // ============================================

  const handleUndo = useCallback(async (userMessageId: string) => {
    if (!sessionId) return

    // 获取当前 session 的 directory（优先用 store 中的，其次用传入的）
    const state = messageStore.getSessionState(sessionId)
    if (!state) return

    const dir = state.directory || directoryRef.current

    try {
      // 调用 API 设置 revert 点（传递 directory）
      await revertMessage(sessionId, userMessageId, undefined, dir)

      // 找到 revert 点的索引
      const revertIndex = state.messages.findIndex(m => m.info.id === userMessageId)
      if (revertIndex === -1) return

      // 收集被撤销的用户消息，构建 redo 历史
      const revertedUserMessages = state.messages
        .slice(revertIndex)
        .filter(m => m.info.role === 'user')

      const history = revertedUserMessages.map(m => {
        const content = extractUserMessageContent({
          info: m.info as any,
          parts: m.parts as any[],
        })
        const userInfo = m.info as unknown as ApiUserMessage
        return {
          messageId: m.info.id,
          text: content.text,
          attachments: content.attachments,
          model: userInfo.model,
          variant: userInfo.variant,
        }
      })

      // 更新 store 的 revert 状态
      const revertState: RevertState = {
        messageId: userMessageId,
        history,
      }
      messageStore.setRevertState(sessionId, revertState)
    } catch (error) {
      sessionErrorHandler('undo', error)
    }
  }, [sessionId])

  // ============================================
  // Redo
  // ============================================

  const handleRedo = useCallback(async () => {
    if (!sessionId) return

    const state = messageStore.getSessionState(sessionId)
    if (!state?.revertState) return

    const { history } = state.revertState
    if (history.length === 0) return

    const dir = state.directory || directoryRef.current

    try {
      // 移除第一条历史记录（最早撤销的）
      const newHistory = history.slice(1)

      if (newHistory.length > 0) {
        // 还有更多历史，设置新的 revert 点
        const newRevertMessageId = newHistory[0].messageId
        await revertMessage(sessionId, newRevertMessageId, undefined, dir)

        messageStore.setRevertState(sessionId, {
          messageId: newRevertMessageId,
          history: newHistory,
        })
      } else {
        // 没有更多历史，完全清除 revert 状态
        await unrevertSession(sessionId, dir)
        messageStore.setRevertState(sessionId, null)
      }
    } catch (error) {
      sessionErrorHandler('redo', error)
    }
  }, [sessionId])

  // ============================================
  // Redo All
  // ============================================

  const handleRedoAll = useCallback(async () => {
    if (!sessionId) return

    const state = messageStore.getSessionState(sessionId)
    const dir = state?.directory || directoryRef.current

    try {
      await unrevertSession(sessionId, dir)
      messageStore.setRevertState(sessionId, null)
    } catch (error) {
      sessionErrorHandler('redo all', error)
    }
  }, [sessionId])

  // ============================================
  // Clear Revert
  // ============================================

  const clearRevert = useCallback(() => {
    if (!sessionId) return
    messageStore.setRevertState(sessionId, null)
  }, [sessionId])

  // ============================================
  // Effects
  // ============================================

  // 同步 sessionId 到 store。
  // 若本地已有 loaded 缓存，则直接复用；否则再拉取后端。
  useEffect(() => {
    // 先更新 currentSessionId
    messageStore.setCurrentSession(sessionId)

    if (sessionId) {
      const cached = messageStore.getSessionState(sessionId)
      const canUseCached = !!cached && cached.loadState === 'loaded' && cached.messages.length > 0

      if (canUseCached) {
        const cachedLimit = Math.max(INITIAL_MESSAGE_LIMIT, cached.messages.length)
        const prevLimit = historyLimitRef.current.get(sessionId) ?? 0
        if (cachedLimit > prevLimit) {
          historyLimitRef.current.set(sessionId, cachedLimit)
        }
        if (!historyJsonRef.current.has(sessionId)) {
          historyJsonRef.current.set(sessionId, serializeStateMessageIds(cached))
        }

        console.log('[SessionManager] switch:use-cached', {
          sessionId,
          cachedCount: cached.messages.length,
          cachedLimit,
        })
        return
      }

      console.log('[SessionManager] switch:fetch-session', { sessionId })
      void loadSessionRef.current(sessionId)
    }

  }, [sessionId])

  return {
    loadSession,
    loadMoreHistory,
    handleUndo,
    handleRedo,
    handleRedoAll,
    clearRevert,
  }
}
