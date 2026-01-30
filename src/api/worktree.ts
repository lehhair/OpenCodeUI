// ============================================
// Worktree API - Git Worktree 管理
// ============================================

import { get, post, del } from './http'
import type { Worktree, WorktreeCreateInput, WorktreeRemoveInput, WorktreeResetInput } from '../types/api/worktree'
import { formatPathForApi } from '../utils/directoryUtils'

/**
 * 获取所有 worktree 列表
 */
export async function listWorktrees(directory?: string): Promise<Worktree[]> {
  return get<Worktree[]>('/experimental/worktree', { directory: formatPathForApi(directory) })
}

/**
 * 创建新的 worktree
 */
export async function createWorktree(
  params: WorktreeCreateInput,
  directory?: string
): Promise<Worktree> {
  return post<Worktree>('/experimental/worktree', { directory: formatPathForApi(directory) }, params)
}

/**
 * 删除 worktree
 */
export async function removeWorktree(
  params: WorktreeRemoveInput,
  directory?: string
): Promise<boolean> {
  return del<boolean>('/experimental/worktree', { directory: formatPathForApi(directory), ...params })
}

/**
 * 重置 worktree
 */
export async function resetWorktree(
  params: WorktreeResetInput,
  directory?: string
): Promise<void> {
  return post<void>('/experimental/worktree/reset', { directory: formatPathForApi(directory) }, params)
}
