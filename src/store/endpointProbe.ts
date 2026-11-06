// ============================================
// endpointProbe - 多地址自动探测与主备切换（Issue #183）
//
// 设计取舍（详见 docs/plan-multi-endpoint-and-reconnect.md）：
//
// 1. **主备，不是负载均衡**。按 priority 升序，高优先级可达就用它，
//    不与低优先级比延迟。内外网场景里「内网快」是结构性的，测速只会引入抖动。
//
// 2. **降级快、升级慢**。高优先级连续 K 次失败就降级；低优先级要连续 N 次
//    成功、且已稳定运行 dwell 时间才升回。这是防抖的核心 —— 只做降级会永久
//    卡在公网，只做升级会来回横跳。
//
// 3. **全部不可达时保持现状**。不随机挑一个，避免把「网络还没恢复」误判成
//    「换条路试试」。用户此时看到的是原有的断线重连逻辑在起作用。
//
// 4. **探测历史不跨网络事件保留**（RFC 8305 §4）：`online` / `offline` 时清空
//    所有探测状态。断网期间所有地址都会失败，带着这些失败的计数恢复网络后
//    会立刻误判降级。
//
// 5. **锁定优先**。`lockedUrl` 非空时本模块完全让位，一个字都不改。
// ============================================

import { serverStore, type ServerEndpoint, type ServerAuth } from './serverStore'
import { getServerConnectionInfo, subscribeToServerConnectionState } from '../api/events'
import { logger } from '../utils/logger'

/** 探测周期。多地址服务器才探测，单地址零成本 */
const PROBE_INTERVAL_MS = 15_000
/** 单次探测超时。要小于探测周期，否则请求会堆积 */
const PROBE_TIMEOUT_MS = 4_000
/** 连续失败多少次判定「这条不可用」→ 降级 */
const DEGRADE_FAIL_THRESHOLD = 2
/** 连续成功多少次判定「高优先级恢复了」→ 允许升级 */
const UPGRADE_OK_THRESHOLD = 3
/** 升级前必须在当前地址上停留多久，避免刚切完立刻切回 */
const UPGRADE_DWELL_MS = 30_000
/**
 * 降级状态下的「归位探测」节奏。
 *
 * 全局轮询是 15s，但当前正停在低优先级地址时（内网挂了、走公网），
 * 用 15s 去等内网恢复等于让用户白等 30~45s。这里对降级中的服务器
 * 单独加密探测，连续 3 次成功 ≈ 9s 就能切回。
 *
 * 只在降级时启用：正常情况下不多发请求。
 */
const RECOVERY_PROBE_INTERVAL_MS = 3_000
/**
 * 传输层报错后的确认探测间隔。
 *
 * SSE 断开是「当前地址可能死了」的最快信号（比 15s 轮询快得多），
 * 收到就立刻探一轮；若当前地址确实不可达，再等这一小段补一轮凑够
 * 降级阈值 K，把「切网络 → 换地址」压到秒级，而不是等下一个周期。
 */
const CONFIRM_DELAY_MS = 1_500
/** 传输层报错触发快速探测的节流（SSE 会反复重试，别跟着刷探测） */
const FAST_PROBE_THROTTLE_MS = 3_000

export interface EndpointProbeState {
  /** 最近一次探测是否可达 */
  reachable: boolean
  /** 最近一次探测延迟（ms），不可达时 undefined */
  latency?: number
  /** 连续可达次数 */
  consecutiveOk: number
  /** 连续不可达次数 */
  consecutiveFail: number
  /** 最近一次探测时刻（performance.now()） */
  lastChecked: number
}

export interface ProbeDecision {
  url: string
  /** failover = 当前地址失效被迫换路；recover = 高优先级恢复后按滞回切回 */
  reason: 'failover' | 'recover'
}

/** 探测状态集合：`serverId → (url → state)` */
type ProbeStateMap = Map<string, Map<string, EndpointProbeState>>

const probeStates: ProbeStateMap = new Map()

