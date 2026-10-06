// ============================================
// InboxStore —— 服务端 inbox（队列）的客户端镜像
//
// 对应官方 data.ts 的 session.pending：由 `session.inbox.list` 快照打底，
// 靠 enqueued / delivered / cancelled / delivery.changed 四个事件增量维护。
// 队列视图 = type==='user' && delivery==='queue' 的条目
//（官方 packages/app/src/session/composer/queue.ts:80-84 同款过滤）。
//
// key 一律是带服务器前缀的 scoped sessionId（与 messageStore 一致）。
// ============================================

import { useMemo, useSyncExternalStore } from 'react'
import type { SessionInboxInfo, SessionInboxDelivery } from '@opencode/client/promise'

const EMPTY_ITEMS: SessionInboxInfo[] = []
type QueuedUserPrompt = Extract<SessionInboxInfo, { type: 'user' }>
const EMPTY_QUEUE: QueuedUserPrompt[] = []

class InboxStore {
  private itemsBySession = new Map<string, SessionInboxInfo[]>()
  private listeners = new Set<() => void>()
  /**
   * 快照拉取期间到达的事件增量（官方 pending.sync 的 pendingUpdates 同款，
   * data.ts:1398-1413）：快照响应可能早于这些事件产生，直接整体替换会
   * 复活已投递/已取消的条目或抹掉刚到的入队条目。value 语义：
   *   SessionInboxInfo      → 入队（upsert）
   *   SessionInboxDelivery  → delivery 变更
   *   undefined             → 出队（delivered / cancelled）
   */
  private snapshotUpdates = new Map<string, Map<string, SessionInboxInfo | SessionInboxDelivery | undefined>>()

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): Map<string, SessionInboxInfo[]> => this.itemsBySession

  private emit() {
    this.listeners.forEach(listener => listener())
  }

  /** 快照拉取开始：此后到达的事件先记账，setItems 时合并 */
  beginSnapshot(sessionId: string) {
    this.snapshotUpdates.set(sessionId, new Map())
  }

  /** 快照拉取失败/放弃：丢弃记账，避免泄漏 */
  endSnapshot(sessionId: string) {
    this.snapshotUpdates.delete(sessionId)
  }

  private recordSnapshotUpdate(
    sessionId: string,
    inboxID: string,
    value: SessionInboxInfo | SessionInboxDelivery | undefined,
  ) {
    this.snapshotUpdates.get(sessionId)?.set(inboxID, value)
  }

  /**
   * inbox.list 快照打底（官方 pending.sync）。
   * 合并两段（官方 data.ts:1406-1429 同款）：
   *   1. beginSnapshot 后到达的事件增量——旧快照不得复活已投递/取消的条目
   *   2. options.keepIf 命中的既有条目——本地乐观 admit、回声未到的在途
   *      条目，快照（早于 admit 发出）天然不含它们，必须保留
   */
  setItems(sessionId: string, items: SessionInboxInfo[], options?: { keepIf?: (inboxID: string) => boolean }) {
    const merged = new Map(items.map(item => [item.id, item] as const))

    const updates = this.snapshotUpdates.get(sessionId)
    if (updates) {
      for (const [id, value] of updates) {
        if (value === undefined) merged.delete(id)
        else if (typeof value === 'string') {
          const existing = merged.get(id)
          if (existing) merged.set(id, { ...existing, delivery: value })
        } else merged.set(id, value)
      }
      this.snapshotUpdates.delete(sessionId)
    }

    const keepIf = options?.keepIf
    if (keepIf) {
      for (const item of this.itemsBySession.get(sessionId) ?? EMPTY_ITEMS) {
        if (!merged.has(item.id) && keepIf(item.id)) merged.set(item.id, item)
      }
    }

    const next = [...merged.values()]
    this.itemsBySession = new Map(this.itemsBySession)
    if (next.length === 0) this.itemsBySession.delete(sessionId)
    else this.itemsBySession.set(sessionId, next)
    this.emit()
  }

  /** enqueued：新条目入队（同 id 覆盖，与官方 admitLocal 一致） */
  upsertItem(sessionId: string, item: SessionInboxInfo) {
    this.recordSnapshotUpdate(sessionId, item.id, item)
    const current = this.itemsBySession.get(sessionId) ?? EMPTY_ITEMS
    const at = current.findIndex(entry => entry.id === item.id)
    const next = at < 0 ? [...current, item] : current.map((entry, index) => (index === at ? item : entry))
    this.itemsBySession = new Map(this.itemsBySession).set(sessionId, next)
    this.emit()
  }

  /** delivered / cancelled：条目出队 */
  removeItem(sessionId: string, inboxID: string) {
    this.recordSnapshotUpdate(sessionId, inboxID, undefined)
    const current = this.itemsBySession.get(sessionId)
    if (!current?.some(entry => entry.id === inboxID)) return
    const next = current.filter(entry => entry.id !== inboxID)
    this.itemsBySession = new Map(this.itemsBySession)
    if (next.length === 0) this.itemsBySession.delete(sessionId)
    else this.itemsBySession.set(sessionId, next)
    this.emit()
  }

  /** delivery.changed：queue ↔ steer 切换 */
  updateDelivery(sessionId: string, inboxID: string, delivery: SessionInboxDelivery) {
    this.recordSnapshotUpdate(sessionId, inboxID, delivery)
    const current = this.itemsBySession.get(sessionId)
    const at = current?.findIndex(entry => entry.id === inboxID) ?? -1
    if (!current || at < 0 || current[at].delivery === delivery) return
    const next = current.map((entry, index) => (index === at ? { ...entry, delivery } : entry))
    this.itemsBySession = new Map(this.itemsBySession).set(sessionId, next)
    this.emit()
  }

  /**
   * revert.committed：丢弃边界之后的入队条目（官方 data.ts:1079-1084
   * 同款——projector 删掉了 id >= to 的消息，这些条目不会收到 cancel
   * 事件，只能按边界过滤掉）
   */
  dropFromBoundary(sessionId: string, boundaryId: string) {
    const current = this.itemsBySession.get(sessionId)
    if (!current) return
    const next = current.filter(entry => entry.id < boundaryId)
    if (next.length === current.length) return
    for (const entry of current) {
      if (entry.id >= boundaryId) this.recordSnapshotUpdate(sessionId, entry.id, undefined)
    }
    this.itemsBySession = new Map(this.itemsBySession)
    if (next.length === 0) this.itemsBySession.delete(sessionId)
    else this.itemsBySession.set(sessionId, next)
    this.emit()
  }

  getItems(sessionId: string | null): SessionInboxInfo[] {
    if (!sessionId) return EMPTY_ITEMS
    return this.itemsBySession.get(sessionId) ?? EMPTY_ITEMS
  }

  clearSession(sessionId: string) {
    this.snapshotUpdates.delete(sessionId)
    if (!this.itemsBySession.has(sessionId)) return
    this.itemsBySession = new Map(this.itemsBySession)
    this.itemsBySession.delete(sessionId)
    this.emit()
  }

  reset() {
    this.itemsBySession = new Map()
    this.snapshotUpdates = new Map()
    this.emit()
  }
}

export const inboxStore = new InboxStore()
export type { QueuedUserPrompt }

/** 官方 queuedPromptText 同款：优先 metadata.displayText */
export function queuedPromptText(item: QueuedUserPrompt): string {
  const display = item.payload.metadata?.['displayText']
  return typeof display === 'string' && display.length > 0 ? display : item.payload.text
}

/** 会话 inbox 里的全部用户 prompt（queue + steer 两组，交付语义见 SessionInboxDelivery） */
export function useInboxUserPrompts(sessionId: string | null): QueuedUserPrompt[] {
  const snapshot = useSyncExternalStore(inboxStore.subscribe, inboxStore.getSnapshot)
  return useMemo(() => {
    if (!sessionId) return EMPTY_QUEUE
    return (snapshot.get(sessionId) ?? EMPTY_ITEMS).filter((item): item is QueuedUserPrompt => item.type === 'user')
  }, [sessionId, snapshot])
}

/** 队列视图：只含排队中的用户 prompt（官方 queue.ts 的同款过滤） */
export function useInboxQueue(sessionId: string | null): QueuedUserPrompt[] {
  const items = useInboxUserPrompts(sessionId)
  return useMemo(() => items.filter(item => item.delivery === 'queue'), [items])
}
