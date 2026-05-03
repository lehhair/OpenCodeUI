import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionChangesPanel } from './SessionChangesPanel'
import { changeScopeStore } from '../store/changeScopeStore'

const { getCurrentProject, initGitProject, getSessionDiff, getLastTurnDiff, getVcsInfo, getVcsDiff } = vi.hoisted(
  () => ({
    getCurrentProject: vi.fn(),
    initGitProject: vi.fn(),
    getSessionDiff: vi.fn(),
    getLastTurnDiff: vi.fn(),
    getVcsInfo: vi.fn(),
    getVcsDiff: vi.fn(),
  }),
)

vi.mock('../api/client', () => ({
  getCurrentProject,
  initGitProject,
}))

vi.mock('../api/vcs', () => ({
  getVcsInfo,
  getVcsDiff,
}))

vi.mock('../api/session', () => ({
  getSessionDiff,
  getLastTurnDiff,
}))

vi.mock('./DiffViewer', () => ({
  DiffViewer: () => <div data-testid="diff-viewer">diff viewer</div>,
  useDiffViewerData: () => ({
    beforeTokens: null,
    afterTokens: null,
    pairedLines: [],
    unifiedLines: [],
    lineNumberWidth: 1,
  }),
}))

describe('SessionChangesPanel', () => {
  beforeEach(() => {
    changeScopeStore.clearAll()
    vi.useFakeTimers()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb =>
      window.setTimeout(() => cb(performance.now()), 16),
    )
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => {
      clearTimeout(id)
    })
    getCurrentProject.mockResolvedValue({
      id: 'project-1',
      worktree: '/repo',
      vcs: 'git',
      time: { created: 0, updated: 0 },
      sandboxes: [],
    })
    getVcsInfo.mockResolvedValue({
      branch: 'feature/test',
      default_branch: 'main',
    })
    getVcsDiff.mockImplementation(async mode => {
      if (mode === 'branch') {
        return [
          {
            file: 'src/branch.ts',
            before: 'const branch = 1',
            after: 'const branch = 2',
            additions: 1,
            deletions: 1,
          },
        ]
      }

      return [
        {
          file: 'src/git.ts',
          before: 'const git = 1',
          after: 'const git = 2',
          additions: 1,
          deletions: 1,
        },
      ]
    })
    getSessionDiff.mockResolvedValue([
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
    ])
    getLastTurnDiff.mockResolvedValue([
      {
        file: 'src/turn.ts',
        before: 'const turn = 1',
        after: 'const turn = 2',
        additions: 1,
        deletions: 1,
      },
    ])
    initGitProject.mockResolvedValue({
      id: 'project-1',
      worktree: '/repo',
      vcs: 'git',
      time: { created: 0, updated: 0 },
      sandboxes: [],
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('loads session diffs and shows the first file preview by default', async () => {
    render(<SessionChangesPanel sessionId="session-1" directory="/repo" />)

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(getSessionDiff).toHaveBeenCalledWith('session-1', '/repo')
    expect(screen.getByText('2f')).toBeInTheDocument()
    expect(screen.getAllByText('+1').length).toBeGreaterThan(0)
    expect(screen.getAllByText('-1').length).toBeGreaterThan(0)
    expect(screen.getByTestId('diff-viewer')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Change mode: Session changes/ })).toBeInTheDocument()
    expect(screen.getAllByText('app.ts').length).toBeGreaterThan(0)
  })

  it('switches to current turn changes on demand', async () => {
    render(<SessionChangesPanel sessionId="session-1" directory="/repo" />)

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
      await Promise.resolve()
    })

    fireEvent.click(screen.getByRole('button', { name: /Change mode:/ }))

    await act(async () => {
      vi.advanceTimersByTime(48)
      await Promise.resolve()
    })

    fireEvent.click(screen.getByText('Last turn changes'))

    await act(async () => {
      vi.advanceTimersByTime(240)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(getLastTurnDiff).toHaveBeenCalledWith('session-1', '/repo')
    expect(changeScopeStore.getMode('session-1')).toBe('turn')
    expect(screen.getByText('1f')).toBeInTheDocument()
    expect(screen.getAllByText('turn.ts').length).toBeGreaterThan(0)
  })

  it('switches to branch changes when available', async () => {
    render(<SessionChangesPanel sessionId="session-1" directory="/repo" />)

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
      await Promise.resolve()
    })

    fireEvent.click(screen.getByRole('button', { name: /Change mode:/ }))

    await act(async () => {
      vi.advanceTimersByTime(48)
      await Promise.resolve()
    })

    fireEvent.click(screen.getByText('Branch changes'))

    await act(async () => {
      vi.advanceTimersByTime(240)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(getVcsDiff).toHaveBeenCalledWith('branch', '/repo')
    expect(changeScopeStore.getMode('session-1')).toBe('branch')
    expect(screen.getAllByText('branch.ts').length).toBeGreaterThan(0)
  })

  it('supports keyboard navigation in the change mode menu and exposes toggle state', async () => {
    render(<SessionChangesPanel sessionId="session-1" directory="/repo" />)

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
      await Promise.resolve()
    })

    fireEvent.click(screen.getByRole('button', { name: /Change mode:/ }))

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
      await Promise.resolve()
    })

    const menu = screen.getByRole('menu', { name: 'Change mode' })
    const sessionChangesOption = screen.getByRole('menuitemradio', { name: 'Session changes' })
    const lastTurnOption = screen.getByRole('menuitemradio', { name: 'Last turn changes' })

    expect(sessionChangesOption).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(lastTurnOption).toHaveFocus()

    const treeButton = screen.getByRole('button', { name: 'Tree' })
    const listButton = screen.getByRole('button', { name: 'List' })
    const unifiedButton = screen.getByRole('button', { name: 'Unified' })
    const splitButton = screen.getByRole('button', { name: 'Split' })

    expect(treeButton).toHaveAttribute('aria-pressed', 'true')
    expect(unifiedButton).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(listButton)
    fireEvent.click(splitButton)

    expect(listButton).toHaveAttribute('aria-pressed', 'true')
    expect(treeButton).toHaveAttribute('aria-pressed', 'false')
    expect(splitButton).toHaveAttribute('aria-pressed', 'true')
    expect(unifiedButton).toHaveAttribute('aria-pressed', 'false')
  })

  it('opens the change mode menu from ArrowUp with focus on the last option', async () => {
    render(<SessionChangesPanel sessionId="session-1" directory="/repo" />)

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
      await Promise.resolve()
    })

    fireEvent.keyDown(screen.getByRole('button', { name: /Change mode:/ }), { key: 'ArrowUp' })

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.getByRole('menuitemradio', { name: 'Branch changes' })).toHaveFocus()
  })

  it('offers git initialization when the project is not a git repository', async () => {
    getCurrentProject.mockResolvedValueOnce({
      id: 'global',
      worktree: '/repo',
      time: { created: 0, updated: 0 },
      sandboxes: [],
    })

    render(<SessionChangesPanel sessionId="session-1" directory="/repo" />)

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Initialize Git repository' }))

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(initGitProject).toHaveBeenCalledWith('/repo')
    expect(getSessionDiff).toHaveBeenCalledWith('session-1', '/repo')
  })
})
