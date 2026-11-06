// ============================================
// Server Store - 多后端服务器配置管理
// ============================================

import { API_BASE_URL } from '../constants'
import { isTauri } from '../utils/tauri'

// Tauri plugin-http fetch 缓存（避免重复 dynamic import）
let _tauriFetch: typeof globalThis.fetch | null = null
let _tauriFetchLoading: Promise<typeof globalThis.fetch> | null = null

async function getUnifiedFetch(): Promise<typeof globalThis.fetch> {
  if (!isTauri()) return globalThis.fetch
  if (_tauriFetch) return _tauriFetch
  if (_tauriFetchLoading) return _tauriFetchLoading
  _tauriFetchLoading = import('@tauri-apps/plugin-http').then(mod => {
    _tauriFetch = mod.fetch as unknown as typeof globalThis.fetch
    return _tauriFetch
  })
  return _tauriFetchLoading
}

/**
 * 服务器认证信息
 */
export interface ServerAuth {
  username: string // 用户名 (默认 opencode)
  password: string // 密码
}

/**
 * 服务器地址（Issue #183：同一台服务器可有多个入口）。
 *
 * 典型场景：`opencode serve` 同时有内网直连和公网隧道两个入口。
 * `priority` 越小越优先，与设置页里的行号一致（第一行 0，往下递增）——
 * 这是**主备**语义，不是负载均衡：高优先级可达就一直用它，不去比延迟。
 */
export interface ServerEndpoint {
  /** 归一化后的服务器地址（不含尾部斜杠） */
  url: string
  /** 优先级，越小越优先；缺省或并列时按列表顺序 */
  priority: number
  /** 用户可读标签（如「内网」「公网」），仅展示 */
  label?: string
}

/**
 * 服务器配置
 */
export interface ServerConfig {
  id: string // 唯一标识
  name: string // 显示名称
  url: string // 主地址 (不含尾部斜杠)；等价 endpoints 中优先级最高者
  /**
   * 多地址列表（可选）。缺省表示单地址服务器，行为与旧版完全一致。
   * 存在时 `url` 仍是主地址，`getServerBaseUrl` 会优先返回当前生效地址。
   */
  endpoints?: ServerEndpoint[]
  isDefault?: boolean // 是否为默认服务器
  auth?: ServerAuth // 认证信息 (可选)
}

/**
 * 服务器健康状态
 */
export interface ServerHealth {
  status: 'checking' | 'online' | 'offline' | 'error' | 'unauthorized'
  latency?: number // 响应延迟 (ms)
  lastCheck?: number // 上次检查时间戳
  error?: string // 错误信息
  details?: string // 原始诊断信息
  version?: string // 服务器版本
}

export interface ServerSettingsBackup {
  servers: ServerConfig[]
  activeServerId: string | null
  /** 启动默认服务器偏好；旧备份没有该字段，导入时按无偏好处理 */
  defaultServerId?: string | null
}

interface ServerClockCalibration {
  serverTimestamp: number
  calibratedAtMonotonic: number
}

type Listener = () => void
export type ServerChangeReason =
  | 'server-switch'
  | 'local-runtime-url'
  | 'server-runtime-updated'
  /**
   * 同一台服务器换入口地址（Issue #183：内网 ↔ 公网切换）。
   *
   * 与 server-switch 的区别：数据主体（会话/消息/布局）**不变**，
   * 只是 baseUrl 换了。因此消费方不该走「清空 → 重拉」，
   * 而应交由 SSE 重连后的 onReconnected 做补偿刷新。
   */
  | 'endpoint-switch'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * 归一化单条地址：去尾部斜杠。非字符串 / 空串返回 undefined。
 */
function normalizeEndpointUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed.replace(/\/+$/, '')
}

/**
 * 解析并归一化服务器的多地址列表（持久化与备份导入共用）。
 *
 * - 丢弃非法项（非对象 / url 非字符串）
 * - 按 url 去重（保留首次出现的优先级）
 * - 按 priority 升序稳定排序
 * - 空结果返回 undefined（表示退回单地址语义）
 */
export function normalizeEndpoints(raw: unknown): ServerEndpoint[] | undefined {
  if (!Array.isArray(raw)) return undefined

  const seen = new Set<string>()
  const parsed: ServerEndpoint[] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    const url = normalizeEndpointUrl(item.url)
    if (!url || seen.has(url)) continue
    seen.add(url)
    const priority = typeof item.priority === 'number' && Number.isFinite(item.priority) ? item.priority : 0
    const label = typeof item.label === 'string' && item.label.trim() ? item.label.trim() : undefined
    parsed.push({ url, priority, ...(label ? { label } : {}) })
  }

  if (parsed.length === 0) return undefined
  // 稳定排序：priority 相同的保持录入顺序
  return parsed.sort((a, b) => a.priority - b.priority)
}

/**
 * 取「优先级最高的地址」，即地址列表的主地址。
 * 无 endpoints 时返回 undefined（调用方退回 `server.url`）。
 */
export function primaryEndpointUrl(endpoints: ServerEndpoint[] | undefined): string | undefined {
  return endpoints?.[0]?.url
}

/**
 * 把「监听所有接口」的绑定地址归一化成可连接的地址。
 *
 * `0.0.0.0` / `[::]` 是 bind 地址而非连接目标：Chromium（WebView2 / WKWebView）
 * 会拒绝对它的请求。后台服务以 `--hostname 0.0.0.0` 启动时，注册表里就是这种地址，
 * 直接拿来用会让整个本地连接（含终端 WebSocket）失败——统一改写成回环
 * （绑 0.0.0.0 时回环必然可达）。Rust 侧 `connectable_url` 同款规则，
 * 这里再兜一层，防止旧版本后端 / 残留注册表把不可连接地址带进界面。
 */
export function normalizeConnectableUrl(url: string): string {
  return url
    .replace(/^http:\/\/0\.0\.0\.0:/i, 'http://127.0.0.1:')
    .replace(/^https:\/\/0\.0\.0\.0:/i, 'https://127.0.0.1:')
    .replace(/^http:\/\/\[::\]:/i, 'http://[::1]:')
    .replace(/^https:\/\/\[::\]:/i, 'https://[::1]:')
}

/**
 * 服务端地址是否指向本机回环（决定桌面端拖入的文件能否直接引用本机路径）。
 *
 * 注意 IPv6 的 `hostname` **带方括号**（`new URL('http://[::1]:4096').hostname === '[::1]'`），
 * 所以不能只判 `::1`。`0.0.0.0` / `[::]` 这类绑定地址已由
 * `normalizeConnectableUrl` 归一化成回环。
 */
export function isLocalServerHost(url: string | undefined): boolean {
  if (!url) return false
  try {
    const { hostname } = new URL(url)
    const host = hostname.toLowerCase()
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]'
  } catch {
    return false
  }
}

