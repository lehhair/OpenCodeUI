import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MentionMenu } from './MentionMenu'
import { listDirectory, searchFiles, getReferences, getSkills } from '../../api/client'

vi.mock('../../api/client', () => ({
  // v2 的文件条目只有 { path, type }
  listDirectory: vi.fn().mockResolvedValue([
    { path: 'src', type: 'directory' },
    { path: 'README.md', type: 'file' },
  ]),
  searchFiles: vi.fn().mockResolvedValue(['src/components/Button.tsx']),
  getReferences: vi.fn().mockResolvedValue([]),
  getSkills: vi.fn().mockResolvedValue([
    { id: 'commit', name: 'Commit', description: '生成 commit', path: '/s/commit.md', content: '' },
    { id: 'review-pr', name: 'Review PR', description: '审查 PR', path: '/s/review.md', content: '' },
  ]),
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
    vi.mocked(getReferences).mockResolvedValue([])
    vi.mocked(getSkills).mockResolvedValue([
      { id: 'commit', name: 'Commit', description: '生成 commit', path: '/s/commit.md', content: '' },
      { id: 'review-pr', name: 'Review PR', description: '审查 PR', path: '/s/review.md', content: '' },
    ])
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

  it('shows references at root and hides hidden ones', async () => {
    vi.mocked(getReferences).mockResolvedValue([
      { name: 'shared-lib', path: '/external/shared-lib', source: { type: 'local', path: '/external/shared-lib' } } as never,
      { name: 'secret-ref', path: '/external/secret', hidden: true, source: { type: 'local', path: '/external/secret' } } as never,
    ])

    render(
      <div>
        <MentionMenu
          isOpen={true}
          query=""
          agents={[]}
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
    // references 异步到达后再让列表重建一轮
    await act(async () => {
      vi.advanceTimersByTime(32)
      await Promise.resolve()
    })

    expect(screen.getByText('shared-lib')).toBeInTheDocument()
    expect(screen.queryByText('secret-ref')).not.toBeInTheDocument()
  })

  it('根目录列出技能（官方 composer/model.ts:193-205 同款：label @skill.id）', async () => {
    render(
      <div>
        <MentionMenu isOpen={true} query="" agents={[]} rootPath="/workspace/project" onSelect={vi.fn()} onClose={vi.fn()} />
      </div>,
    )

    await act(async () => {
      vi.advanceTimersByTime(32)
      await Promise.resolve()
    })
    await act(async () => {
      vi.advanceTimersByTime(32)
      await Promise.resolve()
    })

    expect(screen.getByText('Commit')).toBeInTheDocument()
    expect(screen.getByText('Review PR')).toBeInTheDocument()
  })

  it('搜索态按 id/name 过滤技能', async () => {
    render(
      <div>
        <MentionMenu isOpen={true} query="rev" agents={[]} rootPath="/workspace/project" onSelect={vi.fn()} onClose={vi.fn()} />
      </div>,
    )

    await act(async () => {
      vi.advanceTimersByTime(32)
      await Promise.resolve()
    })
    await act(async () => {
      vi.advanceTimersByTime(32)
      await Promise.resolve()
    })

    expect(screen.getByText('Review PR')).toBeInTheDocument()
    expect(screen.queryByText('Commit')).not.toBeInTheDocument()
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
