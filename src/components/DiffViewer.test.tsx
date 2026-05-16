import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DiffViewer } from './DiffViewer'

vi.mock('../store/themeStore', async importOriginal => {
  const actual = await importOriginal<typeof import('../store/themeStore')>()
  const snapshot = { diffStyle: 'lineNumbers' as const, codeWordWrap: false, codeFontScale: 0 }
  return {
    ...actual,
    themeStore: {
      subscribe: () => () => {},
      getSnapshot: () => snapshot,
    },
  }
})

vi.mock('../hooks/useSyntaxHighlight', () => ({
  useSyntaxHighlight: (code: string, options?: { mode?: 'html' | 'tokens' }) => ({
    output: options?.mode === 'tokens' ? code.split('\n').map(line => [{ content: line, color: '#fff' }]) : null,
    isLoading: false,
  }),
}))

describe('DiffViewer', () => {
  it('uses wrapped rendering without proxy horizontal scrollbar when word wrap is enabled', () => {
    const { container } = render(
      <DiffViewer
        before={'const someRidiculouslyLongIdentifierName = oldValue'}
        after={'const someRidiculouslyLongIdentifierName = newValue'}
        language="ts"
        viewMode="unified"
        wordWrap={true}
      />,
    )

    expect(screen.getByText('const someRidiculouslyLongIdentifierName = oldValue')).toBeInTheDocument()
    expect(screen.getByText('const someRidiculouslyLongIdentifierName = newValue')).toBeInTheDocument()
    expect(container.querySelector('.sticky')).toBeNull()
  })

  it('keeps empty split content texture anchored while scrolling horizontally', async () => {
    const { container } = render(
      <DiffViewer
        before={['same', 'tail'].join('\n')}
        after={['same', 'added only line', 'tail'].join('\n')}
        language="ts"
        viewMode="split"
        wordWrap={false}
      />,
    )

    const scrollPanels = container.querySelectorAll('.scrollbar-none')
    const leftContent = scrollPanels[0] as HTMLDivElement

    const emptyBuffer = container.querySelector('.diff-empty-content-buffer.min-w-full') as HTMLDivElement
    const initialX = Number.parseFloat(emptyBuffer.style.backgroundPosition.split(' ')[0] ?? '0')

    Object.defineProperty(leftContent, 'scrollLeft', { value: 37, configurable: true })
    fireEvent.scroll(leftContent)

    await waitFor(() => {
      const updatedBuffer = container.querySelector('.diff-empty-content-buffer.min-w-full') as HTMLDivElement
      const updatedX = Number.parseFloat(updatedBuffer.style.backgroundPosition.split(' ')[0] ?? '0')
      expect(updatedX - initialX).toBe(37)
    })
  })

  it('keeps split word-diff changed text themed when syntax highlighting is unavailable', () => {
    const { container } = render(
      <DiffViewer before={['node_modules', '.git', '.gitignore'].join('\n')} after={['node_modules', 'root', '.gitignore'].join('\n')} language="text" viewMode="split" wordWrap={true} />,
    )

    const changedSegments = Array.from(container.querySelectorAll('span')).filter(
      segment => segment.classList.contains('bg-danger-100/30') || segment.classList.contains('bg-success-100/30'),
    )

    expect(changedSegments.length).toBeGreaterThan(0)
    for (const segment of changedSegments) {
      expect(segment.closest('.text-text-100')).not.toBeNull()
    }
  })
})
