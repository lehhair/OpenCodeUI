// ============================================
// useNotification - 浏览器通知
// ============================================
//
// 当 AI 完成回复、请求权限、提问或出错时，发送浏览器通知
// 点击通知可以跳转到对应 session
//
// Android Chrome 不支持 new Notification()，必须通过
// ServiceWorkerRegistration.showNotification() 发送

import { useState, useCallback, useEffect, useRef } from 'react'
import { STORAGE_KEY_NOTIFICATIONS_ENABLED } from '../constants/storage'

// ============================================
// Types
// ============================================

interface NotificationData {
  sessionId: string
  directory?: string
}

// ============================================
// Service Worker 注册（模块级单例）
// ============================================

let swRegistration: ServiceWorkerRegistration | null = null
let swRegistering = false

async function ensureServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (swRegistration) return swRegistration
  if (swRegistering) return null
  if (!('serviceWorker' in navigator)) return null

  swRegistering = true
  try {
    swRegistration = await navigator.serviceWorker.register('/notification-sw.js')
    return swRegistration
  } catch {
    return null
  } finally {
    swRegistering = false
  }
}

// ============================================
// Hook
// ============================================

export function useNotification() {
  const [enabled, setEnabledState] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY_NOTIFICATIONS_ENABLED) === 'true'
    } catch {
      return false
    }
  })

  const [permission, setPermission] = useState<NotificationPermission>(() => {
    if (typeof Notification === 'undefined') return 'denied'
    return Notification.permission
  })

  // 跟踪最新的 enabled 值，供 sendNotification 闭包使用
  const enabledRef = useRef(enabled)
  useEffect(() => { enabledRef.current = enabled }, [enabled])

  // 启用时预注册 SW
  useEffect(() => {
    if (enabled) {
      ensureServiceWorker()
    }
  }, [enabled])

  // 监听 SW 的 notificationclick 消息（用于跳转）
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'notification-click') {
        window.focus()
        const { sessionId, directory } = event.data
        if (sessionId) {
          const dir = directory ? `?dir=${directory}` : ''
          window.location.hash = `#/session/${sessionId}${dir}`
        }
      }
    }

    navigator.serviceWorker.addEventListener('message', handler)
    return () => navigator.serviceWorker.removeEventListener('message', handler)
  }, [])

  // 切换通知开关
  const setEnabled = useCallback(async (value: boolean) => {
    if (value && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      // 首次启用时请求权限
      const result = await Notification.requestPermission()
      setPermission(result)
      if (result !== 'granted') {
        // 用户拒绝了权限，不启用
        return
      }
    }

    setEnabledState(value)
    try {
      if (value) {
        localStorage.setItem(STORAGE_KEY_NOTIFICATIONS_ENABLED, 'true')
      } else {
        localStorage.removeItem(STORAGE_KEY_NOTIFICATIONS_ENABLED)
      }
    } catch { /* ignore */ }

    // 启用时注册 SW
    if (value) {
      ensureServiceWorker()
    }
  }, [])

  // 发送通知
  const sendNotification = useCallback(async (title: string, body: string, data?: NotificationData) => {
    if (!enabledRef.current) return
    if (typeof Notification === 'undefined') return
    if (Notification.permission !== 'granted') return

    const notificationOptions: NotificationOptions = {
      body,
      icon: '/opencode.svg',
      tag: data?.sessionId || 'opencode', // 同 session 的通知会替换
      data, // 传给 SW 的 notificationclick 事件
    }

    // 优先用 SW showNotification（Android Chrome 必须用这个）
    try {
      const reg = await ensureServiceWorker()
      if (reg) {
        await reg.showNotification(title, notificationOptions)
        return
      }
    } catch {
      // SW 不可用，降级到 new Notification
    }

    // 降级：桌面浏览器直接用 new Notification
    try {
      const notification = new Notification(title, notificationOptions)
      notification.onclick = () => {
        window.focus()
        if (data?.sessionId) {
          const path = `#/session/${data.sessionId}`
          const dir = data.directory ? `?dir=${data.directory}` : ''
          window.location.hash = `${path}${dir}`
        }
        notification.close()
      }
    } catch {
      // 通知 API 可能在某些环境不可用
    }
  }, [])

  const supported = typeof Notification !== 'undefined'

  return {
    enabled,
    setEnabled,
    permission,
    supported,
    sendNotification,
  }
}
