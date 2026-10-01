import { describe, expect, it } from 'vitest'
import type { AssistantMessage, SessionMessage, UserMessage } from '../api/types'
import { contentToParts, toAssistantMessageInfo, toMessageInfo, toUIMessage, toUIMessages, toUIToolState } from './v2Projection'

// ============================================
// v2Projection 是整个迁移的枢纽：渲染层完全依赖它把 v2 的
// `type` + `content` 变成 UI 的 `{ info, parts }`。
// 之前没有专门测试，这里的用例锁住这层契约。
// ============================================

const SESSION = 'session-1'

function userMessage(overrides: Partial<UserMessage> = {}): UserMessage {
  return {
    id: 'user-1',
    type: 'user',
    time: { created: 1 },
    text: 'hello world',
    ...overrides,
  }
}

function assistantMessage(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    id: 'assistant-1',
    type: 'assistant',
    agent: 'build',
    model: { id: 'gpt-4o', providerID: 'openai' },
    content: [],
    time: { created: 2 },
    ...overrides,
  }
}

describe('v2Projection — 消息 info', () => {
  it('把 v2 用户消息投影成 UI 的 user info（role 而非 type）', () => {
    const info = toMessageInfo(userMessage(), SESSION)

    expect(info.role).toBe('user')
    expect(info.id).toBe('user-1')
    // v2 消息不带 sessionID，必须由调用方补上
    expect(info.sessionID).toBe(SESSION)
    expect(info.time.created).toBe(1)
  })

  it('把 v2 助手消息投影成 UI 的 assistant info，并保留 tokens/cost', () => {
    const info = toAssistantMessageInfo(
      assistantMessage({
        tokens: { input: 120, output: 30, reasoning: 5, cache: { read: 7, write: 3 } },
        cost: 0.0123,
      }),
      SESSION,
    )

    expect(info.role).toBe('assistant')
    expect(info.tokens).toEqual({ input: 120, output: 30, reasoning: 5, cache: { read: 7, write: 3 } })
    expect(info.cost).toBeCloseTo(0.0123)
  })

  it('缺少 tokens / cost 时用零值兜底，避免渲染层拿到 undefined', () => {
    const info = toAssistantMessageInfo(assistantMessage(), SESSION)

    expect(info.tokens).toEqual({ input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } })
    expect(info.cost).toBe(0)
  })

  it('未定稿（无 completed）的助手消息标记为流式中', () => {
    const streaming = toUIMessage(assistantMessage({ time: { created: 2 } }), SESSION)
    const done = toUIMessage(assistantMessage({ time: { created: 2, completed: 3 } }), SESSION)

    expect(streaming.isStreaming).toBe(true)
    expect(done.isStreaming).toBe(false)
  })

  it('对 UI 无对应展示的消息类型（如 idle）也返回可用的 info', () => {
    const info = toMessageInfo({ id: 'idle-1', type: 'idle', time: { created: 9 } } as SessionMessage, SESSION)

    expect(info.id).toBe('idle-1')
    expect(info.sessionID).toBe(SESSION)
  })
})

