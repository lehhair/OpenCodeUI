import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssistantMessage, UserMessage } from '../api/types'
import { contentEntries } from '../types/api/message'
import { messageStore } from './messageStore'
import type { SessionMessageInfo } from './messageStoreTypes'

// ============================================
// 原生（v2）语义说明
//
// store 里存的是**原生** `SessionMessageInfo`，没有 `{ info, parts }`：
//   - 消息判别走 `message.type`（user / assistant / synthetic / idle / ...）
//   - 助手内容读 `message.content: Array<Text | Reasoning | Tool>`
//   - 流式增量是独立事件，且**加载态靠 findLast 定位**（不是按 ordinal / 下标）：
//       text.delta      → 最后一个 text 片段
//       reasoning.delta → 最后一个 time.completed 缺省的 reasoning 片段
//       tool.*          → content 里 id 相同的最后一个 tool 片段
//   - `session.step.started` 才是「创建助手消息」的事件
// ============================================

const SESSION = 'session-1'

/** 构造一条原生助手消息（自带 content） */
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

function createUserMessage(id: string, created = 1): UserMessage {
  return { id, type: 'user', time: { created }, text: id }
}

function textContent(text: string): AssistantMessage['content'] {
  return [{ type: 'text', text }]
}

// ---- 读取助手 content 的小工具 ----

function assistantAt(sessionId: string, msgIndex = 0): AssistantMessage {
  const message = messageStore.getSessionState(sessionId)?.messages[msgIndex]
  if (message?.type !== 'assistant') throw new Error('expected an assistant message')
  return message
}

function contentAt(sessionId: string, msgIndex = 0, contentIndex = 0): AssistantMessage['content'][number] | undefined {
  return assistantAt(sessionId, msgIndex).content[contentIndex]
}

function textAt(sessionId: string, msgIndex = 0, contentIndex = 0): string | undefined {
  const item = contentAt(sessionId, msgIndex, contentIndex)
  return item && item.type === 'text' ? item.text : undefined
}

function toolAt(sessionId: string, contentIndex = 0) {
  const item = contentAt(sessionId, 0, contentIndex)
  if (item?.type !== 'tool') throw new Error('expected a tool item')
  return item
}

function messageIds(sessionId: string): string[] {
  return messageStore.getSessionState(sessionId)?.messages.map(message => message.id) ?? []
}

// ---- 事件负载小工具（sessionID 一律是作用域后的 id） ----

const stepStartedData = (assistantMessageID = 'message-1', started = 100) => ({
  sessionID: SESSION,
  assistantMessageID,
  agent: 'build',
  model: { id: 'model-1', providerID: 'provider-1' },
  started,
})

const textStartedData = (ordinal = 0, assistantMessageID = 'message-1') => ({
  sessionID: SESSION,
  assistantMessageID,
  ordinal,
})

const textDeltaData = (delta: string, ordinal = 0, assistantMessageID = 'message-1', sessionID = SESSION) => ({
  sessionID,
  assistantMessageID,
  ordinal,
  delta,
})

const reasoningStartedData = (ordinal = 0, assistantMessageID = 'message-1') => ({
  sessionID: SESSION,
  assistantMessageID,
  ordinal,
})

const reasoningDeltaData = (delta: string, ordinal = 0, assistantMessageID = 'message-1') => ({
  sessionID: SESSION,
  assistantMessageID,
  ordinal,
  delta,
})

// 流式 delta 通过 requestAnimationFrame 节流，测试里收集回调后手动 flush
const rafQueue: Array<(time: number) => void> = []

function flushFrames(): void {
  while (rafQueue.length > 0) {
    rafQueue.shift()?.(0)
  }
}

