// ============================================
// Global Event Subscription (SSE) - Singleton Pattern
// ============================================

import { getApiBaseUrl, getAuthHeader } from './http'
import { normalizeTodoItems } from './todo'
import { isTauri } from '../utils/tauri'
import type { EventCallbacks, EventType, GlobalEvent, SessionErrorPayload, TodoUpdatedPayload } from './types'
import { EventTypes } from '../types/api/event'

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
/** 后台时使用更激进的重连延迟，确保尽快恢复连接 */
const BACKGROUND_RECONNECT_DELAYS = [500, 1000, 2000, 3000, 5000, 10000]
const HEARTBEAT_TIMEOUT = 60000
/** 后台时的心跳超时（更宽松，因为后台 timer 可能不准） */
const BACKGROUND_HEARTBEAT_TIMEOUT = 120000
/** 后台 keepalive 间隔：定期检查连接是否还活着 */
const BACKGROUND_KEEPALIVE_INTERVAL = 30000

// 所有订阅者的 callbacks
const allSubscribers = new Set<EventCallbacks>()

const EVENT_TYPE_SET = new Set<string>(Object.values(EventTypes))

// 单例连接状态
let singletonController: AbortController | null = null
let heartbeatTimer: ReturnType<typeof setTimeout> | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let keepaliveTimer: ReturnType<typeof setInterval> | null = null
let isConnecting = false
let lifecycleListenersRegistered = false
/** 连接代次，每次 reconnectSSE() 递增，旧代次的事件会被丢弃 */
let connectionGeneration = 0
/** 当前是否在后台 */
let isInBackground = false
/** 是否因为切换服务器而触发的重连 */
let isServerSwitch = false
/** 上一次 sse_disconnect 的 Promise，用于串行化 Tauri 侧的 disconnect → connect */
let pendingDisconnect: Promise<void> = Promise.resolve()

/**
 * 请求 Tauri 侧断开 SSE 连接
 * 返回 Promise，调用方可以 await 确保断开完成后再发起新连接
 * 多次并发调用会自动串行化
 */
function disconnectTauri(): Promise<void> {
  if (!isTauri()) return Promise.resolve()

  const p = pendingDisconnect.then(() =>
    import('@tauri-apps/api/core').then(({ invoke }) => invoke('sse_disconnect').then(() => undefined)).catch(() => {}),
  )
  pendingDisconnect = p
  return p
}

function resetHeartbeat() {
  if (heartbeatTimer) clearTimeout(heartbeatTimer)

  updateConnectionState({ lastEventTime: Date.now() })

  // 后台时使用更宽松的超时，因为移动端后台 timer 可能被冻结/延迟
  const timeout = isInBackground ? BACKGROUND_HEARTBEAT_TIMEOUT : HEARTBEAT_TIMEOUT

  heartbeatTimer = setTimeout(() => {
    console.warn(`[SSE] No events received for ${timeout / 1000}s, reconnecting...`)
    updateConnectionState({ state: 'disconnected', error: 'Heartbeat timeout' })
    scheduleReconnect()
  }, timeout)
}

function scheduleReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer)
  if (allSubscribers.size === 0) return // 没有订阅者就不重连

  const attempt = connectionInfo.reconnectAttempt
  // 后台时使用更激进的重连策略
  const delays = isInBackground ? BACKGROUND_RECONNECT_DELAYS : RECONNECT_DELAYS
  const delay = delays[Math.min(attempt, delays.length - 1)]

  if (import.meta.env.DEV) {
    console.log(`[SSE] Reconnecting in ${delay}ms (attempt ${attempt + 1}, background: ${isInBackground})...`)
  }

  reconnectTimer = setTimeout(() => {
    updateConnectionState({ reconnectAttempt: attempt + 1 })
    connectSingleton()
  }, delay)
}

