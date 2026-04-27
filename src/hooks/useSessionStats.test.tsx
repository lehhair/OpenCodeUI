import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useSessionStats } from './useSessionStats'

const useMessageStoreMock = vi.fn()

vi.mock('../store', () => ({
  useMessageStore: () => useMessageStoreMock(),
}))

describe('useSessionStats', () => {
  it('switches to estimated context after a compaction turn', () => {
    useMessageStoreMock.mockReturnValue({
      messages: [
        {
          info: { id: 'user-1', role: 'user', time: { created: 1 } },
          parts: [{ type: 'text', text: 'hello world', id: 'p1', sessionID: 's1', messageID: 'user-1' }],
        },
        {
          info: {
            id: 'assistant-1',
            role: 'assistant',
            time: { created: 2 },
            parentID: 'user-1',
            modelID: 'model',
            providerID: 'provider',
            mode: 'chat',
            agent: 'default',
            path: { cwd: '/', root: '/' },
            cost: 0,
            tokens: { input: 12000, output: 800, reasoning: 200, cache: { read: 0, write: 0 } },
          },
          parts: [{ type: 'text', text: 'long reply', id: 'p2', sessionID: 's1', messageID: 'assistant-1' }],
        },
        {
          info: { id: 'user-2', role: 'user', time: { created: 3 } },
          parts: [{ type: 'compaction', id: 'p3', sessionID: 's1', messageID: 'user-2' }],
        },
        {
          info: {
            id: 'assistant-2',
            role: 'assistant',
            time: { created: 4 },
            parentID: 'user-2',
            modelID: 'model',
            providerID: 'provider',
            mode: 'compaction',
            agent: 'compaction',
            path: { cwd: '/', root: '/' },
            cost: 0,
            summary: true,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          },
          parts: [{ type: 'text', text: 'short summary', id: 'p4', sessionID: 's1', messageID: 'assistant-2' }],
        },
      ],
    })

    const { result } = renderHook(() => useSessionStats(200000))

    expect(result.current.contextEstimated).toBe(true)
    expect(result.current.contextUsed).toBeLessThan(12000)
    expect(result.current.contextUsed).toBeGreaterThan(0)
  })
})