function normalizeConnectionError(err: unknown): string {  if (err instanceof DOMException && err.name === 'AbortError') return 'Connection timed out'
  if (!(err instanceof Error)) return 'Connection failed'

  const message = err.message || 'Connection failed'
  if (/certificate|cert|tls|ssl/i.test(message)) {
    return `TLS/certificate error: ${message}`
  }
  return message
}

function redactHeaderValue(key: string, value: string): string {
  return /set-cookie|authorization|proxy-authorization/i.test(key) ? '<redacted>' : value
}

function headersToRecord(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {}
  headers.forEach((value, key) => {
    result[key] = redactHeaderValue(key, value)
  })
  return result
}

function truncateForDiagnostics(value: string, maxLength = 5000): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}\n...[truncated ${value.length - maxLength} chars]`
}

function formatResponseDiagnostics(options: {
  url: string
  response: Response
  latency: number
  body: string
}): string {
  const contentType = options.response.headers.get('content-type') ?? ''
  return [
    `Request: GET ${options.url}`,
    `Status: ${options.response.status}${options.response.statusText ? ` ${options.response.statusText}` : ''}`,
    `Latency: ${options.latency}ms`,
    `Content-Type: ${contentType || '(none)'}`,
    `Headers:\n${JSON.stringify(headersToRecord(options.response.headers), null, 2)}`,
    `Body (${options.body.length} chars):\n${truncateForDiagnostics(options.body)}`,
  ].join('\n\n')
}

function formatExceptionDiagnostics(url: string, err: unknown): string {
  if (!(err instanceof Error)) return `Request: GET ${url}\n\nError: ${String(err)}`

  const cause = 'cause' in err && err.cause !== undefined ? `\n\nCause:\n${String(err.cause)}` : ''
  return [
    `Request: GET ${url}`,
    `Error name: ${err.name}`,
    `Message: ${err.message}`,
    err.stack ? `Stack:\n${err.stack}` : '',
  ]
    .filter(Boolean)
    .join('\n\n') + cause
}

const STORAGE_KEY = 'opencode-servers'
const ACTIVE_SERVER_KEY = 'opencode-active-server'
/** 启动默认服务器偏好（官方 defaultKey 等价物）：决定下次启动优先连谁 */
const DEFAULT_SERVER_KEY = 'opencode-default-server'
/**
 * 本机服务的运行时地址（sessionStorage）。
 *
 * 服务实际监听的端口可能是注册表里配置的（不一定等于条目 URL），而且
 * 只有运行时才知道。之前它只存在内存里，webview 一刷新就丢：首屏先打
 * 默认地址失败，再等 start_opencode_service 重新认领/回写地址——观感上
 * 就像「刷新把服务重启了一次」。
 * sessionStorage 只在当前窗口的刷新间保留，语义正好（新窗口走注册表认领）。
 */
const LOCAL_RUNTIME_URL_KEY = 'opencode-local-runtime-url'
/**
 * WSL 服务器 id 前缀（单一事实源，wslStore 以 `wsl:<distro>` 生成稳定 id）。
 * WSL 服务器端口/密码每次启动都变（一次性凭据），由后端全权管理，前端从不持久化其连接信息。
 */
export const WSL_SERVER_PREFIX = 'wsl:'
export const LOCAL_SERVER_ID = 'local'

function isSameServerAuth(a: ServerAuth | undefined, b: ServerAuth | undefined): boolean {
  return a?.username === b?.username && a?.password === b?.password
}

/** 多地址列表是否等价（顺序敏感——priority 排序后顺序即语义） */
function isSameEndpoints(a: ServerEndpoint[] | undefined, b: ServerEndpoint[] | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return false
  if (a.length !== b.length) return false
  return a.every((endpoint, index) => {
    const other = b[index]
    return endpoint.url === other.url && endpoint.priority === other.priority && endpoint.label === other.label
  })
}

/**
 * 多地址的运行时状态（**不持久化**）。
 *
 * 持久层只存「用户配了哪些地址」；「此刻在用哪个」是运行时事实，
 * 每次启动都该按网络环境重新探测/回退，存下来反而会让下次启动落在死地址上。
 */
export interface EndpointRuntime {
  /** 当前生效地址；null 表示尚未选定，getter 退化为 server.url */
  activeUrl: string | null
  /** 用户手动锁定的地址；非 null 时自动探测完全让位 */
  lockedUrl: string | null
  /** 上次自动/手动切地址的单调时刻（performance.now()），升级滞回用 */
  lastSwitchAt: number
}

/** 空的运行时状态（新服务器 / 未初始化）。集中构造，避免漏字段 */
function emptyEndpointRuntime(): EndpointRuntime {
  return { activeUrl: null, lockedUrl: null, lastSwitchAt: 0 }
}

/** 元素引用逐一相同（快照 diff 用；数组都很小） */
function sameArrayRefs<T>(next: readonly T[], previous: readonly T[]): boolean {
  if (next.length !== previous.length) return false
  for (let i = 0; i < next.length; i++) {
    if (next[i] !== previous[i]) return false
  }
  return true
}

/** key/value 引用逐一相同（快照 diff 用） */
function sameMapEntries<T>(next: ReadonlyMap<string, T>, previous: ReadonlyMap<string, T>): boolean {
  if (next.size !== previous.size) return false
  for (const [key, value] of next) {
    if (previous.get(key) !== value) return false
  }
  return true
}

/** 健康结果是否有「值得通知 UI」的变化（延迟/检查时间不算） */
function sameHealth(previous: ServerHealth | undefined, next: ServerHealth): boolean {
  if (!previous) return false
  return (
    previous.status === next.status &&
    previous.version === next.version &&
    previous.error === next.error
  )
}

/**
 * Server Store
 * 管理多个 OpenCode 后端服务器配置
 */
class ServerStore {
  private servers: ServerConfig[] = []
  private activeServerId: string | null = null
  private healthMap = new Map<string, ServerHealth>()
  private healthCheckSeqMap = new Map<string, number>()
  private clockCalibrationMap = new Map<string, ServerClockCalibration>()
  /** 上次用服务端事件时间戳校准的本地单调时刻（calibrateFromServerTimestamp 节流用） */
  private lastClockCalibrationAt = new Map<string, number>()
  private listeners: Set<Listener> = new Set()
  private localServerUrlOverride: string | null = null
  /** local override 的派生对象缓存：notify 每次都走 updateSnapshots，不能每次造新对象 */
  private localServerView: { base: ServerConfig; url: string; view: ServerConfig } | null = null
  /** 多地址运行时状态（按 serverId）；见 EndpointRuntime 注释 */
  private endpointRuntime = new Map<string, EndpointRuntime>()
  // 上次关闭时用户停留的 WSL 服务器 id（wslStore 就绪后据此恢复 active）
  private bootIntentServerId: string | null = null
  // 启动默认服务器偏好（内存缓存，随 notify 快照供 React 订阅）
  private defaultServerId: string | null = null

  // server 切换监听器（用于触发 SSE 重连等副作用，避免循环依赖）
  private serverChangeListeners: Set<(newServerId: string, reason: ServerChangeReason) => void> = new Set()

  // 快照缓存 (用于 useSyncExternalStore)
  private _serversSnapshot: ServerConfig[] = []
  private _activeServerSnapshot: ServerConfig | null = null
  private _healthMapSnapshot: Map<string, ServerHealth> = new Map()
  /** 多地址运行时状态快照（生效地址 / 锁定地址） */
  private _endpointStateSnapshot: Map<string, EndpointRuntime> = new Map()

  // 默认本地服务器 ID
  private readonly DEFAULT_SERVER_ID = LOCAL_SERVER_ID

  constructor() {
    this.loadFromStorage()
    this.updateSnapshots()
  }

  // ============================================
  // Storage
  // ============================================

  private loadFromStorage(): void {
    try {
      // 启动意图：先于校验捕获「上次关闭时用户在用的服务器 id」原始值。
      // 若是 wsl: 前缀，它在清洗后的列表里必然校验失败（正常回退），但 wslStore 需要这个
      // 原始 id 才能在服务器就绪后把 active 切回去
      const persistedActiveId = sessionStorage.getItem(ACTIVE_SERVER_KEY) ?? localStorage.getItem(ACTIVE_SERVER_KEY)
      this.bootIntentServerId = persistedActiveId?.startsWith(WSL_SERVER_PREFIX) ? persistedActiveId : null

      // 加载服务器列表。WSL 条目不入持久层（见 saveToStorage），这里同步清洗历史版本
      // 遗留的 wsl: 条目，避免老用户下次启动先落在死地址上
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        this.servers = (JSON.parse(stored) as ServerConfig[])
          .filter(server => typeof server?.id === 'string' && !server.id.startsWith(WSL_SERVER_PREFIX))
          // endpoints 归一化：旧数据没有该字段（→ undefined，保持单地址语义），
          // 手改 / 历史脏值则在此清洗，不让非法地址流进运行时。
          // 同时把 `url` 拉回与 endpoints[0] 一致（它是主地址的镜像）。
          .map(server => {
            const endpoints = normalizeEndpoints(server.endpoints)
            return {
              ...server,
              url: (endpoints?.[0]?.url ?? server.url).replace(/\/+$/, ''),
              endpoints,
            }
          })
      }

      // 如果没有服务器，添加默认的本地服务器
      if (this.servers.length === 0) {
        this.servers = [
          {
            id: this.DEFAULT_SERVER_ID,
            name: 'Local',
            url: API_BASE_URL,
            isDefault: true,
          },
        ]
      }

      // 加载默认服务器偏好。wsl: 前缀同样合法——该服务器此刻可能尚未注册，
      // 由 wslStore 在就绪后接入
      const defaultPref = localStorage.getItem(DEFAULT_SERVER_KEY)
      this.defaultServerId =
        defaultPref && (defaultPref.startsWith(WSL_SERVER_PREFIX) || this.servers.some(s => s.id === defaultPref))
          ? defaultPref
          : null

      // 解析 active：默认偏好是列表内的普通服务器时优先于上次 active；
      // 偏好是 wsl: 前缀时不改动 active（wslStore 负责就绪后切回）
      if (this.defaultServerId && !this.defaultServerId.startsWith(WSL_SERVER_PREFIX)) {
        this.activeServerId = this.defaultServerId
      } else if (
        persistedActiveId &&
        !persistedActiveId.startsWith(WSL_SERVER_PREFIX) &&
        this.servers.some(s => s.id === persistedActiveId)
      ) {
        this.activeServerId = persistedActiveId
      } else {
        // 默认选中第一个
        this.activeServerId = this.servers[0]?.id ?? null
      }

      // 恢复窗口刷新前的本机服务地址（sessionStorage：刷新保留、新窗口不继承）。
      // 校验一下：脏数据 / 用户手动改过地址时宁可当成未知，让启动流程重新认领。
      const persistedRuntimeUrl = sessionStorage.getItem(LOCAL_RUNTIME_URL_KEY)
      if (persistedRuntimeUrl) {
        const normalized = normalizeConnectableUrl(persistedRuntimeUrl).replace(/\/+$/, '')
        if (/^https?:\/\//i.test(normalized)) this.localServerUrlOverride = normalized
      }
    } catch {
      // 初始化默认值
      this.servers = [
        {
          id: this.DEFAULT_SERVER_ID,
          name: 'Local',
          url: API_BASE_URL,
          isDefault: true,
        },
      ]
      this.activeServerId = this.DEFAULT_SERVER_ID
      this.bootIntentServerId = null
      this.defaultServerId = null
    }
  }

  private saveToStorage(): void {
    try {
      // WSL 服务器端口/密码一次性，持久化只会产生下次启动落在死地址上的幽灵条目，
      // 因此只持久化非 WSL 服务器
      const persistable = this.servers.filter(s => !s.id.startsWith(WSL_SERVER_PREFIX))
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persistable))
      if (this.activeServerId) {
        // 写入 sessionStorage（当前窗口刷新保持）+ localStorage（新窗口默认值）。
        // activeId 即便是 wsl: 前缀也照写——它是下次启动的「启动意图」，loadFromStorage 依赖它
        sessionStorage.setItem(ACTIVE_SERVER_KEY, this.activeServerId)
        localStorage.setItem(ACTIVE_SERVER_KEY, this.activeServerId)
      }
    } catch {
      // ignore
    }
  }

  // ============================================
  // Subscription
  // ============================================

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * 注册 active server 入口变化监听器（server id 切换或 active local runtime URL 变化）。
   * 返回取消注册函数。
   */
  onServerChange(fn: (newServerId: string, reason: ServerChangeReason) => void): () => void {
    this.serverChangeListeners.add(fn)
    return () => this.serverChangeListeners.delete(fn)
  }

  private notifyServerChange(serverId: string, reason: ServerChangeReason): void {
    this.serverChangeListeners.forEach(fn => {
      fn(serverId, reason)
    })
  }

  private notify(): void {
    this.updateSnapshots()
    this.listeners.forEach(l => {
      l()
    })
  }

  /**
   * 更新快照缓存
   *
   * 关键点：只有真正变化的数据才换新引用。useSyncExternalStore 用引用判等，
   * 每次 notify 都重建全部快照（哪怕只是某台服务器的延迟数字变了）会让
   * 所有订阅方（ChatPane / SidePanel）整体重渲染——健康检查每 10s、
   * 时钟校准每 60s 都在触发这种无意义渲染。
   */
  private updateSnapshots(): void {
    const servers = this.servers.map(server => this.withRuntimeServerUrl(server))
    if (!sameArrayRefs(servers, this._serversSnapshot)) this._serversSnapshot = servers

    const activeServer = this._serversSnapshot.find(server => server.id === this.activeServerId) ?? null
    if (activeServer !== this._activeServerSnapshot) this._activeServerSnapshot = activeServer

    // 复制成新 Map，保证 useSyncExternalStore 能看出变化；内容没变就沿用旧快照
    if (!sameMapEntries(this.healthMap, this._healthMapSnapshot)) {
      this._healthMapSnapshot = new Map(this.healthMap)
    }
    const endpointStates = new Map(
      this.servers.map(server => [server.id, this.endpointRuntime.get(server.id) ?? emptyEndpointRuntime()]),
    )
    if (!sameMapEntries(endpointStates, this._endpointStateSnapshot)) {
      this._endpointStateSnapshot = endpointStates
    }
  }

  private withRuntimeServerUrl(server: ServerConfig): ServerConfig {
    if (server.id !== this.DEFAULT_SERVER_ID || !this.localServerUrlOverride) return server
    const cached = this.localServerView
    if (cached && cached.base === server && cached.url === this.localServerUrlOverride) return cached.view
    const view = { ...server, url: this.localServerUrlOverride }
    this.localServerView = { base: server, url: this.localServerUrlOverride, view }
    return view
  }

  // ============================================
  // Getters
  // ============================================

  /**
   * 获取所有服务器配置 (返回缓存快照)
   */
  getServers(): ServerConfig[] {
    return this._serversSnapshot
  }

  getStoredServers(): ServerConfig[] {
    return [...this.servers]
  }

  /**
   * 获取当前活动服务器 (返回缓存快照)
   */
  getActiveServer(): ServerConfig | null {
    return this._activeServerSnapshot
  }

  getLocalServer(): ServerConfig | null {
    return this._serversSnapshot.find(s => s.id === this.DEFAULT_SERVER_ID) ?? null
  }

  getLocalServerUrl(): string {
    return this.getLocalServer()?.url ?? API_BASE_URL
  }

  /**
   * 获取指定服务器（含 runtime URL override）的 base URL。
   *
   * 多地址服务器返回**当前生效地址**（`activeUrl`），未选定时退回主地址
   * `server.url`。SDK / http 层的 baseUrl 全部经此读取，因此切换地址
   * 不需要改动 sdk.ts。
   */
  getServerBaseUrl(serverId: string): string {
    return this.getActiveEndpointUrl(serverId)
  }

  /** 读取多地址运行时状态（不存在时返回空对象，不创建） */
  getEndpointRuntime(serverId: string): Readonly<EndpointRuntime> {
    return this.endpointRuntime.get(serverId) ?? emptyEndpointRuntime()
  }

  /** 当前生效地址（含单地址服务器与 local runtime override 的退化） */
  getActiveEndpointUrl(serverId: string): string {
    const server = this.servers.find(s => s.id === serverId)
    if (!server) return API_BASE_URL
    const active = this.endpointRuntime.get(serverId)?.activeUrl
    if (active) return active
    // 单地址服务器：local 由运行时注入真实回环地址（见 withRuntimeServerUrl），
    // 其余服务器取 endpoints 主地址（无 endpoints 时即 url 本身）
    const runtimeUrl = this.withRuntimeServerUrl(server).url
    return primaryEndpointUrl(server.endpoints) ?? runtimeUrl
  }

  /** 已锁定的地址；null 表示未锁定（自动模式） */
  getLockedEndpointUrl(serverId: string): string | null {
    return this.endpointRuntime.get(serverId)?.lockedUrl ?? null
  }

  /**
   * 获取指定服务器（含 runtime URL override）
   */
  getServer(serverId: string): ServerConfig | null {
    const server = this.servers.find(s => s.id === serverId)
    return server ? this.withRuntimeServerUrl(server) : null
  }

  isActiveLocalServer(): boolean {
    return this.getActiveServerId() === this.DEFAULT_SERVER_ID
  }

  /**
   * 服务端是否与客户端**同机**（决定桌面端拖入的文件能否直接引用本机路径，
   * 而不必先上传到服务端）。
   *
   * - 内置 `local`（由本应用/侧车在本机拉起）：同机。
   * - `wsl:` 实例：保守判否——WSL 跑在独立网络命名空间里，仅凭 Windows 侧
   *   的 URL 判不出同机性，且路径要 `/mnt/c/...` 映射，宁可上传。
   * - 用户手动添加的服务器：按 URL 的 host 判（`localhost` / `127.0.0.1` /
   *   `[::1]`）。
   *
   * 多地址服务器（Issue #183）判的是**当前生效地址**，不是配置里的主地址：
   * 同一台服务器走内网 IP 时不同机、走回环隧道时可能同机，取决于此刻连的是
   * 哪个入口。用主地址会把「已降级到公网」误判成同机。
   *
   * ⚠️ 已知边界：容器端口转发到回环（Docker `-p 127.0.0.1:4096`）会被判成同机，
   * 但服务端进程在容器里读不到宿主路径。调用方需要能容忍这一点（失败时退化
   * 为上传/引用，不要让它变成"消息发不出去"）。
   */
  isLocalServer(serverId?: string): boolean {
    const id = serverId ?? this.getActiveServerId()
    if (id === this.DEFAULT_SERVER_ID) return true
    if (id.startsWith(WSL_SERVER_PREFIX)) return false
    // 未知 id 按非同机处理（宁可上传，别拿本机路径去引用）
    if (!this.getServer(id)) return false

    return isLocalServerHost(this.getServerBaseUrl(id))
  }

  /**
   * 获取当前活动服务器 ID（用于 per-server storage 等场景）
   * 返回 'local' 作为默认值，保证永远有值
   */
  getActiveServerId(): string {
    return this.activeServerId ?? this.DEFAULT_SERVER_ID
  }

  /**
   * 获取当前 API Base URL。
   *
   * 走 getServerBaseUrl（= 当前生效地址），多地址服务器才能拿到实际在用的入口；
   * 单地址 / local runtime override 的行为不变。
   */
  getActiveBaseUrl(): string {
    return this.getServerBaseUrl(this.getActiveServerId())
  }

  /**
   * 获取当前活动服务器的认证信息
   */
  getActiveAuth(): ServerAuth | null {
    const server = this.getActiveServer()
    return server?.auth ?? null
  }

  /**
   * 获取指定服务器的认证信息
   */
  getServerAuth(serverId: string): ServerAuth | null {
    const server = this.servers.find(s => s.id === serverId)
    return server?.auth ?? null
  }

  /**
   * 获取服务器健康状态
   */
  getHealth(serverId: string): ServerHealth | null {
    return this.healthMap.get(serverId) ?? null
  }

  /**
   * 获取所有服务器的健康状态 (返回缓存快照)
   */
  getAllHealth(): Map<string, ServerHealth> {
    return this._healthMapSnapshot
  }

  /**
   * 多地址运行时状态快照（按 serverId）。
   *
   * 只读快照：UI 用它渲染「使用中 / 已锁定」；业务判断一律走
   * getServerBaseUrl / getActiveEndpointUrl，避免读到过期副本。
   */
  getEndpointStates(): Map<string, Readonly<EndpointRuntime>> {
    return this._endpointStateSnapshot
  }

  getActiveCalibratedNow(): number | undefined {
    const calibration = this.clockCalibrationMap.get(this.getActiveServerId())
    if (!calibration) return undefined
    return calibration.serverTimestamp + (performance.now() - calibration.calibratedAtMonotonic)
  }

  /**
   * 上次关闭时用户停留的 WSL 服务器 id。
   * 语义：仅启动意图，wslStore 在该服务器就绪后消费一次并切回 active；非 WSL 服务器不走此通道。
   */
  getBootIntentServerId(): string | null {
    return this.bootIntentServerId
  }

  // ============================================
  // 默认服务器偏好（官方 defaultKey 等价物）
  // ============================================

  /**
   * 启动默认服务器偏好。校验在 loadFromStorage 完成：id 在列表中，或以 wsl: 开头
   * （WSL 服务器启动时可能尚未注册）。
   */
  getDefaultServerId(): string | null {
    return this.defaultServerId
  }

  /**
   * 设置启动默认服务器偏好。只持久化偏好，不改动当前 active；
   * 写入后 notify()，让 useSyncExternalStore 订阅方（useServerStore.defaultServerId）能感知。
   */
  setDefaultServer(id: string | null): void {
    this.defaultServerId = id
    try {
      if (id) {
        localStorage.setItem(DEFAULT_SERVER_KEY, id)
      } else {
        localStorage.removeItem(DEFAULT_SERVER_KEY)
      }
    } catch {
      // 持久化失败只影响下次启动的默认选择，不回滚本次会话的偏好
    }
    this.notify()
  }

  // ============================================
  // Mutations
  // ============================================

  /**
   * 添加服务器
   */
  addServer(config: Omit<ServerConfig, 'id'>): ServerConfig {
    const id = `server-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const endpoints = normalizeEndpoints(config.endpoints)
    const server: ServerConfig = {
      ...config,
      id,
      // 主地址与地址列表首项必须一致：endpoints 说了算，url 只是镜像
      url: (endpoints?.[0]?.url ?? config.url).replace(/\/+$/, ''), // 移除尾部斜杠
      endpoints,
    }
    this.servers.push(server)
    this.saveToStorage()
    this.notify()
    return server
  }

  /**
   * 幂等注册：按 id 更新（存在时），不存在则添加。
   * 供 WSL 等由外部模块管理生命周期的服务器使用，id 需要跨重启稳定。
   */
  upsertServer(config: ServerConfig): ServerConfig {
    const endpoints = normalizeEndpoints(config.endpoints)
    const server: ServerConfig = {
      ...config,
      url: (endpoints?.[0]?.url ?? config.url).replace(/\/+$/, ''), // 移除尾部斜杠
      endpoints,
    }
    const index = this.servers.findIndex(s => s.id === server.id)
    const previous = index === -1 ? undefined : this.servers[index]
    // 无变更 → 零副作用短路：wsl-state 每次全量推送都会重同步全部服务器，
    // 不短路则每次推送都触发 localStorage 写入 + 全体 React 订阅方重渲染
    if (
      previous &&
      previous.name === server.name &&
      previous.url === server.url &&
      isSameServerAuth(previous.auth, server.auth) &&
      isSameEndpoints(previous.endpoints, server.endpoints)
    ) {
      return previous
    }
    // 端点/凭据是否变化。新增时 previous 为空，「可用端点从无到有」
    // 对消费方与变更等价（WSL 就绪注册是典型场景）
    const runtimeChanged =
      !previous ||
      previous.url !== server.url ||
      !isSameServerAuth(previous.auth, server.auth) ||
      !isSameEndpoints(previous.endpoints, server.endpoints)
    if (index === -1) {
      this.servers.push(server)
    } else {
      this.servers[index] = server
    }
    this.saveToStorage()
    // 地址集变了：已选/已锁的地址可能已被删掉，必须回收，
    // 否则 getServerBaseUrl 会一直返回一个不存在的地址。
    // 必须在 notify 之前——notify 负责重建 UI 快照。
    this.reconcileEndpointRuntime(server.id)
    this.notify()
    // 端点变化无条件广播（不限定 active）：SSE/SDK 消费方建连时现读 serverStore，
    // 收到信号按 serverId 定向重建即拿到新值。active 与否只决定「谁正在用」，
    // 不改变「端点事实已变化」本身——非 active 服务器换端口同样需要这条信号
    if (runtimeChanged) {
      this.notifyServerChange(server.id, 'server-runtime-updated')
    }
    return server
  }

  /**
   * 更新服务器配置
   */
  updateServer(id: string, updates: Partial<Omit<ServerConfig, 'id'>>): boolean {
    const index = this.servers.findIndex(s => s.id === id)
    if (index === -1) return false

    const server = this.servers[index]
    /**
     * 用 hasOwnProperty 而不是 `!== undefined` 判断：编辑界面删掉最后一个备用
     * 地址时要能显式清空（传 endpoints: undefined）。用值判断会把「清空」
     * 误当成「本次没改」，地址永远删不掉。
     */
    const hasEndpointsUpdate = Object.prototype.hasOwnProperty.call(updates, 'endpoints')
    const nextEndpoints = hasEndpointsUpdate ? normalizeEndpoints(updates.endpoints) : server.endpoints
    /**
     * `server.url` 是主地址的镜像，必须与 `endpoints[0]` 一致，否则「主地址」
     * 与「优先级最高的地址」会指向两条不同记录。调用方没显式给 url 时由
     * endpoints 反推；显式给了就以调用方为准（local runtime override 走这条路）。
     */
    const explicitUrl = updates.url ? updates.url.replace(/\/+$/, '') : undefined
    const nextUrl =
      explicitUrl ?? (hasEndpointsUpdate && nextEndpoints?.length ? nextEndpoints[0].url : server.url)
    this.servers[index] = {
      ...server,
      ...updates,
      id: server.id, // 确保 id 不被覆盖
      url: nextUrl,
      endpoints: nextEndpoints,
    }
    if (id === this.DEFAULT_SERVER_ID && nextUrl !== server.url) {
      this.clearLocalRuntimeUrl()
    }
    // 地址集变了：已有的生效地址 / 锁定地址可能已不存在，必须回收，
    // 否则 getServerBaseUrl 会一直返回一个用户已经删掉的地址。
    this.reconcileEndpointRuntime(id)
    this.saveToStorage()
    this.notify()
    return true
  }

  /**
   * 回收失效的运行时地址。
   *
   * `activeUrl` / `lockedUrl` 必须仍在当前地址集内，否则置空
   * （置空后 getter 退回主地址 `server.url`）。
   */
  private reconcileEndpointRuntime(serverId: string): void {
    const server = this.servers.find(s => s.id === serverId)
    const runtime = this.endpointRuntime.get(serverId)
    if (!server || !runtime) return

    const known = new Set<string>([
      ...(server.endpoints ?? []).map(endpoint => endpoint.url),
      server.url,
    ])
    const activeUrl = runtime.activeUrl && known.has(runtime.activeUrl) ? runtime.activeUrl : null
    const lockedUrl = runtime.lockedUrl && known.has(runtime.lockedUrl) ? runtime.lockedUrl : null
    if (activeUrl === runtime.activeUrl && lockedUrl === runtime.lockedUrl) return
    this.endpointRuntime.set(serverId, { ...runtime, activeUrl, lockedUrl })
  }

  /**
   * 切换生效地址（Issue #183）。
   *
   * 地址必须属于该服务器的 endpoints（或等于 `server.url`）。切换后：
   * - `getServerBaseUrl` 立即返回新地址 → SDK/http 自动指向新入口
   * - 广播 `endpoint-switch`（不是 server-switch），消费方据此重连 SSE
   *   但不重置会话/消息（数据主体按 serverId 分片，未变）
   */
  setActiveEndpoint(serverId: string, url: string): boolean {
    const server = this.servers.find(s => s.id === serverId)
    if (!server) return false

    const normalized = normalizeEndpointUrl(url)
    if (!normalized) return false
    const known = new Set<string>([
      ...(server.endpoints ?? []).map(endpoint => endpoint.url),
      server.url,
    ])
    if (!known.has(normalized)) return false

    const runtime = this.endpointRuntime.get(serverId) ?? emptyEndpointRuntime()
    if (runtime.activeUrl === normalized) return false

    // 记录切换时刻：自动升级要等滞回窗口（见 endpointProbe）
    this.endpointRuntime.set(serverId, {
      ...runtime,
      activeUrl: normalized,
      lastSwitchAt: performance.now(),
    })
    this.notify()
    this.notifyServerChange(serverId, 'endpoint-switch')
    return true
  }

  /**
   * 锁定 / 解锁自动切换。
   *
   * 传入地址即锁定到该地址（同时把它设为生效地址）；传 null 解锁，
   * 恢复自动探测。锁定期间探测模块必须完全让位（不得改动 activeUrl）。
   */
  setLockedEndpoint(serverId: string, url: string | null): boolean {
    const server = this.servers.find(s => s.id === serverId)
    if (!server) return false

    const runtime = this.endpointRuntime.get(serverId) ?? emptyEndpointRuntime()

    if (url === null) {
      if (runtime.lockedUrl === null) return false
      // 解锁即重新交给自动探测：滞回窗口从此刻起算，避免刚解锁就立刻被降级
      this.endpointRuntime.set(serverId, { ...runtime, lockedUrl: null, lastSwitchAt: performance.now() })
      this.notify()
      return true
    }

    const normalized = normalizeEndpointUrl(url)
    if (!normalized) return false
    const known = new Set<string>([
      ...(server.endpoints ?? []).map(endpoint => endpoint.url),
      server.url,
    ])
    if (!known.has(normalized)) return false
    if (runtime.lockedUrl === normalized && runtime.activeUrl === normalized) return false

    this.endpointRuntime.set(serverId, {
      activeUrl: normalized,
      lockedUrl: normalized,
      lastSwitchAt: performance.now(),
    })
    this.notify()
    this.notifyServerChange(serverId, 'endpoint-switch')
    return true
  }

  /** 清理运行时状态（删除服务器时调用，避免 Map 只增不减） */
  private clearEndpointRuntime(serverId: string): void {
    this.endpointRuntime.delete(serverId)
  }

  setLocalServerRuntimeUrl(url: string): boolean {
    if (!this.servers.some(s => s.id === this.DEFAULT_SERVER_ID)) return false

    const normalizedUrl = normalizeConnectableUrl(url).replace(/\/+$/, '')
    if (this.localServerUrlOverride === normalizedUrl) return false

    this.localServerUrlOverride = normalizedUrl
    this.persistLocalRuntimeUrl(normalizedUrl)
    this.notify()
    if (this.isActiveLocalServer()) {
      this.notifyServerChange(this.DEFAULT_SERVER_ID, 'local-runtime-url')
    }
    return true
  }

  /** 清掉运行时地址覆盖（用户改条目地址 / 服务换了地址时） */
  private clearLocalRuntimeUrl(): void {
    if (this.localServerUrlOverride === null) {
      this.persistLocalRuntimeUrl(null)
      return
    }
    this.localServerUrlOverride = null
    this.persistLocalRuntimeUrl(null)
  }

  /** 从 sessionStorage 恢复了本机运行时地址（窗口刷新场景） */
  hasLocalRuntimeUrl(): boolean {
    return this.localServerUrlOverride !== null
  }

  /** 运行时地址写 sessionStorage：窗口刷新后首屏能直接连对地址 */
  private persistLocalRuntimeUrl(url: string | null): void {
    try {
      if (url) sessionStorage.setItem(LOCAL_RUNTIME_URL_KEY, url)
      else sessionStorage.removeItem(LOCAL_RUNTIME_URL_KEY)
    } catch {
      // 隐私模式 / 存储不可用：功能不受影响，只是刷新后要重新认领
    }
  }

  /**
   * 删除服务器
   */
  removeServer(id: string): boolean {
    // 不能删除默认服务器
    const server = this.servers.find(s => s.id === id)
    if (!server || server.isDefault) return false

    // 先采样：下面的删除动作会改变 active，之后无法判断「被删的是否是 active」
    const wasActive = this.activeServerId === id

    this.servers = this.servers.filter(s => s.id !== id)
    this.healthMap.delete(id)
    this.healthCheckSeqMap.delete(id)
    this.clockCalibrationMap.delete(id)
    this.clearEndpointRuntime(id)

    // 默认服务器偏好指向被删服务器时必须一并清除（只增不减的隐患）：否则下次启动仍会拿一个
    // 已不存在的 id 当默认目标。仅限非 WSL：WSL 的 removeServer 常因瞬时未就绪（starting/stopped）
    // 触发，配置仍在后端、稍后会重新注册，其默认偏好不能在此被抹掉——WSL 的删除回收由 wslStore 处理
    if (this.defaultServerId === id && !id.startsWith(WSL_SERVER_PREFIX)) {
      this.defaultServerId = null
      try {
        localStorage.removeItem(DEFAULT_SERVER_KEY)
      } catch {
        // 清偏好持久化失败不回滚本次删除：内存态已清，下次启动兜底逻辑会忽略列表外的 id
      }
    }

    // 如果删除的是当前选中的，切换到默认
    if (wasActive) {
      this.activeServerId = this.servers[0]?.id ?? null
    }

    this.saveToStorage()
    this.notify()

    // 被删的是 active：SSE 等消费方还挂在死掉/被删的服务器上（WSL sidecar 退出是典型场景），
    // 必须通知它们跟着切到回退目标，否则连接永远指向死地址。
    // local 是 isDefault 永不可删，回退目标恒存在；getActiveServerId() 对 null 兜底为 'local'
    if (wasActive) {
      this.notifyServerChange(this.getActiveServerId(), 'server-switch')
    }

    return true
  }

  /**
   * 设置活动服务器
   * 如果实际切换了服务器，会通知 serverChangeListeners（用于 SSE 重连等）
   */
  setActiveServer(id: string): boolean {
    if (!this.servers.some(s => s.id === id)) return false

    const changed = this.activeServerId !== id
    this.activeServerId = id
    this.saveToStorage()
    this.notify()

    if (changed) {
      this.notifyServerChange(id, 'server-switch')
    }

    return true
  }

  applyServerConnectedTimestamp(serverId: string, timestamp: unknown): boolean {
    const normalizedTimestamp = normalizeServerTimestamp(timestamp)
    if (normalizedTimestamp == null) return false

    this.clockCalibrationMap.set(serverId, {
      serverTimestamp: normalizedTimestamp,
      calibratedAtMonotonic: performance.now(),
    })
    this.notify()
    return true
  }

  /**
   * 用事件自带的服务端时间戳校准时钟（真实时间源），带节流。
   *
   * SSE 每个事件（除 server.connected）都带服务端 `created`：它 + 本地
   * 接收时刻（performance.now）就是一组可靠的 服务器时钟↔本地单调时钟
   * 锚点。时钟漂移是慢变量，60s 内重复校准没有意义。
   *
   * 这里**不 notify**：校准值只被渲染时按需读取（getActiveCalibratedNow），
   * 不在任何 useSyncExternalStore 快照里；之前每 60s 通知一次只会让
   * 所有订阅 serverStore 的组件白重渲染。
   */
  calibrateFromServerTimestamp(serverId: string, serverTimestamp: number, minIntervalMs = 60_000): void {
    const now = performance.now()
    const last = this.lastClockCalibrationAt.get(serverId) ?? -Infinity
    if (now - last < minIntervalMs) return
    this.lastClockCalibrationAt.set(serverId, now)
    this.clockCalibrationMap.set(serverId, {
      serverTimestamp,
      calibratedAtMonotonic: now,
    })
  }

  // ============================================
  // Health Check
  // ============================================

  /**
   * SSE 已连上：把健康快照提升为在线，不额外发请求。
   *
   * 设置页的健康灯读 healthMap（HTTP 探测），侧边栏读 SSE 连接状态。
   * 启动时健康探测常常早于本地服务就绪而失败；之后 SSE 连上了，健康灯却
   * 还红着——而健康轮询现在会跳过已连接的服务器，这个「红叉 + 实际能用」
   * 就会一直挂着。这里是两条链路的汇合点。
   *
   * 只升不降：SSE 瞬断（休眠/切网）不立刻判死，交给断连后的健康轮询。
   */
  noteServerConnected(serverId: string): void {
    const previous = this.healthMap.get(serverId)
    if (previous?.status === 'online') return
    this.healthMap.set(serverId, {
      status: 'online',
      lastCheck: Date.now(),
      ...(previous?.version ? { version: previous.version } : {}),
      ...(previous?.latency !== undefined ? { latency: previous.latency } : {}),
    })
    this.notify()
  }

  /**
   * 检查服务器健康状态
   *
   * @param options.silent 后台例行体检用：不显示 "checking" 中间态，
   *   且状态没变化时不 notify。SSE 已连接时的轮询属于这种——
   *   每 10s 让整个 ChatPane 重渲染一次没有任何信息增量。
   */
  async checkHealth(serverId: string, options: { silent?: boolean } = {}): Promise<ServerHealth> {
    const storedServer = this.servers.find(s => s.id === serverId)
    if (!storedServer) {
      return { status: 'error', error: 'Server not found' }
    }
    const server = this.withRuntimeServerUrl(storedServer)
    const checkSeq = (this.healthCheckSeqMap.get(serverId) ?? 0) + 1
    this.healthCheckSeqMap.set(serverId, checkSeq)
    // v2 没有 v1 的 /global/health；官方客户端用 server.info()
    // （GET /api/info，返回 { version, pid, urls, paths }）做健康探测。
    // v2 服务器会对未知路径回退到 SPA HTML，因此打到 v1 路径会 200 + text/html。
    //
    // 必须探**当前生效地址**而非 `server.url`（后者只是第一行的镜像）：
    // 多地址服务器切到备用入口后，实际请求全走 getServerBaseUrl，
    // 健康灯却去敲主地址，主地址死、备用活着就会显示红叉——
    // 面板说连不上，实际用得好好的。
    const healthUrl = `${this.getActiveEndpointUrl(serverId)}/api/info`

    const commitHealth = (health: ServerHealth) => {
      if (this.healthCheckSeqMap.get(serverId) === checkSeq) {
        const previous = this.healthMap.get(serverId)
        this.healthMap.set(serverId, health)
        // 静默体检只有「状态/版本/错误」变了才值得通知；延迟数字的变化
        // 下次真实通知时自然带出去
        if (!options.silent || !sameHealth(previous, health)) this.notify()
      }
      return health
    }

    // 标记为检查中（仅手动/首次检查；后台轮询不闪这一下）
    if (!options.silent) {
      this.healthMap.set(serverId, { status: 'checking' })
      this.notify()
    }

    const startTime = Date.now()
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000)

    try {
      const headers: Record<string, string> = {}
      if (server.auth?.password) {
        headers['Authorization'] = makeBasicAuthHeader(server.auth)
      }

      const f = await getUnifiedFetch()
      const response = await f(healthUrl, {
        method: 'GET',
        signal: controller.signal,
        headers,
      })

      const latency = Date.now() - startTime
      const responseBody = await response.text().catch(err => `[Failed to read response body: ${normalizeConnectionError(err)}]`)
      const details = formatResponseDiagnostics({ url: healthUrl, response, latency, body: responseBody })

      if (response.ok) {
        const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
        if (!contentType.includes('application/json')) {
          const health: ServerHealth = {
            status: 'error',
            latency,
            lastCheck: Date.now(),
            error: contentType.includes('text/html')
              ? 'Server returned HTML instead of OpenCode server info JSON. Check the URL path.'
              : 'Server did not return OpenCode server info JSON',
            details,
          }
          return commitHealth(health)
        }

        let data: unknown
        try {
          data = JSON.parse(responseBody)
        } catch {
          const health: ServerHealth = {
            status: 'error',
            latency,
            lastCheck: Date.now(),
            error: 'Invalid OpenCode server info JSON',
            details,
          }
          return commitHealth(health)
        }

        // v2 的 server info 没有 healthy 字段：能返回 version 即视为健康
        if (!isRecord(data) || typeof data.version !== 'string' || !data.version.trim()) {
          const health: ServerHealth = {
            status: 'error',
            latency,
            lastCheck: Date.now(),
            error: 'Not an OpenCode server',
            details,
          }
          return commitHealth(health)
        }

        const health: ServerHealth = {
          status: 'online',
          latency,
          lastCheck: Date.now(),
          version: data.version,
          details,
        }
        return commitHealth(health)
      } else if (response.status === 401) {
        // 认证失败
        const health: ServerHealth = {
          status: 'unauthorized',
          latency,
          lastCheck: Date.now(),
          error: 'Invalid credentials',
          details,
        }
        return commitHealth(health)
      } else {
        const health: ServerHealth = {
          status: 'error',
          latency,
          lastCheck: Date.now(),
          error: `HTTP ${response.status}`,
          details,
        }
        return commitHealth(health)
      }
    } catch (err) {
      const health: ServerHealth = {
        status: 'offline',
        lastCheck: Date.now(),
        error: normalizeConnectionError(err),
        details: formatExceptionDiagnostics(healthUrl, err),
      }
      return commitHealth(health)
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * 检查所有服务器健康状态
   */
  async checkAllHealth(): Promise<void> {
    await Promise.all(this.servers.map(s => this.checkHealth(s.id)))
  }

  /**
   * 探测单个地址是否可达（Issue #183 多地址探测用）。
   *
   * 与 checkHealth 的区别：**不写 healthMap、不通知订阅方**。它是 per-endpoint
   * 的事实采集，读写它的只有探测循环；把结果塞进 per-server 的 healthMap 会污染
   * 服务器卡片上的健康灯。探测端点用 GET /api/info（无副作用，且能同时验证
   * 服务端身份——返回 401 说明地址可达但凭据不对，也算「可达」）。
   *
   * @returns 可达时带延迟；不可达返回 null（超时/网络错误/非 JSON 响应）
   */
  async probeEndpoint(url: string, auth: ServerAuth | undefined, timeoutMs = 4000): Promise<number | null> {
    const target = `${url.replace(/\/+$/, '')}/api/info`
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
    const startTime = Date.now()

    try {
      const headers: Record<string, string> = {}
      if (auth?.password) {
        headers['Authorization'] = makeBasicAuthHeader(auth)
      }
      const f = await getUnifiedFetch()
      const response = await f(target, { method: 'GET', signal: controller.signal, headers })
      const latency = Date.now() - startTime
      // 401 = 地址通、凭据待补，对「能不能连上」而言仍算可达
      if (response.status === 401) return latency
      if (!response.ok) return null
      // 服务器会对未知路径回退 SPA HTML，必须是 JSON 才算真服务端
      const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
      return contentType.includes('application/json') ? latency : null
    } catch {
      return null
    } finally {
      clearTimeout(timeoutId)
    }
  }
}

