import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MessageRenderer,
  messageHasFinalContent,
  messageHasProcessContent,
  splitProcessRenderItems,
} from './MessageRenderer'
import type {
  AssistantContent,
  AssistantMessage,
  PromptFileAttachment,
  SessionMessageInfo,
  UserMessage,
} from '../../types/api/message'

let mockRenderUserMarkdown = false
let mockCollapseUserMessages = false

vi.mock('motion/mini', () => ({
  animate: () => Promise.resolve(),
}))

vi.mock('../../hooks', () => ({
  useDelayedRender: (show: boolean) => show,
  useDisclosureScrollLock: () => ({
    rootRef: () => undefined,
    headerRef: () => undefined,
    withScrollLock: (action: () => void) => action(),
  }),
}))

vi.mock('../../hooks/useInputCapabilities', () => ({
  useInputCapabilities: () => ({ preferTouchUi: false, canHover: true, hasCoarsePointer: false, hasTouch: false }),
}))

vi.mock('../../hooks/useTheme', () => ({
  useTheme: () => ({
    collapseUserMessages: mockCollapseUserMessages,
    renderUserMarkdown: mockRenderUserMarkdown,
    stepFinishDisplay: {
      latestOnly: true,
      turnDuration: false,
      tokens: true,
      cache: true,
      cost: true,
      duration: true,
      agent: false,
      model: false,
      completedAt: false,
    },
    actionsOnLatestAssistantOnly: true,
    descriptiveToolSteps: false,
    inlineToolRequests: false,
    immersiveMode: false,
  }),
}))

vi.mock('../../components/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div data-testid="user-markdown">{content}</div>,
}))

