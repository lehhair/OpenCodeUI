// ============================================
// PTY API - 终端管理
// ============================================

import { get, post, put, del } from './http'
import { formatPathForApi } from '../utils/directoryUtils'
import type { Pty, PtyCreateParams, PtyUpdateParams } from '../types/api/pty'

/**
 * 获取所有 PTY 会话列表
 */
export async function listPtySessions(directory?: string): Promise<Pty[]> {
  return get<Pty[]>('/pty', { directory: formatPathForApi(directory) })
}

/**
 * 创建新的 PTY 会话
 */
export async function createPtySession(
  params: PtyCreateParams,
  directory?: string
): Promise<Pty> {
  return post<Pty>('/pty', { directory: formatPathForApi(directory) }, params)
}

/**
 * 获取单个 PTY 会话信息
 */
export async function getPtySession(ptyId: string, directory?: string): Promise<Pty> {
  return get<Pty>(`/pty/${ptyId}`, { directory: formatPathForApi(directory) })
}

/**
 * 更新 PTY 会话
 */
export async function updatePtySession(
  ptyId: string,
  params: PtyUpdateParams,
  directory?: string
): Promise<Pty> {
  return put<Pty>(`/pty/${ptyId}`, { directory: formatPathForApi(directory) }, params)
}

/**
 * 删除 PTY 会话
 */
export async function removePtySession(ptyId: string, directory?: string): Promise<boolean> {
  return del<boolean>(`/pty/${ptyId}`, { directory: formatPathForApi(directory) })
}

/**
 * 获取 PTY 连接 URL
 */
export function getPtyConnectUrl(ptyId: string, directory?: string): string {
  const base = 'ws://127.0.0.1:4096'
  const formatted = formatPathForApi(directory)
  const params = formatted ? `?directory=${formatted}` : ''
  return `${base}/pty/${ptyId}/connect${params}`
}
