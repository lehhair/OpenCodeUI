import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render } from '@testing-library/react'
import { TextSelectionPopup } from './TextSelectionPopup'

vi.mock('../../utils/clipboard', () => ({
  copyTextToClipboard: vi.fn(async () => undefined),
}))

vi.mock('../../utils/errorHandling', () => ({
  clipboardErrorHandler: vi.fn(),
}))

import { copyTextToClipboard } from '../../utils/clipboard'

const COPY_MOCK = copyTextToClipboard as unknown as ReturnType<typeof vi.fn>

let container: HTMLDivElement

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  COPY_MOCK.mockClear()
})

afterEach(() => {
  document.body.removeChild(container)
})

function setupSelectionPane(selectionText: string) {
  container.innerHTML = `
    <div data-pane-id="pane-test" data-chat-pane-root="true">
      <div data-test-target><span id="anchor-text">${selectionText}</span></div>
      <textarea data-testid="textarea" placeholder="..."></textarea>
    </div>
  `
  const anchor = container.querySelector('#anchor-text')!.firstChild!
  const range = document.createRange()
  range.setStart(anchor, 0)
  range.setEnd(anchor, anchor.textContent!.length)

  // jsdom doesn't compute layout, so getBoundingClientRect returns 0s. The
  // popup relies on a real rect to position itself, so override it for the
  // synthetic range. In a real browser this stays untouched.
  range.getBoundingClientRect = () =>
    ({
      top: 100,
      left: 200,
      right: 300,
      bottom: 120,
      width: 100,
      height: 20,
      x: 200,
      y: 100,
      toJSON: () => ({}),
    }) as DOMRect

  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  return {
    textarea: container.querySelector<HTMLTextAreaElement>('[data-testid="textarea"]')!,
    selection,
    range,
  }
}

function releasePointer(clientX = 250, clientY = 110) {
  fireEvent.mouseUp(document.body, { clientX, clientY })
}

async function flush() {
  await act(async () => {
    await new Promise(r => setTimeout(r, 50))
  })
}

describe('TextSelectionPopup', () => {
  it('does NOT appear during a selection drag — only after mouseup commits', async () => {
    setupSelectionPane('hello there')

    render(<TextSelectionPopup />)
    await flush()

    // selectionchange ran mid-test setup; no mouseup yet → popup must be hidden.
    expect(document.body.querySelector('[data-text-selection-popup]')).toBeNull()

    await act(async () => {
      releasePointer(280, 140)
    })

    expect(document.body.querySelector('[data-text-selection-popup]')).not.toBeNull()
  })

  it('renders Quote and Copy buttons after mouseup over a valid selection', async () => {
    setupSelectionPane('hello there')
    render(<TextSelectionPopup />)
    await flush()
    await act(async () => {
      releasePointer()
    })

    const popup = document.body.querySelector('[data-text-selection-popup]')
    expect(popup).not.toBeNull()
    const quoteButton = popup?.querySelector('button[aria-label="Quote"]')
    const copyButton = popup?.querySelector('button[aria-label="Copy"]')
    expect(quoteButton).not.toBeNull()
    expect(copyButton).not.toBeNull()
  })

  it('does not appear for selections outside any data-pane-id container', async () => {
    container.innerHTML = `
      <div>plain outside pane
        <span id="anchor-text">${'outside'}</span>
      </div>
    `
    const anchor = container.querySelector('#anchor-text')!.firstChild!
    const range = document.createRange()
    range.setStart(anchor, 0)
    range.setEnd(anchor, anchor.textContent!.length)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    render(<TextSelectionPopup />)
    await flush()
    await act(async () => {
      releasePointer()
    })

    expect(document.body.querySelector('[data-text-selection-popup]')).toBeNull()
  })

  it('Quote writes a markdown block-quote into the pane textarea and focuses it', async () => {
    const { textarea } = setupSelectionPane('how does this work?')

    render(<TextSelectionPopup />)
    await flush()
    await act(async () => {
      releasePointer()
    })

    const quoteButton = document.body.querySelector('button[aria-label="Quote"]') as HTMLButtonElement
    expect(quoteButton).not.toBeNull()

    act(() => {
      fireEvent.click(quoteButton)
    })

    expect(textarea.value.startsWith('> how does this work?')).toBe(true)
    expect(COPY_MOCK).not.toHaveBeenCalled()
  })

  it('Copy writes the selection to the clipboard without touching the textarea', async () => {
    const { textarea } = setupSelectionPane('plain copy text')
    render(<TextSelectionPopup />)
    await flush()
    await act(async () => {
      releasePointer()
    })

    const copyButton = document.body.querySelector('button[aria-label="Copy"]') as HTMLButtonElement
    expect(copyButton).not.toBeNull()

    await act(async () => {
      fireEvent.click(copyButton)
    })

    expect(COPY_MOCK).toHaveBeenCalledWith('plain copy text')
    expect(textarea.value).toBe('')
  })

  it('hides on Escape after a mouseup-committed selection', async () => {
    setupSelectionPane('escape me')
    render(<TextSelectionPopup />)
    await flush()
    await act(async () => {
      releasePointer()
    })
    expect(document.body.querySelector('[data-text-selection-popup]')).not.toBeNull()

    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })

    expect(document.body.querySelector('[data-text-selection-popup]')).toBeNull()
  })

  it('hides on scroll after a mouseup-committed selection', async () => {
    setupSelectionPane('scroll away')
    render(<TextSelectionPopup />)
    await flush()
    await act(async () => {
      releasePointer()
    })
    expect(document.body.querySelector('[data-text-selection-popup]')).not.toBeNull()

    await act(async () => {
      window.dispatchEvent(new Event('scroll'))
    })
    expect(document.body.querySelector('[data-text-selection-popup]')).toBeNull()
  })

  it('places the popup near the pointer release point, not the selection start', async () => {
    setupSelectionPane('anchor for position math')
    render(<TextSelectionPopup />)
    await flush()
    await act(async () => {
      // Release at coordinates far from the synthetic selection rect
      // (rect is at top=100/left=200 — pick something the rect-aware path
      // would never choose).
      releasePointer(900, 600)
    })

    const popup = document.body.querySelector<HTMLDivElement>('[data-text-selection-popup]')
    expect(popup).not.toBeNull()
    // Read the inline style values applied by computePopupAtPointer.
    expect(popup!.style.position).toBe('fixed')
    expect(popup!.style.top).toMatch(/^\d+(\.\d+)?px$/)
    expect(popup!.style.left).toMatch(/^\d+(\.\d+)?px$/)
    const leftPx = Number.parseFloat(popup!.style.left)
    // Should not coincide with the synthetic rect's left (200).
    expect(leftPx).not.toBe(200)
    // 900 - popupWidth estimate (200) places the cursor's left edge of the popup.
    expect(leftPx).toBeGreaterThan(500)
  })
})
