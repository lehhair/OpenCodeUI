import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueuedUserPrompt } from '../store/inboxStore'

const { promptMock, inboxListMock, inboxCancelMock } = vi.hoisted(() => ({
  promptMock: vi.fn(),
  inboxListMock: vi.fn(),
  inboxCancelMock: vi.fn(() => Promise.resolve()),
}))

vi.mock('./sdk', () => ({
  getSDKClient: () => ({
    session: {
      prompt: promptMock,
      inbox: {
        list: inboxListMock,
        cancel: inboxCancelMock,
      },
    },
  }),
}))

vi.mock('./session', () => ({
  cancelInboxItem: inboxCancelMock,
}))

import { rewriteQueueOrder, buildEditedPromptInput, queuedPromptAttachments } from './queue'

function queuedItem(id: string, text: string, payload: Record<string, unknown> = {}): QueuedUserPrompt {
  return {
    id,
    sessionID: 'ses-1',
    time: { created: Date.now() },
    type: 'user',
    delivery: 'queue',
    payload: { text, ...payload },
  } as unknown as QueuedUserPrompt
}

describe('rewriteQueueOrder（官方 queue.rewrite 同款：后缀重写保序）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('顺序未变 → 什么都不做', async () => {
    inboxListMock.mockResolvedValue([queuedItem('a', 'A'), queuedItem('b', 'B')])
    await rewriteQueueOrder('ses-1', ['a', 'b'])
    expect(promptMock).not.toHaveBeenCalled()
    expect(inboxCancelMock).not.toHaveBeenCalled()
  })

  it('交换顺序 → 从变化点起的后缀重新 admit 再 cancel', async () => {
    inboxListMock.mockResolvedValue([queuedItem('a', 'A'), queuedItem('b', 'B'), queuedItem('c', 'C')])
    await rewriteQueueOrder('ses-1', ['a', 'c', 'b'])

    // 变化点在 index 1：c、b 依次重新 admit（resume:false），再 cancel 旧 b、c
    expect(promptMock).toHaveBeenCalledTimes(2)
    expect(promptMock.mock.calls[0][0]).toMatchObject({ text: 'C', delivery: 'queue', resume: false })
    expect(promptMock.mock.calls[1][0]).toMatchObject({ text: 'B', delivery: 'queue', resume: false })
    expect(inboxCancelMock).toHaveBeenCalledTimes(2)
    expect(inboxCancelMock.mock.calls[0]).toEqual(['ses-1', 'b', undefined])
    expect(inboxCancelMock.mock.calls[1]).toEqual(['ses-1', 'c', undefined])
  })

  it('队列含控制条目（compaction/move）→ 拒绝重排', async () => {
    inboxListMock.mockResolvedValue([
      queuedItem('a', 'A'),
      { ...queuedItem('x', 'X'), type: 'compaction', payload: {} } as never,
    ])
    await expect(rewriteQueueOrder('ses-1', ['a', 'x'])).rejects.toThrow('control items')
  })

  it('顺序列表缺少现有条目 → 报错', async () => {
    inboxListMock.mockResolvedValue([queuedItem('a', 'A'), queuedItem('b', 'B')])
    await expect(rewriteQueueOrder('ses-1', ['a'])).rejects.toThrow('changed before reordering')
  })
})

describe('buildEditedPromptInput（官方 editedPromptInput 同款）', () => {
  it('保留原文件/agent/skill 提及（文本仍含 mention 时），合并新请求', () => {
    const original = queuedItem('q1', '看下 @agent-x 和 @skill-y', {
      files: [
        {
          data: 'QQ==',
          mime: 'text/plain',
          source: { type: 'uri', uri: 'file:///repo/a.ts' },
          name: 'a.ts',
          mention: { start: 4, end: 9, text: '@a.ts' },
        },
      ],
      agents: [{ name: 'agent-x', mention: { start: 0, end: 8, text: '@agent-x' } }],
      skills: [{ id: 'skill-y', mention: { start: 12, end: 20, text: '@skill-y' } }],
      metadata: { displayText: '看下 @agent-x 和 @skill-y' },
    })

    const result = buildEditedPromptInput({
      sessionId: 'ses-1',
      text: '再看下 @agent-x 就行',
      attachments: [],
      original,
      delivery: 'queue',
      request: { files: [], agents: [], skills: [] },
    })

    // agent-x 仍被提及 → 保留且区间重定位；skill-y 不再被提及 → 丢弃
    expect(result.agents).toEqual([{ name: 'agent-x', mention: { text: '@agent-x', start: 4, end: 12 } }])
    expect(result.skills).toEqual([])
    // 文件全部保留（非 composer 附件），区间重定位；不存在则 undefined
    expect(result.files?.[0].uri).toBe('data:text/plain;base64,QQ==')
    expect(result.files?.[0].mention).toBeUndefined()
    expect(result.metadata?.displayText).toBe('再看下 @agent-x 就行')
    expect(result.resume).toBe(false)
  })

  it('model 可见文本后缀（notes）接回 text 尾部', () => {
    const original = queuedItem('q1', '展示文本+额外 model 上下文', {
      metadata: { displayText: '展示文本' },
    })
    const result = buildEditedPromptInput({
      sessionId: 'ses-1',
      text: '改过的展示文本',
      attachments: [],
      original,
      delivery: 'queue',
      request: { files: [], agents: [], skills: [] },
    })
    expect(result.text).toBe('改过的展示文本+额外 model 上下文')
  })

  it('编辑器 path 附件（无 url 有 relativePath）回 metadata.attachments', () => {
    const original = queuedItem('q1', 'x', { metadata: { displayText: 'x' } })
    const result = buildEditedPromptInput({
      sessionId: 'ses-1',
      text: 'x',
      attachments: [
        { id: '1', type: 'file', displayName: 'b.ts', mime: 'text/plain', relativePath: 'src/b.ts' } as never,
      ],
      original,
      delivery: 'queue',
      request: { files: [], agents: [], skills: [] },
    })
    expect(result.metadata?.attachments).toEqual([{ name: 'b.ts', mime: 'text/plain', path: 'src/b.ts' }])
  })
})

describe('queuedPromptAttachments（官方同款）', () => {
  it('inline 无 mention 文件 → image 附件；metadata.attachments → path 附件', () => {
    const item = queuedItem('q1', 'x', {
      files: [
        { data: 'aW1n', mime: 'image/png', source: { type: 'inline' }, name: 'shot.png' },
        { data: 'QQ==', mime: 'text/plain', source: { type: 'uri', uri: 'file:///a.ts' }, name: 'a.ts', mention: { start: 0, end: 1, text: '@a' } },
      ],
      metadata: { attachments: [{ name: 'b.ts', mime: 'text/plain', path: 'src/b.ts' }] },
    })
    const attachments = queuedPromptAttachments(item)
    expect(attachments).toHaveLength(2)
    expect(attachments[0]).toMatchObject({ type: 'file', displayName: 'shot.png', url: 'data:image/png;base64,aW1n' })
    expect(attachments[1]).toMatchObject({ type: 'file', displayName: 'b.ts', relativePath: 'src/b.ts' })
    // 带 mention 的文件不回编辑器（留在 payload 由 buildEditedPromptInput 保留）
  })
})
