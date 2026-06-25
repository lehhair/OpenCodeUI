import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePermissionHandler } from './usePermissionHandler'

const { replyPermissionMock, activeSessionStoreMock } = vi.hoisted(() => ({
  replyPermissionMock: vi.fn(() => Promise.resolve(true)),
  activeSessionStoreMock: {
    resolvePendingRequest: vi.fn(),
  },
}))

vi.mock('../api', () => ({
  replyPermission: replyPermissionMock,
  replyQuestion: vi.fn(() => Promise.resolve(true)),
  rejectQuestion: vi.fn(() => Promise.resolve(true)),
  getPendingPermissions: vi.fn(() => Promise.resolve([])),
  getPendingQuestions: vi.fn(() => Promise.resolve([])),
}))

vi.mock('../store', () => ({
  activeSessionStore: activeSessionStoreMock,
}))

vi.mock('../utils', () => ({
  permissionErrorHandler: vi.fn(),
}))

describe('usePermissionHandler', () => {
  beforeEach(() => {
    replyPermissionMock.mockClear()
    activeSessionStoreMock.resolvePendingRequest.mockClear()
  })

  it('clears pending permission locally after a successful reply', async () => {
    const { result } = renderHook(() => usePermissionHandler())

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
    expect(replyPermissionMock).toHaveBeenCalledWith('perm-1', 'once', undefined, '/workspace', 'session-1')
    expect(result.current.pendingPermissionRequests).toEqual([])
    expect(activeSessionStoreMock.resolvePendingRequest).toHaveBeenCalledWith('perm-1')
  })
})
