// ============================================
// Global Event Subscription (SSE) - Singleton Pattern
// ============================================

import { API_BASE } from './http'
import type {
  ApiMessageWithParts,
  ApiPart,
  ApiSession,
  ApiPermissionRequest,
  PermissionReply,
  ApiQuestionRequest,
  GlobalEvent,
  EventCallbacks,
} from './types'

// ============================================
// Connection State
// ============================================

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error'

export interface ConnectionInfo {
  state: ConnectionState
  lastEventTime: number
  reconnectAttempt: number
  error?: string
}

// 全局连接状态（可以被外部订阅）
let connectionInfo: ConnectionInfo = {
  state: 'disconnected',
  lastEventTime: 0,
  reconnectAttempt: 0,
}

const connectionListeners = new Set<(info: ConnectionInfo) => void>()

function updateConnectionState(update: Partial<ConnectionInfo>) {
  connectionInfo = { ...connectionInfo, ...update }
  connectionListeners.forEach(fn => fn(connectionInfo))
}

export function getConnectionInfo(): ConnectionInfo {
  return connectionInfo
}

export function subscribeToConnectionState(fn: (info: ConnectionInfo) => void): () => void {
  connectionListeners.add(fn)
  // 立即发送当前状态
  fn(connectionInfo)
  return () => connectionListeners.delete(fn)
}

// ============================================
// Singleton SSE Connection
// ============================================

const RECONNECT_DELAYS = [1000, 2000, 3000, 5000, 10000, 30000]
const HEARTBEAT_TIMEOUT = 60000

// 所有订阅者的 callbacks
const allSubscribers = new Set<EventCallbacks>()

// 单例连接状态
let singletonController: AbortController | null = null
let heartbeatTimer: ReturnType<typeof setTimeout> | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let isConnecting = false

function resetHeartbeat() {
  if (heartbeatTimer) clearTimeout(heartbeatTimer)
  
  updateConnectionState({ lastEventTime: Date.now() })
  
  heartbeatTimer = setTimeout(() => {
    console.warn('[SSE] No events received for 60s, reconnecting...')
    updateConnectionState({ state: 'disconnected', error: 'Heartbeat timeout' })
    scheduleReconnect()
  }, HEARTBEAT_TIMEOUT)
}

function scheduleReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer)
  if (allSubscribers.size === 0) return // 没有订阅者就不重连
  
  const attempt = connectionInfo.reconnectAttempt
  const delay = RECONNECT_DELAYS[Math.min(attempt, RECONNECT_DELAYS.length - 1)]
  
  if (import.meta.env.DEV) {
    console.log(`[SSE] Reconnecting in ${delay}ms (attempt ${attempt + 1})...`)
  }
  
  reconnectTimer = setTimeout(() => {
    updateConnectionState({ reconnectAttempt: attempt + 1 })
    connectSingleton()
  }, delay)
}

function connectSingleton() {
  if (isConnecting || allSubscribers.size === 0) return
  if (connectionInfo.state === 'connected') return
  
  isConnecting = true
  singletonController = new AbortController()
  
  updateConnectionState({ state: 'connecting' })
  if (import.meta.env.DEV) {
    console.log('[SSE] Connecting singleton...')
  }

  fetch(`${API_BASE}/global/event`, {
    signal: singletonController.signal,
  })
    .then(async (response) => {
      isConnecting = false
      
      if (!response.ok) {
        throw new Error(`Failed to subscribe: ${response.status}`)
      }

      updateConnectionState({ 
        state: 'connected', 
        reconnectAttempt: 0,
        error: undefined 
      })
      resetHeartbeat()
      if (import.meta.env.DEV) {
        console.log('[SSE] Singleton connected')
      }

      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error('No response body')
      }

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          if (import.meta.env.DEV) {
            console.log('[SSE] Stream ended, reconnecting...')
          }
          updateConnectionState({ state: 'disconnected' })
          scheduleReconnect()
          break
        }

        resetHeartbeat()

        buffer += decoder.decode(value, { stream: true })
        
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        let eventData = ''

        for (const line of lines) {
          if (line.startsWith('data:')) {
            eventData = line.slice(5).trim()
          } else if (line === '' && eventData) {
            try {
              const globalEvent = JSON.parse(eventData) as GlobalEvent
              // 广播给所有订阅者
              broadcastEvent(globalEvent)
            } catch (e) {
              // SSE parse error - logged only in development
              if (import.meta.env.DEV) {
                console.warn('[SSE] Failed to parse event:', e, eventData)
              }
            }
            eventData = ''
          }
        }
      }
    })
    .catch((error) => {
      isConnecting = false
      
      if (error.name === 'AbortError') {
        return
      }
      // SSE stream error - logged for debugging
      if (import.meta.env.DEV) {
        console.warn('[SSE] Event stream error:', error)
      }
      updateConnectionState({ 
        state: 'error', 
        error: error.message || 'Connection failed' 
      })
      // 通知所有订阅者出错
      allSubscribers.forEach(cb => cb.onError?.(error))
      scheduleReconnect()
    })
}

