// ============================================
// MCP (Model Context Protocol) API Types
// 基于 OpenAPI 规范
// ============================================

/**
 * MCP 已连接状态
 */
export interface MCPStatusConnected {
  type: 'connected'
  tools: string[]
  resources: string[]
  prompts: string[]
}

/**
 * MCP 已禁用状态
 */
export interface MCPStatusDisabled {
  type: 'disabled'
}

/**
 * MCP 失败状态
 */
export interface MCPStatusFailed {
  type: 'failed'
  error: string
}

/**
 * MCP 需要认证状态
 */
export interface MCPStatusNeedsAuth {
  type: 'needs_auth'
  url: string
}

/**
 * MCP 需要客户端注册状态
 */
export interface MCPStatusNeedsClientRegistration {
  type: 'needs_client_registration'
  url: string
}

/**
 * MCP 状态联合类型
 */
export type MCPStatus =
  | MCPStatusConnected
  | MCPStatusDisabled
  | MCPStatusFailed
  | MCPStatusNeedsAuth
  | MCPStatusNeedsClientRegistration

/**
 * MCP 资源
 */
export interface MCPResource {
  server: string
  name: string
  uri: string
  description?: string
  mimeType?: string
}

/**
 * MCP 服务器状态响应
 */
export interface MCPStatusResponse {
  [serverName: string]: MCPStatus
}
