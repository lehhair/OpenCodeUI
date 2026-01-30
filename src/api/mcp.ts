// ============================================
// MCP API - Model Context Protocol 服务器管理
// ============================================

import { get, post, del } from './http'
import { formatPathForApi } from '../utils/directoryUtils'
import type { MCPStatusResponse, MCPResource } from '../types/api/mcp'

/**
 * 获取所有 MCP 服务器状态
 */
export async function getMcpStatus(directory?: string): Promise<MCPStatusResponse> {
  return get<MCPStatusResponse>('/mcp', { directory: formatPathForApi(directory) })
}

/**
 * 添加 MCP 服务器
 */
export async function addMcpServer(
  name: string,
  config: {
    type: 'local' | 'oauth' | 'remote'
    command?: string
    args?: string[]
    url?: string
    env?: Record<string, string>
  },
  directory?: string
): Promise<void> {
  return post<void>('/mcp', { directory: formatPathForApi(directory) }, { name, ...config })
}

/**
 * 连接到 MCP 服务器
 */
export async function connectMcpServer(name: string, directory?: string): Promise<void> {
  return post<void>(`/mcp/${name}/connect`, { directory: formatPathForApi(directory) })
}

/**
 * 断开 MCP 服务器连接
 */
export async function disconnectMcpServer(name: string, directory?: string): Promise<void> {
  return post<void>(`/mcp/${name}/disconnect`, { directory: formatPathForApi(directory) })
}

/**
 * 开始 MCP 认证流程
 */
export async function startMcpAuth(name: string, directory?: string): Promise<{ url: string }> {
  return post<{ url: string }>(`/mcp/${name}/auth`, { directory: formatPathForApi(directory) })
}

/**
 * 移除 MCP 认证
 */
export async function removeMcpAuth(name: string, directory?: string): Promise<void> {
  return del<void>(`/mcp/${name}/auth`, { directory: formatPathForApi(directory) })
}

/**
 * 获取 MCP 资源列表
 */
export async function getMcpResources(directory?: string): Promise<MCPResource[]> {
  return get<MCPResource[]>('/experimental/resource', { directory: formatPathForApi(directory) })
}
