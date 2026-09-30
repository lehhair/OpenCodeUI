import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { messageStore } from '../store/messageStore'
import { useSessionStats } from './useSessionStats'
import { v2Assistant, v2Compaction, v2User } from '../test/fixtures/v2Messages'

vi.mock('../store/paneLayoutStore', () => ({
  paneLayoutStore: {
    getFocusedSessionId: vi.fn(() => 'session-1'),
    subscribe: vi.fn(() => vi.fn()),
  },
}))

/** 造一条 V2 user 消息（读侧夹具） */
function createUserMessage(id: string, created: number) {
  return v2User(id, `text of ${id}`, { time: { created } })
}

describe('useSessionStats', () => {
  beforeEach(() => {
    messageStore.clearAll()
  })

  it('returns estimated context after a compaction turn', async () => {
    // V2 下「压缩」不再是挂在消息上的 compaction part + summary 标志，
    // 而是**独立的 compaction 消息类型**（见迁移文档 §5.2 / §5.3）。
    messageStore.setMessages('session-1', [
      v2User('user-1', 'hello world', { time: { created: 1 } }),
      v2Assistant('assistant-1', 'long reply', {
        time: { created: 2 },
        tokens: { input: 12000, output: 800, reasoning: 200, cache: { read: 0, write: 0 } },
      }),
      v2Compaction('compaction-1'),
      v2Assistant('assistant-2', 'short summary', { time: { created: 4 } }),
    ])

    await act(async () => {
      await new Promise(resolve => requestAnimationFrame(resolve))
    })

    const { result } = renderHook(() => useSessionStats(200000))

    expect(result.current.contextEstimated).toBe(true)
    expect(result.current.contextUsed).toBeLessThan(12000)
    expect(result.current.contextUsed).toBeGreaterThan(0)
  })

  it('reuses the same stats object when numeric fields do not change', async () => {
    messageStore.setMessages('session-1', [createUserMessage('message-1', 1)])
    await act(async () => {
      await new Promise(resolve => requestAnimationFrame(resolve))
    })

    const { result, rerender } = renderHook(() => useSessionStats(200000))
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
  })
})
