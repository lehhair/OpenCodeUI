// ============================================
// useGlobalEvents - 全局 SSE 事件订阅
// ============================================
//
// 职责：
// 1. 订阅全局 SSE 事件流
// 2. 将事件分发到 messageStore
// 3. 追踪子 session 关系（用于权限请求冒泡）
// 4. 与具体 session 无关，处理所有 session 的事件

import { useEffect, useRef } from 'react'
import { messageStore, childSessionStore, paneLayoutStore } from '../store'
import { activeSessionStore } from '../store/activeSessionStore'
import { notificationStore } from '../store/notificationStore'
import { soundStore } from '../store/soundStore'
import { playNotificationSoundDeduped } from '../utils/notificationSoundBridge'
import { subscribeToEvents, getSessionStatus, getPendingPermissions, getPendingQuestions } from '../api'
import { replyPermission } from '../api/permission'
import { autoApproveStore } from '../store/autoApproveStore'
import type { ApiMessage, ApiPart, ApiPermissionRequest, ApiQuestionRequest } from '../api/types'
import type { SessionStatusMap } from '../types/api/session'

// ============================================
// Session-level pub/sub 消费者注册
// ============================================
//
// 支持多个消费者（每个 pane 一个）按 sessionId 注册回调。
// SSE 事件到达后，按 sessionId 找到匹配的消费者分发。

/** 消费者可以注册的回调类型（与 GlobalEventsCallbacks 的子集对应） */
export interface SessionEventCallbacks {
  onPermissionAsked?: (request: ApiPermissionRequest) => void
  onPermissionReplied?: (data: { sessionID: string; requestID: string }) => void
  onQuestionAsked?: (request: ApiQuestionRequest) => void
  onQuestionReplied?: (data: { sessionID: string; requestID: string }) => void
  onQuestionRejected?: (data: { sessionID: string; requestID: string }) => void
  onScrollRequest?: () => void
  onSessionIdle?: (sessionID: string) => void
  onSessionError?: (sessionID: string) => void
  onReconnected?: (reason: 'network' | 'server-switch') => void
}

interface SessionConsumer {
  sessionId: string | null
  callbacks: SessionEventCallbacks
}

/** 全局消费者注册表 */
const sessionConsumers = new Map<string, SessionConsumer>()

/**
 * 注册一个 session 级事件消费者。
 * @param consumerId 唯一标识（通常用 paneId）
 * @param sessionId 关心的 sessionId（null = 不接收事件）
 * @param callbacks 回调函数集
 * @returns 注销函数
 */
export function registerSessionConsumer(
  consumerId: string,
  sessionId: string | null,
  callbacks: SessionEventCallbacks,
): () => void {
  sessionConsumers.set(consumerId, { sessionId, callbacks })
  return () => {
    sessionConsumers.delete(consumerId)
  }
}

/** 更新已注册消费者的 sessionId（pane 切换 session 时，无需重新注册） */
export function updateConsumerSessionId(consumerId: string, sessionId: string | null) {
  const c = sessionConsumers.get(consumerId)
  if (c) c.sessionId = sessionId
}

/** 按 sessionId 找到所有匹配的消费者回调（包括子 session 冒泡） */
function dispatchToConsumers(sessionId: string, invoke: (cb: SessionEventCallbacks) => void): boolean {
  let dispatched = false
  for (const consumer of sessionConsumers.values()) {
    if (!consumer.sessionId) continue
    if (consumer.sessionId === sessionId || childSessionStore.belongsToSession(sessionId, consumer.sessionId)) {
      invoke(consumer.callbacks)
      dispatched = true
    }
  }
  return dispatched
}

/** 检查是否有任何消费者关心此 sessionId */
function hasConsumerForSession(sessionId: string): boolean {
  for (const consumer of sessionConsumers.values()) {
    if (!consumer.sessionId) continue
    if (consumer.sessionId === sessionId) return true
    if (childSessionStore.belongsToSession(sessionId, consumer.sessionId)) return true
  }
  return false
}

/** 检查是否有“其他”消费者仍在使用该 sessionId（排除当前 pane 自己） */
export function hasOtherConsumerForSession(sessionId: string, consumerId: string): boolean {
  for (const [id, consumer] of sessionConsumers.entries()) {
    if (id === consumerId) continue
    if (!consumer.sessionId) continue
    if (consumer.sessionId === sessionId) return true
    if (childSessionStore.belongsToSession(sessionId, consumer.sessionId)) return true
  }
  return false
}

// ============================================
// 待处理请求缓存 - 处理 permission/question 事件先于 session.created 到达的时序问题
// 同一 session 可能有多个 pending 请求，所以用数组
// ============================================
interface PendingRequest<T> {
  request: T
  timestamp: number
}

