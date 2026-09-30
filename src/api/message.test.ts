// ============================================
// getSessionMessages 游标分页单元测试（阶段 2a）
// + 发消息链路单元测试（阶段 2b：V2 prompt / wait）
// ============================================
//
// 这些测试锁住的是**方向性**约定 —— 一旦搞反，症状是「滚动加载不动」
// 或「加载出重复/跳过的消息」，而且不会报错，极难排查：
//
//   1. 不传 cursor 时不传 order（服务端默认 desc = 新→旧）
//   2. 返回的 messages 必须**重排成旧→新**（store 按升序存）
//   3. 「还有更多」用 **limit + 1 溢出法**判断，且**多出来的那条必须保留**
//      （服务端游标锚定本页最后一条，丢掉它就会永久丢消息）
//   4. limit 必须钳制到 1..200（服务端是 NumberFromString + 范围校验）
//   5. cursor 与 order 不能同时出现（服务端会 400）

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_MESSAGES_LIMIT,
  MAX_MESSAGES_LIMIT,
  buildPromptParams,
  extractUserMessageContent,
  getSessionMessages,
  sendMessage,
  sendMessageAsync,
} from './message'
import { toUIMessage } from '../utils/messageConversion'
import { v2Assistant, v2User } from '../test/fixtures/v2Messages'
import type { SendMessageParams } from './types'

const listMock = vi.fn()
const promptMock = vi.fn()
const waitMock = vi.fn()
const switchModelMock = vi.fn()

vi.mock('./sdk', () => ({
  getSDKClient: () => ({
    message: {
      list: (...args: unknown[]) => listMock(...args),
    },
    session: {
      prompt: (...args: unknown[]) => promptMock(...args),
      wait: (...args: unknown[]) => waitMock(...args),
      switchModel: (...args: unknown[]) => switchModelMock(...args),
    },
  }),
}))

vi.mock('../store/serverStore', () => ({
  serverStore: {
    getActiveServerId: () => 'test-server',
    getActiveBaseUrl: () => 'http://127.0.0.1:4096',
    getActiveAuth: () => undefined,
  },
}))

/** 服务端 desc 顺序（新→旧）的一页 */
function descPage(ids: string[], cursor: { previous?: string | null; next?: string | null } = {}) {
  return {
    data: ids.map(id => v2Assistant(id, `text-${id}`)),
    cursor: { previous: cursor.previous ?? null, next: cursor.next ?? null },
  }
}

