import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getPendingPermissions, listSavedPermissions, removeSavedPermission, replyPermission } from './permission'

const requestListMock = vi.fn()
const replyMock = vi.fn()
const savedListMock = vi.fn()
const savedRemoveMock = vi.fn()

vi.mock('./sdk', () => ({
  getSDKClient: () => ({
    permission: {
      request: { list: (...args: unknown[]) => requestListMock(...args) },
      reply: (...args: unknown[]) => replyMock(...args),
      saved: {
        list: (...args: unknown[]) => savedListMock(...args),
        remove: (...args: unknown[]) => savedRemoveMock(...args),
      },
    },
  }),
}))

beforeEach(() => {
  requestListMock.mockReset()
  replyMock.mockReset()
  savedListMock.mockReset()
  savedRemoveMock.mockReset()
})

// ============================================
// 列表：location 作用域 + V2 载荷 → 内部 V1 形状
// ============================================

describe('getPendingPermissions', () => {
  it('走 GET /api/permission/request（location 作用域）并把 V2 载荷映射回内部形状', async () => {
    requestListMock.mockResolvedValue({
      location: { directory: '/workspace' },
      data: [
        {
          id: 'per_1',
          sessionID: 'ses_1',
          action: 'bash',
          resources: ['npm test'],
          save: ['npm test'],
          metadata: { filepath: '/a.ts' },
          source: { type: 'tool', messageID: 'msg_1', id: 'call_1' },
        },
      ],
    })

    const requests = await getPendingPermissions('ses_ignored', '/workspace', 'local')

    // ⚠️ 端点没有 sessionId 过滤参数 → 形参不参与请求（传了也不发）
    expect(requestListMock).toHaveBeenCalledWith({ location: { directory: '/workspace' } })
    expect(requests).toEqual([
      {
        id: 'per_1',
        sessionID: 'ses_1',
        // V2 的 action/resources/save → 内部沿用 V1 的 permission/patterns/always
        permission: 'bash',
        patterns: ['npm test'],
        always: ['npm test'],
        metadata: { filepath: '/a.ts' },
        tool: { messageID: 'msg_1', callID: 'call_1' },
      },
    ])
  })

  it('source 不是 tool 时不产出 tool 字段', async () => {
    requestListMock.mockResolvedValue({
      location: { directory: '/workspace' },
      data: [{ id: 'per_2', sessionID: 'ses_1', action: 'edit', resources: [] }],
    })

    const requests = await getPendingPermissions(undefined, '/workspace')

    expect(requests[0].tool).toBeUndefined()
    expect(requests[0].always).toEqual([])
    expect(requests[0].metadata).toEqual({})
  })
})

// ============================================
// 回复：必须带 sessionID（V2 的路径参数）
// ============================================

describe('replyPermission', () => {
  it('传 {sessionID, requestID, decision, message}', async () => {
    replyMock.mockResolvedValue(undefined)

    const ok = await replyPermission('per_1', 'always', '因为需要', '/workspace', 'ses_1', 'local')

    expect(ok).toBe(true)
    expect(replyMock).toHaveBeenCalledWith({
      sessionID: 'ses_1',
      requestID: 'per_1',
      decision: 'always',
      message: '因为需要',
    })
  })

  it('decision 的三个枚举值原样透传（openapi: once | always | reject）', async () => {
    replyMock.mockResolvedValue(undefined)

    await replyPermission('per_1', 'once', undefined, undefined, 'ses_1')
    await replyPermission('per_1', 'reject', undefined, undefined, 'ses_1')

    expect(replyMock.mock.calls[0][0].decision).toBe('once')
    expect(replyMock.mock.calls[1][0].decision).toBe('reject')
  })

  it('缺 sessionID 时显式抛错（不能静默发一个必错的请求）', async () => {
    await expect(replyPermission('per_1', 'once')).rejects.toThrow(/sessionID/)
    expect(replyMock).not.toHaveBeenCalled()
  })

  it('复合 key（serverId::sessionId）解析出裸 id', async () => {
    replyMock.mockResolvedValue(undefined)

    await replyPermission('per_1', 'once', undefined, undefined, 'remote::ses_9')

    expect(replyMock).toHaveBeenCalledWith(expect.objectContaining({ sessionID: 'ses_9', requestID: 'per_1' }))
  })
})

// ============================================
// 已保存规则（V2 新增能力）
// ============================================

describe('saved 规则管理', () => {
  it('listSavedPermissions 返回裸数组，projectID 可选', async () => {
    savedListMock.mockResolvedValue([
      { id: 'psv_1', projectID: 'prj_1', action: 'bash', resource: 'npm test', time: { created: 1, updated: 1 } },
    ])

    const rules = await listSavedPermissions()

    expect(savedListMock).toHaveBeenCalledWith({ projectID: undefined })
    expect(rules).toHaveLength(1)
    expect(rules[0].resource).toBe('npm test')
  })

  it('listSavedPermissions 可只查某个项目', async () => {
    savedListMock.mockResolvedValue([])

    await listSavedPermissions({ projectID: 'prj_9' })

    expect(savedListMock).toHaveBeenCalledWith({ projectID: 'prj_9' })
  })

  it('removeSavedPermission 走 DELETE /api/permission/saved/{id}', async () => {
    savedRemoveMock.mockResolvedValue(undefined)

    await removeSavedPermission('psv_1')

    expect(savedRemoveMock).toHaveBeenCalledWith({ id: 'psv_1' })
  })
})
