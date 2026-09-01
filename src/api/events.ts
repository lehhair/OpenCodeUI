// ============================================
// Server-scoped Event Subscription (SSE) - Connection Manager
//
// 每个服务器一条独立 SSE 连接，各自维护心跳 / 重连 / 连接状态 / 事件代次。
// 缺省 serverId 的 API 均作用于"活动服务器"，保持向后兼容：
//   subscribeToEvents(cb)           == subscribeToServerEvents(activeServerId, cb)
//   reconnectSSE()                  == reconnectServerSSE(activeServerId)
//   getConnectionInfo()             == getServerConnectionInfo(activeServerId)
// ============================================

import { getApiBaseUrl, getAuthHeader } from './http'
import { createSseTextParser } from './sse'
import { normalizeTodoItems } from './todo'
import { isTauri } from '../utils/tauri'
import { serverStore } from '../store/serverStore'
import type {
  ApiMessage,
  EventCallbacks,
  GlobalEvent,
  ServerConnectedPayload,
  SessionErrorPayload,
  TodoUpdatedPayload,
} from './types'
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

interface ServerConnection {
  serverId: string
  info: ConnectionInfo
  subscribers: Set<EventCallbacks>
  controller: AbortController | null
  heartbeatTimer: ReturnType<typeof setTimeout> | null
  reconnectTimer: ReturnType<typeof setTimeout> | null
  isConnecting: boolean
  /** 连接代次，每次 reconnect 递增，旧代次的事件会被丢弃 */
  generation: number
  /** 上一次 onReconnected 广播的时间戳（cooldown） */
  lastReconnectedBroadcast: number
}

/** serverId -> connection */
const connections = new Map<string, ServerConnection>()
/** serverId -> connection 状态监听者 */
const connectionListeners = new Map<string, Set<(info: ConnectionInfo) => void>>()

/** 是否因为切换服务器而触发的重连（按 serverId） */
const serverSwitchFlags = new Map<string, boolean>()

let lifecycleListenersRegistered = false
/** 当前是否在后台 */
let isInBackground = false
let keepaliveTimer: ReturnType<typeof setInterval> | null = null

// ============================================
// Connection helpers
// ============================================

function bridgeIdFor(serverId: string): string {
  return `sse:${serverId}`
}

function getOrCreateConnection(serverId: string): ServerConnection {
  let conn = connections.get(serverId)
  if (!conn) {
    conn = {
      serverId,
      info: { state: 'disconnected', lastEventTime: 0, reconnectAttempt: 0 },
      subscribers: new Set(),
      controller: null,
      heartbeatTimer: null,
      reconnectTimer: null,
      isConnecting: false,
      generation: 0,
      lastReconnectedBroadcast: 0,
    }
    connections.set(serverId, conn)
  }
  return conn
}

function updateConnectionState(serverId: string, update: Partial<ConnectionInfo>) {
  // 不隐式创建连接：无连接时直接返回（避免断开后残留空壳连接）
  const conn = connections.get(serverId)
  if (!conn) return
  conn.info = { ...conn.info, ...update }
  connectionListeners.get(serverId)?.forEach(fn => {
    fn(conn.info)
  })
}

// ============================================
// 常量
// ============================================

const RECONNECT_DELAYS = [1000, 2000, 3000, 5000, 10000, 30000]
/** 后台时使用更激进的重连延迟，确保尽快恢复连接 */
const BACKGROUND_RECONNECT_DELAYS = [500, 1000, 2000, 3000, 5000, 10000]
const HEARTBEAT_TIMEOUT = 60000
/** 后台时的心跳超时（更宽松，因为后台 timer 可能不准） */
const BACKGROUND_HEARTBEAT_TIMEOUT = 120000
/** 后台 keepalive 间隔：定期检查连接是否还活着 */
const BACKGROUND_KEEPALIVE_INTERVAL = 30000
/** onReconnected 广播 cooldown */
const RECONNECTED_COOLDOWN = 2000

/** 稳定引用：未连接的服务器默认状态（避免 getSnapshot 每次新建对象导致无限循环） */
const DEFAULT_CONNECTION_INFO: ConnectionInfo = {
  state: 'disconnected',
  lastEventTime: 0,
  reconnectAttempt: 0,
}

// ============================================
// Delta coalescing — 参照官方 coalesceServerEvents
// 同一批次内相同 (messageID, partID, field) 的 delta 合并为一个事件；
// message.part.updated 到达后丢弃该 part 的在途 delta。
// ============================================

