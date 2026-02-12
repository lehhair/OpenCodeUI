// ============================================
// Global Event Subscription (SSE) - Singleton Pattern
// ============================================

import { getApiBaseUrl, getAuthHeader } from './http'
import { isTauri } from '../utils/tauri'
import type {
  ApiMessageWithParts,
  ApiPart,
  ApiSession,
  ApiPermissionRequest,
  PermissionReply,
  ApiQuestionRequest,
  GlobalEvent,
  EventCallbacks,
  WorktreeReadyPayload,
  WorktreeFailedPayload,
  VcsBranchUpdatedPayload,
  TodoUpdatedPayload,
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
let lifecycleListenersRegistered = false
/** 标记连接曾经成功过（用于判断是否为"重连"） */
let hasConnectedBefore = false

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
  
  updateConnectionState({ state: 'connecting' })
  if (import.meta.env.DEV) {
    console.log('[SSE] Connecting singleton...')
  }

  // 注册生命周期监听器（首次连接时）
  registerLifecycleListeners()

  if (isTauri()) {
    connectViaTauri()
  } else {
    connectViaBrowser()
  }
}

// ============================================
// Tauri SSE Bridge (via Rust reqwest + Channel)
// ============================================

/** Tauri Channel 的 onmessage 事件类型 */
interface TauriSseEvent {
  event: 'connected' | 'message' | 'disconnected' | 'error'
  data?: {
    raw?: string
    reason?: string
    message?: string
  }
}

async function connectViaTauri() {
  try {
    const { invoke, Channel } = await import('@tauri-apps/api/core')

    const url = `${getApiBaseUrl()}/global/event`
    const authHeaders = getAuthHeader()
    const authHeader = authHeaders['Authorization'] || null

    const onEvent = new Channel<TauriSseEvent>()
    
    onEvent.onmessage = (msg: TauriSseEvent) => {
      switch (msg.event) {
        case 'connected': {
          isConnecting = false
          const isReconnect = hasConnectedBefore
          hasConnectedBefore = true

          updateConnectionState({
            state: 'connected',
            reconnectAttempt: 0,
            error: undefined,
          })
          resetHeartbeat()
          if (import.meta.env.DEV) {
            console.log('[SSE/Tauri] Connected', isReconnect ? '(reconnected)' : '(first)')
          }
          if (isReconnect) {
            allSubscribers.forEach(cb => cb.onReconnected?.())
          }
          break
        }
        case 'message': {
          resetHeartbeat()
          if (msg.data?.raw) {
            try {
              const globalEvent = JSON.parse(msg.data.raw) as GlobalEvent
              broadcastEvent(globalEvent)
            } catch (e) {
              if (import.meta.env.DEV) {
                console.warn('[SSE/Tauri] Failed to parse event:', e, msg.data.raw)
              }
            }
          }
          break
        }
        case 'disconnected': {
          isConnecting = false
          if (import.meta.env.DEV) {
            console.log('[SSE/Tauri] Disconnected:', msg.data?.reason)
          }
          updateConnectionState({ state: 'disconnected' })
          scheduleReconnect()
          break
        }
        case 'error': {
          isConnecting = false
          const errorMsg = msg.data?.message || 'Unknown error'
          if (import.meta.env.DEV) {
            console.warn('[SSE/Tauri] Error:', errorMsg)
          }
          updateConnectionState({
            state: 'error',
            error: errorMsg,
          })
          allSubscribers.forEach(cb => cb.onError?.(new Error(errorMsg)))
          scheduleReconnect()
          break
        }
      }
    }

    // 调用 Rust 命令启动 SSE 流
    // 注意：这个 invoke 会在 SSE 流结束或出错时 resolve/reject
    // 但事件通过 Channel 实时推送
    invoke('sse_connect', {
      args: { url, authHeader },
      onEvent,
    }).catch((error: unknown) => {
      isConnecting = false
      const errorMsg = error instanceof Error ? error.message : String(error)
      if (import.meta.env.DEV) {
        console.warn('[SSE/Tauri] invoke error:', errorMsg)
      }
      updateConnectionState({
        state: 'error',
        error: errorMsg,
      })
      allSubscribers.forEach(cb => cb.onError?.(new Error(errorMsg)))
      scheduleReconnect()
    })
  } catch (error) {
    isConnecting = false
    const errorMsg = error instanceof Error ? error.message : String(error)
    console.warn('[SSE/Tauri] Failed to initialize:', errorMsg)
    updateConnectionState({ state: 'error', error: errorMsg })
    scheduleReconnect()
  }
}

// ============================================
// Browser SSE (via fetch + ReadableStream)
// ============================================