function connectSingleton() {
  if (isConnecting || allSubscribers.size === 0) return

  // 如果状态声称 connected，验证连接是否真的活着
  if (connectionInfo.state === 'connected') {
    const timeSinceLastEvent = Date.now() - connectionInfo.lastEventTime
    // 后台时使用更宽松的超时判断
    const staleTimeout = isInBackground ? BACKGROUND_HEARTBEAT_TIMEOUT : HEARTBEAT_TIMEOUT
    if (timeSinceLastEvent > staleTimeout) {
      // 太久没收到事件，连接可能已死，强制断开再重连
      if (import.meta.env.DEV) {
        console.log(
          `[SSE] connectSingleton: state=connected but stale (${Math.round(timeSinceLastEvent / 1000)}s), forcing disconnect`,
        )
      }
      connectionGeneration++
      disconnectTauri()
      if (singletonController) {
        singletonController.abort()
        singletonController = null
      }
      updateConnectionState({ state: 'disconnected' })
    } else {
      return // 连接确实还活着
    }
  }

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
    // 等待上一次 disconnect 完成，避免 Rust 侧 connect/disconnect 竞争
    await pendingDisconnect

    const { invoke, Channel } = await import('@tauri-apps/api/core')

    const url = `${getApiBaseUrl()}/global/event`
    const authHeaders = getAuthHeader()
    const authHeader = authHeaders['Authorization'] || null

    // 捕获当前连接代次，旧代次的事件一律丢弃
    const myGeneration = connectionGeneration

    const onEvent = new Channel<TauriSseEvent>()

    onEvent.onmessage = (msg: TauriSseEvent) => {
      // 代次不匹配，说明已经 reconnect 过了，忽略旧连接的事件
      if (myGeneration !== connectionGeneration) return

      switch (msg.event) {
        case 'connected': {
          isConnecting = false

          updateConnectionState({
            state: 'connected',
            reconnectAttempt: 0,
            error: undefined,
          })
          resetHeartbeat()
          if (import.meta.env.DEV) {
            console.log('[SSE/Tauri] Connected')
          }
          // 每次连接成功都通知订阅者刷新数据
          // 覆盖场景：首次连接（先开 UI 后开 server）、网络重连、服务器切换
          const reason = isServerSwitch ? ('server-switch' as const) : ('network' as const)
          isServerSwitch = false
          allSubscribers.forEach(cb => cb.onReconnected?.(reason))
          break
        }
        case 'message': {
          resetHeartbeat()
          if (msg.data?.raw) {
            const globalEvent = parseGlobalEvent(msg.data.raw)
            if (globalEvent) {
              broadcastEvent(globalEvent)
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

  // 捕获当前连接代次
  const myGeneration = connectionGeneration

  fetch(`${getApiBaseUrl()}/global/event`, {
    signal: singletonController.signal,
    headers: {
      Accept: 'text/event-stream',
      ...getAuthHeader(),
    },
  })
    .then(async response => {
      isConnecting = false

      if (!response.ok) {
        throw new Error(`Failed to subscribe: ${response.status}`)
      }

      updateConnectionState({
        state: 'connected',
        reconnectAttempt: 0,
        error: undefined,
      })
      resetHeartbeat()
      if (import.meta.env.DEV) {
        console.log('[SSE] Singleton connected')
      }

      // 每次连接成功都通知订阅者刷新数据
      // 覆盖场景：首次连接（先开 UI 后开 server）、网络重连、服务器切换
      const reason = isServerSwitch ? ('server-switch' as const) : ('network' as const)
      isServerSwitch = false
      allSubscribers.forEach(cb => cb.onReconnected?.(reason))

      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error('No response body')
      }

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        // 代次不匹配，说明已经 reconnect 过了，停止读取旧流
        if (myGeneration !== connectionGeneration) {
          reader.cancel().catch(() => {})
          break
        }

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

        // SSE spec: 多行 data 用 \n 拼接，空行触发 dispatch
        const dataLines: string[] = []

        for (const rawLine of lines) {
          // 兼容 CRLF：剥掉尾部 \r
          const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine

          if (line.startsWith('data:')) {
            // SSE spec: "data:" 后面可以有可选空格
            const payload = line[5] === ' ' ? line.slice(6) : line.slice(5)
            dataLines.push(payload)
          } else if (line === '') {
            // 空行 = 事件结束，dispatch 已积累的 data
            if (dataLines.length > 0) {
              const eventData = dataLines.join('\n')
              dataLines.length = 0
              const globalEvent = parseGlobalEvent(eventData)
              if (globalEvent) {
                broadcastEvent(globalEvent)
              }
            }
          }
          // SSE spec: 忽略 "event:", "id:", "retry:" 等其他字段（当前不需要）
        }
      }
    })
    .catch(error => {
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
        error: error.message || 'Connection failed',
      })
      // 通知所有订阅者出错
      allSubscribers.forEach(cb => cb.onError?.(error))
      scheduleReconnect()
    })
}

function parseGlobalEvent(raw: string): GlobalEvent | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    return isGlobalEvent(parsed) ? parsed : null
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[SSE] Failed to parse event:', error, raw)
    }
    return null
  }
}