describe('getSessionMessages', () => {
  beforeEach(() => {
    listMock.mockReset()
  })

  it('reverses the server page so the caller always gets oldest → newest', async () => {
    // 服务端默认 desc：新 → 旧
    listMock.mockResolvedValue(descPage(['msg_3', 'msg_2', 'msg_1']))

    const page = await getSessionMessages('ses_1', { limit: 3 })

    // 返回给上层的必须是 旧 → 新
    expect(page.messages.map(m => m.id)).toEqual(['msg_1', 'msg_2', 'msg_3'])
  })

  it('does not send order when no cursor is given (server default is desc)', async () => {
    listMock.mockResolvedValue(descPage(['msg_1']))

    await getSessionMessages('ses_1', { limit: 5 })

    const input = listMock.mock.calls[0][0]
    expect(input).toMatchObject({ sessionID: 'ses_1' })
    expect(input).not.toHaveProperty('order')
    expect(input).not.toHaveProperty('cursor')
  })

  it('sends the cursor and still omits order (they are mutually exclusive)', async () => {
    listMock.mockResolvedValue(descPage(['msg_1']))

    await getSessionMessages('ses_1', { limit: 5, cursor: 'CURSOR_OLDER' })

    const input = listMock.mock.calls[0][0]
    expect(input.cursor).toBe('CURSOR_OLDER')
    // ⚠️ 服务端：cursor + order 同时传 → 400 InvalidCursorError
    expect(input).not.toHaveProperty('order')
  })

  it('probes for more by requesting limit + 1', async () => {
    listMock.mockResolvedValue(descPage(['msg_1']))

    await getSessionMessages('ses_1', { limit: 5 })

    expect(listMock.mock.calls[0][0].limit).toBe(6)
  })

  it('reports hasMore=false on a short page', async () => {
    // 要了 6 条只给 3 条 → 没有更多
    listMock.mockResolvedValue(descPage(['msg_3', 'msg_2', 'msg_1']))

    const page = await getSessionMessages('ses_1', { limit: 5 })

    expect(page.hasMore).toBe(false)
  })

  it('reports hasMore=true and KEEPS the overflow item (dropping it would lose a message)', async () => {
    // 要 3 条给了 4 条 → 还有更多；第 4 条（最旧的那条）必须保留，
    // 因为服务端的 cursor.next 锚定在它身上
    listMock.mockResolvedValue(descPage(['msg_4', 'msg_3', 'msg_2', 'msg_1']))

    const page = await getSessionMessages('ses_1', { limit: 3 })

    expect(page.hasMore).toBe(true)
    expect(page.messages.map(m => m.id)).toEqual(['msg_1', 'msg_2', 'msg_3', 'msg_4'])
  })

  it('normalises the cursors into non-optional strings or null', async () => {
    listMock.mockResolvedValue(descPage(['msg_1'], { previous: 'P', next: 'N' }))

    const page = await getSessionMessages('ses_1')

    expect(page.cursor).toEqual({ previous: 'P', next: 'N' })
  })

  it('normalises missing cursors to null', async () => {
    listMock.mockResolvedValue({ data: [], cursor: {} })

    const page = await getSessionMessages('ses_1')

    expect(page.cursor).toEqual({ previous: null, next: null })
    expect(page.hasMore).toBe(false)
  })

  it('falls back to the server default page size when limit is omitted', async () => {
    listMock.mockResolvedValue(descPage(['msg_1']))

    await getSessionMessages('ses_1')

    expect(listMock.mock.calls[0][0].limit).toBe(DEFAULT_MESSAGES_LIMIT + 1)
  })

  it('clamps limit into 1..200', async () => {
    listMock.mockResolvedValue(descPage(['msg_1']))

    await getSessionMessages('ses_1', { limit: 9999 })
    expect(listMock.mock.calls[0][0].limit).toBe(MAX_MESSAGES_LIMIT)

    // limit=0 / 负数 → 钳到下限 1，再叠加溢出探测的 +1 → 实际请求 2
    listMock.mockReset()
    listMock.mockResolvedValue(descPage(['msg_1']))
    await getSessionMessages('ses_1', { limit: 0 })
    expect(listMock.mock.calls[0][0].limit).toBe(2)

    listMock.mockReset()
    listMock.mockResolvedValue(descPage(['msg_1']))
    await getSessionMessages('ses_1', { limit: -5 })
    expect(listMock.mock.calls[0][0].limit).toBe(2)
  })

  it('at the 200 cap falls back to a full-page heuristic (cannot probe further)', async () => {
    // limit=200 时无法再 +1（服务端上限 200）→ 退化为「满页即视为还有」
    listMock.mockResolvedValue(descPage(Array.from({ length: 200 }, (_, i) => `msg_${i}`)))

    const page = await getSessionMessages('ses_1', { limit: MAX_MESSAGES_LIMIT })

    expect(listMock.mock.calls[0][0].limit).toBe(MAX_MESSAGES_LIMIT)
    expect(page.hasMore).toBe(true)
  })

  it('forwards the type filter unchanged so page boundaries stay aligned', async () => {
    listMock.mockResolvedValue(descPage(['msg_1']))

    await getSessionMessages('ses_1', { type: 'user' })

    expect(listMock.mock.calls[0][0].type).toBe('user')
  })

  it('does not send the type key when no filter is given', async () => {
    listMock.mockResolvedValue(descPage(['msg_1']))

    await getSessionMessages('ses_1')

    expect(listMock.mock.calls[0][0]).not.toHaveProperty('type')
  })

  it('passes user and assistant messages through untouched (no envelope unwrapping)', async () => {
    listMock.mockResolvedValue({ data: [v2User('msg_1', 'hi')], cursor: { next: null } })

    const page = await getSessionMessages('ses_1')

    expect(page.messages[0]).toMatchObject({ type: 'user', text: 'hi' })
  })
})

