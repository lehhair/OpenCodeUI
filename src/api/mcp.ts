// ============================================
// MCP API — OpenCode v2 原生
//
// ## v1 → v2 关键差异
//
//   - `mcp.status()`  → `mcp.list()`，返回 `{ location, data: McpServer[] }`，
//     元素是 `{ name, status, integrationID? }`（v1 是 name → status 的 map）
//   - 服务器标识字段是 **`server`**（v1 用 `name`）
//   - 新增 `mcp.add` / `mcp.remove` / `mcp.connect` / `mcp.disconnect`
//   - 资源目录：v1 `experimental.resource.list()` → v2 `mcp.resource.catalog()`，
//     返回 `{ resources[], templates[] }`
//   - v1 的 `mcp.auth.*`（start/remove/callback/authenticate）在 v2 不存在；
//     远程 MCP 的认证改由 `integration.*` / `credential.*` 承担
// ============================================

import { getSDKClient } from './sdk'
import { locationParam } from './location'
import type { MCPResourceMap, MCPStatus, MCPServer, McpServerConfig } from '../types/api/mcp'

/**
 * 获取所有 MCP 服务器状态。
 *
 * v2 的 `mcp.list` 返回 `{ location, data }`；这里返回 data（服务器数组），
 * 避免把响应信封泄漏到调用点。
 */
export async function getMcpStatus(directory?: string, serverId?: string): Promise<MCPServer[]> {
  const sdk = getSDKClient(serverId)
  const result = await sdk.mcp.list({ location: locationParam(directory, serverId) })
  return result.data
}

/**
 * 获取 MCP 服务器列表（`getMcpStatus` 的别名，语义更直白）。
 */
export async function listMcpServers(directory?: string, serverId?: string): Promise<MCPServer[]> {
  return await getMcpStatus(directory, serverId)
}

/**
 * 按名字取单个 MCP 服务器状态。
 */
export async function getMcpServerStatus(
  name: string,
  directory?: string,
  serverId?: string,
): Promise<MCPStatus | undefined> {
  const servers = await listMcpServers(directory, serverId)
  return servers.find(server => server.name === name)?.status
}

/**
 * 获取已连接 MCP 服务器暴露的资源。
 *
 * v2 的 catalog 返回 `{ resources, templates }`，这里按 server 名归组，
 * 保持 v1 的 `Record<serverName, resource>` 形状。
 */
export async function getMcpResources(directory?: string, serverId?: string): Promise<MCPResourceMap> {
  const sdk = getSDKClient(serverId)
  const result = await sdk.mcp.resource.catalog({ location: locationParam(directory, serverId) })

  const map: MCPResourceMap = {}
  for (const entry of result.data.resources) {
    map[entry.server] = {
      resources: [...(map[entry.server]?.resources ?? []), entry],
      templates: map[entry.server]?.templates ?? [],
    }
  }
  for (const entry of result.data.templates) {
    map[entry.server] = {
      resources: map[entry.server]?.resources ?? [],
      templates: [...(map[entry.server]?.templates ?? []), entry],
    }
  }
  return map
}

/**
 * 添加 MCP 服务器。
 *
 * v2 的配置形状与 v1 不同（local 用 command 数组、remote 用 url），
 * 由调用点按 McpServerConfig 提供。
 */
export async function addMcpServer(
  name: string,
  config: McpServerConfig,
  directory?: string,
  serverId?: string,
): Promise<void> {
  const sdk = getSDKClient(serverId)
  await sdk.mcp.add({ server: name, config, location: locationParam(directory, serverId) })
}

/**
 * 移除 MCP 服务器（v2 新增）。
 */
export async function removeMcpServer(name: string, directory?: string, serverId?: string): Promise<void> {
  const sdk = getSDKClient(serverId)
  await sdk.mcp.remove({ server: name, location: locationParam(directory, serverId) })
}

/**
 * 连接到 MCP 服务器
 */
export async function connectMcpServer(name: string, directory?: string, serverId?: string): Promise<void> {
  const sdk = getSDKClient(serverId)
  await sdk.mcp.connect({ server: name, location: locationParam(directory, serverId) })
}

/**
 * 断开 MCP 服务器连接
 */
export async function disconnectMcpServer(name: string, directory?: string, serverId?: string): Promise<void> {
  const sdk = getSDKClient(serverId)
  await sdk.mcp.disconnect({ server: name, location: locationParam(directory, serverId) })
}