describe('v2Projection — content → parts', () => {
  it('part id 用 content 数组下标作为 ordinal（流式增量靠它定位）', () => {
    const parts = contentToParts(
      [
        { type: 'text', text: 'first' },
        { type: 'reasoning', text: 'thinking' },
        { type: 'text', text: 'second' },
      ],
      SESSION,
      'assistant-1',
    )

    // 关键契约：ordinal 是**在整个 content 数组里的下标**，不是「同类里的第几个」。
    // v2 的 session.text.delta / reasoning.delta 携带的 ordinal 就是 content 下标，
    // messageStore 的 handleTextDelta/handleReasoningDelta 按同一个规则拼 part id，
    // 两边必须一致，否则流式文本会落到错误的位置。
    expect(parts.map(p => p.id)).toEqual(['assistant-1:text:0', 'assistant-1:reasoning:1', 'assistant-1:text:2'])
    expect(parts.map(p => p.type)).toEqual(['text', 'reasoning', 'text'])
  })

  it('工具 part 以工具 id 为 part id，投影出 tool 名称与状态', () => {
    const parts = contentToParts(
      [
        {
          type: 'tool',
          id: 'tool-abc',
          name: 'bash',
          state: {
            status: 'completed',
            input: { command: 'ls' },
            content: [{ type: 'text', text: 'a.txt' }],
          },
          time: { created: 1, completed: 2 },
        },
      ],
      SESSION,
      'assistant-1',
    )

    expect(parts).toHaveLength(1)
    expect(parts[0]).toMatchObject({
      id: 'assistant-1:tool:tool-abc',
      type: 'tool',
      callID: 'tool-abc',
      tool: 'bash',
      state: { status: 'completed', output: 'a.txt' },
    })
  })

  it('文件与 agent 附件投影成各自的 part', () => {
    const user = toUIMessage(
      userMessage({
        files: [
          {
            mime: 'text/plain',
            data: '',
            source: { type: 'uri', uri: 'src/app.ts' },
            name: 'app.ts',
          },
        ] as UserMessage['files'],
      }),
      SESSION,
    )

    expect(user.parts.some(p => p.type === 'file')).toBe(true)
  })
})

describe('v2Projection — 工具状态机', () => {
  it('running → running，input 原样保留', () => {
    const state = toUIToolState({
      status: 'running',
      input: { command: 'npm test' },
      metadata: {},
    } as never)

    expect(state).toMatchObject({ status: 'running', input: { command: 'npm test' } })
  })

  it('completed 的文本 content 拼成 output', () => {
    const state = toUIToolState({
      status: 'completed',
      input: {},
      content: [
        { type: 'text', text: 'line1' },
        { type: 'text', text: 'line2' },
      ],
    } as never)

    expect(state).toMatchObject({ status: 'completed' })
    expect((state as { output?: string }).output).toContain('line1')
    expect((state as { output?: string }).output).toContain('line2')
  })

  it('error 状态带上错误信息', () => {
    const state = toUIToolState({
      status: 'error',
      input: {},
      error: 'boom',
    } as never)

    expect(state).toMatchObject({ status: 'error' })
    expect(JSON.stringify(state)).toContain('boom')
  })
})

describe('v2Projection — compaction 消息', () => {
  it('投影出一个 compaction part（上下文估算靠它判断压缩点）', () => {
    const message = toUIMessage(
      {
        id: 'compaction-1',
        type: 'compaction',
        status: 'completed',
        reason: 'auto',
        summary: 'summary text',
        recent: '',
        time: { created: 5 },
      } as SessionMessage,
      SESSION,
    )

    expect(message.parts).toHaveLength(1)
    expect(message.parts[0]).toMatchObject({ type: 'compaction', auto: true, messageID: 'compaction-1' })
  })

  it('手动压缩标记 auto 为 false', () => {
    const message = toUIMessage(
      {
        id: 'compaction-2',
        type: 'compaction',
        status: 'completed',
        reason: 'manual',
        summary: 's',
        recent: '',
        time: { created: 6 },
      } as SessionMessage,
      SESSION,
    )

    expect(message.parts[0]).toMatchObject({ type: 'compaction', auto: false })
  })
})

describe('v2Projection — 批量与顺序', () => {
  it('toUIMessages 保持输入顺序，便于按序渲染', () => {
    const messages = toUIMessages(
      [
        userMessage({ id: 'u1' }),
        assistantMessage({ id: 'a1', content: [{ type: 'text', text: 'hi' }] }),
        userMessage({ id: 'u2' }),
      ],
      SESSION,
    )

    expect(messages.map(m => m.info.id)).toEqual(['u1', 'a1', 'u2'])
    expect(messages.map(m => m.info.role)).toEqual(['user', 'assistant', 'user'])
  })
})
