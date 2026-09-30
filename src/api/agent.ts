// ============================================
// Agent API Functions
// 基于 @opencode/client（OpenCode V2）: GET /api/agent
// ============================================

import { getSDKClient } from './sdk'
import { locationInput, toInternalAgent } from './v2Convert'
import type { ApiAgent } from './types'

/**
 * 获取 agent 列表
 *
 * V1: `sdk.app.agents({ directory })` → Agent[]
 * V2: `sdk.agent.list({ location })`  → { location, data: Agent.Info[] }
 */
export async function getAgents(directory?: string, serverId?: string): Promise<ApiAgent[]> {
  const sdk = getSDKClient(serverId)
  const result = await sdk.agent.list(locationInput(directory, serverId, 'GET /api/agent'))
  return result.data.map(toInternalAgent)
}

/**
 * 获取可选择的 agent 列表（过滤掉 hidden 的）
 */
export async function getSelectableAgents(directory?: string, serverId?: string): Promise<ApiAgent[]> {
  const agents = await getAgents(directory, serverId)
  return agents.filter(agent => !agent.hidden)
}
