// ============================================
// Agent API — OpenCode v2 原生
//
// v1: `sdk.app.agents({ directory })`  → Agent[]
// v2: `agent.list({ location })`       → { location, data: AgentInfo[] }
// ============================================

import { getSDKClient } from './sdk'
import { locationParam } from './location'
import type { Agent } from '../types/api/agent'

/**
 * 获取 agent 列表
 */
export async function getAgents(directory?: string, serverId?: string): Promise<Agent[]> {
  const sdk = getSDKClient(serverId)
  const result = await sdk.agent.list({ location: locationParam(directory, serverId) })
  return result.data
}

/**
 * 获取可选择的 agent 列表（过滤掉 hidden 的）
 */
export async function getSelectableAgents(directory?: string, serverId?: string): Promise<Agent[]> {
  const agents = await getAgents(directory, serverId)
  return agents.filter(agent => !agent.hidden)
}

/**
 * 按 id 获取单个 agent
 */
export async function getAgent(agentID: string, directory?: string, serverId?: string): Promise<Agent | undefined> {
  const agents = await getAgents(directory, serverId)
  return agents.find(agent => agent.id === agentID || agent.name === agentID)
}
