import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssistantMessage, UserMessage } from '../api/types'
import { messageStore } from './messageStore'
import {
  useHasMessages,
  useHeaderSessionMeta,
  useMessageStore,
  useMessageStoreSelector,
  useSessionState,
} from './messageStoreHooks'
import { paneLayoutStore } from './paneLayoutStore'

// ============================================
// 原生（v2）语义说明
//
// store 里存的是**原生** `SessionMessageInfo`（消息自带 content，
// 没有 `{ info, parts }`），因此工厂与断言都按原生形状写；
// 「同一条消息内容变化」用 handleMessageContent（权威 content 快照）。
// ============================================

const { paneLayoutListeners } = vi.hoisted(() => ({
  paneLayoutListeners: new Set<() => void>(),
}))

vi.mock('./paneLayoutStore', () => ({
  paneLayoutStore: {
    getFocusedSessionId: vi.fn(() => 'session-1'),
    subscribe: vi.fn((cb: () => void) => {
      paneLayoutListeners.add(cb)
      return () => paneLayoutListeners.delete(cb)
    }),
  },
}))

function createUserMessage(id: string, created: number): UserMessage {
  return {
    id,
    type: 'user',
    time: { created },
    text: id,
  }
}

function createAssistantMessage(id: string, text: string, created: number): AssistantMessage {
  return {
    id,
    type: 'assistant',
    agent: 'build',
    model: { id: 'model-1', providerID: 'provider-1' },
    content: [{ type: 'text', text }],
    time: { created },
  }
}

function textContent(text: string): AssistantMessage['content'] {
  return [{ type: 'text', text }]
}

function messageText(sessionId: string, messageId: string): string | undefined {
  const message = messageStore.getSessionState(sessionId)?.messages.find(item => item.id === messageId)
  const item = message?.type === 'assistant' ? message.content[0] : undefined
  return item && item.type === 'text' ? item.text : undefined
}

function messageIds(sessionId: string): string[] {
  return messageStore.getSessionState(sessionId)?.messages.map(message => message.id) ?? []
}

describe('useSessionState', () => {
  beforeEach(() => {
    messageStore.clearAll()
  })

  it('returns only visible messages after revert', () => {
    messageStore.setMessages('session-1', [
      createUserMessage('message-1', 1),
      createUserMessage('message-2', 2),
      createUserMessage('message-3', 3),
    ])
    messageStore.setRevertState('session-1', {
      messageId: 'message-2',
      history: [],
    })

    const { result } = renderHook(() => useSessionState('session-1'))

    expect(result.current?.messages.map(message => message.id)).toEqual(['message-1'])
    expect(result.current?.canUndo).toBe(true)
  })

  it('disables undo when no visible user messages remain', () => {
    messageStore.setMessages('session-1', [createUserMessage('message-1', 1)])
    messageStore.setRevertState('session-1', {
      messageId: 'message-1',
      history: [],
    })

    const { result } = renderHook(() => useSessionState('session-1'))

    expect(result.current?.messages).toEqual([])
    expect(result.current?.canUndo).toBe(false)
  })

  it('does not re-render when another session changes', async () => {
    messageStore.setMessages('session-1', [createUserMessage('message-1', 1)])
    messageStore.setMessages('session-2', [createUserMessage('message-2', 2)])

    let renderCount = 0
    const { result } = renderHook(() => {
      renderCount += 1
      return useSessionState('session-1')
    })
    expect(result.current?.messages.map(message => message.id)).toEqual(['message-1'])

    messageStore.handleMessageUpdated(createUserMessage('message-3', 3), 'session-2')
    await new Promise(resolve => requestAnimationFrame(resolve))

    expect(renderCount).toBe(1)
    expect(result.current?.messages.map(message => message.id)).toEqual(['message-1'])
  })
})

describe('focused snapshot reuse', () => {
  beforeEach(() => {
    messageStore.clearAll()
    paneLayoutListeners.clear()
    vi.mocked(paneLayoutStore.getFocusedSessionId).mockReturnValue('session-1')
  })

  it('reuses the focused snapshot object when only unrelated session data changes', async () => {
    messageStore.setMessages('session-1', [createUserMessage('message-1', 1)])
    messageStore.setMessages('session-2', [createUserMessage('message-2', 2)])

    const { result } = renderHook(() => useMessageStore())
    const first = result.current

    await act(async () => {
      messageStore.handleMessageUpdated(createUserMessage('message-3', 3), 'session-2')
      await new Promise(resolve => requestAnimationFrame(resolve))
    })

    expect(result.current).toBe(first)
  })

  it('keeps selector result stable when selected fields do not change', async () => {
    messageStore.setMessages('session-1', [createAssistantMessage('message-1', 'one', 1)])

    let renderCount = 0
    const { result } = renderHook(() => {
      renderCount += 1
      return useMessageStoreSelector(state => ({
        sessionId: state.sessionId,
        hasMessages: state.messages.length > 0,
      }))
    })
    expect(result.current).toEqual({ sessionId: 'session-1', hasMessages: true })
    const afterMount = renderCount

    await act(async () => {
      // 内容变了，但消息条数与 sessionId 没变 → selector 不应逼组件再渲
      messageStore.handleMessageContent('message-1', 'session-1', textContent('one updated'))
      await new Promise(resolve => requestAnimationFrame(resolve))
    })

    expect(renderCount).toBe(afterMount)
    expect(result.current).toEqual({ sessionId: 'session-1', hasMessages: true })
  })

  it('keeps header meta and hasMessages stable across text deltas', async () => {
    messageStore.setMessages('session-1', [createAssistantMessage('message-1', 'one', 1)])
    messageStore.updateSessionMetadata('session-1', { title: 'Hello', directory: '/repo' })
    await act(async () => {
      await new Promise(resolve => requestAnimationFrame(resolve))
    })

    let headerRenders = 0
    let hasMessagesRenders = 0
    const header = renderHook(() => {
      headerRenders += 1
      return useHeaderSessionMeta()
    })
    const hasMessages = renderHook(() => {
      hasMessagesRenders += 1
      return useHasMessages()
    })

    expect(header.result.current).toEqual({
      sessionId: 'session-1',
      sessionDirectory: '/repo',
      sessionTitle: 'Hello',
    })
    expect(hasMessages.result.current).toBe(true)
    const headerAfterMount = headerRenders
    const hasMessagesAfterMount = hasMessagesRenders

    await act(async () => {
      messageStore.handleMessageContent('message-1', 'session-1', textContent('one updated'))
      await new Promise(resolve => requestAnimationFrame(resolve))
    })

    expect(headerRenders).toBe(headerAfterMount)
    expect(hasMessagesRenders).toBe(hasMessagesAfterMount)
    expect(header.result.current.sessionTitle).toBe('Hello')
    expect(hasMessages.result.current).toBe(true)
  })

  it('applies text deltas to the last text item', () => {
    messageStore.setMessages('session-1', [createAssistantMessage('message-1', 'hello', 1)])

    messageStore.handleTextDelta({
      sessionID: 'session-1',
      assistantMessageID: 'message-1',
      ordinal: 0,
      delta: ' world',
    })

    expect(messageText('session-1', 'message-1')).toBe('hello world')
    expect(messageIds('session-1')).toEqual(['message-1'])
  })
})
