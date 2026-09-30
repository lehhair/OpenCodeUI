import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePermissionHandler } from './usePermissionHandler'

const { replyPermissionMock, getPendingPermissionsMock, replyFormMock, cancelFormMock, activeSessionStoreMock } =
  vi.hoisted(() => ({
    replyPermissionMock: vi.fn(() => Promise.resolve(true)),
    getPendingPermissionsMock: vi.fn(() => Promise.resolve([])),
    replyFormMock: vi.fn((..._args: unknown[]) => Promise.resolve(undefined)),
    cancelFormMock: vi.fn((..._args: unknown[]) => Promise.resolve(undefined)),
    activeSessionStoreMock: {
      resolvePendingRequest: vi.fn(),
    },
  }))

vi.mock('../api', () => ({
  replyPermission: replyPermissionMock,
  replyForm: replyFormMock,
  cancelForm: cancelFormMock,
  getPendingPermissions: getPendingPermissionsMock,
  listPendingForms: vi.fn(() => Promise.resolve([])),
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
    replyFormMock.mockReset()
    replyFormMock.mockResolvedValue(undefined)
    cancelFormMock.mockReset()
    cancelFormMock.mockResolvedValue(undefined)
    activeSessionStoreMock.resolvePendingRequest.mockClear()
  })

  it('clears pending permission locally after a successful reply', async () => {
    const { result } = renderHook(() => usePermissionHandler('local'))

    act(() => {
      result.current.setPendingPermissionRequests([
        {
          id: 'perm-1',
          sessionID: 'session-1',
          permission: 'bash',
          patterns: ['npm test'],
          metadata: {},
          always: [],
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
          permission: 'bash',
          patterns: ['npm test'],
          metadata: {},
          always: [],
        },
      ])
    })

    let success = false
    await act(async () => {
      success = await result.current.handlePermissionReply('perm-stale', 'once', '/workspace', 'session-1')
    })

    expect(success).toBe(true)
    // ⚠️ V2 的列表端点**没有** sessionId 过滤参数 → 永远传 undefined（拉全量后本地比对）
    expect(getPendingPermissionsMock).toHaveBeenCalledWith(undefined, '/workspace', 'local')
    expect(result.current.pendingPermissionRequests).toEqual([])
    expect(activeSessionStoreMock.resolvePendingRequest).toHaveBeenCalledWith('perm-stale')
  })

  // 核心契约：请求必须打到「当前」绑定的服务器。
  // pane 首次渲染时活动服务器可能是 local，之后切到别的服务器（多服务器 / WSL sidecar 就绪后切回），
  // 一旦回调把 serverId 冻在旧值上，回复就会发到旧服务器：旧服务器报错、真实服务器仍 pending、
  // 弹窗消失后又冒出来，对话永远不前进。
  it('routes form replies to the server the pane is bound to now, not the one captured at mount', async () => {
    const { result, rerender } = renderHook(({ serverId }) => usePermissionHandler(serverId), {
      initialProps: { serverId: 'local' },
    })

    rerender({ serverId: 'wsl:Ubuntu' })

    await act(async () => {
      await result.current.handleFormReply('frm_1', { q: 'A' }, 'ses_1', '/home/u/project')
      await result.current.handleFormCancel('frm_2', 'ses_1', '/home/u/project')
    })

    expect(replyFormMock).toHaveBeenCalledWith('ses_1', 'frm_1', { q: 'A' }, '/home/u/project', 'wsl:Ubuntu')
    expect(cancelFormMock).toHaveBeenCalledWith('ses_1', 'frm_2', '/home/u/project', 'wsl:Ubuntu')
  })

  // 表单回复失败时**不能乐观移除**：可能是服务端校验拒绝（answer 类型不对），
  // 此时表单仍然 pending，移除会让用户再也看不到它、对话卡死。
  it('keeps the form in the pending list when the reply fails', async () => {
    replyFormMock.mockRejectedValue(new Error('invalid answer'))
    const { result } = renderHook(() => usePermissionHandler('local'))

    act(() => {
      result.current.setPendingForms([
        { id: 'frm_keep', sessionID: 'ses_1', title: 'T', fields: [{ key: 'q', type: 'string' }] },
      ])
    })

    let success = true
    await act(async () => {
      success = await result.current.handleFormReply('frm_keep', { q: 'A' }, 'ses_1', '/workspace')
    })

    expect(success).toBe(false)
    expect(result.current.pendingForms).toHaveLength(1)
    expect(activeSessionStoreMock.resolvePendingRequest).not.toHaveBeenCalled()
  })

  it('clears the form locally after a successful reply', async () => {
    const { result } = renderHook(() => usePermissionHandler('local'))

    act(() => {
      result.current.setPendingForms([
        { id: 'frm_ok', sessionID: 'ses_1', title: 'T', fields: [{ key: 'q', type: 'string' }] },
      ])
    })

    let success = false
    await act(async () => {
      success = await result.current.handleFormReply('frm_ok', { q: 'A' }, 'ses_1', '/workspace')
    })

    expect(success).toBe(true)
    expect(result.current.pendingForms).toEqual([])
    expect(activeSessionStoreMock.resolvePendingRequest).toHaveBeenCalledWith('frm_ok')
  })
})
