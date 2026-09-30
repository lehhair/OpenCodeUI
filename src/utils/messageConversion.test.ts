// ============================================
// messageConversion 单元测试（阶段 2a）
// ============================================
//
// 覆盖重点（都是「错了会静默出问题」的地方）：
//   1. V2 消息没有 sessionID → 转换层必须补上（否则 store 按 session 分组全失效）
//   2. text / reasoning 没有 id → 必须按下标合成稳定 id（否则 React key / 折叠状态错位）
//   3. 工具状态机字段改名（pending→streaming、output→content、callID→id、tool→name）
//   4. 错误类型映射（V2 的开放字符串 → UI 的 5 个具名类型，aborted 必须认出来）
//   5. 9 种新增消息类型都要有归宿（不能静默丢消息）

import { describe, expect, it } from 'vitest'
import { toUIMessage, toUIMessages, isUserUIMessage } from './messageConversion'
import { isSystemMessage, isAssistantMessage, isUserMessage } from '../types/message'
import { v2Assistant, v2Compaction, v2Idle, v2System, v2Tool, v2User } from '../test/fixtures/v2Messages'
import type { SessionMessageInfo } from '../types/api/message'

const SID = 'ses_test'

describe('toUIMessage — user', () => {
  it('maps the flat text field and fills sessionID', () => {
    const message = toUIMessage(v2User('msg_1', 'hello'), SID)

    expect(message.info).toMatchObject({ id: 'msg_1', sessionID: SID, role: 'user' })
    expect(message.parts).toHaveLength(1)
    expect(message.parts[0]).toMatchObject({
      type: 'text',
      text: 'hello',
      sessionID: SID,
      messageID: 'msg_1',
      synthetic: false,
    })
  })

  it('reads agent / model from metadata (not a V2 contract field)', () => {
    const message = toUIMessage(
      v2User('msg_1', 'hi', {
        metadata: { agent: 'build', model: { providerID: 'p', modelID: 'm', variant: 'max' } },
      }),
      SID,
    )

    expect(message.info).toMatchObject({ agent: 'build', model: { providerID: 'p', modelID: 'm', variant: 'max' } })
  })

  it('tolerates metadata.model written with the V2 field name (id)', () => {
    const message = toUIMessage(v2User('msg_1', 'hi', { metadata: { model: { providerID: 'p', id: 'm2' } } }), SID)

    expect(message.info).toMatchObject({ model: { providerID: 'p', modelID: 'm2' } })
  })

  it('falls back to empty agent/model when metadata is absent', () => {
    const message = toUIMessage(v2User('msg_1', 'hi'), SID)

    expect(message.info).toMatchObject({ agent: '', model: { providerID: '', modelID: '' } })
  })

  it('maps inline base64 attachments to a data URL (V2 has no url field)', () => {
    const message = toUIMessage(
      v2User('msg_1', 'look', {
        files: [{ data: 'AAAA', mime: 'image/png', source: { type: 'inline' }, name: 'shot.png' }],
      }),
      SID,
    )

    const filePart = message.parts.find(p => p.type === 'file')
    expect(filePart).toMatchObject({
      type: 'file',
      mime: 'image/png',
      filename: 'shot.png',
      url: 'data:image/png;base64,AAAA',
      id: 'msg_1:file:0',
    })
  })

  it('maps uri attachments to their uri and carries the mention range', () => {
    const message = toUIMessage(
      v2User('msg_1', 'look', {
        files: [
          {
            data: '',
            mime: 'text/plain',
            source: { type: 'uri', uri: 'file:///tmp/a.txt' },
            mention: { start: 3, end: 8, text: 'a.txt' },
          },
        ],
      }),
      SID,
    )

    const filePart = message.parts.find(p => p.type === 'file')
    expect(filePart).toMatchObject({
      url: 'file:///tmp/a.txt',
      source: { type: 'file', path: 'file:///tmp/a.txt', text: { value: 'a.txt', start: 3, end: 8 } },
    })
  })

  it('maps agents and skills attachments', () => {
    const message = toUIMessage(
      v2User('msg_1', 'go', {
        agents: [{ name: 'build' }],
        skills: [{ id: 'sk_1', name: 'review', text: 'do a review' }],
      }),
      SID,
    )

    expect(message.parts.find(p => p.type === 'agent')).toMatchObject({ name: 'build', id: 'msg_1:agent:0' })
    expect(message.parts.find(p => p.type === 'skill')).toMatchObject({
      skill: 'sk_1',
      name: 'review',
      text: 'do a review',
    })
  })

  it('omits the text part when the user message has empty text', () => {
    const message = toUIMessage(v2User('msg_1', ''), SID)
    expect(message.parts).toHaveLength(0)
  })

  it('is recognised by the user type guard', () => {
    expect(isUserUIMessage(toUIMessage(v2User('msg_1', 'hi'), SID))).toBe(true)
    expect(isUserUIMessage(toUIMessage(v2Assistant('msg_2', 'yo'), SID))).toBe(false)
  })
})