describe('messageStore（原生 v2 消息）', () => {
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

  // ============================================
  // 整条落库
  // ============================================

  it('handleMessageUpdated 按原生形状落库（无 info / parts）', () => {
    messageStore.handleMessageUpdated(createAssistantMessage('message-1', textContent('hello')), SESSION)

    const state = messageStore.getSessionState(SESSION)
    expect(state?.messages).toHaveLength(1)
    expect(state?.messages[0].type).toBe('assistant')
    expect(state?.messages[0].id).toBe('message-1')
    expect(textAt(SESSION)).toBe('hello')
  })

  it('handleMessageUpdated 落库原生用户消息（正文就是 text）', () => {
    messageStore.handleMessageUpdated(createUserMessage('user-1'), SESSION)

    const message = messageStore.getSessionState(SESSION)?.messages[0]
    expect(message?.type).toBe('user')
    expect(message && message.type === 'user' ? message.text : undefined).toBe('user-1')
    expect(messageStore.extractUserText(message as SessionMessageInfo)).toBe('user-1')
  })

  it('handleMessageContent 用权威快照整体替换 content', () => {
    messageStore.handleMessageUpdated(createAssistantMessage('message-1', textContent('streamed partial')), SESSION)

    messageStore.handleMessageContent('message-1', SESSION, textContent('server final text'))

    expect(textAt(SESSION)).toBe('server final text')
  })

  it('content 快照在助手消息不存在时也能落地（快照可能先到）', () => {
    messageStore.handleMessageContent('message-snap', SESSION, textContent('from snapshot'))

    expect(messageIds(SESSION)).toEqual(['message-snap'])
    expect(textAt(SESSION)).toBe('from snapshot')
  })

  // ============================================
  // step.started：创建 / 重置助手消息
  // ============================================

  it('step.started 创建助手消息：content 空、time.created 用 data.started、带上 agent/model', () => {
    messageStore.handleStepStarted(stepStartedData('message-1', 90))

    const message = assistantAt(SESSION)
    expect(message.content).toEqual([])
    expect(message.time.created).toBe(90)
    expect(message.agent).toBe('build')
    expect(message.model).toEqual({ id: 'model-1', providerID: 'provider-1' })
    expect(message.time.completed).toBeUndefined()
  })

  it('step.started 对同 id 的助手消息就地重置元信息（不清空已流出的 content）', () => {
    messageStore.handleStepStarted(stepStartedData('message-1', 90))
    messageStore.handleTextStarted(textStartedData())
    messageStore.handleTextDelta(textDeltaData('partial'))
    messageStore.handleStepStarted({ ...stepStartedData('message-1', 95), agent: 'plan' })

    const message = assistantAt(SESSION)
    expect(message.time.created).toBe(95)
    expect(message.agent).toBe('plan')
    expect(message.time.completed).toBeUndefined()
    // text.started 可能先到；重置元信息不能把已经流出来的内容丢掉
    expect(message.content).toHaveLength(1)
  })

  it('新的一步会给上一条仍开着的助手消息补 time.completed = event.created', () => {
    messageStore.handleStepStarted(stepStartedData('message-a', 100), { id: 'evt-1', created: 100 })
    messageStore.handleStepStarted(stepStartedData('message-b', 200), { id: 'evt-2', created: 200 })

    const messages = messageStore.getSessionState(SESSION)?.messages ?? []
    expect(messages).toHaveLength(2)
    expect(messages[0].type === 'assistant' ? messages[0].time.completed : undefined).toBe(200)
    expect(messages[1].type === 'assistant' ? messages[1].time.completed : undefined).toBeUndefined()
  })

  it('step.ended / step.failed 定稿助手消息', () => {
    messageStore.handleStepStarted(stepStartedData('message-1', 100))
    messageStore.handleStepEnded(
      {
        sessionID: SESSION,
        assistantMessageID: 'message-1',
        finish: 'stop',
        cost: 0.01,
        tokens: { input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
      },
      { id: 'evt-1', created: 150 },
    )

    const ended = assistantAt(SESSION)
    expect(ended.time.completed).toBe(150)
    expect(ended.finish).toBe('stop')
    expect(ended.cost).toBe(0.01)

    messageStore.handleStepStarted(stepStartedData('message-2', 200))
    messageStore.handleStepFailed(
      {
        sessionID: SESSION,
        assistantMessageID: 'message-2',
        error: { type: 'provider_error', message: 'boom' },
      },
      { id: 'evt-2', created: 250 },
    )

    const failed = assistantAt(SESSION, 1)
    expect(failed.time.completed).toBe(250)
    expect(failed.finish).toBe('error')
    expect(failed.error).toEqual({ type: 'provider_error', message: 'boom' })
  })

  // ============================================
  // 文本流
  // ============================================

  it('1) text.started 追加一个空文本片段；delta 追加到最后一个；ended 覆盖该片段', () => {
    messageStore.handleStepStarted(stepStartedData())

    messageStore.handleTextStarted(textStartedData())
    expect(assistantAt(SESSION).content).toEqual([{ type: 'text', text: '' }])

    messageStore.handleTextDelta(textDeltaData('hello'))
    flushFrames()
    messageStore.handleTextDelta(textDeltaData(' world'))
    flushFrames()
    expect(textAt(SESSION)).toBe('hello world')

    messageStore.handleTextEnded({
      sessionID: SESSION,
      assistantMessageID: 'message-1',
      ordinal: 0,
      text: 'hello world (authoritative)',
    })
    expect(textAt(SESSION)).toBe('hello world (authoritative)')
  })

  it('2) 文本与推理交错时，delta 命中**最后一个**文本片段（不是第一个、也不是按下标）', () => {
    messageStore.handleMessageUpdated(
      createAssistantMessage('message-1', [
        { type: 'text', text: 'first' },
        { type: 'reasoning', text: 'thinking' },
        { type: 'text', text: 'second' },
      ]),
      SESSION,
    )

    // ordinal 传 0 也不该写到第一段文本上：定位一律用 findLast
    messageStore.handleTextDelta(textDeltaData(' +more', 0))
    flushFrames()

    const content = assistantAt(SESSION).content
    expect(content[0]).toMatchObject({ type: 'text', text: 'first' })
    expect(content[2]).toMatchObject({ type: 'text', text: 'second +more' })
  })

  it('未装载的助手消息收到 delta 时被丢弃（不会凭空建会话）', () => {
    messageStore.handleTextDelta(textDeltaData('x', 0, 'missing'))

    expect(messageStore.getSessionState(SESSION)).toBeUndefined()
  })

  // ============================================
  // 推理流
  // ============================================

  it('3) reasoning.delta 只写最后一个 time.completed 缺省的推理片段', () => {
    messageStore.handleMessageUpdated(
      createAssistantMessage('message-1', [
        { type: 'reasoning', text: 'done', time: { created: 1, completed: 2 } },
        { type: 'reasoning', text: 'live', time: { created: 3 } },
      ]),
      SESSION,
    )

    messageStore.handleReasoningDelta(reasoningDeltaData(' +more'))
    flushFrames()

    const content = assistantAt(SESSION).content
    expect(content[0]).toMatchObject({ text: 'done' })
    expect(content[1]).toMatchObject({ text: 'live +more' })
  })

  it('3b) 只有已完成的推理片段时，delta 无处可写（不会新建片段）', () => {
    messageStore.handleMessageUpdated(
      createAssistantMessage('message-1', [{ type: 'reasoning', text: 'done', time: { created: 1, completed: 2 } }]),
      SESSION,
    )

    messageStore.handleReasoningDelta(reasoningDeltaData(' should not land'))
    flushFrames()

    expect(assistantAt(SESSION).content).toHaveLength(1)
    expect(contentAt(SESSION)).toMatchObject({ text: 'done' })
  })

  it('reasoning.started 追加空片段并记 time.created；ended 覆盖文本并标记完成', () => {
    messageStore.handleStepStarted(stepStartedData())
    messageStore.handleReasoningStarted(reasoningStartedData(0), { id: 'evt-1', created: 120 })

    expect(contentAt(SESSION)).toMatchObject({ type: 'reasoning', text: '', time: { created: 120 } })

    messageStore.handleReasoningEnded(
      { sessionID: SESSION, assistantMessageID: 'message-1', ordinal: 0, text: 'final thought' },
      { id: 'evt-2', created: 130 },
    )

    expect(contentAt(SESSION)).toMatchObject({
      type: 'reasoning',
      text: 'final thought',
      time: { created: 120, completed: 130 },
    })
  })

  // ============================================
  // 工具生命周期
  // ============================================

  it('4) input.started 建 streaming 片段；delta 拼字符串；ended 覆盖；called 换成 running 对象', () => {
    messageStore.handleStepStarted(stepStartedData())
    messageStore.handleToolEvent({
      type: 'session.tool.input.started',
      data: { sessionID: SESSION, assistantMessageID: 'message-1', id: 'tool-1', name: 'bash' },
      facts: { id: 'evt-1', created: 101 },
    })

    expect(toolAt(SESSION)).toMatchObject({
      type: 'tool',
      id: 'tool-1',
      name: 'bash',
      time: { created: 101 },
      state: { status: 'streaming', input: '' },
    })

    messageStore.handleToolEvent({
      type: 'session.tool.input.delta',
      data: { sessionID: SESSION, assistantMessageID: 'message-1', id: 'tool-1', delta: '{"cmd"' },
    })
    expect(toolAt(SESSION).state).toMatchObject({ status: 'streaming', input: '{"cmd"' })

    messageStore.handleToolEvent({
      type: 'session.tool.input.ended',
      data: { sessionID: SESSION, assistantMessageID: 'message-1', id: 'tool-1', text: '{"cmd":"ls"}' },
    })
    expect(toolAt(SESSION).state).toMatchObject({ status: 'streaming', input: '{"cmd":"ls"}' })

    messageStore.handleToolEvent({
      type: 'session.tool.called',
      data: {
        sessionID: SESSION,
        assistantMessageID: 'message-1',
        id: 'tool-1',
        input: { cmd: 'ls' },
        executed: true,
      },
      facts: { id: 'evt-2', created: 104 },
    })

    const tool = toolAt(SESSION)
    expect(tool.state).toEqual({ status: 'running', input: { cmd: 'ls' }, metadata: {} })
    expect(tool.executed).toBe(true)
    expect(tool.time.ran).toBe(104)
  })

  it('tool.progress 只在 running 时写 metadata；success / failed 收尾', () => {
    messageStore.handleStepStarted(stepStartedData())
    messageStore.handleToolEvent({
      type: 'session.tool.input.started',
      data: { sessionID: SESSION, assistantMessageID: 'message-1', id: 'tool-1', name: 'bash' },
    })

    // 还在 streaming：progress 不该写 metadata
    messageStore.handleToolEvent({
      type: 'session.tool.progress',
      data: { sessionID: SESSION, assistantMessageID: 'message-1', id: 'tool-1', metadata: { step: 1 } },
    })
    expect(toolAt(SESSION).state).toEqual({ status: 'streaming', input: '' })

    messageStore.handleToolEvent({
      type: 'session.tool.called',
      data: {
        sessionID: SESSION,
        assistantMessageID: 'message-1',
        id: 'tool-1',
        input: { cmd: 'ls' },
        executed: true,
      },
    })
    messageStore.handleToolEvent({
      type: 'session.tool.progress',
      data: { sessionID: SESSION, assistantMessageID: 'message-1', id: 'tool-1', metadata: { step: 1 } },
    })
    expect(toolAt(SESSION).state).toEqual({ status: 'running', input: { cmd: 'ls' }, metadata: { step: 1 } })

    messageStore.handleToolEvent({
      type: 'session.tool.success',
      data: {
        sessionID: SESSION,
        assistantMessageID: 'message-1',
        id: 'tool-1',
        content: [{ type: 'text', text: 'file.txt' }],
        metadata: { exit: 0 },
        executed: true,
      },
      facts: { id: 'evt-3', created: 110 },
    })

    expect(toolAt(SESSION)).toMatchObject({
      state: {
        status: 'completed',
        input: { cmd: 'ls' },
        metadata: { exit: 0 },
        content: [{ type: 'text', text: 'file.txt' }],
      },
      time: { completed: 110 },
    })

    messageStore.handleToolEvent({
      type: 'session.tool.input.started',
      data: { sessionID: SESSION, assistantMessageID: 'message-1', id: 'tool-2', name: 'read' },
    })
    messageStore.handleToolEvent({
      type: 'session.tool.failed',
      data: {
        sessionID: SESSION,
        assistantMessageID: 'message-1',
        id: 'tool-2',
        error: { type: 'tool.error', message: 'nope' },
        metadata: {},
        executed: false,
      },
      facts: { id: 'evt-4', created: 120 },
    })

    expect(toolAt(SESSION, 1)).toMatchObject({
      state: { status: 'error', error: { type: 'tool.error', message: 'nope' }, input: {} },
      time: { completed: 120 },
    })
  })

  it('5) 未知工具 id 的事件被丢弃（助手消息存在，但没有该 tool 片段）', () => {
    messageStore.handleStepStarted(stepStartedData())

    messageStore.handleToolEvent({
      type: 'session.tool.progress',
      data: { sessionID: SESSION, assistantMessageID: 'message-1', id: 'tool-unknown', metadata: { step: 1 } },
    })
    messageStore.handleToolEvent({
      type: 'session.tool.success',
      data: {
        sessionID: SESSION,
        assistantMessageID: 'message-1',
        id: 'tool-unknown',
        content: [{ type: 'text', text: 'ignored' }],
        executed: true,
      },
    })

    expect(assistantAt(SESSION).content).toEqual([])
  })

  it('助手消息尚不存在时也能建出 tool 片段（工具先于文本出现）', () => {
    messageStore.handleToolEvent({
      type: 'session.tool.input.started',
      data: { sessionID: SESSION, assistantMessageID: 'message-fresh', id: 'tool-1', name: 'bash' },
    })

    expect(messageIds(SESSION)).toEqual(['message-fresh'])
    expect(toolAt(SESSION)).toMatchObject({ type: 'tool', id: 'tool-1', name: 'bash' })
  })

  // ============================================
  // 重试
  // ============================================

  describe('6) 重试排期（session.retry.scheduled）', () => {
    it('把 retry 挂到助手消息上（原生结构，不做错误翻译）', () => {
      messageStore.handleRetryScheduled({
        sessionID: SESSION,
        assistantMessageID: 'message-1',
        attempt: 2,
        at: 1700,
        error: { type: 'provider_error', message: 'overloaded', status: 503 },
      })

      expect(assistantAt(SESSION).retry).toEqual({
        attempt: 2,
        at: 1700,
        error: { type: 'provider_error', message: 'overloaded', status: 503 },
      })
    })

    it('助手消息不存在时也能建（重试可能早于任何文本）', () => {
      messageStore.handleRetryScheduled({
        sessionID: SESSION,
        assistantMessageID: 'message-fresh',
        attempt: 1,
        at: 10,
        error: { type: 'x', message: 'boom' },
      })

      expect(messageIds(SESSION)).toEqual(['message-fresh'])
      expect(assistantAt(SESSION).retry).toMatchObject({ attempt: 1, at: 10 })
    })

    it('重放同一 attempt 只留最后一条 retry（助手消息上只有一个 retry 字段）', () => {
      const payload = {
        sessionID: SESSION,
        assistantMessageID: 'message-1',
        attempt: 3,
        at: 20,
        error: { type: 'x', message: 'again' },
      }
      messageStore.handleRetryScheduled({ ...payload })
      messageStore.handleRetryScheduled({ ...payload })

      expect(assistantAt(SESSION).retry).toMatchObject({ attempt: 3, at: 20 })
    })

    it('step.started 会清掉 retry', () => {
      messageStore.handleRetryScheduled({
        sessionID: SESSION,
        assistantMessageID: 'message-1',
        attempt: 1,
        at: 10,
        error: { type: 'x', message: 'boom' },
      })
      expect(assistantAt(SESSION).retry).toBeDefined()

      messageStore.handleStepStarted(stepStartedData('message-1', 50))

      expect(assistantAt(SESSION).retry).toBeUndefined()
    })

    it('execution 结束会清掉 retry', () => {
      messageStore.handleRetryScheduled({
        sessionID: SESSION,
        assistantMessageID: 'message-1',
        attempt: 1,
        at: 10,
        error: { type: 'x', message: 'boom' },
      })

      messageStore.handleExecutionFailed({ sessionID: SESSION, error: { type: 'x', message: 'boom' } })

      expect(assistantAt(SESSION).retry).toBeUndefined()
    })
  })

  // ============================================
  // 执行生命周期
  // ============================================

  describe('7) 执行结束（session.execution.*）', () => {
    it('succeeded → 会话 idle + 插入 outcome=succeeded 的 idle 消息（id 由事件 id 派生）', () => {
      messageStore.handleExecutionStarted({ sessionID: SESSION })
      expect(messageStore.getIsStreaming(SESSION)).toBe(true)

      messageStore.handleExecutionSucceeded({ sessionID: SESSION }, { id: 'evt_done', created: 200 })

      const state = messageStore.getSessionState(SESSION)
      expect(state?.isStreaming).toBe(false)
      const idle = state?.messages.at(-1)
      expect(idle).toMatchObject({ id: 'msg_done', type: 'idle', outcome: 'succeeded', time: { created: 200 } })
    })

    it('failed → outcome=failed', () => {
      messageStore.handleExecutionFailed({ sessionID: SESSION, error: { type: 'x', message: 'boom' } })

      expect(messageStore.getSessionState(SESSION)?.messages.at(-1)).toMatchObject({
        type: 'idle',
        outcome: 'failed',
      })
    })

    it('interrupted（reason=user）→ outcome=interrupted', () => {
      messageStore.handleExecutionInterrupted({ sessionID: SESSION, reason: 'user' })

      expect(messageStore.getSessionState(SESSION)?.messages.at(-1)).toMatchObject({
        type: 'idle',
        outcome: 'interrupted',
      })
    })

    it('interrupted + reason=shutdown → 不插入 idle 消息', () => {
      messageStore.handleExecutionInterrupted({ sessionID: SESSION, reason: 'shutdown' })

      expect(messageStore.getSessionState(SESSION)?.messages).toEqual([])
      expect(messageStore.getIsStreaming(SESSION)).toBe(false)
    })
  })

  // ============================================
  // 压缩
  // ============================================

  describe('8) 压缩（session.compaction.*）', () => {
    it('started 插入 running 压缩消息，delta 追加到 summary，ended 改写成 completed', () => {
      messageStore.handleCompactionStarted(
        { sessionID: SESSION, reason: 'auto', recent: 'recent-context' },
        { id: 'evt_compact', created: 300 },
      )

      expect(messageStore.getSessionState(SESSION)?.messages.at(-1)).toMatchObject({
        id: 'msg_compact',
        type: 'compaction',
        status: 'running',
        summary: '',
        recent: 'recent-context',
        time: { created: 300 },
      })

      messageStore.handleCompactionDelta({ sessionID: SESSION, text: 'sum' })
      messageStore.handleCompactionDelta({ sessionID: SESSION, text: 'mary' })
      expect(messageStore.getSessionState(SESSION)?.messages.at(-1)).toMatchObject({ summary: 'summary' })

      messageStore.handleCompactionEnded(
        { sessionID: SESSION, reason: 'auto', text: 'final summary', recent: 'r2' },
        { id: 'evt_ended', created: 320 },
      )

      expect(messageStore.getSessionState(SESSION)?.messages.at(-1)).toMatchObject({
        id: 'msg_compact',
        type: 'compaction',
        status: 'completed',
        summary: 'final summary',
        recent: 'r2',
      })
    })

    it('没有 running 压缩时，ended 会新插一条 completed', () => {
      messageStore.handleCompactionEnded(
        { sessionID: SESSION, reason: 'manual', text: 'late', recent: 'r' },
        { id: 'evt_late', created: 400 },
      )

      expect(messageStore.getSessionState(SESSION)?.messages.at(-1)).toMatchObject({
        id: 'msg_late',
        type: 'compaction',
        status: 'completed',
        summary: 'late',
      })
    })

    it('failed 把 running 压缩改写成 failed（id 沿用 running 那条）', () => {
      messageStore.handleCompactionStarted(
        { sessionID: SESSION, reason: 'auto', recent: 'r' },
        { id: 'evt_compact', created: 300 },
      )
      messageStore.handleCompactionFailed({
        sessionID: SESSION,
        reason: 'auto',
        error: { type: 'compaction.failed', message: 'boom' },
      })

      const failed = messageStore.getSessionState(SESSION)?.messages.at(-1)
      expect(failed).toMatchObject({ id: 'msg_compact', type: 'compaction', status: 'failed' })
      expect(failed && failed.type === 'compaction' && failed.status === 'failed' ? failed.error : undefined).toEqual({
        type: 'compaction.failed',
        message: 'boom',
      })
    })
  })

  // ============================================
  // content id 契约
  // ============================================

  describe('9) content 派生 id（contentEntries，按 kind 各自计数）', () => {
    it('[text, reasoning, text] → :text:0 / :reasoning:0 / :text:1', () => {
      const message = createAssistantMessage('message-1', [
        { type: 'text', text: 'first' },
        { type: 'reasoning', text: 'thinking' },
        { type: 'text', text: 'second' },
      ])

      expect(contentEntries(message).map(entry => entry.id)).toEqual([
        'message-1:text:0',
        'message-1:reasoning:0',
        'message-1:text:1',
      ])
    })

    it('派生 id 与流式 delta 的目标一致（第二段文本 + 唯一的推理片段）', () => {
      messageStore.handleMessageUpdated(
        createAssistantMessage('message-1', [
          { type: 'text', text: 'first' },
          { type: 'reasoning', text: 'thinking' },
          { type: 'text', text: 'second' },
        ]),
        SESSION,
      )

      messageStore.handleTextDelta(textDeltaData(' +more', 1))
      messageStore.handleReasoningDelta(reasoningDeltaData(' +deeper', 0))
      flushFrames()

      const entries = contentEntries(assistantAt(SESSION))
      expect(entries.map(entry => entry.id)).toEqual(['message-1:text:0', 'message-1:reasoning:0', 'message-1:text:1'])
      expect(entries[0].content).toMatchObject({ text: 'first' })
      expect(entries[1].content).toMatchObject({ text: 'thinking +deeper' })
      expect(entries[2].content).toMatchObject({ text: 'second +more' })
    })
  })

  // ============================================
  // store 基础设施
  // ============================================

  it('重连后标记 stale，重新装载后清掉标记', () => {
    messageStore.setMessages(SESSION, [createAssistantMessage('message-1', textContent('hello'))])
    expect(messageStore.isSessionStale(SESSION)).toBe(false)

    messageStore.markAllSessionsStale()
    expect(messageStore.isSessionStale(SESSION)).toBe(true)

    messageStore.setMessages(SESSION, [createAssistantMessage('message-1', textContent('hello again'))])
    expect(messageStore.isSessionStale(SESSION)).toBe(false)
  })

  it('truncateAfterRevert 截断撤销点之后的消息', () => {
    messageStore.setMessages(SESSION, [
      createAssistantMessage('message-1', textContent('one')),
      createAssistantMessage('message-2', textContent('two')),
      createAssistantMessage('message-3', textContent('three')),
    ])
    messageStore.setRevertState(SESSION, { messageId: 'message-2', history: [] })

    messageStore.truncateAfterRevert(SESSION)

    expect(messageIds(SESSION)).toEqual(['message-1'])
    expect(messageStore.getRevertState(SESSION)).toBeNull()
  })

  it('prependMessages 去重后前插历史页', () => {
    messageStore.setMessages(SESSION, [createAssistantMessage('message-2', textContent('two'))])

    messageStore.prependMessages(
      SESSION,
      [
        createAssistantMessage('message-1', textContent('one')),
        createAssistantMessage('message-2', textContent('duplicate')),
      ],
      true,
    )

    expect(messageIds(SESSION)).toEqual(['message-1', 'message-2'])
    expect(messageStore.getHasMoreHistory(SESSION)).toBe(true)
  })

  it('setStreaming 会建会话；对不存在的会话关流不会建', () => {
    messageStore.setStreaming(SESSION, true)
    expect(messageStore.getSessionState(SESSION)?.isStreaming).toBe(true)
    expect(messageStore.getSessionState(SESSION)?.messages).toHaveLength(0)
    expect(messageStore.getLoadState(SESSION)).toBe('idle')

    messageStore.setStreaming('session-2', false)
    expect(messageStore.getSessionState('session-2')).toBeUndefined()
  })

  it('仍在流式输出时保留本地更长的 live 文本', () => {
    messageStore.handleStepStarted(stepStartedData())
    messageStore.handleTextStarted(textStartedData())
    messageStore.handleTextDelta(textDeltaData('hello world from live'))

    // 服务端列表滞后（只有前缀）→ 不能把 live 文本截短
    messageStore.handleMessageUpdated(createAssistantMessage('message-1', textContent('hello')), SESSION)

    expect(textAt(SESSION)).toBe('hello world from live')
  })

  it('服务端定稿后强制采用服务端文本（哪怕本地 live 更长）', () => {
    messageStore.setMessages(SESSION, [createAssistantMessage('message-1', textContent('hello world extra'))])

    messageStore.setMessages(SESSION, [createAssistantMessage('message-1', textContent('hello world'), 99)])

    expect(textAt(SESSION)).toBe('hello world')
  })

  it('handleMessageUpdated 对定稿消息强制采用服务端', () => {
    messageStore.setMessages(SESSION, [createAssistantMessage('message-1', textContent('hello world extra'), 10)])

    messageStore.handleMessageUpdated(createAssistantMessage('message-1', textContent('hello world'), 10), SESSION)

    expect(textAt(SESSION)).toBe('hello world')
  })

  it('setMessages 保留服务端列表还没有的本地流式助手消息', () => {
    messageStore.handleStepStarted(stepStartedData('message-live', 500))
    messageStore.handleTextStarted(textStartedData(0, 'message-live'))

    messageStore.setMessages(SESSION, [createAssistantMessage('message-1', textContent('server'), 9)])

    expect(messageIds(SESSION)).toContain('message-live')
  })

  it('setMessages 保留本地乐观插入（upsertLocalMessage）的消息', () => {
    messageStore.upsertLocalMessage(SESSION, createUserMessage('local-1', 50))

    messageStore.setMessages(SESSION, [createAssistantMessage('message-1', textContent('server'), 9)])

    expect(messageIds(SESSION)).toEqual(['message-1', 'local-1'])

    // 服务端确认后不再需要本地保护
    messageStore.setMessages(SESSION, [
      createUserMessage('local-1', 50),
      createAssistantMessage('message-1', textContent('server'), 9),
    ])
    expect(messageIds(SESSION)).toEqual(['local-1', 'message-1'])
  })

  it('同一帧内多个会话的 delta 各自生成新引用', () => {
    messageStore.setMessages(SESSION, [createAssistantMessage('message-1', textContent('hello'))])
    messageStore.setMessages('session-2', [createAssistantMessage('message-2', textContent('world'))])

    const beforeMessage1 = messageStore.getSessionState(SESSION)?.messages[0]
    const beforeMessage2 = messageStore.getSessionState('session-2')?.messages[0]

    messageStore.handleTextDelta(textDeltaData('!'))
    messageStore.handleTextDelta(textDeltaData('?', 0, 'message-2', 'session-2'))

    flushFrames()

    const afterMessage1 = messageStore.getSessionState(SESSION)?.messages[0]
    const afterMessage2 = messageStore.getSessionState('session-2')?.messages[0]

    expect(textAt(SESSION)).toBe('hello!')
    expect(textAt('session-2')).toBe('world?')
    expect(afterMessage1).not.toBe(beforeMessage1)
    expect(afterMessage2).not.toBe(beforeMessage2)
  })

  it('只刷新真正变化的内容片段，稳定片段继续复用引用', () => {
    messageStore.setMessages(SESSION, [
      createAssistantMessage('message-1', [
        { type: 'text', text: 'settled' },
        { type: 'text', text: 'live' },
      ]),
    ])

    const beforeMessage = messageStore.getSessionState(SESSION)?.messages[0]
    const beforeSettled = beforeMessage?.type === 'assistant' ? beforeMessage.content[0] : undefined
    const beforeLive = beforeMessage?.type === 'assistant' ? beforeMessage.content[1] : undefined

    messageStore.handleTextDelta(textDeltaData(' text'))
    flushFrames()

    const afterMessage = messageStore.getSessionState(SESSION)?.messages[0]
    const afterContent = afterMessage?.type === 'assistant' ? afterMessage.content : []

    expect(afterMessage).not.toBe(beforeMessage)
    expect(afterContent[0]).toBe(beforeSettled)
    expect(afterContent[1]).not.toBe(beforeLive)
    expect(afterContent[1]).toMatchObject({ text: 'live text' })
  })

  it('只通知消息真正变化的会话', () => {
    const session1Subscriber = vi.fn()
    const session2Subscriber = vi.fn()
    const allSubscriber = vi.fn()

    const unsubscribeSession1 = messageStore.subscribeSession(SESSION, session1Subscriber)
    const unsubscribeSession2 = messageStore.subscribeSession('session-2', session2Subscriber)
    const unsubscribeAll = messageStore.subscribe(allSubscriber)

    messageStore.setMessages('session-2', [createAssistantMessage('message-2', textContent('world'))])
    flushFrames()

    expect(session1Subscriber).not.toHaveBeenCalled()
    expect(session2Subscriber).toHaveBeenCalledTimes(1)
    expect(allSubscriber).toHaveBeenCalledTimes(1)

    unsubscribeSession1()
    unsubscribeSession2()
    unsubscribeAll()
  })
})
