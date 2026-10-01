import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssistantMessage, SessionMessage } from '../api/types'
import { messageStore } from './messageStore'

const SESSION = 'session-1'

/** 构造一条 v2 助手消息（自带 content，不再有 parts） */
function createAssistantMessage(
  id: string,
  content: AssistantMessage['content'] = [],
  completed?: number,
): AssistantMessage {
  return {
    id,
    type: 'assistant',
    agent: 'build',
    model: { id: 'model-1', providerID: 'provider-1' },
    content,
    time: { created: 1, ...(completed != null ? { completed } : {}) },
  }
}

function textContent(text: string): AssistantMessage['content'] {
  return [{ type: 'text', text }]
}

// ============================================
// v2 变更说明
//
// v1 的测试围绕 `{ info, parts }` 入参与 `handlePartUpdated` / `handlePartDelta`
// 展开。v2 中消息**自带 content**，且流式增量是独立事件：
//   - handleMessageUpdated(msg, sessionID)  接收完整消息
//   - handleTextDelta({ sessionID, assistantMessageID, ordinal, delta })
//   - handleMessageContent(messageID, sessionID, content)  权威快照
// 因此这些用例改为按 v2 的形状与语义来验证同样的行为。
// ============================================

/** UI parts 里的第 index 个文本 */
function textAt(sessionId: string, msgIndex: number, partIndex = 0): string | undefined {
  const parts = messageStore.getSessionState(sessionId)?.messages[msgIndex]?.parts
  const part = parts?.[partIndex]
  return part && part.type === 'text' ? part.text : undefined
}

// 流式 delta 通过 requestAnimationFrame 节流，测试里收集回调后手动 flush
const rafQueue: Array<(time: number) => void> = []

function flushFrames(): void {
  while (rafQueue.length > 0) {
    rafQueue.shift()?.(0)
  }
}

