// ============================================
// useGlobalEvents - 全局 SSE 事件订阅
// ============================================
// 
// 职责：
// 1. 订阅全局 SSE 事件流
// 2. 将事件分发到 messageStore
// 3. 与具体 session 无关，处理所有 session 的事件

import { useEffect, useRef } from 'react'
import { messageStore } from '../store'
import { subscribeToEvents } from '../api'
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

    const unsubscribe = subscribeToEvents({
      // ============================================
      // Message Events → messageStore
      // ============================================
      
      onMessageUpdated: (apiMsg: ApiMessage) => {
        messageStore.handleMessageUpdated(apiMsg)
      },

      onPartUpdated: (apiPart: ApiPart) => {
        console.log('[GlobalEvents] onPartUpdated received:', {
          id: apiPart.id,
          type: apiPart.type,
          hasSessionID: 'sessionID' in apiPart,
          hasMessageID: 'messageID' in apiPart,
          sessionID: (apiPart as any).sessionID,
          messageID: (apiPart as any).messageID,
        })
        
        if ('sessionID' in apiPart && 'messageID' in apiPart) {
          messageStore.handlePartUpdated(apiPart as ApiPart & { sessionID: string; messageID: string })
          scheduleScroll()
        } else {
          console.warn('[GlobalEvents] Part missing sessionID or messageID, skipping')
        }
      },

      onPartRemoved: (data) => {
        messageStore.handlePartRemoved(data)
      },

      onSessionIdle: (data) => {
        messageStore.handleSessionIdle(data.sessionID)
      },

      onSessionError: (error) => {
        const isAbort = error.name === 'MessageAbortedError' || error.name === 'AbortError'
        if (!isAbort) {
          console.error('[GlobalEvents] Session error:', error)
        }
        messageStore.handleSessionError(error.sessionID)
      },

      onSessionUpdated: (session) => {
        // 可以在这里更新 session 标题等信息
        console.log('[GlobalEvents] Session updated:', session.id, session.title)
      },

      // ============================================
      // Permission Events → callbacks (通过 ref 调用)
      // ============================================
      
      onPermissionAsked: (request) => {
        const currentSessionId = messageStore.getCurrentSessionId()
        if (request.sessionID === currentSessionId) {
          callbacksRef.current?.onPermissionAsked?.(request)
        }
      },

      onPermissionReplied: (data) => {
        const currentSessionId = messageStore.getCurrentSessionId()
        if (data.sessionID === currentSessionId) {
          callbacksRef.current?.onPermissionReplied?.(data)
        }
      },

      // ============================================
      // Question Events → callbacks (通过 ref 调用)
      // ============================================

      onQuestionAsked: (request) => {
        const currentSessionId = messageStore.getCurrentSessionId()
        if (request.sessionID === currentSessionId) {
          callbacksRef.current?.onQuestionAsked?.(request)
        }
      },

      onQuestionReplied: (data) => {
        const currentSessionId = messageStore.getCurrentSessionId()
        if (data.sessionID === currentSessionId) {
          callbacksRef.current?.onQuestionReplied?.(data)
        }
      },

      onQuestionRejected: (data) => {
        const currentSessionId = messageStore.getCurrentSessionId()
        if (data.sessionID === currentSessionId) {
          callbacksRef.current?.onQuestionRejected?.(data)
        }
      },
    })

    return unsubscribe
  }, []) // 空依赖，只订阅一次
}
