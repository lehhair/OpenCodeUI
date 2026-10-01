// ============================================
// Event Subscription — OpenCode v2 原生
//
// ## 为什么这一版比 v1 短得多
//
// v1 需要手写 SSE：自己解析 `text/event-stream`、自己维护心跳、
// 自己按 partID 合并 delta（`message.part.delta` → `message.part.updated`）。
//
// v2 的客户端**自带** `event.subscribe()`，返回 `AsyncIterable<V2Event>`
// （内部走 `GET /api/event` + text/event-stream，并用我们注入的 fetch，
// 因此 Tauri / 浏览器两条路径都能用）。所以本层只负责：
//   1. 按 serverId 维护连接生命周期（连接 / 断开 / 重连退避）
//   2. 把扁平事件分派给订阅者
//   3. 连接状态广播（供 UI 显示在线/重连中）
//
// ## v2 的事件形状
//
// 每个事件是**扁平对象**：`{ id, created, type, location?, data, durable? }`。
// 没有 v1 的 `payload.type` / `payload.properties` 两层嵌套。
// 流式增量（text/reasoning/tool）是**独立事件**，不是对某个 part 的原地修改：
//     session.text.started → session.text.delta* → session.text.ended
// 关联键：文本/推理用 `data.ordinal`，工具用 `data.id`。
// ============================================

import { getSDKClient, invalidateSDKClient } from './sdk'
import { serverStore } from '../store/serverStore'
import type { EventCallbacks, GlobalEvent } from './types'

// ============================================
// 连接状态
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
  reconnectTimer: ReturnType<typeof setTimeout> | null
  isConnecting: boolean
  /** 连接代次，每次重连递增，旧代次的事件会被丢弃 */
  generation: number
  /** 上一次 onReconnected 广播的时间戳（cooldown） */
  lastReconnectedBroadcast: number
  /** 是否曾经成功连接过（用于区分首次连接与重连） */
  hasConnectedBefore: boolean
}

const connections = new Map<string, ServerConnection>()
const connectionListeners = new Map<string, Set<(info: ConnectionInfo) => void>>()

/** 是否因为切换服务器而触发的重连（按 serverId） */
const serverSwitchFlags = new Map<string, boolean>()

let lifecycleListenersRegistered = false
let isInBackground = false
let keepaliveTimer: ReturnType<typeof setInterval> | null = null

// ============================================
// 常量
// ============================================

const RECONNECT_DELAYS = [1000, 2000, 3000, 5000, 10000, 30000]
/** 后台时使用更激进的重连延迟，确保尽快恢复连接 */
const BACKGROUND_RECONNECT_DELAYS = [500, 1000, 2000, 3000, 5000, 10000]
/** 后台 keepalive 间隔：定期检查连接是否还活着 */
const BACKGROUND_KEEPALIVE_INTERVAL = 30_000
/** onReconnected 广播 cooldown */
const RECONNECTED_COOLDOWN = 2000

const DEFAULT_CONNECTION_INFO: ConnectionInfo = {
  state: 'disconnected',
  lastEventTime: 0,
  reconnectAttempt: 0,
}

// ============================================
// 连接管理
// ============================================

function getOrCreateConnection(serverId: string): ServerConnection {
  let conn = connections.get(serverId)
  if (!conn) {
    conn = {
      serverId,
      info: { ...DEFAULT_CONNECTION_INFO },
      subscribers: new Set(),
      controller: null,
      reconnectTimer: null,
      isConnecting: false,
      generation: 0,
      lastReconnectedBroadcast: 0,
      hasConnectedBefore: false,
    }
    connections.set(serverId, conn)
  }
  return conn
}

function updateConnectionState(serverId: string, update: Partial<ConnectionInfo>): void {
  const conn = connections.get(serverId)
  if (!conn) return
  conn.info = { ...conn.info, ...update }
  connectionListeners.get(serverId)?.forEach(fn => {
    fn(conn.info)
  })
}

