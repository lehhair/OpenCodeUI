// ============================================
// Worktree API Types
// 基于 OpenAPI 规范
// ============================================

/**
 * Worktree 实体
 */
export interface Worktree {
  id: string
  path: string
  branch?: string
  locked?: boolean
  prunable?: boolean
}

/**
 * Worktree 创建参数
 */
export interface WorktreeCreateInput {
  branch?: string
  path?: string
  sessionID?: string
}

/**
 * Worktree 删除参数
 */
export interface WorktreeRemoveInput {
  path: string
  force?: boolean
}

/**
 * Worktree 重置参数
 */
export interface WorktreeResetInput {
  path: string
  hard?: boolean
}
