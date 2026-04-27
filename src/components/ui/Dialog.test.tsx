import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Dialog } from './Dialog'

describe('Dialog', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders content and unmounts after close transition', () => {
    const onClose = vi.fn()
    const { rerender } = render(
      <Dialog isOpen={true} onClose={onClose} title="Test Dialog">
        <div>dialog body</div>
      </Dialog>,
    )

    expect(screen.getByRole('dialog', { name: 'Test Dialog' })).toBeInTheDocument()
    expect(screen.getByText('Test Dialog')).toBeInTheDocument()
    expect(screen.getByText('dialog body')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)

    rerender(
      <Dialog isOpen={false} onClose={onClose} title="Test Dialog">
        <div>dialog body</div>
      </Dialog>,
    )

    act(() => {
      vi.advanceTimersByTime(199)
    })
    expect(screen.getByText('dialog body')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.queryByText('dialog body')).not.toBeInTheDocument()
  })

  it('can close from touch backdrop when enabled', () => {
    const onClose = vi.fn()
    render(
      <Dialog isOpen={true} onClose={onClose} title="Test Dialog" allowTouchBackdropClose>
        <div>dialog body</div>
      </Dialog>,
    )

    const backdrop = screen.getByRole('dialog').parentElement
    expect(backdrop).not.toBeNull()

    fireEvent.pointerDown(backdrop as HTMLElement, { pointerType: 'touch' })
    fireEvent.click(backdrop as HTMLElement)

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
