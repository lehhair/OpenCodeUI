import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MarkdownRenderer } from './MarkdownRenderer'

vi.mock('./CodeBlock', () => ({
  CodeBlock: ({ code, language, variant }: { code: string; language?: string; variant?: string }) => (
    <div data-testid="code-block" data-variant={variant ?? 'default'}>{`${language ?? 'text'}:${code}`}</div>
  ),
}))

vi.mock('./ui', () => ({
  CopyButton: ({ text }: { text: string }) => (
    <button data-testid="copy-button" aria-label="Copy to clipboard">
      {text.slice(0, 20)}
    </button>
  ),
}))

describe('MarkdownRenderer', () => {
  it('renders headings and inline code', () => {
    render(<MarkdownRenderer content={'# Title\n\nUse `pnpm`'} />)

    expect(screen.getByRole('heading', { name: 'Title' })).toBeInTheDocument()
    const codeEl = screen.getByText('pnpm')
    expect(codeEl).toBeInTheDocument()
    expect(codeEl.tagName).toBe('CODE')
  })

  it('renders inline code with accent text styling (no border/bg)', () => {
    render(<MarkdownRenderer content={'Use `code` here'} />)

    const codeEl = screen.getByText('code')
    expect(codeEl.className).not.toMatch(/border/)
    expect(codeEl.className).not.toMatch(/bg-accent-main/)
    expect(codeEl.className).toMatch(/font-mono/)
    expect(codeEl.className).toMatch(/text-accent-main-100/)
  })

  it('renders fenced code blocks via CodeBlock', () => {
    render(<MarkdownRenderer content={'```ts\nconst x = 1\n```'} />)

    expect(screen.getByTestId('code-block')).toHaveTextContent('ts:const x = 1')
  })

  it('accepts isStreaming prop without crashing', () => {
    render(<MarkdownRenderer content={'Hello **world**'} isStreaming={true} />)

    expect(screen.getByRole('paragraph')).toHaveTextContent('Hello world')
  })

  it('renders with reasoning variant using subdued styles', () => {
    render(<MarkdownRenderer content={'# Heading\n\nSome text with `code`'} variant="reasoning" />)

    const heading = screen.getByRole('heading', { name: 'Heading' })
    expect(heading.className).toMatch(/text-text-300/)

    const paragraph = screen.getByRole('paragraph')
    expect(paragraph.className).toMatch(/text-text-400/)

    const codeEl = screen.getByText('code')
    expect(codeEl.className).not.toMatch(/border/)
    expect(codeEl.className).not.toMatch(/bg-accent/)
  })

  it('passes reasoning variant to CodeBlock', () => {
    render(<MarkdownRenderer content={'```js\nlet a = 1\n```'} variant="reasoning" />)

    const block = screen.getByTestId('code-block')
    expect(block.dataset.variant).toBe('reasoning')
  })

  it('passes default variant to CodeBlock by default', () => {
    render(<MarkdownRenderer content={'```js\nlet a = 1\n```'} />)

    const block = screen.getByTestId('code-block')
    expect(block.dataset.variant).toBe('default')
  })

  it('renders markdown table with copy button in default mode', () => {
    const md = '| A | B |\n|---|---|\n| 1 | 2 |'
    render(<MarkdownRenderer content={md} />)

    // Table should be rendered
    expect(screen.getByRole('table')).toBeInTheDocument()
    // Copy button should exist
    expect(screen.getByTestId('copy-button')).toBeInTheDocument()
  })

  it('renders markdown table without copy button in reasoning mode', () => {
    const md = '| A | B |\n|---|---|\n| 1 | 2 |'
    render(<MarkdownRenderer content={md} variant="reasoning" />)

    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.queryByTestId('copy-button')).not.toBeInTheDocument()
  })

  it('renders markdown images as plain img links without streamdown image wrapper controls', () => {
    render(<MarkdownRenderer content={'![avatar](https://example.com/avatar.png)'} />)

    const img = screen.getByRole('img', { name: 'avatar' })
    expect(img).toBeInTheDocument()
    expect(img.tagName).toBe('IMG')
    expect(screen.queryByTitle('Download image')).not.toBeInTheDocument()
  })
})
