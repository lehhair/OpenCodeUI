// ============================================
// SSE 事件处理 Hook (新版 - 直接操作 Message 数据)
// ============================================

import { useEffect, useRef } from 'react'
import { subscribeToEvents } from '../../api'
import type { 
  ApiPart, 
  ApiPermissionRequest, 
  ApiQuestionRequest,
  ApiMessage,
} from '../../api'
import type { Message, Part, MessageInfo } from '../../types/message'

// ============================================
// Types
// ============================================

export interface SessionEventsCallbacks {
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>
  setIsIdle: React.Dispatch<React.SetStateAction<boolean>>
  setPendingPermissionRequests: React.Dispatch<React.SetStateAction<ApiPermissionRequest[]>>
  setPendingQuestionRequests: React.Dispatch<React.SetStateAction<ApiQuestionRequest[]>>
  /** 只有用户在底部且未在滚动时才滚动 */
  scrollToBottomIfAtBottom: () => void
}

// ============================================
// Hook
// ============================================

export function useSessionEvents(
  currentSessionIdRef: React.MutableRefObject<string | null>,
  callbacks: SessionEventsCallbacks
) {
  const callbacksRef = useRef(callbacks)
  callbacksRef.current = callbacks
  
  // 节流滚动：使用 rAF 确保每帧最多滚动一次
  const scrollPendingRef = useRef(false)
  const scheduleScroll = () => {
    if (scrollPendingRef.current) return
    scrollPendingRef.current = true
    requestAnimationFrame(() => {
      scrollPendingRef.current = false
      callbacksRef.current.scrollToBottomIfAtBottom()
    })
  }

  useEffect(() => {
    const unsubscribe = subscribeToEvents({
      // 消息创建/更新事件
      onMessageUpdated: (apiMsg: ApiMessage) => {
        if (apiMsg.sessionID !== currentSessionIdRef.current) return

        callbacksRef.current.setMessages(prev => {
          const existing = prev.find(m => m.info.id === apiMsg.id)
          if (existing) {
            // 更新现有消息的 info
            return prev.map(m => 
              m.info.id === apiMsg.id 
                ? { ...m, info: apiMsg as MessageInfo }
                : m
            )
          }

          // 创建新消息
          const newMsg: Message = {
            info: apiMsg as MessageInfo,
            parts: [],
            isStreaming: apiMsg.role === 'assistant',
          }
          
          // 只有创建新 assistant 消息时才设置为非 idle
          if (apiMsg.role === 'assistant') {
            callbacksRef.current.setIsIdle(false)
          }
          
          return [...prev, newMsg]
        })
      },

      // Part 更新事件
      onPartUpdated: (apiPart: ApiPart) => {
        if (!('sessionID' in apiPart) || !('messageID' in apiPart)) return
        
        const sessionId = (apiPart as { sessionID: string }).sessionID
        const messageId = (apiPart as { messageID: string }).messageID
        
        if (sessionId !== currentSessionIdRef.current) return

        callbacksRef.current.setMessages(prev => prev.map(m => {
          if (m.info.id !== messageId) return m
          
          // 查找是否已存在此 part
          const existingIndex = m.parts.findIndex(p => p.id === apiPart.id)
          
          if (existingIndex >= 0) {
            // 更新现有 part
            const newParts = [...m.parts]
            newParts[existingIndex] = apiPart as Part
            return { ...m, parts: newParts }
          }
          
          // 添加新 part
          return { ...m, parts: [...m.parts, apiPart as Part] }
        }))

        // 节流滚动，避免频繁调用
        scheduleScroll()
      },

      // Part 移除事件
      onPartRemoved: (data: { id: string; messageID: string; sessionID: string }) => {
        if (data.sessionID !== currentSessionIdRef.current) return

        callbacksRef.current.setMessages(prev => prev.map(m => {
          if (m.info.id !== data.messageID) return m
          return { ...m, parts: m.parts.filter(p => p.id !== data.id) }
        }))
      },

      // Session 空闲
      onSessionIdle: (data) => {
        if (data.sessionID !== currentSessionIdRef.current) return

        callbacksRef.current.setMessages(prev => prev.map(m =>
          m.isStreaming ? { ...m, isStreaming: false } : m
        ))
        callbacksRef.current.setIsIdle(true)
      },

      // Session 错误
      onSessionError: (error) => {
        if (error.sessionID !== currentSessionIdRef.current) return

        const isAbort = error.name === 'MessageAbortedError' || error.name === 'AbortError'
        if (!isAbort && import.meta.env.DEV) {
          console.warn('[MessageEvents] Session error:', error)
        }

        callbacksRef.current.setMessages(prev => prev.map(m =>
          m.isStreaming ? { ...m, isStreaming: false } : m
        ))
        callbacksRef.current.setIsIdle(true)
      },

      onSessionUpdated: () => {
        // Session title 更新等事件，暂不需要处理
      },

      // 权限请求
      onPermissionAsked: (request) => {
        if (request.sessionID !== currentSessionIdRef.current) return
        callbacksRef.current.setPendingPermissionRequests(prev => {
          if (prev.some(r => r.id === request.id)) return prev
          return [...prev, request]
        })
      },

      onPermissionReplied: (data) => {
        if (data.sessionID !== currentSessionIdRef.current) return
        callbacksRef.current.setPendingPermissionRequests(prev => 
          prev.filter(r => r.id !== data.requestID)
        )
      },

      // 问题请求
      onQuestionAsked: (request) => {
        if (request.sessionID !== currentSessionIdRef.current) return
        callbacksRef.current.setPendingQuestionRequests(prev => {
          if (prev.some(r => r.id === request.id)) return prev
          return [...prev, request]
        })
      },

      onQuestionReplied: (data) => {
        if (data.sessionID !== currentSessionIdRef.current) return
        callbacksRef.current.setPendingQuestionRequests(prev => 
          prev.filter(r => r.id !== data.requestID)
        )
      },

      onQuestionRejected: (data) => {
        if (data.sessionID !== currentSessionIdRef.current) return
        callbacksRef.current.setPendingQuestionRequests(prev => 
          prev.filter(r => r.id !== data.requestID)
        )
      },
    })

    return () => unsubscribe()
  }, [])
}
