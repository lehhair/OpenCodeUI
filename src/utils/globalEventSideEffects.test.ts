import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { claimGlobalSideEffect, claimGlobalSideEffectLocked } from './globalEventSideEffects'

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

  it('serializes sound claims through Web Locks when available', async () => {
    const requestMock = vi.fn((_name, _options, callback) => Promise.resolve(callback(null)))
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: { request: requestMock },
    })

    const first = await claimGlobalSideEffectLocked('sound:permission:request-1', 1000)
    const second = await claimGlobalSideEffectLocked('sound:permission:request-1', 1000)

    expect(first).toBe(true)
    expect(second).toBe(false)
    expect(requestMock).toHaveBeenCalledTimes(2)
    expect(requestMock).toHaveBeenCalledWith(
      'opencode:global-side-effect-lock:sound:permission:request-1',
      { mode: 'exclusive' },
      expect.any(Function),
    )
  })

  it('falls back to localStorage claims when Web Locks are unavailable', async () => {
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: undefined,
    })

    const first = claimGlobalSideEffectLocked('sound:question:request-1', 1000)
    vi.advanceTimersByTime(25)

    await expect(first).resolves.toBe(true)
    await expect(claimGlobalSideEffectLocked('sound:question:request-1', 1000)).resolves.toBe(false)
  })

  it('does not claim locked fallback sound when another window overwrites the token before confirmation', async () => {
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: undefined,
    })

    const claim = claimGlobalSideEffectLocked('sound:completed:session-1', 1000)
    localStorage.setItem(
      'opencode:global-side-effect:sound:completed:session-1',
      JSON.stringify({ token: 'other-window', expiresAt: Date.now() + 1000 }),
    )
    vi.advanceTimersByTime(25)

    await expect(claim).resolves.toBe(false)
  })
})
