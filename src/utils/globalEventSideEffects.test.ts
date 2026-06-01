import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { claimGlobalSideEffect } from './globalEventSideEffects'

describe('claimGlobalSideEffect', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    localStorage.clear()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('claims an unclaimed side effect and blocks duplicates during the ttl', () => {
    expect(claimGlobalSideEffect('sound:permission:request-1', 1000)).toBe(true)
    expect(claimGlobalSideEffect('sound:permission:request-1', 1000)).toBe(false)
  })

  it('allows a side effect again after the ttl expires', () => {
    expect(claimGlobalSideEffect('notification:completed:session-1', 1000)).toBe(true)

    vi.setSystemTime(new Date('2026-01-01T00:00:01.001Z'))

    expect(claimGlobalSideEffect('notification:completed:session-1', 1000)).toBe(true)
  })

  it('removes the stored claim after the ttl when this instance still owns it', () => {
    expect(claimGlobalSideEffect('notification:error:session-1', 1000)).toBe(true)
    expect(localStorage.getItem('opencode:global-side-effect:notification:error:session-1')).not.toBeNull()

    vi.advanceTimersByTime(1000)

    expect(localStorage.getItem('opencode:global-side-effect:notification:error:session-1')).toBeNull()
  })

  it('does not let delayed cleanup remove a newer claim for the same key', () => {
    expect(claimGlobalSideEffect('sound:completed:session-1', 1000)).toBe(true)

    vi.setSystemTime(new Date('2026-01-01T00:00:01.001Z'))
    expect(claimGlobalSideEffect('sound:completed:session-1', 5000)).toBe(true)

    vi.advanceTimersByTime(1000)

    expect(localStorage.getItem('opencode:global-side-effect:sound:completed:session-1')).not.toBeNull()
  })

  it('treats invalid stored data as unclaimed', () => {
    localStorage.setItem('opencode:global-side-effect:sound:question:request-1', '{not-json')

    expect(claimGlobalSideEffect('sound:question:request-1', 1000)).toBe(true)
  })

  it('preserves the side effect when localStorage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('storage unavailable')
      },
      setItem: () => {
        throw new Error('storage unavailable')
      },
      removeItem: () => {
        throw new Error('storage unavailable')
      },
      clear: () => undefined,
    })

    expect(claimGlobalSideEffect('sound:error:session-1', 1000)).toBe(true)
  })
})
