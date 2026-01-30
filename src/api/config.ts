// ============================================
// Config API - 配置管理
// ============================================

import { get, patch } from './http'
import { formatPathForApi } from '../utils/directoryUtils'
import type { Config } from '../types/api/config'

/**
 * 获取当前配置
 */
export async function getConfig(directory?: string): Promise<Config> {
  return get<Config>('/config', { directory: formatPathForApi(directory) })
}

/**
 * 更新配置
 */
export async function updateConfig(config: Partial<Config>, directory?: string): Promise<Config> {
  return patch<Config>('/config', { directory: formatPathForApi(directory) }, config)
}

/**
 * 获取 provider 配置列表
 */
export async function getProviderConfigs(directory?: string): Promise<Record<string, unknown>> {
  return get<Record<string, unknown>>('/config/providers', { directory: formatPathForApi(directory) })
}
