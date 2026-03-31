import { serverStore, makeBasicAuthHeader } from '../store/serverStore'

type ChangeListener = (changes: Map<string, string>) => void

interface SyncResponse {
  version: number
  changes: Record<string, string>
}

interface SSEEvent {
  type: string
  data: string
}

/**
 * SyncService - Singleton managing multi-device settings sync
 *
 * Uses Server-Sent Events (SSE) for real-time push notifications
 * and differential sync for efficient data transfer.
 */
class SyncService {
  private static instance: SyncService | null = null

  // State
  private localVersion: number = 0
  private sse: ReadableStreamDefaultReader<Uint8Array> | null = null
  private pushTimer: ReturnType<typeof setTimeout> | null = null
  private pendingChanges: Map<string, string> = new Map()
  private listeners: Set<ChangeListener> = new Set()
  private retries: number = 0
  private running: boolean = false
  private abortController: AbortController | null = null

  private constructor() {
    // Singleton - use syncService export
  }

  static getInstance(): SyncService {
    if (!SyncService.instance) {
      SyncService.instance = new SyncService()
    }
    return SyncService.instance
  }

  // ============================================
  // Public API
  // ============================================

  /**
   * Start sync service - call on app mount
   */
  start(): void {
    if (this.running) return
    this.running = true
    this.retries = 0
    this.fullSync()
    this.connectSSE()
  }

  /**
   * Stop sync service - call on app unmount
   */
  stop(): void {
    this.running = false
    this.disconnectSSE()
    if (this.pushTimer) {
      clearTimeout(this.pushTimer)
      this.pushTimer = null
    }
    this.pendingChanges.clear()
  }

  /**
   * Register a change for sync (debounced push)
   */
  pushChange(key: string, value: string): void {
    this.pendingChanges.set(key, value)

    // Debounce: wait 500ms before flushing
    if (this.pushTimer) {
      clearTimeout(this.pushTimer)
    }
    this.pushTimer = setTimeout(() => {
      this.flush()
    }, 500)
  }

  /**
   * Subscribe to remote changes
   * Returns unsubscribe function
   */
  onRemoteChange(listener: ChangeListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Get current sync version
   */
  getVersion(): number {
    return this.localVersion
  }

  // ============================================
  // Private Implementation
  // ============================================

  /**
   * Initial full sync - fetch all settings
   */
  private async fullSync(): Promise<void> {
    try {
      const response = await this.syncFetch('GET', '/api/sync')
      if (!response.ok) {
        console.error('[SyncService] Full sync failed:', response.status)
        return
      }

      const data: SyncResponse = await response.json()
      this.localVersion = data.version

      // Notify listeners with all settings
      const changes = new Map(Object.entries(data.changes))
      if (changes.size > 0) {
        this.notifyListeners(changes)
      }

      console.log('[SyncService] Full sync complete, version:', this.localVersion)
    } catch (err) {
      console.error('[SyncService] Full sync error:', err)
    }
  }

  /**
   * SSE connection using fetch + ReadableStream
   * (EventSource cannot send auth headers)
   */
  private connectSSE(): void {
    if (!this.running) return

    const auth = serverStore.getActiveAuth()
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (auth) {
      headers['Authorization'] = makeBasicAuthHeader(auth)
    }

    this.abortController = new AbortController()

    fetch('/api/sync/sse', { headers, signal: this.abortController.signal })
      .then(response => {
        if (!response.ok) {
          throw new Error(`SSE connection failed: ${response.status}`)
        }
        if (!response.body) {
          throw new Error('SSE response has no body')
        }

        this.sse = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        const pump = (): Promise<void> => {
          return this.sse!.read().then(({ done, value }) => {
            if (done) {
              this.sse = null
              this.reconnectSSE()
              return
            }

            buffer += decoder.decode(value, { stream: true })

            // Split on double newline (SSE event boundary)
            const events = buffer.split('\n\n')
            buffer = events.pop() || ''

            for (const eventStr of events) {
              if (eventStr.trim()) {
                const event = this.parseSSEEvent(eventStr)
                this.handleSSEEvent(event)
              }
            }

            return pump()
          })
        }

        // Reset retry count on successful connection
        this.retries = 0
        return pump()
      })
      .catch(err => {
        if (err.name === 'AbortError') {
          console.log('[SyncService] SSE aborted')
          return
        }
        console.error('[SyncService] SSE error:', err)
        this.reconnectSSE()
      })
  }

  /**
   * Parse SSE event string into event object
   */
  private parseSSEEvent(eventStr: string): SSEEvent {
    const lines = eventStr.split('\n')
    let type = 'message'
    let data = ''

    for (const line of lines) {
      if (line.startsWith('event:')) {
        type = line.slice(6).trim()
      } else if (line.startsWith('data:')) {
        data = line.slice(5).trim()
      }
    }

    return { type, data }
  }

  /**
   * Handle SSE event
   */
  private handleSSEEvent(event: SSEEvent): void {
    if (event.type === 'connected') {
      try {
        const payload = JSON.parse(event.data)
        if (payload.version && payload.version > this.localVersion) {
          this.pullChanges(this.localVersion)
        }
      } catch {
        console.warn('[SyncService] Invalid connected event data')
      }
    } else if (event.type === 'change') {
      this.pullChanges(this.localVersion)
    }
  }

  /**
   * Disconnect SSE
   */
  private disconnectSSE(): void {
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }
    if (this.sse) {
      this.sse.cancel()
      this.sse = null
    }
  }

