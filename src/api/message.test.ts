import { beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================
// 发送消息：模型 / agent 必须走 switch，而不是塞进 prompt
//
// v2 的 `SessionPromptInput` 里**没有** model / agent / variant 字段
//（与 v1 的 per-prompt model 不同），它们只能通过
// `session.switchModel` / `session.switchAgent` 生效。
// 之前 sendMessage 把 params 里的 model/agent 直接丢掉，导致
// 「会话中途切换模型/agent 完全不起作用」（新建会话不受影响，
// 因为 create 已经带上这两个字段）。
// ============================================

const calls: string[] = []
const switchModelMock = vi.fn(async (_input?: unknown) => {
  calls.push('switchModel')
})
const switchAgentMock = vi.fn(async (_input?: unknown) => {
  calls.push('switchAgent')
})
const promptMock = vi.fn(async (_input?: unknown) => {
  calls.push('prompt')
})

vi.mock('./sdk', () => ({
  getSDKClient: () => ({
    session: {
      switchModel: switchModelMock,
      switchAgent: switchAgentMock,
      prompt: promptMock,
    },
  }),
}))

const { sendMessage } = await import('./message')

type PromptPayload = {
  text?: string
  files?: Array<{ uri: string; name?: string; mention?: { start: number; end: number; text: string } }>
  agents?: Array<{ name: string; mention?: { start: number; end: number; text: string } }>
  skills?: Array<{ id: string; mention?: { start: number; end: number; text: string } }>
  metadata?: Record<string, unknown>
}

function lastPromptPayload(): PromptPayload {
  return promptMock.mock.calls.at(-1)?.[0] as PromptPayload
}

function baseParams() {
  return {
    sessionId: 'session-1',
    text: 'hello',
    attachments: [],
    directory: '/tmp/project',
  }
}

describe('sendMessage — 模型 / agent 切换', () => {
  beforeEach(() => {
    calls.length = 0
    switchModelMock.mockClear()
    switchAgentMock.mockClear()
    promptMock.mockClear()
  })

  it('先切换模型再发送（字段名 modelID → id）', async () => {
    await sendMessage({
      ...baseParams(),
      model: { providerID: 'openai', modelID: 'gpt-4o' },
    })

    expect(switchModelMock).toHaveBeenCalledWith({
      sessionID: 'session-1',
      model: { id: 'gpt-4o', providerID: 'openai' },
    })
    expect(calls).toEqual(['switchModel', 'prompt'])
  })

  it('variant 一并带上（只在提供时出现）', async () => {
    await sendMessage({
      ...baseParams(),
      model: { providerID: 'openai', modelID: 'gpt-4o' },
      variant: 'high',
    })

    expect(switchModelMock).toHaveBeenCalledWith({
      sessionID: 'session-1',
      model: { id: 'gpt-4o', providerID: 'openai', variant: 'high' },
    })
  })

  it('agent 也要切换', async () => {
    await sendMessage({ ...baseParams(), agent: 'build' })

    expect(switchAgentMock).toHaveBeenCalledWith({ sessionID: 'session-1', agent: 'build' })
    expect(calls).toEqual(['switchAgent', 'prompt'])
  })

  it('切换永远发生在 prompt 之前', async () => {
    await sendMessage({
      ...baseParams(),
      model: { providerID: 'openai', modelID: 'gpt-4o' },
      agent: 'plan',
    })

    expect(calls.indexOf('prompt')).toBe(calls.length - 1)
  })

  it('没给 model / agent 时不做多余切换', async () => {
    await sendMessage(baseParams())

    expect(switchModelMock).not.toHaveBeenCalled()
    expect(switchAgentMock).not.toHaveBeenCalled()
    expect(calls).toEqual(['prompt'])
  })

  it('steer 投递时照常在 prompt 前切换（官方 submit.ts:384-410）', async () => {
    await sendMessage({
      ...baseParams(),
      model: { providerID: 'openai', modelID: 'gpt-4o' },
      agent: 'build',
      delivery: 'steer',
    })

    expect(switchModelMock).toHaveBeenCalled()
    expect(switchAgentMock).toHaveBeenCalled()
    expect(calls).toEqual(['switchModel', 'switchAgent', 'prompt'])
  })

  it('queue 投递时不切换——排队条目不该重配当前正在运行的回合', async () => {
    await sendMessage({
      ...baseParams(),
      model: { providerID: 'openai', modelID: 'gpt-4o' },
      agent: 'build',
      delivery: 'queue',
    })

    expect(switchModelMock).not.toHaveBeenCalled()
    expect(switchAgentMock).not.toHaveBeenCalled()
    expect(calls).toEqual(['prompt'])
  })
})

describe('sendMessage — prompt 载荷（官方 request.ts + submit.ts:395-411 同款）', () => {
  beforeEach(() => {
    calls.length = 0
    switchModelMock.mockClear()
    switchAgentMock.mockClear()
    promptMock.mockClear()
  })

  it('mention 区间随 files/agents 一起发出', async () => {
    const text = '看下 @foo.ts 用 @build 跑'
    await sendMessage({
      ...baseParams(),
      text,
      attachments: [
        {
          id: 'a1',
          type: 'file',
          displayName: 'foo.ts',
          url: 'file:///proj/src/foo.ts',
          textRange: { value: '@foo.ts', start: 5, end: 12 },
        },
        {
          id: 'a2',
          type: 'agent',
          displayName: 'build',
          agentName: 'build',
          textRange: { value: '@build', start: 20, end: 26 },
        },
      ] as never,
    })

    const payload = lastPromptPayload()
    const fileStart = text.indexOf('@foo.ts')
    expect(payload.files).toEqual([
      {
        uri: 'file:///proj/src/foo.ts',
        name: 'foo.ts',
        mention: { start: fileStart, end: fileStart + '@foo.ts'.length, text: '@foo.ts' },
      },
    ])
    const agentStart = text.indexOf('@build')
    expect(payload.agents).toEqual([
      { name: 'build', mention: { start: agentStart, end: agentStart + '@build'.length, text: '@build' } },
    ])
  })

  it('skill 附件进 skills 数组（id + mention）', async () => {
    await sendMessage({
      ...baseParams(),
      text: '@commit 提交',
      attachments: [
        {
          id: 's1',
          type: 'skill',
          displayName: 'commit',
          skillId: 'commit',
          textRange: { value: '@commit', start: 0, end: 7 },
        },
      ] as never,
    })

    const payload = lastPromptPayload()
    expect(payload.skills).toEqual([{ id: 'commit', mention: { start: 0, end: 7, text: '@commit' } }])
  })

  it('metadata 携带 displayText / agent / model 选择快照', async () => {
    await sendMessage({
      ...baseParams(),
      text: '帮我看下 @foo.ts',
      model: { providerID: 'opencode', modelID: 'mimo' },
      agent: 'build',
      variant: 'high',
      delivery: 'queue',
    })

    const payload = lastPromptPayload()
    expect(payload.metadata).toEqual({
      displayText: '帮我看下 @foo.ts',
      agent: 'build',
      model: { providerID: 'opencode', modelID: 'mimo', variant: 'high' },
    })
  })

  it('无 model/agent 时 metadata 只有 displayText', async () => {
    await sendMessage({ ...baseParams(), text: 'hello' })
    const payload = lastPromptPayload()
    expect(payload.metadata).toEqual({ displayText: 'hello' })
  })
})

// ============================================
// 路径引用（Issue #182）
//
// files[].uri 只让服务端读到字节；model 能否看到取决于服务端嗅探出的 mime
//（core to-llm-message.ts:75-83 只放行 text/plain 与 image/pdf）。因此上传的
// zip/docx 必须额外把绝对路径写进 prompt 文本，官方做法同款
//（packages/app/src/composer/request.ts:173-182）。
// ============================================

describe('sendMessage — 路径型附件的文本引用', () => {
  beforeEach(() => {
    calls.length = 0
    switchModelMock.mockClear()
    switchAgentMock.mockClear()
    promptMock.mockClear()
  })

  const uploadedAttachment = (overrides: Record<string, unknown> = {}) => ({
    id: 'up1',
    type: 'file',
    displayName: 'report.zip',
    url: 'file:///tmp/opencode/uploads/u1/report.zip',
    mime: 'application/zip',
    relativePath: '/tmp/opencode/uploads/u1/report.zip',
    ...overrides,
  })

  it('路径型附件：uri 进 files[]，绝对路径进文本与 metadata.attachments', async () => {
    await sendMessage({
      ...baseParams(),
      text: '帮我看看这个包',
      attachments: [uploadedAttachment()] as never,
    })

    const payload = lastPromptPayload()
    expect(payload.files).toEqual([
      { uri: 'file:///tmp/opencode/uploads/u1/report.zip', name: 'report.zip' },
    ])
    expect(payload.text).toBe('帮我看看这个包\nAttached file: `/tmp/opencode/uploads/u1/report.zip`')
    expect(payload.metadata?.attachments).toEqual([
      { name: 'report.zip', mime: 'application/zip', path: '/tmp/opencode/uploads/u1/report.zip' },
    ])
    // displayText 保持用户原始输入（时间线展示不被污染）
    expect(payload.metadata?.displayText).toBe('帮我看看这个包')
  })

  it('超过 20MB 的附件只作路径引用：不进 files[]，但路径仍进文本', async () => {
    await sendMessage({
      ...baseParams(),
      text: '大文件',
      attachments: [uploadedAttachment({ pathOnly: true })] as never,
    })

    const payload = lastPromptPayload()
    expect(payload.files).toBeUndefined()
    expect(payload.text).toBe('大文件\nAttached file: `/tmp/opencode/uploads/u1/report.zip`')
    expect(payload.metadata?.attachments).toHaveLength(1)
  })

  it('带 mention 的附件（@ 引用）进 files[]，不额外注入路径', async () => {
    await sendMessage({
      ...baseParams(),
      text: '@src/foo.ts 看下',
      attachments: [
        {
          id: 'a1',
          type: 'file',
          displayName: 'foo.ts',
          url: 'file:///proj/src/foo.ts',
          textRange: { value: '@src/foo.ts', start: 0, end: 11 },
        },
      ] as never,
    })

    const payload = lastPromptPayload()
    expect(payload.files).toEqual([
      {
        uri: 'file:///proj/src/foo.ts',
        name: 'foo.ts',
        mention: { start: 0, end: 11, text: '@src/foo.ts' },
      },
    ])
    expect(payload.text).toBe('@src/foo.ts 看下')
    expect(payload.metadata?.attachments).toBeUndefined()
  })

  it('提及前面改过字后，mention 区间按当前文本重新定位', async () => {
    await sendMessage({
      ...baseParams(),
      text: '先加一句 @src/foo.ts 看下',
      attachments: [
        {
          id: 'a1',
          type: 'file',
          displayName: 'foo.ts',
          url: 'file:///proj/src/foo.ts',
          // 插入时记下的旧偏移（在开头），用户后来在前面补了字
          textRange: { value: '@src/foo.ts', start: 0, end: 11 },
        },
      ] as never,
    })

    const payload = lastPromptPayload()
    const start = '先加一句 '.length
    expect(payload.files?.[0].mention).toEqual({ start, end: start + 11, text: '@src/foo.ts' })
  })

  it('带 mention 的附件被从文本删掉后仍补路径（pathOnly 只能靠文本可见）', async () => {
    await sendMessage({
      ...baseParams(),
      text: '看下这个',
      attachments: [
        {
          id: 'a1',
          type: 'file',
          displayName: 'foo.ts',
          url: 'file:///proj/src/foo.ts',
          pathOnly: true,
          textRange: { value: '@src/foo.ts', start: 0, end: 11 },
        },
      ] as never,
    })

    const payload = lastPromptPayload()
    expect(payload.files).toBeUndefined()
    expect(payload.text).toBe('看下这个\nAttached file: `/proj/src/foo.ts`')
  })

  it('revert 回填的文本里已有同一引用时不重复追加', async () => {
    const path = '/tmp/opencode/uploads/u1/report.zip'
    await sendMessage({
      ...baseParams(),
      text: `帮我看看这个包\nAttached file: \`${path}\``,
      attachments: [uploadedAttachment()] as never,
    })

    const payload = lastPromptPayload()
    expect(payload.text).toBe(`帮我看看这个包\nAttached file: \`${path}\``)
    expect(payload.text?.match(/Attached file:/g)).toHaveLength(1)
  })

  it('多个附件按顺序各占一行，且路径去重', async () => {
    await sendMessage({
      ...baseParams(),
      text: 'x',
      attachments: [
        uploadedAttachment(),
        uploadedAttachment({ id: 'up2', displayName: 'b.bin', url: 'file:///tmp/opencode/uploads/u2/b.bin', relativePath: '/tmp/opencode/uploads/u2/b.bin' }),
        uploadedAttachment({ id: 'up3' }),
      ] as never,
    })

    const payload = lastPromptPayload()
    expect(payload.text).toBe(
      'x\nAttached file: `/tmp/opencode/uploads/u1/report.zip`\nAttached file: `/tmp/opencode/uploads/u2/b.bin`',
    )
    expect(payload.metadata?.attachments).toHaveLength(2)
  })

  it('空文本只有引用行时不留前导换行', async () => {
    await sendMessage({
      ...baseParams(),
      text: '',
      attachments: [uploadedAttachment()] as never,
    })

    expect(lastPromptPayload().text).toBe('Attached file: `/tmp/opencode/uploads/u1/report.zip`')
  })
})

// ============================================
// 附件消息回填（Issue #182）
//
// 气泡/回填都不能露出管道信息：`text` 末尾那行路径引用是给模型读的，
// 用户原始输入在 metadata.displayText（官方 comment-note.ts:42-50 同款）。
// ============================================

describe('extractUserMessageContent — 路径附件回填', () => {
  const userMessage = (overrides: Record<string, unknown> = {}) =>
    ({
      id: 'msg_u',
      type: 'user',
      text: '看看？\nAttached file: `C:/tmp/uploads/u1/report.zip`',
      time: { created: 0 },
      metadata: {
        displayText: '看看？',
        attachments: [{ name: 'report.zip', mime: 'application/zip', path: 'C:/tmp/uploads/u1/report.zip' }],
      },
      ...overrides,
    }) as never

  it('回填用户原始输入，不带上追加的路径引用行', async () => {
    const { extractUserMessageContent } = await import('./message')
    const restored = extractUserMessageContent(userMessage())
    expect(restored.text).toBe('看看？')
  })

  it('只作路径引用的附件（超 20MB 未进 files[]）从 metadata.attachments 还原', async () => {
    const { extractUserMessageContent } = await import('./message')
    const restored = extractUserMessageContent(userMessage())

    expect(restored.attachments).toHaveLength(1)
    expect(restored.attachments[0]).toMatchObject({
      type: 'file',
      displayName: 'report.zip',
      url: 'file:///C:/tmp/uploads/u1/report.zip',
      relativePath: 'C:/tmp/uploads/u1/report.zip',
      pathOnly: true,
    })
  })

  it('@ 提及文件回填 mention 区间，再次发送仍按附件处理', async () => {
    const { extractUserMessageContent } = await import('./message')
    const restored = extractUserMessageContent(
      userMessage({
        files: [
          {
            data: 'QQ==',
            mime: 'text/plain',
            source: { type: 'uri', uri: 'file:///repo/a.ts' },
            name: 'a.ts',
            mention: { start: 3, end: 9, text: '@a.ts' },
          },
        ],
      }),
    )

    expect(restored.attachments[0]).toMatchObject({
      type: 'file',
      displayName: 'a.ts',
      url: 'file:///repo/a.ts',
      mime: 'text/plain',
      textRange: { value: '@a.ts', start: 3, end: 9 },
    })
    expect(restored.attachments[0]?.pathOnly).toBeUndefined()
  })

  it('inline 附件从 data 还原成 data URL，回退重发不丢内容', async () => {
    const { extractUserMessageContent } = await import('./message')
    const restored = extractUserMessageContent(
      userMessage({
        metadata: undefined,
        files: [
          {
            data: 'aW1n',
            mime: 'image/png',
            source: { type: 'inline' },
            name: 'shot.png',
          },
        ],
      }),
    )

    expect(restored.attachments[0]).toMatchObject({
      type: 'file',
      displayName: 'shot.png',
      url: 'data:image/png;base64,aW1n',
      mime: 'image/png',
    })
  })

  it('已在 files[] 里的附件不会因为 metadata 再重复一次', async () => {
    const { extractUserMessageContent } = await import('./message')
    const restored = extractUserMessageContent(
      userMessage({
        files: [
          {
            data: 'QQ==',
            mime: 'application/zip',
            source: { type: 'uri', uri: 'file:///C:/tmp/uploads/u1/report.zip' },
            name: 'report.zip',
          },
        ],
      }),
    )

    expect(restored.attachments).toHaveLength(1)
    expect(restored.attachments[0]?.pathOnly).toBeUndefined()
  })

  it('没有 metadata 的旧消息回落到 message.text', async () => {
    const { extractUserMessageContent } = await import('./message')
    const restored = extractUserMessageContent(userMessage({ metadata: undefined }))
    expect(restored.text).toBe('看看？\nAttached file: `C:/tmp/uploads/u1/report.zip`')
  })
})

