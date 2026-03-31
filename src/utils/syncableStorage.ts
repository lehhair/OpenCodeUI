/**
 * SyncableStorage - Utility for localStorage sync across devices
 *
 * Wraps localStorage.setItem with sync service integration.
 * Also provides a helper for listening to remote sync changes.
 */

import { syncService } from '../services/syncService'

/**
 * Set item in localStorage and push change to sync service
 */
export function syncableSetItem(key: string, value: string): void {
  localStorage.setItem(key, value)
  syncService.pushChange(key, value)
}

/**
 * Listen for remote sync changes on specific keys
 * Returns unsubscribe function
 */
export function onSyncRemoteChange(keys: string[], callback: () => void): () => void {
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<{ key: string }>).detail
    if (keys.includes(detail.key)) {
      callback()
    }
  }
  window.addEventListener('sync-remote-change', handler)
  return () => window.removeEventListener('sync-remote-change', handler)
}

/**
 * SyncProvider dispatches this custom event when remote changes arrive.
 * Stores should listen for this to update their state.
 */
export function dispatchSyncRemoteChangeEvent(key: string): void {
  window.dispatchEvent(new CustomEvent('sync-remote-change', { detail: { key } }))
}