/**
 * 决定要不要换地址。**纯函数**，不含任何 IO / 全局状态，便于单测。
 *
 * 返回 null 表示保持现状。
 *
 * @param endpoints 该服务器的地址列表（已按 priority 升序）
 * @param activeUrl 当前生效地址；null 表示从未显式选过（按主地址对待）
 * @param states    每条地址的最新探测状态
 * @param elapsedSinceSwitchMs 距上次切换的毫秒数（升级滞回用）
 */
export function decideEndpointSwitch(
  endpoints: ServerEndpoint[] | undefined,
  activeUrl: string | null,
  states: Map<string, EndpointProbeState>,
  elapsedSinceSwitchMs: number,
): ProbeDecision | null {
  if (!endpoints || endpoints.length < 2) return null

  // 未选过 / 选了个已不在列表里的地址，都按主地址（priority 最小）对待
  const currentIndex = (() => {
    if (!activeUrl) return 0
    const index = endpoints.findIndex(endpoint => endpoint.url === activeUrl)
    return index === -1 ? 0 : index
  })()
  const currentUrl = endpoints[currentIndex].url
  const currentState = states.get(currentUrl)

  // 首次选择：默认地址已确认不可达，且别处可达 → 立刻换（一次探测即可定性）。
  // 只在前方不可达时动手：默认地址好好的就别多发一次切换广播。
  if (!activeUrl) {
    if (currentState && !currentState.reachable) {
      const backup = bestReachable(endpoints, states, currentIndex)
      if (backup) return { url: backup, reason: 'failover' }
    }
    return null
  }

  // 当前地址连续失败 → 换到「可达地址里优先级最高的那条」。
  // 注意是全局挑最优，不是只往后找：当前若是低优先级地址失效，
  // 而高优先级恰好恢复，也该直接切过去，不该卡在更低优先级上。
  if (currentState && currentState.consecutiveFail >= DEGRADE_FAIL_THRESHOLD) {
    const target = bestReachable(endpoints, states, currentIndex)
    return target ? { url: target, reason: 'failover' } : null
  }

  // 当前地址健康 → 只有当更高优先级的地址连续成功够多、且已稳定运行
  // 超过滞回窗口，才切回去。只做降级会永久停在公网，只做升级会来回横跳。
  if (!currentState?.reachable) return null
  if (elapsedSinceSwitchMs < UPGRADE_DWELL_MS) return null

  for (let i = 0; i < currentIndex; i++) {
    const state = states.get(endpoints[i].url)
    if (state?.reachable && state.consecutiveOk >= UPGRADE_OK_THRESHOLD) {
      return { url: endpoints[i].url, reason: 'recover' }
    }
  }

  return null
}

/**
 * 在「除 currentIndex 外」的地址里挑可达且优先级最高（index 最小）的那条。
 * 全部不可达时返回 null —— 调用方据此「保持现状」，不随机挑。
 */
function bestReachable(
  endpoints: ServerEndpoint[],
  states: Map<string, EndpointProbeState>,
  currentIndex: number,
): string | null {
  for (let i = 0; i < endpoints.length; i++) {
    if (i === currentIndex) continue
    if (states.get(endpoints[i].url)?.reachable) return endpoints[i].url
  }
  return null
}

/**
 * 用一次探测结果更新状态（纯函数，返回新状态，不改原对象）。
 */
export function applyProbeResult(
  previous: EndpointProbeState | undefined,
  reachable: boolean,
  latency: number | undefined,
  now: number,
): EndpointProbeState {
  const base = previous ?? { reachable: false, consecutiveOk: 0, consecutiveFail: 0, lastChecked: 0 }
  return {
    reachable,
    latency: reachable ? latency : undefined,
    consecutiveOk: reachable ? base.consecutiveOk + 1 : 0,
    consecutiveFail: reachable ? 0 : base.consecutiveFail + 1,
    lastChecked: now,
  }
}

/** 读取某服务器某地址的探测状态（测试与调试用） */
export function getProbeState(serverId: string, url: string): EndpointProbeState | undefined {
  return probeStates.get(serverId)?.get(url)
}

/** 清空全部探测状态（网络事件、测试用） */
export function resetAllProbeStates(): void {
  probeStates.clear()
}

