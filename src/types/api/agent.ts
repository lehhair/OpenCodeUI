// ============================================
// Agent API Types
// 基于 OpenAPI 规范
// ============================================

import type { ModelRef } from './common'
import type { PermissionAction } from './permission'

/**
 * Agent 模式
 */
export type AgentMode = 'subagent' | 'primary' | 'all'

/**
 * Agent 权限配置
 */
export interface AgentPermission {
  permission: string
  action: PermissionAction
  pattern: string
}

/**
 * Agent 实体
 */
export interface Agent {
  name: string
  description?: string
  mode: AgentMode
  native?: boolean
  hidden?: boolean
  temperature?: number
  topP?: number
  color?: string
  prompt?: string
  permission?: AgentPermission[]
  options?: Record<string, unknown>
  model?: ModelRef
}