describe('toUIMessage — assistant', () => {
  it('flattens content into parts with index-based ids', () => {
    const message = toUIMessage(
      v2Assistant('msg_1', '', {
        content: [
          { type: 'text', text: 'a' },
          { type: 'reasoning', text: 'r' },
          { type: 'text', text: 'b' },
        ],
      }),
      SID,
    )

    expect(message.parts.slice(0, 3).map(p => [p.type, p.id])).toEqual([
      ['text', 'msg_1:content:0'],
      ['reasoning', 'msg_1:content:1'],
      ['text', 'msg_1:content:2'],
    ])
  })

  it('renames model / provider fields and keeps cost + tokens on the message', () => {
    const message = toUIMessage(
      v2Assistant('msg_1', 'hi', {
        model: { id: 'm1', providerID: 'p1', variant: 'max' },
        cost: 0.5,
        tokens: { input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } },
        finish: 'tool-calls',
      }),
      SID,
    )

    expect(message.info).toMatchObject({
      role: 'assistant',
      // V2 的 model.id → UI 的 modelID
      modelID: 'm1',
      providerID: 'p1',
      agent: 'build',
      cost: 0.5,
      tokens: { input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } },
      finish: 'tool-calls',
    })
  })

  it('synthesises a trailing step-finish part so the renderer can split process/final', () => {
    const message = toUIMessage(v2Assistant('msg_1', 'final answer'), SID)

    const stepFinish = message.parts.find(p => p.type === 'step-finish')
    expect(stepFinish).toMatchObject({
      id: 'msg_1:step-finish:0',
      messageID: 'msg_1',
      reason: 'stop',
      cost: 0,
    })
  })

  it('does not synthesise step-finish while the step is still streaming', () => {
    const message = toUIMessage(v2Assistant('msg_1', 'partial', { finish: undefined, time: { created: 1 } }), SID)

    expect(message.parts.some(p => p.type === 'step-finish')).toBe(false)
    expect(message.isStreaming).toBe(true)
  })

  it('marks a message with time.completed as not streaming', () => {
    expect(toUIMessage(v2Assistant('msg_1', 'done'), SID).isStreaming).toBe(false)
  })

  it('converts Assistant.retry into a retry part', () => {
    const message = toUIMessage(
      v2Assistant('msg_1', 'hi', {
        retry: { attempt: 2, at: 123, error: { type: 'provider.error', message: 'boom', status: 500 } },
      }),
      SID,
    )

    const retry = message.parts.find(p => p.type === 'retry')
    expect(retry).toMatchObject({
      attempt: 2,
      time: { created: 123 },
      error: { name: 'APIError', data: { message: 'boom', statusCode: 500, isRetryable: true } },
    })
  })
})

