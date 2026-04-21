import { useSyncExternalStore } from 'react'

export interface UpdateRelease {
  version: string
  tagName: string
  url: string
  publishedAt: string | null
  name: string | null
}

export interface UpdateState {
  currentVersion: string
  latestRelease: UpdateRelease | null
  lastCheckedAt: number | null
  dismissedVersion: string | null
  hiddenToastVersion: string | null
  checking: boolean
  error: string | null
}

interface PersistedUpdateState {
  latestRelease: UpdateRelease | null
  lastCheckedAt: number | null
  dismissedVersion: string | null
}

export interface UpdateSettingsBackup {
  latestRelease: UpdateRelease | null
  lastCheckedAt: number | null
  dismissedVersion: string | null
}

type Subscriber = () => void

const STORAGE_KEY = 'opencode:update-check'
const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000
export const RELEASES_API_URL = 'https://api.github.com/repos/lehhair/OpenCodeUI/releases/latest'
export const RELEASES_PAGE_URL = 'https://github.com/lehhair/OpenCodeUI/releases/latest'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, '').replace(/-.+$/, '')
}

export function compareVersions(a: string, b: string): number {
  const left = normalizeVersion(a)
    .split('.')
    .map(part => Number.parseInt(part, 10) || 0)
  const right = normalizeVersion(b)
    .split('.')
    .map(part => Number.parseInt(part, 10) || 0)
  const length = Math.max(left.length, right.length)

  for (let i = 0; i < length; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0)
    if (diff !== 0) return diff
  }

  return 0
}

export function hasUpdateAvailable(state: UpdateState): boolean {
  return !!state.latestRelease && compareVersions(state.latestRelease.version, state.currentVersion) > 0
}

export function shouldShowUpdateToast(state: UpdateState): boolean {
  if (!state.latestRelease || !hasUpdateAvailable(state)) return false
  if (state.dismissedVersion === state.latestRelease.version) return false
  if (state.hiddenToastVersion === state.latestRelease.version) return false
  return true
}

function loadPersistedState(): PersistedUpdateState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return { latestRelease: null, lastCheckedAt: null, dismissedVersion: null }
    }

    const parsed = JSON.parse(raw) as PersistedUpdateState
    return {
      latestRelease: parsed?.latestRelease ?? null,
      lastCheckedAt: typeof parsed?.lastCheckedAt === 'number' ? parsed.lastCheckedAt : null,
      dismissedVersion: typeof parsed?.dismissedVersion === 'string' ? parsed.dismissedVersion : null,
    }
  } catch {
    return { latestRelease: null, lastCheckedAt: null, dismissedVersion: null }
  }
}

function persistState(state: UpdateState): void {
  try {
    const payload: PersistedUpdateState = {
      latestRelease: state.latestRelease,
      lastCheckedAt: state.lastCheckedAt,
      dismissedVersion: state.dismissedVersion,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // Ignore storage write failures.
  }
}

function parseRelease(payload: unknown): UpdateRelease {
  if (!isPlainObject(payload)) {
    throw new Error('Invalid release payload')
  }

  const tagName = typeof payload.tag_name === 'string' ? payload.tag_name : ''
  const htmlUrl = typeof payload.html_url === 'string' ? payload.html_url : RELEASES_PAGE_URL

  if (!tagName) {
    throw new Error('Missing release tag')
  }

  return {
    version: normalizeVersion(tagName),
    tagName,
    url: htmlUrl,
    publishedAt: typeof payload.published_at === 'string' ? payload.published_at : null,
    name: typeof payload.name === 'string' ? payload.name : null,
  }
}

function getDefaultCurrentVersion(): string {
  try {
    return __APP_VERSION__
  } catch {
    return '0.0.0'
  }
}

export class UpdateStore {
  private state: UpdateState
  private subscribers = new Set<Subscriber>()
  private inflightCheck: Promise<void> | null = null

  constructor(currentVersion?: string) {
    const persisted = loadPersistedState()
    this.state = {
      currentVersion: normalizeVersion(currentVersion ?? getDefaultCurrentVersion()),
      latestRelease: persisted.latestRelease,
      lastCheckedAt: persisted.lastCheckedAt,
      dismissedVersion: persisted.dismissedVersion,
      hiddenToastVersion: null,
      checking: false,
      error: null,
    }
  }

  subscribe = (callback: Subscriber): (() => void) => {
    this.subscribers.add(callback)
    return () => this.subscribers.delete(callback)
  }

  getSnapshot = (): UpdateState => this.state

  private notify(): void {
    this.subscribers.forEach(callback => callback())
  }

  private setState(nextState: UpdateState): void {
    this.state = nextState
    persistState(this.state)
    this.notify()
  }

  private applyRelease(release: UpdateRelease, checkedAt: number): void {
    const previousVersion = this.state.latestRelease?.version ?? null
    this.setState({
      ...this.state,
      latestRelease: release,
      lastCheckedAt: checkedAt,
      hiddenToastVersion: previousVersion && previousVersion !== release.version ? null : this.state.hiddenToastVersion,
      checking: false,
      error: null,
    })
  }

  async checkForUpdates(options?: { force?: boolean }): Promise<void> {
    if (this.inflightCheck) return this.inflightCheck

    const force = options?.force === true
    const now = Date.now()
    const isFresh =
      !force && typeof this.state.lastCheckedAt === 'number' && now - this.state.lastCheckedAt < CHECK_INTERVAL_MS

    if (isFresh) return

    this.state = {
      ...this.state,
      checking: true,
      error: null,
    }
    this.notify()

    this.inflightCheck = (async () => {
      try {
        const response = await fetch(RELEASES_API_URL, {
          headers: { Accept: 'application/vnd.github+json' },
        })
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }

        const payload = await response.json()
        const release = parseRelease(payload)
        this.applyRelease(release, now)
      } catch (error) {
        this.state = {
          ...this.state,
          checking: false,
          error: error instanceof Error ? error.message : 'Failed to check updates',
        }
        this.notify()
      } finally {
        this.inflightCheck = null
      }
    })()

    return this.inflightCheck
  }

  hideToastForCurrentVersion(): void {
    if (!this.state.latestRelease) return
    this.state = {
      ...this.state,
      hiddenToastVersion: this.state.latestRelease.version,
    }
    this.notify()
  }

  dismissCurrentVersion(): void {
    if (!this.state.latestRelease) return
    this.setState({
      ...this.state,
      dismissedVersion: this.state.latestRelease.version,
      hiddenToastVersion: this.state.latestRelease.version,
    })
  }
}

export const updateStore = new UpdateStore()

export function exportUpdateSettingsBackup(): UpdateSettingsBackup {
  const state = updateStore.getSnapshot()
  return {
    latestRelease: state.latestRelease,
    lastCheckedAt: state.lastCheckedAt,
    dismissedVersion: state.dismissedVersion,
  }
}

export function importUpdateSettingsBackup(raw: unknown): void {
  const parsed = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : undefined
  const payload: PersistedUpdateState = {
    latestRelease:
      parsed?.latestRelease && typeof parsed.latestRelease === 'object'
        ? (parsed.latestRelease as UpdateRelease)
        : null,
    lastCheckedAt: typeof parsed?.lastCheckedAt === 'number' ? parsed.lastCheckedAt : null,
    dismissedVersion: typeof parsed?.dismissedVersion === 'string' ? parsed.dismissedVersion : null,
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
}

export function useUpdateStore(): UpdateState {
  return useSyncExternalStore(updateStore.subscribe, updateStore.getSnapshot, updateStore.getSnapshot)
}
