// ============================================
// Worktree API Types
// 基于 OpenAPI 规范 v0.0.3
// ============================================

/**
 * Worktree 实体
 * 后端 schema: { name, branch, directory } 全部 required
 */
export interface Worktree {
  name: string
  branch: string
  directory: string
}

/**
 * Worktree 创建参数
 * 后端 schema: { name?, startCommand? }
 */
export interface WorktreeCreateInput {
  name?: string
  startCommand?: string
}

/**
 * Worktree 删除参数
 * 后端 schema: { directory } required
 */
export interface WorktreeRemoveInput {
  directory: string
}

/**
 * Worktree 重置参数
 * 后端 schema: { directory } required
 */
export interface WorktreeResetInput {
  directory: string
}
