// ============================================
// Per-Server Storage - 按服务器隔离的 localStorage 读写
// ============================================
//
// 不同服务器有不同的项目目录、模型、路径风格等设置。
// 这个工具函数给 localStorage key 加上 serverId 前缀，实现隔离。
//
// 用法：
//   import { serverStorage } from '../utils/perServerStorage'
//   serverStorage.get('last-directory')        // 读取当前服务器的值
//   serverStorage.set('last-directory', '/foo') // 写入当前服务器的值
//   serverStorage.remove('last-directory')      // 删除当前服务器的值

import { serverStore } from '../store/serverStore'
import { syncService } from '../services/syncService'

/**
 * 生成带 serverId 前缀的 localStorage key
 * 格式: `srv:{serverId}:{key}`
 */
function makeKey(key: string): string {
  const serverId = serverStore.getActiveServerId()
  return `srv:${serverId}:${key}`
}

/**
 * 获取当前服务器的 key 前缀（用于过滤远程同步事件）
 */
function getCurrentServerPrefix(): string {
  const serverId = serverStore.getActiveServerId()
  return `srv:${serverId}:`
}

// ============================================
// 远程同步事件监听
// ============================================
// 监听 sync-remote-change 事件，当收到远程变更时更新 localStorage
// 事件 detail 格式: Map<string, string> 或 { [key: string]: string }
if (typeof window !== 'undefined') {
  window.addEventListener('sync-remote-change', ((event: CustomEvent<Map<string, string> | Record<string, string>>) => {
    const prefix = getCurrentServerPrefix()
    const changes = event.detail

    // 支持 Map 和普通对象两种格式
    if (changes instanceof Map) {
      changes.forEach((value, key) => {
        if (key.startsWith(prefix)) {
          try {
            localStorage.setItem(key, value)
          } catch {
            // ignore
          }
        }
      })
    } else if (changes && typeof changes === 'object') {
      Object.entries(changes).forEach(([key, value]) => {
        if (key.startsWith(prefix)) {
          try {
            localStorage.setItem(key, value)
          } catch {
            // ignore
          }
        }
      })
    }
  }) as EventListener)
}

export const serverStorage = {
  /**
   * 读取当前服务器的存储值
   */
  get(key: string): string | null {
    try {
      return localStorage.getItem(makeKey(key))
    } catch {
      return null
    }
  },

  /**
   * 写入当前服务器的存储值
   */
  set(key: string, value: string): void {
    try {
      const fullKey = makeKey(key)
      localStorage.setItem(fullKey, value)
      syncService.pushChange(fullKey, value)
    } catch {
      // ignore
    }
  },

  /**
   * 删除当前服务器的存储值
   */
  remove(key: string): void {
    try {
      const fullKey = makeKey(key)
      localStorage.removeItem(fullKey)
      syncService.pushChange(fullKey, '')
    } catch {
      // ignore
    }
  },

  /**
   * 读取当前服务器的 JSON 值（自动解析）
   */
  getJSON<T>(key: string): T | null {
    const raw = serverStorage.get(key)
    if (!raw) return null
    try {
      return JSON.parse(raw) as T
    } catch {
      return null
    }
  },

  /**
   * 写入当前服务器的 JSON 值（自动序列化）
   */
  setJSON(key: string, value: unknown): void {
    serverStorage.set(key, JSON.stringify(value))
  },
}
