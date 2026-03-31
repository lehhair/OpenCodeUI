// ============================================
// SoundStore - 通知提示音配置持久化
// ============================================
//
// 管理：
// 1. 声音总开关
// 2. 当前会话也播放开关
// 3. 通知音量 (0-100)
// 4. 每类事件的音效选择（内置 / 自定义 / 无）
// 5. 自定义音频文件的 IndexedDB 持久化
//
// 配置项存 localStorage，自定义音频 Blob 存 IndexedDB

import { useSyncExternalStore } from 'react'
import type { NotificationType } from './notificationStore'
import { DEFAULT_SOUNDS } from '../utils/soundPlayer'
import { syncableSetItem, onSyncRemoteChange } from '../utils/syncableStorage'

// ============================================
// Types
// ============================================

export interface EventSoundConfig {
  /** 'builtin:xxx' | 'custom' | 'none' */
  soundId: string
  /** 自定义音频的文件名（展示用） */
  customFileName?: string
}

export interface SoundSettings {
  /** 声音总开关 */
  enabled: boolean
  /** 当前会话也播放提示音 */
  currentSessionEnabled: boolean
  /** 通知音量 0-100 */
  volume: number
  /** 每类事件的音效配置 */
  events: Record<NotificationType, EventSoundConfig>
}

type Subscriber = () => void

// ============================================
// Constants
// ============================================

const STORAGE_KEY = 'opencode:sound-settings'
const IDB_NAME = 'opencode-sounds'
const IDB_STORE = 'custom-audio'
const IDB_VERSION = 1

// ============================================
// 默认配置
// ============================================

function createDefaultSettings(): SoundSettings {
  return {
    enabled: true,
    currentSessionEnabled: false,
    volume: 50,
    events: {
      completed: { soundId: DEFAULT_SOUNDS.completed },
      permission: { soundId: DEFAULT_SOUNDS.permission },
      question: { soundId: DEFAULT_SOUNDS.question },
      error: { soundId: DEFAULT_SOUNDS.error },
    },
  }
}

// ============================================
// localStorage helpers
// ============================================

function loadSettings(): SoundSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return createDefaultSettings()
    const parsed = JSON.parse(raw)
    // 合并默认值，防止旧版本缺字段
    const defaults = createDefaultSettings()
    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : defaults.enabled,
      currentSessionEnabled:
        typeof parsed.currentSessionEnabled === 'boolean'
          ? parsed.currentSessionEnabled
          : defaults.currentSessionEnabled,
      volume: typeof parsed.volume === 'number' ? Math.max(0, Math.min(100, parsed.volume)) : defaults.volume,
      events: {
        completed: parsed.events?.completed || defaults.events.completed,
        permission: parsed.events?.permission || defaults.events.permission,
        question: parsed.events?.question || defaults.events.question,
        error: parsed.events?.error || defaults.events.error,
      },
    }
  } catch {
    return createDefaultSettings()
  }
}

function saveSettings(settings: SoundSettings) {
  try {
    syncableSetItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // quota exceeded
  }
}

// ============================================
// IndexedDB helpers (自定义音频文件)
// ============================================

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, IDB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function idbPut(key: string, value: Blob): Promise<void> {
  const db = await openIDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    const store = tx.objectStore(IDB_STORE)
    const req = store.put(value, key)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    tx.oncomplete = () => db.close()
  })
}

async function idbGet(key: string): Promise<Blob | undefined> {
  const db = await openIDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly')
    const store = tx.objectStore(IDB_STORE)
    const req = store.get(key)
    req.onsuccess = () => resolve(req.result as Blob | undefined)
    req.onerror = () => reject(req.error)
    tx.oncomplete = () => db.close()
  })
}

async function idbDelete(key: string): Promise<void> {
  const db = await openIDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    const store = tx.objectStore(IDB_STORE)
    const req = store.delete(key)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    tx.oncomplete = () => db.close()
  })
}

// ============================================
// Store
// ============================================

/** 自定义音频文件大小限制：2MB */
const MAX_CUSTOM_AUDIO_SIZE = 2 * 1024 * 1024

/** 允许的音频 MIME 类型 */
const ALLOWED_AUDIO_TYPES = [
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/wave',
  'audio/x-wav',
  'audio/ogg',
  'audio/m4a',
  'audio/mp4',
  'audio/x-m4a',
  'audio/aac',
  'audio/webm',
  'audio/flac',
]

export function isAudioFileValid(file: File): { valid: boolean; error?: string } {
  if (file.size > MAX_CUSTOM_AUDIO_SIZE) {
    return { valid: false, error: 'fileTooLarge' }
  }
  // 宽松检查：允许所有 audio/* 类型
  if (!file.type.startsWith('audio/') && !ALLOWED_AUDIO_TYPES.includes(file.type)) {
    return { valid: false, error: 'notAudioFile' }
  }
  return { valid: true }
}

