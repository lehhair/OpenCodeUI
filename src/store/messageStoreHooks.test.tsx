import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { messageStore } from './messageStore'
import {
  useHasMessages,
  useHeaderSessionMeta,
  useMessageStore,
  useMessageStoreSelector,
  useSessionState,
} from './messageStoreHooks'
import { paneLayoutStore } from './paneLayoutStore'
import { v2User } from '../test/fixtures/v2Messages'
import type { PartUpdatedPayload } from '../types/api/event'

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

// ── V2 事件侧夹具（阶段 2b：handlePartUpdated 已换成 V2 载荷）──────
/** 造一个 text 块的整块更新载荷（part id 由「消息 id + content 下标」合成） */
function textUpdate(messageID: string, text: string, sessionID = 'session-1'): PartUpdatedPayload {
  return { kind: 'content', sessionID, messageID, ordinal: 0, content: { type: 'text', text } }
}

/** 造一条 V2 user 消息（读侧夹具） */
function createUserMessage(id: string, created: number) {
  return v2User(id, `text of ${id}`, { time: { created } })
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

    expect(result.current?.messages.map(message => message.info.id)).toEqual(['message-1'])
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
    expect(result.current?.messages.map(message => message.info.id)).toEqual(['message-1'])

    messageStore.handlePartUpdated(textUpdate('message-2', 'two updated', 'session-2'))
    await new Promise(resolve => requestAnimationFrame(resolve))

    expect(renderCount).toBe(1)
    expect(result.current?.messages.map(message => message.info.id)).toEqual(['message-1'])
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
      messageStore.handlePartUpdated(textUpdate('message-2', 'two updated', 'session-2'))
      await new Promise(resolve => requestAnimationFrame(resolve))
    })

    expect(result.current).toBe(first)
  })

  it('keeps selector result stable when selected fields do not change', async () => {
    messageStore.setMessages('session-1', [createUserMessage('message-1', 1)])

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
      messageStore.handlePartUpdated(textUpdate('message-1', 'one updated'))
      await new Promise(resolve => requestAnimationFrame(resolve))
    })

    // sessionId / 是否有消息 未变，selector 不应逼组件再渲
    expect(renderCount).toBe(afterMount)
    expect(result.current).toEqual({ sessionId: 'session-1', hasMessages: true })
  })

  it('keeps header meta and hasMessages stable across text deltas', async () => {
    messageStore.setMessages('session-1', [createUserMessage('message-1', 1)])
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
      messageStore.handlePartUpdated(textUpdate('message-1', 'one updated'))
      await new Promise(resolve => requestAnimationFrame(resolve))
    })

    expect(headerRenders).toBe(headerAfterMount)
    expect(hasMessagesRenders).toBe(hasMessagesAfterMount)
    expect(header.result.current.sessionTitle).toBe('Hello')
    expect(hasMessages.result.current).toBe(true)
  })
})
