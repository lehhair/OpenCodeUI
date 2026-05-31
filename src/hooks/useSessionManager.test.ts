import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionManager } from './useSessionManager'
import { layoutStore, messageStore } from '../store'
import type { ApiMessageWithParts, ApiSession } from '../api/types'

const { getSessionMock, getSessionMessagesMock, revertMessageMock, unrevertSessionMock, sessionErrorHandlerMock } =
  vi.hoisted(() => ({
    getSessionMock: vi.fn(),
    getSessionMessagesMock: vi.fn(),
    revertMessageMock: vi.fn(),
    unrevertSessionMock: vi.fn(),
    sessionErrorHandlerMock: vi.fn(),
  }))

vi.mock('../api', () => ({
  getSession: getSessionMock,
  getSessionMessages: getSessionMessagesMock,
  revertMessage: revertMessageMock,
  unrevertSession: unrevertSessionMock,
  extractUserMessageContent: vi.fn(() => ({ text: '', attachments: [] })),
}))

vi.mock('../utils', () => ({
  sessionErrorHandler: sessionErrorHandlerMock,
}))

vi.mock('../utils/logger', () => ({
  logger: {
    log: vi.fn(),
  },
}))

function session(id: string, directory = '/workspace/demo'): ApiSession {
  return {
    id,
    title: `${id} title`,
    directory,
  } as ApiSession
}

function userApiMessage(sessionId: string, index: number, text = `${sessionId} message ${index}`): ApiMessageWithParts {
  const id = `${sessionId}-user-${index}`
  return {
    info: {
      id,
      sessionID: sessionId,
      role: 'user',
      time: { created: index },
      agent: 'build',
      model: { providerID: 'provider-1', modelID: 'model-1' },
    },
    parts: [
      {
        id: `${id}-text`,
        sessionID: sessionId,
        messageID: id,
        type: 'text',
        text,
      },
    ],
  } as ApiMessageWithParts
}

function streamingAssistantApiMessage(sessionId: string, index: number): ApiMessageWithParts {
  const id = `${sessionId}-assistant-${index}`
  return {
    info: {
      id,
      sessionID: sessionId,
      role: 'assistant',
      time: { created: index },
    },
    parts: [
      {
        id: `${id}-text`,
        sessionID: sessionId,
        messageID: id,
        type: 'text',
        text: 'streaming response',
      },
    ],
  } as ApiMessageWithParts
}

