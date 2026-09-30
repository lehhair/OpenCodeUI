// ============================================
// Server-scoped Event Subscription (SSE) —— V2 重写（阶段 2b）
// ============================================
//
// ── 与 V1 的三点根本差异（照 v2.0.19 源码 + 实测确认）──────────────────
//
//   1. **端点**：`GET /api/event`（V1 是 `/global/event`）
//      帧格式只有一层 JSON：`data: {id, created?, metadata?, location?, type, data}\n\n`
//      （`packages/server/src/event-feed.ts:29`），**没有** `event:` / `id:` 行；
//      心跳是每 15 秒一行注释 `: heartbeat`；首帧是 `server.connected`。
//
//   2. **流是「易失」的**（官方契约原文：*"Volatile by contract: a slow consumer
//      overflows and fails the stream, and events during disconnection are missed."*）
//      → **不回放、不自动重连**。订阅队列 4096，溢出直接断流。
//      → 恢复策略必须是「**重新订阅 + 重拉一次全量消息**」，只重订阅会丢消息。
//
//   3. **传输层改用官方 `client.event.subscribe()`**（取舍见下方「传输层决策」）。
//
// ── 传输层决策：为什么用官方 subscribe() ────────────────────────────────
//
//   官方实现（`@opencode/client` 的 `SharedEvents.make`）已经做了本项目 V1 手写
//   1060 行里的绝大部分事情：
//     - 共享一条懒连接（`current`）：多个订阅者复用同一个流，最后一个退出才关闭；
//     - 每个订阅者一条 4096 容量的队列，溢出时报
//       `Event subscriber exceeded its 4096-event capacity`；
//     - SSE 文本解析（多行 `data:` 合并、`\r\n` 归一、增量 UTF-8 解码）；
//     - `onActivity` 回调：**含心跳在内的任何传输活动**都会触发 → 天然的心跳信号。
//   官方**没有**做：自动重连、状态机、代次防串扰、退避、后台保活 —— 这些仍然由本文件负责。
//
//   ⚠️ 官方 `subscribe()` 的共享连接是**按 client 实例**的；`sdk.ts` 按
//      `serverId → baseUrl+auth` 缓存 client，所以「每服务器一条流」的语义保持不变。
//
//   ⚠️ **Tauri 下未实测**：本项目在 Tauri 里把 `plugin-http` 的 fetch 注入给
//      `OpenCode.make({ fetch })`，官方 subscribe 会用它读 `response.body`。
//      `plugin-http` 的流式响应**理论上**支持（其 Response 带 ReadableStream），
//      但本容器无 Tauri 运行环境，**未做真机验证**（如实记录在阶段 2b 报告里）。
//      若真机发现流式异常，回退方案是：把 `createEventTransport()` 换成手写
//      `fetch('/api/event') + ReadableStream`，其余（分发/合并/重连）一行都不用改
//      —— 传输层已被刻意隔离成单个函数。
//
// ── 保留自 V1 的能力（这些是对的，不要丢）─────────────────────────────
//
//   - 每服务器独立连接 + 订阅者集合 + 连接状态广播（`useSyncExternalStore` 友好）
//   - 代次（generation）防串扰：重连后旧连接的回调自动失效
//   - `RECONNECT_DELAYS` 指数退避（后台另有一套更激进的延迟）
//   - 心跳超时判定 + 后台 keepalive 轮询 + 可见性/网络上下线生命周期监听
//   - `onReconnected` 广播（带 cooldown），驱动上层「重拉」
//   - `coalesceEvents()` 批量合并（4096 队列溢出是真实风险，必须保留）
// ============================================

import { getSDKClient } from './sdk'
import { toInternalPermissionRequest } from './v2Convert'
import { isTauri } from '../utils/tauri'
import { serverStore } from '../store/serverStore'
import type { EventCallbacks, Session, V2EventUnion } from './types'
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
  /** 当前连接的取消句柄（abort 会让官方 subscribe 的迭代器结束） */
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
// 常量
// ============================================

const RECONNECT_DELAYS = [1000, 2000, 3000, 5000, 10000, 30000]
/** 后台时使用更激进的重连延迟，确保尽快恢复连接 */
const BACKGROUND_RECONNECT_DELAYS = [500, 1000, 2000, 3000, 5000, 10000]
/**
 * 心跳超时。
 *
 * 服务端每 **15 秒** 发一行 `: heartbeat` 注释（`packages/server/src/handlers/event.ts:22`），
 * 官方 subscribe 的 `onActivity` 会为它触发 → 60 秒（= 4 个心跳周期）没动静即视为死连接。
 */
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
// Connection helpers
// ============================================

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

