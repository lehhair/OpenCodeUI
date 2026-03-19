import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionChangesPanel } from './SessionChangesPanel'

vi.mock('../api/session', () => ({
  getSessionDiff: vi.fn().mockResolvedValue([
    {
      file: 'src/app.ts',
      before: 'const a = 1',
      after: 'const a = 2',
      additions: 1,
      deletions: 1,
    },
    {
      file: 'src/components/Button.tsx',
      before: 'export const Button = 1',
      after: 'export const Button = 2',
      additions: 1,
      deletions: 1,
    },
  ]),
}))

vi.mock('./DiffViewer', () => ({
  DiffViewer: () => <div data-testid="diff-viewer">diff viewer</div>,
}))

describe('SessionChangesPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('loads session diffs and shows the first file preview by default', async () => {
    render(<SessionChangesPanel sessionId="session-1" />)

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    expect(screen.getByText('2 files')).toBeInTheDocument()
    expect(screen.getAllByText('+2').length).toBeGreaterThan(0)
    expect(screen.getAllByText('-2').length).toBeGreaterThan(0)
    expect(screen.getByTestId('diff-viewer')).toBeInTheDocument()
    expect(screen.getAllByText('app.ts').length).toBeGreaterThan(0)
  })
})
