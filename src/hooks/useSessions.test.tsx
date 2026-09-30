import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventCallbacks } from '../types/api/event'
import type { ServerChangeReason } from '../store/serverStore'
import { useSessions } from './useSessions'

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res => {
    resolve = res
  })
  return { promise, resolve }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any
const { getSessionsMock, createSessionMock, deleteSessionMock, subscribeToEventsMock, onServerChangeMock } = vi.hoisted(
  () => ({
    getSessionsMock: vi.fn<AnyFn>(),
    createSessionMock: vi.fn<AnyFn>(),
    deleteSessionMock: vi.fn<AnyFn>(),
    subscribeToEventsMock: vi.fn<AnyFn>(),
    onServerChangeMock: vi.fn<AnyFn>(() => () => {}),
  }),
)
let latestEventCallbacks: Partial<EventCallbacks> = {}
let latestServerChange: ((serverId: string, reason: ServerChangeReason) => void) | undefined

vi.mock('../api', () => ({
  getSessions: (...args: unknown[]) => getSessionsMock(...args),
  createSession: (...args: unknown[]) => createSessionMock(...args),
  deleteSession: (...args: unknown[]) => deleteSessionMock(...args),
  subscribeToEvents: (...args: unknown[]) => subscribeToEventsMock(...args),
}))

vi.mock('../store/serverStore', () => ({
  serverStore: {
    onServerChange: (...args: unknown[]) => onServerChangeMock(...args),
    getActiveServerId: () => 'local',
  },
}))

function makeSession(id: string, directory = '/workspace/demo') {
  return {
    id,
    slug: id,
    projectID: 'project-1',
    directory,
    title: `Session ${id}`,
    version: '1',
    time: {
      created: 1,
      updated: 2,
    },
  }
}

