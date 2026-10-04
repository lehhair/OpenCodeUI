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
  /** 空闲看门狗计时器 */
  watchdogTimer: ReturnType<typeof setInterval> | null
  /** 看门狗主动掐断标记（区分于取消订阅/切换服务器的主动 abort） */
  watchdogDrop: boolean
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
/**
 * 空闲看门狗：服务端每 15s 发心跳（心跳也算 onActivity），
 * 超过 IDLE_TIMEOUT 没有任何字节说明是半开连接（休眠/闪断），
 * 主动掐断重连（官方客户端 45s 静默即 abort，此处对齐）。
 */
const WATCHDOG_INTERVAL = 15_000
const IDLE_TIMEOUT = 45_000

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
      watchdogTimer: null,
      watchdogDrop: false,
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
//
// ---------------------------------------------------------------------------
// 已分发但本应用**故意不消费**的事件（盘点，避免以后误判成漏接）
//
// 这些回调会被调用、但没有任何消费方。逐个核对过，都不是"忘了接"：
//
//   worktree.updated / worktree.resolved / vcs.branch.updated
//       → 由 WorktreePanel 与 useGitWorkspaceCatalog 通过 subscribeToEvents 直接消费
//   pty.created / updated / exited / deleted
//       → 终端自己用 WebSocket 桥（api/ptyBridge.ts）感知 connected/data/
//         disconnected，PTY 结束时 socket 本身会断，无需再听这些事件
//   session.created / renamed
//       → SessionContext 通过 subscribeToEvents 直接消费（会话列表）
//   session.permissions / session.viewed / session.forked
//       → 待办权限走 permission.request.list；查看/分叉都由本端主动操作后刷新
//   mcp.status.changed
//       → McpPanel 打开时现拉，无缓存可失效
//   project.updated
//       → 项目信息由会话/目录切换时刷新
//   session.inbox.enqueued / delivered / cancelled / delivery.changed
//       → 已接入：排队消息走服务端 inbox（官方同款），enqueued 回声上屏 +
//         进队列视图，delivered/cancelled 出队，delivery.changed 更新投递方式
//   session.revert.staged / cleared / committed
//       → 撤销/重做目前由 UI 驱动并随后重拉消息（store 的 setRevertState /
//         truncateAfterRevert）。**已知偏差**：官方 revert.committed 会就地
//         splice 掉 id >= to 的消息（data.ts:1076-1092），本端没做，因此
//         多客户端同时操作时可能不同步。单客户端使用不受影响。
//   session.moved
//       → 官方会插入 location-switched 消息并更新会话 location；本端切换
//         worktree 走的是整表重拉，因此没做。**已知偏差**，同上属多客户端场景。
//   filesystem.changed
//       → 真机验证（v2.0.14）：在监听目录里创建/修改/删除文件，12 秒内
//         **没有**收到该事件（只有 server.connected）。因此"没消费它"目前
//         不是可复现的缺口，未做处理。若将来发现它真的会推，再考虑接。
// ---------------------------------------------------------------------------