function coalesceEvents(events: GlobalEvent[]): GlobalEvent[] {
  if (events.length <= 1) return events

  const result: GlobalEvent[] = []
  const deltaIndexByKey = new Map<string, number>()
  const staleIndices = new Set<number>()

  for (const event of events) {
    const payload = event.payload

    if (payload.type === EventTypes.MESSAGE_PART_DELTA) {
      const p = payload.properties as {
        sessionID: string
        messageID: string
        partID: string
        field: string
        delta: string
      }
      const key = `${p.sessionID}\0${p.messageID}\0${p.partID}\0${p.field}`
      const idx = deltaIndexByKey.get(key)
      if (idx !== undefined && !staleIndices.has(idx)) {
        ;((result[idx].payload as { properties: { delta: string } }).properties).delta += p.delta
        continue
      }
      result.push(event)
      deltaIndexByKey.set(key, result.length - 1)
      continue
    }

    if (payload.type === EventTypes.MESSAGE_PART_UPDATED) {
      const props = payload.properties as {
        sessionID?: string
        part?: { id?: string; sessionID?: string; messageID?: string }
      }
      const sid = props.sessionID ?? props.part?.sessionID
      const mid = props.part?.messageID
      const pid = props.part?.id
      if (sid && mid && pid) {
        const prefix = `${sid}\0${mid}\0${pid}\0`
        for (const [key, idx] of deltaIndexByKey) {
          if (key.startsWith(prefix)) {
            staleIndices.add(idx)
            deltaIndexByKey.delete(key)
          }
        }
      }
    }

    result.push(event)
  }

  if (staleIndices.size > 0) {
    return result.filter((_, idx) => !staleIndices.has(idx))
  }
  return result
}

function parseAndCoalesce(rawEvents: string[]): GlobalEvent[] {
  const parsed: GlobalEvent[] = []
  for (const raw of rawEvents) {
    const event = parseGlobalEvent(raw)
    if (event) parsed.push(event)
  }
  return coalesceEvents(parsed)
}

function finalizeConnectionAttempt(conn: ServerConnection, generation: number): boolean {
  if (generation !== conn.generation) {
    return false
  }
  conn.isConnecting = false
  return true
}

/**
 * 广播 onReconnected，带 cooldown 防止 SSE 快速重连时密集触发数据拉取
 */
function broadcastReconnected(conn: ServerConnection, reason: 'network' | 'server-switch') {
  const now = Date.now()
  if (reason !== 'server-switch' && now - conn.lastReconnectedBroadcast < RECONNECTED_COOLDOWN) {
    if (import.meta.env.DEV) {
      console.log('[SSE] onReconnected skipped (cooldown)')
    }
    return
  }
  conn.lastReconnectedBroadcast = now
  conn.subscribers.forEach(cb => {
    cb.onReconnected?.(reason)
  })
}

// ============================================
// Tauri SSE Bridge (via Rust reqwest + Channel)
// 每个服务器一个独立 bridgeId（Rust 侧 BridgeKey=(window, bridgeId) 天然支持多连接）
// ============================================

/** 上一次 bridge_disconnect 的 Promise，用于串行化 Tauri 侧 disconnect → connect */
const pendingDisconnects = new Map<string, Promise<void>>()

function disconnectTauri(bridgeId: string): Promise<void> {
  if (!isTauri()) return Promise.resolve()

  const p = (pendingDisconnects.get(bridgeId) ?? Promise.resolve()).then(() =>
    import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke('bridge_disconnect', { args: { bridgeId } }).then(() => undefined))
      .catch(() => {}),
  )
  pendingDisconnects.set(bridgeId, p)
  return p
}

/** 断开并清理连接的传输层（Tauri bridge / browser fetch），不更新状态 */
function teardownConnectionTransport(conn: ServerConnection): void {
  void disconnectTauri(bridgeIdFor(conn.serverId))
  if (conn.controller) {
    conn.controller.abort()
    conn.controller = null
  }
  conn.isConnecting = false
}

