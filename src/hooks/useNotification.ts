// ============================================
// useNotification - 通知系统
// ============================================
//
// 当 AI 完成回复、请求权限、提问或出错时，发送通知
// Tauri 环境下使用原生通知（@tauri-apps/plugin-notification）
// 浏览器环境下使用 Service Worker / Notification API
//
// Android Chrome 不支持 new Notification()，必须通过
// ServiceWorkerRegistration.showNotification() 发送

import { useState, useCallback, useEffect, useRef } from 'react'
import { STORAGE_KEY_NOTIFICATIONS_ENABLED } from '../constants/storage'
import { isTauri } from '../utils/tauri'

// ============================================
// Types
// ============================================

interface NotificationData {
  sessionId: string
  directory?: string
}

// ============================================
// Service Worker 注册（模块级单例，浏览器环境用）
// ============================================

let swRegistration: ServiceWorkerRegistration | null = null
let swRegistering = false

async function ensureServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (isTauri()) return null // Tauri 不需要 SW
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
// Tauri 通知工具
// ============================================

async function sendTauriNotification(title: string, body: string): Promise<void> {
  try {
    const { isPermissionGranted, requestPermission, sendNotification } = await import('@tauri-apps/plugin-notification')
    
    let permitted = await isPermissionGranted()
    if (!permitted) {
      const result = await requestPermission()
      permitted = result === 'granted'
    }
    
    if (permitted) {
      sendNotification({ title, body })
    }
  } catch (e) {
    if (import.meta.env.DEV) {
      console.warn('[Notification/Tauri] Failed:', e)
    }
  }
}

async function checkTauriPermission(): Promise<NotificationPermission> {
  try {
    const { isPermissionGranted } = await import('@tauri-apps/plugin-notification')
    const granted = await isPermissionGranted()
    return granted ? 'granted' : 'default'
  } catch {
    return 'denied'
  }
}

async function requestTauriPermission(): Promise<NotificationPermission> {
  try {
    const { requestPermission } = await import('@tauri-apps/plugin-notification')
    const result = await requestPermission()
    return result === 'granted' ? 'granted' : 'denied'
  } catch {
    return 'denied'
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
    if (isTauri()) return 'default' // Tauri 异步检查
    if (typeof Notification === 'undefined') return 'denied'
    return Notification.permission
  })

  // 跟踪最新的 enabled 值，供 sendNotification 闭包使用
  const enabledRef = useRef(enabled)
  useEffect(() => { enabledRef.current = enabled }, [enabled])

  // Tauri: 异步获取初始权限状态
  useEffect(() => {
    if (isTauri()) {
      checkTauriPermission().then(setPermission)
    }
  }, [])

  // 启用时预注册 SW（浏览器环境）
  useEffect(() => {
    if (enabled && !isTauri()) {
      ensureServiceWorker()
    }
  }, [enabled])

  // 监听 SW 的 notificationclick 消息（浏览器环境用于跳转）
  useEffect(() => {
    if (isTauri()) return
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
    if (value) {
      if (isTauri()) {
        const result = await requestTauriPermission()
        setPermission(result)
        if (result !== 'granted') return
      } else if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        const result = await Notification.requestPermission()
        setPermission(result)
        if (result !== 'granted') return
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

    // 启用时注册 SW（浏览器环境）
    if (value && !isTauri()) {
      ensureServiceWorker()
    }
  }, [])

  // 发送通知
  const sendNotification = useCallback(async (title: string, body: string, data?: NotificationData) => {
    if (!enabledRef.current) return

    // Tauri 原生通知
    if (isTauri()) {
      await sendTauriNotification(title, body)
      return
    }

    // 浏览器通知
    if (typeof Notification === 'undefined') return
    if (Notification.permission !== 'granted') return

    const notificationOptions: NotificationOptions = {
      body,
      icon: '/opencode.svg',
      tag: data?.sessionId || 'opencode',
      data,
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

  const supported = isTauri() || typeof Notification !== 'undefined'

  return {
    enabled,
    setEnabled,
    permission,
    supported,
    sendNotification,
  }
}
