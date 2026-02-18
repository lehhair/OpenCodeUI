// ============================================
// ActiveSessionStore - 追踪所有 session 的活跃状态
// ============================================
//
// 职责单一：只管 session 是否活跃、在等什么
//
// 数据来源：
// 1. GET /session/status → 全量 session 状态
// 2. GET /permission + GET /question → 补充等待中的 session
// 3. SSE session.status / permission.asked / question.asked 事件
//
// 与 notificationStore 完全独立，不互相依赖

import { useSyncExternalStore } from 'react'
import type { SessionStatus, SessionStatusMap } from '../types/api/session'

// ============================================
// Types
// ============================================

export interface PendingRequest {
  requestId: string
  sessionId: string
  type: 'permission' | 'question'
  description?: string
}

export interface ActiveSessionEntry {
  sessionId: string
  status: SessionStatus
  title?: string
  directory?: string
  /** session 当前等待的用户操作 */
  pendingAction?: {
    type: 'permission' | 'question'
    description?: string
  }
}

interface ActiveSessionState {
  statusMap: SessionStatusMap
  initialized: boolean
}

type Subscriber = () => void

// ============================================
// Store
// ============================================

class ActiveSessionStore {
  private state: ActiveSessionState = {
    statusMap: {},
    initialized: false,
  }
  private subscribers = new Set<Subscriber>()

  // session 元信息缓存（title, directory）
  private sessionMeta = new Map<string, { title?: string; directory?: string }>()

  // 未回复的 permission/question 请求 — requestId → PendingRequest
  private pendingRequests = new Map<string, PendingRequest>()

  // 服务端已报告 idle，但因有未回复请求而暂缓移出的 session
  private deferredIdleSessions = new Set<string>()

  // 派生数据缓存
  private cachedBusySessions: ActiveSessionEntry[] = []
  private cachedBusyCount: number = 0

  subscribe = (callback: Subscriber): (() => void) => {
    this.subscribers.add(callback)
    return () => this.subscribers.delete(callback)
  }

  private notify() {
    this.recomputeDerived()
    this.subscribers.forEach(cb => cb())
  }

  private recomputeDerived() {
    const entries = Object.entries(this.state.statusMap)
      .filter(([, status]) => status.type === 'busy' || status.type === 'retry')
      .map(([sessionId, status]) => {
        const meta = this.sessionMeta.get(sessionId)
        // 从自身 pendingRequests 查 pending action
        const pending = this.findPendingForSession(sessionId)
        return {
          sessionId,
          status,
          title: meta?.title,
          directory: meta?.directory,
          pendingAction: pending ? { type: pending.type, description: pending.description } : undefined,
        } as ActiveSessionEntry
      })
    this.cachedBusySessions = entries
    this.cachedBusyCount = entries.length
  }

  private findPendingForSession(sessionId: string): PendingRequest | undefined {
    for (const req of this.pendingRequests.values()) {
      if (req.sessionId === sessionId) return req
    }
    return undefined
  }

  private hasPendingForSession(sessionId: string): boolean {
    for (const req of this.pendingRequests.values()) {
      if (req.sessionId === sessionId) return true
    }
    return false
  }

  getSnapshot = (): ActiveSessionState => this.state
  getBusySessionsSnapshot = (): ActiveSessionEntry[] => this.cachedBusySessions
  getBusyCountSnapshot = (): number => this.cachedBusyCount

  // ============================================
  // 初始化：从 API 拉取全量状态
  // ============================================

  initialize(statusMap: SessionStatusMap) {
    this.state = { statusMap: { ...statusMap }, initialized: true }
    this.notify()
  }

  // ============================================
  // 初始化：从 /permission + /question API 补充
  // ============================================

