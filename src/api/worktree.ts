// ============================================
// Worktree API - Git Worktree 管理
// 基于 OpenAPI 规范 v0.0.3
// ============================================

import { get, post, del } from './http'
import type { Worktree, WorktreeCreateInput, WorktreeRemoveInput, WorktreeResetInput } from '../types/api/worktree'
import { formatPathForApi } from '../utils/directoryUtils'

/**
 * 获取所有 worktree 列表
 * GET /experimental/worktree -> string[]
 */
export async function listWorktrees(directory?: string): Promise<string[]> {
  return get<string[]>('/experimental/worktree', { directory: formatPathForApi(directory) })
}

/**
 * 创建新的 worktree
 * POST /experimental/worktree -> Worktree
 */
export async function createWorktree(
  params: WorktreeCreateInput,
  directory?: string
): Promise<Worktree> {
  return post<Worktree>('/experimental/worktree', { directory: formatPathForApi(directory) }, params)
}

/**
 * 删除 worktree
 * DELETE /experimental/worktree -> boolean
 */
export async function removeWorktree(
  params: WorktreeRemoveInput,
  directory?: string
): Promise<boolean> {
  return del<boolean>('/experimental/worktree', { directory: formatPathForApi(directory) }, params)
}

/**
 * 重置 worktree
 * POST /experimental/worktree/reset -> boolean
 */
export async function resetWorktree(
  params: WorktreeResetInput,
  directory?: string
): Promise<boolean> {
  return post<boolean>('/experimental/worktree/reset', { directory: formatPathForApi(directory) }, params)
}
