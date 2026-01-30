// ============================================
// Agent API Functions
// 基于 OpenAPI: /agent 相关接口
// ============================================

import { get } from './http'
import { formatPathForApi } from '../utils/directoryUtils'
import type { ApiAgent } from './types'

/**
 * GET /agent - 获取 agent 列表
 */
export async function getAgents(directory?: string): Promise<ApiAgent[]> {
  return get<ApiAgent[]>('/agent', { directory: formatPathForApi(directory) })
}

/**
 * 获取可选择的 agent 列表（过滤掉 hidden 的）
 */
export async function getSelectableAgents(directory?: string): Promise<ApiAgent[]> {
  const agents = await getAgents(directory)
  return agents.filter(agent => !agent.hidden)
}
