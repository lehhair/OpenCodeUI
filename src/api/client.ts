// ============================================
// API Client — OpenCode v2 原生
//
// 本模块负责：
//   1. 统一导出各 API 子模块与类型
//   2. 模型 / provider 查询（v2 的 model.* + provider.*）
//   3. 项目与 location 查询（v2 的 project.* + location.get）
//
// ## v1 → v2 关键差异
//
//   - 模型：v1 从 `config.providers()` 的 provider.models 里挖；
//     v2 是独立的 `model.list()`，每个模型自带 providerID。
//   - 默认模型：v1 是 `config.providers().default`；
//     v2 是 `model.default()`。
//   - 项目：v1 有 `project.current()` / `initGit()`；
//     v2 只有 `project.list()`（无参）与 `project.update()`，
//     当前项目从 `location.get()` 得到。
//   - Path：v1 有 `path.get()`；v2 由 `location.get()` 取代。
// ============================================

import { getSDKClient } from './sdk'
import { locationParam } from './location'
import type { ModelInfo, ApiProject, ApiPath } from './types'
import type { Model, Provider } from '../types/api/model'

// Re-export all types
export * from './types'

// Re-export from Attachment feature
export { fromFilePart, fromAgentPart } from '../features/attachment'

// Re-export from sub-modules
export * from './session'
export * from './message'
export * from './permission'
export * from './file'
export * from './agent'
export * from './skill'
export * from './events'
export * from './config'
export * from './vcs'
export * from './mcp'
export * from './pty'
export * from './worktree'
export * from './command'
export * from './global'
export * from './todo'

// ============================================
// Model API — v2 model.list + provider.list
// ============================================

/** 把 v2 的 ModelInfo 投影成 UI 的 ModelInfo */
function toUIModel(model: Model, provider: Provider | undefined): ModelInfo {
  const input = model.capabilities?.input ?? ({} as Record<string, unknown>)
  const tools = model.capabilities?.tools

  return {
    id: model.id,
    name: model.name || model.id,
    providerId: model.providerID,
    providerName: provider?.name || model.providerID,
    family: model.family ?? '',
    contextLimit: model.limit?.context ?? 0,
    outputLimit: model.limit?.output ?? 0,
    supportsReasoning: (input as { reasoning?: boolean }).reasoning === true,
    supportsImages: (input as { image?: boolean }).image === true,
    supportsPdf: (input as { pdf?: boolean }).pdf === true,
    supportsAudio: (input as { audio?: boolean }).audio === true,
    supportsVideo: (input as { video?: boolean }).video === true,
    supportsToolcall: tools === true,
    variants: model.variants?.map(variant => variant.id) ?? [],
  }
}

/**
 * 获取启用的模型列表。
 *
 * v2 的模型自带 providerID，provider 只需用来补显示名。
 */
export async function getActiveModels(directory?: string, serverId?: string): Promise<ModelInfo[]> {
  const sdk = getSDKClient(serverId)
  const location = locationParam(directory, serverId)

  const [modelsResult, providersResult] = await Promise.all([
    sdk.model.list({ location }),
    sdk.provider.list({ location }),
  ])

  const providers = new Map(providersResult.data.map(provider => [provider.id, provider]))

  return modelsResult.data
    .filter(model => model.enabled && model.status === 'active')
    .map(model => toUIModel(model, providers.get(model.providerID)))
}

/**
 * 获取默认模型映射（providerID → modelID）。
 *
 * v2 的 `model.default()` 返回单个默认模型，这里投影成旧的
 * `Record<providerID, modelID>` 形状，调用点无需改动。
 */
export async function getDefaultModels(directory?: string, serverId?: string): Promise<Record<string, string>> {
  const sdk = getSDKClient(serverId)
  const result = await sdk.model.default({ location: locationParam(directory, serverId) })
  if (!result.data) return {}
  return { [result.data.providerID]: result.data.modelID }
}

/**
 * 获取默认模型（完整对象），v2 语义更直接。
 */
export async function getDefaultModel(directory?: string, serverId?: string): Promise<Model | null> {
  const sdk = getSDKClient(serverId)
  const result = await sdk.model.default({ location: locationParam(directory, serverId) })
  return result.data
}

// ============================================
// Project API — v2 project.*
// ============================================

/**
 * 获取项目列表。
 *
 * v2 的 `project.list()` 不接受参数，返回全部项目。
 */
export async function getProjects(_directory?: string, serverId?: string): Promise<ApiProject[]> {
  const sdk = getSDKClient(serverId)
  return await sdk.project.list()
}

/**
 * 获取当前项目。
 *
 * v2 没有 `project.current()`；当前项目由 `location.get()` 给出
 * （`{ directory, project: { id, directory, canonical } }`），
 * 再用 `project.list()` 找到完整实体。
 */
export async function getCurrentProject(directory?: string, serverId?: string): Promise<ApiProject | undefined> {
  const sdk = getSDKClient(serverId)
  const loc = await sdk.location.get({ location: locationParam(directory, serverId) })
  const projects = await sdk.project.list()
  return projects.find(project => project.id === loc.project.id)
}

/**
 * 更新项目元信息。
 */
export async function updateProject(
  projectId: string,
  params: {
    name?: string
    icon?: { url?: string; override?: string; color?: string }
    commands?: { start?: string }
  },
  _directory?: string,
  serverId?: string,
): Promise<ApiProject> {
  const sdk = getSDKClient(serverId)
  return await sdk.project.update({ projectID: projectId, ...params })
}

// ============================================
// Location API — 取代 v1 的 path.get()
// ============================================

/**
 * 获取当前位置信息（工作目录 + 所属项目）。
 *
 * v1 的 `path.get()` 返回 { cwd, root, ... }；v2 用 LocationPublicInfo 取代。
 */
export async function getPath(directory?: string, serverId?: string): Promise<ApiPath> {
  const sdk = getSDKClient(serverId)
  return await sdk.location.get({ location: locationParam(directory, serverId) })
}

/**
 * 让服务器重新加载当前 location（取代 v1 的 instance.dispose）。
 */
export async function reloadLocation(): Promise<void> {
  const sdk = getSDKClient()
  await sdk.location.reload()
}