// 单例导出
export const serverStore = new ServerStore()

function normalizeServerBackup(raw: unknown): ServerSettingsBackup {
  const parsed = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : undefined
  const servers = Array.isArray(parsed?.servers)
    ? parsed.servers
        .filter(
          (item): item is ServerConfig =>
            !!item &&
            typeof item === 'object' &&
            typeof (item as Record<string, unknown>).id === 'string' &&
            typeof (item as Record<string, unknown>).name === 'string' &&
            typeof (item as Record<string, unknown>).url === 'string' &&
            // WSL 条目含一次性端口/密码，导入即清洗（兼容旧版本导出的备份文件）
            !((item as Record<string, unknown>).id as string).startsWith(WSL_SERVER_PREFIX),
        )
        .map(item => {
          const endpoints = normalizeEndpoints(item.endpoints)
          return {
            id: item.id,
            name: item.name,
            // endpoints[0] 是主地址，url 只是镜像
            url: (endpoints?.[0]?.url ?? item.url).replace(/\/+$/, ''),
            endpoints,
            isDefault: item.isDefault === true,
            auth:
              item.auth &&
              typeof item.auth === 'object' &&
              typeof item.auth.username === 'string' &&
              typeof item.auth.password === 'string'
                ? { username: item.auth.username, password: item.auth.password }
                : undefined,
          }
        })
    : []

  const normalizedServers = servers.length
    ? servers
    : [
        {
          id: 'local',
          name: 'Local',
          url: API_BASE_URL,
          isDefault: true,
        },
      ]

  const activeServerId =
    typeof parsed?.activeServerId === 'string' && normalizedServers.some(server => server.id === parsed.activeServerId)
      ? parsed.activeServerId
      : (normalizedServers[0]?.id ?? null)

  // 默认偏好：旧备份没有该字段 → undefined（视为无偏好）；普通 id 必须在清洗后的列表内，
  // wsl: 前缀直接放行（该服务器由后端管理，导入时可能尚未注册）
  const rawDefaultServerId = parsed?.defaultServerId
  const defaultServerId =
    typeof rawDefaultServerId === 'string' &&
    (rawDefaultServerId.startsWith(WSL_SERVER_PREFIX) || normalizedServers.some(server => server.id === rawDefaultServerId))
      ? rawDefaultServerId
      : undefined

  return {
    servers: normalizedServers,
    activeServerId,
    defaultServerId,
  }
}

