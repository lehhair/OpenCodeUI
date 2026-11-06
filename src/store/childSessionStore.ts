// ============================================
// ChildSessionStore - 追踪子 session 关系
// ============================================
//
// 核心功能：
// 1. 追踪哪些 session 是当前 session 的子 session
// 2. 支持权限请求冒泡（子 session 的权限请求显示在父界面）
// 3. 存储子 session 的基本信息（用于显示来源）

import type { ApiSession } from '../api/types'
import { makeSessionKey } from '../utils/sessionKey'
import { serverStore } from './serverStore'
import i18n from '../i18n'

// ============================================
// Types
// ============================================

export interface ChildSessionInfo {
  id: string
  parentID: string
  title: string
  agent?: string // 子 agent 名称
  status: 'running' | 'idle' | 'error'
  createdAt: number
}

type Subscriber = () => void

// ============================================
// Store Implementation
// ============================================

class ChildSessionStore {
  // parentID -> Set of child session IDs
  private childrenByParent = new Map<string, Set<string>>()
  // sessionID -> ChildSessionInfo
  private sessionInfo = new Map<string, ChildSessionInfo>()
  // task/subagent 工具卡片 → 子 session 的早期绑定：
  // `${serverId}:${partId}` -> childSessionKey（复合 key）。
  // metadata.sessionID 只在 tool.success 落库、progress 不落库（官方 message-updater.ts:341-342
  // 明示不投影 ephemeral progress），刷新/重连后运行中的工具拿不到子 session id，
  // 只能靠 session.created（带 parentID/agent/title）启发式重建——绑定结果放这里。
  private toolBindings = new Map<string, string>()
  // 反向索引：childSessionKey -> partKey（一个子 session 只属于一张卡片）
  private toolBindingsByChild = new Map<string, string>()
  // 已经问过服务端「这个父会话有哪些子会话」的 parent key。
  // 查询只能靠 REST（列表/事件都不保证覆盖历史子会话），所以每个会话只问一次：
  // 之后要么 store 里已有子会话，要么已确认没有。会话创建时照样会注册进来。
  private childrenScanned = new Set<string>()
  private subscribers = new Set<Subscriber>()
  private version = 0

  // ============================================
  // Subscription
  // ============================================

  // 箭头属性而非原型方法：useSyncExternalStore(childSessionStore.subscribe, ...) 会
  // 以未绑定方式调用，原型方法会丢 this（渲染期 TypeError → 白屏），与 themeStore 同款约定
  subscribe = (fn: Subscriber): (() => void) => {
    this.subscribers.add(fn)
    return () => {
      this.subscribers.delete(fn)
    }
  }

  private notify() {
    this.version++
    this.subscribers.forEach(fn => fn())
  }

  // ============================================
  // Session Tracking
  // ============================================

  /**
   * 注册一个新的子 session（从 session.created 事件调用）
   * @param serverId 子 session 所属服务器（用于把原始 sessionId 复合化）
   */
  registerChildSession(session: ApiSession, serverId?: string) {
    if (!session.parentID) return // 不是子 session

    const childKey = makeSessionKey(serverId ?? serverStore.getActiveServerId(), session.id)
    const parentKey = makeSessionKey(serverId ?? serverStore.getActiveServerId(), session.parentID)

    // 添加到 parent -> children 映射
    let children = this.childrenByParent.get(parentKey)
    if (!children) {
      children = new Set()
      this.childrenByParent.set(parentKey, children)
    }
    children.add(childKey)

    // 存储 session 信息
    this.sessionInfo.set(childKey, {
      id: childKey,
      parentID: parentKey,
      title: session.title || i18n.t('chat:permissionDialog.subtaskFallback'),
      agent: session.agent,
      status: 'running',
      createdAt: session.time.created,
    })

    this.notify()
  }

  /**
   * 更新子 session 状态
   */
  updateChildSession(sessionId: string, updates: Partial<Pick<ChildSessionInfo, 'status' | 'title'>>) {
    const info = this.sessionInfo.get(sessionId)
    if (!info) return

    Object.assign(info, updates)
    this.notify()
  }

