import { describe, expect, it } from 'vitest'
import type { AssistantMessage, UserMessage } from './message'
import {
  assistantText,
  contentEntries,
  hasRenderableContent,
  hasVisibleText,
  isAssistantMessage,
  isUserMessage,
  resolveContent,
  userMessageText,
} from './message'

// ============================================
// 原生消息辅助函数
//
// 这些函数的 id 算法必须与官方完全一致：
//   packages/session-ui/src/timeline/projection.ts → contentEntries / resolveContent
//   `${message.id}:${content.type}:${按 kind 计数的 ordinal}`，tool 直接用 content.id
// ============================================

function assistant(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    id: 'msg_1',
    type: 'assistant',
    agent: 'build',
    model: { id: 'gpt-4o', providerID: 'openai' },
    content: [],
    time: { created: 1 },
    ...overrides,
  }
}

function user(overrides: Partial<UserMessage> = {}): UserMessage {
  return { id: 'msg_u', type: 'user', text: 'hi', time: { created: 0 }, ...overrides }
}

describe('contentEntries — 内容 id 派生', () => {
  it('text/reasoning 的 ordinal 按 kind 各自计数', () => {
    const entries = contentEntries(
      assistant({
        content: [
          { type: 'text', text: 'a' },
          { type: 'reasoning', text: 'r' },
          { type: 'text', text: 'b' },
        ],
      }),
    )

    expect(entries.map(e => e.id)).toEqual(['msg_1:text:0', 'msg_1:reasoning:0', 'msg_1:text:1'])
  })

  it('tool 直接用 content.id，不参与 ordinal 计数', () => {
    const entries = contentEntries(
      assistant({
        content: [
          { type: 'text', text: 'a' },
          {
            type: 'tool',
            id: 'tool_x',
            name: 'bash',
            state: { status: 'streaming', input: '' },
            time: { created: 2 },
          },
          { type: 'text', text: 'b' },
        ],
      }),
    )

    expect(entries.map(e => e.id)).toEqual(['msg_1:text:0', 'tool_x', 'msg_1:text:1'])
  })

  it('保留 content 原对象（便于流式原地读取）', () => {
    const content = { type: 'text' as const, text: 'live' }
    const entries = contentEntries(assistant({ content: [content] }))

    expect(entries[0].content).toBe(content)
  })
})

describe('resolveContent — 按 id 反查', () => {
  it('能查到 text / tool', () => {
    const message = assistant({
      content: [
        { type: 'text', text: 'hello' },
        { type: 'tool', id: 'tool_1', name: 'read', state: { status: 'streaming', input: '' }, time: { created: 1 } },
      ],
    })

    expect(resolveContent(message, 'msg_1:text:0')).toMatchObject({ type: 'text', text: 'hello' })
    expect(resolveContent(message, 'tool_1')).toMatchObject({ type: 'tool', name: 'read' })
    expect(resolveContent(message, 'nope')).toBeUndefined()
  })

  it('用户消息 / undefined 不参与内容查找', () => {
    expect(resolveContent(user(), 'msg_u:text:0')).toBeUndefined()
    expect(resolveContent(undefined, 'x')).toBeUndefined()
  })
})

describe('判别与文本辅助', () => {
  it('isUserMessage / isAssistantMessage 按 type 收窄', () => {
    expect(isUserMessage(user())).toBe(true)
    expect(isAssistantMessage(user())).toBe(false)
    expect(isAssistantMessage(assistant())).toBe(true)
    expect(isUserMessage(assistant())).toBe(false)
  })

  it('assistantText 拼接全部 text 片段（忽略 reasoning / tool）', () => {
    const message = assistant({
      content: [
        { type: 'text', text: 'a' },
        { type: 'reasoning', text: 'hidden' },
        { type: 'text', text: 'b' },
      ],
    })

    expect(assistantText(message)).toBe('ab')
  })

  it('userMessageText 就是 message.text', () => {
    expect(userMessageText(user({ text: 'hi there' }))).toBe('hi there')
    // 防御：字段缺失时不崩
    expect(userMessageText({ ...user(), text: undefined as unknown as string })).toBe('')
  })

  it('hasVisibleText 只对 text/reasoning 判定空白', () => {
    expect(hasVisibleText({ type: 'text', text: ' ' })).toBe(false)
    expect(hasVisibleText({ type: 'text', text: 'a' })).toBe(true)
    expect(
      hasVisibleText({
        type: 'tool',
        id: 't',
        name: 'x',
        state: { status: 'streaming', input: '' },
        time: { created: 0 },
      }),
    ).toBe(false)
  })

  it('hasRenderableContent：非 text 内容一律视为可渲染', () => {
    expect(hasRenderableContent(assistant({ content: [{ type: 'text', text: '  ' }] }))).toBe(false)
    expect(hasRenderableContent(assistant({ content: [{ type: 'text', text: 'x' }] }))).toBe(true)
    expect(
      hasRenderableContent(
        assistant({
          content: [
            { type: 'tool', id: 't', name: 'x', state: { status: 'streaming', input: '' }, time: { created: 0 } },
          ],
        }),
      ),
    ).toBe(true)
  })
})