describe('extractUserMessageContent', () => {
  /** 用转换层把 V2 user 消息转成 UI 模型，再交给 extractUserMessageContent（模拟真实调用链） */
  function extract(raw: Parameters<typeof toUIMessage>[0]) {
    return extractUserMessageContent(toUIMessage(raw, 'ses_1'))
  }

  it('joins visible text and skips synthetic text parts', () => {
    const message = toUIMessage(v2User('msg_1', 'hello'), 'ses_1')
    // 手工插入一个 synthetic text part（V1 语义里它不算用户输入）
    message.parts.push({
      type: 'text',
      id: 'msg_1:text:synthetic',
      sessionID: 'ses_1',
      messageID: 'msg_1',
      text: 'injected context',
      synthetic: true,
    })

    expect(extractUserMessageContent(message)).toEqual({ text: 'hello', attachments: [] })
  })

  it('maps an inline file attachment to a file attachment with a data URL', () => {
    const result = extract(
      v2User('msg_1', '', {
        files: [{ data: 'AAAA', mime: 'image/png', source: { type: 'inline' }, name: 'shot.png' }],
      }),
    )

    expect(result.attachments).toHaveLength(1)
    expect(result.attachments[0]).toMatchObject({
      type: 'file',
      displayName: 'shot.png',
      mime: 'image/png',
      url: 'data:image/png;base64,AAAA',
    })
  })

  it('marks directory attachments as folders', () => {
    const result = extract(
      v2User('msg_1', '', {
        files: [{ data: '', mime: 'application/x-directory', source: { type: 'inline' }, name: 'src' }],
      }),
    )

    expect(result.attachments[0]).toMatchObject({ type: 'folder' })
  })

  it('carries the mention range through as textRange', () => {
    const result = extract(
      v2User('msg_1', '', {
        files: [
          {
            data: '',
            mime: 'text/plain',
            source: { type: 'uri', uri: 'file:///a.txt' },
            name: 'a.txt',
            mention: { start: 2, end: 7, text: 'a.txt' },
          },
        ],
      }),
    )

    expect(result.attachments[0]).toMatchObject({
      textRange: { value: 'a.txt', start: 2, end: 7 },
      relativePath: 'file:///a.txt',
    })
  })

  it('maps agent attachments', () => {
    const result = extract(v2User('msg_1', '', { agents: [{ name: 'build' }] }))

    expect(result.attachments).toHaveLength(1)
    expect(result.attachments[0]).toMatchObject({ type: 'agent', agentName: 'build', displayName: 'build' })
  })

  it('returns empty content for a message with no text and no attachments', () => {
    expect(extract(v2User('msg_1', ''))).toEqual({ text: '', attachments: [] })
  })
})

// ============================================
// 发消息链路（阶段 2b 实现）
// ============================================
//
// V2 的两条链路（见 src/api/message.ts 的说明）：
//   `sendMessageAsync` → 只投递（`POST /api/session/{id}/prompt`，本身就是非阻塞的）
//   `sendMessage`      → 投递后再等这轮跑完（`POST /api/experimental/session/{id}/wait`）
//
// 这里锁住三件容易写错、又**不会报错**的事：
//   1. V2 的 prompt 载荷**没有 model 字段**（模型是会话级的）→ 必须写进 metadata，
//      否则历史渲染会丢模型；
//   2. 附件要按 V2 的形状摊平：file/folder → `files[{uri, name, mention}]`，
//      agent → `agents[{name, mention}]`，text/command 直接跳过；
//   3. `sendMessage` 的返回**不是 AI 回复**（V2 没有这种接口），而是入队记录 + 空 parts。

/** 构造发送参数（默认带 model，可用 overrides 覆盖） */
function sendParams(overrides: Partial<SendMessageParams> = {}): SendMessageParams {
  return {
    sessionId: 'ses_1',
    text: 'hi',
    attachments: [],
    model: { providerID: 'p', modelID: 'm' },
    ...overrides,
  } as SendMessageParams
}

describe('buildPromptParams（V2 prompt 入参构造）', () => {
  it('只有文本时省略 files / agents 键', () => {
    const built = buildPromptParams('ses_1', sendParams())

    expect(built).toEqual({
      sessionID: 'ses_1',
      text: 'hi',
      // model 走 metadata（V2 的 prompt 载荷里没有 model 字段）
      metadata: { model: { providerID: 'p', modelID: 'm', variant: null } },
    })
    expect(built).not.toHaveProperty('files')
    expect(built).not.toHaveProperty('agents')
  })

  it('metadata 完全为空时连 metadata 键也不产生', () => {
    // ⚠️ `SendMessageParams.model` 在类型上是必填的，实现里仍留了运行时守卫
    //    （`if (params.model)`）；这里刻意构造「运行时没有 model」的入参覆盖该分支。
    const withoutModel = { sessionId: 'ses_1', text: 'hi', attachments: [] } as unknown as SendMessageParams

    expect(buildPromptParams('ses_1', withoutModel)).toEqual({ sessionID: 'ses_1', text: 'hi' })
  })

  it('文件附件：uri 用 attachment.url，mention 由 textRange 展开', () => {
    const built = buildPromptParams(
      'ses_1',
      sendParams({
        attachments: [
          {
            id: 'a1',
            type: 'file',
            displayName: 'app.ts',
            url: 'file:///repo/src/app.ts',
            relativePath: 'src/app.ts',
            textRange: { value: '@app.ts', start: 0, end: 7 },
          },
        ],
      }),
    )

    expect(built.files).toEqual([
      {
        uri: 'file:///repo/src/app.ts',
        name: 'app.ts',
        mention: { start: 0, end: 7, text: '@app.ts' },
      },
    ])
    expect(built).not.toHaveProperty('agents')
  })

  it('文件夹附件：url 缺失时回落到 file:// + relativePath', () => {
    const built = buildPromptParams(
      'ses_1',
      sendParams({
        attachments: [{ id: 'd1', type: 'folder', displayName: 'src', relativePath: 'src' }],
      }),
    )

    expect(built.files).toEqual([{ uri: 'file://src', name: 'src' }])
  })

  it('agent 附件进 agents（不是 files），mention 同样透传', () => {
    const built = buildPromptParams(
      'ses_1',
      sendParams({
        attachments: [
          {
            id: 'g1',
            type: 'agent',
            displayName: 'build',
            agentName: 'build',
            textRange: { value: '@build', start: 8, end: 14 },
          },
        ],
      }),
    )

    expect(built.agents).toEqual([{ name: 'build', mention: { start: 8, end: 14, text: '@build' } }])
    expect(built).not.toHaveProperty('files')
  })

  it('text / command 附件被跳过（command 走 session.command 端点）', () => {
    const built = buildPromptParams(
      'ses_1',
      sendParams({
        attachments: [
          { id: 't1', type: 'text', displayName: 'pasted', url: 'file://pasted.txt' },
          { id: 'c1', type: 'command', displayName: 'init', commandName: 'init' },
        ],
      }),
    )

    expect(built).not.toHaveProperty('files')
    expect(built).not.toHaveProperty('agents')
  })

  it('agent / model / variant 写进 metadata', () => {
    const built = buildPromptParams('ses_1', sendParams({ agent: 'build', variant: 'thinking' }))

    expect(built.metadata).toEqual({
      agent: 'build',
      model: { providerID: 'p', modelID: 'm', variant: 'thinking' },
    })
  })
})

