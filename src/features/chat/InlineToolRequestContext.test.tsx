/**
 * InlineToolRequestContext 契约测试
 *
 * 核心契约：task 工具匹配子 session 的内嵌请求时，复合 key 必须用「pane 绑定的服务器」合成。
 * 工具 metadata 里的 sessionId 是原始 id，若用 splitSessionKey 猜服务器会回退到全局活动服务器，
 * 而 childSessionStore 按真实服务器注册子 session —— 多服务器 / WSL 下孙 session 的请求
 * 永远关联不到 task 工具，内嵌权限 UI 不出现。
 *
 * ⚠️ 阶段 3b：question 内联通道已删除（表单统一走底部 FormDialog），
 *   本文件只保留权限请求的契约测试。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { findPermissionRequestForTool } from './InlineToolRequestContext'
import type { ApiPermissionRequest } from '../../api'

const { childSessionStoreMock } = vi.hoisted(() => {
  // 仿真 childSessionStore 的存储语义：key 一律是复合 `${serverId}::${sessionId}`，按父子链递归查找
  const parentByKey = new Map<string, string>()
  const isChildOf = (sessionId: string, parentId: string): boolean => {
    const parent = parentByKey.get(sessionId)
    if (!parent) return false
    return parent === parentId || isChildOf(parent, parentId)
  }
  return {
    childSessionStoreMock: {
      register(childKey: string, parentKey: string) {
        parentByKey.set(childKey, parentKey)
      },
      reset() {
        parentByKey.clear()
      },
      isChildOf,
    },
  }
})

vi.mock('../../store', () => ({
  childSessionStore: childSessionStoreMock,
}))

// 全局活动服务器固定为 local：与 pane 绑定的 wsl:Ubuntu 形成错位，逼出「猜服务器」的错误路径
vi.mock('../../store/serverStore', () => ({
  serverStore: {
    getActiveServerId: () => 'local',
  },
}))

describe('task 工具按 pane 服务器匹配子 session 请求', () => {
  const PANE_SERVER = 'wsl:Ubuntu'

  beforeEach(() => {
    childSessionStoreMock.reset()
    // task 的直接子 session 与孙 session 都注册在 pane 真实所属服务器下
    childSessionStoreMock.register(`${PANE_SERVER}::ses_child`, `${PANE_SERVER}::ses_parent`)
    childSessionStoreMock.register(`${PANE_SERVER}::ses_grand`, `${PANE_SERVER}::ses_child`)
  })

  it('孙 session 发出的权限请求能匹配到 task 工具（全局活动服务器是 local，pane 绑定 wsl:Ubuntu）', () => {
    const permission: ApiPermissionRequest = {
      id: 'perm-1',
      sessionID: `${PANE_SERVER}::ses_grand`,
      permission: 'bash',
      patterns: ['npm test'],
      metadata: {},
      always: [],
    }

    const matched = findPermissionRequestForTool([permission], 'call-unknown', {
      sessionKey: 'ses_child',
      serverId: PANE_SERVER,
    })

    expect(matched).toBe(permission)
  })
})
