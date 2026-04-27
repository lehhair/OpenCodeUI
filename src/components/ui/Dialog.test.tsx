import { useState } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Dialog } from './Dialog'

describe('Dialog', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => window.setTimeout(() => cb(performance.now()), 0))
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => {
      clearTimeout(id)
    })
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

  it('moves focus into the dialog when it opens', async () => {
    function Harness() {
      const [isOpen, setIsOpen] = useState(true)

      return (
        <>
          <button id="dialog-trigger" type="button">
            Open dialog
          </button>
          <Dialog isOpen={isOpen} onClose={() => setIsOpen(false)} title="Test Dialog">
            <button type="button">Inner action</button>
          </Dialog>
        </>
      )
    }

    render(<Harness />)

    const trigger = screen.getByRole('button', { name: 'Open dialog' })
    trigger.focus()

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })
  })

  it('uses aria-label for rawContent dialogs', () => {
    render(
      <Dialog isOpen={true} onClose={vi.fn()} ariaLabel="Settings" rawContent showCloseButton={false}>
        <div>settings body</div>
      </Dialog>,
    )

    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument()
  })

  it('does not steal focus back when another dialog opens during close', async () => {
    function Harness() {
      const [isFirstOpen, setIsFirstOpen] = useState(true)
      const [isSecondOpen, setIsSecondOpen] = useState(false)

      return (
        <>
          <button id="first-trigger" type="button">
            First trigger
          </button>
          <Dialog
            isOpen={isFirstOpen}
            onClose={() => {
              setIsFirstOpen(false)
              setIsSecondOpen(true)
            }}
            title="First Dialog"
          >
            <button type="button">First action</button>
          </Dialog>
          <Dialog isOpen={isSecondOpen} onClose={() => setIsSecondOpen(false)} title="Second Dialog">
            <button type="button">Second action</button>
          </Dialog>
        </>
      )
    }

    render(<Harness />)

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.getByRole('dialog', { name: 'Second Dialog' })).toBeInTheDocument()
    expect(document.getElementById('first-trigger')).not.toHaveFocus()
  })

  it('only closes the topmost dialog on Escape when dialogs are stacked', () => {
    const firstClose = vi.fn()
    const secondClose = vi.fn()

    render(
      <>
        <Dialog isOpen={true} onClose={firstClose} title="First Dialog">
          <button type="button">First action</button>
        </Dialog>
        <Dialog isOpen={true} onClose={secondClose} title="Second Dialog">
          <button type="button">Second action</button>
        </Dialog>
      </>,
    )

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(secondClose).toHaveBeenCalledTimes(1)
    expect(firstClose).not.toHaveBeenCalled()
  })
})
