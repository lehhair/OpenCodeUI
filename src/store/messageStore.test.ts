import { beforeEach, describe, expect, it, vi } from 'vitest'
import { messageStore } from './messageStore'
import { v2Assistant, v2Idle, v2StreamingAssistant, v2System, v2Tool, v2User } from '../test/fixtures/v2Messages'
import type { SessionMessageAssistant } from '../types/api/message'
import type { AssistantContent, PartDeltaPayload, PartUpdatedPayload } from '../types/api/event'

// ============================================
// 测试夹具说明（阶段 2b）
// ============================================
//
// 本文件里有**两套**夹具，对应两条完全不同的数据通路，别混：
//
//   1. **V2 读侧**（`setMessages` / `prependMessages` / `upsertMessages`）
//      —— 入参是 V2 扁平消息 `Session.Message.Info`，用 `v2*` 系列构造器。
//
//   2. **V2 事件侧**（`handleMessageUpdated` / `handlePartUpdated` /
//      `handlePartDelta` / `handleSessionInvalidated`）
//      —— 阶段 2b 已整体换成 V2 载荷（`MessageContentUpdatedPayload` /
//      `PartUpdatedPayload` / `PartDeltaPayload`），用下面的辅助构造器。
//
// 转换后 part id 的合成规则（读侧与事件侧共用，见 messageConversion.ts）：
//   - text / reasoning：`${消息id}:content:${content下标}`
//   - tool：工具自身的 id
//   - 合成的尾部 step-finish：`${消息id}:step-finish:0`

// ── V2 事件侧夹具 ──────────────────────────────────────────

/** V2 assistant 里第 index 个 content 对应的 part id（与转换层同一规则） */
function contentPartId(messageID: string, index = 0): string {
  return `${messageID}:content:${index}`
}

/** 合成的尾部 step-finish part id（与转换层同一规则） */
function stepFinishPartId(messageID: string): string {
  return `${messageID}:step-finish:0`
}

/** 造一个「content 块整块更新」载荷（`kind: 'content'`） */
function contentUpdate(
  messageID: string,
  content: AssistantContent,
  ordinal = 0,
  sessionID = 'session-1',
): PartUpdatedPayload {
  return { kind: 'content', sessionID, messageID, ordinal, content }
}

/** 造一个 text 块的整块更新载荷 */
function textUpdate(messageID: string, text: string, ordinal = 0, sessionID = 'session-1'): PartUpdatedPayload {
  return contentUpdate(messageID, { type: 'text', text }, ordinal, sessionID)
}

/** 造一个 text / reasoning 的增量载荷（partID 按 content 下标合成） */
function textDelta(
  messageID: string,
  delta: string,
  kind: 'text' | 'reasoning' = 'text',
  ordinal = 0,
  sessionID = 'session-1',
): PartDeltaPayload {
  return { sessionID, messageID, partID: contentPartId(messageID, ordinal), kind, delta }
}