  /**
   * 标记子 session 为 idle
   */
  markIdle(sessionId: string) {
    this.updateChildSession(sessionId, { status: 'idle' })
  }

  /**
   * 标记子 session 为 error
   */
  markError(sessionId: string) {
    this.updateChildSession(sessionId, { status: 'error' })
  }

  // ============================================
  // Getters
  // ============================================

  /**
   * 获取某个 session 的所有子 session IDs
   */
  getChildSessionIds(parentId: string): string[] {
    const children = this.childrenByParent.get(parentId)
    return children ? Array.from(children) : []
  }

  /**
   * 获取某个 session 的所有子 session 信息
   */
  getChildSessions(parentId: string): ChildSessionInfo[] {
    const childIds = this.getChildSessionIds(parentId)
    return childIds.map(id => this.sessionInfo.get(id)).filter((info): info is ChildSessionInfo => !!info)
  }

  /**
   * 获取子 session 信息
   */
  getSessionInfo(sessionId: string): ChildSessionInfo | undefined {
    return this.sessionInfo.get(sessionId)
  }

  /** 标记「已向服务端确认过该父会话的子会话列表」 */
  markChildrenScanned(parentId: string) {
    this.childrenScanned.add(parentId)
  }

  /** 是否已经确认过该父会话的子会话列表（确认过就不会再重复请求） */
  hasScannedChildren(parentId: string): boolean {
    return this.childrenScanned.has(parentId)
  }

  /**
   * 丢弃「已确认」标记（重连后调用）：
   * 断连期间新建的子会话没有走过 session.created，只有重新问一次才能补齐。
   */
  resetChildrenScans() {
    if (this.childrenScanned.size === 0) return
    this.childrenScanned.clear()
  }

  getVersion = (): number => this.version

  // ============================================
  // 工具卡片 ↔ 子 session 早期绑定
  // ============================================

  /** 把子 session 绑定到父 session 里发起它的 task/subagent 工具卡片 */
  bindToolPart(serverId: string, partId: string, childSessionKey: string) {
    const partKey = `${serverId}:${partId}`
    if (this.toolBindings.get(partKey) === childSessionKey) return
    // 一个子 session 只挂一张卡片：换绑时清掉旧反向索引
    const previousPartKey = this.toolBindingsByChild.get(childSessionKey)
    if (previousPartKey && previousPartKey !== partKey) this.toolBindings.delete(previousPartKey)
    this.toolBindings.set(partKey, childSessionKey)
    this.toolBindingsByChild.set(childSessionKey, partKey)
    this.notify()
  }

  /** 查某张工具卡片绑定的子 session（复合 key）；未绑定返回 undefined */
  getBoundChildForToolPart(serverId: string, partId: string): string | undefined {
    return this.toolBindings.get(`${serverId}:${partId}`)
  }

  /** 查子 session 是否已绑定到某张工具卡片 */
  getBoundToolPartForChild(childSessionKey: string): string | undefined {
    return this.toolBindingsByChild.get(childSessionKey)
  }

  /**
   * 检查 sessionId 是否是 parentId 的子 session（或子孙 session）
   */
  isChildOf(sessionId: string, parentId: string, recursive = true): boolean {
    const info = this.sessionInfo.get(sessionId)
    if (!info) return false

    if (info.parentID === parentId) return true

    if (recursive) {
      // 递归检查
      return this.isChildOf(info.parentID, parentId, true)
    }

    return false
  }

  /**
   * 获取 session 及其所有子孙 session 的 ID 列表
   */
  getSessionAndDescendants(sessionId: string): string[] {
    const result = [sessionId]
    const children = this.getChildSessionIds(sessionId)

    for (const childId of children) {
      result.push(...this.getSessionAndDescendants(childId))
    }

    return result
  }

  /**
   * 检查某个 sessionId 是否属于当前 session 或其子 session
   */
  belongsToSession(sessionId: string, rootSessionId: string): boolean {
    if (sessionId === rootSessionId) return true
    return this.isChildOf(sessionId, rootSessionId, true)
  }

  // ============================================
  // Cleanup
  // ============================================

