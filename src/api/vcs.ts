// ============================================
// VCS API — OpenCode v2 原生
//
// v2 的版本控制走 `vcs.*` 命名空间（均带 location）：
//   get    → { location, data: VcsInfo }        // { provider?, branch }
//   base   → { location, data }
//   status → { location, data: VcsFileStatus[] }
//   branch.list → { location, data }
//   diff   → { location, data: FileDiffInfo[] }
//
// 取代 v1 的 `file.status`；`diff` 的 patch 是 unified diff 文本。
// ============================================

import { getSDKClient } from './sdk'
import { locationParam } from './location'
import type { FileDiff } from './types'
import type { VcsDiffMode, VcsInfo } from '../types/api/vcs'
import { normalizeFileDiffs } from '../types/api/file'

/**
 * 获取 VCS 信息；VCS 不可用时返回 null。
 */
export async function getVcsInfo(directory?: string, serverId?: string): Promise<VcsInfo | null> {
  try {
    const sdk = getSDKClient(serverId)
    const result = await sdk.vcs.get({ location: locationParam(directory, serverId) })
    return result.data
  } catch {
    // VCS 不可用时返回 null
    return null
  }
}

/**
 * 获取 Git 或分支维度的 diff。
 */
export async function getVcsDiff(mode: VcsDiffMode, directory?: string, serverId?: string): Promise<FileDiff[]> {
  const sdk = getSDKClient(serverId)
  const result = await sdk.vcs.diff({ mode, location: locationParam(directory, serverId) })
  return normalizeFileDiffs(result.data)
}

/**
 * 获取当前分支名。
 *
 * v2 的 `vcs.get()` 里 `branch` 是 `{ current?, default? }`，
 * 当前分支直接读 `branch.current`。
 */
export async function getVcsBranch(directory?: string, serverId?: string): Promise<string | undefined> {
  const info = await getVcsInfo(directory, serverId)
  return info?.branch?.current
}

/**
 * 列出分支（v2 `vcs.branch.list`，支持 search/limit）。
 *
 * 官方用于新会话的分支选择器（new-session/workspace/controller.ts:154），
 * 我们挂在 worktree 创建表单的「基于分支」选择上。
 */
export async function getBranchList(
  directory?: string,
  search?: string,
  limit = 50,
  serverId?: string,
): Promise<string[]> {
  const sdk = getSDKClient(serverId)
  const result = await sdk.vcs.branch.list({
    location: locationParam(directory, serverId),
    search: search || undefined,
    limit,
  })
  return result.data
}