function isGlobalEvent(value: unknown): value is GlobalEvent {
  if (!isRecord(value)) return false
  if (typeof value.directory !== 'string') return false
  if (!isRecord(value.payload)) return false
  if (!isEventType(value.payload.type)) return false
  return 'properties' in value.payload
}

function isEventType(value: unknown): value is EventType {
  return typeof value === 'string' && EVENT_TYPE_SET.has(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

// ============================================
// Background Keepalive
// ============================================

/**
 * 后台 keepalive：定期检查连接是否还活着
 * 移动端后台时 SSE 连接可能静默断开，timer 也可能被冻结
 * 这个轮询机制可以在 timer 恢复执行时及时发现连接已死
 */
function startBackgroundKeepalive() {
  stopBackgroundKeepalive()

  keepaliveTimer = setInterval(() => {
    const now = Date.now()
    const timeSinceLastEvent = now - connectionInfo.lastEventTime
    const timeout = BACKGROUND_HEARTBEAT_TIMEOUT

    if (import.meta.env.DEV) {
      console.log(
        `[SSE] Background keepalive check: last event ${Math.round(timeSinceLastEvent / 1000)}s ago, state=${connectionInfo.state}`,
      )
    }

    if (connectionInfo.state === 'connected' && timeSinceLastEvent > timeout) {
      // 连接声称是 connected，但已经太久没收到事件了 — 连接可能已经静默断开
      console.warn('[SSE] Background keepalive: connection appears dead, forcing reconnect')

      // 断开旧连接
      disconnectTauri()
      if (singletonController) {
        singletonController.abort()
        singletonController = null
      }
      isConnecting = false
      connectionGeneration++

      updateConnectionState({ state: 'disconnected', error: 'Background keepalive timeout' })
      scheduleReconnect()
    } else if (connectionInfo.state === 'disconnected' || connectionInfo.state === 'error') {
      // 已知断连状态，但可能 reconnectTimer 被后台冻结了 — 主动触发重连
      if (!reconnectTimer && !isConnecting) {
        console.warn('[SSE] Background keepalive: detected stale disconnect, forcing reconnect')
        updateConnectionState({ reconnectAttempt: 0 })
        connectSingleton()
      }
    }
  }, BACKGROUND_KEEPALIVE_INTERVAL)
}

function stopBackgroundKeepalive() {
  if (keepaliveTimer) {
    clearInterval(keepaliveTimer)
    keepaliveTimer = null
  }
}

function disconnectSingleton() {
  if (heartbeatTimer) clearTimeout(heartbeatTimer)
  if (reconnectTimer) clearTimeout(reconnectTimer)
  stopBackgroundKeepalive()

  // Tauri: 调用 Rust 侧断开命令
  disconnectTauri()

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
    isInBackground = false
    stopBackgroundKeepalive()

    if (import.meta.env.DEV) {
      console.log(
        `[SSE] Page became visible, state=${connectionInfo.state}, lastEvent=${Math.round((Date.now() - connectionInfo.lastEventTime) / 1000)}s ago`,
      )
    }

    if (allSubscribers.size === 0) return

    if (connectionInfo.state !== 'connected') {
      // 明确断连，立即重连
      if (import.meta.env.DEV) {
        console.log('[SSE] Page visible: not connected, forcing reconnect...')
      }
      forceReconnectNow()
    } else {
      // 状态是 connected，但连接可能已经在后台静默断开
      // 检查最后一次收到事件的时间
      const timeSinceLastEvent = Date.now() - connectionInfo.lastEventTime
      if (timeSinceLastEvent > HEARTBEAT_TIMEOUT) {
        // 太久没收到事件了，连接大概率已死
        console.warn(
          `[SSE] Page visible: connection may be stale (last event ${Math.round(timeSinceLastEvent / 1000)}s ago), forcing reconnect`,
        )
        forceReconnectNow()
      } else {
        // 连接看起来还活着，重置心跳为前台模式
        resetHeartbeat()
      }
    }
  } else {
    // 页面进入后台
    isInBackground = true

    if (import.meta.env.DEV) {
      console.log('[SSE] Page entering background, switching to background mode')
    }

    // 不再清除心跳！保持心跳运行，但切换为后台模式（更长超时）
    // 心跳 timer 可能在后台被冻结，但 keepalive 轮询会在 timer 恢复时补上
    resetHeartbeat()

    // 启动后台 keepalive 轮询
    if (allSubscribers.size > 0) {
      startBackgroundKeepalive()
    }
  }
}

/**
 * 强制立即重连：断开旧连接、重置计数器、立即发起新连接
 */
function forceReconnectNow() {
  if (reconnectTimer) clearTimeout(reconnectTimer)
  reconnectTimer = null
  updateConnectionState({ reconnectAttempt: 0 })

  // 断开旧连接
  connectionGeneration++
  disconnectTauri()
  if (singletonController) {
    singletonController.abort()
    singletonController = null
  }
  isConnecting = false

  connectSingleton()
}

function handleOnline() {
  if (import.meta.env.DEV) {
    console.log('[SSE] Network online, forcing reconnect...')
  }
  if (connectionInfo.state !== 'connected' && allSubscribers.size > 0) {
    forceReconnectNow()
  }
}

function handleOffline() {
  if (import.meta.env.DEV) {
    console.log('[SSE] Network offline')
  }
  // 标记为断连，但不尝试重连（没网重连也没用）
  if (connectionInfo.state === 'connected' || connectionInfo.state === 'connecting') {
    connectionGeneration++
    disconnectTauri()
    if (singletonController) {
      singletonController.abort()
      singletonController = null
    }
    isConnecting = false
    if (heartbeatTimer) clearTimeout(heartbeatTimer)
    if (reconnectTimer) clearTimeout(reconnectTimer)
    stopBackgroundKeepalive()
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
  // 广播给所有订阅者
  allSubscribers.forEach(callbacks => {
    handleEventForSubscriber(globalEvent.payload, callbacks)
  })
}

function handleEventForSubscriber(payload: GlobalEvent['payload'], callbacks: EventCallbacks) {
  switch (payload.type) {
    case EventTypes.MESSAGE_UPDATED: {
      callbacks.onMessageUpdated?.(payload.properties.info)
      break
    }
    case EventTypes.MESSAGE_PART_UPDATED: {
      callbacks.onPartUpdated?.(payload.properties.part)
      break
    }
    case EventTypes.MESSAGE_PART_DELTA: {
      callbacks.onPartDelta?.(payload.properties)
      break
    }
    case EventTypes.MESSAGE_PART_REMOVED:
      callbacks.onPartRemoved?.(payload.properties)
      break
    case EventTypes.SESSION_UPDATED: {
      callbacks.onSessionUpdated?.(payload.properties.info)
      break
    }
    case EventTypes.SESSION_CREATED: {
      callbacks.onSessionCreated?.(payload.properties.info)
      break
    }
    case EventTypes.SESSION_DELETED: {
      callbacks.onSessionDeleted?.(payload.properties.sessionID)
      break
    }
    case EventTypes.PROJECT_UPDATED: {
      callbacks.onProjectUpdated?.(payload.properties)
      break
    }
    case EventTypes.SESSION_ERROR:
      callbacks.onSessionError?.(normalizeSessionError(payload.properties))
      break
    case EventTypes.SESSION_IDLE:
      callbacks.onSessionIdle?.(payload.properties)
      break
    case EventTypes.SESSION_STATUS:
      callbacks.onSessionStatus?.(payload.properties)
      break
    case EventTypes.PERMISSION_ASKED:
      callbacks.onPermissionAsked?.(payload.properties)
      break
    case EventTypes.PERMISSION_REPLIED:
      callbacks.onPermissionReplied?.(payload.properties)
      break
    case EventTypes.QUESTION_ASKED:
      callbacks.onQuestionAsked?.(payload.properties)
      break
    case EventTypes.QUESTION_REPLIED:
      callbacks.onQuestionReplied?.(payload.properties)
      break
    case EventTypes.QUESTION_REJECTED:
      callbacks.onQuestionRejected?.(payload.properties)
      break
    case EventTypes.WORKTREE_READY:
      callbacks.onWorktreeReady?.(payload.properties)
      break
    case EventTypes.WORKTREE_FAILED:
      callbacks.onWorktreeFailed?.(payload.properties)
      break
    case EventTypes.VCS_BRANCH_UPDATED:
      callbacks.onVcsBranchUpdated?.(payload.properties)
      break
    case EventTypes.TODO_UPDATED: {
      callbacks.onTodoUpdated?.({
        sessionID: payload.properties.sessionID,
        todos: normalizeTodoItems(payload.properties.todos),
      } satisfies TodoUpdatedPayload)
      break
    }
    default:
      // 忽略其他事件类型
      break
  }
}

function normalizeSessionError(properties: unknown): SessionErrorPayload {
  if (!isRecord(properties)) {
    return { sessionID: '', name: 'UnknownError', data: properties }
  }

  const sessionID = typeof properties.sessionID === 'string' ? properties.sessionID : ''

  if (typeof properties.name === 'string') {
    return {
      sessionID,
      name: properties.name,
      data: properties.data,
    }
  }

  const sdkError = properties.error
  if (isRecord(sdkError)) {
    return {
      sessionID,
      name: typeof sdkError.name === 'string' ? sdkError.name : 'UnknownError',
      data: 'data' in sdkError ? sdkError.data : sdkError,
    }
  }

  return {
    sessionID,
    name: 'UnknownError',
    data: sdkError,
  }
}

// ============================================
// Public API
// ============================================

/**
 * 强制重连 SSE（用于切换服务器等场景）
 * 断开当前连接 → 重置状态 → 立即重连（新 URL 由 getApiBaseUrl() 动态解析）
 */
export function reconnectSSE() {
  if (allSubscribers.size === 0) return // 没有订阅者不需要重连

  if (import.meta.env.DEV) {
    console.log('[SSE] reconnectSSE() called, forcing reconnect to new server...')
  }

  // 断开现有连接
  if (heartbeatTimer) clearTimeout(heartbeatTimer)
  if (reconnectTimer) clearTimeout(reconnectTimer)
  reconnectTimer = null
  stopBackgroundKeepalive()

  // 标记为服务器切换，重连成功时 onReconnected 会携带 'server-switch' reason
  isServerSwitch = true

  // 递增连接代次，使旧连接的事件回调自动失效
  connectionGeneration++

  disconnectTauri()
  if (singletonController) {
    singletonController.abort()
    singletonController = null
  }
  isConnecting = false

  // 重置重连计数
  updateConnectionState({
    state: 'disconnected',
    reconnectAttempt: 0,
    error: undefined,
  })

  // 立即重连（getApiBaseUrl() 会读取新的 activeServer）
  connectSingleton()
}

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