function resetHeartbeat(conn: ServerConnection) {
  if (conn.heartbeatTimer) clearTimeout(conn.heartbeatTimer)

  updateConnectionState(conn.serverId, { lastEventTime: Date.now() })

  // 后台时使用更宽松的超时，因为移动端后台 timer 可能被冻结/延迟
  const timeout = isInBackground ? BACKGROUND_HEARTBEAT_TIMEOUT : HEARTBEAT_TIMEOUT

  conn.heartbeatTimer = setTimeout(() => {
    console.warn(`[SSE] No events received for ${timeout / 1000}s, reconnecting...`)
    updateConnectionState(conn.serverId, { state: 'disconnected', error: 'Heartbeat timeout' })
    scheduleReconnect(conn)
  }, timeout)
}

function scheduleReconnect(conn: ServerConnection) {
  if (conn.reconnectTimer) clearTimeout(conn.reconnectTimer)
  if (conn.subscribers.size === 0) return // 没有订阅者就不重连

  const attempt = conn.info.reconnectAttempt
  // 后台时使用更激进的重连策略
  const delays = isInBackground ? BACKGROUND_RECONNECT_DELAYS : RECONNECT_DELAYS
  const delay = delays[Math.min(attempt, delays.length - 1)]

  if (import.meta.env.DEV) {
    console.log(
      `[SSE] Reconnecting ${conn.serverId} in ${delay}ms (attempt ${attempt + 1}, background: ${isInBackground})...`,
    )
  }

  conn.reconnectTimer = setTimeout(() => {
    updateConnectionState(conn.serverId, { reconnectAttempt: attempt + 1 })
    connectServer(conn.serverId)
  }, delay)
}

function connectServer(serverId: string) {
  const conn = getOrCreateConnection(serverId)
  if (conn.isConnecting || conn.subscribers.size === 0) return

  // 如果状态声称 connected，验证连接是否真的活着
  if (conn.info.state === 'connected') {
    const timeSinceLastEvent = Date.now() - conn.info.lastEventTime
    // 后台时使用更宽松的超时判断
    const staleTimeout = isInBackground ? BACKGROUND_HEARTBEAT_TIMEOUT : HEARTBEAT_TIMEOUT
    if (timeSinceLastEvent > staleTimeout) {
      // 太久没收到事件，连接可能已死，强制断开再重连
      if (import.meta.env.DEV) {
        console.log(
          `[SSE] connectServer: ${serverId} state=connected but stale (${Math.round(timeSinceLastEvent / 1000)}s), forcing disconnect`,
        )
      }
      conn.generation++
      teardownConnectionTransport(conn)
      updateConnectionState(serverId, { state: 'disconnected' })
    } else {
      return // 连接确实还活着
    }
  }

  conn.isConnecting = true

  updateConnectionState(serverId, { state: 'connecting' })
  if (import.meta.env.DEV) {
    console.log(`[SSE] Connecting ${serverId}...`)
  }

  // 注册生命周期监听器（首次连接时）
  registerLifecycleListeners()

  if (isTauri()) {
    connectViaTauri(conn)
  } else {
    connectViaBrowser(conn)
  }
}

/** Unified bridge event from Rust (transparent proxy) */
interface BridgeEvent {
  event: 'connected' | 'data' | 'disconnected' | 'error'
  data?: {
    data?: string
    code?: number
    reason?: string
    message?: string
  }
}

