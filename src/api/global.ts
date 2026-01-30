// ============================================
// Global API - 全局管理
// ============================================

import { get, post } from './http'
import { formatPathForApi } from '../utils/directoryUtils'

export interface HealthInfo {
  healthy: boolean
  version: string
}

/**
 * 获取服务器健康状态
 */
export async function getHealth(): Promise<HealthInfo> {
  return get<HealthInfo>('/global/health')
}

/**
 * 释放所有资源
 */
export async function disposeGlobal(): Promise<boolean> {
  return post<boolean>('/global/dispose')
}

/**
 * 释放当前实例
 */
export async function disposeInstance(directory?: string): Promise<boolean> {
  return post<boolean>('/instance/dispose', { directory: formatPathForApi(directory) })
}
