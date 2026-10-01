// ============================================
// Config Types — OpenCode v2 原生
//
// ## v1 → v2 的重大变化（影响配置编辑器）
//
// v1：`config.get()` 返回一份**扁平可读写的 Config**；`config.update(config, dir)`
//     可写回任意字段；另有 `global.config.get/update` 管全局配置。
//
// v2：
//   - `config.get()` 返回 **`Array<ConfigEntry>`**，是「配置来源清单」：
//       { type: 'document', path?, info }  —— 一份真实配置文档
//       { type: 'directory', path }        —— 一个目录来源
//     `info` 才是原来的配置内容（字段名与 v1 有差异，例如
//     `agents` 取代 `agent`、`permissions` 取代 `permission`）。
//   - `config.update(input)` 在 v2 **只接受 `{ shell }`**（见 ConfigUpdateInput）。
//     没有「整份配置写回」的入口，也没有 global.config.update。
//   - `config.providers()` 在 v2 被 `model.list()` / `provider.list()` 取代。
//
// 因此：v2 的配置编辑器应为**只读浏览**（列出各 document 来源及其内容），
// 只对 `shell` 保留写入能力。UI 若仍需整份编辑，需要服务器侧新增接口。
// ============================================

import type {
  ConfigEntry,
  ConfigGetOutput,
  ConfigShellsOutput,
  ConfigUpdateInput,
  McpProtocol,
  PermissionEffect,
  PermissionRule,
  PermissionRuleset,
} from '@opencode/client/promise'

/** 权限规则集（v1 的 PermissionConfig 等分散类型收敛于此） */
export type PermissionConfig = PermissionRuleset

export type PermissionRuleConfig = PermissionRule

export type PermissionActionConfig = PermissionEffect

/** v2 不再有独立的 object 形式权限配置 */
export type PermissionObjectConfig = PermissionRule

/**
 * 生效配置对象。
 *
 * 注意：v1 的 `Config` 是「整份可读写配置」，v2 的 `config.get()` 返回的是
 * **来源数组**（`ConfigGetOutput`）。生效值是按顺序深合并各 document 的 info，
 * 形状与单个文档一致，因此这里别名到 `ConfigInfo`——
 * 之前误别名成 `ConfigGetOutput`（数组），导致编辑器里到处是
 * `ConfigGetOutput ↔ JsonRecord` 的无效断言。
 *
 * 需要原始来源数组时用 `ConfigSource[]` / `ConfigGetOutput`。
 */
export type Config = ConfigInfo

/** `config.get()` 的原始响应：配置来源清单 */
export type ConfigResponse = ConfigGetOutput

/** 单个配置来源 */
export type ConfigSource = ConfigEntry

/** `config.get()` 中 type === 'document' 的条目 */
export type ConfigDocument = Extract<ConfigEntry, { type: 'document' }>

/** 配置文档内容（`info`） */
export type ConfigInfo = ConfigDocument['info']

/** `config.update()` 的入参（v2 仅支持 shell） */
export type ConfigUpdateParams = ConfigUpdateInput

/** 可用 shell 列表 */
export type ConfigShellsResponse = ConfigShellsOutput

export type { McpProtocol }

// ============================================
// 旧别名 —— v2 里已无独立对应，保留以便旧引用收敛
// ============================================

/** v1 的日志级别配置在 v2 的 ConfigInfo 里不再存在 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/** v1 的 ServerConfig（服务端监听配置）在 v2 的 ConfigInfo 里不再存在 */
export type ServerConfig = Record<string, unknown>

/** v1 的 AgentConfig 在 v2 由 ConfigInfo['agents'] 的条目取代 */
export type AgentConfig = NonNullable<ConfigInfo['agents']>[string]

/** v1 的 ProviderConfig 在 v2 走 provider.* / credential.* */
export type ProviderConfig = Record<string, unknown>

/** v1 的 LayoutConfig 在 v2 的 ConfigInfo 里不再存在（改为 UI 本地偏好） */
export type LayoutConfig = Record<string, unknown>

/** MCP 服务器配置（v2 为 ConfigInfo['mcp']['servers'] 的条目） */
export type McpServerConfig = NonNullable<NonNullable<ConfigInfo['mcp']>['servers']>[string]

export type McpLocalConfig = Extract<McpServerConfig, { type: 'local' }>

export type McpRemoteConfig = Extract<McpServerConfig, { type: 'remote' }>

/** v2 的 MCP oauth 配置 */
export type McpOAuthConfig = NonNullable<Extract<McpServerConfig, { type: 'remote' }>['oauth']>
