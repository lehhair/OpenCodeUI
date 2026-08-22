import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  buildQuotePatch,
  computePopupPosition,
  findTargetTextarea,
  formatQuote,
  shouldShowPopupForSelection,
} from './popupUtils'

let container: HTMLDivElement

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(() => {
  document.body.removeChild(container)
})

/**
 * Build a minimal fake `Selection` for `findTargetTextarea` / `shouldShow*`.
 * jsdom doesn't implement window.getSelection in a useful way, so we unit-test
 * the helpers with stub objects that quack like a Selection.
 */
function makeFakeSelection(opts: {
  anchorElement: Element | null
  text?: string
  isCollapsed?: boolean
  rangeCount?: number
}): Partial<Selection> {
  const rangeCount = opts.rangeCount ?? 1
  return {
    anchorNode: opts.anchorElement,
    isCollapsed: opts.isCollapsed ?? false,
    rangeCount,
    toString: () => opts.text ?? '',
    getRangeAt: () => ({}) as Range,
  }
}

describe('formatQuote', () => {
  it('prefixes a single line with "> "', () => {
    expect(formatQuote('hello world')).toBe('> hello world')
  })

  it('prefixes each line of a multi-line selection', () => {
    expect(formatQuote('line one\nline two\nline three')).toBe('> line one\n> line two\n> line three')
  })

  it('emits a lone ">" for blank lines so Markdown stays a valid blockquote', () => {
    expect(formatQuote('first\n\nthird')).toBe('> first\n>\n> third')
  })

  it('returns an empty string for empty input', () => {
    expect(formatQuote('')).toBe('')
  })
})

describe('buildQuotePatch', () => {
  it('quotes into an empty input and leaves the cursor on a fresh line below', () => {
    const result = buildQuotePatch('', 0, 'first line\nsecond line')
    expect(result.newText).toBe('> first line\n> second line\n\n')
    expect(result.newCursor).toBe('> first line\n> second line\n\n'.length)
  })

  it('wraps the quote with blank lines when appending to text that ends with a single newline', () => {
    const existing = 'Please look at this:\n'
    const result = buildQuotePatch(existing, existing.length, 'quoted block')
    expect(result.newText).toBe('Please look at this:\n\n> quoted block\n\n')
    expect(result.newCursor).toBe(result.newText.length)
  })

  it('keeps the existing blank line above and still adds one below when text ends with a blank line', () => {
    const existing = 'Already has a blank line:\n\n'
    const result = buildQuotePatch(existing, existing.length, 'quoted block')
    expect(result.newText).toBe('Already has a blank line:\n\n> quoted block\n\n')
  })

  it('quotes in the middle of a non-empty input with blank lines on both sides', () => {
    const existing = 'prefix suffix'
    const result = buildQuotePatch(existing, 'prefix '.length, 'line one\nline two')
    expect(result.newText).toBe('prefix \n\n> line one\n> line two\n\nsuffix')
    expect(result.newCursor).toBe('prefix \n\n> line one\n> line two\n\n'.length)
  })

  it('wraps the quote with blank lines even when the cursor is clamped to the end', () => {
    const result = buildQuotePatch('abc', 99, 'quoted')
    expect(result.newText).toBe('abc\n\n> quoted\n\n')
    expect(result.newCursor).toBe('abc\n\n> quoted\n\n'.length)
  })

  it('handles multi-line selections and still leaves a trailing blank line', () => {
    const result = buildQuotePatch('hi ', 3, 'foo\nbar')
    expect(result.newText).toBe('hi \n\n> foo\n> bar\n\n')
    expect(result.newCursor).toBe('hi \n\n> foo\n> bar\n\n'.length)
  })
})

describe('findTargetTextarea', () => {
  it('returns null when selection is null', () => {
    expect(findTargetTextarea(null)).toBeNull()
  })

  it('returns null when the selection is not inside any pane', () => {
    container.innerHTML = '<div>no pane here</div>'
    const anchor = container.querySelector('div')
    const sel = makeFakeSelection({ anchorElement: anchor })
    expect(findTargetTextarea(sel as Selection)).toBeNull()
  })

  it('returns the textarea inside the closest data-pane-id ancestor', () => {
    container.innerHTML = `
      <div data-pane-id="pane-a">
        <p>inside pane a</p>
        <textarea></textarea>
      </div>
    `
    const anchor = container.querySelector('p')
    const sel = makeFakeSelection({ anchorElement: anchor })
    const textarea = findTargetTextarea(sel as Selection)
    expect(textarea).toBe(container.querySelector('textarea'))
  })

  it('walks up to a shared pane ancestor when textarea lives in a sibling subtree', () => {
    // Real ChatPane DOM: messages and the input live in different subtrees
    // under the same data-pane-id wrapper. Selection deep inside a message
    // must still resolve to the input textarea in the same pane.
    container.innerHTML = `
      <div data-pane-id="pane-realistic">
        <section class="messages">
          <p id="msg">a thought provoking sentence worth quoting</p>
        </section>
        <section class="input-area">
          <div data-pane-id="pane-realistic" data-input-box="true">
            <textarea></textarea>
          </div>
        </section>
      </div>
    `
    const anchor = container.querySelector('#msg')
    const sel = makeFakeSelection({ anchorElement: anchor })
    const textarea = findTargetTextarea(sel as Selection)
    expect(textarea).toBe(container.querySelector('textarea'))
  })
})

