import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectDialog } from './ProjectDialog'
import { getPath, listDirectory } from '../../api'

vi.mock('../../components/ui/Dialog', () => ({
  Dialog: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) =>
    isOpen ? <div>{children}</div> : null,
}))

vi.mock('../../api', () => ({
  // v2 的 LocationPublicInfo 没有 home，只有 directory
  getPath: vi.fn().mockResolvedValue({ directory: '/workspace/project' }),
  // v2 的文件条目只有 { path, type }
  listDirectory: vi.fn().mockResolvedValue([
    { path: '.config', type: 'directory' },
    { path: 'src', type: 'directory' },
    { path: 'docs', type: 'directory' },
  ]),
}))

describe('ProjectDialog', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('initializes from path api and loads directory entries', async () => {
    render(<ProjectDialog isOpen={true} onClose={vi.fn()} onSelect={vi.fn()} />)

    expect(await screen.findByDisplayValue('/workspace/project/')).toBeInTheDocument()
    expect(await screen.findByText('.config')).toBeInTheDocument()
    expect(await screen.findByText('src')).toBeInTheDocument()
    expect(await screen.findByText('docs')).toBeInTheDocument()

    expect(screen.getByText('Add current')).toBeInTheDocument()
  })

  it('reloads the same directory when reopened', async () => {
    const { rerender } = render(<ProjectDialog key="first" isOpen={true} onClose={vi.fn()} onSelect={vi.fn()} />)

    expect(await screen.findByText('src')).toBeInTheDocument()

    rerender(<ProjectDialog key="closed" isOpen={false} onClose={vi.fn()} onSelect={vi.fn()} />)
    rerender(<ProjectDialog key="second" isOpen={true} onClose={vi.fn()} onSelect={vi.fn()} />)

    await waitFor(() => expect(vi.mocked(getPath).mock.calls.length).toBeGreaterThanOrEqual(2))
    await waitFor(() => expect(vi.mocked(listDirectory).mock.calls.length).toBeGreaterThanOrEqual(2))
    expect(await screen.findByText('src')).toBeInTheDocument()
  })
})
