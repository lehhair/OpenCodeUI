import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRef } from 'react'
import { DropdownMenu } from './DropdownMenu'

function DropdownHarness({ isOpen }: { isOpen: boolean }) {
  const triggerRef = useRef<HTMLButtonElement>(null)

  return (
    <div>
      <button ref={triggerRef} data-testid="trigger" onClick={() => {}}>
        trigger
      </button>
      <DropdownMenu triggerRef={triggerRef} isOpen={isOpen}>
        <div>dropdown content</div>
      </DropdownMenu>
    </div>
  )
}

function ConstrainedDropdownHarness({ isOpen }: { isOpen: boolean }) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const constrainRef = useRef<HTMLDivElement>(null)

  return (
    <div ref={constrainRef} data-testid="container">
      <button ref={triggerRef} data-testid="trigger" onClick={() => {}}>
        trigger
      </button>
      <DropdownMenu triggerRef={triggerRef} constrainToRef={constrainRef} isOpen={isOpen}>
        <div>dropdown content</div>
      </DropdownMenu>
    </div>
  )
}

describe('DropdownMenu', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb =>
      window.setTimeout(() => cb(performance.now()), 16),
    )
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => {
      clearTimeout(id)
    })
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('stays mounted during close transition and then unmounts', () => {
    const { rerender } = render(<DropdownHarness isOpen={true} />)

    const trigger = screen.getByTestId('trigger')
    Object.defineProperty(trigger, 'getBoundingClientRect', {
      value: () => ({ top: 100, bottom: 132, left: 50, right: 150, width: 100, height: 32 }),
    })

    act(() => {
      vi.advanceTimersByTime(48)
    })

    expect(screen.getByText('dropdown content')).toBeInTheDocument()

    rerender(<DropdownHarness isOpen={false} />)

    act(() => {
      vi.advanceTimersByTime(199)
    })
    expect(screen.getByText('dropdown content')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(17)
    })
    expect(screen.queryByText('dropdown content')).not.toBeInTheDocument()
  })

  it('updates constrained width when the container size changes', () => {
    const { rerender } = render(<ConstrainedDropdownHarness isOpen={true} />)

    const trigger = screen.getByTestId('trigger')
    const container = screen.getByTestId('container')
    let containerRight = 240

    Object.defineProperty(trigger, 'getBoundingClientRect', {
      value: () => ({ top: 100, bottom: 132, left: 50, right: 150, width: 100, height: 32 }),
    })
    Object.defineProperty(container, 'getBoundingClientRect', {
      value: () => ({ top: 0, bottom: 300, left: 0, right: containerRight, width: containerRight, height: 300 }),
    })

    act(() => {
      vi.advanceTimersByTime(48)
    })

    const menu = screen.getByText('dropdown content').parentElement
    expect(menu).toHaveStyle({ maxWidth: '190px' })

    containerRight = 280
    rerender(<ConstrainedDropdownHarness isOpen={true} />)

    act(() => {
      window.dispatchEvent(new Event('resize'))
      vi.advanceTimersByTime(16)
    })

    expect(menu).toHaveStyle({ maxWidth: '230px' })
  })
})
