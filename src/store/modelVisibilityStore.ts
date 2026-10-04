import { useSyncExternalStore } from 'react'
import type { Model } from '../types/api'
import { serverStorage } from '../utils/perServerStorage'
import { getModelKey } from '../utils/modelUtils'
import { affectsBoundServer } from './serverChangeScope'
import { serverStore } from './serverStore'

type Listener = () => void

const STORAGE_KEY_HIDDEN_MODELS = 'hidden-model-keys'

function loadHiddenModelKeys(): string[] {
  const stored = serverStorage.getJSON<unknown>(STORAGE_KEY_HIDDEN_MODELS)
  if (!Array.isArray(stored)) return []
  return stored.filter((item): item is string => typeof item === 'string')
}

class ModelVisibilityStore {
  private hiddenModelKeys = new Set<string>()
  private listeners = new Set<Listener>()
  private snapshot: string[] = []

  constructor() {
    this.reload()
    serverStore.onServerChange((serverId, reason) => {
      // 隐藏模型按 serverId 分片存储：非 active 服务器端点变化（WSL 重启）不影响
      // active 的可见性集合，重载 + emit 只会造成无谓的重渲染；仅 active 数据源真的变了才重置
      if (!affectsBoundServer(undefined, serverId, reason, serverStore.getActiveServerId())) return
      this.reload()
      this.emit()
    })
  }

  private syncSnapshot() {
    this.snapshot = Array.from(this.hiddenModelKeys).sort()
  }

  private emit() {
    this.listeners.forEach(listener => listener())
  }

  private commit() {
    this.syncSnapshot()
    serverStorage.setJSON(STORAGE_KEY_HIDDEN_MODELS, this.snapshot)
    this.emit()
  }

  private reload() {
    this.hiddenModelKeys = new Set(loadHiddenModelKeys())
    this.syncSnapshot()
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): string[] => this.snapshot

  isVisible(model: Model | string): boolean {
    const key = typeof model === 'string' ? model : getModelKey(model)
    return !this.hiddenModelKeys.has(key)
  }

  setVisible(model: Model | string, visible: boolean) {
    const key = typeof model === 'string' ? model : getModelKey(model)
    let changed = false
    if (visible) {
      changed = this.hiddenModelKeys.delete(key)
    } else if (!this.hiddenModelKeys.has(key)) {
      this.hiddenModelKeys.add(key)
      changed = true
    }
    if (!changed) return
    this.commit()
  }

  setManyVisible(models: Model[], visible: boolean) {
    let changed = false
    for (const model of models) {
      const key = getModelKey(model)
      if (visible) {
        changed = this.hiddenModelKeys.delete(key) || changed
      } else if (!this.hiddenModelKeys.has(key)) {
        this.hiddenModelKeys.add(key)
        changed = true
      }
    }
    if (!changed) return
    this.commit()
  }
}

export const modelVisibilityStore = new ModelVisibilityStore()

export function useHiddenModelKeys(): string[] {
  return useSyncExternalStore(modelVisibilityStore.subscribe, modelVisibilityStore.getSnapshot)
}