function finalizeConnectionAttempt(conn: ServerConnection, generation: number): boolean {
  if (generation !== conn.generation) {
    return false
  }
  conn.isConnecting = false
  return true
}

/**
 * 广播 onReconnected，带 cooldown 防止快速重连时密集触发数据拉取
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

/** 断开并清理连接的传输层，不更新状态 */
function teardownConnectionTransport(conn: ServerConnection): void {
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

  void runEventStream(conn)
}

// ============================================
// 传输层：官方 client.event.subscribe()
// ============================================

/**
 * 创建事件流迭代器。
 *
 * 单独抽出来是为了**隔离传输层**：Tauri 真机若发现 `plugin-http` 的流式有问题，
 * 只需把这里换成手写 `fetch('/api/event') + ReadableStream`，其余逻辑一行不动。
 */
function createEventTransport(
  serverId: string,
  signal: AbortSignal,
  onActivity: () => void,
): AsyncIterable<V2EventUnion> {
  return getSDKClient(serverId).event.subscribe({ signal, onActivity })
}

/**
 * 跑一条事件流，直到流结束 / 出错 / 被代次作废。
 *
 * ⚠️ 官方 subscribe **不会**自动重连（`SharedEvents.make` 的 `run()` 结束后
 *    共享连接即被 `stop()` 清掉），所以这里读完后必须自己走退避重连。
 */
async function runEventStream(conn: ServerConnection) {
  const myGeneration = conn.generation
  const serverId = conn.serverId

  conn.controller = new AbortController()
  const signal = conn.controller.signal

  // 事件回调里**绝不能做耗时操作**（4096 队列溢出会直接断流）：
  // 官方迭代器已经把事件放进订阅者队列，我们只做「解析 → 合并 → 分发」。
  const pending: V2EventUnion[] = []
  let flushScheduled = false

  const flush = () => {
    flushScheduled = false
    if (pending.length === 0) return
    const batch = pending.splice(0, pending.length)
    // 代次不匹配说明已经重连过了，丢弃旧连接的事件
    if (myGeneration !== conn.generation) return
    for (const event of coalesceEvents(batch)) {
      broadcastEvent(conn, event)
    }
  }

  try {
    const iterator = createEventTransport(serverId, signal, () => {
      // 任何传输活动（含 15s 的 `: heartbeat` 注释行）都算心跳
      if (myGeneration === conn.generation) resetHeartbeat(conn)
    })[Symbol.asyncIterator]()

    // 连接建立：官方 subscribe 的首次 `next()` 会真正发起 fetch。
    // 这里不 await 第一个事件，而是先乐观置为 connected —— 若首个 next() 抛错，
    // 下面的 catch 会把状态改成 error 并安排重连，不会停留在错误的 connected 上。
    const first = await iterator.next()
    if (myGeneration !== conn.generation) {
      void iterator.return?.()
      return
    }
    if (first.done) {
      throw new Error('Event stream closed immediately')
    }

    conn.isConnecting = false
    updateConnectionState(serverId, { state: 'connected', reconnectAttempt: 0, error: undefined })
    resetHeartbeat(conn)
    if (import.meta.env.DEV) {
      console.log(`[SSE] ${serverId} connected (transport: ${isTauri() ? 'tauri-fetch' : 'browser-fetch'})`)
    }

    // 每次连接成功都通知订阅者刷新数据：
    // 覆盖「首次连接（先开 UI 后开 server）」「网络重连」「服务器切换」三种场景。
    // ⚠️ V2 的流是易失的（不回放）→ 订阅者收到后必须**重拉一次全量消息**。
    const reason = serverSwitchFlags.get(serverId) ? ('server-switch' as const) : ('network' as const)
    serverSwitchFlags.delete(serverId)
    broadcastReconnected(conn, reason)

    // 首个事件也别丢
    pending.push(first.value)
    flushScheduled = true
    flush()

    while (true) {
      if (myGeneration !== conn.generation || signal.aborted) break

      const { done, value } = await iterator.next()
      if (myGeneration !== conn.generation || signal.aborted) break
      if (done) {
        if (import.meta.env.DEV) {
          console.log(`[SSE] ${serverId} stream ended, reconnecting...`)
        }
        updateConnectionState(serverId, { state: 'disconnected' })
        scheduleReconnect(conn)
        break
      }

      pending.push(value)
      if (!flushScheduled) {
        flushScheduled = true
        // 微任务批量：把同一轮 event loop 里到达的事件合成一批，
        // 让 coalesceEvents 有机会把同 (message, part, field) 的 delta 合并。
        queueMicrotask(flush)
      }
    }
  } catch (error) {
    if (!finalizeConnectionAttempt(conn, myGeneration)) return
    if (myGeneration !== conn.generation) return

    const err = error instanceof Error ? error : new Error(String(error))
    if (err.name === 'AbortError' || signal.aborted) return

    if (import.meta.env.DEV) {
      console.warn(`[SSE] ${serverId} event stream error:`, err)
    }
    updateConnectionState(serverId, { state: 'error', error: err.message || 'Connection failed' })
    conn.subscribers.forEach(cb => {
      cb.onError?.(err)
    })
    scheduleReconnect(conn)
  }
}

