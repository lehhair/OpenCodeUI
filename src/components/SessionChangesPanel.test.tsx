import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionChangesPanel } from './SessionChangesPanel'
import { changeScopeStore } from '../store/changeScopeStore'
import { layoutStore } from '../store/layoutStore'
import { FullscreenProvider } from '../contexts'

const { getCurrentProject, getSessionDiff, getLastTurnDiff, getVcsInfo, getVcsDiff } = vi.hoisted(() => ({
  getCurrentProject: vi.fn(),
  getSessionDiff: vi.fn(),
  getLastTurnDiff: vi.fn(),
  getVcsInfo: vi.fn(),
  getVcsDiff: vi.fn(),
}))

vi.mock('../api/client', () => ({
  getCurrentProject,
}))

vi.mock('../api/vcs', () => ({
  getVcsInfo,
  getVcsDiff,
  // 阶段 3a：组件用这个助手把 UI 的变更范围翻译成 V2 的 Vcs.Mode
  //（真实映射的测试在 src/api/vcs.test.ts，这里只是替身，避免拉入真实 SDK 依赖）
  toVcsDiffMode: (mode: 'git' | 'branch') => (mode === 'git' ? 'working' : 'branch'),
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

function renderSessionChangesPanel() {
  return render(
    <FullscreenProvider>
      <SessionChangesPanel sessionId="session-1" directory="/repo" />
    </FullscreenProvider>,
  )
}

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
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('loads last turn diffs and shows the first file preview by default', async () => {
    renderSessionChangesPanel()

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(getLastTurnDiff).toHaveBeenCalledWith('session-1', '/repo', undefined)
    expect(screen.getByText('1f')).toBeInTheDocument()
    expect(screen.getAllByText('+1').length).toBeGreaterThan(0)
    expect(screen.getAllByText('-1').length).toBeGreaterThan(0)
    expect(screen.getByTestId('diff-viewer')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Change mode: Last turn changes/ })).toBeInTheDocument()
    expect(screen.getAllByText('turn.ts').length).toBeGreaterThan(0)
  })

  it('switches to session changes on demand', async () => {
    renderSessionChangesPanel()

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

    fireEvent.click(screen.getByText('Session changes'))

    await act(async () => {
      vi.advanceTimersByTime(240)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(getSessionDiff).toHaveBeenCalledWith('session-1', '/repo', undefined)
    expect(changeScopeStore.getMode('session-1')).toBe('session')
    expect(screen.getByText('2f')).toBeInTheDocument()
    expect(screen.getAllByText('app.ts').length).toBeGreaterThan(0)
  })

  it('switches to branch changes when available', async () => {
    renderSessionChangesPanel()

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

    expect(getVcsDiff).toHaveBeenCalledWith('branch', '/repo', undefined)
    expect(changeScopeStore.getMode('session-1')).toBe('branch')
    expect(screen.getAllByText('branch.ts').length).toBeGreaterThan(0)
  })

  it('supports keyboard navigation in the change mode menu and exposes toggle state', async () => {
    renderSessionChangesPanel()

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
    const lastTurnOption = screen.getByRole('menuitemradio', { name: 'Last turn changes' })
    const gitChangesOption = screen.getByRole('menuitemradio', { name: 'Git changes' })

    expect(lastTurnOption).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(gitChangesOption).toHaveFocus()

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
    renderSessionChangesPanel()

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

    expect(screen.getByRole('menuitemradio', { name: 'Session changes' })).toHaveFocus()
  })

  it('非 git 目录只显示提示，不再有「初始化 git」按钮（阶段 3b 移除）', async () => {
    getCurrentProject.mockResolvedValueOnce({
      id: 'global',
      worktree: '/repo',
      time: { created: 0, updated: 0 },
      sandboxes: [],
    })

    renderSessionChangesPanel()

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    // V2 删除了 `POST /project/git/init`，UI 入口已整体下架
    expect(screen.queryByRole('button', { name: 'Initialize Git repository' })).toBeNull()
  })

  it('opens the selected change file in the files panel from the context menu', async () => {
    const openFilePreview = vi.spyOn(layoutStore, 'openFilePreview')

    render(
      <FullscreenProvider>
        <SessionChangesPanel sessionId="session-1" directory="/repo" position="bottom" />
      </FullscreenProvider>,
    )

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
      await Promise.resolve()
    })

    const fileButtons = screen.getAllByRole('button', { name: /turn\.ts/ })
    fireEvent.contextMenu(fileButtons[0])
    fireEvent.click(screen.getByRole('button', { name: 'Open in Files' }))

    expect(openFilePreview).toHaveBeenCalledWith({ path: 'src/turn.ts', name: 'turn.ts' }, 'bottom')
  })
})