let timer: ReturnType<typeof setInterval> | null = null
let listenersRegistered = false
/**
 * 正在探测的服务器。主线轮询（15s）和归位探测（3s）是两个独立定时器，
 * 相位总会撞上；并发探同一台会让 consecutiveOk/Fail 一轮涨两次，
 * 升级/降级阈值被变相减半，切地址开始抖动。
 */
const inFlightServers = new Set<string>()

/**
 * 对一台多地址服务器跑一轮探测，并按结果决定是否切换。
 * 导出供测试直接驱动，不需等真实定时器。
 */
export async function probeServerOnce(serverId: string, now = performance.now()): Promise<void> {
  if (inFlightServers.has(serverId)) return
  inFlightServers.add(serverId)
  try {
    await probeServerOnceInner(serverId, now)
  } finally {
    inFlightServers.delete(serverId)
  }
}

async function probeServerOnceInner(serverId: string, now: number): Promise<void> {
  const server = serverStore.getServer(serverId)
  if (!server?.endpoints || server.endpoints.length < 2) {
    // 地址被删光 / 退回单地址：连带清掉陈旧状态，避免 Map 只增不减
    probeStates.delete(serverId)
    return
  }

  const runtime = serverStore.getEndpointRuntime(serverId)
  // 锁定期间完全让位
  if (runtime.lockedUrl) return

  const states = probeStates.get(serverId) ?? new Map<string, EndpointProbeState>()
  probeStates.set(serverId, states)

  // 用户改过地址列表：丢掉已不存在的地址的历史，避免陈旧计数参与决策
  const live = new Set(server.endpoints.map(endpoint => endpoint.url))
  for (const url of states.keys()) {
    if (!live.has(url)) states.delete(url)
  }

  const auth: ServerAuth | undefined = server.auth

  // 并发探测所有地址：地址数很少（通常 2 个），并发能压缩单轮耗时
  const results = await Promise.all(
    server.endpoints.map(async endpoint => ({
      url: endpoint.url,
      latency: await serverStore.probeEndpoint(endpoint.url, auth, PROBE_TIMEOUT_MS),
    })),
  )

  for (const { url, latency } of results) {
    states.set(url, applyProbeResult(states.get(url), latency !== null, latency ?? undefined, now))
  }

  const decision = decideEndpointSwitch(
    server.endpoints,
    runtime.activeUrl,
    states,
    now - runtime.lastSwitchAt,
  )
  if (!decision) return

  const switched = serverStore.setActiveEndpoint(serverId, decision.url)
  if (switched) {
    logger.log(
      `[endpointProbe] ${serverId}: ${decision.reason} → ${decision.url} ` +
        `(latency ${states.get(decision.url)?.latency ?? '?'}ms)`,
    )
  }
}

/**
 * 传输层报错 → 立刻探测并补一轮。
 *
 * SSE 断开/报错是「当前入口可能不可达」的最快信号。15s 轮询要等到下一个
 * 周期才知道网络变了；这里收到信号就探，探出当前地址死掉后补一轮凑够降级
 * 阈值，把换地址压到秒级。
 *
 * 节流：SSE 会自动重试，每次失败都来一遍会把探测刷爆。
 */
const fastProbeState = new Map<string, { lastAt: number; confirmTimer: ReturnType<typeof setTimeout> | null }>()

function handleTransportFailure(serverId: string): void {
  // 只关心配了多地址、且没锁定的服务器
  const server = serverStore.getServer(serverId)
  if (!server?.endpoints || server.endpoints.length < 2) return
  if (serverStore.getEndpointRuntime(serverId).lockedUrl) return

  const now = Date.now()
  const entry = fastProbeState.get(serverId) ?? { lastAt: 0, confirmTimer: null }
  if (now - entry.lastAt < FAST_PROBE_THROTTLE_MS) return
  entry.lastAt = now

  if (entry.confirmTimer) clearTimeout(entry.confirmTimer)
  entry.confirmTimer = setTimeout(() => {
    entry.confirmTimer = null
    // 第一轮：确认当前地址是否真死了
    void probeServerOnce(serverId).then(() => {
      const runtime = serverStore.getEndpointRuntime(serverId)
      const activeStillFailing = probeStates
        .get(serverId)
        ?.get(runtime.activeUrl ?? server.endpoints![0].url)
      if (!activeStillFailing || activeStillFailing.reachable) return
      // 第二轮：当前地址确实不可达 → 再探一次凑够降级阈值，尽快切走
      entry.confirmTimer = setTimeout(() => {
        entry.confirmTimer = null
        void probeServerOnce(serverId)
      }, CONFIRM_DELAY_MS)
    })
  }, CONFIRM_DELAY_MS)
  fastProbeState.set(serverId, entry)
}

