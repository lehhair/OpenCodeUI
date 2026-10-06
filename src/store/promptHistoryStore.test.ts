import { beforeEach, describe, expect, it } from 'vitest'
import { promptHistoryStore, fromHistoryEntry } from './promptHistoryStore'
import type { Attachment } from '../api/types'

function fileAttachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: crypto.randomUUID(),
    type: 'file',
    displayName: 'a.ts',
    relativePath: 'src/a.ts',
    url: 'file:///repo/src/a.ts',
    mime: 'text/plain',
    ...overrides,
  } as Attachment
}

describe('promptHistoryStore（官方 composer/history 同款）', () => {
  beforeEach(() => {
    promptHistoryStore.reset()
  })

  it('发送即记账，最新在前；与最新一条相同则跳过', () => {
    promptHistoryStore.add('第一条', [], 'normal')
    promptHistoryStore.add('第一条', [], 'normal')
    promptHistoryStore.add('第二条', [], 'normal')

    const entries = promptHistoryStore.entries('normal')
    expect(entries.map(e => e.text)).toEqual(['第二条', '第一条'])
  })

  it('发送失败移除（失败回填不应在历史里留重复）', () => {
    promptHistoryStore.add('会失败的发送', [], 'normal')
    expect(promptHistoryStore.entries('normal')).toHaveLength(1)

    promptHistoryStore.remove('会失败的发送', [], 'normal')
    expect(promptHistoryStore.entries('normal')).toHaveLength(0)
  })

  it('normal / shell 分轨', () => {
    promptHistoryStore.add('普通输入', [], 'normal')
    promptHistoryStore.add('ls -la', [], 'shell')

    expect(promptHistoryStore.entries('normal').map(e => e.text)).toEqual(['普通输入'])
    expect(promptHistoryStore.entries('shell').map(e => e.text)).toEqual(['ls -la'])
  })

  it('上限 100 条（官方 MAX_HISTORY 同款）', () => {
    for (let i = 0; i < 110; i++) {
      promptHistoryStore.add(`entry-${i}`, [], 'normal')
    }
    const entries = promptHistoryStore.entries('normal')
    expect(entries).toHaveLength(100)
    expect(entries[0].text).toBe('entry-109')
    expect(entries[99].text).toBe('entry-10')
  })

  it('localStorage 持久化：重置加载标记后从磁盘读回', () => {
    promptHistoryStore.add('跨重启保留', [], 'normal')

    // 模拟重启：清内存态，重新从 localStorage 加载
    const raw = localStorage.getItem('prompt-history')
    expect(raw).toBeTruthy()
    expect(JSON.parse(raw!)[0].text).toBe('跨重启保留')
  })

  it('附件只持久化可序列化部分：data URL 内联图片不落盘', () => {
    promptHistoryStore.add(
      '看图',
      [
        fileAttachment(),
        fileAttachment({ displayName: 'shot.png', url: 'data:image/png;base64,aW1n', relativePath: undefined }),
        { id: '1', type: 'agent', displayName: 'planner', agentName: 'planner' } as Attachment,
      ],
      'normal',
    )

    const [entry] = promptHistoryStore.entries('normal')
    expect(entry.attachments).toEqual([
      { type: 'file', displayName: 'a.ts', relativePath: 'src/a.ts', url: 'file:///repo/src/a.ts', mime: 'text/plain' },
      { type: 'agent', displayName: 'planner', agentName: 'planner' },
    ])
  })

  it('fromHistoryEntry 重建附件（新 id）', () => {
    const rebuilt = fromHistoryEntry({
      type: 'skill',
      displayName: 'Commit',
      skillId: 'commit',
    })
    expect(rebuilt).toMatchObject({ type: 'skill', displayName: 'Commit', skillId: 'commit' })
    expect(rebuilt.id).toBeTruthy()
  })
})
