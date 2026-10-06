// ============================================
// useSessionManager - Session 加载和状态管理
// ============================================
//
// 职责：
// 1. 加载 session 消息（初始加载 + 懒加载历史）
// 2. 处理 undo/redo（调用 API + 更新 store）
// 3. 只管理单个 session 的加载状态，不再承担全局当前 session 同步

import { useCallback, useEffect, useRef } from 'react'
import { logger } from '../utils/logger'
import { messageStore, type RevertState } from '../store'
import { sessionKeyToServerId } from '../utils/sessionKey'
import { getSessionMessagesPage, getSession, revertMessage, unrevertSession } from '../api'
import { sessionErrorHandler } from '../utils'
import { isSessionNotFoundError } from '../utils/sessionErrors'
import { INITIAL_MESSAGE_LIMIT, HISTORY_LOAD_BATCH_SIZE } from '../constants'
import { isUserMessage } from '../types/api/message'
import type { APIError } from '../types/api/common'
import type { SessionMessageInfo } from '../types/api/message'

/**
 * 首屏窗口是否从半截回合开始（官方 leadingTurnNeedsParent 同款，
 * packages/app/src/session/timeline/model.ts:90-95）：
 * 最早一条 assistant 之前没有任何 user/shell 边界 → 它的父 prompt
 * 还在更深的历史页里，需要补翻。
 */
export function leadingTurnNeedsParent(messages: SessionMessageInfo[]): boolean {
  const assistant = messages.findIndex(message => message.type === 'assistant')
  if (assistant === -1) return false
  const boundary = messages.findIndex(message => message.type === 'user' || message.type === 'shell')
  return boundary === -1 || assistant < boundary
}

/** enrichLeadingTurn 的上限与节奏（官方 leadingTurnPageLimit / Delay 同款） */
const LEADING_TURN_PAGE_LIMIT = 3
const LEADING_TURN_PAGE_DELAY = 200
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * 会话加载失败 → v2 的结构化错误（`{ type, message, status?, response? }`）。
 *
 * v1 是按 `name` 判别的 `MessageError` 联合；v2 的错误只有一个形状，
 * 因此这里直接产出原生形状，错误卡片（`MessageErrorView`）按它渲染。
 */
function toLoadMessageError(error: unknown): APIError {
  const message = error instanceof Error ? error.message : String(error || 'Failed to load session')
  const stack = error instanceof Error ? error.stack : undefined
  return {
    type: 'APIError',
    message,
    ...(stack ? { response: { body: stack } } : {}),
  }
}

interface UseSessionManagerOptions {
  sessionId: string | null
  directory?: string // 当前项目目录
  onLoadComplete?: () => void
  onError?: (error: Error) => void
  onSessionMissing?: (sessionId: string) => void
}

// 注：v1 的 preferCompatiblePartText / mergePartsForReload /
// mergeWithLocalStreamingMessages / messageTimeIncomplete 已删除——流式保长与
// 「SSE 先到、列表未含」的合并逻辑现在统一在 messageStore.setMessages 内处理。