// ============================================
// Delta coalescing（V2）
// ============================================
//
// 背景：订阅队列容量 4096，**溢出即断流**（`event-feed.ts` 的 SubscriberOverflowError）。
// 所以「先入队、再合并、批量分发」是必须的，不能每个事件都直接走一遍 React 更新。
//
// 合并规则（与 V1 的 coalesceEvents 同思路，字段路径按 V2 重写）：
//   1. 同一批内相同 (sessionID, messageID, partID, kind) 的 delta 合并成一个（字符串拼接）；
//   2. 某个 part 的**整块更新**（started/ended/called/success/failed）到达后，
//      丢弃该 part 在途的 delta —— 整块数据已经是权威的，再叠增量会重复。
//
// 键里的 `partID` 是**已算好的 UI part id**（text/reasoning 用 `消息id:content:下标`，
// tool 用工具 id），与 store 的定位规则完全一致。

/** 从 delta 事件里取出合并键与目标 partID（V2 字段路径） */
function deltaInfoOf(
  event: V2EventUnion,
): { key: string; sessionID: string; messageID: string; partID: string; kind: string; delta: string } | null {
  switch (event.type) {
    case EventTypes.SESSION_TEXT_DELTA: {
      const { sessionID, assistantMessageID, ordinal, delta } = event.data
      return {
        key: `${sessionID}\0${assistantMessageID}\0${contentPartId(assistantMessageID, ordinal)}\0text`,
        sessionID,
        messageID: assistantMessageID,
        partID: contentPartId(assistantMessageID, ordinal),
        kind: 'text',
        delta,
      }
    }
    case EventTypes.SESSION_REASONING_DELTA: {
      const { sessionID, assistantMessageID, ordinal, delta } = event.data
      return {
        key: `${sessionID}\0${assistantMessageID}\0${contentPartId(assistantMessageID, ordinal)}\0reasoning`,
        sessionID,
        messageID: assistantMessageID,
        partID: contentPartId(assistantMessageID, ordinal),
        kind: 'reasoning',
        delta,
      }
    }
    case EventTypes.SESSION_TOOL_INPUT_DELTA: {
      const { sessionID, assistantMessageID, id, delta } = event.data
      return {
        key: `${sessionID}\0${assistantMessageID}\0${id}\0input`,
        sessionID,
        messageID: assistantMessageID,
        partID: id,
        kind: 'input',
        delta,
      }
    }
    default:
      return null
  }
}

/** text / reasoning 的 UI part id 规则（与 `messageConversion.ts` 保持一致） */
export function contentPartId(messageID: string, ordinal: number): string {
  return `${messageID}:content:${ordinal}`
}

/**
 * 批量合并事件（**导出仅为单测**，生产路径由 `runEventStream` 的 flush 调用）
 */