/** 观察到的连接状态（只在「从可用变成不可用」时触发快速探测） */
const observedConnectionStates = new Map<string, string>()
const observedServers = new Set<string>()
/** 每个已观察服务器的退订函数。服务器删除时必须调用，否则 connectionListeners 只增不减 */
const observedUnsubscribes = new Map<string, () => void>()

/** 上次注册观察者时的服务器面（id + 地址集 + 凭据）。未变化直接跳过 */
let observedSignature: string | null = null

function serverObservationSignature(): string {
  return serverStore
    .getStoredServers()
    .map(server => {
      const endpoints = server.endpoints?.map(endpoint => endpoint.url).join(',') ?? server.url
      return `${server.id}\0${endpoints}\0${server.auth?.username ?? ''}:${server.auth?.password ?? ''}`
    })
    .join('|')
}

function registerConnectionObservers(): void {
  // serverStore 的通知也来自健康检查（15s/10s 级），与「哪些服务器需要观察」
  // 无关。签名没变就不重建 Set / 不重复比对，避免每次体检都白跑一遍。
  const signature = serverObservationSignature()
  if (signature === observedSignature) return
  observedSignature = signature

  const liveIds = new Set<string>()
  for (const server of serverStore.getStoredServers()) {
    const serverId = server.id
    liveIds.add(serverId)
    if (observedServers.has(serverId)) continue
    observedServers.add(serverId)
    const unsubscribe = subscribeToServerConnectionState(serverId, info => {
      const previous = observedConnectionStates.get(serverId)
      observedConnectionStates.set(serverId, info.state)
      // 只对「曾经连上过、现在掉了」出手；首次连接中的 error 不算
      if (previous === 'connected' && info.state !== 'connected') {
        handleTransportFailure(serverId)
      }
    })
    observedUnsubscribes.set(serverId, unsubscribe)
  }
  // 服务器被删 → 退订并清掉观察状态，否则删了再加会漏订阅、
  // 且 events 模块里的监听器集合只增不减（旧连接对象被永久持有）
  for (const serverId of [...observedServers]) {
    if (liveIds.has(serverId)) continue
    observedUnsubscribes.get(serverId)?.()
    observedUnsubscribes.delete(serverId)
    observedServers.delete(serverId)
    observedConnectionStates.delete(serverId)
    const entry = fastProbeState.get(serverId)
    if (entry?.confirmTimer) clearTimeout(entry.confirmTimer)
    fastProbeState.delete(serverId)
  }
}

async function runProbeRound(): Promise<void> {
  // 离线 / 页面隐藏时不探测：离线时全部地址必然失败，探了只会污染计数；
  // 隐藏时省电。恢复在线 / 可见时事件会立即补一轮。
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
  const servers = serverStore.getStoredServers()
  // 只探「值得探」的服务器：
  //   - 单地址：没得选
  //   - 已锁地址：本模块完全让位
  //   - 正停在最高优先级地址且 SSE 已连上：当前入口就是事实可用，周期性
  //     探测只会每 15s 白打 N 个请求（双地址 = 8 次/分钟）。真挂了会先表现为
  //     SSE 断开 → handleTransportFailure 立刻快探，用不着常态轮询。
  //   - 已降级（停在低优先级地址）：交给 3s 的 recoveryTimer 加密探测
  const targets = servers.filter(server => {
    if (!server.endpoints || server.endpoints.length < 2) return false
    const runtime = serverStore.getEndpointRuntime(server.id)
    if (runtime.lockedUrl) return false
    const active = runtime.activeUrl ?? server.endpoints[0].url
    if (active !== server.endpoints[0].url) return false
    return getServerConnectionInfo(server.id).state !== 'connected'
  })
  if (targets.length === 0) return
  // 逐台快照：probeServerOnce 内部已按 serverId 去重，这里不需要全局闸门
  await Promise.allSettled(targets.map(server => probeServerOnce(server.id)))
}