function dispatchEvent(callbacks: EventCallbacks, event: GlobalEvent): void {
  // 信封里负载之外的字段（id/created/metadata），官方处理器能直接拿到，这里显式转发。
  // 注意 `created`：`server.connected` 是唯一**没有** created 的事件类型
  //（V2EventServerConnected = { id, metadata?, location?, type, data: {} }，
  //  它的负载也是空的、只用来标记连接建立）。这里用 `in` 收窄，避免整体强转。
  const facts = {
    id: event.id,
    created: 'created' in event ? event.created : undefined,
    metadata: 'metadata' in event ? event.metadata : undefined,
  }

  switch (event.type) {
    // ---- 会话生命周期 ----
    case 'session.created':
      callbacks.onSessionCreated?.(event.data, facts)
      break
    case 'session.renamed':
      callbacks.onSessionRenamed?.(event.data, facts)
      break
    case 'session.deleted':
      callbacks.onSessionDeleted?.(event.data, facts)
      break
    case 'session.idle':
      callbacks.onSessionIdle?.(event.data, facts)
      break
    case 'session.status':
      callbacks.onSessionStatus?.(event.data, facts)
      break
    case 'session.viewed':
      callbacks.onSessionViewed?.(event.data, facts)
      break
    case 'session.moved':
      callbacks.onSessionMoved?.(event.data, facts)
      break
    case 'session.forked':
      callbacks.onSessionForked?.(event.data, facts)
      break
    case 'session.permissions':
      callbacks.onSessionPermissions?.(event.data, facts)
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
      callbacks.onTextStarted?.(event.data, facts)
      break
    case 'session.text.delta':
      callbacks.onTextDelta?.(event.data, facts)
      break
    case 'session.text.ended':
      callbacks.onTextEnded?.(event.data, facts)
      break

    // ---- 推理流 ----
    case 'session.reasoning.started':
      callbacks.onReasoningStarted?.(event.data, facts)
      break
    case 'session.reasoning.delta':
      callbacks.onReasoningDelta?.(event.data, facts)
      break
    case 'session.reasoning.ended':
      callbacks.onReasoningEnded?.(event.data, facts)
      break

    // ---- 工具流 ----
    case 'session.tool.input.started':
      callbacks.onToolInputStarted?.(event.data, facts)
      break
    case 'session.tool.input.delta':
      callbacks.onToolInputDelta?.(event.data, facts)
      break
    case 'session.tool.input.ended':
      callbacks.onToolInputEnded?.(event.data, facts)
      break
    case 'session.tool.called':
      callbacks.onToolCalled?.(event.data, facts)
      break
    case 'session.tool.progress':
      callbacks.onToolProgress?.(event.data, facts)
      break
    case 'session.tool.success':
      callbacks.onToolSuccess?.(event.data, facts)
      break
    case 'session.tool.failed':
      callbacks.onToolFailed?.(event.data, facts)
      break

    // ---- 会话内的实时补充信息 ----
    //
    // 这三个事件都在 V2Event 联合里（确实会通过 SSE 送达）：
    //   - retry.scheduled：负载与 UI 的 RetryPart 一一对应；不接的话
    //     重试提示只在重新加载后才出现
    //   - synthetic：注入的系统上下文，对应 UI 已有的 synthetic part
    //   - usage.updated：成本/token，让用量指示在流式期间即准确
    case 'session.retry.scheduled':
      callbacks.onRetryScheduled?.(event.data, facts)
      break
    case 'session.synthetic':
      callbacks.onSynthetic?.(event.data, facts)
      break
    case 'session.usage.updated':
      callbacks.onUsageUpdated?.(event.data, facts)
      break

    // ---- 会话级切换 / 压缩 / shell / skill / instructions ----
    //
    // 这些事件都在 V2Event 联合里（SSE 会送达），store 也都有对应处理器。
    // 不接的话：压缩进度行、会话级模型/agent、shell 与 skill 消息
    // 都只能在重新加载后（走消息列表）才出现。
    case 'session.agent.selected':
      callbacks.onAgentSelected?.(event.data, facts)
      break
    case 'session.model.selected':
      callbacks.onModelSelected?.(event.data, facts)
      break
    case 'session.compaction.started':
      callbacks.onCompactionStarted?.(event.data, facts)
      break
    case 'session.compaction.delta':
      callbacks.onCompactionDelta?.(event.data, facts)
      break
    case 'session.compaction.ended':
      callbacks.onCompactionEnded?.(event.data, facts)
      break
    case 'session.compaction.failed':
      callbacks.onCompactionFailed?.(event.data, facts)
      break
    case 'session.shell.started':
      callbacks.onShellStarted?.(event.data, facts)
      break
    case 'session.shell.ended':
      callbacks.onShellEnded?.(event.data, facts)
      break
    case 'session.skill.activated':
      callbacks.onSkillActivated?.(event.data, facts)
      break
    case 'session.instructions.updated':
      callbacks.onInstructionsUpdated?.(event.data, facts)
      break

    // ---- step ----
    case 'session.step.started':
      callbacks.onStepStarted?.(event.data, facts)
      break
    case 'session.step.streamed':
      callbacks.onStepStreamed?.(event.data, facts)
      break
    case 'session.step.ended':
      callbacks.onStepEnded?.(event.data, facts)
      break
    case 'session.step.failed':
      callbacks.onStepFailed?.(event.data, facts)
      break

    // ---- 执行生命周期 ----
    case 'session.execution.started':
      callbacks.onExecutionStarted?.(event.data, facts)
      break
    case 'session.execution.succeeded':
      callbacks.onExecutionSucceeded?.(event.data, facts)
      break
    case 'session.execution.failed':
      callbacks.onExecutionFailed?.(event.data, facts)
      break
    case 'session.execution.interrupted':
      callbacks.onExecutionInterrupted?.(event.data, facts)
      break

    // ---- 权限 ----
    case 'permission.asked':
      callbacks.onPermissionAsked?.(event.data, facts)
      break
    case 'permission.replied':
      callbacks.onPermissionReplied?.(event.data, facts)
      break

    // ---- 表单（取代 v1 question） ----
    case 'form.created':
      callbacks.onFormCreated?.(event.data, facts)
      break
    case 'form.replied':
      callbacks.onFormReplied?.(event.data, facts)
      break
    case 'form.cancelled':
      callbacks.onFormCancelled?.(event.data, facts)
      break

    // ---- 回退 ----
    case 'session.revert.staged':
      callbacks.onRevertStaged?.(event.data, facts)
      break
    case 'session.revert.cleared':
      callbacks.onRevertCleared?.(event.data, facts)
      break
    case 'session.revert.committed':
      callbacks.onRevertCommitted?.(event.data, facts)
      break

    // ---- inbox ----
    case 'session.inbox.enqueued':
      callbacks.onInboxEnqueued?.(event.data, facts)
      break
    case 'session.inbox.delivered':
      callbacks.onInboxDelivered?.(event.data, facts)
      break
    case 'session.inbox.cancelled':
      callbacks.onInboxCancelled?.(event.data, facts)
      break
    case 'session.inbox.delivery.changed':
      callbacks.onInboxDeliveryChanged?.(event.data, facts)
      break

    // ---- 外围 ----
    case 'project.updated':
      callbacks.onProjectUpdated?.(event.data, facts)
      break
    case 'worktree.updated':
      callbacks.onWorktreeUpdated?.(event.data, facts)
      break
    case 'worktree.resolved':
      callbacks.onWorktreeResolved?.(event.data, facts)
      break
    case 'vcs.branch.updated':
      callbacks.onVcsBranchUpdated?.(event.data, facts)
      break
    case 'mcp.status.changed':
      callbacks.onMcpStatusChanged?.(event.data, facts)
      break
    case 'plugin.updated':
      callbacks.onPluginUpdated?.(event.data, facts)
      break
    // provider / model 目录失效。真机验证（v2.0.14）：连接建立后与配置变更时
    // 都会推，负载为空 `{}`。此前**完全没有分发**，导致模型目录缓存陈旧。
    // 官方对应处理见 packages/client/src/solid/data.ts:1208-1215（invalidate + sync）。
    case 'provider.updated':
      callbacks.onProviderUpdated?.(event.data, facts)
      break
    case 'model.updated':
      callbacks.onModelUpdated?.(event.data, facts)
      break
    case 'filesystem.changed':
      callbacks.onFilesystemChanged?.(event.data, facts)
      break

    // ---- PTY ----
    case 'pty.created':
      callbacks.onPtyCreated?.(event.data, facts)
      break
    case 'pty.updated':
      callbacks.onPtyUpdated?.(event.data, facts)
      break
    case 'pty.exited':
      callbacks.onPtyExited?.(event.data, facts)
      break
    case 'pty.deleted':
      callbacks.onPtyDeleted?.(event.data, facts)
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

    // 空闲看门狗：心跳也会触发 onActivity 刷新 lastEventTime，
    // 因此超过 IDLE_TIMEOUT 无字节就是半开连接（休眠/闪断）——
    // for-await 会永远挂起、状态永远停在 connected，必须主动掐断重连
    //（对齐官方客户端 45s 静默 abort）。
    conn.watchdogDrop = false
    conn.watchdogTimer = setInterval(() => {
      if (generation !== conn.generation) return
      if (conn.info.state !== 'connected') return
      const last = conn.info.lastEventTime
      if (last <= 0) return
      if (Date.now() - last <= IDLE_TIMEOUT) return
      conn.watchdogDrop = true
      conn.controller?.abort()
    }, WATCHDOG_INTERVAL)

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
        // 首次连接不广播 onReconnected：初始加载由各订阅方自己拉取；
        // 若本次连接是服务器切换后的重连，清掉标记即可（切服务器的
        // 数据刷新由 server-change 链路负责）
        serverSwitchFlags.delete(serverId)
        updateConnectionState(serverId, {
          state: 'connected',
          reconnectAttempt: 0,
          error: undefined,
        })
      } else if (conn.info.state !== 'connected') {
        updateConnectionState(serverId, { state: 'connected', reconnectAttempt: 0, error: undefined })
        // 掉线后的**重连成功**：断线窗口错过的事件协议明确不补发，
        // 广播 onReconnected 让订阅者做补偿拉取（对齐官方：每次
        // server.connected 都触发 bootstrap refetch）。广播必须在
        // 重连成功之后发——之前在断流时就发，REST 补拉注定失败被吞。
        const wasSwitch = serverSwitchFlags.get(serverId) === true
        serverSwitchFlags.delete(serverId)
        broadcastReconnected(conn, wasSwitch ? 'server-switch' : 'network')
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

    // 流正常结束 —— 视为断开并重连（onReconnected 在重连成功后广播）
    if (generation === conn.generation) {
      conn.isConnecting = false
      updateConnectionState(serverId, { state: 'disconnected' })
      scheduleReconnect(conn)
    }
  } catch (error) {
    if (generation !== conn.generation) return

    conn.isConnecting = false

    // 主动中断不算错误；但看门狗掐断的半开连接需要重连
    if (signal.aborted) {
      updateConnectionState(serverId, { state: 'disconnected' })
      if (conn.watchdogDrop) {
        conn.watchdogDrop = false
        scheduleReconnect(conn)
      }
      return
    }

    const message = error instanceof Error ? error.message : String(error)
    updateConnectionState(serverId, { state: 'error', error: message })

    conn.subscribers.forEach(cb => {
      cb.onError?.(error instanceof Error ? error : new Error(message))
    })

    scheduleReconnect(conn)
  } finally {
    if (conn.watchdogTimer) {
      clearInterval(conn.watchdogTimer)
      conn.watchdogTimer = null
    }
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
  conn.watchdogDrop = false
  if (conn.watchdogTimer) {
    clearInterval(conn.watchdogTimer)
    conn.watchdogTimer = null
  }
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