describe('messageStore (v2)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    rafQueue.length = 0
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => {
      rafQueue.push(cb as (time: number) => void)
      return rafQueue.length
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
    messageStore.clearAll()
  })

  it('projects a v2 assistant message into UI parts on update', () => {
    messageStore.handleMessageUpdated(createAssistantMessage('message-1', textContent('hello')), SESSION)

    const state = messageStore.getSessionState(SESSION)
    expect(state?.messages).toHaveLength(1)
    expect(state?.messages[0].info.id).toBe('message-1')
    expect(state?.messages[0].info.role).toBe('assistant')
    expect(textAt(SESSION, 0)).toBe('hello')
  })

  it('projects a v2 user message with its text', () => {
    const user: SessionMessage = {
      id: 'user-1',
      type: 'user',
      time: { created: 1 },
      text: 'hi there',
    }
    messageStore.handleMessageUpdated(user, SESSION)

    const state = messageStore.getSessionState(SESSION)
    expect(state?.messages[0].info.role).toBe('user')
  })

  it('appends a text delta by ordinal when the message exists', () => {
    messageStore.handleMessageUpdated(createAssistantMessage('message-1', textContent('hello')), SESSION)

    messageStore.handleTextDelta({
      sessionID: SESSION,
      assistantMessageID: 'message-1',
      ordinal: 0,
      delta: ' world',
    })
    flushFrames()
    messageStore.handleTextDelta({
      sessionID: SESSION,
      assistantMessageID: 'message-1',
      ordinal: 0,
      delta: '!',
    })
    flushFrames()

    expect(textAt(SESSION, 0)).toBe('hello world!')
  })

  it('creates a text part when a delta arrives before any content snapshot', () => {
    // v2 的 delta 可能先于 message.content.updated 到达
    messageStore.handleMessageUpdated(createAssistantMessage('message-1'), SESSION)

    messageStore.handleTextDelta({
      sessionID: SESSION,
      assistantMessageID: 'message-1',
      ordinal: 0,
      delta: 'early',
    })
    flushFrames()

    expect(textAt(SESSION, 0)).toBe('early')
  })

  /**
   * 跨模块契约：投影层用「content 数组下标」拼 part id
   *（`${messageID}:text:${index}`），而流式事件带的是 `ordinal`。
   * 两者必须用同一套编号，否则增量会落到错误的 part 上。
   */
  it('delta 的 ordinal 与投影层 content 下标对齐（含推理与文本交错）', () => {
    messageStore.handleMessageUpdated(
      createAssistantMessage('message-1', [
        { type: 'text', text: 'first' },
        { type: 'reasoning', text: 'thinking' },
        { type: 'text', text: 'second' },
      ]),
      SESSION,
    )

    // 下标 2 是第二个文本 part → 追加到 'second' 后面
    messageStore.handleTextDelta({
      sessionID: SESSION,
      assistantMessageID: 'message-1',
      ordinal: 2,
      delta: ' +more',
    })
    flushFrames()

    // 下标 1 是推理 part → 追加到推理上
    messageStore.handleReasoningDelta({
      sessionID: SESSION,
      assistantMessageID: 'message-1',
      ordinal: 1,
      delta: ' +deeper',
    })
    flushFrames()

    const parts = messageStore.getSessionState(SESSION)?.messages[0].parts ?? []
    expect(parts.map(p => `${p.type}:${p.id}`)).toEqual([
      'text:message-1:text:0',
      'reasoning:message-1:reasoning:1',
      'text:message-1:text:2',
    ])
    expect(parts[0]).toMatchObject({ text: 'first' })
    expect(parts[1]).toMatchObject({ text: 'thinking +deeper' })
    expect(parts[2]).toMatchObject({ text: 'second +more' })
  })

  it('keeps separate text parts per ordinal', () => {
    messageStore.handleMessageUpdated(createAssistantMessage('message-1', textContent('first')), SESSION)

    messageStore.handleTextDelta({
      sessionID: SESSION,
      assistantMessageID: 'message-1',
      ordinal: 1,
      delta: 'second',
    })
    flushFrames()

    expect(textAt(SESSION, 0, 0)).toBe('first')
    expect(textAt(SESSION, 0, 1)).toBe('second')
  })

  it('appends reasoning deltas to a reasoning part', () => {
    messageStore.handleMessageUpdated(createAssistantMessage('message-1'), SESSION)

    messageStore.handleReasoningDelta({
      sessionID: SESSION,
      assistantMessageID: 'message-1',
      ordinal: 0,
      delta: 'thinking',
    })
    flushFrames()

    const part = messageStore.getSessionState(SESSION)?.messages[0].parts[0]
    expect(part).toMatchObject({ type: 'reasoning', text: 'thinking' })
  })

  it('silently drops a delta when the message does not exist yet', () => {
    messageStore.handleTextDelta({
      sessionID: SESSION,
      assistantMessageID: 'missing',
      ordinal: 0,
      delta: 'x',
    })

    expect(messageStore.getSessionState(SESSION)).toBeUndefined()
  })

  it('replaces content wholesale from an authoritative snapshot', () => {
    messageStore.handleMessageUpdated(createAssistantMessage('message-1', textContent('streamed partial')), SESSION)

    messageStore.handleMessageContent('message-1', SESSION, textContent('server final text'))

    expect(textAt(SESSION, 0)).toBe('server final text')
  })

  it('projects tool content into a tool part', () => {
    messageStore.handleMessageUpdated(
      createAssistantMessage('message-1', [
        {
          type: 'tool',
          id: 'tool-1',
          name: 'bash',
          state: { status: 'completed', input: { cmd: 'ls' }, content: [{ type: 'text', text: 'file.txt' }] },
          time: { created: 1, completed: 2 },
        },
      ]),
      SESSION,
    )

    const part = messageStore.getSessionState(SESSION)?.messages[0].parts[0]
    expect(part).toMatchObject({
      type: 'tool',
      callID: 'tool-1',
      tool: 'bash',
      state: { status: 'completed', output: 'file.txt' },
    })
  })

  it('updates a tool part in place from a tool lifecycle event', () => {
    messageStore.handleMessageUpdated(
      createAssistantMessage('message-1', [
        {
          type: 'tool',
          id: 'tool-1',
          name: 'bash',
          state: { status: 'running', input: {}, metadata: {} },
          time: { created: 1 },
        },
      ]),
      SESSION,
    )

    messageStore.handleToolEvent(SESSION, 'message-1', 'tool-1', {
      status: 'completed',
      output: 'done',
    })

    const part = messageStore.getSessionState(SESSION)?.messages[0].parts[0]
    expect(part).toMatchObject({ type: 'tool', state: { status: 'completed', output: 'done' } })
  })

  it('creates a placeholder tool part when the tool event precedes content', () => {
    messageStore.handleMessageUpdated(createAssistantMessage('message-1'), SESSION)

    messageStore.handleToolEvent(SESSION, 'message-1', 'tool-9', {
      status: 'running',
      toolName: 'read',
    })

    const part = messageStore.getSessionState(SESSION)?.messages[0].parts[0]
    expect(part).toMatchObject({ type: 'tool', callID: 'tool-9', tool: 'read' })
  })

  /**
   * 工具可能是一轮里的第一个动作（前面没有任何文本），此时助手消息还不存在。
   * 之前 handleToolEvent 直接 return，把所有工具事件丢光。
   */
  it('助手消息尚不存在时也能建出工具 part（工具先于文本出现）', () => {
    messageStore.handleToolEvent(SESSION, 'message-fresh', 'tool-1', {
      status: 'running',
      toolName: 'bash',
    })

    const message = messageStore.getSessionState(SESSION)?.messages[0]
    expect(message?.info.id).toBe('message-fresh')
    expect(message?.parts[0]).toMatchObject({ type: 'tool', tool: 'bash' })
  })

  /**
   * 唯一带工具名的事件是 tool.input.started（useGlobalEvents 在此建 part）。
   * 之后 called/progress/success 都不带名字，但 part 已存在，因此能正常更新。
   */
  it('先用 tool.input.started 建 part，随后不带名字的成功事件也能更新到它', () => {
    messageStore.handleToolEvent(SESSION, 'message-1', 'tool-1', {
      status: 'running',
      toolName: 'read',
    })
    // 以下事件在 v2 里都不带工具名
    messageStore.handleToolEvent(SESSION, 'message-1', 'tool-1', {
      status: 'completed',
      output: 'file contents',
    })

    const part = messageStore.getSessionState(SESSION)?.messages[0].parts[0]
    expect(part).toMatchObject({
      type: 'tool',
      tool: 'read',
      state: { status: 'completed', output: 'file contents' },
    })
  })

  it('content 快照在助手消息不存在时也能落地（快照可能先到）', () => {
    messageStore.handleMessageContent('message-snap', SESSION, textContent('from snapshot'))

    const message = messageStore.getSessionState(SESSION)?.messages[0]
    expect(message?.info.id).toBe('message-snap')
    expect(message?.parts[0]).toMatchObject({ type: 'text', text: 'from snapshot' })
  })

  it('marks cached sessions stale after reconnect and clears the flag after a fresh load', () => {
    messageStore.setMessages(SESSION, [createAssistantMessage('message-1', textContent('hello'))])

    expect(messageStore.isSessionStale(SESSION)).toBe(false)

    messageStore.markAllSessionsStale()
    expect(messageStore.isSessionStale(SESSION)).toBe(true)

    messageStore.setMessages(SESSION, [createAssistantMessage('message-1', textContent('hello again'))])
    expect(messageStore.isSessionStale(SESSION)).toBe(false)
  })

  it('truncates messages after revert point', () => {
    messageStore.setMessages(SESSION, [
      createAssistantMessage('message-1', textContent('one')),
      createAssistantMessage('message-2', textContent('two')),
      createAssistantMessage('message-3', textContent('three')),
    ])
    messageStore.setRevertState(SESSION, { messageId: 'message-2', history: [] })

    messageStore.truncateAfterRevert(SESSION)

    const state = messageStore.getSessionState(SESSION)
    expect(state?.messages).toHaveLength(1)
    expect(state?.messages[0].info.id).toBe('message-1')
    expect(state?.revertState).toBeNull()
  })

  it('deduplicates messages in prependMessages', () => {
    messageStore.setMessages(SESSION, [createAssistantMessage('message-2', textContent('two'))])

    messageStore.prependMessages(
      SESSION,
      [
        createAssistantMessage('message-1', textContent('one')),
        createAssistantMessage('message-2', textContent('duplicate')),
      ],
      true,
    )

    const state = messageStore.getSessionState(SESSION)
    expect(state?.messages).toHaveLength(2)
    expect(state?.messages[0].info.id).toBe('message-1')
    expect(state?.messages[1].info.id).toBe('message-2')
  })

  it('creates a session when starting streaming', () => {
    messageStore.setStreaming(SESSION, true)

    const state = messageStore.getSessionState(SESSION)
    expect(state?.isStreaming).toBe(true)
    expect(state?.messages).toHaveLength(0)
    expect(state?.loadState).toBe('idle')
  })

  it('does not create a session when stopping streaming for a missing session', () => {
    messageStore.setStreaming(SESSION, false)

    expect(messageStore.getSessionState(SESSION)).toBeUndefined()
  })

  it('does not regress longer live text when a shorter snapshot arrives while streaming', () => {
    messageStore.setMessages(SESSION, [createAssistantMessage('message-1', textContent('hello world'))])
    messageStore.setStreaming(SESSION, true)
    const live = messageStore.getSessionState(SESSION)?.messages[0]
    if (live) live.isStreaming = true

    // 未定稿（无 completed）→ 保留更长的本地文本
    messageStore.handleMessageUpdated(createAssistantMessage('message-1', textContent('hello')), SESSION)

    expect(textAt(SESSION, 0)).toBe('hello world')
  })

  it('adopts a longer server snapshot when reloading messages', () => {
    messageStore.setMessages(SESSION, [createAssistantMessage('message-1', textContent('hello'))])
    messageStore.setStreaming(SESSION, true)
    const live = messageStore.getSessionState(SESSION)?.messages[0]
    if (live) live.isStreaming = true

    messageStore.setMessages(SESSION, [createAssistantMessage('message-1', textContent('hello world'))])

    expect(textAt(SESSION, 0)).toBe('hello world')
  })

  it('adopts completed server text even when local live text was longer', () => {
    messageStore.setMessages(SESSION, [createAssistantMessage('message-1', textContent('hello world extra'))])
    messageStore.setStreaming(SESSION, true)
    const live = messageStore.getSessionState(SESSION)?.messages[0]
    if (live) live.isStreaming = true

    // 定稿：completed 快照强制采用服务端，不再 preserve
    messageStore.setMessages(SESSION, [createAssistantMessage('message-1', textContent('hello world'), 99)])

    expect(textAt(SESSION, 0)).toBe('hello world')
  })

  it('forces completed message updates from the server', () => {
    messageStore.setMessages(SESSION, [createAssistantMessage('message-1', textContent('hello world extra'), 10)])

    messageStore.handleMessageUpdated(createAssistantMessage('message-1', textContent('hello world'), 10), SESSION)

    expect(textAt(SESSION, 0)).toBe('hello world')
  })

  it('flushes mutable text deltas for multiple sessions in the same frame', () => {
    const rafCallbacks: Array<(time: number) => void> = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => {
      rafCallbacks.push(cb as (time: number) => void)
      return 1
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)

    messageStore.setMessages(SESSION, [createAssistantMessage('message-1', textContent('hello'))])
    messageStore.setMessages('session-2', [createAssistantMessage('message-2', textContent('world'))])

    const beforeMessage1 = messageStore.getSessionState(SESSION)?.messages[0]
    const beforeMessage2 = messageStore.getSessionState('session-2')?.messages[0]

    messageStore.handleTextDelta({
      sessionID: SESSION,
      assistantMessageID: 'message-1',
      ordinal: 0,
      delta: '!',
    })
    messageStore.handleTextDelta({
      sessionID: 'session-2',
      assistantMessageID: 'message-2',
      ordinal: 0,
      delta: '?',
    })

    const scheduledFrame = rafCallbacks[0]
    if (!scheduledFrame) {
      throw new Error('Expected requestAnimationFrame callback to be scheduled')
    }
    scheduledFrame(0)

    const afterMessage1 = messageStore.getSessionState(SESSION)?.messages[0]
    const afterMessage2 = messageStore.getSessionState('session-2')?.messages[0]

    expect(afterMessage1?.parts[0]).toMatchObject({ text: 'hello!' })
    expect(afterMessage2?.parts[0]).toMatchObject({ text: 'world?' })
    expect(afterMessage1).not.toBe(beforeMessage1)
    expect(afterMessage2).not.toBe(beforeMessage2)
  })

  it('preserves settled part references when another part receives a delta', () => {
    const rafCallbacks: Array<(time: number) => void> = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => {
      rafCallbacks.push(cb as (time: number) => void)
      return 1
    })

    messageStore.setMessages(SESSION, [
      createAssistantMessage('message-1', [
        { type: 'text', text: 'settled' },
        { type: 'text', text: 'live' },
      ]),
    ])

    const beforeMessage = messageStore.getSessionState(SESSION)?.messages[0]
    const beforeSettledPart = beforeMessage?.parts[0]
    const beforeLivePart = beforeMessage?.parts[1]

    messageStore.handleTextDelta({
      sessionID: SESSION,
      assistantMessageID: 'message-1',
      ordinal: 1,
      delta: ' text',
    })
    rafCallbacks[0]?.(0)

    const afterMessage = messageStore.getSessionState(SESSION)?.messages[0]
    expect(afterMessage).not.toBe(beforeMessage)
    expect(afterMessage?.parts[0]).toBe(beforeSettledPart)
    expect(afterMessage?.parts[1]).not.toBe(beforeLivePart)
    expect(afterMessage?.parts[1]).toMatchObject({ text: 'live text' })
  })

  it('notifies only subscribers for changed sessions', () => {
    const session1Subscriber = vi.fn()
    const session2Subscriber = vi.fn()
    const allSubscriber = vi.fn()
    const rafCallbacks: Array<(time: number) => void> = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => {
      rafCallbacks.push(cb as (time: number) => void)
      return rafCallbacks.length
    })

    const unsubscribeSession1 = messageStore.subscribeSession(SESSION, session1Subscriber)
    const unsubscribeSession2 = messageStore.subscribeSession('session-2', session2Subscriber)
    const unsubscribeAll = messageStore.subscribe(allSubscriber)

    messageStore.setMessages('session-2', [createAssistantMessage('message-2', textContent('world'))])
    rafCallbacks.shift()?.(0)

    expect(session1Subscriber).not.toHaveBeenCalled()
    expect(session2Subscriber).toHaveBeenCalledTimes(1)
    expect(allSubscriber).toHaveBeenCalledTimes(1)

    unsubscribeSession1()
    unsubscribeSession2()
    unsubscribeAll()
  })
})