export function exportServerSettingsBackup(): ServerSettingsBackup {
  return {
    // WSL 服务器不进备份：端口/密码一次性，导出只会泄漏一次性凭据
    servers: serverStore
      .getStoredServers()
      .filter(server => !server.id.startsWith(WSL_SERVER_PREFIX))
      .map(server => ({
        ...server,
        auth: server.auth ? { ...server.auth } : undefined,
        endpoints: server.endpoints ? server.endpoints.map(endpoint => ({ ...endpoint })) : undefined,
      })),
    activeServerId: serverStore.getActiveServerId(),
    defaultServerId: serverStore.getDefaultServerId(),
  }
}

export function importServerSettingsBackup(raw: unknown): void {
  const normalized = normalizeServerBackup(raw)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized.servers))
  if (normalized.activeServerId) {
    localStorage.setItem(ACTIVE_SERVER_KEY, normalized.activeServerId)
    sessionStorage.setItem(ACTIVE_SERVER_KEY, normalized.activeServerId)
  } else {
    localStorage.removeItem(ACTIVE_SERVER_KEY)
    sessionStorage.removeItem(ACTIVE_SERVER_KEY)
  }
  // 导入语义为「完全替换」：旧备份没有 defaultServerId 字段时清除现有偏好
  if (normalized.defaultServerId) {
    localStorage.setItem(DEFAULT_SERVER_KEY, normalized.defaultServerId)
  } else {
    localStorage.removeItem(DEFAULT_SERVER_KEY)
  }
}

/**
 * 生成 Basic Auth header 值
 */
export function makeBasicAuthHeader(auth: ServerAuth): string {
  return 'Basic ' + btoa(`${auth.username}:${auth.password}`)
}

function normalizeServerTimestamp(timestamp: unknown): number | null {
  if (typeof timestamp === 'number') {
    return Number.isFinite(timestamp) ? timestamp : null
  }

  if (typeof timestamp === 'string') {
    const parsed = Date.parse(timestamp)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}