async function connectViaTauri(conn: ServerConnection) {
  const myGeneration = conn.generation
  const serverId = conn.serverId

  try {
    // 等待上一次 disconnect 完成，避免 Rust 侧 connect/disconnect 竞争
    await (pendingDisconnects.get(bridgeIdFor(serverId)) ?? Promise.resolve())

    const { invoke, Channel } = await import('@tauri-apps/api/core')

    const url = `${getApiBaseUrl(serverId)}/global/event`
    const authHeader = getAuthHeader(serverId)['Authorization'] || null

    const sseParser = createSseTextParser()

    const onEvent = new Channel<BridgeEvent>()

    onEvent.onmessage = (msg: BridgeEvent) => {
      // 代次不匹配，说明已经 reconnect 过了，忽略旧连接的事件
      if (myGeneration !== conn.generation) return

      switch (msg.event) {
        case 'connected': {
          conn.isConnecting = false

          updateConnectionState(serverId, {
            state: 'connected',
            reconnectAttempt: 0,
            error: undefined,
          })
          resetHeartbeat(conn)
          if (import.meta.env.DEV) {
            console.log(`[SSE/Tauri] ${serverId} Connected`)
          }
          // 每次连接成功都通知订阅者刷新数据
          // 覆盖场景：首次连接（先开 UI 后开 server）、网络重连、服务器切换
          const reason = serverSwitchFlags.get(serverId) ? ('server-switch' as const) : ('network' as const)
          serverSwitchFlags.delete(serverId)
          broadcastReconnected(conn, reason)
          break
        }
        case 'data': {
          resetHeartbeat(conn)
          if (!msg.data?.data) break

          for (const globalEvent of parseAndCoalesce(sseParser.push(msg.data.data))) {
            broadcastEvent(conn, globalEvent)
          }
          break
        }
        case 'disconnected': {
          conn.isConnecting = false
          if (import.meta.env.DEV) {
            console.log(`[SSE/Tauri] ${serverId} Disconnected:`, msg.data?.reason)
          }
          updateConnectionState(serverId, { state: 'disconnected' })
          scheduleReconnect(conn)
          break
        }
        case 'error': {
          conn.isConnecting = false
          const errorMsg = msg.data?.message || 'Unknown error'
          if (import.meta.env.DEV) {
            console.warn(`[SSE/Tauri] ${serverId} Error:`, errorMsg)
          }
          updateConnectionState(serverId, {
            state: 'error',
            error: errorMsg,
          })
          conn.subscribers.forEach(cb => {
            cb.onError?.(new Error(errorMsg))
          })
          scheduleReconnect(conn)
          break
        }
      }
    }

    // 调用统一桥接命令
    invoke('bridge_connect', {
      args: { bridgeId: bridgeIdFor(serverId), url, authHeader },
      onEvent,
    }).catch((error: unknown) => {
      if (!finalizeConnectionAttempt(conn, myGeneration)) return
      const errorMsg = error instanceof Error ? error.message : String(error)
      if (import.meta.env.DEV) {
        console.warn(`[SSE/Tauri] ${serverId} invoke error:`, errorMsg)
      }
      updateConnectionState(serverId, {
        state: 'error',
        error: errorMsg,
      })
      conn.subscribers.forEach(cb => {
        cb.onError?.(new Error(errorMsg))
      })
      scheduleReconnect(conn)
    })
  } catch (error) {
    if (!finalizeConnectionAttempt(conn, myGeneration)) return
    const errorMsg = error instanceof Error ? error.message : String(error)
    console.warn(`[SSE/Tauri] ${serverId} Failed to initialize:`, errorMsg)
    updateConnectionState(serverId, { state: 'error', error: errorMsg })
    scheduleReconnect(conn)
  }
}

// ============================================
// Browser SSE (via fetch + ReadableStream)
// ============================================