describe('toUIMessage — tool state machine', () => {
  it('maps streaming → pending and keeps the raw input string', () => {
    const message = toUIMessage(
      v2Assistant('msg_1', '', {
        content: [v2Tool('call_1', 'edit', { state: { status: 'streaming', input: '{"a"' } })],
      }),
      SID,
    )

    expect(message.parts.find(p => p.type === 'tool')).toMatchObject({
      callID: 'call_1',
      tool: 'edit',
      state: { status: 'pending', raw: '{"a"', input: {} },
    })
  })

  it('joins tool text content into the legacy output string', () => {
    const message = toUIMessage(
      v2Assistant('msg_1', '', {
        content: [
          v2Tool('call_1', 'shell', {
            state: {
              status: 'completed',
              input: { command: 'ls' },
              content: [
                { type: 'text', text: 'a.txt' },
                { type: 'text', text: 'b.txt' },
              ],
            },
          }),
        ],
      }),
      SID,
    )

    expect(message.parts.find(p => p.type === 'tool')).toMatchObject({
      state: { status: 'completed', output: 'a.txt\nb.txt' },
    })
  })

  it('lifts the tool timestamp from the tool wrapper onto the state', () => {
    const message = toUIMessage(
      v2Assistant('msg_1', '', {
        content: [
          v2Tool('call_1', 'shell', {
            time: { created: 10, ran: 11, completed: 20 },
            state: { status: 'completed', input: {}, content: [{ type: 'text', text: '' }] },
          }),
        ],
      }),
      SID,
    )

    // V1 的 state.time 是 {start, end}；V2 把它挪到了工具层的 {created, ran, completed}
    expect(message.parts.find(p => p.type === 'tool')).toMatchObject({ state: { time: { start: 10, end: 20 } } })
  })

  it('maps the error state to a string error message', () => {
    const message = toUIMessage(
      v2Assistant('msg_1', '', {
        content: [
          v2Tool('call_1', 'shell', {
            state: { status: 'error', input: {}, error: { type: 'tool.execution', message: 'exit 1' } },
          }),
        ],
      }),
      SID,
    )

    expect(message.parts.find(p => p.type === 'tool')).toMatchObject({
      state: { status: 'error', error: 'exit 1' },
    })
  })

  it('prefers metadata.title when the server supplied one', () => {
    const message = toUIMessage(
      v2Assistant('msg_1', '', {
        content: [
          v2Tool('call_1', 'shell', {
            state: {
              status: 'completed',
              input: {},
              content: [{ type: 'text', text: '' }],
              metadata: { title: 'List files' },
            },
          }),
        ],
      }),
      SID,
    )

    expect(message.parts.find(p => p.type === 'tool')).toMatchObject({ state: { title: 'List files' } })
  })
})

describe('toUIMessage — error mapping', () => {
  const cases: Array<[string, string]> = [
    ['aborted', 'MessageAbortedError'],
    ['provider.error', 'APIError'],
    ['unknown', 'APIError'],
    ['provider.invalid-output', 'APIError'],
    ['auth.failed', 'ProviderAuthError'],
  ]

  for (const [type, expectedName] of cases) {
    it(`maps V2 error type "${type}" to ${expectedName}`, () => {
      const message = toUIMessage(v2Assistant('msg_1', 'x', { error: { type, message: 'm' } }), SID)
      expect((message.info as { error?: { name: string } }).error?.name).toBe(expectedName)
    })
  }

  it('leaves error undefined when the message has none', () => {
    const message = toUIMessage(v2Assistant('msg_1', 'x'), SID)
    expect((message.info as { error?: unknown }).error).toBeUndefined()
  })
})