export function useSessionManager({
  sessionId,
  directory,
  onLoadComplete,
  onError,
  onSessionMissing,
}: UseSessionManagerOptions) {
  const loadSequenceRef = useRef<Map<string, number>>(new Map())
  /** 每个 session 的历史翻页 in-flight 守卫（官方 messageLoads 同款，防止并发翻页） */
  const historyLoadsRef = useRef<Map<string, Promise<boolean>>>(new Map())
  const loadSessionRef = useRef<(sid: string, options?: { force?: boolean }) => Promise<void>>(async () => {})

  /**
   * 用游标翻一页更老的历史并前插（官方 message.loadMore 同款）。
   * 返回是否还有更早的页。并发调用复用同一个 in-flight 请求。
   */
  const prependHistoryPage = useCallback(async (sid: string): Promise<boolean> => {
    const inflight = historyLoadsRef.current.get(sid)
    if (inflight) return inflight

    const request = (async (): Promise<boolean> => {
      const state = messageStore.getSessionState(sid)
      if (!state) return false
      const cursor = state.historyCursor
      if (cursor === null) return false

      const serverId = sessionKeyToServerId(sid)
      const page = await getSessionMessagesPage(sid, { limit: HISTORY_LOAD_BATCH_SIZE, cursor }, serverId)
      const latestState = messageStore.getSessionState(sid)
      if (!latestState) return false

      // 去重 + 按时间排序（历史页总是更早的消息）
      const existingIds = new Set(latestState.messages.map(message => message.id))
      const prependCandidates = page.messages
        .filter(message => !existingIds.has(message.id))
        .sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0))

      // 游标必须前进：服务端异常时可能返回自指游标（next 与本次入参相同），
      // 不前进 = 到头——否则 hasMoreHistory 永真，「加载更多」死循环
      //（真机复现：v2.0.14 服务端偶发连续返回同一 next 值）
      const hasMore = page.nextCursor !== null && page.nextCursor !== cursor
      messageStore.prependMessages(sid, prependCandidates, hasMore, hasMore ? page.nextCursor : null)
      return hasMore
    })().finally(() => {
      historyLoadsRef.current.delete(sid)
    })

    historyLoadsRef.current.set(sid, request)
    return request
  }, [])

  // 使用 ref 保存 directory，避免依赖变化
  const directoryRef = useRef(directory)

  useEffect(() => {
    directoryRef.current = directory
  }, [directory])

  // ============================================
  // Load Session
  // ============================================

  const loadSession = useCallback(
    async (sid: string, options?: { force?: boolean }) => {
      const force = options?.force ?? false

      const seq = (loadSequenceRef.current.get(sid) ?? 0) + 1
      loadSequenceRef.current.set(sid, seq)
      const isStale = () => loadSequenceRef.current.get(sid) !== seq

      const dir = directoryRef.current

      // 检查是否已有消息（SSE 可能已经推送了）
      const existingState = messageStore.getSessionState(sid)
      const hasExistingMessages = existingState && existingState.messages.length > 0
      const hasLoadedBaseline = existingState?.loadState === 'loaded' && !existingState?.isStale

      // 如果已经有消息且正在 streaming，不能覆盖消息，但仍需加载元数据
      // 仅在「已经完整加载过」时才跳过覆盖；
      // 对于仅靠 SSE 暂存出来的 session（loadState=idle），仍要做一次完整拉取
      // force 模式下也不覆盖正在 streaming 且已加载的消息
      if (hasExistingMessages && existingState.isStreaming && hasLoadedBaseline) {
        // 异步加载 session 元数据（不阻塞）
        const dir = directoryRef.current
        const serverId = sessionKeyToServerId(sid)
        Promise.all([
          getSession(sid, dir, serverId).catch(() => null),
          getSessionMessagesPage(sid, { limit: INITIAL_MESSAGE_LIMIT }, serverId)
            .then(page => ({ ok: true as const, page }))
            .catch(() => ({ ok: false as const, page: null })),
        ])
          .then(([sessionInfo, messagesResult]) => {
            if (isStale()) return

            messageStore.updateSessionMetadata(sid, {
              ...(messagesResult.ok && messagesResult.page
                ? { hasMoreHistory: messagesResult.page.nextCursor !== null, historyCursor: messagesResult.page.nextCursor }
                : {}),
              directory: sessionInfo?.location?.directory ?? dir ?? '',
              title: sessionInfo?.title,
            })
          })
          .catch(() => {
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
        const serverId = sessionKeyToServerId(sid)
        const [sessionInfo, firstPage] = await Promise.all([
          getSession(sid, dir, serverId).catch(() => null),
          getSessionMessagesPage(sid, { limit: INITIAL_MESSAGE_LIMIT }, serverId),
        ])

        if (isStale()) return

        const apiMessages = firstPage.messages
        const nextCursor = firstPage.nextCursor

        // 再次检查：加载期间 SSE 可能已经推送了更多消息
        // force 模式下（重连）始终用服务器数据覆盖，因为本地数据可能不完整
        const currentState = messageStore.getSessionState(sid)
        const shouldKeepStreamingOnly =
          !force &&
          !!currentState &&
          !currentState.isStale &&
          currentState.loadState === 'loaded' &&
          currentState.messages.length > apiMessages.length

        if (shouldKeepStreamingOnly) {
          // SSE 推送的消息比 API 返回的多，说明有新消息，跳过覆盖
          // 但仍需更新元数据，否则 hasMoreHistory 等状态可能停留在默认值
          messageStore.updateSessionMetadata(sid, {
            hasMoreHistory: nextCursor !== null,
            historyCursor: nextCursor,
            directory: sessionInfo?.location?.directory ?? dir ?? '',
            title: sessionInfo?.title,
            loadState: 'loaded',
          })
          onLoadComplete?.()
          return
        }

        // 设置消息到 store（流式文本保长与 SSE-only 消息保留都在 store 内处理）
        messageStore.setMessages(sid, apiMessages, {
          directory: sessionInfo?.location?.directory ?? dir ?? '',
          title: sessionInfo?.title,
          hasMoreHistory: nextCursor !== null,
          historyCursor: nextCursor,
          // v2 的 SessionInfo 不再携带 revert / share：
          // 回退状态由 session.revert 接口与事件维护，分享改为导出
          revertState: null,
        })

        // 首屏窗口可能从半截回合开始（首条 assistant 的父 user 在更深的历史页）：
        // 官方 enrichLeadingTurn 同款，最多补翻 3 页直到首回合完整
        //（app/src/session/timeline/model.ts:69-95）
        if (nextCursor !== null) {
          for (let pages = 0; pages < LEADING_TURN_PAGE_LIMIT; pages++) {
            const state = messageStore.getSessionState(sid)
            if (!state || !leadingTurnNeedsParent(state.messages) || !state.hasMoreHistory) break
            await pause(LEADING_TURN_PAGE_DELAY)
            if (isStale()) return
            const more = await prependHistoryPage(sid).catch(() => false)
            if (!more) break
          }
        }

        // force 模式（如 SSE 重连）只静默刷新数据，不触发滚动
        if (!force) {
          onLoadComplete?.()
        }
      } catch (error) {
        if (isStale()) return
        sessionErrorHandler('load session', error)
        messageStore.setLoadError(sid, toLoadMessageError(error))
        if (isSessionNotFoundError(error)) {
          onSessionMissing?.(sid)
        }
        onError?.(error instanceof Error ? error : new Error(String(error)))
      }
    },
    [onLoadComplete, onError, onSessionMissing],
  )

  // 保持 ref 同步，避免 effect 依赖 loadSession 导致重复触发
  useEffect(() => {
    loadSessionRef.current = loadSession
  }, [loadSession])

  // ============================================
  // Load More History
  // ============================================

  const loadMoreHistory = useCallback(async () => {
    if (!sessionId) return
    try {
      await prependHistoryPage(sessionId)
    } catch (error) {
      sessionErrorHandler('load more history', error)
    }
  }, [sessionId, prependHistoryPage])

  // ============================================
  // Undo
  // ============================================

  const handleUndo = useCallback(
    async (userMessageId: string) => {
      if (!sessionId) return

      // 获取当前 session 的 directory（优先用 store 中的，其次用传入的）
      const state = messageStore.getSessionState(sessionId)
      if (!state) return

      const dir = state.directory || directoryRef.current

      try {
        // 调用 API 设置 revert 点（传递 directory）
        await revertMessage(sessionId, userMessageId, undefined, dir, sessionKeyToServerId(sessionId))

        // 找到 revert 点的索引
        const revertIndex = state.messages.findIndex(m => m.id === userMessageId)
        if (revertIndex === -1) return

        // 收集被撤销的用户消息，构建 redo 历史
        const revertedUserMessages = state.messages.slice(revertIndex).filter(isUserMessage)

        // 收集被撤销的用户消息，构建 redo 历史。
        // 用 store 的公开构造器，保证与 setMessages 里那条路径是**同一口径**
        //（v2 用户消息不带 model/agent，需按会话级当前值回填，这种细节两边各写一份必然漂移）。
        const history = revertedUserMessages
          .map(m => messageStore.buildRevertHistoryItem(sessionId, m))
          .filter((item): item is RevertState['history'][number] => item !== undefined)

        // 更新 store 的 revert 状态
        const revertState: RevertState = {
          messageId: userMessageId,
          history,
        }
        messageStore.setRevertState(sessionId, revertState)
      } catch (error) {
        sessionErrorHandler('undo', error)
      }
    },
    [sessionId],
  )

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
        await revertMessage(sessionId, newRevertMessageId, undefined, dir, sessionKeyToServerId(sessionId))

        messageStore.setRevertState(sessionId, {
          messageId: newRevertMessageId,
          history: newHistory,
        })
      } else {
        // 没有更多历史，完全清除 revert 状态
        await unrevertSession(sessionId, dir, sessionKeyToServerId(sessionId))
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
      await unrevertSession(sessionId, dir, sessionKeyToServerId(sessionId))
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

  // 根据 sessionId 切换缓存视图。
  // focused pane / URL 的同步由 App 顶层统一负责，
  // 这里不再写任何“全局当前 session”状态。
  useEffect(() => {
    if (sessionId) {
      const cached = messageStore.getSessionState(sessionId)
      const canUseCached = !!cached && cached.loadState === 'loaded' && !cached.isStale && cached.messages.length > 0

      if (canUseCached) {
        logger.log('[SessionManager] switch:use-cached', {
          sessionId,
          cachedCount: cached.messages.length,
        })
        return
      }

      logger.log('[SessionManager] switch:fetch-session', { sessionId })
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
