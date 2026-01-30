// ============================================
// Permission & Question API Types
// 基于 OpenAPI 规范
// ============================================

// ============================================
// Permission Types
// ============================================

/**
 * 权限动作
 */
export type PermissionAction = 'allow' | 'ask' | 'deny'

/**
 * 权限规则
 */
export interface PermissionRule {
  permission: string
  action: PermissionAction
  pattern: string
}

/**
 * 权限规则集
 */
export interface PermissionRuleset {
  rules: PermissionRule[]
}

/**
 * 权限请求工具信息
 */
export interface PermissionToolInfo {
  messageID: string
  callID: string
}

/**
 * 权限请求
 */
export interface PermissionRequest {
  id: string
  sessionID: string
  permission: string
  patterns: string[]
  metadata: Record<string, unknown>
  always: string[]
  tool?: PermissionToolInfo
}

/**
 * 权限回复类型
 */
export type PermissionReply = 'once' | 'always' | 'reject'

// ============================================
// Question Types
// ============================================

/**
 * 问题选项
 */
export interface QuestionOption {
  label: string
  description: string
}

/**
 * 问题信息
 */
export interface QuestionInfo {
  question: string
  header: string
  options: QuestionOption[]
  multiple?: boolean
  custom?: boolean
}

/**
 * 问题请求
 */
export interface QuestionRequest {
  id: string
  sessionID: string
  questions: QuestionInfo[]
  tool?: PermissionToolInfo
}

/**
 * 问题回答
 */
export type QuestionAnswer = string[]
