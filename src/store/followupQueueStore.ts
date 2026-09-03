import { useMemo, useSyncExternalStore } from 'react'
import type { Attachment } from '../features/attachment'

export interface QueuedFollowupDraft {
  id: string
  sessionId: string
  directory: string
  text: string
  attachments: Attachment[]
  model: {
    providerID: string
    modelID: string
    variant?: string
  }
  variant?: string
  agent?: string
  createdAt: number
}

interface FollowupQueueState {
  itemsBySession: Record<string, QueuedFollowupDraft[] | undefined>
  failedBySession: Record<string, string | undefined>
  sendingBySession: Record<string, string | undefined>
}

const EMPTY_ITEMS: QueuedFollowupDraft[] = []

function cloneAttachments(attachments: Attachment[]): Attachment[] {
  return attachments.map(attachment => ({
    ...attachment,
    textRange: attachment.textRange ? { ...attachment.textRange } : undefined,
    originalSource: attachment.originalSource
      ? {
          ...attachment.originalSource,
          text: attachment.originalSource.text ? { ...attachment.originalSource.text } : undefined,
          range: attachment.originalSource.range
            ? {
                start: { ...attachment.originalSource.range.start },
                end: attachment.originalSource.range.end ? { ...attachment.originalSource.range.end } : undefined,
              }
            : undefined,
        }
      : undefined,
  }))
}

class FollowupQueueStore {
  private state: FollowupQueueState = {
    itemsBySession: {},
    failedBySession: {},
    sendingBySession: {},
  }

  private listeners = new Set<() => void>()

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): FollowupQueueState => this.state

  private emit() {
    this.listeners.forEach(listener => listener())
  }

  private setState(next: FollowupQueueState) {
    this.state = next
    this.emit()
  }

  enqueue(
    draft: Omit<QueuedFollowupDraft, 'id' | 'createdAt' | 'attachments'> & { attachments: Attachment[] },
  ): QueuedFollowupDraft {
    const queued: QueuedFollowupDraft = {
      ...draft,
      id: `queued_${crypto.randomUUID().replace(/-/g, '')}`,
      createdAt: Date.now(),
      attachments: cloneAttachments(draft.attachments),
      model: { ...draft.model },
    }

    const current = this.state.itemsBySession[queued.sessionId] ?? EMPTY_ITEMS
    this.setState({
      ...this.state,
      itemsBySession: {
        ...this.state.itemsBySession,
        [queued.sessionId]: [...current, queued],
      },
    })

    return queued
  }

  remove(sessionId: string, id: string) {
    const current = this.state.itemsBySession[sessionId] ?? EMPTY_ITEMS
    if (current.length === 0) return

    const nextItems = current.filter(item => item.id !== id)
    const nextItemsBySession = { ...this.state.itemsBySession }
    if (nextItems.length === 0) delete nextItemsBySession[sessionId]
    else nextItemsBySession[sessionId] = nextItems

    const nextFailedBySession = { ...this.state.failedBySession }
    if (nextFailedBySession[sessionId] === id) delete nextFailedBySession[sessionId]

    const nextSendingBySession = { ...this.state.sendingBySession }
    if (nextSendingBySession[sessionId] === id) delete nextSendingBySession[sessionId]

    this.setState({
      itemsBySession: nextItemsBySession,
      failedBySession: nextFailedBySession,
      sendingBySession: nextSendingBySession,
    })
  }

  /** Move draggedId to the index currently occupied by targetId (same semantics as directory reorder). */
  reorder(sessionId: string, draggedId: string, targetId: string) {
    if (draggedId === targetId) return
    const current = this.state.itemsBySession[sessionId] ?? EMPTY_ITEMS
    if (current.length < 2) return

    const draggedIndex = current.findIndex(item => item.id === draggedId)
    const targetIndex = current.findIndex(item => item.id === targetId)
    if (draggedIndex === -1 || targetIndex === -1 || draggedIndex === targetIndex) return

    const next = [...current]
    const [dragged] = next.splice(draggedIndex, 1)
    next.splice(targetIndex, 0, dragged)

    this.setState({
      ...this.state,
      itemsBySession: {
        ...this.state.itemsBySession,
        [sessionId]: next,
      },
    })
  }

  markFailed(sessionId: string, id: string | undefined) {
    const nextFailedBySession = { ...this.state.failedBySession }
    if (!id) delete nextFailedBySession[sessionId]
    else nextFailedBySession[sessionId] = id

    this.setState({
      ...this.state,
      failedBySession: nextFailedBySession,
    })
  }

  clearFailed(sessionId: string) {
    if (!this.state.failedBySession[sessionId]) return
    const nextFailedBySession = { ...this.state.failedBySession }
    delete nextFailedBySession[sessionId]

    this.setState({
      ...this.state,
      failedBySession: nextFailedBySession,
    })
  }

  startSending(sessionId: string, id: string): boolean {
    if (this.state.sendingBySession[sessionId]) return false

    this.setState({
      ...this.state,
      sendingBySession: {
        ...this.state.sendingBySession,
        [sessionId]: id,
      },
    })

    return true
  }

  finishSending(sessionId: string, id: string) {
    if (this.state.sendingBySession[sessionId] !== id) return

    const nextSendingBySession = { ...this.state.sendingBySession }
    delete nextSendingBySession[sessionId]

    this.setState({
      ...this.state,
      sendingBySession: nextSendingBySession,
    })
  }

  getItems(sessionId: string | null): QueuedFollowupDraft[] {
    if (!sessionId) return EMPTY_ITEMS
    return this.state.itemsBySession[sessionId] ?? EMPTY_ITEMS
  }

  getItem(sessionId: string, id: string): QueuedFollowupDraft | undefined {
    return this.getItems(sessionId).find(item => item.id === id)
  }

  clearSession(sessionId: string) {
    const hasItems = !!this.state.itemsBySession[sessionId]
    const hasFailed = !!this.state.failedBySession[sessionId]
    const hasSending = !!this.state.sendingBySession[sessionId]
    if (!hasItems && !hasFailed && !hasSending) return

    const nextItemsBySession = { ...this.state.itemsBySession }
    delete nextItemsBySession[sessionId]
    const nextFailedBySession = { ...this.state.failedBySession }
    delete nextFailedBySession[sessionId]
    const nextSendingBySession = { ...this.state.sendingBySession }
    delete nextSendingBySession[sessionId]

    this.setState({
      itemsBySession: nextItemsBySession,
      failedBySession: nextFailedBySession,
      sendingBySession: nextSendingBySession,
    })
  }

  getSessionIds(): string[] {
    return Object.keys(this.state.itemsBySession)
  }

  reset() {
    this.setState({
      itemsBySession: {},
      failedBySession: {},
      sendingBySession: {},
    })
  }
}

export const followupQueueStore = new FollowupQueueStore()

export function useFollowupQueue(sessionId: string | null) {
  const state = useSyncExternalStore(followupQueueStore.subscribe, followupQueueStore.getSnapshot)

  return useMemo(
    () => ({
      items: sessionId ? (state.itemsBySession[sessionId] ?? EMPTY_ITEMS) : EMPTY_ITEMS,
      failedId: sessionId ? state.failedBySession[sessionId] : undefined,
      sendingId: sessionId ? state.sendingBySession[sessionId] : undefined,
    }),
    [sessionId, state],
  )
}
