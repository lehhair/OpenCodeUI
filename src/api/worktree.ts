// ============================================
// Worktree API — OpenCode v2 原生
//
// ## v1 → v2 关键差异
//
//   - 作用域从 `directory` 改为 **`projectID`**
//   - `list()` 返回 `WorktreeDirectory[]`（`{ directory, strategy? }`），
//     **不是字符串数组**（v1 返回 string[]）
//   - `create()` 按 projectID 创建，返回 `WorktreeInfo`
//   - `reset()` 在 v2 **已移除**；新增 `refresh()`
//   - `remove()` 按 directory 删除
// ============================================

import { getSDKClient } from './sdk'
import type {
  Worktree,
  WorktreeCreateInput,
  WorktreeDirectory,
  WorktreeRemoveInput,
} from '../types/api/worktree'

/**
 * 获取项目下的 worktree 列表。
 */
export async function listWorktreeEntries(projectID: string, serverId?: string): Promise<WorktreeDirectory[]> {
  const sdk = getSDKClient(serverId)
  return await sdk.worktree.list({ projectID })
}

/**
 * 获取 worktree 目录路径列表（便捷方法）。
 */
export async function listWorktrees(projectID: string, serverId?: string): Promise<string[]> {
  const entries = await listWorktreeEntries(projectID, serverId)
  return entries.map(entry => entry.directory)
}

/**
 * 创建新的 worktree。
 */
export async function createWorktree(params: WorktreeCreateInput, serverId?: string): Promise<Worktree> {
  const sdk = getSDKClient(serverId)
  return await sdk.worktree.create(params)
}

/**
 * 删除 worktree。
 */
export async function removeWorktree(params: WorktreeRemoveInput, serverId?: string): Promise<boolean> {
  const sdk = getSDKClient(serverId)
  await sdk.worktree.remove(params)
  return true
}

/**
 * 重新扫描 worktree（v2 新增，取代 v1 的 reset）。
 */
export async function refreshWorktrees(projectID: string, serverId?: string): Promise<void> {
  const sdk = getSDKClient(serverId)
  await sdk.worktree.refresh({ projectID })
}
