// ============================================
// Agent Types — OpenCode v2 原生
//
// v1 的 Agent 有 mode/permission 等散字段；v2 收敛为 AgentInfo，
// 权限统一为 PermissionRuleset。
// ============================================

import type { AgentInfo, PermissionRuleset } from '@opencode/client/promise'

export type Agent = AgentInfo

/** Agent 运行模式 */
export type AgentMode = AgentInfo['mode']

/** Agent 权限规则集 */
export type AgentPermission = PermissionRuleset
