// ============================================
// useSessionManager - Session 加载和状态管理
// ============================================
//
// 职责：
// 1. 加载 session 消息（初始加载 + 懒加载历史）
// 2. 处理 undo/redo（调用 API + 更新 store）
// 3. 只管理单个 session 的加载状态，不再承担全局当前 session 同步
//
// ── 阶段 2a：历史加载从「offset 计数」改成「V2 游标」────────────────────────
//
// V1：`GET /session/{id}/message` 一次给全量，前端用「limit 递增」假装分页
//     （`cursorRef` 存当前已请求条数，loadMore 时 +50 再拉一次全量前缀）。
// V2：`GET /api/session/{id}/message` 是**真游标分页** →
//     - 首页：不传 cursor（服务端默认 order=desc，给最新的 N 条）
//     - 更旧：传上一页返回的 **`cursor.next`**
//     - 「还有没有更多」由 API 层的 `limit+1` 溢出法算出（`page.hasMore`）
//     - 游标存在 `messageStore` 的 `SessionState.historyCursor` 上，
//       随 session 一起被 LRU 淘汰，不会像原来的 `cursorRef` 那样跨 session 泄漏。
//
// ⚠️ 方向易错点：服务端默认 `order=desc`（新→旧），所以**「更旧」是 `cursor.next`
//    而不是 `cursor.previous`**。完整推导见 src/api/message.ts 文件头注释。
// ============================================

import { useCallback, useEffect, useRef } from 'react'
import { logger } from '../utils/logger'
import { isUserUIMessage } from '../utils/messageConversion'
import { messageStore, type RevertState, type SessionState } from '../store'
import { sessionKeyToServerId } from '../utils/sessionKey'
import {
  getSessionMessages,
  getSession,
  stageRevert,
  // 别名：本文件里有一个同名的本地回调（clearRevert，清本地 revert 展示状态），
  // 不别名会遮蔽 API 函数，导致「Expected 0 arguments, but got 3」这类误报
  clearRevert as clearRevertApi,
  extractUserMessageContent,
} from '../api'
import { sessionErrorHandler } from '../utils'
import { isSessionNotFoundError } from '../utils/sessionErrors'
import { INITIAL_MESSAGE_LIMIT, HISTORY_LOAD_BATCH_SIZE } from '../constants'
import type { MessageError } from '../types/message'

function toLoadMessageError(error: unknown): MessageError {
  const message = error instanceof Error ? error.message : String(error || 'Failed to load session')
  return {
    name: 'APIError',
    data: {
      message,
      isRetryable: true,
      responseBody: error instanceof Error ? error.stack : undefined,
    },
  }
}

interface UseSessionManagerOptions {
  sessionId: string | null
  directory?: string // 当前项目目录
  onLoadComplete?: () => void
  onError?: (error: Error) => void
  onSessionMissing?: (sessionId: string) => void
}