  /**
   * 清空所有数据（服务器切换时调用）
   */
  clearAll() {
    this.childrenByParent.clear()
    this.sessionInfo.clear()
    this.toolBindings.clear()
    this.toolBindingsByChild.clear()
    this.childrenScanned.clear()
    this.notify()
  }

  /**
   * 清理某个父 session 的所有子 session 记录
   */
  clearChildren(parentId: string) {
    const children = this.childrenByParent.get(parentId)
    if (children) {
      for (const childId of children) {
        this.sessionInfo.delete(childId)
        this.dropToolBinding(childId)
        // 递归清理子 session 的子 session
        this.clearChildren(childId)
      }
      this.childrenByParent.delete(parentId)
      this.notify()
    }
    // 记录被清掉 = 需要重新向服务端确认
    this.childrenScanned.delete(parentId)
  }

  removeSession(sessionId: string) {
    const idsToRemove = this.getSessionAndDescendants(sessionId)
    let changed = false

    for (const id of idsToRemove) {
      const info = this.sessionInfo.get(id)
      if (info) {
        const siblings = this.childrenByParent.get(info.parentID)
        if (siblings?.delete(id)) {
          if (siblings.size === 0) this.childrenByParent.delete(info.parentID)
          changed = true
        }
      }

      if (this.childrenByParent.delete(id)) changed = true
      if (this.sessionInfo.delete(id)) changed = true
      if (this.childrenScanned.delete(id)) changed = true
      if (this.dropToolBinding(id)) changed = true
    }

    if (changed) this.notify()
  }

  /** 移除子 session 的卡片绑定（双向索引一起清），返回是否有变化 */
  private dropToolBinding(childSessionKey: string): boolean {
    const partKey = this.toolBindingsByChild.get(childSessionKey)
    if (!partKey) return false
    this.toolBindingsByChild.delete(childSessionKey)
    this.toolBindings.delete(partKey)
    return true
  }
}

// ============================================
// Singleton Export
// ============================================

export const childSessionStore = new ChildSessionStore()

// ============================================
// Snapshot Cache (避免 useSyncExternalStore 无限循环)
// ============================================

// 缓存：parentId -> ChildSessionInfo[]
const childSessionsCache = new Map<string | null, ChildSessionInfo[]>()
// 缓存：sessionId -> string[] (session family)
const sessionFamilyCache = new Map<string | null, string[]>()

// 订阅 store 变化时清除缓存
childSessionStore.subscribe(() => {
  childSessionsCache.clear()
  sessionFamilyCache.clear()
})

function getChildSessionsSnapshot(parentId: string | null): ChildSessionInfo[] {
  if (!parentId) {
    // 返回稳定的空数组引用
    if (!childSessionsCache.has(null)) {
      childSessionsCache.set(null, [])
    }
    return childSessionsCache.get(null)!
  }

  if (!childSessionsCache.has(parentId)) {
    childSessionsCache.set(parentId, childSessionStore.getChildSessions(parentId))
  }
  return childSessionsCache.get(parentId)!
}

function getSessionFamilySnapshot(sessionId: string | null): string[] {
  if (!sessionId) {
    if (!sessionFamilyCache.has(null)) {
      sessionFamilyCache.set(null, [])
    }
    return sessionFamilyCache.get(null)!
  }

  if (!sessionFamilyCache.has(sessionId)) {
    sessionFamilyCache.set(sessionId, childSessionStore.getSessionAndDescendants(sessionId))
  }
  return sessionFamilyCache.get(sessionId)!
}

// ============================================
// React Hook
// ============================================

import { useSyncExternalStore } from 'react'

/**
 * 获取某个 session 的子 session 列表
 */
export function useChildSessions(parentId: string | null): ChildSessionInfo[] {
  return useSyncExternalStore(
    childSessionStore.subscribe,
    () => getChildSessionsSnapshot(parentId),
    () => getChildSessionsSnapshot(parentId),
  )
}

/**
 * 获取 session 及其所有子孙的 ID 列表
 */
export function useSessionFamily(sessionId: string | null): string[] {
  return useSyncExternalStore(
    childSessionStore.subscribe,
    () => getSessionFamilySnapshot(sessionId),
    () => getSessionFamilySnapshot(sessionId),
  )
}