describe('useSessions', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    getSessionsMock.mockReset()
    createSessionMock.mockReset()
    deleteSessionMock.mockReset()
    subscribeToEventsMock.mockReset()
    onServerChangeMock.mockReset()
    getSessionsMock.mockResolvedValue([])
    createSessionMock.mockResolvedValue(makeSession('new'))
    deleteSessionMock.mockResolvedValue(true)
    latestEventCallbacks = {}
    latestServerChange = undefined
    subscribeToEventsMock.mockImplementation((callbacks: EventCallbacks) => {
      latestEventCallbacks = callbacks
      return vi.fn()
    })
    onServerChangeMock.mockImplementation((listener: (serverId: string, reason: ServerChangeReason) => void) => {
      latestServerChange = listener
      return vi.fn()
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('waits for enabled before fetching', async () => {
    const { rerender } = renderHook(({ enabled }) => useSessions({ directory: '/workspace/demo', enabled }), {
      initialProps: { enabled: false },
    })

    expect(getSessionsMock).not.toHaveBeenCalled()

    rerender({ enabled: true })

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    expect(getSessionsMock).toHaveBeenCalledWith(
      {
        roots: true,
        limit: 20,
        directory: '/workspace/demo',
      },
      undefined,
    )
  })

  it('passes the scoped directory when removing a session', async () => {
    getSessionsMock.mockResolvedValue([makeSession('session-1')])

    const { result } = renderHook(() => useSessions({ directory: '/workspace/demo' }))

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    expect(result.current.sessions).toHaveLength(1)

    await act(async () => {
      await result.current.remove('session-1')
    })

    expect(deleteSessionMock).toHaveBeenCalledWith('session-1', '/workspace/demo', undefined)
  })

  it('adds matching sessions from realtime events immediately', async () => {
    const { result } = renderHook(() => useSessions({ directory: '/workspace/demo' }))

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    await act(async () => {
      latestEventCallbacks.onSessionCreated?.(makeSession('session-1'))
      latestEventCallbacks.onSessionCreated?.(makeSession('session-ignored', '/workspace/other'))
      latestEventCallbacks.onSessionCreated?.({ ...makeSession('session-child'), parentID: 'parent-1' })
    })

    expect(result.current.sessions.map(session => session.id)).toEqual(['session-1'])
  })

  it('queues a reconnect refresh while a newer request is still in flight', async () => {
    const firstRequest = createDeferred<ReturnType<typeof makeSession>[]>()
    const secondRequest = createDeferred<ReturnType<typeof makeSession>[]>()
    const thirdRequest = createDeferred<ReturnType<typeof makeSession>[]>()

    getSessionsMock
      .mockImplementationOnce(() => firstRequest.promise)
      .mockImplementationOnce(() => secondRequest.promise)
      .mockImplementationOnce(() => thirdRequest.promise)

    const { result } = renderHook(() => useSessions({ directory: '/workspace/demo' }))

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    act(() => {
      result.current.setSearch('branch')
    })

    await act(async () => {
      vi.advanceTimersByTime(300)
      await Promise.resolve()
    })

    await act(async () => {
      firstRequest.resolve([makeSession('session-1')])
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      latestEventCallbacks.onReconnected?.('network')
      await Promise.resolve()
    })

    expect(getSessionsMock).toHaveBeenCalledTimes(2)

    await act(async () => {
      secondRequest.resolve([makeSession('session-2')])
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(getSessionsMock).toHaveBeenCalledTimes(3)

    await act(async () => {
      thirdRequest.resolve([makeSession('session-3')])
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.sessions.map(session => session.id)).toEqual(['session-3'])
  })

  it('retries the initial fetch after a startup failure', async () => {
    getSessionsMock
      .mockRejectedValueOnce(new Error('service not ready'))
      .mockResolvedValueOnce([makeSession('session-1')])

    const { result } = renderHook(() => useSessions({ directory: '/workspace/demo' }))

    await act(async () => {
      vi.runOnlyPendingTimers()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(getSessionsMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      vi.advanceTimersByTime(500)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(getSessionsMock).toHaveBeenCalledTimes(2)
    expect(result.current.sessions.map(session => session.id)).toEqual(['session-1'])
  })

  it('refetches on server endpoint changes even while the old request is in flight', async () => {
    const staleRequest = createDeferred<ReturnType<typeof makeSession>[]>()
    const freshRequest = createDeferred<ReturnType<typeof makeSession>[]>()

    getSessionsMock
      .mockImplementationOnce(() => staleRequest.promise)
      .mockImplementationOnce(() => freshRequest.promise)

    const { result } = renderHook(() => useSessions({ directory: '/workspace/demo' }))

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    expect(getSessionsMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      // active 服务器自身端点变化（serverId = active）才应触发重拉
      latestServerChange?.('local', 'server-runtime-updated')
      await Promise.resolve()
    })

    expect(getSessionsMock).toHaveBeenCalledTimes(2)

    await act(async () => {
      freshRequest.resolve([makeSession('fresh')])
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.sessions.map(session => session.id)).toEqual(['fresh'])

    await act(async () => {
      staleRequest.resolve([makeSession('stale')])
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.sessions.map(session => session.id)).toEqual(['fresh'])
  })

  it('refetches only for active-server events, ignoring non-active runtime updates', async () => {
    getSessionsMock.mockResolvedValue([makeSession('session-1')])

    renderHook(() => useSessions({ directory: '/workspace/demo' }))

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    expect(getSessionsMock).toHaveBeenCalledTimes(1)

    // 非 active 服务器（remote）端点变化：与当前列表无关，不得清空/重拉
    await act(async () => {
      latestServerChange?.('remote', 'server-runtime-updated')
      await Promise.resolve()
    })
    expect(getSessionsMock).toHaveBeenCalledTimes(1)

    // active（getActiveServerId mock = 'local'）自身端点变化：数据源地址变了，需要重拉
    await act(async () => {
      latestServerChange?.('local', 'server-runtime-updated')
      await Promise.resolve()
    })
    expect(getSessionsMock).toHaveBeenCalledTimes(2)

    // 真实切换：事件里的 serverId 即新 active，照常重拉
    await act(async () => {
      latestServerChange?.('remote', 'server-switch')
      await Promise.resolve()
    })
    expect(getSessionsMock).toHaveBeenCalledTimes(3)
  })

  it('keeps loading during retry backoff and lands error only at terminal failure', async () => {
    getSessionsMock.mockRejectedValue(new Error('service not ready'))

    const { result } = renderHook(() => useSessions({ directory: '/workspace/demo' }))

    // 首次失败：进入重试等待期，必须仍是 loading（空列表 + 非 loading 会闪现空态文案）
    await act(async () => {
      vi.runOnlyPendingTimers()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(getSessionsMock).toHaveBeenCalledTimes(1)
    expect(result.current.isLoading).toBe(true)
    expect(result.current.error).toBeNull()

    // 前两次退避到期后仍在加载（等待第三次重试），第三次退避会耗尽重试
    for (const backoff of [500, 1500]) {
      await act(async () => {
        vi.advanceTimersByTime(backoff)
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(result.current.isLoading).toBe(true)
    }

    // 第三次退避到期 → 第四次尝试 → 耗尽 → 终态
    await act(async () => {
      vi.advanceTimersByTime(3000)
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(getSessionsMock).toHaveBeenCalledTimes(4)
    expect(result.current.isLoading).toBe(false)
    expect(result.current.error).not.toBeNull()
    expect(result.current.sessions).toEqual([])

    // 重试耗尽（500+1500+3000 后第四次尝试）：终态 = 非 loading + error，而非「没有对话」
    await act(async () => {
      vi.advanceTimersByTime(3000)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(getSessionsMock).toHaveBeenCalledTimes(4)
    expect(result.current.isLoading).toBe(false)
    expect(result.current.error).not.toBeNull()
    expect(result.current.sessions).toEqual([])
  })

  it('lands success after a retry and clears error', async () => {
    getSessionsMock
      .mockRejectedValueOnce(new Error('service not ready'))
      .mockResolvedValueOnce([makeSession('session-1')])

    const { result } = renderHook(() => useSessions({ directory: '/workspace/demo' }))

    await act(async () => {
      vi.runOnlyPendingTimers()
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      vi.advanceTimersByTime(500)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.sessions.map(session => session.id)).toEqual(['session-1'])
    expect(result.current.isLoading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('cancels the pending retry backoff when unmounted', async () => {
    getSessionsMock.mockRejectedValueOnce(new Error('service not ready'))
    getSessionsMock.mockResolvedValue([])

    const { unmount } = renderHook(() => useSessions({ directory: '/workspace/demo' }))

    // 首次失败 → 停在 500ms 退避等待中
    await act(async () => {
      vi.runOnlyPendingTimers()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(getSessionsMock).toHaveBeenCalledTimes(1)

    unmount()

    // 推过整个退避表：卸载必须中断重试，否则陈旧 timer 会在组件消失后再发最多 3 次请求
    await act(async () => {
      vi.advanceTimersByTime(6000)
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(getSessionsMock).toHaveBeenCalledTimes(1)
  })
})
