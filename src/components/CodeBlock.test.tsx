import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CodeBlock } from './CodeBlock'

const useInputCapabilitiesMock = vi.fn(() => ({
  canHover: true,
  hasCoarsePointer: false,
  hasTouch: false,
  preferTouchUi: false,
}))
type HighlightMockOutput = { highlightedCode?: string; output: { content: string; color?: string }[][] | null }
const useSyntaxHighlightMock = vi.fn(
  (_code: string, _options: unknown): HighlightMockOutput => ({
    output: [[{ content: 'highlighted', color: '#fff' }]],
  }),
)
const useStreamingSyntaxHighlightMock = vi.fn(
  (_code: string, _options: unknown): HighlightMockOutput => ({
    output: null,
  }),
)
const useInViewMock = vi.fn(() => ({ ref: vi.fn(), inView: false }))
const themeSnapshot = { codeWordWrap: false }

vi.mock('../hooks/useInputCapabilities', () => ({
  useInputCapabilities: () => useInputCapabilitiesMock(),
}))

vi.mock('../hooks/useSyntaxHighlight', () => ({
  useSyntaxHighlight: (code: string, options: unknown) => useSyntaxHighlightMock(code, options),
  useStreamingSyntaxHighlight: (code: string, options: unknown) => useStreamingSyntaxHighlightMock(code, options),
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
    useSyntaxHighlightMock.mockReturnValue({ output: [[{ content: 'highlighted', color: '#fff' }]] })
    useStreamingSyntaxHighlightMock.mockClear()
    useStreamingSyntaxHighlightMock.mockReturnValue({ output: null })
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

  it('composes a preview action into the existing code block chrome', () => {
    const { container } = render(
      <CodeBlock
        code="<button>Run</button>"
        language="html"
        headerActions={<button aria-label="Preview HTML">preview</button>}
      />,
    )

    const shell = container.firstElementChild
    expect(shell).toContainElement(screen.getByText('html'))
    expect(shell).toContainElement(screen.getByRole('button', { name: 'Preview HTML' }))
    expect(shell).toContainElement(screen.getByRole('button', { name: 'Copy to clipboard' }))
    expect(container.querySelector('pre')).toBeInTheDocument()
  })

  it('renders current plain code while highlight is deferred', () => {
    render(<CodeBlock code="const value = 1" language="ts" deferHighlight />)

    expect(screen.getByText('const value = 1')).toBeInTheDocument()
    expect(screen.queryByText('highlighted')).not.toBeInTheDocument()
    expect(useSyntaxHighlightMock).toHaveBeenCalledWith(
      'const value = 1',
      expect.objectContaining({ enabled: false, lang: 'ts', mode: 'tokens' }),
    )
  })

  it('renders highlighted tokens as selectable plain pre content', () => {
    useInViewMock.mockReturnValue({ ref: vi.fn(), inView: true })

    const { container } = render(<CodeBlock code="const value = 1" language="ts" />)

    const pre = container.querySelector('pre')
    expect(pre).toHaveTextContent('highlighted')
    expect(pre).not.toHaveAttribute('tabindex')
    expect(pre?.className).toContain('select-text')
    expect(useSyntaxHighlightMock).toHaveBeenCalledWith(
      'const value = 1',
      expect.objectContaining({ enabled: true, lang: 'ts', mode: 'tokens' }),
    )
  })

  it('keeps highlighted prefix while streaming suffix waits for new tokens', () => {
    useInViewMock.mockReturnValue({ ref: vi.fn(), inView: true })
    useSyntaxHighlightMock.mockImplementation((highlightCode: string): HighlightMockOutput => {
      if (highlightCode === 'const') return { output: [[{ content: 'const', color: '#fff' }]] }
      return { output: null }
    })

    const { container, rerender } = render(<CodeBlock code="const" language="ts" />)

    rerender(<CodeBlock code="const value" language="ts" />)

    const pre = container.querySelector('pre')
    expect(pre).toHaveTextContent('const value')
    expect(pre?.className).toContain('shiki-wrapper')
  })

  it('enables highlighting when visible', () => {
    useInViewMock.mockReturnValue({ ref: vi.fn(), inView: true })

    render(<CodeBlock code="const value = 1" language="ts" />)

    expect(useSyntaxHighlightMock).toHaveBeenCalledWith(
      'const value = 1',
      expect.objectContaining({ delayMs: 0, enabled: true, lang: 'ts', mode: 'tokens' }),
    )
  })

  it('can force streaming highlight before in-view observation fires', () => {
    render(<CodeBlock code="const value = 1" language="ts" forceHighlight />)

    expect(useSyntaxHighlightMock).toHaveBeenCalledWith(
      'const value = 1',
      expect.objectContaining({ delayMs: 0, enabled: true, lang: 'ts', mode: 'tokens' }),
    )
  })

  it('uses incremental streaming highlighting instead of full tokenization', () => {
    useStreamingSyntaxHighlightMock.mockReturnValue({ output: [[{ content: 'streamed', color: '#fff' }]] })

    render(<CodeBlock code="const value = 1" language="ts" forceHighlight streamingHighlight />)

    expect(screen.getByText('streamed')).toBeInTheDocument()
    expect(useSyntaxHighlightMock).toHaveBeenCalledWith(
      'const value = 1',
      expect.objectContaining({ enabled: false, lang: 'ts', mode: 'tokens' }),
    )
    expect(useStreamingSyntaxHighlightMock).toHaveBeenCalledWith(
      'const value = 1',
      expect.objectContaining({ enabled: true, lang: 'ts' }),
    )
  })

  it('reuses stable streaming token DOM while appending suffix text', () => {
    useStreamingSyntaxHighlightMock.mockImplementation(
      (code: string): HighlightMockOutput => ({
        highlightedCode: code.startsWith('const') ? 'const' : code,
        output: [[{ content: 'const', color: '#fff' }]],
      }),
    )

    const { container, rerender } = render(<CodeBlock code="const" language="ts" forceHighlight streamingHighlight />)
    const firstSpan = container.querySelector('code span')

    rerender(<CodeBlock code="const value" language="ts" forceHighlight streamingHighlight />)

    expect(container.querySelector('code span')).toBe(firstSpan)
    expect(container.querySelector('pre')).toHaveTextContent('const value')
  })

  it('keeps the live suffix when streaming tokens lag behind code', () => {
    useStreamingSyntaxHighlightMock.mockReturnValue({
      highlightedCode: 'const',
      output: [[{ content: 'const', color: '#fff' }]],
    })

    const { container } = render(<CodeBlock code="const value" language="ts" forceHighlight streamingHighlight />)

    expect(container.querySelector('pre')).toHaveTextContent('const value')
  })
})