function connectViaBrowser(conn: ServerConnection) {
  conn.controller = new AbortController()

  // 捕获当前连接代次
  const myGeneration = conn.generation
  const serverId = conn.serverId

  fetch(`${getApiBaseUrl(serverId)}/global/event`, {
    signal: conn.controller.signal,
    headers: {
      Accept: 'text/event-stream',
      ...getAuthHeader(serverId),
    },
  })
    .then(async response => {
      if (myGeneration !== conn.generation) {
        await response.body?.cancel?.().catch(() => {})
        return
      }

      finalizeConnectionAttempt(conn, myGeneration)

      if (!response.ok) {
        throw new Error(`Failed to subscribe: ${response.status}`)
      }

      updateConnectionState(serverId, {
        state: 'connected',
        reconnectAttempt: 0,
        error: undefined,
      })
      resetHeartbeat(conn)
      if (import.meta.env.DEV) {
        console.log(`[SSE] ${serverId} connected`)
      }

      // 每次连接成功都通知订阅者刷新数据
      // 覆盖场景：首次连接（先开 UI 后开 server）、网络重连、服务器切换
      const reason = serverSwitchFlags.get(serverId) ? ('server-switch' as const) : ('network' as const)
      serverSwitchFlags.delete(serverId)
      broadcastReconnected(conn, reason)

      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error('No response body')
      }

      const decoder = new TextDecoder()
      const sseParser = createSseTextParser()

      while (true) {
        // 代次不匹配，说明已经 reconnect 过了，停止读取旧流
        if (myGeneration !== conn.generation) {
          reader.cancel().catch(() => {})
          break
        }

        const { done, value } = await reader.read()
        if (myGeneration !== conn.generation) {
          reader.cancel().catch(() => {})
          break
        }

        if (done) {
          if (import.meta.env.DEV) {
            console.log(`[SSE] ${serverId} Stream ended, reconnecting...`)
          }
          updateConnectionState(serverId, { state: 'disconnected' })
          scheduleReconnect(conn)
          break
        }

        resetHeartbeat(conn)

        const coalesced = parseAndCoalesce(sseParser.push(decoder.decode(value, { stream: true })))
        for (const globalEvent of coalesced) {
          broadcastEvent(conn, globalEvent)
        }
      }
    })
    .catch(error => {
      if (!finalizeConnectionAttempt(conn, myGeneration)) {
        return
      }

      if (error.name === 'AbortError') {
        return
      }
      // SSE stream error - logged for debugging
      if (import.meta.env.DEV) {
        console.warn(`[SSE] ${serverId} Event stream error:`, error)
      }
      updateConnectionState(serverId, {
        state: 'error',
        error: error.message || 'Connection failed',
      })
      // 通知所有订阅者出错
      conn.subscribers.forEach(cb => {
        cb.onError?.(error)
      })
      scheduleReconnect(conn)
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
  if (typeof value.payload.type !== 'string') return false
  return 'properties' in value.payload
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

function getMessageInfo(properties: unknown): ApiMessage | undefined {
  if (!isRecord(properties)) return undefined
  const message = properties.info ?? properties.message
  return isRecord(message) ? (message as ApiMessage) : undefined
}

// ============================================
// Background Keepalive
// ============================================

/**
 * 后台 keepalive：定期检查所有连接是否还活着
 * 移动端后台时 SSE 连接可能静默断开，timer 也可能被冻结
 * 这个轮询机制可以在 timer 恢复执行时及时发现连接已死
 */
function startBackgroundKeepalive() {
  stopBackgroundKeepalive()

  keepaliveTimer = setInterval(() => {
    const now = Date.now()

    for (const conn of connections.values()) {
      const timeSinceLastEvent = now - conn.info.lastEventTime
      const serverId = conn.serverId

      if (import.meta.env.DEV) {
        console.log(
          `[SSE] Background keepalive check ${serverId}: last event ${Math.round(timeSinceLastEvent / 1000)}s ago, state=${conn.info.state}`,
        )
      }

      if (conn.info.state === 'connected' && timeSinceLastEvent > BACKGROUND_HEARTBEAT_TIMEOUT) {
        // 连接声称是 connected，但已经太久没收到事件了 — 连接可能已经静默断开
        console.warn(`[SSE] Background keepalive: ${serverId} appears dead, forcing reconnect`)

        // 断开旧连接
        conn.generation++
        teardownConnectionTransport(conn)

        updateConnectionState(serverId, { state: 'disconnected', error: 'Background keepalive timeout' })
        scheduleReconnect(conn)
      } else if ((conn.info.state === 'disconnected' || conn.info.state === 'error') && conn.subscribers.size > 0) {
        // 已知断连状态，但可能 reconnectTimer 被后台冻结了 — 主动触发重连
        if (!conn.reconnectTimer && !conn.isConnecting) {
          console.warn(`[SSE] Background keepalive: ${serverId} stale disconnect, forcing reconnect`)
          updateConnectionState(serverId, { reconnectAttempt: 0 })
          connectServer(serverId)
        }
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

/**
 * 断开并移除一个服务器连接（无订阅者时调用）
 */
function disconnectServerConnection(conn: ServerConnection) {
  const serverId = conn.serverId
  if (conn.heartbeatTimer) clearTimeout(conn.heartbeatTimer)
  if (conn.reconnectTimer) clearTimeout(conn.reconnectTimer)
  stopBackgroundKeepalive()

  // 断开传输层（Tauri bridge / browser fetch）
  conn.generation++
  teardownConnectionTransport(conn)
  connections.delete(serverId)
  connectionListeners.delete(serverId)

  if (connections.size === 0) {
    unregisterLifecycleListeners()
  }
}

// ============================================
// Lifecycle Listeners (Visibility + Network)
// ============================================

function handleVisibilityChange() {
  if (document.visibilityState === 'visible') {
    // 页面恢复前台
    isInBackground = false
    stopBackgroundKeepalive()

    for (const conn of connections.values()) {
      if (conn.subscribers.size === 0) continue

      if (conn.info.state !== 'connected') {
        // 明确断连，立即重连
        if (import.meta.env.DEV) {
          console.log(`[SSE] Page visible: ${conn.serverId} not connected, forcing reconnect...`)
        }
        forceReconnectNow(conn)
      } else {
        // 状态是 connected，但连接可能已经在后台静默断开
        // 检查最后一次收到事件的时间
        const timeSinceLastEvent = Date.now() - conn.info.lastEventTime
        if (timeSinceLastEvent > HEARTBEAT_TIMEOUT) {
          // 太久没收到事件了，连接大概率已死
          console.warn(
            `[SSE] Page visible: ${conn.serverId} may be stale (last event ${Math.round(timeSinceLastEvent / 1000)}s ago), forcing reconnect`,
          )
          forceReconnectNow(conn)
        } else {
          // 连接看起来还活着，重置心跳为前台模式
          resetHeartbeat(conn)
        }
      }
    }
  } else {
    // 页面进入后台
    isInBackground = true

    if (import.meta.env.DEV) {
      console.log('[SSE] Page entering background, switching to background mode')
    }

    // 保持心跳运行，但切换为后台模式（更长超时）
    for (const conn of connections.values()) {
      resetHeartbeat(conn)
    }

    // 启动后台 keepalive 轮询
    if (connections.size > 0) {
      startBackgroundKeepalive()
    }
  }
}

/**
 * 强制立即重连：断开旧连接、重置计数器、立即发起新连接
 */
function forceReconnectNow(conn: ServerConnection) {
  if (conn.reconnectTimer) clearTimeout(conn.reconnectTimer)
  conn.reconnectTimer = null
  updateConnectionState(conn.serverId, { reconnectAttempt: 0 })

  // 断开旧连接
  conn.generation++
  teardownConnectionTransport(conn)

  connectServer(conn.serverId)
}

function handleOnline() {
  if (import.meta.env.DEV) {
    console.log('[SSE] Network online, forcing reconnect...')
  }
  for (const conn of connections.values()) {
    if (conn.info.state !== 'connected' && conn.subscribers.size > 0) {
      forceReconnectNow(conn)
    }
  }
}

function handleOffline() {
  if (import.meta.env.DEV) {
    console.log('[SSE] Network offline')
  }
  // 标记为断连，但不尝试重连（没网重连也没用）
  for (const conn of connections.values()) {
    if (conn.info.state === 'connected' || conn.info.state === 'connecting') {
      conn.generation++
      teardownConnectionTransport(conn)
      if (conn.heartbeatTimer) clearTimeout(conn.heartbeatTimer)
      if (conn.reconnectTimer) clearTimeout(conn.reconnectTimer)
      stopBackgroundKeepalive()
      updateConnectionState(conn.serverId, { state: 'disconnected', error: 'Network offline' })
    }
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

// ============================================
// Event broadcast（只发给对应服务器的订阅者）
// ============================================

function broadcastEvent(conn: ServerConnection, globalEvent: GlobalEvent) {
  conn.subscribers.forEach(callbacks => {
    handleEventForSubscriber(globalEvent.payload, callbacks)
  })
}

function handleEventForSubscriber(payload: GlobalEvent['payload'], callbacks: EventCallbacks) {
  switch (payload.type) {
    case EventTypes.MESSAGE_UPDATED: {
      const message = getMessageInfo(payload.properties)
      if (message) callbacks.onMessageUpdated?.(message)
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
    case EventTypes.SERVER_CONNECTED:
      callbacks.onServerConnected?.(normalizeServerConnected(payload.properties))
      break
    default:
      // 忽略其他事件类型
      break
  }
}

function normalizeServerConnected(properties: unknown): ServerConnectedPayload {
  if (!isRecord(properties)) return {}
  return {
    timestamp: properties.timestamp,
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
 * 强制重连指定服务器 SSE（用于切换服务器等场景）
 * 断开当前连接 → 重置状态 → 立即重连（新 URL 由 getApiBaseUrl(serverId) 动态解析）
 */
export function reconnectServerSSE(serverId: string) {
  const conn = connections.get(serverId)
  if (!conn || conn.subscribers.size === 0) return // 没有订阅者不需要重连

  if (import.meta.env.DEV) {
    console.log(`[SSE] reconnectServerSSE(${serverId}) called, forcing reconnect...`)
  }

  // 断开现有连接
  if (conn.heartbeatTimer) clearTimeout(conn.heartbeatTimer)
  if (conn.reconnectTimer) clearTimeout(conn.reconnectTimer)
  conn.reconnectTimer = null
  stopBackgroundKeepalive()

  // 标记为服务器切换，重连成功时 onReconnected 会携带 'server-switch' reason
  serverSwitchFlags.set(serverId, true)

  // 递增连接代次，使旧连接的事件回调自动失效
  conn.generation++
  teardownConnectionTransport(conn)

  // 重置重连计数
  updateConnectionState(serverId, {
    state: 'disconnected',
    reconnectAttempt: 0,
    error: undefined,
  })

  // 立即重连
  connectServer(serverId)
}

/**
 * 强制重连活动服务器 SSE（兼容旧 API）
 */
export function reconnectSSE() {
  reconnectServerSSE(serverStore.getActiveServerId())
}

/**
 * 断开指定服务器 SSE
 */
export function disconnectServerSSE(serverId: string, error?: string) {
  const conn = connections.get(serverId)
  if (!conn) return
  // 先广播状态再断开并移除连接，避免 updateConnectionState 隐式重建空壳连接
  updateConnectionState(serverId, { state: error ? 'error' : 'disconnected', error, reconnectAttempt: 0 })
  disconnectServerConnection(conn)
}

/**
 * 断开活动服务器 SSE（兼容旧 API）
 */
export function disconnectSSE(error?: string) {
  disconnectServerSSE(serverStore.getActiveServerId(), error)
}

/**
 * 获取指定服务器连接状态（返回稳定引用，供 useSyncExternalStore 使用）
 */
export function getServerConnectionInfo(serverId: string): ConnectionInfo {
  return connections.get(serverId)?.info ?? DEFAULT_CONNECTION_INFO
}

/**
 * 获取活动服务器连接状态（兼容旧 API）
 */
export function getConnectionInfo(): ConnectionInfo {
  return getServerConnectionInfo(serverStore.getActiveServerId())
}

/**
 * 订阅指定服务器连接状态
 */
export function subscribeToServerConnectionState(serverId: string, fn: (info: ConnectionInfo) => void): () => void {
  let listeners = connectionListeners.get(serverId)
  if (!listeners) {
    listeners = new Set()
    connectionListeners.set(serverId, listeners)
  }
  listeners.add(fn)
  // 立即发送当前状态
  fn(getServerConnectionInfo(serverId))
  return () => {
    listeners?.delete(fn)
  }
}

/**
 * 订阅活动服务器连接状态（兼容旧 API）
 */
export function subscribeToConnectionState(fn: (info: ConnectionInfo) => void): () => void {
  return subscribeToServerConnectionState(serverStore.getActiveServerId(), fn)
}

/**
 * 订阅指定服务器的 SSE 事件（每服务器独立连接）
 */
export function subscribeToServerEvents(serverId: string, callbacks: EventCallbacks): () => void {
  const conn = getOrCreateConnection(serverId)
  conn.subscribers.add(callbacks)

  // 如果是第一个订阅者，启动连接
  if (conn.subscribers.size === 1) {
    connectServer(serverId)
  }

  // 返回取消订阅函数
  return () => {
    conn.subscribers.delete(callbacks)

    // 如果没有订阅者了，断开连接
    if (conn.subscribers.size === 0) {
      disconnectServerConnection(conn)
    }
  }
}

/**
 * 订阅活动服务器 SSE 事件（兼容旧 API）。
 * 订阅跟随 active server：切换服务器时自动迁移订阅（恢复改动前的单例语义）。
 */
export function subscribeToEvents(callbacks: EventCallbacks): () => void {
  let currentServerId = serverStore.getActiveServerId()
  let unsubscribe = subscribeToServerEvents(currentServerId, callbacks)

  const offServerChange = serverStore.onServerChange((newServerId, reason) => {
    // 同 id 且非 runtime 变更 → 无需重订阅。server-runtime-updated 表示端口/鉴权变了
    // （WSL sidecar 重启），活动中的 SSE 还连着旧地址，必须拆旧建新；
    // 建连时 URL/鉴权由 getApiBaseUrl/getAuthHeader 从 serverStore 现读，重订阅即拿到新值
    if (newServerId === currentServerId && reason !== 'server-runtime-updated') return
    unsubscribe()
    currentServerId = newServerId
    unsubscribe = subscribeToServerEvents(currentServerId, callbacks)
  })

  return () => {
    offServerChange()
    unsubscribe()
  }
}
