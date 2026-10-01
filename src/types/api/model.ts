// ============================================
// Model / Provider Types — OpenCode v2 原生
//
// ## v1 → v2 的变化
//
// v1：`config.providers()` 返回 `{ providers, default }`，模型挂在
//     provider.models 下（按 provider 分组），另有 `ProviderAuthMethod` /
//     `ProviderAuthAuthorization` 用于 OAuth 登录流程。
//
// v2：模型与 provider 是**各自独立的一等列表**，且每个模型自带 providerID：
//     - `model.list()`    → { location, data: ModelInfo[] }
//     - `model.default()` → 默认模型
//     - `provider.list()` → { location, data: ProviderInfo[] }
//     Provider 的认证改由 `integration.*` / `credential.*` 承担，
//     v1 的 provider auth method / authorization 在 v2 不存在。
// ============================================

import type {
  ModelDefaultOutput,
  ModelInfo,
  ModelListOutput,
  ProviderInfo,
  ProviderListOutput,
} from '@opencode/client/promise'

/** 模型能力 */
export type ModelCapabilities = ModelInfo['capabilities']

/** 输入能力（v1 的 input 子集） */
export type ModelIOCapabilities = ModelInfo['capabilities']['input']

/** 模型上下文/输出限额 */
export type ModelLimit = ModelInfo['limit']

/** 模型状态：alpha | beta | deprecated | active */
export type ModelStatus = ModelInfo['status']

/** 模型 */
export type Model = ModelInfo

/** Provider */
export type Provider = ProviderInfo

export type ModelListResponse = ModelListOutput

export type ProviderListResponse = ProviderListOutput

export type ModelDefaultResponse = ModelDefaultOutput

/**
 * 兼容别名。
 *
 * v1 的 `ProvidersResponse` 是 `{ providers, default }`；v2 拆成
 * model.list + provider.list 两个响应，因此这里用一个组合形状表达。
 */
export interface ProvidersResponse {
  providers: ProviderInfo[]
  models: ModelInfo[]
  default: Record<string, string>
}