vi.mock('../../components/ui', () => ({
  CopyButton: ({ text }: { text: string }) => <button type="button">copy:{text}</button>,
  SmoothHeight: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock('./parts', () => ({
  TextPartView: ({ part }: { part: { text: string } }) => <div>{part.text}</div>,
  ReasoningPartView: () => null,
  ToolPartView: () => null,
  FilePartView: ({ file }: { file: { name?: string; mime: string } }) => (
    <div data-testid="file-part">{file.name ?? file.mime}</div>
  ),
  AgentPartView: ({ agent }: { agent: { name: string } }) => <div data-testid="agent-part">{agent.name}</div>,
  StepFinishPartView: () => null,
  RetryPartView: () => null,
  CompactionPartView: ({ message }: { message: { status?: string } }) =>
    message.status ? <div>History compacted</div> : null,
  MessageErrorView: () => null,
}))

/**
 * 原生助手消息工厂。
 *
 * v2 里时间戳决定「是否仍在流式」（`time.completed == null`），
 * 不再有 v1 的 `isStreaming` 字段。
 */
function createAssistantMessage(content: AssistantContent[] = [], completed?: number): AssistantMessage {
  return {
    type: 'assistant',
    id: 'assistant-1',
    agent: 'build',
    model: { id: 'model-1', providerID: 'provider-1' },
    content,
    time: completed == null ? { created: 1 } : { created: 1, completed },
  }
}

function createUserMessage(): UserMessage {
  return {
    type: 'user',
    id: 'user-1',
    time: { created: 1 },
    text: '',
  }
}

function createUserTextMessage(text: string): UserMessage {
  return { ...createUserMessage(), text }
}

function textContent(text: string): AssistantContent {
  return { type: 'text', text }
}

describe('MessageRenderer assistant fork', () => {
  beforeEach(() => {
    mockRenderUserMarkdown = false
    mockCollapseUserMessages = false
  })

  it('passes the explicit fork target id when forking an assistant message', async () => {
    const onFork = vi.fn()
    const message = createAssistantMessage([textContent('assistant reply')], 2)

    render(<MessageRenderer message={message} onFork={onFork} forkMessageId="assistant-2" />)

    fireEvent.click(screen.getByRole('button', { name: /fork|分叉/i }))

    await waitFor(() => {
      expect(onFork).toHaveBeenCalledWith(message, 'assistant-2')
    })
  })

  it('hides fork when the assistant message has no copyable text', () => {
    const onFork = vi.fn()
    const message = createAssistantMessage([textContent('   ')], 2)

    render(<MessageRenderer message={message} onFork={onFork} forkMessageId="assistant-2" />)

    expect(screen.queryByRole('button', { name: /fork|分叉/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /copy/i })).toBeNull()
  })

  it('renders compaction messages as a standalone message', () => {
    const message: SessionMessageInfo = {
      type: 'compaction',
      id: 'compaction-1',
      status: 'completed',
      reason: 'auto',
      summary: 'summary',
      recent: 'recent',
      time: { created: 1 },
    }

    render(<MessageRenderer message={message} />)

    expect(screen.getByText('History compacted')).toBeInTheDocument()
  })

  it('renders user attachments from the native files array', () => {
    const file: PromptFileAttachment = {
      data: 'aGVsbG8=',
      mime: 'text/plain',
      source: { type: 'uri', uri: 'file:///workspace/notes.txt' },
      name: 'notes.txt',
    }
    const message: UserMessage = { ...createUserTextMessage('see attachment'), files: [file] }

    render(<MessageRenderer message={message} />)

    expect(screen.getByTestId('file-part')).toHaveTextContent('notes.txt')
  })

  it('renders agent mentions from the native agents array', () => {
    const message: UserMessage = { ...createUserTextMessage('ping agent'), agents: [{ name: 'explore' }] }

    render(<MessageRenderer message={message} />)

    expect(screen.getByTestId('agent-part')).toHaveTextContent('explore')
  })

  it('keeps user text plain by default', () => {
    render(<MessageRenderer message={createUserTextMessage('Use **bold** text')} />)

    expect(screen.queryByTestId('user-markdown')).toBeNull()
    expect(screen.getByText('Use **bold** text')).toBeInTheDocument()
  })

  it('renders user text through markdown when enabled', () => {
    mockRenderUserMarkdown = true

    render(<MessageRenderer message={createUserTextMessage('Use **bold** text')} />)

    expect(screen.getByTestId('user-markdown')).toHaveTextContent('Use **bold** text')
  })

  it('does not crop an interactive user HTML artifact to the collapsed preview height', () => {
    mockRenderUserMarkdown = true
    mockCollapseUserMessages = true
    const message = createUserTextMessage(
      '<section><style>section{height:380px}</style><canvas></canvas><script>requestAnimationFrame(()=>{})</script></section>',
    )

    render(<MessageRenderer message={message} />)

    const container = screen.getByTestId('user-markdown').parentElement!
    expect(container.style.maxHeight).toBe('')
    expect(container.style.contain).toBe('')
    expect(screen.getByTestId('user-markdown').closest('.bg-bg-300')).toHaveClass('w-full', 'max-w-2xl')
    expect(screen.getByTestId('user-markdown').closest('.group')).toHaveClass('w-full')
    expect(screen.getByTestId('user-markdown').closest('[data-user-html-artifact]')).toBeInTheDocument()
  })

  it('clamps a collapsible non-artifact user message with layout isolation', () => {
    mockRenderUserMarkdown = true
    mockCollapseUserMessages = true
    render(<MessageRenderer message={createUserTextMessage('just some plain text')} />)

    const container = screen.getByTestId('user-markdown').parentElement!
    expect(container.style.maxHeight).not.toBe('')
    expect(container.style.contain).toBe('layout paint')
  })
})

describe('process content split', () => {
  it('keeps streaming assistant as process-only until completed', () => {
    // time.completed == null → 仍在流式
    const streaming = createAssistantMessage([textContent('partial')])

    expect(messageHasProcessContent(streaming)).toBe(true)
    expect(messageHasFinalContent(streaming)).toBe(false)
  })

  it('splits completed tool+text into process and final', () => {
    const message = createAssistantMessage(
      [
        {
          type: 'tool',
          id: 'tool-1',
          name: 'bash',
          state: {
            status: 'completed',
            input: { command: 'pwd' },
            content: [{ type: 'text', text: '/workspace' }],
            metadata: { title: 'pwd' },
          },
          time: { created: 1, completed: 2 },
        },
        textContent('done'),
      ],
      2,
    )

    expect(messageHasProcessContent(message)).toBe(true)
    expect(messageHasFinalContent(message)).toBe(true)

    // splitProcessRenderItems is covered via scope rendering; pure text has final only
    const plain = createAssistantMessage([textContent('hello')], 2)
    expect(messageHasProcessContent(plain)).toBe(false)
    expect(messageHasFinalContent(plain)).toBe(true)
    void splitProcessRenderItems
  })
})
