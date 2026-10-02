import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RetryPartView } from './SystemPartViews'
import type { RetryInfo } from './SystemPartViews'

describe('SystemPartViews', () => {
  const retry: RetryInfo = {
    attempt: 2,
    at: Date.now(),
    error: { type: 'api', message: 'network timeout', status: 504 },
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb =>
      window.setTimeout(() => cb(performance.now()), 16),
    )
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => {
      clearTimeout(id)
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('toggles retry details with a semantic button', () => {
    render(<RetryPartView retry={retry} stateKey="message:message-1:retry:2" />)

    const toggle = screen.getByRole('button', { name: /Retry attempt 2/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(toggle)
    act(() => {
      vi.advanceTimersByTime(16)
    })

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('network timeout')).toBeInTheDocument()
  })
})