class SoundStore {
  private settings: SoundSettings = loadSettings()
  private subscribers = new Set<Subscriber>()
  /** 内存缓存：自定义音频 Blob（从 IDB 懒加载） */
  private customAudioCache = new Map<NotificationType, Blob>()
  private customAudioLoading = new Set<NotificationType>()

  constructor() {
    this.preloadCustomAudio()
    onSyncRemoteChange([STORAGE_KEY], () => {
      this.settings = loadSettings()
      this.notify()
    })
  }

  private notify() {
    this.subscribers.forEach(cb => cb())
  }

  private persist() {
    saveSettings(this.settings)
  }

  subscribe = (cb: Subscriber): (() => void) => {
    this.subscribers.add(cb)
    return () => this.subscribers.delete(cb)
  }

  getSnapshot = (): SoundSettings => this.settings

  // ============================================
  // 总控设置
  // ============================================

  setEnabled(enabled: boolean) {
    this.settings = { ...this.settings, enabled }
    this.persist()
    this.notify()
  }

  setCurrentSessionEnabled(enabled: boolean) {
    this.settings = { ...this.settings, currentSessionEnabled: enabled }
    this.persist()
    this.notify()
  }

  setVolume(volume: number) {
    this.settings = { ...this.settings, volume: Math.max(0, Math.min(100, Math.round(volume))) }
    this.persist()
    this.notify()
  }

  // ============================================
  // 事件音效配置
  // ============================================

  setEventSound(type: NotificationType, soundId: string) {
    this.settings = {
      ...this.settings,
      events: {
        ...this.settings.events,
        [type]: {
          ...this.settings.events[type],
          soundId,
          // 切换音效时保留 customFileName —— 自定义音频留在 IDB 里不删，
          // 用户随时可以切回来。只有显式点"移除"才真删。
        },
      },
    }
    this.persist()
    this.notify()
  }

  // ============================================
  // 自定义音频管理
  // ============================================

  async uploadCustomAudio(type: NotificationType, file: File): Promise<{ success: boolean; error?: string }> {
    const validation = isAudioFileValid(file)
    if (!validation.valid) {
      return { success: false, error: validation.error }
    }

    try {
      const blob = new Blob([await file.arrayBuffer()], { type: file.type })
      await idbPut(`custom-${type}`, blob)
      this.customAudioCache.set(type, blob)

      this.settings = {
        ...this.settings,
        events: {
          ...this.settings.events,
          [type]: {
            soundId: 'custom',
            customFileName: file.name,
          },
        },
      }
      this.persist()
      this.notify()
      return { success: true }
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn('[SoundStore] Upload failed:', err)
      }
      return { success: false, error: 'saveFailed' }
    }
  }

  async removeCustomAudio(type: NotificationType): Promise<void> {
    try {
      await idbDelete(`custom-${type}`)
    } catch {
      // 删除失败不影响逻辑
    }
    this.customAudioCache.delete(type)

    // 切回默认内置音效
    this.settings = {
      ...this.settings,
      events: {
        ...this.settings.events,
        [type]: {
          soundId: DEFAULT_SOUNDS[type],
          customFileName: undefined,
        },
      },
    }
    this.persist()
    this.notify()
  }

  getCustomAudioBlob(type: NotificationType): Blob | null {
    return this.customAudioCache.get(type) || null
  }

  /** 该事件是否有已上传的自定义音频（不管当前是否选中 custom） */
  hasCustomAudio(type: NotificationType): boolean {
    return this.customAudioCache.has(type) || !!this.settings.events[type].customFileName
  }

  /** 导出自定义音频为可下载文件 */
  async exportCustomAudio(type: NotificationType): Promise<void> {
    const blob = await this.getCustomAudioBlobAsync(type)
    if (!blob) return

    const fileName = this.settings.events[type].customFileName || `custom-${type}.audio`
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  /** 异步获取自定义音频（如果缓存没有，从 IDB 加载） */
  async getCustomAudioBlobAsync(type: NotificationType): Promise<Blob | null> {
    const cached = this.customAudioCache.get(type)
    if (cached) return cached

    if (this.customAudioLoading.has(type)) return null

    this.customAudioLoading.add(type)
    try {
      const blob = await idbGet(`custom-${type}`)
      if (blob) {
        this.customAudioCache.set(type, blob)
        return blob
      }
      return null
    } catch {
      return null
    } finally {
      this.customAudioLoading.delete(type)
    }
  }

  private async preloadCustomAudio() {
    const types: NotificationType[] = ['completed', 'permission', 'question', 'error']
    for (const type of types) {
      // 只要有 customFileName 就预加载，不管当前是否选中 custom
      if (this.settings.events[type].customFileName) {
        try {
          const blob = await idbGet(`custom-${type}`)
          if (blob) {
            this.customAudioCache.set(type, blob)
          }
        } catch {
          // 预加载失败不影响运行
        }
      }
    }
  }
}

// ============================================
// 单例 & React Hook
// ============================================

export const soundStore = new SoundStore()

export function useSoundSettings(): SoundSettings {
  return useSyncExternalStore(soundStore.subscribe, soundStore.getSnapshot)
}