  /**
   * Reconnect SSE with exponential backoff
   */
  private reconnectSSE(): void {
    if (!this.running) return

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, max 30s
    const delay = Math.min(1000 * Math.pow(2, this.retries), 30000)
    this.retries++

    console.log(`[SyncService] Reconnecting in ${delay}ms (retry ${this.retries})`)

    setTimeout(() => {
      if (this.running) {
        this.connectSSE()
      }
    }, delay)
  }

  /**
   * Fetch differential changes since given version
   */
  private async pullChanges(sinceVersion: number): Promise<void> {
    try {
      const response = await this.syncFetch('GET', `/api/sync?v=${sinceVersion}`)
      if (!response.ok) {
        console.error('[SyncService] Pull changes failed:', response.status)
        return
      }

      const data: SyncResponse = await response.json()
      this.localVersion = data.version

      const changes = new Map(Object.entries(data.changes))
      if (changes.size > 0) {
        this.notifyListeners(changes)
      }

      console.log('[SyncService] Pulled changes, version:', this.localVersion)
    } catch (err) {
      console.error('[SyncService] Pull changes error:', err)
    }
  }

  /**
   * Flush pending changes to server
   */
  private async flush(): Promise<void> {
    if (this.pendingChanges.size === 0) return

    const changes = new Map(this.pendingChanges)
    this.pendingChanges.clear()

    try {
      const response = await this.syncFetch('POST', '/api/sync', {
        changes: Object.fromEntries(changes),
      })

      if (!response.ok) {
        console.error('[SyncService] Flush failed:', response.status)
        // Re-add failed changes for retry
        changes.forEach((value, key) => this.pendingChanges.set(key, value))
        return
      }

      const data = await response.json()
      this.localVersion = data.version

      console.log('[SyncService] Flushed changes, version:', this.localVersion)
    } catch (err) {
      console.error('[SyncService] Flush error:', err)
      // Re-add failed changes for retry
      changes.forEach((value, key) => this.pendingChanges.set(key, value))
    }
  }

  /**
   * Same-origin fetch helper with auth
   */
  private async syncFetch(method: string, path: string, body?: unknown): Promise<Response> {
    const auth = serverStore.getActiveAuth()
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (auth) {
      headers['Authorization'] = makeBasicAuthHeader(auth)
    }

    const init: RequestInit = {
      method,
      headers,
    }

    if (body) {
      init.body = JSON.stringify(body)
    }

    return fetch(path, init)
  }

  /**
   * Notify all listeners of changes
   */
  private notifyListeners(changes: Map<string, string>): void {
    this.listeners.forEach(listener => {
      try {
        listener(changes)
      } catch (err) {
        console.error('[SyncService] Listener error:', err)
      }
    })
  }
}

// Singleton export
export const syncService = SyncService.getInstance()
