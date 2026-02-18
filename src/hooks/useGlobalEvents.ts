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
import { messageStore, childSessionStore } from '../store'
import { activeSessionStore } from '../store/activeSessionStore'
import { notificationStore } from '../store/notificationStore'
import { subscribeToEvents, getSessionStatus, getPendingPermissions, getPendingQuestions } from '../api'
import type { 
  ApiMessage, 
  ApiPart,
  ApiPermissionRequest,
  ApiQuestionRequest,
} from '../api/types'

interface GlobalEventsCallbacks {
  onPermissionAsked?: (request: ApiPermissionRequest) => void
  onPermissionReplied?: (data: { sessionID: string; requestID: string }) => void
  onQuestionAsked?: (request: ApiQuestionRequest) => void
  onQuestionReplied?: (data: { sessionID: string; requestID: string }) => void
  onQuestionRejected?: (data: { sessionID: string; requestID: string }) => void
  onScrollRequest?: () => void
  onSessionIdle?: (sessionID: string) => void
  onSessionError?: (sessionID: string) => void
  /** SSE 重连成功后触发，调用方可刷新当前 session 数据 */
  onReconnected?: (reason: 'network' | 'server-switch') => void
}

// ============================================
// 待处理请求缓存 - 处理 permission/question 事件先于 session.created 到达的时序问题
// ============================================
interface PendingRequest<T> {
  request: T
  timestamp: number
}

const pendingPermissions = new Map<string, PendingRequest<ApiPermissionRequest>>()
const pendingQuestions = new Map<string, PendingRequest<ApiQuestionRequest>>()

// 5秒后过期，防止内存泄漏
const PENDING_TIMEOUT = 5000

function cleanupExpired<T>(map: Map<string, PendingRequest<T>>) {
  const now = Date.now()
  for (const [key, value] of map) {
    if (now - value.timestamp > PENDING_TIMEOUT) {
      map.delete(key)
    }
  }
}

/**
 * 检查 sessionID 是否属于当前 session 或其子 session
 */
function belongsToCurrentSession(sessionId: string): boolean {
  const currentSessionId = messageStore.getCurrentSessionId()
  if (!currentSessionId) return false
  
  // 是当前 session
  if (sessionId === currentSessionId) return true
  
  // 是当前 session 的子 session
  return childSessionStore.belongsToSession(sessionId, currentSessionId)
}

