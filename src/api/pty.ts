// ============================================
// PTY API — OpenCode v2 原生
//
// ## v1 → v2 关键差异
//
//   - 状态字段：v1 有 `running` 或 `status`；v2 统一为 `status: 'running' | 'exited'`
//   - `pty.shells()` → **`config.shells()`**（v2 把可用 shell 移到 config）
//   - 所有方法带 `location`
//   - `pty.list` 返回 `{ location, data: Pty[] }`
//   - 新增 `pty.connect.token()` 用于获取连接票据
//
// WebSocket 连接 URL 的构造保持在本地（浏览器/桥接两种认证方式）。
// ============================================

import { getSDKClient } from './sdk'
import { locationParam } from './location'
import { getApiBaseUrl, buildQueryString } from './http'
import { formatPathForApi } from '../utils/directoryUtils'
import { serverStore } from '../store/serverStore'
import type { Pty, PtyCreateParams, PtyUpdateParams } from '../types/api/pty'

export interface ShellInfo {
  path: string
  name: string
  acceptable: boolean
}

interface PtyConnectUrlOptions {
  /**
   * false = 不在 URL 里放认证（Tauri bridge 通过 header 传）
   * true  = 在 URL 里放认证（浏览器原生 WebSocket 无法设 header）
   */
  includeAuthInUrl?: boolean
  cursor?: number
}

/**
 * 获取所有 PTY 会话列表。
 */
export async function listPtySessions(directory?: string, serverId?: string): Promise<Pty[]> {
  const sdk = getSDKClient(serverId)
  const result = await sdk.pty.list({ location: locationParam(directory, serverId) })
  return result.data
}

/**
 * 获取当前机器可用 shell 列表。
 *
 * v2 把该能力从 `pty.shells()` 移到 `config.shells()`。
 */
export async function listAvailableShells(_directory?: string, serverId?: string): Promise<ShellInfo[]> {
  const sdk = getSDKClient(serverId)
  const result = await sdk.config.shells()
  return result as unknown as ShellInfo[]
}

/**
 * 创建新的 PTY 会话。
 */
export async function createPtySession(
  params: PtyCreateParams,
  directory?: string,
  serverId?: string,
): Promise<Pty> {
  const sdk = getSDKClient(serverId)
  const result = await sdk.pty.create({ ...params, location: locationParam(directory, serverId) })
  return result.data
}

/**
 * 获取单个 PTY 会话信息。
 */
export async function getPtySession(ptyId: string, directory?: string, serverId?: string): Promise<Pty> {
  const sdk = getSDKClient(serverId)
  const result = await sdk.pty.get({ ptyID: ptyId, location: locationParam(directory, serverId) })
  return result.data
}

/**
 * 更新 PTY 会话（标题 / 尺寸）。
 */
export async function updatePtySession(
  ptyId: string,
  params: PtyUpdateParams,
  directory?: string,
  serverId?: string,
): Promise<Pty> {
  const sdk = getSDKClient(serverId)
  const result = await sdk.pty.update({
    ptyID: ptyId,
    title: params.title,
    size: params.size,
    location: locationParam(directory, serverId),
  })
  return result.data
}

/**
 * 删除 PTY 会话。
 */
export async function removePtySession(ptyId: string, directory?: string, serverId?: string): Promise<boolean> {
  const sdk = getSDKClient(serverId)
  await sdk.pty.remove({ ptyID: ptyId, location: locationParam(directory, serverId) })
  return true
}

/**
 * 获取 PTY 连接 WebSocket URL。
 *
 * 浏览器 WebSocket 不支持自定义 header，认证方式：
 * - 跨域：auth_token query parameter（与官方 opencode app 一致）
 * - 同源：浏览器会复用页面的 Basic auth 凭据
 * - Tauri bridge：不走这里，通过 Rust 的 HTTP header 传认证
 */
export function getPtyConnectUrl(
  ptyId: string,
  directory?: string,
  options?: PtyConnectUrlOptions,
  serverId?: string,
): string {
  const httpBase = getApiBaseUrl(serverId)
  const wsBase = httpBase.replace(/^http/, 'ws')
  const includeAuthInUrl = options?.includeAuthInUrl ?? true
  const cursor =
    typeof options?.cursor === 'number' && Number.isSafeInteger(options.cursor) && options.cursor >= 0
      ? options.cursor
      : undefined

  const auth = serverId ? serverStore.getServerAuth(serverId) : serverStore.getActiveAuth()
  const formatted = formatPathForApi(directory, serverId)

  // Tauri bridge 不需要在 URL 里放认证
  if (!includeAuthInUrl) {
    return `${wsBase}/pty/${ptyId}/connect${buildQueryString({ directory: formatted, cursor })}`
  }

  // 浏览器原生 WebSocket：
  // 跨域时用 auth_token query parameter + userinfo fallback
  // 同源时浏览器会自动复用 Basic auth
  const isCrossOrigin = (() => {
    try {
      return new URL(httpBase).origin !== location.origin
    } catch {
      return true
    }
  })()

  const queryParams: Record<string, string | number | undefined> = { directory: formatted, cursor }

  let wsUrl = wsBase
  if (auth?.password) {
    if (isCrossOrigin) {
      // auth_token = base64(username:password)，与官方 opencode app 一致
      queryParams.auth_token = btoa(`${auth.username}:${auth.password}`)
    }
    // 同时设 userinfo 作为 fallback（部分浏览器直连时能用）
    const creds = `${encodeURIComponent(auth.username)}:${encodeURIComponent(auth.password)}@`
    wsUrl = wsBase.replace('://', `://${creds}`)
  }

  return `${wsUrl}/pty/${ptyId}/connect${buildQueryString(queryParams)}`
}
