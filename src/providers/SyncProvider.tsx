import { createContext, useContext, useEffect, useCallback, type ReactNode } from 'react'
import { syncService } from '../services/syncService'

/**
 * Syncable global settings keys (stored directly in localStorage)
 */
const GLOBAL_SYNC_KEYS = [
  // Theme settings
  'theme-preset',
  'theme-mode',
  'theme-custom-css',
  'diff-style',
  'reasoning-display-mode',

  // Chat display settings
  'chat-wide-mode',
  'collapse-user-messages',
  'step-finish-display',
  'tool-card-style',
  'compact-inline-permission',

  // Layout settings
  'opencode-sidebar-expanded',
  'opencode-sidebar-folder-recents',
  'opencode-right-panel-width',
  'opencode-bottom-panel-height',
  'sidebar-width',

  // Editor settings
  'descriptive-tool-steps',
  'inline-tool-requests',
  'code-word-wrap',
  'immersive-mode',

  // Keybindings
  'opencode-keybindings',

  // Notifications
  'notifications-enabled',
  'opencode:toast-enabled',

  // Sound
  'opencode:sound-settings',

  // Server config (password stripped before sync)
  'opencode-servers',

  // Service settings
  'opencode-auto-start-service',
  'opencode-binary-path',
  'opencode-service-env-vars',
] as const

/**
 * Syncable per-server settings key suffixes (prefixed with `srv:{serverId}:`)
 */
const PER_SERVER_SYNC_KEY_SUFFIXES = [
  'opencode-saved-directories',
  'opencode-recent-projects',
  'last-directory',
  'selected-model-key',
  'model-variant-prefs',
  'model-usage-stats',
  'model-pinned',
  'selected-agent',
  'selected-project-id',
  'opencode-path-mode',
  'opencode-detected-path-style',
  'opencode-auto-approve-enabled',
] as const

/**
 * Check if a key is a syncable settings key
 */
function isSyncableKey(key: string): boolean {
  // Check global keys
  if (GLOBAL_SYNC_KEYS.includes(key as (typeof GLOBAL_SYNC_KEYS)[number])) {
    return true
  }

  // Check per-server keys (prefix: srv:{serverId}:)
  if (key.startsWith('srv:')) {
    const suffix = key.substring(key.indexOf(':', 4) + 1) // Skip "srv:" and serverId
    return PER_SERVER_SYNC_KEY_SUFFIXES.includes(suffix as (typeof PER_SERVER_SYNC_KEY_SUFFIXES)[number])
  }

  return false
}

/**
 * Strip sensitive data (passwords) from opencode-servers value before syncing
 */
function stripSensitiveData(key: string, value: string): string {
  if (key !== 'opencode-servers') {
    return value
  }

  try {
    const servers = JSON.parse(value)
    if (!Array.isArray(servers)) {
      return value
    }

    // Strip auth.password from each server entry
    const sanitized = servers.map(server => {
      if (server.auth && typeof server.auth === 'object') {
        const { password: _, ...restAuth } = server.auth
        return { ...server, auth: restAuth }
      }
      return server
    })

    return JSON.stringify(sanitized)
  } catch {
    // If parsing fails, return original value
    return value
  }
}

interface SyncContextValue {
  /**
   * Push a local change to sync
   */
  pushChange: (key: string, value: string) => void
}

const SyncContext = createContext<SyncContextValue | null>(null)

interface SyncProviderProps {
  children: ReactNode
}

/**
 * SyncProvider - Bridges SyncService to React components and stores
 *
 * - Starts syncService on mount, stops on unmount
 * - Listens for remote changes and applies to localStorage
 * - Dispatches 'sync-remote-change' custom events for stores to react
 */
export function SyncProvider({ children }: SyncProviderProps) {
  // Handle remote changes from sync service
  const handleRemoteChange = useCallback((changes: Map<string, string>) => {
    changes.forEach((value, key) => {
      // Only process syncable keys
      if (!isSyncableKey(key)) {
        return
      }

      // Apply to localStorage
      try {
        localStorage.setItem(key, value)
      } catch (err) {
        console.error('[SyncProvider] Failed to write to localStorage:', key, err)
        return
      }

      // Dispatch custom event for stores to react
      window.dispatchEvent(
        new CustomEvent('sync-remote-change', {
          detail: { key, value },
        }),
      )
    })
  }, [])

  // Start/stop sync service and subscribe to remote changes
  useEffect(() => {
    // Start sync service
    syncService.start()

    // Subscribe to remote changes
    const unsubscribe = syncService.onRemoteChange(handleRemoteChange)

    // Cleanup on unmount
    return () => {
      unsubscribe()
      syncService.stop()
    }
  }, [handleRemoteChange])

  // Push local change to sync
  const pushChange = useCallback((key: string, value: string) => {
    // Only sync syncable keys
    if (!isSyncableKey(key)) {
      return
    }

    // Strip sensitive data before pushing
    const sanitizedValue = stripSensitiveData(key, value)
    syncService.pushChange(key, sanitizedValue)
  }, [])

  const contextValue: SyncContextValue = {
    pushChange,
  }

  return <SyncContext.Provider value={contextValue}>{children}</SyncContext.Provider>
}

/**
 * Hook to access sync context
 */
export function useSync(): SyncContextValue {
  const context = useContext(SyncContext)
  if (!context) {
    throw new Error('useSync must be used within a SyncProvider')
  }
  return context
}

/**
 * Hook to push a local change to sync
 * Convenience wrapper around useSync().pushChange
 */
export function useSyncPush() {
  const { pushChange } = useSync()
  return pushChange
}
