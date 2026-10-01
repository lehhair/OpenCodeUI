// ============================================
// Skill API — OpenCode v2 原生
//
// v1: `sdk.app.skills({ directory })` → Skill[]
// v2: `skill.list({ location })`      → { location, data: SkillInfo[] }
// ============================================

import { getSDKClient } from './sdk'
import { locationParam } from './location'
import type { Skill } from '../types/api/skill'

/**
 * 获取所有可用 Skills。
 */
export async function getSkills(directory?: string, serverId?: string): Promise<Skill[]> {
  const sdk = getSDKClient(serverId)
  const result = await sdk.skill.list({ location: locationParam(directory, serverId) })
  return result.data
}
