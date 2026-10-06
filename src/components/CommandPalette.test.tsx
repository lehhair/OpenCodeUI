import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandPalette, type CommandItem } from './CommandPalette'

const { searchFilesMock } = vi.hoisted(() => ({ searchFilesMock: vi.fn() }))

vi.mock('../api', () => ({
  searchFiles: (...args: unknown[]) => searchFilesMock(...(args as [string, object])),
}))

describe('CommandPalette', () => {
  beforeEach(() => {
    searchFilesMock.mockReset()
    searchFilesMock.mockResolvedValue([])
    vi.useFakeTimers()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => {
      return window.setTimeout(() => cb(performance.now()), 0)
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => {
      clearTimeout(id)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('resets query when reopened and executes selected command', () => {
    const onClose = vi.fn()
    const action = vi.fn()
    const commands: CommandItem[] = [{ id: 'open-settings', label: 'Open Settings', action }]

    const { rerender } = render(<CommandPalette isOpen={false} onClose={onClose} commands={commands} />)

    rerender(<CommandPalette isOpen={true} onClose={onClose} commands={commands} />)
    act(() => {
      vi.runAllTimers()
    })

    const input = screen.getByPlaceholderText('Type a command...') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'settings' } })
    expect(input.value).toBe('settings')

    fireEvent.click(screen.getByText('Open Settings'))
    expect(onClose).toHaveBeenCalledTimes(1)

    act(() => {
      vi.runAllTimers()
    })
    expect(action).toHaveBeenCalledTimes(1)

    rerender(<CommandPalette isOpen={false} onClose={onClose} commands={commands} />)
    act(() => {
      vi.runAllTimers()
    })
    expect(screen.queryByPlaceholderText('Type a command...')).not.toBeInTheDocument()

    rerender(<CommandPalette isOpen={true} onClose={onClose} commands={commands} />)
    act(() => {
      vi.runAllTimers()
    })

    expect((screen.getByPlaceholderText('Type a command...') as HTMLInputElement).value).toBe('')
  })

  it('非空查询时附带会话与文件条目（官方 palette.ts 混合搜索同款）', async () => {
    searchFilesMock.mockResolvedValue(['src/App.tsx', 'src/main.tsx'])
    const onOpenSession = vi.fn()
    const onOpenFile = vi.fn()

    render(
      <CommandPalette
        isOpen={true}
        onClose={vi.fn()}
        commands={[]}
        sessions={[
          { id: 'ses-1', title: '修复登录 bug', directory: '/repo' },
          { id: 'ses-2', title: '不相关的会话' },
        ]}
        onOpenSession={onOpenSession}
        onOpenFile={onOpenFile}
        directory="/repo"
      />,
    )
    act(() => {
      vi.runAllTimers()
    })

    const input = screen.getByPlaceholderText('Type a command...') as HTMLInputElement
    fireEvent.change(input, { target: { value: '登录' } })
    await act(async () => {
      vi.advanceTimersByTime(300)
      await Promise.resolve()
    })

    // 会话条目（标题命中）出现，不相关的会话不出现
    expect(screen.getByText('修复登录 bug')).toBeInTheDocument()
    expect(screen.queryByText('不相关的会话')).not.toBeInTheDocument()
    // 分组标题
    expect(screen.getByText('Sessions')).toBeInTheDocument()

    // 点会话条目 → onOpenSession 带 id/directory
    fireEvent.click(screen.getByText('修复登录 bug'))
    act(() => {
      vi.runAllTimers()
    })
    expect(onOpenSession).toHaveBeenCalledWith({ id: 'ses-1', directory: '/repo' })
  })

  it('文件条目：防抖搜索后点选 → onOpenFile', async () => {
    searchFilesMock.mockResolvedValue(['src/App.tsx'])
    const onOpenFile = vi.fn()

    render(
      <CommandPalette isOpen={true} onClose={vi.fn()} commands={[]} onOpenFile={onOpenFile} directory="/repo" />,
    )
    act(() => {
      vi.runAllTimers()
    })

    const input = screen.getByPlaceholderText('Type a command...') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'App' } })
    await act(async () => {
      vi.advanceTimersByTime(300)
      await Promise.resolve()
    })

    expect(screen.getByText('src/App.tsx')).toBeInTheDocument()
    fireEvent.click(screen.getByText('src/App.tsx'))
    act(() => {
      vi.runAllTimers()
    })
    expect(onOpenFile).toHaveBeenCalledWith('src/App.tsx')
  })
})