function broadcastReconnected(conn: ServerConnection, reason: 'network' | 'server-switch'): void {
  const now = Date.now()
  if (reason !== 'server-switch' && now - conn.lastReconnectedBroadcast < RECONNECTED_COOLDOWN) {
    return
  }
  conn.lastReconnectedBroadcast = now
  conn.subscribers.forEach(cb => {
    cb.onReconnected?.(reason)
  })
}

function getReconnectDelay(attempt: number): number {
  const delays = isInBackground ? BACKGROUND_RECONNECT_DELAYS : RECONNECT_DELAYS
  return delays[Math.min(attempt, delays.length - 1)]
}

// ============================================
// 事件分派
// ============================================
//
// v2 的事件是扁平对象，直接读 `event.type` 与 `event.data`。

function dispatchEvent(callbacks: EventCallbacks, event: GlobalEvent): void {
  switch (event.type) {
    // ---- 会话生命周期 ----
    case 'session.created':
      callbacks.onSessionCreated?.(event.data)
      break
    case 'session.renamed':
      callbacks.onSessionRenamed?.(event.data)
      break
    case 'session.deleted':
      callbacks.onSessionDeleted?.(event.data)
      break
    case 'session.idle':
      callbacks.onSessionIdle?.(event.data)
      break
    case 'session.status':
      callbacks.onSessionStatus?.(event.data)
      break
    case 'session.viewed':
      callbacks.onSessionViewed?.(event.data)
      break
    case 'session.moved':
      callbacks.onSessionMoved?.(event.data)
      break
    case 'session.forked':
      callbacks.onSessionForked?.(event.data)
      break
    case 'session.permissions':
      callbacks.onSessionPermissions?.(event.data)
      break

    // 注意：**不要**在这里加 `session.message.content.updated`。
    //
    // 该事件类型确实存在于生成类型里（SessionMessageContentUpdated），
    // 但**不在事件流的联合类型 V2Event 里**——也就是说 SSE 不会推送它
    //（它属于持久化/回放侧的事件，不是订阅面）。我曾在 useGlobalEvents 里
    // 实现过对应的 onMessageContentUpdated，看上去"接好了"，实际永远收不到，
    // 属于"实现了却没人调用"的死代码。
    //
    // 因此助手消息的 content 只有两条来源，两者都在下面的流式事件里：
    //   1. 文本/推理：session.text.* / session.reasoning.*
    //   2. 工具：session.tool.input.started（**唯一带工具名**）+ called/progress/success/failed

    // ---- 文本流 ----
    case 'session.text.started':
      callbacks.onTextStarted?.(event.data)
      break
    case 'session.text.delta':
      callbacks.onTextDelta?.(event.data)
      break
    case 'session.text.ended':
      callbacks.onTextEnded?.(event.data)
      break

    // ---- 推理流 ----
    case 'session.reasoning.started':
      callbacks.onReasoningStarted?.(event.data)
      break
    case 'session.reasoning.delta':
      callbacks.onReasoningDelta?.(event.data)
      break
    case 'session.reasoning.ended':
      callbacks.onReasoningEnded?.(event.data)
      break

    // ---- 工具流 ----
    case 'session.tool.input.started':
      callbacks.onToolInputStarted?.(event.data)
      break
    case 'session.tool.input.delta':
      callbacks.onToolInputDelta?.(event.data)
      break
    case 'session.tool.input.ended':
      callbacks.onToolInputEnded?.(event.data)
      break
    case 'session.tool.called':
      callbacks.onToolCalled?.(event.data)
      break
    case 'session.tool.progress':
      callbacks.onToolProgress?.(event.data)
      break
    case 'session.tool.success':
      callbacks.onToolSuccess?.(event.data)
      break
    case 'session.tool.failed':
      callbacks.onToolFailed?.(event.data)
      break

    // ---- 会话内的实时补充信息 ----
    //
    // 这三个事件都在 V2Event 联合里（确实会通过 SSE 送达）：
    //   - retry.scheduled：负载与 UI 的 RetryPart 一一对应；不接的话
    //     重试提示只在重新加载后才出现
    //   - synthetic：注入的系统上下文，对应 UI 已有的 synthetic part
    //   - usage.updated：成本/token，让用量指示在流式期间即准确
    case 'session.retry.scheduled':
      callbacks.onRetryScheduled?.(event.data)
      break
    case 'session.synthetic':
      callbacks.onSynthetic?.(event.data)
      break
    case 'session.usage.updated':
      callbacks.onUsageUpdated?.(event.data)
      break

    // ---- step ----
    case 'session.step.started':
      callbacks.onStepStarted?.(event.data)
      break
    case 'session.step.streamed':
      callbacks.onStepStreamed?.(event.data)
      break
    case 'session.step.ended':
      callbacks.onStepEnded?.(event.data)
      break
    case 'session.step.failed':
      callbacks.onStepFailed?.(event.data)
      break

    // ---- 执行生命周期 ----
    case 'session.execution.started':
      callbacks.onExecutionStarted?.(event.data)
      break
    case 'session.execution.succeeded':
      callbacks.onExecutionSucceeded?.(event.data)
      break
    case 'session.execution.failed':
      callbacks.onExecutionFailed?.(event.data)
      break
    case 'session.execution.interrupted':
      callbacks.onExecutionInterrupted?.(event.data)
      break

    // ---- 权限 ----
    case 'permission.asked':
      callbacks.onPermissionAsked?.(event.data)
      break
    case 'permission.replied':
      callbacks.onPermissionReplied?.(event.data)
      break

    // ---- 表单（取代 v1 question） ----
    case 'form.created':
      callbacks.onFormCreated?.(event.data)
      break
    case 'form.replied':
      callbacks.onFormReplied?.(event.data)
      break
    case 'form.cancelled':
      callbacks.onFormCancelled?.(event.data)
      break

    // ---- 回退 ----
    case 'session.revert.staged':
      callbacks.onRevertStaged?.(event.data)
      break
    case 'session.revert.cleared':
      callbacks.onRevertCleared?.(event.data)
      break
    case 'session.revert.committed':
      callbacks.onRevertCommitted?.(event.data)
      break

    // ---- inbox ----
    case 'session.inbox.enqueued':
      callbacks.onInboxEnqueued?.(event.data)
      break
    case 'session.inbox.delivered':
      callbacks.onInboxDelivered?.(event.data)
      break
    case 'session.inbox.cancelled':
      callbacks.onInboxCancelled?.(event.data)
      break

    // ---- 外围 ----
    case 'project.updated':
      callbacks.onProjectUpdated?.(event.data)
      break
    case 'worktree.updated':
      callbacks.onWorktreeUpdated?.(event.data)
      break
    case 'worktree.resolved':
      callbacks.onWorktreeResolved?.(event.data)
      break
    case 'vcs.branch.updated':
      callbacks.onVcsBranchUpdated?.(event.data)
      break
    case 'mcp.status.changed':
      callbacks.onMcpStatusChanged?.(event.data)
      break
    case 'filesystem.changed':
      callbacks.onFilesystemChanged?.(event.data)
      break

    // ---- PTY ----
    case 'pty.created':
      callbacks.onPtyCreated?.(event.data)
      break
    case 'pty.updated':
      callbacks.onPtyUpdated?.(event.data)
      break
    case 'pty.exited':
      callbacks.onPtyExited?.(event.data)
      break
    case 'pty.deleted':
      callbacks.onPtyDeleted?.(event.data)
      break

    default:
      // 其余事件（模型/凭据/插件/安装等）当前 UI 不消费
      break
  }
}