function disconnectSingleton() {
  if (heartbeatTimer) clearTimeout(heartbeatTimer)
  if (reconnectTimer) clearTimeout(reconnectTimer)
  if (singletonController) {
    singletonController.abort()
    singletonController = null
  }
  isConnecting = false
  updateConnectionState({ state: 'disconnected' })
}

// 广播事件给所有订阅者
function broadcastEvent(globalEvent: GlobalEvent) {
  const { type, properties } = globalEvent.payload
  
  // 广播给所有订阅者
  allSubscribers.forEach(callbacks => {
    handleEventForSubscriber(type, properties, callbacks)
  })
}

function handleEventForSubscriber(
  type: string,
  properties: unknown,
  callbacks: EventCallbacks
) {
  switch (type) {
    case 'message.updated': {
      const data = properties as { info: ApiMessageWithParts['info'] }
      callbacks.onMessageUpdated?.(data.info)
      break
    }
    case 'message.part.updated': {
      const data = properties as { part: ApiPart }
      callbacks.onPartUpdated?.(data.part)
      break
    }
    case 'message.part.removed':
      callbacks.onPartRemoved?.(properties as { id: string; messageID: string; sessionID: string })
      break
    case 'session.updated': {
      const data = properties as { info: ApiSession }
      callbacks.onSessionUpdated?.(data.info)
      break
    }
    case 'session.created': {
      const data = properties as { info: ApiSession }
      callbacks.onSessionCreated?.(data.info)
      break
    }
    case 'session.error':
      callbacks.onSessionError?.(properties as { sessionID: string; name: string; data: unknown })
      break
    case 'session.idle':
      callbacks.onSessionIdle?.(properties as { sessionID: string })
      break
    case 'permission.asked':
      callbacks.onPermissionAsked?.(properties as ApiPermissionRequest)
      break
    case 'permission.replied':
      callbacks.onPermissionReplied?.(properties as { sessionID: string; requestID: string; reply: PermissionReply })
      break
    case 'question.asked':
      callbacks.onQuestionAsked?.(properties as ApiQuestionRequest)
      break
    case 'question.replied':
      callbacks.onQuestionReplied?.(properties as { sessionID: string; requestID: string; answers: string[][] })
      break
    case 'question.rejected':
      callbacks.onQuestionRejected?.(properties as { sessionID: string; requestID: string })
      break
    default:
      // 忽略其他事件类型
      break
  }
}

// ============================================
// Public API
// ============================================

/**
 * 订阅 SSE 事件（单例模式，多个订阅者共享一个连接）
 */
export function subscribeToEvents(callbacks: EventCallbacks): () => void {
  allSubscribers.add(callbacks)
  
  // 如果是第一个订阅者，启动连接
  if (allSubscribers.size === 1) {
    connectSingleton()
  }
  
  // 返回取消订阅函数
  return () => {
    allSubscribers.delete(callbacks)
    
    // 如果没有订阅者了，断开连接
    if (allSubscribers.size === 0) {
      disconnectSingleton()
    }
  }
}