describe('sendMessage / sendMessageAsync（V2 prompt + wait）', () => {
  beforeEach(() => {
    promptMock.mockReset()
    waitMock.mockReset()
    switchModelMock.mockReset()
  })

  it('sendMessageAsync 只投递一次 prompt，不等这轮跑完', async () => {
    promptMock.mockResolvedValue({ id: 'inbox_1' })

    const params = sendParams()
    await sendMessageAsync(params)

    expect(promptMock).toHaveBeenCalledTimes(1)
    expect(promptMock).toHaveBeenCalledWith(buildPromptParams('ses_1', params))
    // V2 的 prompt 本身就是非阻塞的，没有 V1 的 prompt_async 变体 → 不需要 wait
    expect(waitMock).not.toHaveBeenCalled()
  })

  it('发送前先 switchModel 同步会话模型（幂等）—— 「切换模型生效」的关键', async () => {
    promptMock.mockResolvedValue({ id: 'inbox_1' })

    await sendMessageAsync(sendParams())

    // UI 命名 modelID 必须映射成契约命名 id（V2 的 Model.Ref）
    expect(switchModelMock).toHaveBeenCalledWith({
      sessionID: 'ses_1',
      model: { id: 'm', providerID: 'p' },
    })
    // 顺序：先同步模型，再投递 —— 反了就会用旧模型跑
    const switchOrder = switchModelMock.mock.invocationCallOrder[0]
    const promptOrder = promptMock.mock.invocationCallOrder[0]
    expect(switchOrder).toBeLessThan(promptOrder)
  })

  it('variant 只在有值时随 switchModel 下发', async () => {
    promptMock.mockResolvedValue({ id: 'inbox_1' })

    await sendMessageAsync(sendParams({ variant: 'max' }))
    expect(switchModelMock).toHaveBeenLastCalledWith({
      sessionID: 'ses_1',
      model: { id: 'm', providerID: 'p', variant: 'max' },
    })

    switchModelMock.mockClear()
    await sendMessageAsync(sendParams())
    expect(switchModelMock).toHaveBeenLastCalledWith({
      sessionID: 'ses_1',
      model: { id: 'm', providerID: 'p' },
    })
  })

  it('sendMessage 先 prompt 再 wait，返回的是入队记录而不是 AI 回复', async () => {
    const callOrder: string[] = []
    promptMock.mockImplementation(async () => {
      callOrder.push('prompt')
      return { id: 'inbox_1', time: { created: 1234 } }
    })
    waitMock.mockImplementation(async () => {
      callOrder.push('wait')
    })

    const response = await sendMessage(sendParams())

    expect(callOrder).toEqual(['prompt', 'wait'])
    expect(promptMock).toHaveBeenCalledTimes(1)
    expect(waitMock).toHaveBeenCalledWith({ sessionID: 'ses_1' })
    // 阻塞版同样先同步模型（与 sendMessageAsync 一致）
    expect(switchModelMock).toHaveBeenCalledWith({
      sessionID: 'ses_1',
      model: { id: 'm', providerID: 'p' },
    })
    // ⚠️ V2 没有「一次请求拿回复」的接口 → info 是入队记录、parts 一定是空数组
    expect(response.info.id).toBe('inbox_1')
    expect(response.info.time.created).toBe(1234)
    expect(response.parts).toEqual([])
  })
})
