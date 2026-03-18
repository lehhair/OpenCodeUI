import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReasoningPartView } from './ReasoningPartView'
import type { ReasoningPart } from '../../../types/message'

vi.mock('../../../hooks', () => ({
  useDelayedRender: (show: boolean) => show,
}))

vi.mock('../../../hooks/useTheme', () => ({
  useTheme: () => ({ reasoningDisplayMode: 'italic' }),
}))

vi.mock('../../../components/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div data-testid="markdown-content">{content}</div>,
}))

describe('ReasoningPartView', () => {
  beforeEach(() => {
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
    const part = {
      id: 'reason-1',
      sessionID: 'session-1',
      messageID: 'message-1',
      type: 'reasoning',
      text: 'thinking through steps...',
      time: { start: 1 },
    } as unknown as ReasoningPart

    render(<ReasoningPartView part={part} isStreaming={true} />)

    act(() => {
      vi.advanceTimersByTime(32)
    })

    expect(screen.getByRole('button', { expanded: true })).toBeInTheDocument()
    expect(screen.getByText('Thinking...')).toBeInTheDocument()
    expect(screen.getByTestId('markdown-content')).toHaveTextContent('thinking through steps...')
  })

  it('renders markdown content with formatting', () => {
    const part = {
      id: 'reason-2',
      sessionID: 'session-1',
      messageID: 'message-1',
      type: 'reasoning',
      text: 'Use **bold** and `code` here',
      time: { start: 1, end: 100 },
    } as unknown as ReasoningPart

    render(<ReasoningPartView part={part} isStreaming={false} />)

    expect(screen.getByTestId('markdown-content')).toHaveTextContent('Use **bold** and `code` here')
  })

  it('renders single-line content without toggle button', () => {
    const part = {
      id: 'reason-3',
      sessionID: 'session-1',
      messageID: 'message-1',
      type: 'reasoning',
      text: 'short',
      time: { start: 1, end: 100 },
    } as unknown as ReasoningPart

    render(<ReasoningPartView part={part} isStreaming={false} />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByTestId('markdown-content')).toHaveTextContent('short')
  })
})
