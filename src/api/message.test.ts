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
const switchModelMock = vi.fn(async () => {
  calls.push('switchModel')
})
const switchAgentMock = vi.fn(async () => {
  calls.push('switchAgent')
})
const promptMock = vi.fn(async () => {
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
    await sendMessage({
      ...baseParams(),
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

    const payload = promptMock.mock.calls[0][0]
    expect(payload.files).toEqual([
      { uri: 'file:///proj/src/foo.ts', name: 'foo.ts', mention: { start: 5, end: 12, text: '@foo.ts' } },
    ])
    expect(payload.agents).toEqual([{ name: 'build', mention: { start: 20, end: 26, text: '@build' } }])
  })

  it('skill 附件进 skills 数组（id + mention）', async () => {
    await sendMessage({
      ...baseParams(),
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

    const payload = promptMock.mock.calls[0][0]
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

    const payload = promptMock.mock.calls[0][0]
    expect(payload.metadata).toEqual({
      displayText: '帮我看下 @foo.ts',
      agent: 'build',
      model: { providerID: 'opencode', modelID: 'mimo', variant: 'high' },
    })
  })

  it('无 model/agent 时 metadata 只有 displayText', async () => {
    await sendMessage({ ...baseParams(), text: 'hello' })
    const payload = promptMock.mock.calls[0][0]
    expect(payload.metadata).toEqual({ displayText: 'hello' })
  })
})
