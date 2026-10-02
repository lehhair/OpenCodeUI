import { describe, expect, it } from 'vitest'
import type { SessionMessageInfo } from '../types/api/message'
import { computeSessionStats, isSameSessionStats } from './sessionStatsCompute'

describe('computeSessionStats', () => {
  it('switches to estimated context after a compaction turn', () => {
    // v2 里「压缩」是**独立消息**（不再是挂在用户消息上的 part），
    // 因此这里用一条 type: 'compaction' 的消息来表达压缩发生。
    const messages: SessionMessageInfo[] = [
      {
        id: 'user-1',
        type: 'user',
        time: { created: 1 },
        text: 'hello world',
      },
      {
        id: 'assistant-1',
        type: 'assistant',
        time: { created: 2, completed: 3 },
        agent: 'default',
        model: { id: 'model', providerID: 'provider' },
        content: [{ type: 'text', text: 'long reply' }],
        cost: 0,
        tokens: { input: 12000, output: 800, reasoning: 200, cache: { read: 0, write: 0 } },
      },
      {
        id: 'compaction-1',
        type: 'compaction',
        time: { created: 4 },
        status: 'completed',
        reason: 'auto',
        model: { id: 'model', providerID: 'provider' },
        summary: 'short summary',
        recent: '',
      },
    ]

    const stats = computeSessionStats(messages, 200000)

    expect(stats.contextEstimated).toBe(true)
    expect(stats.contextUsed).toBeLessThan(12000)
    expect(stats.contextUsed).toBeGreaterThan(0)
  })

  it('reuses equality when numeric fields are unchanged', () => {
    const a = computeSessionStats([], 200000)
    const b = computeSessionStats([], 200000)
    expect(isSameSessionStats(a, b)).toBe(true)
    expect(isSameSessionStats(a, { ...b, contextUsed: b.contextUsed + 1 })).toBe(false)
  })
})
