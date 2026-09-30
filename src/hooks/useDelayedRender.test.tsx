import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useDelayedRender } from './useDelayedRender'

describe('useDelayedRender', () => {
  it('renders immediately when shown', () => {
    const { result } = renderHook(() => useDelayedRender(true))
    expect(result.current).toBe(true)
  })

  it('keeps rendering briefly before hiding', () => {
    vi.useFakeTimers()

    const { result, rerender } = renderHook(({ show }) => useDelayedRender(show, 200), {
      initialProps: { show: true },
    })

    rerender({ show: false })
    expect(result.current).toBe(true)

    act(() => {
      vi.advanceTimersByTime(199)
    })
    expect(result.current).toBe(true)

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current).toBe(false)

    vi.useRealTimers()
  })

  it('becomes visible again immediately when reopened', () => {
    vi.useFakeTimers()

    const { result, rerender } = renderHook(({ show }) => useDelayedRender(show, 200), {
      initialProps: { show: false },
    })

    expect(result.current).toBe(false)

    rerender({ show: true })
    expect(result.current).toBe(true)

    vi.useRealTimers()
  })

  it('delays mount when mountDelayMs is set', () => {
    vi.useFakeTimers()

    const { result, rerender } = renderHook(({ show }) => useDelayedRender(show, 200, { mountDelayMs: 16 }), {
      initialProps: { show: false },
    })

    expect(result.current).toBe(false)

    rerender({ show: true })
    expect(result.current).toBe(false)

    act(() => {
      vi.advanceTimersByTime(15)
    })
    expect(result.current).toBe(false)

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current).toBe(true)

    vi.useRealTimers()
  })
})
