import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionManager } from './useSessionManager'

const { getSessionMock, getSessionMessagesPageMock, messageStoreMock, sessionErrorHandlerMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  getSessionMessagesPageMock: vi.fn(),
  messageStoreMock: {
    getSessionState: vi.fn(),
    setLoadState: vi.fn(),
    setLoadError: vi.fn(),
    setMessages: vi.fn(),
    updateSessionMetadata: vi.fn(),
    prependMessages: vi.fn(),
    setRevertState: vi.fn(),
  },
  sessionErrorHandlerMock: vi.fn(),
}))

vi.mock('../api', () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
  getSessionMessagesPage: (...args: unknown[]) => getSessionMessagesPageMock(...args),
  revertMessage: vi.fn(),
  unrevertSession: vi.fn(),
  extractUserMessageContent: vi.fn(),
}))

vi.mock('../store', () => ({
  messageStore: messageStoreMock,
}))

vi.mock('../utils', () => ({
  sessionErrorHandler: (...args: unknown[]) => sessionErrorHandlerMock(...args),
}))

describe('useSessionManager', () => {
  beforeEach(() => {
    getSessionMock.mockReset()
    getSessionMessagesPageMock.mockReset()
    messageStoreMock.getSessionState.mockReset()
    messageStoreMock.setLoadState.mockReset()
    messageStoreMock.setLoadError.mockReset()
    messageStoreMock.setMessages.mockReset()
    messageStoreMock.updateSessionMetadata.mockReset()
    messageStoreMock.prependMessages.mockReset()
    messageStoreMock.setRevertState.mockReset()
    sessionErrorHandlerMock.mockReset()

    messageStoreMock.getSessionState.mockReturnValue(null)
    getSessionMock.mockResolvedValue({ id: 'session-1', directory: '/workspace/demo' })
    getSessionMessagesPageMock.mockResolvedValue({ messages: [], nextCursor: null })
  })

  it('reports missing route sessions when loading returns not found', async () => {
    const onSessionMissing = vi.fn()
    const notFoundError = Object.assign(new Error('session not found'), { status: 404 })
    getSessionMock.mockRejectedValue(notFoundError)
    getSessionMessagesPageMock.mockRejectedValue(notFoundError)

    renderHook(() =>
      useSessionManager({
        sessionId: 'missing-session',
        directory: '/workspace/demo',
        onSessionMissing,
      }),
    )

    await waitFor(() => {
      expect(onSessionMissing).toHaveBeenCalledWith('missing-session')
    })

    expect(messageStoreMock.setLoadState).toHaveBeenCalledWith('missing-session', 'loading')
    expect(messageStoreMock.setLoadError).toHaveBeenCalledWith(
      'missing-session',
      expect.objectContaining({ type: 'APIError' }),
    )
  })

  it('历史翻页：游标自指（服务端异常）视为到头，hasMoreHistory=false', async () => {
    // 真机复现：v2.0.14 服务端偶发连续返回同一 next 值，「加载更多」死循环
    const state = {
      messages: [{ id: 'msg-2', time: { created: 2 } }],
      historyCursor: 'cursor-A',
    }
    messageStoreMock.getSessionState.mockReturnValue(state)
    getSessionMessagesPageMock.mockResolvedValue({
      messages: [{ id: 'msg-1', time: { created: 1 } }],
      nextCursor: 'cursor-A', // 与入参相同 = 不前进
    })

    const { result } = renderHook(() =>
      useSessionManager({ sessionId: 'local::session-1', directory: '/workspace/demo' }),
    )

    await result.current.loadMoreHistory()

    expect(messageStoreMock.prependMessages).toHaveBeenCalledWith(
      'local::session-1',
      [{ id: 'msg-1', time: { created: 1 } }],
      false,
      null,
    )
  })

  it('历史翻页：游标前进则继续（hasMoreHistory=true + 新游标）', async () => {
    const state = {
      messages: [{ id: 'msg-2', time: { created: 2 } }],
      historyCursor: 'cursor-A',
    }
    messageStoreMock.getSessionState.mockReturnValue(state)
    getSessionMessagesPageMock.mockResolvedValue({
      messages: [{ id: 'msg-1', time: { created: 1 } }],
      nextCursor: 'cursor-B',
    })

    const { result } = renderHook(() =>
      useSessionManager({ sessionId: 'local::session-1', directory: '/workspace/demo' }),
    )

    await result.current.loadMoreHistory()

    expect(messageStoreMock.prependMessages).toHaveBeenCalledWith(
      'local::session-1',
      [{ id: 'msg-1', time: { created: 1 } }],
      true,
      'cursor-B',
    )
  })

  it('历史翻页：historyCursor 为 null 不再请求', async () => {
    messageStoreMock.getSessionState.mockReturnValue({ messages: [], historyCursor: null })

    const { result } = renderHook(() =>
      useSessionManager({ sessionId: 'local::session-1', directory: '/workspace/demo' }),
    )

    // 挂载时的初始加载也会调一次首页（不带 cursor）——等它完成后清零再断言
    await waitFor(() => {
      expect(getSessionMessagesPageMock).toHaveBeenCalled()
    })
    getSessionMessagesPageMock.mockClear()

    await result.current.loadMoreHistory()

    expect(getSessionMessagesPageMock).not.toHaveBeenCalled()
  })
})
