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
  username: string     // 用户名 (默认 opencode)
  password: string     // 密码
}

/**
 * 服务器配置
 */
export interface ServerConfig {
  id: string           // 唯一标识
  name: string         // 显示名称
  url: string          // 服务器 URL (不含尾部斜杠)
  isDefault?: boolean  // 是否为默认服务器
  auth?: ServerAuth    // 认证信息 (可选)
}

/**
 * 服务器健康状态
 */
export interface ServerHealth {
  status: 'checking' | 'online' | 'offline' | 'error' | 'unauthorized'
  latency?: number     // 响应延迟 (ms)
  lastCheck?: number   // 上次检查时间戳
  error?: string       // 错误信息
  version?: string     // 服务器版本
}

type Listener = () => void

const STORAGE_KEY = 'opencode-servers'
const ACTIVE_SERVER_KEY = 'opencode-active-server'

/**
 * Server Store
 * 管理多个 OpenCode 后端服务器配置
 */
class ServerStore {
  private servers: ServerConfig[] = []
  private activeServerId: string | null = null
  private healthMap = new Map<string, ServerHealth>()
  private listeners: Set<Listener> = new Set()
  
  // server 切换监听器（用于触发 SSE 重连等副作用，避免循环依赖）
  private serverChangeListeners: Set<(newServerId: string) => void> = new Set()
  
  // 快照缓存 (用于 useSyncExternalStore)
  private _serversSnapshot: ServerConfig[] = []
  private _activeServerSnapshot: ServerConfig | null = null
  private _healthMapSnapshot: Map<string, ServerHealth> = new Map()
  
  // 默认本地服务器 ID
  private readonly DEFAULT_SERVER_ID = 'local'
  
  constructor() {
    this.loadFromStorage()
    this.updateSnapshots()
  }
  
  // ============================================
  // Storage
  // ============================================
  
  private loadFromStorage(): void {
    try {
      // 加载服务器列表
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        this.servers = JSON.parse(stored)
      }
      
      // 如果没有服务器，添加默认的本地服务器
      if (this.servers.length === 0) {
        this.servers = [{
          id: this.DEFAULT_SERVER_ID,
          name: 'Local',
          url: API_BASE_URL,
          isDefault: true,
        }]
      }
      
      // 加载当前选中的服务器
      // 优先从 sessionStorage 读取（per-window 隔离，刷新保持）
      // 回退到 localStorage（新窗口首次打开时继承上次默认）
      const activeId = sessionStorage.getItem(ACTIVE_SERVER_KEY) ?? localStorage.getItem(ACTIVE_SERVER_KEY)
      if (activeId && this.servers.some(s => s.id === activeId)) {
        this.activeServerId = activeId
      } else {
        // 默认选中第一个
        this.activeServerId = this.servers[0]?.id ?? null
      }
    } catch {
      // 初始化默认值
      this.servers = [{
        id: this.DEFAULT_SERVER_ID,
        name: 'Local',
        url: API_BASE_URL,
        isDefault: true,
      }]
      this.activeServerId = this.DEFAULT_SERVER_ID
    }
  }
  
  private saveToStorage(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.servers))
      if (this.activeServerId) {
        // 写入 sessionStorage（当前窗口刷新保持）+ localStorage（新窗口默认值）
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
   * 注册 server 切换监听器（用于触发 SSE 重连等副作用）
   * 返回取消注册函数
   */
  onServerChange(fn: (newServerId: string) => void): () => void {
    this.serverChangeListeners.add(fn)
    return () => this.serverChangeListeners.delete(fn)
  }
  
  private notify(): void {
    this.updateSnapshots()
    this.listeners.forEach(l => l())
  }
  
  /**
   * 更新快照缓存
   */
  private updateSnapshots(): void {
    this._serversSnapshot = [...this.servers]
    this._activeServerSnapshot = this.servers.find(s => s.id === this.activeServerId) ?? null
    this._healthMapSnapshot = new Map(this.healthMap)
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
  
  /**
   * 获取当前活动服务器 (返回缓存快照)
   */
  getActiveServer(): ServerConfig | null {
    return this._activeServerSnapshot
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
    this.saveToStorage()
    this.notify()
    return true
  }
  
  /**
   * 删除服务器
   */
  removeServer(id: string): boolean {
    // 不能删除默认服务器
    const server = this.servers.find(s => s.id === id)
    if (!server || server.isDefault) return false
    
    this.servers = this.servers.filter(s => s.id !== id)
    this.healthMap.delete(id)
    
    // 如果删除的是当前选中的，切换到默认
    if (this.activeServerId === id) {
      this.activeServerId = this.servers[0]?.id ?? null
    }
    
    this.saveToStorage()
    this.notify()
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
    
    // 实际切换了服务器，通知外部（SSE 重连等）
    if (changed) {
      this.serverChangeListeners.forEach(fn => fn(id))
    }
    
    return true
  }
  
  // ============================================
  // Health Check
  // ============================================
  
  /**
   * 检查服务器健康状态
   */
  async checkHealth(serverId: string): Promise<ServerHealth> {
    const server = this.servers.find(s => s.id === serverId)
    if (!server) {
      return { status: 'error', error: 'Server not found' }
    }
    
    // 标记为检查中
    this.healthMap.set(serverId, { status: 'checking' })
    this.notify()
    
    const startTime = Date.now()
    
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 5000)
      
      const headers: Record<string, string> = {}
      if (server.auth?.password) {
        headers['Authorization'] = makeBasicAuthHeader(server.auth)
      }
      
      const f = await getUnifiedFetch()
      const response = await f(`${server.url}/global/health`, {
        method: 'GET',
        signal: controller.signal,
        headers,
      })
      
      clearTimeout(timeoutId)
      
      const latency = Date.now() - startTime
      
      if (response.ok) {
        // 解析返回的健康信息
        let version: string | undefined
        try {
          const data = await response.json()
          version = data.version
        } catch {
          // ignore parse error
        }
        
        const health: ServerHealth = {
          status: 'online',
          latency,
          lastCheck: Date.now(),
          version,
        }
        this.healthMap.set(serverId, health)
        this.notify()
        return health
      } else if (response.status === 401) {
        // 认证失败
        const health: ServerHealth = {
          status: 'unauthorized',
          latency,
          lastCheck: Date.now(),
          error: 'Invalid credentials',
        }
        this.healthMap.set(serverId, health)
        this.notify()
        return health
      } else {
        const health: ServerHealth = {
          status: 'error',
          latency,
          lastCheck: Date.now(),
          error: `HTTP ${response.status}`,
        }
        this.healthMap.set(serverId, health)
        this.notify()
        return health
      }
    } catch (err) {
      const health: ServerHealth = {
        status: 'offline',
        lastCheck: Date.now(),
        error: err instanceof Error ? err.message : 'Connection failed',
      }
      this.healthMap.set(serverId, health)
      this.notify()
      return health
    }
  }
  
  /**
   * 检查所有服务器健康状态
   */
  async checkAllHealth(): Promise<void> {
    await Promise.all(
      this.servers.map(s => this.checkHealth(s.id))
    )
  }
}

// 单例导出
export const serverStore = new ServerStore()

/**
 * 生成 Basic Auth header 值
 */
export function makeBasicAuthHeader(auth: ServerAuth): string {
  return 'Basic ' + btoa(`${auth.username}:${auth.password}`)
}