function connectViaBrowser() {
  singletonController = new AbortController()

  // 如果配置了密码，添加 Authorization header
  fetch(`${getApiBaseUrl()}/global/event`, {
    signal: singletonController.signal,
    headers: {
      ...getAuthHeader(),
    },
  })
    .then(async (response) => {
      isConnecting = false
      
      if (!response.ok) {
        throw new Error(`Failed to subscribe: ${response.status}`)
      }

      // 如果之前连接过，这次就是"重连"，通知订阅者刷新数据
      const isReconnect = hasConnectedBefore
      hasConnectedBefore = true

      updateConnectionState({ 
        state: 'connected', 
        reconnectAttempt: 0,
        error: undefined 
      })
      resetHeartbeat()
      if (import.meta.env.DEV) {
        console.log('[SSE] Singleton connected', isReconnect ? '(reconnected)' : '(first)')
      }

      // 重连成功后通知所有订阅者
      if (isReconnect) {
        allSubscribers.forEach(cb => cb.onReconnected?.())
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
  
  // Tauri: 调用 Rust 侧断开命令
  if (isTauri()) {
    import('@tauri-apps/api/core').then(({ invoke }) => {
      invoke('sse_disconnect').catch(() => {})
    }).catch(() => {})
  }
  
  // Browser: abort fetch
  if (singletonController) {
    singletonController.abort()
    singletonController = null
  }
  
  isConnecting = false
  updateConnectionState({ state: 'disconnected' })
}

// ============================================
// Lifecycle Listeners (Visibility + Network)
// ============================================

function handleVisibilityChange() {
  if (document.visibilityState === 'visible') {
    // 页面恢复前台
    if (connectionInfo.state !== 'connected' && allSubscribers.size > 0) {
      if (import.meta.env.DEV) {
        console.log('[SSE] Page became visible, forcing reconnect...')
      }
      // 取消当前重连计划，立即重连
      if (reconnectTimer) clearTimeout(reconnectTimer)
      reconnectTimer = null
      updateConnectionState({ reconnectAttempt: 0 })
      
      // 断开旧连接
      if (isTauri()) {
        import('@tauri-apps/api/core').then(({ invoke }) => {
          invoke('sse_disconnect').catch(() => {})
        }).catch(() => {})
      }
      if (singletonController) {
        singletonController.abort()
        singletonController = null
      }
      isConnecting = false
      
      connectSingleton()
    }
  } else {
    // 页面进入后台 - 暂停心跳检测（移动端 timer 会被冻结）
    if (heartbeatTimer) {
      clearTimeout(heartbeatTimer)
      heartbeatTimer = null
    }
  }
}

function handleOnline() {
  if (import.meta.env.DEV) {
    console.log('[SSE] Network online, forcing reconnect...')
  }
  if (connectionInfo.state !== 'connected' && allSubscribers.size > 0) {
    if (reconnectTimer) clearTimeout(reconnectTimer)
    reconnectTimer = null
    updateConnectionState({ reconnectAttempt: 0 })
    
    if (isTauri()) {
      import('@tauri-apps/api/core').then(({ invoke }) => {
        invoke('sse_disconnect').catch(() => {})
      }).catch(() => {})
    }
    if (singletonController) {
      singletonController.abort()
      singletonController = null
    }
    isConnecting = false
    
    connectSingleton()
  }
}

function handleOffline() {
  if (import.meta.env.DEV) {
    console.log('[SSE] Network offline')
  }
  // 标记为断连，但不尝试重连（没网重连也没用）
  if (connectionInfo.state === 'connected' || connectionInfo.state === 'connecting') {
    if (isTauri()) {
      import('@tauri-apps/api/core').then(({ invoke }) => {
        invoke('sse_disconnect').catch(() => {})
      }).catch(() => {})
    }
    if (singletonController) {
      singletonController.abort()
      singletonController = null
    }
    isConnecting = false
    if (heartbeatTimer) clearTimeout(heartbeatTimer)
    if (reconnectTimer) clearTimeout(reconnectTimer)
    updateConnectionState({ state: 'disconnected', error: 'Network offline' })
  }
}

function registerLifecycleListeners() {
  if (lifecycleListenersRegistered) return
  lifecycleListenersRegistered = true
  
  document.addEventListener('visibilitychange', handleVisibilityChange)
  window.addEventListener('online', handleOnline)
  window.addEventListener('offline', handleOffline)
}

function unregisterLifecycleListeners() {
  if (!lifecycleListenersRegistered) return
  lifecycleListenersRegistered = false
  
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  window.removeEventListener('online', handleOnline)
  window.removeEventListener('offline', handleOffline)
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
    case 'worktree.ready':
      callbacks.onWorktreeReady?.(properties as WorktreeReadyPayload)
      break
    case 'worktree.failed':
      callbacks.onWorktreeFailed?.(properties as WorktreeFailedPayload)
      break
    case 'vcs.branch.updated':
      callbacks.onVcsBranchUpdated?.(properties as VcsBranchUpdatedPayload)
      break
    case 'todo.updated':
      callbacks.onTodoUpdated?.(properties as TodoUpdatedPayload)
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
    
    // 如果没有订阅者了，断开连接并清理监听器
    if (allSubscribers.size === 0) {
      disconnectSingleton()
      unregisterLifecycleListeners()
    }
  }
}
