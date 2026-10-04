// ============================================
// PTY API — OpenCode v2 原生
//
// ## v1 → v2 关键差异
//
//   - 状态字段：v1 有 `running` 或 `status`；v2 统一为 `status: 'running' | 'exited'`
//   - `pty.shells()` → **`config.shells()`**（v2 把可用 shell 移到 config）
//   - 所有方法带 `location`
//   - `pty.list` 返回 `{ location, data: Pty[] }`
//   - WebSocket 连接走 `GET /api/pty/:id/connect`：
//     浏览器跨域无法带 Authorization header，官方客户端的流程是
//     先 `POST /api/pty/:id/connect-token`（带 `x-opencode-ticket: 1` 头）
//     换取一次性 ticket，再用 `?ticket=...` 连接
//     （见官方 packages/client/src/solid/pty.ts）
// ============================================

import { getSDKClient } from './sdk'
import { locationParam } from './location'
import { getApiBaseUrl } from './http'
import { formatPathForApi } from '../utils/directoryUtils'
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
 * v2 把该能力从 `pty.shells()` 移到 `config.shells()`，返回
 * `{ path, name, acceptable }[]`，与下面的 ShellInfo 结构完全一致，
 * 因此直接返回即可（之前多写了一次 `as unknown as ShellInfo[]`，
 * 等于把「形状是否一致」交给运行时赌——一旦 v2 改了字段就静默失效）。
 */
export async function listAvailableShells(_directory?: string, serverId?: string): Promise<ShellInfo[]> {
  const sdk = getSDKClient(serverId)
  return await sdk.config.shells()
}

/**
 * 创建新的 PTY 会话。
 */
export async function createPtySession(params: PtyCreateParams, directory?: string, serverId?: string): Promise<Pty> {
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
 * 获取 PTY 连接 WebSocket URL（v2 流程，异步）。
 *
 * v2 的 WS 端点是 `GET /api/pty/:id/connect`，认证方式：
 * - 浏览器（includeAuthInUrl=true）：先调 `pty.connect.token()` 换一次性
 *   ticket，拼到 `?ticket=` —— 与官方 opencode app 的 solid pty client 一致。
 *   （浏览器 WebSocket 无法设 header，v1 的 auth_token/userinfo 方式在 v2 不存在）
 * - Tauri bridge（includeAuthInUrl=false）：不带 ticket，由 Rust 侧在
 *   HTTP upgrade 请求上带 Authorization header（服务端无 ticket 时走常规鉴权）。
 */
export async function getPtyConnectUrl(
  ptyId: string,
  directory?: string,
  options?: PtyConnectUrlOptions,
  serverId?: string,
): Promise<string> {
  const httpBase = getApiBaseUrl(serverId)
  const includeAuthInUrl = options?.includeAuthInUrl ?? true
  const cursor =
    typeof options?.cursor === 'number' && Number.isSafeInteger(options.cursor) && options.cursor >= 0
      ? options.cursor
      : undefined
  const formatted = formatPathForApi(directory, serverId)

  const base = new URL(httpBase.endsWith('/') ? httpBase : `${httpBase}/`)
  const url = new URL(`api/pty/${encodeURIComponent(ptyId)}/connect`, base)
  if (formatted) url.searchParams.set('location[directory]', formatted)
  if (cursor !== undefined) url.searchParams.set('cursor', String(cursor))

  if (includeAuthInUrl) {
    // 浏览器路径：换取一次性 ticket（服务端强制 CORS preflight + origin 校验）
    const sdk = getSDKClient(serverId)
    const token = await sdk.pty.connect.token({
      ptyID: ptyId,
      location: locationParam(directory, serverId),
      'x-opencode-ticket': '1',
    })
    url.searchParams.set('ticket', token.data.ticket)
  }

  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}
