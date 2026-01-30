// ============================================
// Tool API - 工具管理
// ============================================

import { get } from './http'
import { formatPathForApi } from '../utils/directoryUtils'
import type { ToolIDs, ToolList } from '../types/api/tool'

/**
 * 获取工具 ID 列表
 */
export async function getToolIds(directory?: string): Promise<ToolIDs> {
  return get<ToolIDs>('/experimental/tool/ids', { directory: formatPathForApi(directory) })
}

/**
 * 获取工具列表（带详细信息）
 */
export async function getTools(directory?: string): Promise<ToolList> {
  return get<ToolList>('/experimental/tool', { directory: formatPathForApi(directory) })
}