const pendingPermissions = new Map<string, PendingRequest<ApiPermissionRequest>[]>()
const pendingQuestions = new Map<string, PendingRequest<ApiQuestionRequest>[]>()

// 5秒后过期，防止内存泄漏
const PENDING_TIMEOUT = 5000

function cleanupExpired<T>(map: Map<string, PendingRequest<T>[]>) {
  const now = Date.now()
  for (const [key, arr] of map) {
    const filtered = arr.filter(item => now - item.timestamp <= PENDING_TIMEOUT)
    if (filtered.length === 0) {
      map.delete(key)
    } else if (filtered.length !== arr.length) {
      map.set(key, filtered)
    }
  }
}

function addPending<T>(map: Map<string, PendingRequest<T>[]>, sessionID: string, request: T) {
  const arr = map.get(sessionID) || []
  arr.push({ request, timestamp: Date.now() })
  map.set(sessionID, arr)
}

function drainPending<T>(map: Map<string, PendingRequest<T>[]>, sessionID: string): T[] {
  const arr = map.get(sessionID)
  if (!arr || arr.length === 0) return []
  map.delete(sessionID)
  return arr.map(item => item.request)
}

async function fetchActiveScopeData(directories?: string[]) {
  const scopes = directories && directories.length > 0 ? directories : [undefined]
  const results = await Promise.all(
    scopes.map(async directory => {
      const [statusMap, permissions, questions] = await Promise.all([
        getSessionStatus(directory).catch(() => ({}) as SessionStatusMap),
        getPendingPermissions(undefined, directory).catch(() => []),
        getPendingQuestions(undefined, directory).catch(() => []),
      ])

      return { directory, statusMap, permissions, questions }
    }),
  )

  const mergedStatusMap: SessionStatusMap = {}
  const permissionMap = new Map<string, ApiPermissionRequest>()
  const questionMap = new Map<string, ApiQuestionRequest>()
  const sessionMetaEntries: Array<{ sessionId: string; directory?: string }> = []

  results.forEach(({ directory, statusMap, permissions, questions }) => {
    Object.assign(mergedStatusMap, statusMap)

    if (directory) {
      Object.keys(statusMap).forEach(sessionId => {
        sessionMetaEntries.push({ sessionId, directory })
      })
    }

    permissions.forEach(permission => {
      if (directory) {
        sessionMetaEntries.push({ sessionId: permission.sessionID, directory })
      }
      permissionMap.set(permission.id, permission)
    })

    questions.forEach(question => {
      if (directory) {
        sessionMetaEntries.push({ sessionId: question.sessionID, directory })
      }
      questionMap.set(question.id, question)
    })
  })

  return {
    statusMap: mergedStatusMap,
    permissions: Array.from(permissionMap.values()),
    questions: Array.from(questionMap.values()),
    sessionMetaEntries,
  }
}

/**
 * 检查 sessionID 是否属于当前活跃的 session family。
 * 依次检查：
 *   1. focused pane 的 session family
 *   2. pub/sub 消费者注册表（其他 pane）
 */
function belongsToCurrentSession(sessionId: string): boolean {
  const focusedSessionId = paneLayoutStore.getFocusedSessionId()

  // 检查当前 focused pane 的 session family
  if (focusedSessionId) {
    if (sessionId === focusedSessionId) return true
    if (childSessionStore.belongsToSession(sessionId, focusedSessionId)) return true
  }

  // 检查 pub/sub 消费者注册表（多 pane 模式下各 pane 注册的 session）
  if (hasConsumerForSession(sessionId)) return true

  return false
}

