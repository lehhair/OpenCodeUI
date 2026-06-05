// ============================================
// VCS API - 版本控制信息
// ============================================

import { getSDKClient, unwrap } from './sdk'
import type { FileDiff } from './types'
import type { VcsDiffMode, VcsInfo } from '../types/api/vcs'
import { formatPathForApi } from '../utils/directoryUtils'
import { normalizeFileDiffs } from '../types/api/file'

/**
 * 获取 VCS 信息
 */
export async function getVcsInfo(directory?: string): Promise<VcsInfo | null> {
  try {
    const sdk = getSDKClient()
    return unwrap(await sdk.vcs.get({ directory: formatPathForApi(directory) }))
  } catch {
    // VCS 不可用时返回 null
    return null
  }
}

/**
 * 获取 Git 或分支维度的 diff
 */
export async function getVcsDiff(mode: VcsDiffMode, directory?: string): Promise<FileDiff[]> {
  const sdk = getSDKClient()
  return normalizeFileDiffs(unwrap(await sdk.vcs.diff({ mode, directory: formatPathForApi(directory) })))
}
