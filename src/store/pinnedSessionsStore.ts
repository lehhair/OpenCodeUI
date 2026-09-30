// ============================================
// PinnedSessionsStore — 置顶对话状态管理
// ============================================
//
// 按服务器隔离的置顶会话列表（跨工作区持久化）。
// 存储 { sessionId, directory, title } 以便未加载 session 详情时也能渲染。

import { serverStorage } from '../utils/perServerStorage'
import { affectsBoundServer } from './serverChangeScope'
import { serverStore } from './serverStore'

export interface PinnedSessionEntry {
  sessionId: string
  directory: string
  title: string
}

// 新：srv:{serverId}:opencode-pinned-sessions（serverStorage）
// 旧：localStorage 全局 opencode-pinned-sessions（一次性迁到当前 active server）
const STORAGE_KEY = 'opencode-pinned-sessions'

function parseEntries(raw: unknown): PinnedSessionEntry[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (item): item is PinnedSessionEntry =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as PinnedSessionEntry).sessionId === 'string' &&
      typeof (item as PinnedSessionEntry).directory === 'string' &&
      typeof (item as PinnedSessionEntry).title === 'string',
  )
}

function loadEntries(): PinnedSessionEntry[] {
  // 已有 per-server key 时直接用（含空数组）
  if (serverStorage.get(STORAGE_KEY) !== null) {
    return parseEntries(serverStorage.getJSON<unknown>(STORAGE_KEY))
  }

  // 一次性迁移：旧全局列表归到当前 active server
  try {
    const legacyRaw = localStorage.getItem(STORAGE_KEY)
    if (legacyRaw) {
      const migrated = parseEntries(JSON.parse(legacyRaw))
      serverStorage.setJSON(STORAGE_KEY, migrated)
      localStorage.removeItem(STORAGE_KEY)
      return migrated
    }
  } catch {
    // ignore migration failures
  }

  return []
}

class PinnedSessionsStore {
  private entries: PinnedSessionEntry[] = []
  private listeners = new Set<() => void>()

  constructor() {
    this.reload()
    serverStore.onServerChange((serverId, reason) => {
      // 置顶数据按 serverId 分片存储：非 active 服务器端点变化（WSL 重启）不影响
      // active 的列表，重载 + emit 只会造成无谓的重渲染；仅 active 数据源真的变了才重置
      if (!affectsBoundServer(undefined, serverId, reason, serverStore.getActiveServerId())) return
      this.reload()
      this.emit()
    })
  }

  private reload() {
    this.entries = loadEntries()
  }

  isPinned(sessionId: string): boolean {
    return this.entries.some(e => e.sessionId === sessionId)
  }

  pin(entry: PinnedSessionEntry) {
    const existingIndex = this.entries.findIndex(e => e.sessionId === entry.sessionId)
    if (existingIndex !== -1) {
      const existing = this.entries[existingIndex]
      if (existing.directory === entry.directory && existing.title === entry.title) return
      this.entries = [...this.entries.slice(0, existingIndex), entry, ...this.entries.slice(existingIndex + 1)]
      this.persist()
      this.emit()
      return
    }
    this.entries = [...this.entries, entry]
    this.persist()
    this.emit()
  }

  update(sessionId: string, patch: Partial<Omit<PinnedSessionEntry, 'sessionId'>>) {
    const index = this.entries.findIndex(e => e.sessionId === sessionId)
    if (index === -1) return
    const next = { ...this.entries[index], ...patch }
    if (next.directory === this.entries[index].directory && next.title === this.entries[index].title) return
    this.entries = [...this.entries.slice(0, index), next, ...this.entries.slice(index + 1)]
    this.persist()
    this.emit()
  }

  unpin(sessionId: string) {
    const idx = this.entries.findIndex(e => e.sessionId === sessionId)
    if (idx === -1) return
    this.entries = [...this.entries.slice(0, idx), ...this.entries.slice(idx + 1)]
    this.persist()
    this.emit()
  }

  private persist() {
    serverStorage.setJSON(STORAGE_KEY, this.entries)
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getSnapshot = (): PinnedSessionEntry[] => {
    return this.entries
  }

  private emit() {
    this.listeners.forEach(fn => fn())
  }
}

export const pinnedSessionsStore = new PinnedSessionsStore()
