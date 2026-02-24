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

export function useSessionManager({
  sessionId,
  directory,
  onLoadComplete,
  onError,
}: UseSessionManagerOptions) {
  const loadingRef = useRef(false)
  
  // 使用 ref 保存 directory，避免依赖变化
  const directoryRef = useRef(directory)
  directoryRef.current = directory

  // ============================================
  // Load Session
  // ============================================

  const loadSession = useCallback(async (sid: string, options?: { force?: boolean }) => {
    const force = options?.force ?? false
    
    if (loadingRef.current && !force) return
    loadingRef.current = true

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
        messageStore.updateSessionMetadata(sid, {
          ...(messagesResult.ok ? { hasMoreHistory: messagesResult.messages.length >= INITIAL_MESSAGE_LIMIT } : {}),
          directory: sessionInfo?.directory ?? dir ?? '',
          shareUrl: sessionInfo?.share?.url,
        })
      }).catch(() => {
        // 元数据加载失败不影响 streaming，静默忽略
      })
      loadingRef.current = false
      onLoadComplete?.()
      return
    }

    messageStore.setLoadState(sid, 'loading')

    try {
      // 并行加载 session 信息和消息（传递 directory）
      const [sessionInfo, apiMessages] = await Promise.all([
        getSession(sid, dir).catch(() => null),
        getSessionMessages(sid, INITIAL_MESSAGE_LIMIT, dir),
      ])

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
        loadingRef.current = false
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

      // force 模式（如 SSE 重连）只静默刷新数据，不触发滚动
      if (!force) {
        onLoadComplete?.()
      }
    } catch (error) {
      sessionErrorHandler('load session', error)
      messageStore.setLoadState(sid, 'error')
      onError?.(error instanceof Error ? error : new Error(String(error)))
    } finally {
      loadingRef.current = false
    }
  }, [onLoadComplete, onError])

  // ============================================
  // Load More History
  // ============================================

  const loadMoreHistory = useCallback(async () => {
    if (!sessionId) return
    
    const state = messageStore.getSessionState(sessionId)
    if (!state || !state.hasMoreHistory) return

    if (state.messages.length >= MAX_HISTORY_MESSAGES) {
      messageStore.prependMessages(sessionId, [], false)
      return
    }

    const dir = state.directory || directoryRef.current

    try {
      const targetLimit = Math.min(
        state.messages.length + HISTORY_LOAD_BATCH_SIZE,
        MAX_HISTORY_MESSAGES
      )

      const apiMessages = await getSessionMessages(sessionId, targetLimit, dir)

      const oldestId = state.messages[0]?.info.id
      if (!oldestId) {
        messageStore.setMessages(sessionId, apiMessages, {
          directory: state.directory,
          hasMoreHistory: apiMessages.length >= targetLimit,
        })
        return
      }

      const oldestIndex = apiMessages.findIndex(m => m.info.id === oldestId)

      // findIndex 返回 -1 说明 API 返回中找不到当前最旧的消息
      // 可能是 streaming 期间新消息涌入导致 limit 范围没覆盖到，不应终止加载
      if (oldestIndex === -1) {
        const retryLimit = Math.min(targetLimit + HISTORY_LOAD_BATCH_SIZE, MAX_HISTORY_MESSAGES)
        const retryMessages = retryLimit > targetLimit
          ? await getSessionMessages(sessionId, retryLimit, dir)
          : apiMessages

        const retryOldestIndex = retryMessages.findIndex(m => m.info.id === oldestId)

        if (retryOldestIndex === -1) {
          // 本地和服务端窗口发生漂移，回退到「以服务端为准 + 保留本地 streaming」
          const latestState = messageStore.getSessionState(sessionId)
          const recovered = mergeWithLocalStreamingMessages(retryMessages, latestState)
          messageStore.setMessages(sessionId, recovered, {
            directory: latestState?.directory || state.directory,
            hasMoreHistory: retryMessages.length >= retryLimit && retryLimit < MAX_HISTORY_MESSAGES,
            shareUrl: latestState?.shareUrl,
          })
          return
        }

        if (retryOldestIndex === 0) {
          messageStore.prependMessages(sessionId, [], false)
          return
        }

        const retryNewMessages = retryMessages.slice(0, retryOldestIndex)
        const retryHasMore = retryMessages.length >= retryLimit && retryLimit < MAX_HISTORY_MESSAGES
        messageStore.prependMessages(sessionId, retryNewMessages, retryHasMore)
        return
      }

      // oldestIndex === 0 说明 API 返回的第一条就是当前最旧消息，确实没有更旧的了
      if (oldestIndex === 0) {
        messageStore.prependMessages(sessionId, [], false)
        return
      }

      const newMessages = apiMessages.slice(0, oldestIndex)
      const hasMore = apiMessages.length >= targetLimit && targetLimit < MAX_HISTORY_MESSAGES

      messageStore.prependMessages(sessionId, newMessages, hasMore)
    } catch (error) {
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

  // 同步 sessionId 到 store，并加载数据
  useEffect(() => {
    // 先更新 currentSessionId
    messageStore.setCurrentSession(sessionId)

    if (sessionId) {
      const state = messageStore.getSessionState(sessionId)
      // 只有未加载时才加载
      if (!state || state.loadState === 'idle') {
        loadSession(sessionId)
      }
    }

  }, [sessionId, loadSession])

  return {
    loadSession,
    loadMoreHistory,
    handleUndo,
    handleRedo,
    handleRedoAll,
    clearRevert,
  }
}
