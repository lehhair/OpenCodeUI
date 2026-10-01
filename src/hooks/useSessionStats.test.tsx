import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssistantMessage, SessionMessage, UserMessage } from '../api/types'
import { messageStore } from '../store/messageStore'
import { useSessionStats } from './useSessionStats'

vi.mock('../store/paneLayoutStore', () => ({
  paneLayoutStore: {
    getFocusedSessionId: vi.fn(() => 'session-1'),
    subscribe: vi.fn(() => vi.fn()),
  },
}))

// ============================================
// v2 变更说明
//
// 本文件原先用 v1 的 `{ info, parts }` 夹具。v2 中：
//   - 消息自带 content，store.setMessages 接收**原生消息**并自行投影
//   - 「压缩」从 v1 的 part 提升为**独立消息类型** `type: 'compaction'`
//     （v2Projection 会把它投影成 UI 的 compaction part，供上下文估算判断
//     是否需要放弃服务端 tokens、改用重新估算）
// ============================================

function createUserMessage(id: string, created: number, text: string): UserMessage {
  return { id, type: 'user', time: { created }, text }
}

function createAssistantMessage(
  id: string,
  created: number,
  text: string,
  tokens?: AssistantMessage['tokens'],
): AssistantMessage {
  return {
    id,
    type: 'assistant',
    agent: 'default',
    model: { id: 'model-1', providerID: 'provider-1' },
    content: [{ type: 'text', text }],
    time: { created },
    ...(tokens ? { tokens } : {}),
  }
}

function createCompactionMessage(id: string, created: number): SessionMessage {
  return {
    id,
    type: 'compaction',
    status: 'completed',
    reason: 'auto',
    summary: 'short summary',
    recent: '',
    time: { created },
  } as SessionMessage
}

async function flushFrames(): Promise<void> {
  await act(async () => {
    await new Promise(resolve => requestAnimationFrame(resolve))
  })
}

describe('useSessionStats', () => {
  beforeEach(() => {
    messageStore.clearAll()
  })

  it('returns estimated context after a compaction turn', async () => {
    messageStore.setMessages('session-1', [
      createUserMessage('user-1', 1, 'hello world'),
      createAssistantMessage('assistant-1', 2, 'long reply', {
        input: 12000,
        output: 800,
        reasoning: 200,
        cache: { read: 0, write: 0 },
      }),
      // 压缩之后应该放弃服务端 tokens，改用重新估算
      createCompactionMessage('compaction-1', 3),
    ])

    await flushFrames()

    const { result } = renderHook(() => useSessionStats(200000))

    expect(result.current.contextEstimated).toBe(true)
    expect(result.current.contextUsed).toBeLessThan(12000)
    expect(result.current.contextUsed).toBeGreaterThan(0)
  })

  it('reuses the same stats object when numeric fields do not change', async () => {
    messageStore.setMessages('session-1', [
      createAssistantMessage('assistant-1', 1, 'one', {
        input: 100,
        output: 20,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      }),
    ])
    await flushFrames()

    const { result, rerender } = renderHook(() => useSessionStats(200000))
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
  })
})
