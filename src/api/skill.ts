// ============================================
// Skill API
// 基于 @opencode/client（OpenCode V2）: GET /api/skill
// ============================================

import { getSDKClient } from './sdk'
import { locationInput, toInternalSkill } from './v2Convert'
import type { SkillList } from '../types/api/skill'

/**
 * 获取所有可用 Skills
 *
 * V1: `sdk.app.skills({ directory })` → AppSkillsResponse（数组）
 * V2: `sdk.skill.list({ location })`  → { location, data: Skill.Info[] }
 */
export async function getSkills(directory?: string, serverId?: string): Promise<SkillList> {
  const sdk = getSDKClient(serverId)
  const result = await sdk.skill.list(locationInput(directory, serverId, 'GET /api/skill'))
  return result.data.map(toInternalSkill)
}
