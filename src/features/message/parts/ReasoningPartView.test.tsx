import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReasoningPartView } from './ReasoningPartView'
import type { AssistantReasoning } from '../../../types/api/message'

let mockReasoningDisplayMode: 'italic' | 'markdown' | 'capsule' = 'italic'

vi.mock('../../../hooks', () => ({
  useDelayedRender: (show: boolean) => show,
  useDisclosureScrollLock: () => ({
    rootRef: () => undefined,
    headerRef: () => undefined,
    withScrollLock: (action: () => void) => action(),
  }),
}))

vi.mock('../../../hooks/useTheme', () => ({
  useTheme: () => ({ reasoningDisplayMode: mockReasoningDisplayMode }),
}))

vi.mock('../../../components/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div data-testid="markdown-content">{content}</div>,
}))

function createReasoning(
  text: string,
  time: { created: number; completed?: number } = { created: 1 },
): AssistantReasoning {
  return { type: 'reasoning', text, time }
}

describe('ReasoningPartView', () => {
  beforeEach(() => {
    mockReasoningDisplayMode = 'italic'
    vi.useFakeTimers()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb =>
      window.setTimeout(() => cb(performance.now()), 16),
    )
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => {
      clearTimeout(id)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('auto-expands while streaming in italic mode', () => {
    // completed 缺失 = 该段推理仍在生成
    const part = createReasoning('thinking through steps...', { created: 1 })

    render(<ReasoningPartView part={part} partID="message-1:reasoning:0" isStreaming={true} />)

    act(() => {
      vi.advanceTimersByTime(32)
    })

    expect(screen.getByRole('button', { expanded: true })).toBeInTheDocument()
    const thinking = screen.getByText('Thinking...')
    expect(thinking).toBeInTheDocument()
    expect(thinking.className).toContain('reasoning-shimmer-text')
    expect(thinking.className).toContain('inline-block')
    expect(thinking.className).toContain('italic')
    expect(thinking.className).not.toContain('text-text-200')
    expect(screen.getAllByText('thinking through steps...').length).toBeGreaterThan(0)
    expect(screen.queryByTestId('markdown-content')).not.toBeInTheDocument()
  })

  it('renders markdown content in markdown reasoning mode', () => {
    mockReasoningDisplayMode = 'markdown'

    const part = createReasoning('Use **bold** and `code` here', { created: 1, completed: 100 })

    render(<ReasoningPartView part={part} partID="message-1:reasoning:0" isStreaming={false} />)

    expect(screen.getByTestId('markdown-content')).toHaveTextContent('Use **bold** and `code` here')
  })

  it('renders collapsed markdown preview for multiline content', () => {
    mockReasoningDisplayMode = 'markdown'

    const part = createReasoning('First line with **bold**\nSecond line with `code`', { created: 1, completed: 100 })

    render(<ReasoningPartView part={part} partID="message-1:reasoning:0" isStreaming={false} />)

    act(() => {
      vi.advanceTimersByTime(32)
    })

    expect(screen.getByRole('button', { expanded: false })).toBeInTheDocument()
    // 折叠时只渲染第一行 markdown（展开体未挂载），因此只有一个 markdown 节点
    const markdown = screen.getAllByTestId('markdown-content')[0]
    expect(markdown).toHaveTextContent('First line with **bold**')
    expect(markdown).not.toHaveTextContent('Second line')
  })

  it('renders single-line content without toggle button', () => {
    const part = createReasoning('short', { created: 1, completed: 100 })

    render(<ReasoningPartView part={part} partID="message-1:reasoning:0" isStreaming={false} />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getAllByText('short').length).toBeGreaterThan(0)
  })
})