// ============================================
// 连接循环
// ============================================

function scheduleReconnect(conn: ServerConnection, _reason: 'network' | 'server-switch' = 'network'): void {
  if (conn.reconnectTimer) return
  if (conn.subscribers.size === 0) return

  const delay = getReconnectDelay(conn.info.reconnectAttempt)
  conn.reconnectTimer = setTimeout(() => {
    conn.reconnectTimer = null
    conn.info = { ...conn.info, reconnectAttempt: conn.info.reconnectAttempt + 1 }
    connectServer(conn.serverId)
  }, delay)
}

async function connectServer(serverId: string): Promise<void> {
  const conn = getOrCreateConnection(serverId)
  if (conn.isConnecting) return

  conn.isConnecting = true
  conn.generation += 1
  const generation = conn.generation

  conn.controller = new AbortController()
  const signal = conn.controller.signal

  updateConnectionState(serverId, { state: 'connecting', error: undefined })

  try {
    // 服务器端点可能变化，重建客户端以读取最新 baseUrl / auth
    invalidateSDKClient(serverId)
    const sdk = getSDKClient(serverId)

    const stream = sdk.event.subscribe({
      signal,
      onActivity: () => {
        if (generation !== conn.generation) return
        updateConnectionState(serverId, { lastEventTime: Date.now() })
      },
    })

    for await (const event of stream) {
      if (generation !== conn.generation) break

      conn.info = { ...conn.info, lastEventTime: Date.now() }

      if (!conn.hasConnectedBefore) {
        conn.hasConnectedBefore = true
        updateConnectionState(serverId, {
          state: 'connected',
          reconnectAttempt: 0,
          error: undefined,
        })
      } else if (conn.info.state !== 'connected') {
        updateConnectionState(serverId, { state: 'connected', reconnectAttempt: 0, error: undefined })
      }

      // server.connected 没有可分发的内容（data 是 {}），只用来标记连接已建立。
      // 通知只在**这一处**发：之前上面那个分支里也发过一次，导致首次连接时
      // 每个订阅者被触发两遍。
      if (event.type === 'server.connected') {
        conn.subscribers.forEach(cb => cb.onServerConnected?.())
        continue
      }

      conn.subscribers.forEach(cb => {
        try {
          dispatchEvent(cb, event)
        } catch (error) {
          cb.onError?.(error instanceof Error ? error : new Error(String(error)))
        }
      })
    }

    // 流正常结束 —— 视为断开并重连
    if (generation === conn.generation) {
      conn.isConnecting = false
      updateConnectionState(serverId, { state: 'disconnected' })
      const wasSwitch = serverSwitchFlags.get(serverId) === true
      serverSwitchFlags.delete(serverId)
      broadcastReconnected(conn, wasSwitch ? 'server-switch' : 'network')
      scheduleReconnect(conn, wasSwitch ? 'server-switch' : 'network')
    }
  } catch (error) {
    if (generation !== conn.generation) return

    conn.isConnecting = false

    // 主动中断（切换服务器 / 取消订阅）不算错误
    if (signal.aborted) {
      updateConnectionState(serverId, { state: 'disconnected' })
      return
    }

    const message = error instanceof Error ? error.message : String(error)
    updateConnectionState(serverId, { state: 'error', error: message })

    conn.subscribers.forEach(cb => {
      cb.onError?.(error instanceof Error ? error : new Error(message))
    })

    scheduleReconnect(conn)
  } finally {
    if (generation === conn.generation) {
      conn.isConnecting = false
    }
  }
}