describe('messageStore', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    messageStore.clearAll()
  })

  // ============================================
  // V2 事件侧（阶段 2b：handler 入参换成 V2 载荷）
  // ============================================

  it('applies a part update when the message already exists', () => {
    // 事件先到：handleMessageUpdated 用 content 建一条消息
    messageStore.handleMessageUpdated({
      sessionID: 'session-1',
      messageID: 'message-1',
      content: [{ type: 'text', text: 'hello' }],
    })
    messageStore.handlePartUpdated(textUpdate('message-1', 'hello world'))

    const state = messageStore.getSessionState('session-1')
    expect(state?.messages).toHaveLength(1)
    expect(state?.messages[0].parts).toHaveLength(1)
    // 同 id（消息 id + content 下标）→ 原地替换，不追加第二块
    expect(state?.messages[0].parts[0]).toMatchObject({
      id: contentPartId('message-1'),
      type: 'text',
      text: 'hello world',
    })
  })

  it('drops a part update when the session was never loaded', () => {
    // 会话不存在 → 没有可挂载的容器，直接丢弃
    // （V2 语义：会话已加载、消息还没到时会建占位消息，见下一条用例）
    messageStore.handlePartUpdated(textUpdate('message-1', 'hello'))

    expect(messageStore.getSessionState('session-1')).toBeUndefined()
  })

  it('creates a streaming placeholder when a part update arrives before the message', () => {
    // 会话已加载、消息还没进 REST 页：事件侧先建流式占位，避免丢事件
    messageStore.setStreaming('session-1', true)

    messageStore.handlePartUpdated(textUpdate('message-1', 'hello'))

    const state = messageStore.getSessionState('session-1')
    expect(state?.messages).toHaveLength(1)
    expect(state?.messages[0].info).toMatchObject({ id: 'message-1', role: 'assistant' })
    expect(state?.messages[0].parts[0]).toMatchObject({
      id: contentPartId('message-1'),
      type: 'text',
      text: 'hello',
    })
  })

  it('replaces the whole content list when the message content is updated', () => {
    messageStore.handleMessageUpdated({
      sessionID: 'session-1',
      messageID: 'message-1',
      content: [{ type: 'text', text: 'first' }],
    })
    messageStore.handleMessageUpdated({
      sessionID: 'session-1',
      messageID: 'message-1',
      content: [
        { type: 'text', text: 'second' },
        { type: 'text', text: 'third' },
      ],
    })

    const state = messageStore.getSessionState('session-1')
    // 权威全量：旧 content 整体被替换（不是增量合并），part 数量与顺序跟随新数组
    expect(state?.messages).toHaveLength(1)
    expect(state?.messages[0].parts).toHaveLength(2)
    expect(state?.messages[0].parts[0]).toMatchObject({
      id: contentPartId('message-1', 0),
      text: 'second',
    })
    expect(state?.messages[0].parts[1]).toMatchObject({
      id: contentPartId('message-1', 1),
      text: 'third',
    })
  })

  // ============================================
  // V2 读侧：基础转换
  // ============================================

  it('converts V2 user + assistant messages and keeps server order', () => {
    messageStore.setMessages('session-1', [v2User('message-1', 'hi'), v2Assistant('message-2', 'hello')])

    const state = messageStore.getSessionState('session-1')
    expect(state?.messages).toHaveLength(2)
    expect(state?.messages[0].info.role).toBe('user')
    expect(state?.messages[0].info.id).toBe('message-1')
    expect(state?.messages[0].parts[0]).toMatchObject({ type: 'text', text: 'hi' })
    expect(state?.messages[1].info.role).toBe('assistant')
    // assistant 内容 → text part，id 按 content 下标合成
    expect(state?.messages[1].parts[0]).toMatchObject({ type: 'text', text: 'hello' })
    expect(state?.messages[1].parts[0].id).toBe(contentPartId('message-2'))
  })

  it('fills sessionID on every message and part (V2 messages do not carry it)', () => {
    messageStore.setMessages('session-1', [v2User('message-1', 'hi'), v2Assistant('message-2', 'hello')])

    const state = messageStore.getSessionState('session-1')
    for (const message of state?.messages ?? []) {
      expect(message.info.sessionID).toBe('session-1')
      for (const part of message.parts) {
        expect(part.sessionID).toBe('session-1')
        expect(part.messageID).toBe(message.info.id)
      }
    }
  })

  it('maps V2 tool content onto the UI tool part shape', () => {
    const assistant = v2Assistant('message-1', '', {
      content: [
        v2Tool('call_1', 'shell', {
          state: { status: 'completed', input: { command: 'ls' }, content: [{ type: 'text', text: 'a.txt' }] },
        }),
      ],
    })
    messageStore.setMessages('session-1', [assistant])

    const toolPart = messageStore.getSessionState('session-1')?.messages[0].parts.find(p => p.type === 'tool')
    expect(toolPart).toMatchObject({
      id: 'call_1',
      // V1 叫 callID / tool，V2 叫 id / name
      callID: 'call_1',
      tool: 'shell',
      state: { status: 'completed', output: 'a.txt', input: { command: 'ls' } },
    })
  })

  it('maps V2 tool streaming state onto the UI pending state', () => {
    const assistant = v2Assistant('message-1', '', {
      content: [
        v2Tool('call_1', 'edit', {
          // V2 的 streaming：input 是**未解析的字符串**
          state: { status: 'streaming', input: '{"filePath":' },
          time: { created: 1 },
        }),
      ],
      finish: undefined,
      time: { created: 1 },
    })
    messageStore.setMessages('session-1', [assistant])

    const toolPart = messageStore.getSessionState('session-1')?.messages[0].parts.find(p => p.type === 'tool')
    // V2 的 streaming → UI 的 pending（UI 只认 pending/running/completed/error）
    expect(toolPart).toMatchObject({ state: { status: 'pending', raw: '{"filePath":' } })
  })

  it('creates a system message for V2 marker types instead of a fake assistant message', () => {
    messageStore.setMessages('session-1', [v2System('message-1', 'env text', 'Instructions updated')])

    const message = messageStore.getSessionState('session-1')?.messages[0]
    expect(message?.info.role).toBe('system')
    expect(message?.info).toMatchObject({ kind: 'system' })
    expect(message?.parts[0]).toMatchObject({ type: 'session-marker' })
  })

  it('treats a trailing idle marker as "turn finished" rather than streaming', () => {
    messageStore.setMessages('session-1', [v2Assistant('message-1', 'done'), v2Idle('message-2')])

    const state = messageStore.getSessionState('session-1')
    // 最后一条是 idle（role: 'system'）→ 不该被判成流式中
    expect(state?.isStreaming).toBe(false)
  })

  // ============================================
  // V2 读侧：加载状态与元数据
  // ============================================

  it('marks cached sessions stale after reconnect and clears the flag after a fresh load', () => {
    messageStore.setMessages('session-1', [v2Assistant('message-1', 'hello')])

    expect(messageStore.isSessionStale('session-1')).toBe(false)

    messageStore.markAllSessionsStale()
    expect(messageStore.isSessionStale('session-1')).toBe(true)

    messageStore.setMessages('session-1', [v2Assistant('message-1', 'hello again')])
    expect(messageStore.isSessionStale('session-1')).toBe(false)
  })

  it('truncates messages after revert point', () => {
    messageStore.setMessages('session-1', [
      v2Assistant('message-1', 'one'),
      v2Assistant('message-2', 'two'),
      v2Assistant('message-3', 'three'),
    ])
    messageStore.setRevertState('session-1', {
      messageId: 'message-2',
      history: [],
    })

    messageStore.truncateAfterRevert('session-1')

    const state = messageStore.getSessionState('session-1')
    expect(state?.messages).toHaveLength(1)
    expect(state?.messages[0].info.id).toBe('message-1')
    expect(state?.revertState).toBeNull()
  })

  it('marks the session stale when the transcript is invalidated instead of deleting parts locally', () => {
    // V2 没有 message.part.removed：取消/回退会重写服务端转录 →
    // 本地不做增量删除，只置 stale，由上层重拉一次全量消息
    messageStore.setMessages('session-1', [v2StreamingAssistant('message-1', 'hello')])

    messageStore.handleSessionInvalidated('session-1')

    expect(messageStore.isSessionStale('session-1')).toBe(true)
    // 本地 parts 保持原样，等重拉替换
    expect(messageStore.getSessionState('session-1')?.messages[0].parts).toHaveLength(1)
  })

  // ============================================
  // V2 读侧：游标分页
  // ============================================

  it('stores the forward cursor from the page and exposes it via getHistoryCursor', () => {
    messageStore.setMessages('session-1', [v2Assistant('message-1', 'hello')], {
      hasMoreHistory: true,
      historyCursor: 'cursor-older',
    })

    expect(messageStore.getHistoryCursor('session-1')).toBe('cursor-older')
    expect(messageStore.getHasMoreHistory('session-1')).toBe(true)
  })

  it('does not clear the cursor when a metadata refresh omits it', () => {
    messageStore.setMessages('session-1', [v2Assistant('message-1', 'hello')], {
      hasMoreHistory: true,
      historyCursor: 'cursor-older',
    })

    // 只更新元数据、不带 historyCursor → 游标必须保留
    messageStore.updateSessionMetadata('session-1', { title: 'renamed' })

    expect(messageStore.getHistoryCursor('session-1')).toBe('cursor-older')
  })

  it('deduplicates messages in prependMessages and updates the cursor', () => {
    messageStore.setMessages('session-1', [v2Assistant('message-2', 'two')], { historyCursor: 'cursor-1' })

    messageStore.prependMessages(
      'session-1',
      [v2Assistant('message-1', 'one'), v2Assistant('message-2', 'duplicate')],
      true,
      'cursor-2',
    )

    const state = messageStore.getSessionState('session-1')
    expect(state?.messages).toHaveLength(2)
    expect(state?.messages[0].info.id).toBe('message-1')
    expect(state?.messages[1].info.id).toBe('message-2')
    // 重复的那条保留原有内容，不被新页覆盖
    expect(state?.messages[1].parts[0]).toMatchObject({ text: 'two' })
    expect(messageStore.getHistoryCursor('session-1')).toBe('cursor-2')
  })

  it('prepends older messages in front without re-sorting by time', () => {
    // 服务端顺序（seq）才是权威；这里故意让时间戳与顺序相反，
    // 用来证明 prependMessages 不会按 time.created 重排
    messageStore.setMessages('session-1', [v2Assistant('message-9', 'newest', { time: { created: 1, completed: 2 } })])

    messageStore.prependMessages(
      'session-1',
      [v2Assistant('message-1', 'oldest', { time: { created: 999, completed: 1000 } })],
      false,
    )

    const state = messageStore.getSessionState('session-1')
    expect(state?.messages.map(m => m.info.id)).toEqual(['message-1', 'message-9'])
  })

  // ============================================
  // V2 读侧：增量补齐（upsertMessages）
  // ============================================

  it('upserts without wiping already loaded history', () => {
    messageStore.setMessages('session-1', [
      v2Assistant('message-1', 'one'),
      v2Assistant('message-2', 'two'),
      v2Assistant('message-3', 'three'),
    ])

    // 只回补 1 条（模拟 SSE 漏推后的小范围补齐）
    messageStore.upsertMessages('session-1', [v2Assistant('message-4', 'four', { time: { created: 4, completed: 5 } })])

    const state = messageStore.getSessionState('session-1')
    expect(state?.messages.map(m => m.info.id)).toEqual(['message-1', 'message-2', 'message-3', 'message-4'])
  })

  it('upsert updates an existing message in place', () => {
    messageStore.setMessages('session-1', [v2Assistant('message-1', 'partial')])

    messageStore.upsertMessages('session-1', [v2Assistant('message-1', 'partial and more')])

    const state = messageStore.getSessionState('session-1')
    expect(state?.messages).toHaveLength(1)
    expect(state?.messages[0].parts[0]).toMatchObject({ text: 'partial and more' })
  })

  // ============================================
  // V2 读侧：流式文本不被更短的快照回退
  // ============================================

  it('does not regress longer live part text when a shorter snapshot arrives while streaming', () => {
    messageStore.setMessages('session-1', [v2StreamingAssistant('message-1', 'hello world')])
    messageStore.setStreaming('session-1', true)
    const live = messageStore.getSessionState('session-1')?.messages[0]
    if (live) live.isStreaming = true

    messageStore.handlePartUpdated(textUpdate('message-1', 'hello'))

    expect(messageStore.getSessionState('session-1')?.messages[0].parts[0]).toMatchObject({
      text: 'hello world',
    })
  })

  it('adopts a longer server snapshot when reloading messages', () => {
    messageStore.setMessages('session-1', [v2StreamingAssistant('message-1', 'hello')])
    messageStore.setStreaming('session-1', true)
    const live = messageStore.getSessionState('session-1')?.messages[0]
    if (live) live.isStreaming = true

    messageStore.setMessages('session-1', [v2StreamingAssistant('message-1', 'hello world')])

    expect(messageStore.getSessionState('session-1')?.messages[0].parts[0]).toMatchObject({
      text: 'hello world',
    })
  })

  it('keeps longer live text when setMessages receives a shorter server snapshot while streaming', () => {
    messageStore.setMessages('session-1', [v2StreamingAssistant('message-1', 'hello world')])
    messageStore.setStreaming('session-1', true)
    const live = messageStore.getSessionState('session-1')?.messages[0]
    if (live) live.isStreaming = true

    messageStore.setMessages('session-1', [v2StreamingAssistant('message-1', 'hello')])

    expect(messageStore.getSessionState('session-1')?.messages[0].parts[0]).toMatchObject({
      text: 'hello world',
    })
  })

  it('adopts completed server text even when local live text was longer', () => {
    messageStore.setMessages('session-1', [v2StreamingAssistant('message-1', 'hello world extra')])
    messageStore.setStreaming('session-1', true)
    const live = messageStore.getSessionState('session-1')?.messages[0]
    if (live) live.isStreaming = true

    // 定稿：completed 快照强制采用服务端，不再 preserve
    messageStore.setMessages('session-1', [
      v2Assistant('message-1', 'hello world', { time: { created: 1, completed: 99 } }),
    ])

    expect(messageStore.getSessionState('session-1')?.messages[0].parts[0]).toMatchObject({
      text: 'hello world',
    })
  })

  it('forces completed message part updates from the server', () => {
    messageStore.setMessages('session-1', [
      v2Assistant('message-1', 'hello world extra', { time: { created: 1, completed: 10 } }),
    ])

    messageStore.handlePartUpdated(textUpdate('message-1', 'hello world'))

    expect(messageStore.getSessionState('session-1')?.messages[0].parts[0]).toMatchObject({
      text: 'hello world',
    })
  })

  // ============================================
  // V2 读侧：keepLocalOnly（流式中刷新不丢 SSE 抢先推送的消息）
  // ============================================

  it('keeps local-only messages when refreshing while streaming', () => {
    messageStore.setMessages('session-1', [v2Assistant('message-1', 'one')])
    messageStore.setStreaming('session-1', true)

    // 本地多出一条（SSE 已推、服务端这一页还没有）
    messageStore.upsertMessages('session-1', [v2Assistant('message-2', 'two', { time: { created: 2, completed: 3 } })])

    messageStore.setMessages('session-1', [v2Assistant('message-1', 'one')], { keepLocalOnly: true })

    expect(messageStore.getSessionState('session-1')?.messages.map(m => m.info.id)).toEqual(['message-1', 'message-2'])
  })

  it('drops local-only messages when refreshing without keepLocalOnly', () => {
    messageStore.setMessages('session-1', [v2Assistant('message-1', 'one')])
    messageStore.upsertMessages('session-1', [v2Assistant('message-2', 'two', { time: { created: 2, completed: 3 } })])

    messageStore.setMessages('session-1', [v2Assistant('message-1', 'one')])

    expect(messageStore.getSessionState('session-1')?.messages.map(m => m.info.id)).toEqual(['message-1'])
  })

  // ============================================
  // 流式控制与订阅
  // ============================================

  it('creates a session when starting streaming', () => {
    messageStore.setStreaming('session-1', true)

    const state = messageStore.getSessionState('session-1')
    expect(state?.isStreaming).toBe(true)
    expect(state?.messages).toHaveLength(0)
    expect(state?.loadState).toBe('idle')
  })

  it('does not create a session when stopping streaming for a missing session', () => {
    messageStore.setStreaming('session-1', false)

    expect(messageStore.getSessionState('session-1')).toBeUndefined()
  })

  it('flushes mutable part deltas for multiple sessions in the same frame', () => {
    const rafCallbacks: Array<(time: number) => void> = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => {
      rafCallbacks.push(cb as (time: number) => void)
      return 1
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)

    messageStore.setMessages('session-1', [v2StreamingAssistant('message-1', 'hello')])
    messageStore.setMessages('session-2', [v2StreamingAssistant('message-2', 'world')])

    const beforeMessage1 = messageStore.getSessionState('session-1')?.messages[0]
    const beforeMessage2 = messageStore.getSessionState('session-2')?.messages[0]

    messageStore.handlePartDelta(textDelta('message-1', '!'))
    messageStore.handlePartDelta(textDelta('message-2', '?', 'text', 0, 'session-2'))

    const scheduledFrame = rafCallbacks[0]
    if (!scheduledFrame) {
      throw new Error('Expected requestAnimationFrame callback to be scheduled')
    }
    scheduledFrame(0)

    const afterMessage1 = messageStore.getSessionState('session-1')?.messages[0]
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

    // 两个 content → 两个 part：第 0 个是「已定稿」，第 1 个是「正在流式」
    const assistant: SessionMessageAssistant = v2StreamingAssistant('message-1', 'settled')
    assistant.content = [
      { type: 'text', text: 'settled' },
      { type: 'text', text: 'live' },
    ]
    messageStore.setMessages('session-1', [assistant])

    const beforeMessage = messageStore.getSessionState('session-1')?.messages[0]
    const beforeSettledPart = beforeMessage?.parts[0]
    const beforeLivePart = beforeMessage?.parts[1]

    messageStore.handlePartDelta(textDelta('message-1', ' text', 'text', 1))
    rafCallbacks[0]?.(0)

    const afterMessage = messageStore.getSessionState('session-1')?.messages[0]
    expect(afterMessage).not.toBe(beforeMessage)
    expect(afterMessage?.parts[0]).toBe(beforeSettledPart)
    expect(afterMessage?.parts[1]).not.toBe(beforeLivePart)
    expect(afterMessage?.parts[1]).toMatchObject({ text: 'live text' })
  })

  // ============================================
  // V2 事件侧：delta 的另外两种落点 + step 结束
  // ============================================

  it('appends reasoning deltas to the matching reasoning part', () => {
    messageStore.setMessages('session-1', [
      v2Assistant('message-1', '', {
        content: [{ type: 'reasoning', text: 'think' }],
        finish: undefined,
        time: { created: 1 },
      }),
    ])

    messageStore.handlePartDelta(textDelta('message-1', ' more', 'reasoning'))

    expect(messageStore.getSessionState('session-1')?.messages[0].parts[0]).toMatchObject({
      id: contentPartId('message-1'),
      type: 'reasoning',
      text: 'think more',
    })
  })

  it('appends tool input deltas to the raw input while the tool is streaming', () => {
    messageStore.setMessages('session-1', [
      v2Assistant('message-1', '', {
        content: [
          v2Tool('call_1', 'edit', {
            // V2 的 streaming：input 是未解析的原始字符串
            state: { status: 'streaming', input: '{"filePath"' },
            time: { created: 1 },
          }),
        ],
        finish: undefined,
        time: { created: 1 },
      }),
    ])

    messageStore.handlePartDelta({
      sessionID: 'session-1',
      messageID: 'message-1',
      // tool part 的 id 就是工具自身的 id（不是按 content 下标合成）
      partID: 'call_1',
      kind: 'input',
      delta: ':"a.ts"}',
    })

    const toolPart = messageStore.getSessionState('session-1')?.messages[0].parts.find(p => p.type === 'tool')
    expect(toolPart).toMatchObject({ state: { status: 'pending', raw: '{"filePath":"a.ts"}' } })
  })

  it('synthesizes a step-finish part when a step ends with a finish reason', () => {
    messageStore.setMessages('session-1', [v2StreamingAssistant('message-1', 'done')])

    messageStore.handlePartUpdated({
      kind: 'step',
      sessionID: 'session-1',
      messageID: 'message-1',
      finish: 'stop',
      cost: 0.25,
      tokens: { input: 10, output: 5, reasoning: 1, cache: { read: 2, write: 3 } },
    })

    const message = messageStore.getSessionState('session-1')?.messages[0]
    // 成本 / 用量 / 结束原因上移到 assistant 顶层
    expect(message?.info).toMatchObject({ role: 'assistant', finish: 'stop', cost: 0.25 })
    expect(message?.info).toMatchObject({ tokens: { input: 10, output: 5, reasoning: 1 } })
    // 同时合成尾部 step-finish part（渲染层的工具组配对依赖它）
    const stepFinish = message?.parts.find(p => p.type === 'step-finish')
    expect(stepFinish).toMatchObject({ id: stepFinishPartId('message-1'), reason: 'stop', cost: 0.25 })
  })

  it('does not synthesize a step-finish part while finish is still absent', () => {
    messageStore.setMessages('session-1', [v2StreamingAssistant('message-1', 'partial')])

    messageStore.handlePartUpdated({
      kind: 'step',
      sessionID: 'session-1',
      messageID: 'message-1',
      cost: 0.1,
      tokens: { input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
    })

    const message = messageStore.getSessionState('session-1')?.messages[0]
    expect(message?.info).toMatchObject({ role: 'assistant', cost: 0.1 })
    // 流式中（finish 未出现）不合成 step-finish，否则工具组会提前挂上用量
    expect(message?.parts.some(p => p.type === 'step-finish')).toBe(false)
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

    const unsubscribeSession1 = messageStore.subscribeSession('session-1', session1Subscriber)
    const unsubscribeSession2 = messageStore.subscribeSession('session-2', session2Subscriber)
    const unsubscribeAll = messageStore.subscribe(allSubscriber)

    messageStore.setMessages('session-2', [v2Assistant('message-2', 'world')])
    rafCallbacks.shift()?.(0)

    expect(session1Subscriber).not.toHaveBeenCalled()
    expect(session2Subscriber).toHaveBeenCalledTimes(1)
    expect(allSubscriber).toHaveBeenCalledTimes(1)

    unsubscribeSession1()
    unsubscribeSession2()
    unsubscribeAll()
  })
})
