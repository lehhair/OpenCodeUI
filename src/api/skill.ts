// ============================================
// Skill API
// ============================================

import { getSDKClient, unwrap } from './sdk'
import { formatPathForApi } from '../utils/directoryUtils'
import type { SkillList } from '../types/api/skill'

/**
 * 获取所有可用 Skills
 */
export async function getSkills(directory?: string): Promise<SkillList> {
  const sdk = getSDKClient()
  return unwrap(await sdk.app.skills({ directory: formatPathForApi(directory) }))
}