describe('shouldShowPopupForSelection', () => {
  it('rejects null selections', () => {
    expect(shouldShowPopupForSelection(null)).toBe(false)
  })

  it('rejects collapsed selections', () => {
    container.innerHTML = `
      <div data-pane-id="pane-b">
        <p>just sitting here</p>
      </div>
    `
    const anchor = container.querySelector('p')
    const sel = makeFakeSelection({ anchorElement: anchor, isCollapsed: true, text: 'something' })
    expect(shouldShowPopupForSelection(sel as Selection)).toBe(false)
  })

  it('rejects selections whose text is whitespace only', () => {
    container.innerHTML = `
      <div data-pane-id="pane-c">
        <p>content</p>
      </div>
    `
    const anchor = container.querySelector('p')
    const sel = makeFakeSelection({ anchorElement: anchor, text: '   ' })
    expect(shouldShowPopupForSelection(sel as Selection)).toBe(false)
  })

  it('rejects selections inside an input/textarea', () => {
    container.innerHTML = `
      <div data-pane-id="pane-d">
        <textarea>some user draft</textarea>
      </div>
    `
    const textarea = container.querySelector('textarea')!
    const sel = makeFakeSelection({ anchorElement: textarea, text: 'user draft' })
    expect(shouldShowPopupForSelection(sel as Selection)).toBe(false)
  })

  it('rejects selections inside elements marked with data-no-selection-popup', () => {
    container.innerHTML = `
      <div data-pane-id="pane-e">
        <div data-no-selection-popup><span>opt-out</span></div>
      </div>
    `
    const anchor = container.querySelector('span')
    const sel = makeFakeSelection({ anchorElement: anchor, text: 'opt-out' })
    expect(shouldShowPopupForSelection(sel as Selection)).toBe(false)
  })

  it('accepts ordinary text inside a pane', () => {
    container.innerHTML = `
      <div data-pane-id="pane-f">
        <p>an interesting fact</p>
      </div>
    `
    const anchor = container.querySelector('p')
    const sel = makeFakeSelection({ anchorElement: anchor, text: 'an interesting fact' })
    expect(shouldShowPopupForSelection(sel as Selection)).toBe(true)
  })
})

describe('computePopupPosition', () => {
  // The function takes a simple anchor {top, bottom, left} that works for
  // both pointer-release coords (top==bottom==y) and selection rects.
  function anchor(top: number, bottom: number, left: number) {
    return { top, bottom, left }
  }

  it('places above when there is room', () => {
    const result = computePopupPosition(anchor(200, 220, 50), 40, 200, 1024, 8, 800)
    expect(result.placement).toBe('above')
    expect(result.top).toBe(152) // 200 - 40 - 8
    expect(result.left).toBe(50)
  })

  it('places below when above would clip', () => {
    const result = computePopupPosition(anchor(20, 30, 50), 40, 200, 1024, 8, 800)
    expect(result.placement).toBe('below')
    expect(result.top).toBe(38) // 30 + 8
  })

  it('clamps to the right edge of the viewport', () => {
    const result = computePopupPosition(anchor(200, 220, 900), 40, 200, 1024, 8, 800)
    expect(result.left).toBeLessThanOrEqual(1024 - 200 - 8)
  })

  it('clamps to the left edge of the viewport', () => {
    const result = computePopupPosition(anchor(200, 220, -100), 40, 200, 1024, 8, 800)
    expect(result.left).toBe(8)
  })

  it('falls back to above (clamped) when both directions are tight', () => {
    const result = computePopupPosition(anchor(2, 4, 0), 40, 200, 1024, 8, 50)
    expect(result.placement).toBe('above')
    expect(result.top).toBeGreaterThanOrEqual(8)
  })

  it('works with a zero-height anchor (pointer release point)', () => {
    const result = computePopupPosition(anchor(200, 200, 100), 30, 180, 1024, 8, 800)
    expect(result.placement).toBe('above')
    expect(result.top).toBe(162) // 200 - 30 - 8
    expect(result.left).toBe(100)
  })
})
