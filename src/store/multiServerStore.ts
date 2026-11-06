// ============================================
// MultiServerStore - 多服务器订阅模式配置
//
// 开启后，session 列表按服务器分组展示，并同时订阅多个服务器的事件。
// 配置持久化在 localStorage。
// ============================================

import { useSyncExternalStore } from 'react'
import { serverStore } from './serverStore'

const STORAGE_KEY = 'opencode-multi-server'

interface PersistedShape {
  enabled: boolean
  subscribedServerIds: string[]
  /** 项目管理面板当前聚焦的服务器（添加目录时的目标服务器） */
  focusedServerId: string | null
}

type Listener = () => void

function loadPersisted(): PersistedShape {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedShape>
      return {
        enabled: parsed.enabled === true,
        subscribedServerIds: Array.isArray(parsed.subscribedServerIds) ? parsed.subscribedServerIds : [],
        focusedServerId: typeof parsed.focusedServerId === 'string' ? parsed.focusedServerId : null,
      }
    }
    return { enabled: false, subscribedServerIds: [], focusedServerId: null }
  } catch {
    return { enabled: false, subscribedServerIds: [], focusedServerId: null }
  }
}

class MultiServerStore {
  private settings: PersistedShape = loadPersisted()
  private listeners: Set<Listener> = new Set()
  private _snapshot: PersistedShape = { ...this.settings }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot(): PersistedShape {
    return this._snapshot
  }

  private notify(): void {
    this._snapshot = { ...this.settings }
    this.persist()
    this.listeners.forEach(fn => fn())
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings))
    } catch {
      // ignore
    }
  }

  isEnabled(): boolean {
    return this.settings.enabled
  }

  setEnabled(enabled: boolean): void {
    if (this.settings.enabled === enabled) return
    this.settings.enabled = enabled
    // 开启时若白名单为空，自动订阅当前活动服务器，避免开启后一片空白
    if (enabled && this.settings.subscribedServerIds.length === 0) {
      const activeId = serverStore.getActiveServerId()
      if (activeId) {
        this.settings.subscribedServerIds = [activeId]
      }
    }
    this.notify()
  }

  getSubscribedServerIds(): string[] {
    return [...this.settings.subscribedServerIds]
  }

  /** 是否订阅了指定服务器 */
  isSubscribed(serverId: string): boolean {
    return this.settings.subscribedServerIds.includes(serverId)
  }

  /** 订阅/取消订阅一个服务器（多服务器模式开启时生效） */
  setSubscribed(serverId: string, subscribed: boolean): void {
    const current = new Set(this.settings.subscribedServerIds)
    if (subscribed) {
      current.add(serverId)
    } else {
      current.delete(serverId)
    }
    const next = Array.from(current)
    if (JSON.stringify(next) === JSON.stringify(this.settings.subscribedServerIds)) return
    this.settings.subscribedServerIds = next
    this.notify()
  }

  /** 用服务器 id 集合整体替换订阅列表 */
  setSubscribedServerIds(serverIds: string[]): void {
    const next = Array.from(new Set(serverIds))
    if (JSON.stringify(next) === JSON.stringify(this.settings.subscribedServerIds)) return
    this.settings.subscribedServerIds = next
    this.notify()
  }

  // ============================================
  // 焦点服务器（项目管理面板的目标服务器）
  // ============================================

  /** 当前焦点服务器（缺省 = active server） */
  getFocusedServerId(): string {
    return this.settings.focusedServerId ?? serverStore.getActiveServerId()
  }

  setFocusedServerId(serverId: string | null): void {
    if (this.settings.focusedServerId === serverId) return
    this.settings.focusedServerId = serverId
    this.notify()
  }
}

export const multiServerStore = new MultiServerStore()

/** 稳定引用：useSyncExternalStore 的 subscribe 每次渲染换新会反复解绑/重绑 */
const subscribeMultiServerStore = (listener: () => void): (() => void) => multiServerStore.subscribe(listener)

/** React hook：多服务器模式配置 */
export function useMultiServerStore(): PersistedShape {
  return useSyncExternalStore(
    subscribeMultiServerStore,
    () => multiServerStore.getSnapshot(),
    () => multiServerStore.getSnapshot(),
  )
}
