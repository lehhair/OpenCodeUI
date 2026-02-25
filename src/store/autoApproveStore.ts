// ============================================
// Auto-Approve Store (Experimental)
// 前端自动批准规则存储，只存内存，刷新即清空
// ============================================

import { serverStorage } from '../utils/perServerStorage'

/**
 * 自动批准规则
 */
export interface AutoApproveRule {
  permission: string  // 工具类型: bash, edit, read, etc.
  pattern: string     // 匹配模式，如 "mkdir *", "ls", "*.tsx"
}

/**
 * 通配符匹配函数
 * 支持 * (任意字符) 和 ? (单个字符)
 */
function wildcardMatch(pattern: string, text: string): boolean {
  // 转换为正则表达式
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // 转义特殊字符
    .replace(/\*/g, '.*')                   // * -> .*
    .replace(/\?/g, '.')                    // ? -> .
  
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
  private _enabled: boolean = false
  private readonly STORAGE_KEY = 'opencode-auto-approve-enabled'
  
  constructor() {
    // 从 localStorage 读取开关状态
    try {
      const stored = serverStorage.get(this.STORAGE_KEY)
      this._enabled = stored === 'true'
    } catch {
      this._enabled = false
    }
  }
  
  /**
   * 重新从 storage 加载开关状态（服务器切换时调用）
   */
  reloadFromStorage(): void {
    try {
      const stored = serverStorage.get(this.STORAGE_KEY)
      this._enabled = stored === 'true'
    } catch {
      this._enabled = false
    }
    // 切换服务器时也清空所有规则
    this.rulesMap.clear()
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
      const isDuplicate = uniqueRules.some(
        r => r.permission === rule.permission && r.pattern === rule.pattern
      )
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
  shouldAutoApprove(
    sessionId: string,
    permission: string,
    requestPatterns: string[]
  ): boolean {
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
        return wildcardMatch(rule.pattern, reqPattern)
          || wildcardMatch(reqPattern, rule.pattern)
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
