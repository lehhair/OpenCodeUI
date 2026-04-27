import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventCallbacks } from '../types/api/event'
import { useSessions } from './useSessions'

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res => {
    resolve = res
  })
  return { promise, resolve }
}

const getSessionsMock = vi.fn()
const createSessionMock = vi.fn()
const deleteSessionMock = vi.fn()
const subscribeToEventsMock = vi.fn()
let latestEventCallbacks: Partial<EventCallbacks> = {}

vi.mock('../api', () => ({
  getSessions: (...args: unknown[]) => getSessionsMock(...args),
  createSession: (...args: unknown[]) => createSessionMock(...args),
  deleteSession: (...args: unknown[]) => deleteSessionMock(...args),
  subscribeToEvents: (...args: unknown[]) => subscribeToEventsMock(...args),
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
    getSessionsMock.mockResolvedValue([])
    createSessionMock.mockResolvedValue(makeSession('new'))
    deleteSessionMock.mockResolvedValue(true)
    latestEventCallbacks = {}
    subscribeToEventsMock.mockImplementation((callbacks: EventCallbacks) => {
      latestEventCallbacks = callbacks
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

    expect(getSessionsMock).toHaveBeenCalledWith({
      roots: true,
      limit: 20,
      directory: '/workspace/demo',
    })
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

    expect(deleteSessionMock).toHaveBeenCalledWith('session-1', '/workspace/demo')
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

  it('does not refetch on reconnect while a newer request is still in flight', async () => {
    const firstRequest = createDeferred<ReturnType<typeof makeSession>[]>()
    const secondRequest = createDeferred<ReturnType<typeof makeSession>[]>()

    getSessionsMock
      .mockImplementationOnce(() => firstRequest.promise)
      .mockImplementationOnce(() => secondRequest.promise)

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
  })
})
