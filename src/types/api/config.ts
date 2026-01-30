// ============================================
// Config API Types
// 基于 OpenAPI 规范
// ============================================

import type { PermissionAction } from './permission'

/**
 * 快捷键配置
 */
export interface KeybindsConfig {
  [action: string]: string
}

/**
 * 日志级别
 */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'

/**
 * 服务器配置
 */
export interface ServerConfig {
  host?: string
  port?: number
}

/**
 * 权限动作配置
 */
export interface PermissionActionConfig {
  action: PermissionAction
}

/**
 * 权限对象配置
 */
export interface PermissionObjectConfig {
  [pattern: string]: PermissionActionConfig
}

/**
 * 权限规则配置
 */
export interface PermissionRuleConfig {
  [permission: string]: PermissionObjectConfig
}

/**
 * 权限配置
 */
export interface PermissionConfig {
  rules?: PermissionRuleConfig
}

/**
 * Agent 配置
 */
export interface AgentConfig {
  default?: string
  agents?: Record<string, unknown>
}

/**
 * Provider 配置
 */
export interface ProviderConfig {
  default?: Record<string, string>
  providers?: Record<string, unknown>
}

/**
 * MCP 本地配置
 */
export interface McpLocalConfig {
  type: 'local'
  command: string
  args?: string[]
  env?: Record<string, string>
}

/**
 * MCP OAuth 配置
 */
export interface McpOAuthConfig {
  type: 'oauth'
  url: string
}

/**
 * MCP 远程配置
 */
export interface McpRemoteConfig {
  type: 'remote'
  url: string
  headers?: Record<string, string>
}

/**
 * 布局配置
 */
export interface LayoutConfig {
  sidebar?: {
    width?: number
    collapsed?: boolean
  }
}

/**
 * 完整配置
 */
export interface Config {
  keybinds?: KeybindsConfig
  log?: {
    level?: LogLevel
  }
  server?: ServerConfig
  permission?: PermissionConfig
  agent?: AgentConfig
  provider?: ProviderConfig
  mcp?: Record<string, McpLocalConfig | McpOAuthConfig | McpRemoteConfig>
  layout?: LayoutConfig
}
