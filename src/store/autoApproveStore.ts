// ============================================
// Auto-Approve Store (Experimental)
// 前端自动批准规则存储，只存内存，刷新即清空
// ============================================

import { serverStorage } from '../utils/perServerStorage'

// Full Auto 模式：off / session / global
export type FullAutoMode = 'off' | 'session' | 'global'
export type AlwaysAllowMode = 'backend' | 'frontend'

// Full Auto 状态变更回调
// sourcePaneId 可选：表示这次切换是从哪个 pane 触发的。
// 即使是 global 变更，也可以携带触发源 pane，供 UI hint 精准展示。
type FullAutoListener = (mode: FullAutoMode, sourcePaneId?: string) => void
type StoreListener = () => void

/**
 * 自动批准规则
 */
export interface AutoApproveRule {
  permission: string // 工具类型: bash, edit, read, etc.
  pattern: string // 匹配模式，如 "mkdir *", "ls", "*.tsx"
}

/**
 * 通配符匹配函数
 * 支持 * (任意字符) 和 ? (单个字符)
 */
function wildcardMatch(pattern: string, text: string): boolean {
  // 转换为正则表达式
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // 转义特殊字符
    .replace(/\*/g, '.*') // * -> .*
    .replace(/\?/g, '.') // ? -> .

  const regex = new RegExp(`^${regexStr}$`, 'i')
  return regex.test(text)
}

/**
 * Auto-Approve Store
 * 按 sessionId 存储自动批准规则
 */
class AutoApproveStore {
  // 规则存储：sessionId -> rules[]
  private rulesMap = new Map<string, AutoApproveRule[]>()

  // 功能开关（存 localStorage，持久化）
  // true = 前端临时记住规则；false = 交给后端始终允许
  private _enabled: boolean = true
  private readonly STORAGE_KEY = 'opencode-auto-approve-enabled'

  // Full Auto 开启时是否追补已经等待中的权限（危险操作，默认关闭）
  private _approvePendingOnFullAuto: boolean = false
  private readonly STORAGE_KEY_APPROVE_PENDING_ON_FULL_AUTO = 'opencode-approve-pending-on-full-auto'

  // Full Auto 模式（纯内存，不持久化，刷新即关）
  // off: 不自动放行
  // session: 自动放行当前所在页面的会话（由 handler 层级天然保证）
  // global: 所有会话的权限请求无差别自动放行
  private _fullAutoMode: FullAutoMode = 'off'
  private _fullAutoListeners = new Set<FullAutoListener>()
  private _listeners = new Set<StoreListener>()
  /** per-pane Full Auto 模式（分屏模式下各 pane 独立控制） */
  private _paneFullAutoModes = new Map<string, FullAutoMode>()
  private _autoReplyRequestIds = new Set<string>()

  constructor() {
    // 从 localStorage 读取开关状态。
    // 默认 backend（官方语义：always 交给服务端持久化规则，data.ts 的
    // permission.reply decision:'always'）；前端内存模式是显式可选的
    // 「仅浏览器会话内临时记住」增强，只有用户主动选择才启用。
    try {
      const stored = serverStorage.get(this.STORAGE_KEY)
      this._enabled = stored === 'true'
      const approvePendingStored = serverStorage.get(this.STORAGE_KEY_APPROVE_PENDING_ON_FULL_AUTO)
      this._approvePendingOnFullAuto = approvePendingStored === 'true'
    } catch {
      this._enabled = false
      this._approvePendingOnFullAuto = false
    }
  }

  private notify(): void {
    this._listeners.forEach(fn => fn())
  }

  /**
   * 重新从 storage 加载开关状态（服务器切换时调用）
   */
  reloadFromStorage(): void {
    try {
      const stored = serverStorage.get(this.STORAGE_KEY)
      this._enabled = stored === 'true'
      const approvePendingStored = serverStorage.get(this.STORAGE_KEY_APPROVE_PENDING_ON_FULL_AUTO)
      this._approvePendingOnFullAuto = approvePendingStored === 'true'
    } catch {
      this._enabled = false
      this._approvePendingOnFullAuto = false
    }
    // 切换服务器时清空规则并关闭 Full Auto
    this.rulesMap.clear()
    this._paneFullAutoModes.clear()
    this._autoReplyRequestIds.clear()
    if (this._fullAutoMode !== 'off') {
      this._fullAutoMode = 'off'
      this._fullAutoListeners.forEach(fn => fn('off'))
    }
    this.notify()
  }

  /**
   * 获取功能开关状态
   */
  get enabled(): boolean {
    return this._enabled
  }

  /**
   * 设置功能开关
   */
  setEnabled(value: boolean): void {
    this._enabled = value
    try {
      serverStorage.set(this.STORAGE_KEY, String(value))
    } catch {
      // ignore
    }
    this.notify()
  }

  get alwaysAllowMode(): AlwaysAllowMode {
    return this._enabled ? 'frontend' : 'backend'
  }

  setAlwaysAllowMode(mode: AlwaysAllowMode): void {
    this.setEnabled(mode === 'frontend')
  }

  get approvePendingOnFullAuto(): boolean {
    return this._approvePendingOnFullAuto
  }

  setApprovePendingOnFullAuto(value: boolean): void {
    this._approvePendingOnFullAuto = value
    try {
      serverStorage.set(this.STORAGE_KEY_APPROVE_PENDING_ON_FULL_AUTO, String(value))
    } catch {
      // ignore
    }
    this.notify()
  }

  subscribe = (listener: StoreListener): (() => void) => {
    this._listeners.add(listener)
    return () => {
      this._listeners.delete(listener)
    }
  }

  // ---- Full Auto 模式 ----

