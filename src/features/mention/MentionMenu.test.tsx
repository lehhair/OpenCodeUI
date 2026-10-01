import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MentionMenu } from './MentionMenu'
import { listDirectory, searchFiles } from '../../api/client'

vi.mock('../../api/client', () => ({
  // v2 的文件条目只有 { path, type }
  listDirectory: vi.fn().mockResolvedValue([
    { path: 'src', type: 'directory' },
    { path: 'README.md', type: 'file' },
  ]),
  searchFiles: vi.fn().mockResolvedValue(['src/components/Button.tsx']),
}))

describe('MentionMenu', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb =>
      window.setTimeout(() => cb(performance.now()), 16),
    )
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => {
      clearTimeout(id)
    })
    vi.mocked(listDirectory).mockResolvedValue([
      { path: 'src', type: 'directory' } as never,
      { path: 'README.md', type: 'file' } as never,
    ])
    vi.mocked(searchFiles).mockResolvedValue(['src/components/Button.tsx'])
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('loads root directory items and agents when opened', async () => {
    render(
      <div>
        <MentionMenu
          isOpen={true}
          query=""
          agents={[{ name: 'planner', mode: 'subagent', hidden: false, description: 'plan work' } as never]}
          rootPath="/workspace/project"
          onSelect={vi.fn()}
          onClose={vi.fn()}
        />
      </div>,
    )

    await act(async () => {
      vi.advanceTimersByTime(32)
      await Promise.resolve()
    })

    expect(screen.getByText('planner')).toBeInTheDocument()
    expect(screen.getAllByText('src').length).toBeGreaterThan(0)
    expect(screen.getAllByText('README.md').length).toBeGreaterThan(0)
  })

  it('navigates back through breadcrumb control', async () => {
    const onNavigate = vi.fn()

    render(
      <div>
        <MentionMenu
          isOpen={true}
          query="src/components/"
          agents={[]}
          rootPath="/workspace/project"
          onSelect={vi.fn()}
          onNavigate={onNavigate}
          onClose={vi.fn()}
        />
      </div>,
    )

    await act(async () => {
      vi.advanceTimersByTime(32)
      await Promise.resolve()
    })

    fireEvent.click(screen.getByTitle('Go back'))
    expect(onNavigate).toHaveBeenCalledWith('src/')
  })
})