function messages(sessionId: string, count: number): ApiMessageWithParts[] {
  return Array.from({ length: count }, (_, index) => userApiMessage(sessionId, index + 1))
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('useSessionManager full conversation navigation loading', () => {
  beforeEach(() => {
    getSessionMock.mockReset()
    getSessionMessagesMock.mockReset()
    revertMessageMock.mockReset()
    unrevertSessionMock.mockReset()
    sessionErrorHandlerMock.mockReset()

    messageStore.clearAll()
    layoutStore.setAlwaysLoadFullConversationNavigation(false)
  })

  afterEach(() => {
    messageStore.clearAll()
    layoutStore.setAlwaysLoadFullConversationNavigation(false)
  })

  it('keeps disabled initial load limited to 50 messages and preserves lazy history cursor behavior', async () => {
    getSessionMock.mockResolvedValue(session('ses-limited'))
    getSessionMessagesMock
      .mockResolvedValueOnce(messages('ses-limited', 50))
      .mockResolvedValueOnce(messages('ses-limited', 65))

    const { result } = renderHook(() => useSessionManager({ sessionId: 'ses-limited', directory: '/workspace/demo' }))

    await waitFor(() => {
      expect(messageStore.getSessionState('ses-limited')?.loadState).toBe('loaded')
    })

    expect(getSessionMessagesMock).toHaveBeenNthCalledWith(1, 'ses-limited', 50, '/workspace/demo')
    expect(messageStore.getSessionState('ses-limited')?.hasMoreHistory).toBe(true)

    await act(async () => {
      await result.current.loadMoreHistory()
    })

    expect(getSessionMessagesMock).toHaveBeenNthCalledWith(2, 'ses-limited', 65, '/workspace/demo')
  })

  it('loads all messages with an undefined limit and disables more-history after full navigation load', async () => {
    layoutStore.setAlwaysLoadFullConversationNavigation(true)
    getSessionMock.mockResolvedValue(session('ses-full'))
    getSessionMessagesMock.mockResolvedValue(messages('ses-full', 60))

    renderHook(() => useSessionManager({ sessionId: 'ses-full', directory: '/workspace/demo' }))

    await waitFor(() => {
      expect(messageStore.getSessionState('ses-full')?.loadState).toBe('loaded')
    })

    expect(getSessionMessagesMock).toHaveBeenCalledWith('ses-full', undefined, '/workspace/demo')
    expect(messageStore.getSessionState('ses-full')?.messages).toHaveLength(60)
    expect(messageStore.getSessionState('ses-full')?.hasMoreHistory).toBe(false)
  })

  it('uses the full-load limit for streaming metadata refresh without overwriting local streaming messages', async () => {
    layoutStore.setAlwaysLoadFullConversationNavigation(true)
    messageStore.setMessages('ses-streaming', [
      userApiMessage('ses-streaming', 1, 'local prompt'),
      streamingAssistantApiMessage('ses-streaming', 2),
    ])
    getSessionMock.mockResolvedValue(session('ses-streaming'))
    getSessionMessagesMock.mockResolvedValue([userApiMessage('ses-streaming', 1, 'api prompt')])

    const { result } = renderHook(() => useSessionManager({ sessionId: null, directory: '/workspace/demo' }))

    await act(async () => {
      await result.current.loadSession('ses-streaming')
    })

    await waitFor(() => {
      expect(getSessionMessagesMock).toHaveBeenCalledWith('ses-streaming', undefined, '/workspace/demo')
    })

    const state = messageStore.getSessionState('ses-streaming')
    expect(state?.messages).toHaveLength(2)
    expect(state?.messages.at(-1)?.info.id).toBe('ses-streaming-assistant-2')
    expect(state?.hasMoreHistory).toBe(false)
  })

  it('does not let stale responses from a previous active session overwrite the current session', async () => {
    const sessionA = deferred<ApiSession>()
    const sessionB = deferred<ApiSession>()
    const messagesA = deferred<ApiMessageWithParts[]>()
    const messagesB = deferred<ApiMessageWithParts[]>()

    getSessionMock.mockImplementation((sid: string) => (sid === 'ses-a' ? sessionA.promise : sessionB.promise))
    getSessionMessagesMock.mockImplementation((sid: string) => (sid === 'ses-a' ? messagesA.promise : messagesB.promise))

    const { rerender } = renderHook(({ sessionId }) => useSessionManager({ sessionId, directory: '/workspace/demo' }), {
      initialProps: { sessionId: 'ses-a' },
    })

    await waitFor(() => {
      expect(getSessionMessagesMock).toHaveBeenCalledWith('ses-a', 50, '/workspace/demo')
    })

    rerender({ sessionId: 'ses-b' })

    await waitFor(() => {
      expect(getSessionMessagesMock).toHaveBeenCalledWith('ses-b', 50, '/workspace/demo')
    })

    await act(async () => {
      sessionA.resolve(session('ses-a'))
      messagesA.resolve(messages('ses-a', 1))
    })

    expect(messageStore.getSessionState('ses-a')?.loadState).toBe('loading')
    expect(messageStore.getSessionState('ses-a')?.messages).toHaveLength(0)

    await act(async () => {
      sessionB.resolve(session('ses-b'))
      messagesB.resolve(messages('ses-b', 1))
    })

    await waitFor(() => {
      expect(messageStore.getSessionState('ses-b')?.loadState).toBe('loaded')
    })

    expect(messageStore.getSessionState('ses-b')?.messages.map(message => message.info.id)).toEqual(['ses-b-user-1'])
  })
})