/**
 * 该服务器是否处于「降级状态」——即当前生效的不是最高优先级地址。
 * 只有这种状态下才需要加密探测等高优先级恢复。
 */
function isDegraded(serverId: string): boolean {
  const server = serverStore.getServer(serverId)
  if (!server?.endpoints || server.endpoints.length < 2) return false
  const runtime = serverStore.getEndpointRuntime(serverId)
  if (runtime.lockedUrl) return false
  const active = runtime.activeUrl ?? server.endpoints[0].url
  return active !== server.endpoints[0].url
}

let recoveryTimer: ReturnType<typeof setInterval> | null = null

/**
 * 归位探测：处于降级状态时，用更快的节奏探（默认 3s），
 * 连续 N 次成功 + 滞回满足就能尽快切回内网。
 *
 * 代价可控：只有「当前没走最优地址」的服务器才会被高频探测，
 * 正常状态下这个循环什么都不做。
 */
async function runRecoveryRound(): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
  const degraded = serverStore.getStoredServers().filter(server => isDegraded(server.id))
  if (degraded.length === 0) return
  await Promise.allSettled(degraded.map(server => probeServerOnce(server.id)))
}

/** 已注册的全局监听撤销函数（stop 时统一回收，避免重复注册 / 泄漏） */
const listenerDisposers: Array<() => void> = []

function registerProbeListeners(): void {
  if (listenersRegistered) return
  if (typeof window === 'undefined') return
  listenersRegistered = true

  // 网络切换后探测历史一律作废（RFC 8305 §4）：断网期间的失败计数
  // 不能带到恢复后的判断里
  const onOnline = () => {
    resetAllProbeStates()
    void runProbeRound()
  }
  const onOffline = () => resetAllProbeStates()
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
  listenerDisposers.push(() => {
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOffline)
  })

  // 回到前台立即补一轮：后台期间没探测，回来时可能已经换了网络环境
  if (typeof document !== 'undefined') {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void runProbeRound()
        void runRecoveryRound()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    listenerDisposers.push(() => document.removeEventListener('visibilitychange', onVisibility))
  }

  // 服务器增删也会影响观察集合（新加的多地址服务器也要能吃到快速探测）
  const unsubscribeStore = serverStore.subscribe(() => registerConnectionObservers())
  listenerDisposers.push(unsubscribeStore)
  registerConnectionObservers()
}

/**
 * 启动自动探测循环。重复调用安全（幂等）。
 * 只在存在多地址服务器时才产生网络开销。
 */
export function startEndpointProbe(): void {
  if (timer) return
  registerProbeListeners()
  // 首轮立即跑，让「初次启动按内外网选一个」尽快生效；
  // 但错开一个宏任务，避免挡住首屏渲染
  void runProbeRound()
  timer = setInterval(() => void runProbeRound(), PROBE_INTERVAL_MS)

  // 归位探测：降级状态下加密探测高优先级地址，别让用户干等 15s 轮询
  recoveryTimer = setInterval(() => void runRecoveryRound(), RECOVERY_PROBE_INTERVAL_MS)
}

/** 停止探测循环（测试 / 卸载用） */
export function stopEndpointProbe(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  if (recoveryTimer) {
    clearInterval(recoveryTimer)
    recoveryTimer = null
  }
  for (const entry of fastProbeState.values()) {
    if (entry.confirmTimer) clearTimeout(entry.confirmTimer)
  }
  fastProbeState.clear()
  // 观察订阅也要断开：否则停了线性循环、旧监听器还在触发快速探测
  for (const unsubscribe of observedUnsubscribes.values()) unsubscribe()
  observedUnsubscribes.clear()
  observedServers.clear()
  observedConnectionStates.clear()
  observedSignature = null
  // 全局监听同样回收，允许 stop 之后重新 start
  for (const dispose of listenerDisposers) dispose()
  listenerDisposers.length = 0
  listenersRegistered = false
}
