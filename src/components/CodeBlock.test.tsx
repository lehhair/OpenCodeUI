import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CodeBlock } from './CodeBlock'

const useInputCapabilitiesMock = vi.fn(() => ({
  canHover: true,
  hasCoarsePointer: false,
  hasTouch: false,
  preferTouchUi: false,
}))
const useSyntaxHighlightMock = vi.fn((_code: string, _options: unknown) => ({
  output: '<pre><code>highlighted</code></pre>',
}))
const useInViewMock = vi.fn(() => ({ ref: vi.fn(), inView: false }))
const themeSnapshot = { codeWordWrap: false }

vi.mock('../hooks/useInputCapabilities', () => ({
  useInputCapabilities: () => useInputCapabilitiesMock(),
}))

vi.mock('../hooks/useSyntaxHighlight', () => ({
  useSyntaxHighlight: (code: string, options: unknown) => useSyntaxHighlightMock(code, options),
}))

vi.mock('../hooks/useInView', () => ({
  useInView: () => useInViewMock(),
}))

vi.mock('../store/themeStore', () => ({
  themeStore: {
    subscribe: () => () => {},
    getSnapshot: () => themeSnapshot,
  },
}))

vi.mock('./ui', () => ({
  CopyButton: ({ className }: { className?: string }) => (
    <button aria-label="Copy to clipboard" className={className}>
      copy
    </button>
  ),
}))

describe('CodeBlock', () => {
  beforeEach(() => {
    useInputCapabilitiesMock.mockReset()
    useInputCapabilitiesMock.mockReturnValue({
      canHover: true,
      hasCoarsePointer: false,
      hasTouch: false,
      preferTouchUi: false,
    })
    useSyntaxHighlightMock.mockClear()
    useSyntaxHighlightMock.mockReturnValue({ output: '<pre><code>highlighted</code></pre>' })
    useInViewMock.mockReset()
    useInViewMock.mockReturnValue({ ref: vi.fn(), inView: false })
  })

  it('requires tap-to-reveal copy button for unlabeled touch-ui code blocks', () => {
    useInputCapabilitiesMock.mockReturnValue({
      canHover: false,
      hasCoarsePointer: true,
      hasTouch: true,
      preferTouchUi: true,
    })

    const { container } = render(<CodeBlock code="const value = 1" />)

    expect(container.firstChild).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('button', { name: 'Copy to clipboard' }).parentElement?.className).toContain(
      '[@media(hover:none)]:opacity-0',
    )
  })

  it('keeps labeled touch-ui code blocks unchanged', () => {
    useInputCapabilitiesMock.mockReturnValue({
      canHover: false,
      hasCoarsePointer: true,
      hasTouch: true,
      preferTouchUi: true,
    })

    const { container } = render(<CodeBlock code="const value = 1" language="ts" />)

    expect(container.firstChild).not.toHaveAttribute('tabindex')
    expect(screen.getByText('ts')).toBeInTheDocument()
  })

  it('renders current plain code while highlight is deferred', () => {
    render(<CodeBlock code="const value = 1" language="ts" deferHighlight />)

    expect(screen.getByText('const value = 1')).toBeInTheDocument()
    expect(screen.queryByText('highlighted')).not.toBeInTheDocument()
    expect(useSyntaxHighlightMock).toHaveBeenCalledWith(
      'const value = 1',
      expect.objectContaining({ enabled: false, lang: 'ts' }),
    )
  })

  it('passes highlight debounce delay when visible', () => {
    useInViewMock.mockReturnValue({ ref: vi.fn(), inView: true })

    render(<CodeBlock code="const value = 1" language="ts" highlightDelayMs={48} />)

    expect(useSyntaxHighlightMock).toHaveBeenCalledWith(
      'const value = 1',
      expect.objectContaining({ delayMs: 48, enabled: true, lang: 'ts' }),
    )
  })

  it('enables delayed streaming highlight before in-view observation fires', () => {
    render(<CodeBlock code="const value = 1" language="ts" highlightDelayMs={48} />)

    expect(useSyntaxHighlightMock).toHaveBeenCalledWith(
      'const value = 1',
      expect.objectContaining({ delayMs: 48, enabled: true, lang: 'ts' }),
    )
  })
})
