import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CodePreview } from './CodePreview'

vi.mock('../store/themeStore', () => ({
  themeStore: {
    subscribe: () => () => {},
    getSnapshot: () => mockThemeSnapshot,
  },
}))

vi.mock('../hooks/useSyntaxHighlight', () => ({
  useSyntaxHighlightRef: () => ({
    tokensRef: { current: null },
    version: 0,
  }),
}))

const mockThemeSnapshot = {
  codeWordWrap: false,
  codeFontScale: 0,
}

describe('CodePreview', () => {
  it('renders code through CodeMirror with line numbers', () => {
    const { container } = render(<CodePreview code={'first line\nsecond line'} language="text" />)

    expect(screen.getByText('first line')).toBeInTheDocument()
    expect(screen.getByText('second line')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(container.querySelector('.cm-editor')).toBeInTheDocument()
  })

  it('keeps the editor focusable while read-only', () => {
    const { container } = render(
      <CodePreview code={'const someRidiculouslyLongIdentifierName = "value"\nsecond line'} language="text" />,
    )

    expect(container.querySelector('.cm-content')).toHaveAttribute('contenteditable', 'true')
  })

  it('opens CodeMirror search from the preview Ctrl+F fallback', () => {
    const { container } = render(<CodePreview code={'first line\nsecond line'} language="text" />)

    fireEvent.keyDown(container.firstElementChild as Element, { key: 'f', ctrlKey: true })

    expect(screen.getByPlaceholderText('Find')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Match case' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Use regular expression' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Match whole word' })).toBeInTheDocument()
    expect(screen.getByText('No results')).toBeInTheDocument()
  })
})
