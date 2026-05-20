import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MessageRenderer } from './MessageRenderer'
import type { Message } from '../../types/message'

const { useModelsMock, useThemeMock } = vi.hoisted(() => ({
  useModelsMock: vi.fn(),
  useThemeMock: vi.fn(),
}))

vi.mock('motion/mini', () => ({
  animate: () => Promise.resolve(),
}))

vi.mock('../../hooks', () => ({
  useDelayedRender: (show: boolean) => show,
  useModels: useModelsMock,
}))

vi.mock('../../hooks/useTheme', () => ({
  useTheme: useThemeMock,
}))

vi.mock('../../components/ui', () => ({
  CopyButton: ({ text }: { text: string }) => <button type="button">copy:{text}</button>,
  SmoothHeight: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock('./parts', () => ({
  TextPartView: ({ part }: { part: { text: string } }) => <div>{part.text}</div>,
  ReasoningPartView: () => null,
  ToolPartView: () => null,
  FilePartView: () => null,
  AgentPartView: () => null,
  SyntheticTextPartView: () => null,
  StepFinishPartView: ({ modelLabel }: { modelLabel?: string }) => (
    <div>{modelLabel ? `step-finish-model:${modelLabel}` : 'step-finish-model:undefined'}</div>
  ),
  SubtaskPartView: () => null,
  RetryPartView: () => null,
  CompactionPartView: () => <div>History compacted</div>,
  MessageErrorView: () => null,
}))

function createThemeOverrides(overrides?: Record<string, unknown>) {
  return {
    collapseUserMessages: false,
    stepFinishDisplay: {
      agent: false,
      model: false,
      tokens: false,
      cache: false,
      cost: false,
      duration: false,
      turnDuration: false,
      completedAt: false,
    },
    completedAtFormat: 'absolute',
    modelLabelFormat: 'code',
    descriptiveToolSteps: false,
    inlineToolRequests: false,
    immersiveMode: false,
    ...overrides,
  }
}

function createAssistantMessage(): Message {
  return {
    info: {
      id: 'assistant-1',
      sessionID: 'session-1',
      role: 'assistant',
      parentID: 'user-1',
      modelID: 'model-1',
      providerID: 'provider-1',
      mode: 'chat',
      agent: 'build',
      path: { cwd: '/workspace', root: '/workspace' },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      time: { created: 1 },
    },
    parts: [
      {
        id: 'text-1',
        sessionID: 'session-1',
        messageID: 'assistant-1',
        type: 'text',
        text: 'assistant reply',
      },
    ],
    isStreaming: false,
  }
}

function createStepFinishPart() {
  return {
    id: 'step-finish-1',
    sessionID: 'session-1',
    messageID: 'assistant-1',
    type: 'step-finish' as const,
    reason: 'stop',
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
  }
}

function createToolPart() {
  return {
    id: 'tool-1',
    sessionID: 'session-1',
    messageID: 'assistant-1',
    type: 'tool' as const,
    callID: 'call-1',
    tool: 'bash',
    state: {
      status: 'completed' as const,
      input: { command: 'pwd' },
      output: '/workspace',
      title: 'Ran bash',
      metadata: {},
      time: { start: 1, end: 2 },
    },
  }
}

function createUserMessage(): Message {
  return {
    info: {
      id: 'user-1',
      sessionID: 'session-1',
      role: 'user',
      time: { created: 1 },
      agent: 'build',
      model: { modelID: 'model-1', providerID: 'provider-1' },
    },
    parts: [],
    isStreaming: false,
  }
}

describe('MessageRenderer assistant fork', () => {
  beforeEach(() => {
    useModelsMock.mockReset()
    useThemeMock.mockReset()

    useModelsMock.mockReturnValue({ models: [], isLoading: false, error: null, refetch: vi.fn() })
    useThemeMock.mockImplementation(() => createThemeOverrides())
  })

  it('passes the explicit fork target id when forking an assistant message', async () => {
    const onFork = vi.fn()
    const message = createAssistantMessage()

    render(<MessageRenderer message={message} onFork={onFork} forkMessageId="assistant-2" />)

    fireEvent.click(screen.getByRole('button', { name: /fork|分叉/i }))

    await waitFor(() => {
      expect(onFork).toHaveBeenCalledWith(message, 'assistant-2')
    })
  })

  it('hides fork when the assistant message has no copyable text', () => {
    const onFork = vi.fn()
    const message = createAssistantMessage()
    message.parts = [
      {
        id: 'text-blank',
        sessionID: 'session-1',
        messageID: 'assistant-1',
        type: 'text',
        text: '   ',
      },
    ]

    render(<MessageRenderer message={message} onFork={onFork} forkMessageId="assistant-2" />)

    expect(screen.queryByRole('button', { name: /fork|分叉/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /copy/i })).toBeNull()
  })

  it('renders compaction parts inside user messages', () => {
    const message = createUserMessage()
    message.parts = [
      {
        id: 'compaction-1',
        sessionID: 'session-1',
        messageID: 'user-1',
        type: 'compaction',
        auto: true,
      },
    ]

    render(<MessageRenderer message={message} />)

    expect(screen.getByText('History compacted')).toBeInTheDocument()
  })

  it('uses raw assistantInfo.modelID for step-finish model label in code mode', () => {
    const message = createAssistantMessage()
    message.parts = [createStepFinishPart()]

    useThemeMock.mockImplementation(() =>
      createThemeOverrides({
        stepFinishDisplay: {
          agent: false,
          model: true,
          tokens: false,
          cache: false,
          cost: false,
          duration: false,
          turnDuration: false,
          completedAt: false,
        },
        modelLabelFormat: 'code',
      }),
    )
    useModelsMock.mockReturnValue({
      models: [{ id: 'model-1', providerId: 'provider-1', name: 'Resolved Name' }],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })

    render(<MessageRenderer message={message} />)

    expect(screen.getByText('step-finish-model:model-1')).toBeInTheDocument()
  })

  it('uses resolved model.name for step-finish model label in name mode', () => {
    const message = createAssistantMessage()
    message.parts = [createStepFinishPart()]

    useThemeMock.mockImplementation(() =>
      createThemeOverrides({
        stepFinishDisplay: {
          agent: false,
          model: true,
          tokens: false,
          cache: false,
          cost: false,
          duration: false,
          turnDuration: false,
          completedAt: false,
        },
        modelLabelFormat: 'name',
      }),
    )
    useModelsMock.mockReturnValue({
      models: [{ id: 'model-1', providerId: 'provider-1', name: 'Resolved Name' }],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })

    render(<MessageRenderer message={message} />)

    expect(screen.getByText('step-finish-model:Resolved Name')).toBeInTheDocument()
  })

  it('passes the resolved model label through the grouped tool footer step-finish path', () => {
    const message = createAssistantMessage()
    message.parts = [createToolPart(), createStepFinishPart()]

    useThemeMock.mockImplementation(() =>
      createThemeOverrides({
        stepFinishDisplay: {
          agent: false,
          model: true,
          tokens: false,
          cache: false,
          cost: false,
          duration: false,
          turnDuration: false,
          completedAt: false,
        },
        modelLabelFormat: 'name',
      }),
    )
    useModelsMock.mockReturnValue({
      models: [{ id: 'model-1', providerId: 'provider-1', name: 'Grouped Tool Model' }],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })

    render(<MessageRenderer message={message} />)

    expect(screen.getByText('step-finish-model:Grouped Tool Model')).toBeInTheDocument()
  })

  it('uses the provider-specific model name when duplicate model ids exist in name mode', () => {
    const message = createAssistantMessage()
    message.parts = [createStepFinishPart()]

    useThemeMock.mockImplementation(() =>
      createThemeOverrides({
        stepFinishDisplay: {
          agent: false,
          model: true,
          tokens: false,
          cache: false,
          cost: false,
          duration: false,
          turnDuration: false,
          completedAt: false,
        },
        modelLabelFormat: 'name',
      }),
    )
    useModelsMock.mockReturnValue({
      models: [
        { id: 'model-1', providerId: 'provider-2', name: 'Wrong Provider Name' },
        { id: 'model-1', providerId: 'provider-1', name: 'Correct Provider Name' },
      ],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })

    render(<MessageRenderer message={message} />)

    expect(screen.getByText('step-finish-model:Correct Provider Name')).toBeInTheDocument()
    expect(screen.queryByText('step-finish-model:Wrong Provider Name')).toBeNull()
  })

  it('falls back to assistantInfo.modelID when name mode has an empty model list', () => {
    const message = createAssistantMessage()
    message.parts = [createStepFinishPart()]

    useThemeMock.mockImplementation(() =>
      createThemeOverrides({
        stepFinishDisplay: {
          agent: false,
          model: true,
          tokens: false,
          cache: false,
          cost: false,
          duration: false,
          turnDuration: false,
          completedAt: false,
        },
        modelLabelFormat: 'name',
      }),
    )
    useModelsMock.mockReturnValue({ models: [], isLoading: false, error: null, refetch: vi.fn() })

    render(<MessageRenderer message={message} />)

    expect(screen.getByText('step-finish-model:model-1')).toBeInTheDocument()
  })
})
