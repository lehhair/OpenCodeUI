// ============================================
// Global API - 全局管理
// ============================================

import { getSDKClient, unwrap } from './sdk'
import { formatPathForApi } from '../utils/directoryUtils'

export interface HealthInfo {
  healthy: boolean
  version: string
}

/**
 * 获取服务器健康状态
 */
export async function getHealth(): Promise<HealthInfo> {
  const sdk = getSDKClient()
  return unwrap(await sdk.global.health())
}

/**
 * 释放所有资源
 */
export async function disposeGlobal(): Promise<boolean> {
  const sdk = getSDKClient()
  unwrap(await sdk.global.dispose())
  return true
}

/**
 * 释放当前实例
 */
export async function disposeInstance(directory?: string): Promise<boolean> {
  const sdk = getSDKClient()
  unwrap(await sdk.instance.dispose({ directory: formatPathForApi(directory) }))
  return true
}
