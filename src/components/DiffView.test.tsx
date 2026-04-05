import type { ReactNode } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DiffView } from './DiffView'

vi.mock('../hooks/useSyntaxHighlight', () => ({
  useSyntaxHighlight: (code: string, options?: { mode?: 'html' | 'tokens' }) => ({
    output: options?.mode === 'tokens' ? code.split('\n').map(line => [{ content: line, color: '#fff' }]) : null,
    isLoading: false,
  }),
}))

vi.mock('./FullscreenViewer', () => ({
  FullscreenViewer: ({ isOpen, children }: { isOpen: boolean; children?: ReactNode }) =>
    isOpen ? <div data-testid="fullscreen-viewer">{children}</div> : null,
  ViewModeSwitch: () => <div data-testid="view-mode-switch">switch</div>,
}))

describe('DiffView', () => {
  it('renders diff stats and can open fullscreen viewer', async () => {
    render(
      <DiffView
        before={'const a = 1\nconst keep = true'}
        after={'const a = 2\nconst keep = true'}
        filePath="src/app.ts"
      />,
    )

    expect(screen.getByText('app.ts')).toBeInTheDocument()
    expect(screen.getByText('+1')).toBeInTheDocument()
    expect(screen.getByText('-1')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByTitle('Fullscreen'))
    })

    expect(screen.getByTestId('fullscreen-viewer')).toBeInTheDocument()
  })
})
