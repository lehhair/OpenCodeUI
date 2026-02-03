// ============================================
// Server Store - 多后端服务器配置管理
// ============================================

import { API_BASE_URL } from '../constants'

/**
 * 服务器配置
 */
export interface ServerConfig {
  id: string           // 唯一标识
  name: string         // 显示名称
  url: string          // 服务器 URL (不含尾部斜杠)
  isDefault?: boolean  // 是否为默认服务器
}

/**
 * 服务器健康状态
 */
export interface ServerHealth {
  status: 'checking' | 'online' | 'offline' | 'error'
  latency?: number     // 响应延迟 (ms)
  lastCheck?: number   // 上次检查时间戳
  error?: string       // 错误信息
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
      const activeId = localStorage.getItem(ACTIVE_SERVER_KEY)
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
   * 获取当前 API Base URL
   */
  getActiveBaseUrl(): string {
    const server = this.getActiveServer()
    return server?.url ?? API_BASE_URL
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
   */
  setActiveServer(id: string): boolean {
    if (!this.servers.some(s => s.id === id)) return false
    
    this.activeServerId = id
    this.saveToStorage()
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
      
      const response = await fetch(`${server.url}/global/health`, {
        method: 'GET',
        signal: controller.signal,
      })
      
      clearTimeout(timeoutId)
      
      const latency = Date.now() - startTime
      
      if (response.ok) {
        const health: ServerHealth = {
          status: 'online',
          latency,
          lastCheck: Date.now(),
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
