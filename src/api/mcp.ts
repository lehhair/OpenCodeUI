// ============================================
// MCP API - Model Context Protocol 服务器管理
// ============================================

import { getSDKClient, unwrap } from './sdk'
import { formatPathForApi } from '../utils/directoryUtils'
import type { MCPStatusResponse, McpServerConfig } from '../types/api/mcp'

/**
 * 获取所有 MCP 服务器状态
 */
export async function getMcpStatus(directory?: string): Promise<MCPStatusResponse> {
  const sdk = getSDKClient()
  return unwrap(await sdk.mcp.status({ directory: formatPathForApi(directory) }))
}

/**
 * 添加 MCP 服务器
 */
export async function addMcpServer(name: string, config: McpServerConfig, directory?: string): Promise<void> {
  const sdk = getSDKClient()
  unwrap(
    await sdk.mcp.add({
      name,
      config: config as unknown as undefined,
      directory: formatPathForApi(directory),
    } as Parameters<typeof sdk.mcp.add>[0]),
  )
}

/**
 * 连接到 MCP 服务器
 */
export async function connectMcpServer(name: string, directory?: string): Promise<void> {
  const sdk = getSDKClient()
  unwrap(await sdk.mcp.connect({ name, directory: formatPathForApi(directory) }))
}

/**
 * 断开 MCP 服务器连接
 */
export async function disconnectMcpServer(name: string, directory?: string): Promise<void> {
  const sdk = getSDKClient()
  unwrap(await sdk.mcp.disconnect({ name, directory: formatPathForApi(directory) }))
}

/**
 * 开始 MCP 认证流程
 */
export async function startMcpAuth(name: string, directory?: string): Promise<{ url: string }> {
  const sdk = getSDKClient()
  const result = unwrap(await sdk.mcp.auth.start({ name, directory: formatPathForApi(directory) }))
  // SDK 返回 { authorizationUrl: string }，转换为我们期望的 { url: string }
  return { url: result.authorizationUrl }
}

/**
 * 移除 MCP 认证
 */
export async function removeMcpAuth(name: string, directory?: string): Promise<void> {
  const sdk = getSDKClient()
  unwrap(await sdk.mcp.auth.remove({ name, directory: formatPathForApi(directory) }))
}

/**
 * 完成 MCP OAuth 认证（使用授权码）
 */
export async function completeMcpAuth(name: string, code: string, directory?: string): Promise<void> {
  const sdk = getSDKClient()
  unwrap(await sdk.mcp.auth.callback({ name, code, directory: formatPathForApi(directory) }))
}

/**
 * 启动完整的 OAuth 认证流程
 */
export async function authenticateMcp(name: string, directory?: string): Promise<void> {
  const sdk = getSDKClient()
  unwrap(await sdk.mcp.auth.authenticate({ name, directory: formatPathForApi(directory) }))
}
