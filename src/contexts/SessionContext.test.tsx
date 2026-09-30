import { act, render } from '@testing-library/react'
import { useContext, useEffect, type ContextType } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventCallbacks } from '../types/api/event'
import { SessionContext } from './SessionContext.shared'
import { SessionProvider } from './SessionContext'
import type { ServerChangeReason } from '../store/serverStore'

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res => {
    resolve = res
  })
  return { promise, resolve }
}

const {
  getSessionsMock,
  createSessionMock,
  deleteSessionMock,
  subscribeToEventsMock,
  clearChildrenMock,
  clearFollowupQueueMock,
  clearSessionRuntimeStateMock,
  sessionErrorHandlerMock,
  autoDetectPathStyleMock,
  onServerChangeMock,
} = vi.hoisted(() => ({
  getSessionsMock: vi.fn(),
  createSessionMock: vi.fn(),
  deleteSessionMock: vi.fn(),
  subscribeToEventsMock: vi.fn(),
  clearChildrenMock: vi.fn(),
  clearFollowupQueueMock: vi.fn(),
  clearSessionRuntimeStateMock: vi.fn(),
  sessionErrorHandlerMock: vi.fn(),
  autoDetectPathStyleMock: vi.fn(),
  onServerChangeMock: vi.fn(),
}))
let latestEventCallbacks: Partial<EventCallbacks> = {}
let latestContext: ContextType<typeof SessionContext> = null
let latestServerChange: ((serverId: string, reason: ServerChangeReason) => void) | undefined

vi.mock('../api', () => ({
  getSessions: (...args: unknown[]) => getSessionsMock(...args),
  createSession: (...args: unknown[]) => createSessionMock(...args),
  deleteSession: (...args: unknown[]) => deleteSessionMock(...args),
  subscribeToEvents: (...args: unknown[]) => subscribeToEventsMock(...args),
}))

vi.mock('./useDirectory', () => ({
  useDirectory: () => ({ currentDirectory: '/workspace/demo' }),
}))

vi.mock('../store/childSessionStore', () => ({
  childSessionStore: {
    clearChildren: clearChildrenMock,
  },
}))

vi.mock('../store/followupQueueStore', () => ({
  followupQueueStore: {
    clearSession: clearFollowupQueueMock,
  },
}))

// 阶段 2b：V2 没有 `todo.updated` 事件，SessionContext 也不再消费 todoStore，
// 因此这里不再 mock `../store/todoStore`（没有模块会加载它）。

vi.mock('../store/serverStore', () => ({
  serverStore: {
    onServerChange: (...args: unknown[]) => onServerChangeMock(...args),
    getActiveServerId: () => 'local',
  },
}))

vi.mock('../utils', () => ({
  sessionErrorHandler: (...args: unknown[]) => sessionErrorHandlerMock(...args),
  normalizeToForwardSlash: (value?: string) => value,
  isSameDirectory: (left?: string, right?: string) => left === right,
  autoDetectPathStyle: (...args: unknown[]) => autoDetectPathStyleMock(...args),
}))

vi.mock('../utils/sessionLifecycle', () => ({
  clearSessionRuntimeState: (...args: unknown[]) => clearSessionRuntimeStateMock(...args),
}))

function SessionContextProbe() {
  const context = useContext(SessionContext)

  useEffect(() => {
    latestContext = context
  }, [context])

  return null
}

