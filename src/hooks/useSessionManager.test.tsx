import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionManager } from './useSessionManager'

const {
  getSessionMock,
  getSessionMessagesMock,
  messageStoreMock,
  sessionErrorHandlerMock,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  getSessionMessagesMock: vi.fn(),
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
  getSessionMessages: (...args: unknown[]) => getSessionMessagesMock(...args),
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
    getSessionMessagesMock.mockReset()
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
    getSessionMessagesMock.mockResolvedValue([])
  })

  it('reports missing route sessions when loading returns not found', async () => {
    const onSessionMissing = vi.fn()
    const notFoundError = Object.assign(new Error('session not found'), { status: 404 })
    getSessionMock.mockRejectedValue(notFoundError)
    getSessionMessagesMock.mockRejectedValue(notFoundError)

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
      expect.objectContaining({ name: 'APIError' }),
    )
  })


  it('preserves the SSE-delivered user message when the initial snapshot is stale-empty', async () => {
    // 新建会话竞态：SSE 已把用户消息落到 loading 中的会话，
    // 而初始快照读于发送提交之前（不含用户消息）——快照无权删掉它
    messageStoreMock.getSessionState.mockReturnValue({
      messages: [{ info: { id: 'msg-user', role: 'user', time: { created: 200, completed: 200 } }, parts: [] }],
      loadState: 'loading',
      isStale: false,
      isStreaming: false,
    })
    getSessionMessagesMock.mockResolvedValue([])

    const { result } = renderHook(() => useSessionManager({ sessionId: null, directory: '/workspace/demo' }))

    await result.current.loadSession('session-1')

    expect(messageStoreMock.setMessages).toHaveBeenCalledWith(
      'session-1',
      [expect.objectContaining({ info: expect.objectContaining({ id: 'msg-user' }) })],
      expect.anything(),
    )
  })

  it('drops local-only messages older than the snapshot newest while loading', async () => {
    // 截断窗口外的旧历史不走 SSE 补齐通道，加载期替换照常丢弃
    messageStoreMock.getSessionState.mockReturnValue({
      messages: [{ info: { id: 'msg-old', role: 'user', time: { created: 100, completed: 100 } }, parts: [] }],
      loadState: 'loading',
      isStale: false,
      isStreaming: false,
    })
    getSessionMessagesMock.mockResolvedValue([
      { info: { id: 'msg-new', role: 'user', time: { created: 200, completed: 200 } }, parts: [] },
    ])

    const { result } = renderHook(() => useSessionManager({ sessionId: null, directory: '/workspace/demo' }))

    await result.current.loadSession('session-1')

    expect(messageStoreMock.setMessages).toHaveBeenCalledWith(
      'session-1',
      [expect.objectContaining({ info: expect.objectContaining({ id: 'msg-new' }) })],
      expect.anything(),
    )
  })
})