export function coalesceEvents(events: V2EventUnion[]): V2EventUnion[] {
  if (events.length <= 1) return events

  const result: V2EventUnion[] = []
  /** delta 键 -> result 里的下标 */
  const deltaIndexByKey = new Map<string, number>()
  /** 被整块更新作废的 delta 下标 */
  const staleIndices = new Set<number>()
  /** 本批里已被整块更新覆盖的 (sessionID, messageID, partID) */
  const replacedParts = new Set<string>()

  for (const event of events) {
    const delta = deltaInfoOf(event)
    if (delta) {
      // 该 part 已有整块更新 → 这条 delta 是多余的（整块数据更权威）
      if (replacedParts.has(`${delta.sessionID}\0${delta.messageID}\0${delta.partID}`)) {
        continue
      }
      const idx = deltaIndexByKey.get(delta.key)
      if (idx !== undefined && !staleIndices.has(idx)) {
        const target = result[idx]
        if (target && 'data' in target && 'delta' in (target.data as { delta?: unknown })) {
          ;(target.data as { delta: string }).delta += delta.delta
        }
        continue
      }
      result.push(event)
      deltaIndexByKey.set(delta.key, result.length - 1)
      continue
    }

    // 整块更新：登记它覆盖了哪些 part，并作废对应的在途 delta
    for (const partKey of partKeysOf(event)) {
      replacedParts.add(partKey)
      const prefix = `${partKey}\0`
      for (const [key, idx] of deltaIndexByKey) {
        if (key.startsWith(prefix)) {
          staleIndices.add(idx)
          deltaIndexByKey.delete(key)
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

/**
 * 一个事件覆盖了哪些 part（用于作废在途 delta）
 *
 * - text / reasoning 的 started/ended：`消息id:content:下标`
 * - tool 的各阶段：工具 id
 * - `session.message.content.updated`：覆盖该消息的**全部** content 块
 *   → 返回 `消息id:*` 前缀标记，由调用方按前缀匹配
 */
function partKeysOf(event: V2EventUnion): string[] {
  switch (event.type) {
    case EventTypes.SESSION_TEXT_STARTED:
    case EventTypes.SESSION_TEXT_ENDED:
    case EventTypes.SESSION_REASONING_STARTED:
    case EventTypes.SESSION_REASONING_ENDED: {
      const { sessionID, assistantMessageID, ordinal } = event.data
      return [`${sessionID}\0${assistantMessageID}\0${contentPartId(assistantMessageID, ordinal)}`]
    }
    case EventTypes.SESSION_TOOL_INPUT_STARTED:
    case EventTypes.SESSION_TOOL_INPUT_ENDED:
    case EventTypes.SESSION_TOOL_CALLED:
    case EventTypes.SESSION_TOOL_PROGRESS:
    case EventTypes.SESSION_TOOL_SUCCESS:
    case EventTypes.SESSION_TOOL_FAILED: {
      const { sessionID, assistantMessageID, id } = event.data
      return [`${sessionID}\0${assistantMessageID}\0${id}`]
    }
    default:
      return []
  }
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
        const timeSinceLastEvent = Date.now() - conn.info.lastEventTime
        if (timeSinceLastEvent > HEARTBEAT_TIMEOUT) {
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

function broadcastEvent(conn: ServerConnection, event: V2EventUnion) {
  conn.subscribers.forEach(callbacks => {
    handleEventForSubscriber(event, callbacks)
  })
}

// ============================================
// V2 事件 → 回调分发（阶段 2b 核心）
// ============================================

/**
 * 把一条 V2 事件分发给订阅者。
 *
 * 设计要点：
 *   1. **入参是 V2 事件本身**（不是 V1 的 `payload`）—— 字段路径全在 `event.data` 下。
 *   2. text / reasoning 的 **UI part id 在这里算好**再交给 store
 *      （规则 = `消息id:content:下标`，与 `messageConversion.ts` 同一套），
 *      避免 store 与 events 各算一遍导致漂移。
 *   3. 未处理的事件类型**静默忽略**（V2 会下发很多本项目不关心的事件，
 *      例如 pty / shell / websearch / plugin / credential …）。
 */
function handleEventForSubscriber(event: V2EventUnion, callbacks: EventCallbacks) {
  switch (event.type) {
    // ==========================================
    // 消息族
    // ==========================================

    case EventTypes.SESSION_MESSAGE_CONTENT_UPDATED: {
      callbacks.onMessageUpdated?.({
        sessionID: event.data.sessionID,
        messageID: event.data.messageID,
        content: event.data.content,
      })
      break
    }

    case EventTypes.SESSION_TEXT_STARTED: {
      const { sessionID, assistantMessageID, ordinal } = event.data
      callbacks.onPartUpdated?.({
        kind: 'content',
        sessionID,
        messageID: assistantMessageID,
        ordinal,
        // started 时文本为空（真内容走 delta / ended）。
        // ⚠️ V2 的 text 块**没有 time 字段**（reasoning 才有），不能凭空补。
        content: { type: 'text', text: '' },
      })
      break
    }
    case EventTypes.SESSION_TEXT_ENDED: {
      const { sessionID, assistantMessageID, ordinal, text } = event.data
      callbacks.onPartUpdated?.({
        kind: 'content',
        sessionID,
        messageID: assistantMessageID,
        ordinal,
        content: { type: 'text', text },
      })
      break
    }

    case EventTypes.SESSION_REASONING_STARTED: {
      const { sessionID, assistantMessageID, ordinal } = event.data
      callbacks.onPartUpdated?.({
        kind: 'content',
        sessionID,
        messageID: assistantMessageID,
        ordinal,
        content: { type: 'reasoning', text: '', time: { created: event.created } },
      })
      break
    }
    case EventTypes.SESSION_REASONING_ENDED: {
      const { sessionID, assistantMessageID, ordinal, text } = event.data
      callbacks.onPartUpdated?.({
        kind: 'content',
        sessionID,
        messageID: assistantMessageID,
        ordinal,
        content: { type: 'reasoning', text },
      })
      break
    }

    // 工具输入流：`streaming` 态的 input 是**未解析的原始字符串**（V1 的 pending）
    case EventTypes.SESSION_TOOL_INPUT_STARTED: {
      const { sessionID, assistantMessageID, id, name } = event.data
      callbacks.onPartUpdated?.({
        kind: 'content',
        sessionID,
        messageID: assistantMessageID,
        ordinal: -1,
        content: {
          type: 'tool',
          id,
          name,
          time: { created: event.created },
          state: { status: 'streaming', input: '' },
        },
      })
      break
    }
    case EventTypes.SESSION_TOOL_INPUT_ENDED: {
      const { sessionID, assistantMessageID, id, text } = event.data
      callbacks.onPartUpdated?.({
        kind: 'content',
        sessionID,
        messageID: assistantMessageID,
        ordinal: -1,
        content: {
          type: 'tool',
          id,
          // 名字由前面的 input.started 给过；这里服务端不再重复下发 → 用空串占位，
          // store 的合并逻辑会保留已有的 name（见 messageStore.handlePartUpdated）
          name: '',
          time: { created: event.created },
          state: { status: 'streaming', input: text },
        },
      })
      break
    }

    case EventTypes.SESSION_TOOL_CALLED: {
      const { sessionID, assistantMessageID, id, input, executed, state } = event.data
      callbacks.onPartUpdated?.({
        kind: 'content',
        sessionID,
        messageID: assistantMessageID,
        ordinal: -1,
        content: {
          type: 'tool',
          id,
          name: '',
          time: { created: event.created },
          executed,
          providerState: state,
          state: { status: 'running', input, metadata: {} },
        },
      })
      break
    }
    case EventTypes.SESSION_TOOL_PROGRESS: {
      const { sessionID, assistantMessageID, id, metadata } = event.data
      callbacks.onPartUpdated?.({
        kind: 'content',
        sessionID,
        messageID: assistantMessageID,
        ordinal: -1,
        content: {
          type: 'tool',
          id,
          name: '',
          time: { created: event.created },
          state: { status: 'running', input: {}, metadata },
        },
      })
      break
    }
    case EventTypes.SESSION_TOOL_SUCCESS: {
      const { sessionID, assistantMessageID, id, content, metadata, executed, resultState } = event.data
      callbacks.onPartUpdated?.({
        kind: 'content',
        sessionID,
        messageID: assistantMessageID,
        ordinal: -1,
        content: {
          type: 'tool',
          id,
          name: '',
          time: { created: event.created, completed: event.created },
          executed,
          providerState: resultState,
          state: { status: 'completed', input: {}, content, metadata },
        },
      })
      break
    }
    case EventTypes.SESSION_TOOL_FAILED: {
      const { sessionID, assistantMessageID, id, error, content, metadata, executed, resultState } = event.data
      callbacks.onPartUpdated?.({
        kind: 'content',
        sessionID,
        messageID: assistantMessageID,
        ordinal: -1,
        content: {
          type: 'tool',
          id,
          name: '',
          time: { created: event.created, completed: event.created },
          executed,
          providerState: resultState,
          state: { status: 'error', input: {}, error, content, metadata },
        },
      })
      break
    }

    // step 开始：新建 assistant 消息的权威信号（带 agent / model）
    case EventTypes.SESSION_STEP_STARTED: {
      const { sessionID, assistantMessageID, agent, model, started } = event.data
      callbacks.onPartUpdated?.({
        kind: 'step-start',
        sessionID,
        messageID: assistantMessageID,
        agent,
        model,
        started,
      })
      break
    }

    // step 结束 / 失败：成本、用量、结束原因从 part 上移到了 assistant 顶层
    case EventTypes.SESSION_STEP_ENDED: {
      const { sessionID, assistantMessageID, finish, rawFinish, cost, tokens, providerState } = event.data
      callbacks.onPartUpdated?.({
        kind: 'step',
        sessionID,
        messageID: assistantMessageID,
        finish,
        rawFinish,
        cost,
        tokens,
      })
      // providerState 渲染层零消费，丢弃（与阶段 2a 的转换层一致）
      void providerState
      break
    }
    case EventTypes.SESSION_STEP_FAILED: {
      const { sessionID, assistantMessageID, error, finish, rawFinish, cost, tokens } = event.data
      callbacks.onPartUpdated?.({
        kind: 'step',
        sessionID,
        messageID: assistantMessageID,
        finish,
        rawFinish,
        cost,
        tokens,
        error,
      })
      break
    }

    // 增量
    case EventTypes.SESSION_TEXT_DELTA:
    case EventTypes.SESSION_REASONING_DELTA: {
      const { sessionID, assistantMessageID, ordinal, delta } = event.data
      callbacks.onPartDelta?.({
        sessionID,
        messageID: assistantMessageID,
        partID: contentPartId(assistantMessageID, ordinal),
        kind: event.type === EventTypes.SESSION_TEXT_DELTA ? 'text' : 'reasoning',
        delta,
      })
      break
    }
    case EventTypes.SESSION_TOOL_INPUT_DELTA: {
      const { sessionID, assistantMessageID, id, delta } = event.data
      callbacks.onPartDelta?.({
        sessionID,
        messageID: assistantMessageID,
        partID: id,
        kind: 'input',
        delta,
      })
      break
    }

    // 重试：V2 是 assistant 的字段（V1 是独立的 retry part）
    case EventTypes.SESSION_RETRY_SCHEDULED: {
      const { sessionID, assistantMessageID, attempt, at, error } = event.data
      callbacks.onSessionRetry?.({ sessionID, assistantMessageID, attempt, at, error })
      break
    }

    // 会话级累计用量
    case EventTypes.SESSION_USAGE_UPDATED: {
      const { sessionID, cost, tokens } = event.data
      callbacks.onSessionUsage?.({ sessionID, cost, tokens })
      break
    }

    // ==========================================
    // 转录被外部改动 → 重拉消息
    // ==========================================
    //
    // V1 靠 `message.part.removed` 做本地删除；V2 没有对应事件，
    // 取消/回退（revert 三段式）与用户中断都会让**服务端转录整体变化** →
    // 本地缓存已不可信，只能重新拉一次（V2 的流不回放，没有增量可对账）。
    case EventTypes.SESSION_REVERT_STAGED:
    case EventTypes.SESSION_REVERT_COMMITTED:
    case EventTypes.SESSION_REVERT_CLEARED: {
      callbacks.onMessagesInvalidated?.(event.data.sessionID)
      break
    }

    // ==========================================
    // 执行生命周期（V2 实测：**这才是「一轮开始 / 结束」的真实信号**）
    // ==========================================
    //
    // 🔴 阶段 2b 实测修正（重要）：迁移文档 §6.4 把 `session.idle` 与
    //    `session.status` 判为「✅ 原样可用」，但 **v2.0.19 实测二者从未下发**：
    //      - `session.idle` 在 schema 里已被标注 `// deprecated`
    //      - `session.status` 连一次都没出现过（用一次带工具调用的完整回合，
    //        持续监听 100 秒逐帧核对）
    //    两者都仍在 `ServerDefinitions` 里（所以类型/常量都在），只是没有生产者。
    //
    //    → 「一轮跑完」改用**确实会下发**的 `session.execution.*`：
    //        started     → 状态 busy
    //        succeeded   → 状态 idle + `onSessionIdle`（等价 V1 的 session.idle）
    //        failed      → 状态 idle + `onSessionError`
    //        interrupted → 状态 idle + `onSessionIdle` + `onMessagesInvalidated`
    //                      （用户中断：转录被截断，且必须让 isStreaming 落回 false，
    //                        否则界面会一直停在"生成中"）
    case EventTypes.SESSION_EXECUTION_STARTED: {
      callbacks.onSessionStatus?.({ sessionID: event.data.sessionID, status: { type: 'busy' } })
      break
    }
    case EventTypes.SESSION_EXECUTION_SUCCEEDED: {
      const { sessionID } = event.data
      callbacks.onSessionStatus?.({ sessionID, status: { type: 'idle' } })
      callbacks.onSessionIdle?.({ sessionID })
      break
    }
    case EventTypes.SESSION_EXECUTION_INTERRUPTED: {
      const { sessionID } = event.data
      callbacks.onSessionStatus?.({ sessionID, status: { type: 'idle' } })
      callbacks.onSessionIdle?.({ sessionID })
      callbacks.onMessagesInvalidated?.(sessionID)
      break
    }

    // ==========================================
    // 会话族
    // ==========================================

    case EventTypes.SESSION_CREATED: {
      callbacks.onSessionCreated?.(sessionFromCreatedEvent(event))
      break
    }
    case EventTypes.SESSION_DELETED: {
      callbacks.onSessionDeleted?.({ sessionID: event.data.sessionID })
      break
    }
    case EventTypes.SESSION_IDLE: {
      callbacks.onSessionIdle?.({ sessionID: event.data.sessionID })
      break
    }
    case EventTypes.SESSION_STATUS: {
      callbacks.onSessionStatus?.({ sessionID: event.data.sessionID, status: event.data.status })
      break
    }
    // V1 的 `session.updated` 在 V2 被拆成多个事件 → 统一成「会话元信息补丁」
    case EventTypes.SESSION_RENAMED: {
      callbacks.onSessionUpdated?.({ id: event.data.sessionID, title: event.data.title })
      break
    }
    case EventTypes.SESSION_METADATA_UPDATED: {
      // metadata 里可能有 title（非契约）→ 有就带上，没有就只通知"变了"
      const title = readString(event.data.metadata, 'title')
      callbacks.onSessionUpdated?.({ id: event.data.sessionID, title })
      break
    }
    case EventTypes.SESSION_MOVED: {
      callbacks.onSessionUpdated?.({
        id: event.data.sessionID,
        directory: event.data.location?.directory,
      })
      break
    }
    case EventTypes.SESSION_AGENT_SELECTED:
    case EventTypes.SESSION_MODEL_SELECTED: {
      // agent / model 不参与会话列表与标题展示 → 只作为"元信息变了"通知
      callbacks.onSessionUpdated?.({ id: event.data.sessionID })
      break
    }
    case EventTypes.SESSION_EXECUTION_FAILED: {
      const { sessionID, error } = event.data
      callbacks.onSessionStatus?.({ sessionID, status: { type: 'idle' } })
      callbacks.onSessionError?.({ sessionID, error })
      break
    }

    // ==========================================
    // 权限 / 表单
    // ==========================================

    case EventTypes.PERMISSION_ASKED: {
      // V2 载荷 → 内部 `PermissionRequest`（字段名不同，见 v2Convert 的映射表）
      callbacks.onPermissionAsked?.(toInternalPermissionRequest(event.data))
      break
    }
    case EventTypes.PERMISSION_REPLIED: {
      callbacks.onPermissionReplied?.(event.data)
      break
    }
    case EventTypes.FORM_CREATED: {
      callbacks.onFormCreated?.(event.data)
      break
    }
    case EventTypes.FORM_REPLIED: {
      callbacks.onFormReplied?.(event.data)
      break
    }
    case EventTypes.FORM_CANCELLED: {
      callbacks.onFormCancelled?.(event.data)
      break
    }

    // ==========================================
    // 项目 / Worktree / VCS
    // ==========================================

    case EventTypes.PROJECT_UPDATED: {
      callbacks.onProjectUpdated?.(event.data)
      break
    }
    case EventTypes.WORKTREE_UPDATED: {
      callbacks.onWorktreeUpdated?.(event.data)
      break
    }
    case EventTypes.WORKTREE_RESOLVED: {
      callbacks.onWorktreeResolved?.(event.data)
      break
    }
    case EventTypes.VCS_BRANCH_UPDATED: {
      callbacks.onVcsBranchUpdated?.(event.data)
      break
    }

    // ==========================================
    // 服务
    // ==========================================

    case EventTypes.SERVER_CONNECTED: {
      // ⚠️ V2 的 `data` 是空对象，V1 那个 `properties.timestamp` 没有了。
      // 尽力而为：事件的 `created`（服务端若给了）拿去做时钟校准，
      // 没有就传 undefined（serverStore 会静默忽略）。
      callbacks.onServerConnected?.({ timestamp: readCreated(event) })
      break
    }

    default:
      // 忽略其他事件类型（V2 会下发大量本项目不关心的事件）
      break
  }
}

function readString(source: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = source?.[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** 读事件的 `created`（`server.connected` 在类型上没有该字段，运行时可能有） */
function readCreated(event: V2EventUnion): number | undefined {
  const created = (event as { created?: unknown }).created
  return typeof created === 'number' ? created : undefined
}

/**
 * `session.created` 事件 → 内部 `ApiSession`
 *
 * ⚠️ 事件字段与 REST 的 `Session.Info` **不一致**，必须逐字段对照：
 *   | 概念 | 事件 | REST `Session.Info` |
 *   |---|---|---|
 *   | id | **`sessionID`** | `id` |
 *   | 目录 | `location.directory` | `location.directory` |
 *   | 标题 | `title?` | `title?` |
 *   | slug / version | **有** | ❌ 没有（`toInternalSession` 用 id / 空串兜底） |
 *   | 时间 | ❌ **没有 `time`** | `time.created/updated` |
 *   | 成本/用量 | ❌ 没有 | `cost` / `tokens` |
 *   → 时间用**事件自身的 `created`** 兜底（就是这条事件产生的时刻，语义正确）。
 */
function sessionFromCreatedEvent(event: Extract<V2EventUnion, { type: 'session.created' }>): Session {
  const data = event.data
  const created = readCreated(event) ?? Date.now()
  return {
    id: data.sessionID,
    slug: data.slug,
    projectID: data.projectID,
    directory: data.location.directory,
    path: data.subpath,
    parentID: data.parentID,
    summary: undefined,
    // 事件里没有成本/用量（新建会话必然为 0）
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    share: undefined,
    title: data.title ?? '',
    agent: data.agent,
    model: data.model
      ? {
          // V1 用 modelID，V2 的 ModelRef 用 id（与 v2Convert.toInternalSession 一致）
          id: data.model.id,
          providerID: data.model.providerID,
          variant: data.model.variant,
        }
      : undefined,
    version: data.version,
    metadata: data.metadata as Record<string, unknown> | undefined,
    time: { created, updated: created },
  }
}

// ============================================
// Public API
// ============================================

/**
 * 强制重连指定服务器 SSE（用于切换服务器等场景）
 * 断开当前连接 → 重置状态 → 立即重连（新 URL 由 getSDKClient(serverId) 动态解析）
 */
export function reconnectServerSSE(serverId: string) {
  const conn = connections.get(serverId)
  if (!conn || conn.subscribers.size === 0) return // 没有订阅者不需要重连

  if (import.meta.env.DEV) {
    console.log(`[SSE] reconnectServerSSE(${serverId}) called, forcing reconnect...`)
  }

  if (conn.heartbeatTimer) clearTimeout(conn.heartbeatTimer)
  if (conn.reconnectTimer) clearTimeout(conn.reconnectTimer)
  conn.reconnectTimer = null
  stopBackgroundKeepalive()

  // 标记为服务器切换，重连成功时 onReconnected 会携带 'server-switch' reason
  serverSwitchFlags.set(serverId, true)

  // 递增连接代次，使旧连接的事件回调自动失效
  conn.generation++
  teardownConnectionTransport(conn)

  updateConnectionState(serverId, {
    state: 'disconnected',
    reconnectAttempt: 0,
    error: undefined,
  })

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
    // server-runtime-updated 表示端口/鉴权变了（WSL sidecar 重启、本地运行时 URL 切换），
    // 活动中的 SSE 还连着旧地址，必须拆旧建新；建连时 URL/鉴权由 getSDKClient
    // 从 serverStore 现读，重订阅即拿到新值。但该广播由 upsertServer 对任意服务器无条件发出
    // （含非 active 服务器首次注册，如 WSL 就绪）：本 shim 的订阅跟随 active server，
    // 变化的不是当前订阅的服务器时只能忽略，否则会把订阅错误地「迁移」到非 active 服务器上
    if (reason === 'server-runtime-updated') {
      if (newServerId !== currentServerId) return
    } else if (newServerId === currentServerId) {
      // 同 id 且非 runtime 变更 → 无需重订阅
      return
    }
    unsubscribe()
    currentServerId = newServerId
    unsubscribe = subscribeToServerEvents(currentServerId, callbacks)
  })

  return () => {
    offServerChange()
    unsubscribe()
  }
}
