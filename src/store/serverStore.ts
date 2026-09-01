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
 * 服务器配置
 */
export interface ServerConfig {
  id: string // 唯一标识
  name: string // 显示名称
  url: string // 服务器 URL (不含尾部斜杠)
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
export type ServerChangeReason = 'server-switch' | 'local-runtime-url' | 'server-runtime-updated'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeConnectionError(err: unknown): string {
  if (err instanceof DOMException && err.name === 'AbortError') return 'Connection timed out'
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
 * WSL 服务器 id 前缀（单一事实源，wslStore 以 `wsl:<distro>` 生成稳定 id）。
 * WSL 服务器端口/密码每次启动都变（一次性凭据），由后端全权管理，前端从不持久化其连接信息。
 */
export const WSL_SERVER_PREFIX = 'wsl:'
export const LOCAL_SERVER_ID = 'local'

function isSameServerAuth(a: ServerAuth | undefined, b: ServerAuth | undefined): boolean {
  return a?.username === b?.username && a?.password === b?.password
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
  private listeners: Set<Listener> = new Set()
  private localServerUrlOverride: string | null = null
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
        this.servers = (JSON.parse(stored) as ServerConfig[]).filter(
          server => typeof server?.id === 'string' && !server.id.startsWith(WSL_SERVER_PREFIX),
        )
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
   */
  private updateSnapshots(): void {
    this._serversSnapshot = this.servers.map(server => this.withRuntimeServerUrl(server))
    this._activeServerSnapshot = this._serversSnapshot.find(s => s.id === this.activeServerId) ?? null
    this._healthMapSnapshot = new Map(this.healthMap)
  }

  private withRuntimeServerUrl(server: ServerConfig): ServerConfig {
    if (server.id === this.DEFAULT_SERVER_ID && this.localServerUrlOverride) {
      return { ...server, url: this.localServerUrlOverride }
    }
    return server
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
   * 获取指定服务器（含 runtime URL override）的 base URL
   */
  getServerBaseUrl(serverId: string): string {
    const server = this.servers.find(s => s.id === serverId)
    return server ? this.withRuntimeServerUrl(server).url : API_BASE_URL
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
   * 获取当前活动服务器 ID（用于 per-server storage 等场景）
   * 返回 'local' 作为默认值，保证永远有值
   */
  getActiveServerId(): string {
    return this.activeServerId ?? this.DEFAULT_SERVER_ID
  }

  /**
   * 获取当前 API Base URL
   */
  getActiveBaseUrl(): string {
    const server = this.getActiveServer()
    return server?.url ?? API_BASE_URL
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
    const server: ServerConfig = {
      ...config,
      id,
      url: config.url.replace(/\/+$/, ''), // 移除尾部斜杠
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
    const server: ServerConfig = {
      ...config,
      url: config.url.replace(/\/+$/, ''), // 移除尾部斜杠
    }
    const index = this.servers.findIndex(s => s.id === server.id)
    const previous = index === -1 ? undefined : this.servers[index]
    // 无变更 → 零副作用短路：wsl-state 每次全量推送都会重同步全部服务器，
    // 不短路则每次推送都触发 localStorage 写入 + 全体 React 订阅方重渲染
    if (
      previous &&
      previous.name === server.name &&
      previous.url === server.url &&
      isSameServerAuth(previous.auth, server.auth)
    ) {
      return previous
    }
    // 端点/凭据是否变化。新增时 previous 为空，「可用端点从无到有」
    // 对消费方与变更等价（WSL 就绪注册是典型场景）
    const runtimeChanged = !previous || previous.url !== server.url || !isSameServerAuth(previous.auth, server.auth)
    if (index === -1) {
      this.servers.push(server)
    } else {
      this.servers[index] = server
    }
    this.saveToStorage()
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
    this.servers[index] = {
      ...server,
      ...updates,
      id: server.id, // 确保 id 不被覆盖
      url: updates.url ? updates.url.replace(/\/+$/, '') : server.url,
    }
    if (id === this.DEFAULT_SERVER_ID && updates.url) {
      this.localServerUrlOverride = null
    }
    this.saveToStorage()
    this.notify()
    return true
  }

  setLocalServerRuntimeUrl(url: string): boolean {
    if (!this.servers.some(s => s.id === this.DEFAULT_SERVER_ID)) return false

    const normalizedUrl = url.replace(/\/+$/, '')
    if (this.localServerUrlOverride === normalizedUrl) return false

    this.localServerUrlOverride = normalizedUrl
    this.notify()
    if (this.isActiveLocalServer()) {
      this.notifyServerChange(this.DEFAULT_SERVER_ID, 'local-runtime-url')
    }
    return true
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

  // ============================================
  // Health Check
  // ============================================

  /**
   * 检查服务器健康状态
   */
  async checkHealth(serverId: string): Promise<ServerHealth> {
    const storedServer = this.servers.find(s => s.id === serverId)
    if (!storedServer) {
      return { status: 'error', error: 'Server not found' }
    }
    const server = this.withRuntimeServerUrl(storedServer)
    const checkSeq = (this.healthCheckSeqMap.get(serverId) ?? 0) + 1
    this.healthCheckSeqMap.set(serverId, checkSeq)
    const healthUrl = `${server.url}/global/health`

    const commitHealth = (health: ServerHealth) => {
      if (this.healthCheckSeqMap.get(serverId) === checkSeq) {
        this.healthMap.set(serverId, health)
        this.notify()
      }
      return health
    }

    // 标记为检查中
    this.healthMap.set(serverId, { status: 'checking' })
    this.notify()

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
              ? 'Server returned HTML instead of OpenCode health JSON. Check the URL path.'
              : 'Server did not return OpenCode health JSON',
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
            error: 'Invalid OpenCode health JSON',
            details,
          }
          return commitHealth(health)
        }

        if (!isRecord(data) || data.healthy !== true || typeof data.version !== 'string' || !data.version.trim()) {
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
        .map(item => ({
          id: item.id,
          name: item.name,
          url: item.url.replace(/\/+$/, ''),
          isDefault: item.isDefault === true,
          auth:
            item.auth &&
            typeof item.auth === 'object' &&
            typeof item.auth.username === 'string' &&
            typeof item.auth.password === 'string'
              ? { username: item.auth.username, password: item.auth.password }
              : undefined,
        }))
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
