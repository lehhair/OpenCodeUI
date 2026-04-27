import { act, render } from '@testing-library/react'
import { useContext, type ContextType } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventCallbacks } from '../types/api/event'
import { SessionContext } from './SessionContext.shared'
import { SessionProvider } from './SessionContext'

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
  setTodosMock,
  sessionErrorHandlerMock,
  autoDetectPathStyleMock,
} = vi.hoisted(() => ({
  getSessionsMock: vi.fn(),
  createSessionMock: vi.fn(),
  deleteSessionMock: vi.fn(),
  subscribeToEventsMock: vi.fn(),
  clearChildrenMock: vi.fn(),
  clearFollowupQueueMock: vi.fn(),
  setTodosMock: vi.fn(),
  sessionErrorHandlerMock: vi.fn(),
  autoDetectPathStyleMock: vi.fn(),
}))
let latestEventCallbacks: Partial<EventCallbacks> = {}
let latestContext: ContextType<typeof SessionContext> = null

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

vi.mock('../store/todoStore', () => ({
  todoStore: {
    setTodos: setTodosMock,
  },
}))

vi.mock('../utils', () => ({
  sessionErrorHandler: (...args: unknown[]) => sessionErrorHandlerMock(...args),
  normalizeToForwardSlash: (value?: string) => value,
  isSameDirectory: (left?: string, right?: string) => left === right,
  autoDetectPathStyle: (...args: unknown[]) => autoDetectPathStyleMock(...args),
}))

function SessionContextProbe() {
  latestContext = useContext(SessionContext)
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
    setTodosMock.mockReset()
    sessionErrorHandlerMock.mockReset()
    autoDetectPathStyleMock.mockReset()
    subscribeToEventsMock.mockImplementation((callbacks: EventCallbacks) => {
      latestEventCallbacks = callbacks
      return vi.fn()
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not refetch on reconnect while the latest request is still pending', async () => {
    const firstRequest = createDeferred<Array<{ id: string; directory: string }>>()
    const secondRequest = createDeferred<Array<{ id: string; directory: string }>>()

    getSessionsMock.mockImplementationOnce(() => firstRequest.promise).mockImplementationOnce(() => secondRequest.promise)

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
  })
})
