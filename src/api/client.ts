// ============================================
// API Client for OpenCode Backend
// 基于 OpenAPI: /config, /project, /provider 相关接口
// ============================================

import { get, patch } from './http'
import { formatPathForApi } from '../utils/directoryUtils'
import type {
  ProvidersResponse,
  ModelInfo,
  ApiProject,
  ApiPath,
} from './types'

// Re-export API_BASE for backward compatibility
export { API_BASE } from './http'

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
export * from './tool'
export * from './lsp'

// ============================================
// Model API Functions
// 基于 OpenAPI: GET /config/providers
// ============================================

export async function getActiveModels(directory?: string): Promise<ModelInfo[]> {
  const data = await get<ProvidersResponse>('/config/providers', { 
    directory: formatPathForApi(directory) 
  })
  const models: ModelInfo[] = []

  for (const provider of data.providers) {
    for (const [, model] of Object.entries(provider.models)) {
      if (model.status === 'active') {
        const variants = model.variants ? Object.keys(model.variants) : []
        
        models.push({
          id: model.id,
          name: model.name || model.id,
          providerId: provider.id,
          providerName: provider.name || provider.id,
          family: model.family || '',
          contextLimit: model.limit.context,
          outputLimit: model.limit.output,
          supportsReasoning: model.capabilities.reasoning,
          supportsImages: model.capabilities.input.image,
          supportsToolcall: model.capabilities.toolcall,
          variants,
        })
      }
    }
  }

  return models
}

export async function getDefaultModels(directory?: string): Promise<Record<string, string>> {
  const data = await get<ProvidersResponse>('/config/providers', { 
    directory: formatPathForApi(directory) 
  })
  return data.default
}

// ============================================
// Project API Functions
// 基于 OpenAPI: /project, /project/current, /project/{projectID}
// ============================================

/**
 * GET /project/current - 获取当前项目
 */
export async function getCurrentProject(directory?: string): Promise<ApiProject> {
  return get<ApiProject>('/project/current', { directory: formatPathForApi(directory) })
}

/**
 * GET /project - 获取项目列表
 */
export async function getProjects(directory?: string): Promise<ApiProject[]> {
  return get<ApiProject[]>('/project', { directory: formatPathForApi(directory) })
}

/**
 * PATCH /project/{projectID} - 更新项目
 */
export async function updateProject(
  projectId: string, 
  params: {
    name?: string
    icon?: { url?: string; override?: string; color?: string }
  },
  directory?: string
): Promise<ApiProject> {
  return patch<ApiProject>(`/project/${projectId}`, { 
    directory: formatPathForApi(directory) 
  }, params)
}

// ============================================
// Path API Functions
// ============================================

export async function getPath(): Promise<ApiPath> {
  return get<ApiPath>('/path')
}
