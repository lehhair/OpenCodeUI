// ============================================
// Directories API - 持久化目录数据到服务端
// ============================================

import { get, post } from './http'

/**
 * 服务端目录数据结构
 */
export interface DirectoriesData {
  savedDirectories: Array<{ path: string; name: string; addedAt: number }>
  recentProjects: Record<string, number>
}

/**
 * GET /api/directories — 获取服务端目录状态
 * Returns null on failure (graceful degradation)
 */
export async function getDirectories(): Promise<DirectoriesData | null> {
  try {
    return await get<DirectoriesData>('/directories')
  } catch {
    return null
  }
}

/**
 * POST /api/directories — 保存完整目录状态到服务端
 * Returns {ok: true} on success, null on failure (fire-and-forget safe)
 */
export async function saveDirectories(data: DirectoriesData): Promise<{ ok: boolean } | null> {
  try {
    return await post<{ ok: boolean }>('/directories', {}, data)
  } catch {
    return null
  }
}
