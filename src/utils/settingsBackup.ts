import type { NotificationType } from '../store/notificationStore'
import { soundStore, type BackupCustomAudioMap } from '../store/soundStore'

const BACKUP_KIND = 'settings-backup'
const BACKUP_SCHEMA_VERSION = 1

const MANAGED_LOCAL_STORAGE_KEYS = new Set([
  'notifications-enabled',
  'i18nextLng',
  'theme-preset',
  'theme-mode',
  'theme-custom-css',
  'theme-custom-css-snippets',
  'theme-active-custom-css-snippet-id',
  'collapse-user-messages',
  'step-finish-display',
  'completed-at-format',
  'reasoning-display-mode',
  'chat-wide-mode',
  'diff-style',
  'descriptive-tool-steps',
  'inline-tool-requests',
  'code-word-wrap',
  'font-scale',
  'code-font-scale',
  'tool-card-style',
  'immersive-mode',
  'compact-inline-permission',
  'glass-effect',
  'queue-followup-messages',
  'opencode-wake-lock',
  'opencode-sidebar-expanded',
  'opencode-sidebar-folder-recents',
  'opencode-sidebar-folder-recents-show-diff',
  'opencode-sidebar-show-child-sessions',
  'opencode-panel-layout',
  'opencode-terminal-layout',
  'opencode-right-panel-width',
  'opencode-bottom-panel-height',
  'opencode-servers',
  'opencode-active-server',
  'opencode-keybindings',
  'opencode-auto-start-service',
  'opencode-binary-path',
  'opencode-service-env-vars',
  'opencode:sound-settings',
  'opencode:notification-event-settings',
  'opencode:toast-enabled',
  'opencode:update-check',
])

const MANAGED_LOCAL_STORAGE_PREFIXES = ['srv:']
const MANAGED_SESSION_STORAGE_KEYS = new Set(['opencode-active-server'])
const AUDIO_TYPES: NotificationType[] = ['completed', 'permission', 'question', 'error']

export interface SettingsBackupFile {
  app: 'OpenCodeUI'
  kind: typeof BACKUP_KIND
  schemaVersion: typeof BACKUP_SCHEMA_VERSION
  createdAt: string
  localStorage: Record<string, string>
  sessionStorage: Record<string, string>
  customAudio: BackupCustomAudioMap
}

function isManagedStorageKey(key: string): boolean {
  return MANAGED_LOCAL_STORAGE_KEYS.has(key) || MANAGED_LOCAL_STORAGE_PREFIXES.some(prefix => key.startsWith(prefix))
}

function isManagedSessionStorageKey(key: string): boolean {
  return MANAGED_SESSION_STORAGE_KEYS.has(key)
}

function collectManagedLocalStorage(): Record<string, string> {
  const collected: Record<string, string> = {}

  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (!key || !isManagedStorageKey(key)) continue
    const value = localStorage.getItem(key)
    if (value !== null) {
      collected[key] = value
    }
  }

  return collected
}

function clearManagedLocalStorage(): void {
  const keysToRemove: string[] = []

  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (key && isManagedStorageKey(key)) {
      keysToRemove.push(key)
    }
  }

  for (const key of keysToRemove) {
    localStorage.removeItem(key)
  }
}

function collectManagedSessionStorage(): Record<string, string> {
  const collected: Record<string, string> = {}

  for (let index = 0; index < sessionStorage.length; index += 1) {
    const key = sessionStorage.key(index)
    if (!key || !isManagedSessionStorageKey(key)) continue
    const value = sessionStorage.getItem(key)
    if (value !== null) {
      collected[key] = value
    }
  }

  return collected
}

function clearManagedSessionStorage(): void {
  const keysToRemove: string[] = []

  for (let index = 0; index < sessionStorage.length; index += 1) {
    const key = sessionStorage.key(index)
    if (key && isManagedSessionStorageKey(key)) {
      keysToRemove.push(key)
    }
  }

  for (const key of keysToRemove) {
    sessionStorage.removeItem(key)
  }
}

