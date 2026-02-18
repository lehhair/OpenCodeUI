// ============================================
// NotificationStore - Toast + 通知历史
// ============================================
//
// 统一管理所有通知：
// 1. Toast 弹窗（右上角，8 秒自动消失，悬停暂停）
// 2. 通知历史（持久化到 localStorage，显示在 Active tab 的 Notifications 区域）
//
// 由 useGlobalEvents 统一推送，不再由 activeSessionStore 管通知

import { useSyncExternalStore } from 'react'

// ============================================
// Types
// ============================================

export type NotificationType = 'permission' | 'question' | 'completed' | 'error'

export interface NotificationEntry {
  id: string
  type: NotificationType
  title: string
  body: string
  sessionId: string
  directory?: string
  timestamp: number
  read: boolean
}

export interface ToastItem {
  notification: NotificationEntry
  exiting: boolean
}

interface NotificationState {
  toasts: ToastItem[]
  notifications: NotificationEntry[]
}

type Subscriber = () => void

// ============================================
// Constants
// ============================================

const TOAST_DURATION = 8000
const MAX_TOASTS = 3
const EXIT_ANIMATION_MS = 200
const STORAGE_KEY = 'opencode:notifications'
const MAX_NOTIFICATIONS = 50

// ============================================
// localStorage helpers
// ============================================

function loadNotifications(): NotificationEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    return (JSON.parse(raw) as NotificationEntry[]).slice(0, MAX_NOTIFICATIONS)
  } catch {
    return []
  }
}

function saveNotifications(entries: NotificationEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // quota exceeded
  }
}

// ============================================
// Store
// ============================================

class NotificationStore {
  private state: NotificationState = {
    toasts: [],
    notifications: loadNotifications(),
  }
  private subscribers = new Set<Subscriber>()
  private toastTimers = new Map<string, ReturnType<typeof setTimeout>>()

  subscribe = (callback: Subscriber): (() => void) => {
    this.subscribers.add(callback)
    return () => this.subscribers.delete(callback)
  }

  private notify() {
    this.subscribers.forEach(cb => cb())
  }

  private persist() {
    saveNotifications(this.state.notifications)
  }

  getSnapshot = (): NotificationState => this.state

  // ============================================
  // 推送通知（加历史 + 弹 toast）
  // ============================================

  push(
    type: NotificationType,
    title: string,
    body: string,
    sessionId: string,
    directory?: string,
  ) {
    const entry: NotificationEntry = {
      id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type,
      title,
      body,
      sessionId,
      directory,
      timestamp: Date.now(),
      read: false,
    }

    // 加到历史
    const notifications = [entry, ...this.state.notifications].slice(0, MAX_NOTIFICATIONS)

    // 弹 toast
    const toasts = [...this.state.toasts]
    if (toasts.length >= MAX_TOASTS) {
      const oldest = toasts.pop()
      if (oldest) this.clearToastTimer(oldest.notification.id)
    }
    toasts.unshift({ notification: entry, exiting: false })

    this.state = { ...this.state, toasts, notifications }
    this.persist()
    this.notify()

    this.scheduleToastDismiss(entry.id)
  }

  // ============================================
  // 用户交互（通知历史）
  // ============================================

  markRead(id: string) {
    const notifications = this.state.notifications.map(n =>
      n.id === id && !n.read ? { ...n, read: true } : n
    )
    this.state = { ...this.state, notifications }
    this.persist()
    this.notify()
  }

  markAllRead() {
    const notifications = this.state.notifications.map(n =>
      n.read ? n : { ...n, read: true }
    )
    this.state = { ...this.state, notifications }
    this.persist()
    this.notify()
  }

  dismiss(id: string) {
    const notifications = this.state.notifications.filter(n => n.id !== id)
    this.state = { ...this.state, notifications }
    this.persist()
    this.notify()
  }

  clearAll() {
    this.state = { ...this.state, notifications: [] }
    this.persist()
    this.notify()
  }

  // ============================================
  // Toast 管理
  // ============================================

  private scheduleToastDismiss(id: string) {
    this.clearToastTimer(id)
    const timer = setTimeout(() => this.dismissToast(id), TOAST_DURATION)
    this.toastTimers.set(id, timer)
  }

  private clearToastTimer(id: string) {
    const timer = this.toastTimers.get(id)
    if (timer) {
      clearTimeout(timer)
      this.toastTimers.delete(id)
    }
  }

  pauseToast(id: string) {
    this.clearToastTimer(id)
  }

  resumeToast(id: string) {
    const exists = this.state.toasts.some(t => t.notification.id === id && !t.exiting)
    if (exists) {
      this.scheduleToastDismiss(id)
    }
  }

  dismissToast(id: string) {
    this.clearToastTimer(id)
    const toasts = this.state.toasts.map(t =>
      t.notification.id === id ? { ...t, exiting: true } : t
    )
    this.state = { ...this.state, toasts }
    this.notify()

    setTimeout(() => {
      this.state = {
        ...this.state,
        toasts: this.state.toasts.filter(t => t.notification.id !== id),
      }
      this.notify()
    }, EXIT_ANIMATION_MS)
  }

  dismissAllToasts() {
    this.toastTimers.forEach(timer => clearTimeout(timer))
    this.toastTimers.clear()
    this.state = { ...this.state, toasts: [] }
    this.notify()
  }
}

// ============================================
// 单例 & React Hooks
// ============================================

export const notificationStore = new NotificationStore()

export function useNotificationStore() {
  return useSyncExternalStore(
    notificationStore.subscribe,
    notificationStore.getSnapshot,
  )
}

/** 通知历史列表 */
export function useNotifications(): NotificationEntry[] {
  const state = useNotificationStore()
  return state.notifications
}

/** 未读通知数 */
export function useUnreadNotificationCount(): number {
  const state = useNotificationStore()
  return state.notifications.filter(n => !n.read).length
}
