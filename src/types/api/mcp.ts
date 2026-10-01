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
  McpResource,
  McpResourceCatalog,
  McpResourceCatalogOutput,
  McpResourceTemplate,
  McpServer,
  McpStatusConnected,
  McpStatusDisabled,
  McpStatusFailed,
  McpStatusNeedsAuth,
  McpStatusPending,
  OpenCodeClient,
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

/**
 * `mcp.add()` 的服务器配置。
 *
 * 这里从**客户端方法签名**取，而不是从生成的 `McpAddInput` 取：
 * 生成的输入类型把字段标成 readonly，而客户端方法接受可变版本，
 * 直接复用生成类型会导致「readonly 不能赋给可变」的错误。
 */
export type McpServerConfig = Parameters<OpenCodeClient['mcp']['add']>[0]['config']

/** `mcp.list()` 的响应 */
export type MCPStatusResponse = McpListOutput

/** 单条 MCP 资源 */
export type MCPResourceEntry = McpResource

/** 单个 MCP 资源模板 */
export type MCPResourceTemplate = McpResourceTemplate

/** 某个服务器暴露的资源目录（v2 的 group 形状） */
export type MCPResource = McpResourceCatalog

export type MCPResourceMap = Record<string, MCPResource>

export type MCPResourceCatalogResponse = McpResourceCatalogOutput
