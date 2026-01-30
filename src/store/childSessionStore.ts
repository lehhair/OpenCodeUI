// ============================================
// ChildSessionStore - 追踪子 session 关系
// ============================================
// 
// 核心功能：
// 1. 追踪哪些 session 是当前 session 的子 session
// 2. 支持权限请求冒泡（子 session 的权限请求显示在父界面）
// 3. 存储子 session 的基本信息（用于显示来源）

import type { ApiSession } from '../api/types'

// ============================================
// Types
// ============================================

export interface ChildSessionInfo {
  id: string
  parentID: string
  title: string
  agent?: string  // 子 agent 名称
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
  private subscribers = new Set<Subscriber>()

  // ============================================
  // Subscription
  // ============================================

  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn)
    return () => this.subscribers.delete(fn)
  }

  private notify() {
    this.subscribers.forEach(fn => fn())
  }

  // ============================================
  // Session Tracking
  // ============================================

  /**
   * 注册一个新的子 session（从 session.created 事件调用）
   */
  registerChildSession(session: ApiSession) {
    if (!session.parentID) return // 不是子 session

    // 添加到 parent -> children 映射
    let children = this.childrenByParent.get(session.parentID)
    if (!children) {
      children = new Set()
      this.childrenByParent.set(session.parentID, children)
    }
    children.add(session.id)

    // 存储 session 信息
    this.sessionInfo.set(session.id, {
      id: session.id,
      parentID: session.parentID,
      title: session.title || 'Subtask',
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
    return childIds
      .map(id => this.sessionInfo.get(id))
      .filter((info): info is ChildSessionInfo => !!info)
  }

  /**
   * 获取子 session 信息
   */
  getSessionInfo(sessionId: string): ChildSessionInfo | undefined {
    return this.sessionInfo.get(sessionId)
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
   * 清理某个父 session 的所有子 session 记录
   */
  clearChildren(parentId: string) {
    const children = this.childrenByParent.get(parentId)
    if (children) {
      for (const childId of children) {
        this.sessionInfo.delete(childId)
        // 递归清理子 session 的子 session
        this.clearChildren(childId)
      }
      this.childrenByParent.delete(parentId)
      this.notify()
    }
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
    (onStoreChange) => childSessionStore.subscribe(onStoreChange),
    () => getChildSessionsSnapshot(parentId),
    () => getChildSessionsSnapshot(parentId)
  )
}

/**
 * 获取 session 及其所有子孙的 ID 列表
 */
export function useSessionFamily(sessionId: string | null): string[] {
  return useSyncExternalStore(
    (onStoreChange) => childSessionStore.subscribe(onStoreChange),
    () => getSessionFamilySnapshot(sessionId),
    () => getSessionFamilySnapshot(sessionId)
  )
}
