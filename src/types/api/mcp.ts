// ============================================
// MCP Types — OpenCode v2 原生
//
// v2 把 MCP 服务器收敛为 `McpServer { name, status, integrationID? }`，
// 状态是判别联合（connected / pending / disabled / failed / needs_auth）。
// v1 的 needs_client_registration 在 v2 已不存在。
//
// 注意：不再有 McpStatusResponse 包装 —— `mcp.list()` 返回 { location, data }。
// ============================================

import type {
  McpListOutput,
  McpResourceCatalog,
  McpResourceCatalogOutput,
  McpServer,
  McpStatusConnected,
  McpStatusDisabled,
  McpStatusFailed,
  McpStatusNeedsAuth,
  McpStatusPending,
} from '@opencode/client/promise'

export type MCPStatusConnected = McpStatusConnected

export type MCPStatusPending = McpStatusPending

export type MCPStatusDisabled = McpStatusDisabled

export type MCPStatusFailed = McpStatusFailed

export type MCPStatusNeedsAuth = McpStatusNeedsAuth

/** MCP 服务器状态的判别联合 */
export type MCPStatus = McpServer['status']

/** MCP 服务器 */
export type MCPServer = McpServer

/** `mcp.list()` 的响应 */
export type MCPStatusResponse = McpListOutput

/** MCP 资源目录 */
export type MCPResource = McpResourceCatalog

export type MCPResourceMap = Record<string, MCPResource>

export type MCPResourceCatalogResponse = McpResourceCatalogOutput
