import { useSyncExternalStore } from 'react'

export interface PaneControllerState {
  paneId: string
  sessionId: string | null
  effectiveDirectory: string
  contextLimit?: number
  isStreaming: boolean
  newSession: () => void
  archiveSession: () => void
  previousSession: () => void
  nextSession: () => void
  toggleAgent: () => void
  copyLastResponse: () => void
  cancelMessage: () => void
  openModelSelector: () => void
  toggleFullAuto: () => void
}

type Listener = () => void

function isSameController(a: PaneControllerState | undefined, b: PaneControllerState): boolean {
  if (!a) return false
  return (
    a.paneId === b.paneId &&
    a.sessionId === b.sessionId &&
    a.effectiveDirectory === b.effectiveDirectory &&
    a.contextLimit === b.contextLimit &&
    a.isStreaming === b.isStreaming &&
    a.newSession === b.newSession &&
    a.archiveSession === b.archiveSession &&
    a.previousSession === b.previousSession &&
    a.nextSession === b.nextSession &&
    a.toggleAgent === b.toggleAgent &&
    a.copyLastResponse === b.copyLastResponse &&
    a.cancelMessage === b.cancelMessage &&
    a.openModelSelector === b.openModelSelector &&
    a.toggleFullAuto === b.toggleFullAuto
  )
}

class PaneControllerStore {
  private controllers = new Map<string, PaneControllerState>()
  private listeners = new Set<Listener>()
  private snapshot: PaneControllerState[] = []

  subscribe(listener: Listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify() {
    for (const listener of this.listeners) listener()
  }

  private rebuildSnapshot() {
    this.snapshot = Array.from(this.controllers.values())
  }

  setController(paneId: string, controller: PaneControllerState) {
    const prev = this.controllers.get(paneId)
    if (isSameController(prev, controller)) return
    this.controllers.set(paneId, controller)
    this.rebuildSnapshot()
    this.notify()
  }

  removeController(paneId: string) {
    if (!this.controllers.has(paneId)) return
    this.controllers.delete(paneId)
    this.rebuildSnapshot()
    this.notify()
  }

  getController(paneId: string | null | undefined): PaneControllerState | null {
    if (!paneId) return null
    return this.controllers.get(paneId) ?? null
  }

  getControllers(): PaneControllerState[] {
    return this.snapshot
  }
}

export const paneControllerStore = new PaneControllerStore()

export function usePaneController(paneId: string | null | undefined): PaneControllerState | null {
  return useSyncExternalStore(
    listener => paneControllerStore.subscribe(listener),
    () => paneControllerStore.getController(paneId),
    () => paneControllerStore.getController(paneId),
  )
}

export function usePaneControllers(): PaneControllerState[] {
  return useSyncExternalStore(
    listener => paneControllerStore.subscribe(listener),
    () => paneControllerStore.getControllers(),
    () => paneControllerStore.getControllers(),
  )
}
