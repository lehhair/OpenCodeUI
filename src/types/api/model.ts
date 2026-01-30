// ============================================
// Model & Provider API Types
// 基于 OpenAPI 规范
// ============================================

/**
 * 模型能力 - 输入输出支持
 */
export interface ModelIOCapabilities {
  text: boolean
  audio: boolean
  image: boolean
  video: boolean
  pdf: boolean
}

/**
 * 模型能力
 */
export interface ModelCapabilities {
  temperature: boolean
  reasoning: boolean
  attachment: boolean
  toolcall: boolean
  input: ModelIOCapabilities
  output: ModelIOCapabilities
}

/**
 * 模型限制
 */
export interface ModelLimit {
  context: number
  output: number
}

/**
 * 模型状态
 */
export type ModelStatus = 'active' | 'disabled' | 'unavailable'

/**
 * 模型实体
 */
export interface Model {
  id: string
  providerID: string
  name: string
  family: string
  status: ModelStatus
  limit: ModelLimit
  capabilities: ModelCapabilities
  variants?: Record<string, Record<string, unknown>>
}

/**
 * Provider 实体
 */
export interface Provider {
  id: string
  name: string
  source: string
  models: Record<string, Model>
}

/**
 * Provider 列表响应
 */
export interface ProvidersResponse {
  providers: Provider[]
  default: Record<string, string>
}

/**
 * Provider 认证方法
 */
export interface ProviderAuthMethod {
  type: 'oauth' | 'api_key' | 'custom'
  name: string
}

/**
 * Provider 认证授权信息
 */
export interface ProviderAuthAuthorization {
  id: string
  name: string
  providerID: string
}
