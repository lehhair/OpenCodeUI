import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePermissionHandler } from './usePermissionHandler'

const { replyPermissionMock, getPendingPermissionsMock, getPendingFormsMock, replyFormMock, cancelFormMock, activeSessionStoreMock } =
  vi.hoisted(() => ({
    replyPermissionMock: vi.fn(() => Promise.resolve(true)),
    getPendingPermissionsMock: vi.fn(() => Promise.resolve([])),
    getPendingFormsMock: vi.fn((): Promise<unknown[]> => Promise.resolve([])),
    replyFormMock: vi.fn((..._args: unknown[]) => Promise.resolve(true)),
    cancelFormMock: vi.fn((..._args: unknown[]) => Promise.resolve(true)),
    activeSessionStoreMock: {
      resolvePendingRequest: vi.fn(),
    },
  }))

vi.mock('../api', () => ({
  replyPermission: replyPermissionMock,
  replyForm: replyFormMock,
  cancelForm: cancelFormMock,
  getPendingPermissions: getPendingPermissionsMock,
  getPendingForms: getPendingFormsMock,
}))

vi.mock('../store', () => ({
  activeSessionStore: activeSessionStoreMock,
}))

vi.mock('../utils', () => ({
  permissionErrorHandler: vi.fn(),
}))

describe('usePermissionHandler', () => {
  beforeEach(() => {
    replyPermissionMock.mockReset()
    replyPermissionMock.mockResolvedValue(true)
    getPendingPermissionsMock.mockReset()
    getPendingPermissionsMock.mockResolvedValue([])
    getPendingFormsMock.mockReset()
    getPendingFormsMock.mockResolvedValue([])
    replyFormMock.mockReset()
    replyFormMock.mockResolvedValue(true)
    activeSessionStoreMock.resolvePendingRequest.mockClear()
  })

  it('clears pending permission locally after a successful reply', async () => {
    const { result } = renderHook(() => usePermissionHandler('local'))

    act(() => {
      result.current.setPendingPermissionRequests([
        {
          id: 'perm-1',
          sessionID: 'session-1',
          action: 'bash',
          resources: ['npm test'],
          metadata: {},
        },
      ])
    })

    let success = false
    await act(async () => {
      success = await result.current.handlePermissionReply('perm-1', 'once', '/workspace', 'session-1')
    })

    expect(success).toBe(true)
    expect(replyPermissionMock).toHaveBeenCalledWith('perm-1', 'once', undefined, '/workspace', 'session-1', 'local')
    expect(result.current.pendingPermissionRequests).toEqual([])
    expect(activeSessionStoreMock.resolvePendingRequest).toHaveBeenCalledWith('perm-1')
  })

  it('clears stale permission when reply fails but server no longer lists it as pending', async () => {
    replyPermissionMock.mockRejectedValue(new Error('permission already handled'))
    getPendingPermissionsMock.mockResolvedValue([])
    const { result } = renderHook(() => usePermissionHandler('local'))

    act(() => {
      result.current.setPendingPermissionRequests([
        {
          id: 'perm-stale',
          sessionID: 'session-1',
          action: 'bash',
          resources: ['npm test'],
          metadata: {},
        },
      ])
    })

    let success = false
    await act(async () => {
      success = await result.current.handlePermissionReply('perm-stale', 'once', '/workspace', 'session-1')
    })

    expect(success).toBe(true)
    expect(getPendingPermissionsMock).toHaveBeenCalledWith('session-1', '/workspace', 'local')
    expect(result.current.pendingPermissionRequests).toEqual([])
    expect(activeSessionStoreMock.resolvePendingRequest).toHaveBeenCalledWith('perm-stale')
  })

  // 核心契约：请求必须打到「当前」绑定的服务器。
  // pane 首次渲染时活动服务器可能是 local，之后切到别的服务器（多服务器 / WSL sidecar 就绪后切回），
  // 一旦回调把 serverId 冻在旧值上，回复就会发到旧服务器：旧服务器报错、真实服务器仍 pending、
  // 弹窗消失后又冒出来，对话永远不前进。
  it('routes replies to the server the pane is bound to now, not the one captured at mount', async () => {
    const { result, rerender } = renderHook(({ serverId }) => usePermissionHandler(serverId), {
      initialProps: { serverId: 'local' },
    })

    rerender({ serverId: 'wsl:Ubuntu' })

    await act(async () => {
      // v2 的表单接口需要 sessionID（表单自带），答案是键值对象
      await result.current.handleFormReply(
        { id: 'form-1', sessionID: 'session-1', title: 'Pick', fields: [{ key: 'choice', type: 'string' }] },
        { choice: 'A' },
      )
      await result.current.handleFormCancel({ id: 'form-2', sessionID: 'session-1', title: 'Pick', fields: [{ key: 'choice', type: 'string' }] })
    })

    expect(replyFormMock).toHaveBeenCalledWith('session-1', 'form-1', { choice: 'A' }, 'wsl:Ubuntu')
    expect(cancelFormMock).toHaveBeenCalledWith('session-1', 'form-2', undefined, 'wsl:Ubuntu')
  })

  it('form 回复实际失败时保留本地条目（官方 form settle 同款）', async () => {
    replyFormMock.mockRejectedValue(new Error('network down'))
    getPendingFormsMock.mockResolvedValue([{ id: 'form-keep', sessionID: 'session-1', title: 'Pick', fields: [] }])
    const { result } = renderHook(() => usePermissionHandler('local'))

    act(() => {
      result.current.setPendingQuestionRequests([
        { id: 'form-keep', sessionID: 'session-1', title: 'Pick', fields: [{ key: 'choice', type: 'string' }] },
      ])
    })

    let success = true
    await act(async () => {
      success = await result.current.handleFormReply(
        { id: 'form-keep', sessionID: 'session-1', title: 'Pick', fields: [{ key: 'choice', type: 'string' }] },
        { choice: 'A' },
      )
    })

    // 回复失败 + 服务端仍 pending → 条目必须留在 UI 上
    expect(success).toBe(false)
    expect(result.current.pendingQuestionRequests).toHaveLength(1)
    expect(activeSessionStoreMock.resolvePendingRequest).not.toHaveBeenCalledWith('form-keep')
  })

  it('form 回复失败但服务端已不再 pending → 移除本地条目', async () => {
    replyFormMock.mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }))
    getPendingFormsMock.mockResolvedValue([])
    const { result } = renderHook(() => usePermissionHandler('local'))

    act(() => {
      result.current.setPendingQuestionRequests([
        { id: 'form-gone', sessionID: 'session-1', title: 'Pick', fields: [{ key: 'choice', type: 'string' }] },
      ])
    })

    let success = false
    await act(async () => {
      success = await result.current.handleFormReply(
        { id: 'form-gone', sessionID: 'session-1', title: 'Pick', fields: [{ key: 'choice', type: 'string' }] },
        { choice: 'A' },
      )
    })

    // 404（已被处理）→ 视为已解决，移除
    expect(success).toBe(true)
    expect(result.current.pendingQuestionRequests).toEqual([])
    expect(activeSessionStoreMock.resolvePendingRequest).toHaveBeenCalledWith('form-gone')
  })
})
