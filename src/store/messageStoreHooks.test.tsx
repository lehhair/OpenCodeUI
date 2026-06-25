import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiMessage, ApiMessageWithParts, ApiPart } from '../api/types'
import { messageStore } from './messageStore'
import { useSessionState } from './messageStoreHooks'

vi.mock('./paneLayoutStore', () => ({
  paneLayoutStore: {
    getFocusedSessionId: vi.fn(() => 'session-1'),
    subscribe: vi.fn(() => vi.fn()),
  },
}))

function createUserMessage(id: string, created: number): ApiMessage {
  return {
    id,
    sessionID: 'session-1',
    role: 'user',
    time: { created },
    agent: 'build',
    model: { providerID: 'provider-1', modelID: 'model-1' },
  }
}

function createTextPart(
  id: string,
  messageID: string,
  text: string,
): ApiPart & { sessionID: string; messageID: string } {
  return {
    id,
    sessionID: 'session-1',
    messageID,
    type: 'text',
    text,
  }
}

function createMessageWithParts(id: string, text: string, created: number): ApiMessageWithParts {
  return {
    info: createUserMessage(id, created),
    parts: [createTextPart(`part-${id}`, id, text)],
  }
}

describe('useSessionState', () => {
  beforeEach(() => {
    messageStore.clearAll()
  })

  it('returns only visible messages after revert', () => {
    messageStore.setMessages('session-1', [
      createMessageWithParts('message-1', 'one', 1),
      createMessageWithParts('message-2', 'two', 2),
      createMessageWithParts('message-3', 'three', 3),
    ])
    messageStore.setRevertState('session-1', {
      messageId: 'message-2',
      history: [],
    })

    const { result } = renderHook(() => useSessionState('session-1'))

    expect(result.current?.messages.map(message => message.info.id)).toEqual(['message-1'])
    expect(result.current?.canUndo).toBe(true)
  })

  it('disables undo when no visible user messages remain', () => {
    messageStore.setMessages('session-1', [createMessageWithParts('message-1', 'one', 1)])
    messageStore.setRevertState('session-1', {
      messageId: 'message-1',
      history: [],
    })

    const { result } = renderHook(() => useSessionState('session-1'))

    expect(result.current?.messages).toEqual([])
    expect(result.current?.canUndo).toBe(false)
  })

  it('does not re-render when another session changes', async () => {
    messageStore.setMessages('session-1', [createMessageWithParts('message-1', 'one', 1)])
    messageStore.setMessages('session-2', [
      {
        info: { ...createUserMessage('message-2', 2), sessionID: 'session-2' },
        parts: [{ ...createTextPart('part-message-2', 'message-2', 'two'), sessionID: 'session-2' }],
      },
    ])

    let renderCount = 0
    const { result } = renderHook(() => {
      renderCount += 1
      return useSessionState('session-1')
    })
    expect(result.current?.messages.map(message => message.info.id)).toEqual(['message-1'])

    messageStore.handlePartUpdated({
      ...createTextPart('part-message-2', 'message-2', 'two updated'),
      sessionID: 'session-2',
    })
    await new Promise(resolve => requestAnimationFrame(resolve))

    expect(renderCount).toBe(1)
    expect(result.current?.messages.map(message => message.info.id)).toEqual(['message-1'])
  })
})
