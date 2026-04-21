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

/**
 * 生成带 serverId 前缀的 localStorage key
 * 格式: `srv:{serverId}:{key}`
 */
function makeKey(key: string): string {
  const serverId = serverStore.getActiveServerId()
  return `srv:${serverId}:${key}`
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
      localStorage.setItem(makeKey(key), value)
    } catch {
      // ignore
    }
  },

  /**
   * 删除当前服务器的存储值
   */
  remove(key: string): void {
    try {
      localStorage.removeItem(makeKey(key))
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

export interface PerServerStorageBackup {
  entries: Record<string, string>
}

const SERVER_STORAGE_PREFIX = 'srv:'

export function exportPerServerStorageBackup(): PerServerStorageBackup {
  const entries: Record<string, string> = {}

  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (!key || !key.startsWith(SERVER_STORAGE_PREFIX)) continue
    const value = localStorage.getItem(key)
    if (value !== null) {
      entries[key] = value
    }
  }

  return { entries }
}

export function importPerServerStorageBackup(raw: unknown): void {
  const parsed = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : undefined
  const entries = parsed?.entries && typeof parsed.entries === 'object' ? parsed.entries : {}

  const keysToRemove: string[] = []
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (key && key.startsWith(SERVER_STORAGE_PREFIX)) {
      keysToRemove.push(key)
    }
  }

  for (const key of keysToRemove) {
    localStorage.removeItem(key)
  }

  for (const [key, value] of Object.entries(entries as Record<string, unknown>)) {
    if (key.startsWith(SERVER_STORAGE_PREFIX) && typeof value === 'string') {
      localStorage.setItem(key, value)
    }
  }
}