function disconnectServerConnection(conn: ServerConnection): void {
  conn.generation += 1
  conn.controller?.abort()
  conn.controller = null
  conn.isConnecting = false
  if (conn.reconnectTimer) {
    clearTimeout(conn.reconnectTimer)
    conn.reconnectTimer = null
  }
  conn.hasConnectedBefore = false
  updateConnectionState(conn.serverId, { state: 'disconnected', reconnectAttempt: 0 })
}

// ============================================
// 生命周期 / keepalive
// ============================================

function registerLifecycleListeners(): void {
  if (lifecycleListenersRegistered) return
  if (typeof document === 'undefined') return
  lifecycleListenersRegistered = true

  document.addEventListener('visibilitychange', () => {
    isInBackground = document.visibilityState === 'hidden'
    if (isInBackground) {
      startBackgroundKeepalive()
    } else {
      stopBackgroundKeepalive()
    }
  })

  window.addEventListener('online', () => {
    for (const conn of connections.values()) {
      if (conn.subscribers.size > 0 && conn.info.state !== 'connected') {
        connectServer(conn.serverId)
      }
    }
  })
}

function startBackgroundKeepalive(): void {
  if (keepaliveTimer) return
  keepaliveTimer = setInterval(() => {
    for (const conn of connections.values()) {
      if (conn.subscribers.size === 0) continue
      if (conn.info.state === 'connected') continue
      if (conn.isConnecting) continue
      connectServer(conn.serverId)
    }
  }, BACKGROUND_KEEPALIVE_INTERVAL)
}