describe('SessionProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    latestContext = null
    latestEventCallbacks = {}
    getSessionsMock.mockReset()
    createSessionMock.mockReset()
    deleteSessionMock.mockReset()
    subscribeToEventsMock.mockReset()
    clearChildrenMock.mockReset()
    clearFollowupQueueMock.mockReset()
    clearSessionRuntimeStateMock.mockReset()
    sessionErrorHandlerMock.mockReset()
    autoDetectPathStyleMock.mockReset()
    onServerChangeMock.mockReset()
    latestServerChange = undefined
    subscribeToEventsMock.mockImplementation((callbacks: EventCallbacks) => {
      latestEventCallbacks = callbacks
      return vi.fn()
    })
    onServerChangeMock.mockImplementation(listener => {
      latestServerChange = listener as (serverId: string, reason: ServerChangeReason) => void
      return vi.fn()
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('queues a reconnect refresh while the latest request is still pending', async () => {
    const firstRequest = createDeferred<Array<{ id: string; directory: string }>>()
    const secondRequest = createDeferred<Array<{ id: string; directory: string }>>()
    const thirdRequest = createDeferred<Array<{ id: string; directory: string }>>()

    getSessionsMock
      .mockImplementationOnce(() => firstRequest.promise)
      .mockImplementationOnce(() => secondRequest.promise)
      .mockImplementationOnce(() => thirdRequest.promise)

    render(
      <SessionProvider>
        <SessionContextProbe />
      </SessionProvider>,
    )

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    expect(latestContext).not.toBeNull()

    act(() => {
      latestContext!.setSearch('branch')
    })

    await act(async () => {
      vi.advanceTimersByTime(300)
      await Promise.resolve()
    })

    await act(async () => {
      firstRequest.resolve([{ id: 'session-1', directory: '/workspace/demo' }])
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      latestEventCallbacks.onReconnected?.('network')
      await Promise.resolve()
    })

    expect(getSessionsMock).toHaveBeenCalledTimes(2)

    await act(async () => {
      secondRequest.resolve([{ id: 'session-2', directory: '/workspace/demo' }])
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(getSessionsMock).toHaveBeenCalledTimes(3)

    await act(async () => {
      thirdRequest.resolve([{ id: 'session-3', directory: '/workspace/demo' }])
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(latestContext?.sessions.map(session => session.id)).toEqual(['session-3'])
  })

  it('retries the initial session list fetch after a startup failure', async () => {
    getSessionsMock
      .mockRejectedValueOnce(new Error('service not ready'))
      .mockResolvedValueOnce([{ id: 'session-1', directory: '/workspace/demo' }])

    render(
      <SessionProvider>
        <SessionContextProbe />
      </SessionProvider>,
    )

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
    expect(latestContext?.sessions.map(session => session.id)).toEqual(['session-1'])
  })

  it('removes deleted sessions from context and clears runtime state', async () => {
    getSessionsMock.mockResolvedValue([
      { id: 'session-1', directory: '/workspace/demo' },
      { id: 'session-2', directory: '/workspace/demo' },
    ])

    render(
      <SessionProvider>
        <SessionContextProbe />
      </SessionProvider>,
    )

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(latestContext?.sessions.map(session => session.id)).toEqual(['session-1', 'session-2'])

    act(() => {
      // V2 的 session.deleted 载荷是对象（{ sessionID }），不是裸字符串
      latestEventCallbacks.onSessionDeleted?.({ sessionID: 'session-1' })
    })

    expect(clearSessionRuntimeStateMock).toHaveBeenCalledWith('session-1')
    expect(latestContext?.sessions.map(session => session.id)).toEqual(['session-2'])
  })

  it('merges a partial session patch instead of replacing the entry', async () => {
    getSessionsMock.mockResolvedValue([
      { id: 'session-1', title: 'one', directory: '/workspace/demo' },
      { id: 'session-2', title: 'two', directory: '/workspace/demo' },
    ])

    render(
      <SessionProvider>
        <SessionContextProbe />
      </SessionProvider>,
    )

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      // V2 把会话元信息变更拆成了 renamed / metadata.updated / moved 等事件，
      // 事件层只给出**变化的字段**（这里只有 title）。消费者必须合并进原条目，
      // 否则 `{...prev, ...patch}` 会把 directory 覆盖成 undefined。
      latestEventCallbacks.onSessionUpdated?.({ id: 'session-2', title: 'renamed' })
      await Promise.resolve()
    })

    const sessions = latestContext?.sessions ?? []
    // 更新过的会话被提到列表最前
    expect(sessions.map(session => session.id)).toEqual(['session-2', 'session-1'])
    expect(sessions[0]).toMatchObject({ id: 'session-2', title: 'renamed', directory: '/workspace/demo' })
    // 本地列表里有这条会话 → 不需要向服务端重查
    expect(getSessionsMock).toHaveBeenCalledTimes(1)
  })

  it('refetches when a session patch arrives for a session missing from the local list', async () => {
    getSessionsMock.mockResolvedValue([{ id: 'session-1', title: 'one', directory: '/workspace/demo' }])

    render(
      <SessionProvider>
        <SessionContextProbe />
      </SessionProvider>,
    )

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(getSessionsMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      // 本地没有这条会话：补丁拼不出完整对象（缺 directory 等），
      // 应当交给服务端重查，而不是把残缺对象插进列表
      latestEventCallbacks.onSessionUpdated?.({ id: 'session-unknown', title: 'x' })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(getSessionsMock).toHaveBeenCalledTimes(2)
    expect(latestContext?.sessions.map(session => session.id)).toEqual(['session-1'])
  })

  it('refetches on server endpoint changes even while the old request is in flight', async () => {
    const staleRequest = createDeferred<Array<{ id: string; directory: string }>>()
    const freshRequest = createDeferred<Array<{ id: string; directory: string }>>()

    getSessionsMock
      .mockImplementationOnce(() => staleRequest.promise)
      .mockImplementationOnce(() => freshRequest.promise)

    render(
      <SessionProvider>
        <SessionContextProbe />
      </SessionProvider>,
    )

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
      freshRequest.resolve([{ id: 'fresh', directory: '/workspace/demo' }])
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(latestContext?.sessions.map(session => session.id)).toEqual(['fresh'])

    await act(async () => {
      staleRequest.resolve([{ id: 'stale', directory: '/workspace/demo' }])
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(latestContext?.sessions.map(session => session.id)).toEqual(['fresh'])
  })

  it('keeps the session list untouched when a non-active server endpoint changes', async () => {
    getSessionsMock.mockResolvedValue([{ id: 'session-1', directory: '/workspace/demo' }])

    render(
      <SessionProvider>
        <SessionContextProbe />
      </SessionProvider>,
    )

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    expect(getSessionsMock).toHaveBeenCalledTimes(1)
    expect(latestContext?.sessions.map(session => session.id)).toEqual(['session-1'])

    // 非 active 服务器（remote）端点变化：与 active 会话列表无关，不得清空/重拉
    await act(async () => {
      latestServerChange?.('remote', 'server-runtime-updated')
      await Promise.resolve()
    })

    expect(getSessionsMock).toHaveBeenCalledTimes(1)
    expect(latestContext?.sessions.map(session => session.id)).toEqual(['session-1'])
  })
})