  /**
   * 当前 Full Auto 模式
   */
  get fullAutoMode(): FullAutoMode {
    return this._fullAutoMode
  }

  /**
   * 向后兼容：fullAuto 等价于 mode !== 'off'
   */
  get fullAuto(): boolean {
    return this._fullAutoMode !== 'off'
  }

  /**
   * 设置 Full Auto 模式（全局）
   */
  setFullAutoMode(mode: FullAutoMode, sourcePaneId?: string): void {
    this._fullAutoMode = mode
    this._fullAutoListeners.forEach(fn => fn(mode, sourcePaneId))
    this.notify()
  }

  // ---- Per-pane Full Auto 模式 ----

  /** 获取指定 pane 的生效 Full Auto 模式（global 优先，否则看 pane-local） */
  getPaneFullAutoMode(paneId: string): FullAutoMode {
    if (this._fullAutoMode === 'global') return 'global'
    return this._paneFullAutoModes.get(paneId) ?? 'off'
  }

  /** 设置指定 pane 的 Full Auto 模式 */
  setPaneFullAutoMode(paneId: string, mode: FullAutoMode): void {
    if (mode === 'global') {
      this._paneFullAutoModes.delete(paneId)
      this.setFullAutoMode('global', paneId)
      return
    }
    this._paneFullAutoModes.set(paneId, mode)
    this._fullAutoListeners.forEach(fn => fn(mode, paneId))
    this.notify()
  }

  /** 清除指定 pane 的 Full Auto 模式（恢复跟随全局） */
  clearPaneFullAutoMode(paneId: string): void {
    this._paneFullAutoModes.delete(paneId)
    this.notify()
  }

  /** 按当前 pane 的生效状态循环：off -> session -> global -> off */
  cyclePaneFullAutoMode(paneId: string): FullAutoMode {
    const current = this.getPaneFullAutoMode(paneId)

    if (current === 'off') {
      this.setPaneFullAutoMode(paneId, 'session')
      return 'session'
    }

    if (current === 'session') {
      // 进入 global 前清掉当前 pane 的局部状态，global 关闭后回到 off。
      this._paneFullAutoModes.delete(paneId)
      this.setFullAutoMode('global', paneId)
      return 'global'
    }

    this.setFullAutoMode('off', paneId)
    return 'off'
  }

  /**
   * 向后兼容：setFullAuto(bool) 映射到 off/global
   */
  setFullAuto(value: boolean): void {
    this.setFullAutoMode(value ? 'global' : 'off')
  }

  /**
   * 订阅 Full Auto 状态变更
   */
  onFullAutoChange(listener: FullAutoListener): () => void {
    this._fullAutoListeners.add(listener)
    return () => {
      this._fullAutoListeners.delete(listener)
    }
  }

  claimAutoReply(requestId: string): boolean {
    if (this._autoReplyRequestIds.has(requestId)) return false
    this._autoReplyRequestIds.add(requestId)
    return true
  }

  releaseAutoReply(requestId: string): void {
    this._autoReplyRequestIds.delete(requestId)
  }

  /**
   * 添加自动批准规则
   * @param sessionId 会话 ID
   * @param permission 工具类型
   * @param patterns 要添加的 pattern 列表
   */
  addRules(sessionId: string, permission: string, patterns: string[]): void {
    if (!this._enabled) return

    const existing = this.rulesMap.get(sessionId) || []
    const newRules: AutoApproveRule[] = patterns.map(pattern => ({
      permission,
      pattern,
    }))

    // 去重
    const uniqueRules = [...existing]
    for (const rule of newRules) {
      const isDuplicate = uniqueRules.some(r => r.permission === rule.permission && r.pattern === rule.pattern)
      if (!isDuplicate) {
        uniqueRules.push(rule)
      }
    }

    this.rulesMap.set(sessionId, uniqueRules)
  }

  /**
   * 获取某个会话的所有规则
   */
  getRules(sessionId: string): AutoApproveRule[] {
    return this.rulesMap.get(sessionId) || []
  }

  /**
   * 清空某个会话的所有规则
   */
  clearRules(sessionId: string): void {
    this.rulesMap.delete(sessionId)
  }

  /**
   * 清空所有规则
   */
  clearAllRules(): void {
    this.rulesMap.clear()
  }

  /**
   * 检查权限请求是否应该自动批准
   * @param sessionId 会话 ID
   * @param permission 工具类型
   * @param requestPatterns 请求的 patterns
   * @returns true 如果所有 patterns 都被规则匹配
   */
  shouldAutoApprove(sessionId: string, permission: string, requestPatterns: string[]): boolean {
    if (!this._enabled) return false
    if (!requestPatterns || requestPatterns.length === 0) return false

    const rules = this.getRules(sessionId)
    if (rules.length === 0) return false

    // 检查每个请求的 pattern 是否都被至少一条规则匹配
    return requestPatterns.every(reqPattern => {
      return rules.some(rule => {
        // 权限类型必须匹配（或规则是 * 通配）
        if (rule.permission !== permission && rule.permission !== '*') {
          return false
        }
        // 双向通配匹配：rule 作为模式匹配 request，或 request 作为模式匹配 rule
        // patterns 和 always 可能格式不同，双向确保都能命中
        return wildcardMatch(rule.pattern, reqPattern) || wildcardMatch(reqPattern, rule.pattern)
      })
    })
  }

  /**
   * 获取调试信息
   */
  getDebugInfo(): { enabled: boolean; sessions: { id: string; rules: AutoApproveRule[] }[] } {
    return {
      enabled: this._enabled,
      sessions: Array.from(this.rulesMap.entries()).map(([id, rules]) => ({
        id,
        rules,
      })),
    }
  }
}

// 单例导出
export const autoApproveStore = new AutoApproveStore()