function normalizeCustomAudio(raw: unknown): BackupCustomAudioMap {
  if (!raw || typeof raw !== 'object') return {}

  const normalized: BackupCustomAudioMap = {}
  const entries = raw as Record<string, unknown>

  for (const type of AUDIO_TYPES) {
    const value = entries[type]
    if (!value || typeof value !== 'object') continue
    const item = value as Record<string, unknown>
    if (typeof item.base64 !== 'string' || typeof item.mimeType !== 'string') continue
    normalized[type] = {
      base64: item.base64,
      mimeType: item.mimeType,
      fileName: typeof item.fileName === 'string' ? item.fileName : undefined,
    }
  }

  return normalized
}

function normalizeBackupFile(raw: unknown): SettingsBackupFile {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid backup file')
  }

  const parsed = raw as Record<string, unknown>
  if (parsed.kind !== BACKUP_KIND || parsed.schemaVersion !== BACKUP_SCHEMA_VERSION) {
    throw new Error('Unsupported backup format')
  }

  const rawLocalStorage = parsed.localStorage
  if (!rawLocalStorage || typeof rawLocalStorage !== 'object') {
    throw new Error('Missing backup settings data')
  }

  const rawSessionStorage = parsed.sessionStorage

  const localStorageEntries: Record<string, string> = {}
  for (const [key, value] of Object.entries(rawLocalStorage as Record<string, unknown>)) {
    if (!isManagedStorageKey(key) || typeof value !== 'string') continue
    localStorageEntries[key] = value
  }

  const sessionStorageEntries: Record<string, string> = {}
  if (rawSessionStorage && typeof rawSessionStorage === 'object') {
    for (const [key, value] of Object.entries(rawSessionStorage as Record<string, unknown>)) {
      if (!isManagedSessionStorageKey(key) || typeof value !== 'string') continue
      sessionStorageEntries[key] = value
    }
  }

  return {
    app: 'OpenCodeUI',
    kind: BACKUP_KIND,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : new Date().toISOString(),
    localStorage: localStorageEntries,
    sessionStorage: sessionStorageEntries,
    customAudio: normalizeCustomAudio(parsed.customAudio),
  }
}

function buildBackupFileName(createdAt: string): string {
  const safeTimestamp = createdAt.replace(/[:]/g, '-').replace(/\.\d+Z$/, 'Z')
  return `opencodeui-settings-backup-${safeTimestamp}.json`
}

export async function exportSettingsBackup(): Promise<{ fileName: string; data: Uint8Array }> {
  const createdAt = new Date().toISOString()
  const backup: SettingsBackupFile = {
    app: 'OpenCodeUI',
    kind: BACKUP_KIND,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    createdAt,
    localStorage: collectManagedLocalStorage(),
    sessionStorage: collectManagedSessionStorage(),
    customAudio: await soundStore.exportCustomAudioForBackup(),
  }

  return {
    fileName: buildBackupFileName(createdAt),
    data: new TextEncoder().encode(`${JSON.stringify(backup, null, 2)}\n`),
  }
}

export async function importSettingsBackup(file: File): Promise<void> {
  const text = await file.text()
  let parsed: unknown

  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Invalid backup file')
  }

  const backup = normalizeBackupFile(parsed)

  clearManagedLocalStorage()
  for (const [key, value] of Object.entries(backup.localStorage)) {
    localStorage.setItem(key, value)
  }

  clearManagedSessionStorage()
  for (const [key, value] of Object.entries(backup.sessionStorage)) {
    sessionStorage.setItem(key, value)
  }

  await soundStore.importCustomAudioFromBackup(backup.customAudio)
}

export function previewBackupMeta(file: File): Promise<{ createdAt: string | null }> {
  return file.text().then(text => {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>
      return { createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : null }
    } catch {
      return { createdAt: null }
    }
  })
}