function stopBackgroundKeepalive(): void {
  if (keepaliveTimer) {
    clearInterval(keepaliveTimer)
    keepaliveTimer = null
  }
}

// ============================================
// 公开 API
// ============================================

/**
 * 强制重连指定服务器。
 */
export function reconnectServerSSE(serverId: string): void {
  const conn = getOrCreateConnection(serverId)
  conn.info = { ...conn.info, reconnectAttempt: 0 }
  disconnectServerConnection(conn)
  if (conn.subscribers.size > 0) {
    connectServer(serverId)
  }
}

/**
 * 强制重连活动服务器（兼容旧 API）。
 */
export function reconnectSSE(): void {
  reconnectServerSSE(serverStore.getActiveServerId())
}

/**
 * 断开指定服务器的连接。
 */
export function disconnectServerSSE(serverId: string, error?: string): void {
  const conn = connections.get(serverId)
  if (!conn) return
  disconnectServerConnection(conn)
  if (error) {
    updateConnectionState(serverId, { state: 'error', error })
  }
}

/**
 * 断开活动服务器（兼容旧 API）。
 */
export function disconnectSSE(error?: string): void {
  disconnectServerSSE(serverStore.getActiveServerId(), error)
}

/**
 * 读取指定服务器的连接状态。
 */
export function getServerConnectionInfo(serverId: string): ConnectionInfo {
  return connections.get(serverId)?.info ?? DEFAULT_CONNECTION_INFO
}

/**
 * 读取活动服务器的连接状态（兼容旧 API）。
 */
export function getConnectionInfo(): ConnectionInfo {
  return getServerConnectionInfo(serverStore.getActiveServerId())
}

/**
 * 订阅指定服务器的连接状态变化。
 */
export function subscribeToServerConnectionState(serverId: string, fn: (info: ConnectionInfo) => void): () => void {
  let set = connectionListeners.get(serverId)
  if (!set) {
    set = new Set()
    connectionListeners.set(serverId, set)
  }
  set.add(fn)
  fn(getServerConnectionInfo(serverId))
  return () => {
    set.delete(fn)
  }
}

/**
 * 订阅活动服务器的连接状态变化（兼容旧 API）。
 */
export function subscribeToConnectionState(fn: (info: ConnectionInfo) => void): () => void {
  return subscribeToServerConnectionState(serverStore.getActiveServerId(), fn)
}

/**
 * 订阅指定服务器的事件（每服务器独立连接）。
 */
export function subscribeToServerEvents(serverId: string, callbacks: EventCallbacks): () => void {
  registerLifecycleListeners()

  const conn = getOrCreateConnection(serverId)
  conn.subscribers.add(callbacks)

  if (conn.subscribers.size === 1) {
    connectServer(serverId)
  }

  return () => {
    conn.subscribers.delete(callbacks)
    if (conn.subscribers.size === 0) {
      disconnectServerConnection(conn)
    }
  }
}

/**
 * 订阅活动服务器事件（兼容旧 API）。
 * 订阅跟随 active server：切换服务器时自动迁移订阅。
 */
export function subscribeToEvents(callbacks: EventCallbacks): () => void {
  let currentServerId = serverStore.getActiveServerId()
  let unsubscribe = subscribeToServerEvents(currentServerId, callbacks)

  const offServerChange = serverStore.onServerChange((newServerId, reason) => {
    // server-runtime-updated 表示端口/鉴权变了，活动中的连接还连着旧地址，必须拆旧建新
    if (reason === 'server-runtime-updated') {
      if (newServerId !== currentServerId) return
    } else if (newServerId === currentServerId) {
      return
    }
    unsubscribe()
    currentServerId = newServerId
    serverSwitchFlags.set(newServerId, true)
    unsubscribe = subscribeToServerEvents(currentServerId, callbacks)
  })

  return () => {
    offServerChange()
    unsubscribe()
  }
}