export function useGlobalEvents(callbacks?: GlobalEventsCallbacks) {
  // 使用 ref 保存 callbacks，避免重新订阅 SSE
  const callbacksRef = useRef(callbacks)
  callbacksRef.current = callbacks

  useEffect(() => {
    // 节流滚动
    let scrollPending = false
    const scheduleScroll = () => {
      if (scrollPending) return
      scrollPending = true
      requestAnimationFrame(() => {
        scrollPending = false
        callbacksRef.current?.onScrollRequest?.()
      })
    }

    // ============================================
    // 拉取 session 状态 + pending requests（初始化 & 重连共用）
    // ============================================

    const fetchAndInitialize = () => {
      Promise.all([
        getSessionStatus().catch(() => ({} as Record<string, import('../types/api/session').SessionStatus>)),
        getPendingPermissions().catch(() => []),
        getPendingQuestions().catch(() => []),
      ]).then(([statusMap, permissions, questions]) => {
        activeSessionStore.initialize(statusMap)
        if (permissions.length > 0 || questions.length > 0) {
          activeSessionStore.initializePendingRequests(permissions, questions)
        }
      })
    }

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
          scheduleScroll()
        }
      },

      onPartDelta: (data) => {
        messageStore.handlePartDelta(data)
        scheduleScroll()
      },

      onPartRemoved: (data) => {
        messageStore.handlePartRemoved(data)
      },

      // ============================================
      // Session Events → childSessionStore
      // ============================================

      onSessionCreated: (session) => {
        // 注册子 session 关系
        if (session.parentID) {
          childSessionStore.registerChildSession(session)
          
          // 处理因时序问题缓存的权限请求
          const pendingPermission = pendingPermissions.get(session.id)
          if (pendingPermission && belongsToCurrentSession(session.id)) {
            callbacksRef.current?.onPermissionAsked?.(pendingPermission.request)
            pendingPermissions.delete(session.id)
          }
          
          // 处理因时序问题缓存的问题请求
          const pendingQuestion = pendingQuestions.get(session.id)
          if (pendingQuestion && belongsToCurrentSession(session.id)) {
            callbacksRef.current?.onQuestionAsked?.(pendingQuestion.request)
            pendingQuestions.delete(session.id)
          }
        }
        
        // 更新 session meta 供 active tab 使用
        activeSessionStore.setSessionMeta(session.id, session.title, session.directory)
        
        // 清理过期缓存
        cleanupExpired(pendingPermissions)
        cleanupExpired(pendingQuestions)
      },

      onSessionIdle: (data) => {
        messageStore.handleSessionIdle(data.sessionID)
        childSessionStore.markIdle(data.sessionID)
        callbacksRef.current?.onSessionIdle?.(data.sessionID)
      },

      onSessionError: (error) => {
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
          }
        }
        callbacksRef.current?.onSessionError?.(error.sessionID)
      },

      onSessionUpdated: (session) => {
        // 更新 session meta 供 active tab 使用
        activeSessionStore.setSessionMeta(session.id, session.title, session.directory)
        if (session.parentID) {
          childSessionStore.registerChildSession(session)
        }
      },

      // ============================================
      // Permission Events → callbacks (通过 ref 调用)
      // 关键变化：不仅处理当前 session，也处理子 session 的权限请求
      // 时序处理：如果 session 还没注册，缓存请求等 session.created 后处理
      // ============================================
      
      onPermissionAsked: (request) => {
        const meta = activeSessionStore.getSessionMeta(request.sessionID)
        const sessionLabel = meta?.title || request.sessionID.slice(0, 8)
        const desc = request.patterns?.length
          ? `${request.permission}: ${request.patterns[0]}`
          : request.permission

        // Active 列表：注册 pending request
        activeSessionStore.addPendingRequest(request.id, request.sessionID, 'permission', desc)

        // Toast 通知 — 不属于当前 session family 的才弹
        if (!belongsToCurrentSession(request.sessionID)) {
          notificationStore.push('permission', `${sessionLabel} — Permission`, desc, request.sessionID, meta?.directory)
        }

        // 回调给 UI 处理权限弹框
        if (belongsToCurrentSession(request.sessionID)) {
          callbacksRef.current?.onPermissionAsked?.(request)
        } else {
          pendingPermissions.set(request.sessionID, {
            request,
            timestamp: Date.now(),
          })
        }
      },

      onPermissionReplied: (data) => {
        pendingPermissions.delete(data.sessionID)
        activeSessionStore.resolvePendingRequest(data.requestID)
        
        if (belongsToCurrentSession(data.sessionID)) {
          callbacksRef.current?.onPermissionReplied?.(data)
        }
      },

      // ============================================
      // Question Events
      // ============================================

      onQuestionAsked: (request) => {
        const meta = activeSessionStore.getSessionMeta(request.sessionID)
        const sessionLabel = meta?.title || request.sessionID.slice(0, 8)
        const desc = request.questions?.[0]?.header || 'AI is waiting for your input'

        // Active 列表：注册 pending request
        activeSessionStore.addPendingRequest(request.id, request.sessionID, 'question', desc)

        // Toast 通知
        if (!belongsToCurrentSession(request.sessionID)) {
          notificationStore.push('question', `${sessionLabel} — Question`, desc, request.sessionID, meta?.directory)
        }

        if (belongsToCurrentSession(request.sessionID)) {
          callbacksRef.current?.onQuestionAsked?.(request)
        } else {
          pendingQuestions.set(request.sessionID, {
            request,
            timestamp: Date.now(),
          })
        }
      },

      onQuestionReplied: (data) => {
        pendingQuestions.delete(data.sessionID)
        activeSessionStore.resolvePendingRequest(data.requestID)
        
        if (belongsToCurrentSession(data.sessionID)) {
          callbacksRef.current?.onQuestionReplied?.(data)
        }
      },

      onQuestionRejected: (data) => {
        pendingQuestions.delete(data.sessionID)
        activeSessionStore.resolvePendingRequest(data.requestID)
        
        if (belongsToCurrentSession(data.sessionID)) {
          callbacksRef.current?.onQuestionRejected?.(data)
        }
      },

      // ============================================
      // Session Status → activeSessionStore
      // ============================================

      onSessionStatus: (data) => {
        const prevStatus = activeSessionStore.getSnapshot().statusMap[data.sessionID]
        const wasBusy = prevStatus && (prevStatus.type === 'busy' || prevStatus.type === 'retry')

        activeSessionStore.updateStatus(data.sessionID, data.status)

        // Toast — session 从 busy/retry 变成 idle 时弹 completed 通知
        if (wasBusy && data.status.type === 'idle' && !belongsToCurrentSession(data.sessionID)) {
          const meta = activeSessionStore.getSessionMeta(data.sessionID)
          const sessionLabel = meta?.title || data.sessionID.slice(0, 8)
          notificationStore.push('completed', sessionLabel, 'Session completed', data.sessionID, meta?.directory)
        }
      },

      // ============================================
      // Reconnected → 通知调用方刷新数据 + 重新拉取 session status
      // ============================================

      onReconnected: (reason) => {
        if (import.meta.env.DEV) {
          console.log(`[GlobalEvents] SSE reconnected (reason: ${reason}), notifying for data refresh`)
        }
        // 重连后重新拉取全量状态 + pending requests
        fetchAndInitialize()
        callbacksRef.current?.onReconnected?.(reason)
      },
    })

    fetchAndInitialize()

    return unsubscribe
  }, []) // 空依赖，只订阅一次
}