  initializePendingRequests(
    permissions: Array<{ id: string; sessionID: string; permission: string; patterns?: string[] }>,
    questions: Array<{ id: string; sessionID: string; questions?: Array<{ header?: string }> }>,
  ) {
    let changed = false
    const newMap = { ...this.state.statusMap }

    for (const p of permissions) {
      const desc = p.patterns?.length ? `${p.permission}: ${p.patterns[0]}` : p.permission
      this.pendingRequests.set(p.id, {
        requestId: p.id, sessionId: p.sessionID, type: 'permission', description: desc,
      })
      if (!newMap[p.sessionID] || newMap[p.sessionID].type === 'idle') {
        newMap[p.sessionID] = { type: 'busy' }
        this.deferredIdleSessions.add(p.sessionID)
        changed = true
      }
    }

    for (const q of questions) {
      const desc = q.questions?.[0]?.header || 'Waiting for input'
      this.pendingRequests.set(q.id, {
        requestId: q.id, sessionId: q.sessionID, type: 'question', description: desc,
      })
      if (!newMap[q.sessionID] || newMap[q.sessionID].type === 'idle') {
        newMap[q.sessionID] = { type: 'busy' }
        this.deferredIdleSessions.add(q.sessionID)
        changed = true
      }
    }

    if (changed) {
      this.state = { ...this.state, statusMap: newMap }
    }
    this.notify()
  }

  // ============================================
  // SSE 事件：permission/question asked → 注册 pending
  // ============================================

  addPendingRequest(requestId: string, sessionId: string, type: 'permission' | 'question', description?: string) {
    this.pendingRequests.set(requestId, { requestId, sessionId, type, description })
    // 确保 session 在 busy 列表
    if (!this.state.statusMap[sessionId] || this.state.statusMap[sessionId].type === 'idle') {
      const newMap = { ...this.state.statusMap, [sessionId]: { type: 'busy' as const } }
      this.deferredIdleSessions.add(sessionId)
      this.state = { ...this.state, statusMap: newMap }
    }
    this.notify()
  }

  // ============================================
  // SSE 事件：permission/question replied → 移除 pending
  // ============================================

  resolvePendingRequest(requestId: string) {
    const req = this.pendingRequests.get(requestId)
    if (!req) return
    this.pendingRequests.delete(requestId)

    // 检查该 session 是否还有其他 pending，没有且 deferred 就移出 busy
    if (this.deferredIdleSessions.has(req.sessionId) && !this.hasPendingForSession(req.sessionId)) {
      this.deferredIdleSessions.delete(req.sessionId)
      const newMap = { ...this.state.statusMap }
      delete newMap[req.sessionId]
      this.state = { ...this.state, statusMap: newMap }
    }
    this.notify()
  }

  // ============================================
  // SSE 事件：session status 更新
  // ============================================

  updateStatus(sessionId: string, status: SessionStatus) {
    const newMap = { ...this.state.statusMap }

    if (status.type === 'idle') {
      if (this.hasPendingForSession(sessionId)) {
        this.deferredIdleSessions.add(sessionId)
      } else {
        this.deferredIdleSessions.delete(sessionId)
        delete newMap[sessionId]
      }
    } else {
      this.deferredIdleSessions.delete(sessionId)
      newMap[sessionId] = status
    }

    this.state = { ...this.state, statusMap: newMap }
    this.notify()
  }

  // ============================================
  // Session 元信息管理
  // ============================================

  setSessionMeta(sessionId: string, title?: string, directory?: string) {
    const existing = this.sessionMeta.get(sessionId)
    const newTitle = title ?? existing?.title
    const newDir = directory ?? existing?.directory
    if (newTitle !== existing?.title || newDir !== existing?.directory) {
      this.sessionMeta.set(sessionId, { title: newTitle, directory: newDir })
      this.notify()
    }
  }

  getSessionMeta(sessionId: string) {
    return this.sessionMeta.get(sessionId)
  }

  getBusySessions(): ActiveSessionEntry[] {
    return this.cachedBusySessions
  }

  get busyCount(): number {
    return this.cachedBusyCount
  }
}

// ============================================
// Singleton & React Hooks
// ============================================

export const activeSessionStore = new ActiveSessionStore()

export function useActiveSessionStore() {
  return useSyncExternalStore(activeSessionStore.subscribe, activeSessionStore.getSnapshot)
}

export function useBusySessions(): ActiveSessionEntry[] {
  return useSyncExternalStore(activeSessionStore.subscribe, activeSessionStore.getBusySessionsSnapshot)
}

export function useBusyCount(): number {
  return useSyncExternalStore(activeSessionStore.subscribe, activeSessionStore.getBusyCountSnapshot)
}