describe('toUIMessage — V2-only message types', () => {
  it('routes system messages to a system info with a session-marker part', () => {
    const message = toUIMessage(v2System('msg_1', 'env text', 'Instructions updated'), SID)

    expect(message.info).toMatchObject({ role: 'system', kind: 'system', sessionID: SID })
    expect(message.parts[0]).toMatchObject({ type: 'session-marker', id: 'msg_1:marker:0' })
    expect(message.parts[0]).toMatchObject({ marker: { type: 'system', description: 'Instructions updated' } })
  })

  it('keeps the raw marker payload so renderers stay strongly typed', () => {
    const message = toUIMessage(v2Idle('msg_1'), SID)
    const part = message.parts[0]
    expect(part).toMatchObject({ type: 'session-marker', marker: { type: 'idle', outcome: 'succeeded' } })
  })

  it('maps compaction to the existing compaction part with V2 status/reason', () => {
    const message = toUIMessage(v2Compaction('msg_1'), SID)

    expect(message.info).toMatchObject({ role: 'system', kind: 'compaction' })
    expect(message.parts[0]).toMatchObject({
      type: 'compaction',
      status: 'completed',
      reason: 'manual',
      auto: false,
      summary: 'summary text',
    })
  })

  it('carries the compaction model ref with the V1 field name', () => {
    const message = toUIMessage(v2Compaction('msg_1', { model: { id: 'm1', providerID: 'p1' } }), SID)

    expect(message.parts[0]).toMatchObject({ model: { providerID: 'p1', modelID: 'm1' } })
  })

  it('maps a failed compaction error', () => {
    const message = toUIMessage(
      v2Compaction('msg_1', { status: 'failed', error: { type: 'unknown', message: 'nope' } }),
      SID,
    )

    expect(message.parts[0]).toMatchObject({ status: 'failed', error: { name: 'APIError' } })
  })

  it('never drops a message: every one of the 11 V2 types produces at least one part', () => {
    const messages: SessionMessageInfo[] = [
      v2User('msg_user', 'hi'),
      v2Assistant('msg_assistant', 'yo'),
      v2System('msg_system', 't'),
      { id: 'msg_synthetic', type: 'synthetic', time: { created: 1 }, text: 'shell out' },
      { id: 'msg_skill', type: 'skill', time: { created: 1 }, skill: 'sk', name: 'review', text: 'x' },
      {
        id: 'msg_shell',
        type: 'shell',
        time: { created: 1 },
        shellID: 'sh_1',
        command: 'ls',
        status: 'exited',
      },
      v2Compaction('msg_compaction'),
      v2Idle('msg_idle'),
      { id: 'msg_agent', type: 'agent-switched', time: { created: 1 }, agent: 'build' },
      { id: 'msg_model', type: 'model-switched', time: { created: 1 }, model: { id: 'm', providerID: 'p' } },
      {
        id: 'msg_location',
        type: 'location-switched',
        time: { created: 1 },
        location: { directory: '/repo' },
      },
    ]

    for (const raw of messages) {
      const ui = toUIMessage(raw, SID)
      expect(ui.parts.length, `type=${raw.type} 应当有 part`).toBeGreaterThan(0)
      expect(ui.info.sessionID).toBe(SID)
    }
    expect(new Set(messages.map(m => m.type)).size).toBe(11)
  })
})

describe('toUIMessages / type guards', () => {
  it('converts a page and preserves order', () => {
    const ui = toUIMessages([v2User('msg_1', 'a'), v2Assistant('msg_2', 'b'), v2Idle('msg_3')], SID)

    expect(ui.map(m => m.info.id)).toEqual(['msg_1', 'msg_2', 'msg_3'])
  })

  it('returns an empty array for an empty page', () => {
    expect(toUIMessages([], SID)).toEqual([])
  })

  it('exposes role predicates that agree with the converted roles', () => {
    const [user, assistant, marker] = toUIMessages(
      [v2User('msg_1', 'a'), v2Assistant('msg_2', 'b'), v2Idle('msg_3')],
      SID,
    ).map(m => m.info)

    expect(isUserMessage(user)).toBe(true)
    expect(isAssistantMessage(assistant)).toBe(true)
    expect(isSystemMessage(marker)).toBe(true)
    // 互斥
    expect(isUserMessage(marker)).toBe(false)
    expect(isAssistantMessage(marker)).toBe(false)
    expect(isSystemMessage(user)).toBe(false)
  })
})