export function useSessionManager({
  sessionId,
  directory,
  onLoadComplete,
  onError,
  onSessionMissing,
}: UseSessionManagerOptions) {
  const loadSequenceRef = useRef<Map<string, number>>(new Map())
  /** 正在向前翻页的 session（防止滚动事件并发触发同一 session 的多次加载） */
  const loadingMoreRef = useRef<Set<string>>(new Set())
  const loadSessionRef = useRef<(sid: string, options?: { force?: boolean }) => Promise<void>>(async () => {})

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
          getSessionMessages(sid, { limit: INITIAL_MESSAGE_LIMIT }, dir, serverId).catch(() => null),
        ])
          .then(([sessionInfo, page]) => {
            if (isStale()) return

            messageStore.updateSessionMetadata(sid, {
              ...(page ? { hasMoreHistory: page.hasMore } : {}),
              directory: sessionInfo?.directory ?? dir ?? '',
              title: sessionInfo?.title,
            })
            if (page) messageStore.setHistoryCursor(sid, page.cursor.next)
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
        const [sessionInfo, page] = await Promise.all([
          getSession(sid, dir, serverId).catch(() => null),
          getSessionMessages(sid, { limit: INITIAL_MESSAGE_LIMIT }, dir, serverId),
        ])

        if (isStale()) return

        // 再次检查：加载期间 SSE 可能已经推送了更多消息
        // force 模式下（重连）始终用服务器数据覆盖，因为本地数据可能不完整
        const currentState = messageStore.getSessionState(sid)
        const shouldKeepStreamingOnly =
          !force &&
          !!currentState &&
          !currentState.isStale &&
          currentState.loadState === 'loaded' &&
          currentState.messages.length > page.messages.length

        if (shouldKeepStreamingOnly) {
          // SSE 推送的消息比 API 返回的多，说明有新消息，跳过覆盖
          // 但仍需更新元数据，否则 hasMoreHistory 等状态可能停留在默认值
          messageStore.updateSessionMetadata(sid, {
            hasMoreHistory: page.hasMore,
            directory: sessionInfo?.directory ?? dir ?? '',
            title: sessionInfo?.title,
            loadState: 'loaded',
          })
          messageStore.setHistoryCursor(sid, page.cursor.next)
          onLoadComplete?.()
          return
        }

        // 设置消息到 store
        messageStore.setMessages(sid, page.messages, {
          directory: sessionInfo?.directory ?? dir ?? '',
          title: sessionInfo?.title,
          hasMoreHistory: page.hasMore,
          historyCursor: page.cursor.next,
          revertState: sessionInfo?.revert ?? null,
          // 流式中保留 SSE 抢先推送、但这一页里还没有的消息
          keepLocalOnly: !!currentState?.isStreaming,
        })

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
  // Load More History（V2 游标分页）
  // ============================================

  /**
   * 向前（更旧）加载一页历史。
   *
   * 与 V1 的三个关键区别：
   *   1. 用 **游标** 而不是「已请求条数」—— 服务端不认 offset；
   *   2. 用 **`cursor.next`**（不是 `previous`）—— 服务端默认新→旧排序；
   *   3. 游标为 `null` 时**直接返回**，不再多发一次注定为空的请求。
   */
  const loadMoreHistory = useCallback(async () => {
    if (!sessionId) return

    const state = messageStore.getSessionState(sessionId)
    if (!state) return
    if (!state.hasMoreHistory) return

    const cursor = state.historyCursor
    if (!cursor) {
      // 没有游标但标记为「还有更多」：说明状态不一致，纠正为已到最早，避免死循环
      logger.warn('[SessionManager] hasMoreHistory 为真但没有游标，标记为已到最早', { sessionId })
      messageStore.updateSessionMetadata(sessionId, { hasMoreHistory: false })
      return
    }

    // 并发保护：滚动事件可能高频触发
    if (loadingMoreRef.current.has(sessionId)) return
    loadingMoreRef.current.add(sessionId)

    const dir = state.directory || directoryRef.current

    try {
      const page = await getSessionMessages(
        sessionId,
        { limit: HISTORY_LOAD_BATCH_SIZE, cursor },
        dir,
        sessionKeyToServerId(sessionId),
      )

      // 加载期间 session 可能被清掉/切走
      const latestState = messageStore.getSessionState(sessionId)
      if (!latestState) return

      // 去重交给 store（按消息 id），这里不再自行 filter/sort：
      // API 层已保证 messages 是「旧→新」，重排会破坏服务端 seq 顺序。
      messageStore.prependMessages(sessionId, page.messages, page.hasMore, page.cursor.next)

      logger.log('[SessionManager] loadMoreHistory', {
        sessionId,
        fetched: page.messages.length,
        hasMore: page.hasMore,
      })
    } catch (error) {
      sessionErrorHandler('load more history', error)
    } finally {
      loadingMoreRef.current.delete(sessionId)
    }
  }, [sessionId])

  // ============================================
  // Undo
  // ============================================
  //
  // ⚠️ **阶段 3a：V2 回退是三段式**（`revert/stage` → `revert/commit` → `DELETE revert`）。
  //    这里的「撤销 / 重做 / 全部重做」映射为：
  //
  //      handleUndo   → **stage**（把边界挪到这条用户消息）
  //      handleRedo   → 还有更早的撤销历史 → **stage**（边界往前挪一条 = 恢复一条）
  //                     没有历史了        → **clear**（等价 V1 的 unrevert）
  //      handleRedoAll→ **clear**
  //
  //    **不调用 commit**：V2 的 `commit` 是「真正删掉边界之后的消息」，不可逆。
  //    用户「回退 → 改一下 → 重新发送」时，服务端在 `prompt` 里**自动 commit**
  //    （源码 `packages/core/src/session/session.ts:165`：
  //      *"Commit a staged revert only after preparation succeeds, before admitting new work."*）。
  //    所以前端只在需要「撤销暂存」时调 clear，**永远不主动 commit**。

  const handleUndo = useCallback(
    async (userMessageId: string) => {
      if (!sessionId) return

      // 获取当前 session 的 directory（优先用 store 中的，其次用传入的）
      const state = messageStore.getSessionState(sessionId)
      if (!state) return

      const dir = state.directory || directoryRef.current

      try {
        // 调用 API 暂存回退边界（V2 三段式的第一段：stage）
        await stageRevert(sessionId, userMessageId, {}, dir, sessionKeyToServerId(sessionId))

        // 找到 revert 点的索引
        const revertIndex = state.messages.findIndex(m => m.info.id === userMessageId)
        if (revertIndex === -1) return

        // 收集被撤销的用户消息，构建 redo 历史
        const revertedUserMessages = state.messages.slice(revertIndex).filter(isUserUIMessage)

        const history = revertedUserMessages.map(m => {
          const content = extractUserMessageContent(m)
          const userInfo = m.info
          return {
            messageId: m.info.id,
            text: content.text,
            attachments: content.attachments,
            model: userInfo.model,
            variant: userInfo.model.variant,
            agent: userInfo.agent,
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
        // 还有更多历史，把回退边界往前挪一条（= 恢复一条消息）
        const newRevertMessageId = newHistory[0].messageId
        await stageRevert(sessionId, newRevertMessageId, {}, dir, sessionKeyToServerId(sessionId))

        messageStore.setRevertState(sessionId, {
          messageId: newRevertMessageId,
          history: newHistory,
        })
      } else {
        // 没有更多历史，完全清除 revert 状态（V2 的 clear，等价 V1 的 unrevert）
        await clearRevertApi(sessionId, dir, sessionKeyToServerId(sessionId))
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
      await clearRevertApi(sessionId, dir, sessionKeyToServerId(sessionId))
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

/** 供类型引用（避免 `SessionState` 变成未使用导入） */
export type { SessionState }