export function useGlobalEvents(directories?: string[]) {
  const directoriesRef = useRef<string[] | undefined>(directories)
  const refreshRef = useRef<(() => void) | null>(null)
  const initializedDirectoriesRef = useRef(false)

  useEffect(() => {
    // 节流滚动
    let scrollPending = false
    const pendingScrollSessionIds = new Set<string>()

    const scheduleScroll = (sessionId: string) => {
      pendingScrollSessionIds.add(sessionId)
      if (scrollPending) return
      scrollPending = true
      requestAnimationFrame(() => {
        scrollPending = false

        // 分发到 pub/sub 消费者
        for (const sid of pendingScrollSessionIds) {
          dispatchToConsumers(sid, cb => cb.onScrollRequest?.())
        }
        pendingScrollSessionIds.clear()
      })
    }

    // ============================================
    // 拉取 session 状态 + pending requests（初始化 & 重连共用）
    // ============================================

    const fetchAndInitialize = () => {
      fetchActiveScopeData(directoriesRef.current).then(({ statusMap, permissions, questions, sessionMetaEntries }) => {
        activeSessionStore.initialize(statusMap)
        activeSessionStore.initializePendingRequests(permissions, questions)
        activeSessionStore.setSessionMetaBulk(sessionMetaEntries)
      })
    }

    refreshRef.current = fetchAndInitialize

    const unsubscribe = subscribeToEvents({
      // ============================================
      // Message Events → messageStore
      // ============================================

      onMessageUpdated: (apiMsg: ApiMessage) => {
        messageStore.handleMessageUpdated(apiMsg)
      },

      onPartUpdated: (apiPart: ApiPart) => {
        if ('sessionID' in apiPart && 'messageID' in apiPart) {
          messageStore.handlePartUpdated(apiPart as ApiPart & { sessionID: string; messageID: string })
          scheduleScroll(apiPart.sessionID)
        }
      },

      onPartDelta: data => {
        messageStore.handlePartDelta(data)
        scheduleScroll(data.sessionID)
      },

      onPartRemoved: data => {
        messageStore.handlePartRemoved(data)
      },

      // ============================================
      // Session Events → childSessionStore
      // ============================================

      onSessionCreated: session => {
        // 注册子 session 关系
        if (session.parentID) {
          childSessionStore.registerChildSession(session)

          // 处理因时序问题缓存的权限请求（可能有多个）
          if (belongsToCurrentSession(session.id)) {
            for (const req of drainPending(pendingPermissions, session.id)) {
              dispatchToConsumers(req.sessionID, cb => cb.onPermissionAsked?.(req))
            }
            for (const req of drainPending(pendingQuestions, session.id)) {
              dispatchToConsumers(req.sessionID, cb => cb.onQuestionAsked?.(req))
            }
          }
        }

        // 更新 session meta 供 active tab 使用
        activeSessionStore.setSessionMeta(session.id, session.title, session.directory)

        // 清理过期缓存
        cleanupExpired(pendingPermissions)
        cleanupExpired(pendingQuestions)
      },

      onSessionIdle: data => {
        messageStore.handleSessionIdle(data.sessionID)
        childSessionStore.markIdle(data.sessionID)
        dispatchToConsumers(data.sessionID, cb => cb.onSessionIdle?.(data.sessionID))
      },

      onSessionError: error => {
        const isAbort = error.name === 'MessageAbortedError' || error.name === 'AbortError'
        if (!isAbort && import.meta.env.DEV) {
          console.warn('[GlobalEvents] Session error:', error)
        }
        messageStore.handleSessionError(error.sessionID)
        childSessionStore.markError(error.sessionID)
        if (!isAbort) {
          // 从 Working 列表移除
          activeSessionStore.updateStatus(error.sessionID, { type: 'idle' })
          // 通知（跳过当前 session family）
          if (!belongsToCurrentSession(error.sessionID)) {
            const meta = activeSessionStore.getSessionMeta(error.sessionID)
            const sessionLabel = meta?.title || error.sessionID.slice(0, 8)
            notificationStore.push('error', sessionLabel, 'Session error', error.sessionID, meta?.directory)
          } else if (soundStore.getSnapshot().currentSessionEnabled) {
            playNotificationSoundDeduped('error')
          }
        }
        dispatchToConsumers(error.sessionID, cb => cb.onSessionError?.(error.sessionID))
      },

      onSessionUpdated: session => {
        // 更新 session meta 供 active tab 使用
        activeSessionStore.setSessionMeta(session.id, session.title, session.directory)
        if (session.parentID) {
          childSessionStore.registerChildSession(session)
        }

        // 同步标题到 messageStore，让 Header 等依赖 messageStore 的组件实时更新
        if (session.title && messageStore.getSessionState(session.id)) {
          messageStore.updateSessionMetadata(session.id, { title: session.title })
        }
      },

      // ============================================
      // Permission Events → callbacks (通过 ref 调用)
      // 关键变化：不仅处理当前 session，也处理子 session 的权限请求
      // 时序处理：如果 session 还没注册，缓存请求等 session.created 后处理
      // ============================================

      onPermissionAsked: request => {
        // Full Auto 全局模式拦截 — 所有会话的权限请求直接放行
        if (autoApproveStore.fullAutoMode === 'global') {
          const dir = activeSessionStore.getSessionMeta(request.sessionID)?.directory
          replyPermission(request.id, 'once', undefined, dir).then(() => {
            activeSessionStore.resolvePendingRequest(request.id)
          })
          return
        }

        const meta = activeSessionStore.getSessionMeta(request.sessionID)
        const sessionLabel = meta?.title || request.sessionID.slice(0, 8)
        const desc = request.patterns?.length ? `${request.permission}: ${request.patterns[0]}` : request.permission

        // Active 列表：注册 pending request
        activeSessionStore.addPendingRequest(request.id, request.sessionID, 'permission', desc)

        // Toast 通知 — 不属于当前 session family 的才弹
        if (!belongsToCurrentSession(request.sessionID)) {
          notificationStore.push('permission', `${sessionLabel} — Permission`, desc, request.sessionID, meta?.directory)
        } else if (soundStore.getSnapshot().currentSessionEnabled) {
          // 当前会话：如果开启了当前会话提示音
          playNotificationSoundDeduped('permission')
        }

        if (belongsToCurrentSession(request.sessionID)) {
          dispatchToConsumers(request.sessionID, cb => cb.onPermissionAsked?.(request))
        } else {
          addPending(pendingPermissions, request.sessionID, request)
        }
      },

      onPermissionReplied: data => {
        pendingPermissions.delete(data.sessionID)
        activeSessionStore.resolvePendingRequest(data.requestID)

        if (belongsToCurrentSession(data.sessionID)) {
          dispatchToConsumers(data.sessionID, cb => cb.onPermissionReplied?.(data))
        }
      },

      // ============================================
      // Question Events
      // ============================================

      onQuestionAsked: request => {
        const meta = activeSessionStore.getSessionMeta(request.sessionID)
        const sessionLabel = meta?.title || request.sessionID.slice(0, 8)
        const desc = request.questions?.[0]?.header || 'AI is waiting for your input'

        // Active 列表：注册 pending request
        activeSessionStore.addPendingRequest(request.id, request.sessionID, 'question', desc)

        // Toast 通知
        if (!belongsToCurrentSession(request.sessionID)) {
          notificationStore.push('question', `${sessionLabel} — Question`, desc, request.sessionID, meta?.directory)
        } else if (soundStore.getSnapshot().currentSessionEnabled) {
          playNotificationSoundDeduped('question')
        }

        if (belongsToCurrentSession(request.sessionID)) {
          dispatchToConsumers(request.sessionID, cb => cb.onQuestionAsked?.(request))
        } else {
          addPending(pendingQuestions, request.sessionID, request)
        }
      },

      onQuestionReplied: data => {
        pendingQuestions.delete(data.sessionID)
        activeSessionStore.resolvePendingRequest(data.requestID)

        if (belongsToCurrentSession(data.sessionID)) {
          dispatchToConsumers(data.sessionID, cb => cb.onQuestionReplied?.(data))
        }
      },

      onQuestionRejected: data => {
        pendingQuestions.delete(data.sessionID)
        activeSessionStore.resolvePendingRequest(data.requestID)

        if (belongsToCurrentSession(data.sessionID)) {
          dispatchToConsumers(data.sessionID, cb => cb.onQuestionRejected?.(data))
        }
      },

      // ============================================
      // Session Status → activeSessionStore
      // ============================================

      onSessionStatus: data => {
        const prevStatus = activeSessionStore.getSnapshot().statusMap[data.sessionID]
        const wasBusy = prevStatus && (prevStatus.type === 'busy' || prevStatus.type === 'retry')

        activeSessionStore.updateStatus(data.sessionID, data.status)

        // Toast — session 从 busy/retry 变成 idle 时弹 completed 通知
        if (wasBusy && data.status.type === 'idle' && !belongsToCurrentSession(data.sessionID)) {
          const meta = activeSessionStore.getSessionMeta(data.sessionID)
          const sessionLabel = meta?.title || data.sessionID.slice(0, 8)
          notificationStore.push('completed', sessionLabel, 'Session completed', data.sessionID, meta?.directory)
        } else if (
          wasBusy &&
          data.status.type === 'idle' &&
          belongsToCurrentSession(data.sessionID) &&
          soundStore.getSnapshot().currentSessionEnabled
        ) {
          playNotificationSoundDeduped('completed')
        }
      },

      // ============================================
      // Reconnected → 通知调用方刷新数据 + 重新拉取 session status
      // ============================================

      onReconnected: reason => {
        if (import.meta.env.DEV) {
          console.log(`[GlobalEvents] SSE reconnected (reason: ${reason}), notifying for data refresh`)
        }
        // 重连后重新拉取全量状态 + pending requests
        fetchAndInitialize()
        // 通知所有 pub/sub 消费者
        for (const consumer of sessionConsumers.values()) {
          consumer.callbacks.onReconnected?.(reason)
        }
      },
    })

    fetchAndInitialize()

    return () => {
      if (refreshRef.current === fetchAndInitialize) {
        refreshRef.current = null
      }
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    directoriesRef.current = directories
    if (initializedDirectoriesRef.current) {
      refreshRef.current?.()
      return
    }
    initializedDirectoriesRef.current = true
  }, [directories])
}
