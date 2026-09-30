// ============================================
// API Client for OpenCode Backend
// 基于 @opencode/client（OpenCode V2）: model / provider / project / location
// ============================================

import { getSDKClient } from './sdk'
import { locationInput, toInternalProject, toUiModelInfos } from './v2Convert'
import type { ModelInfo, ApiProject, ApiPath } from './types'

// Re-export all types
export * from './types'

// Re-export from Attachment feature
export { fromFilePart, fromAgentPart } from '../features/attachment'

// Re-export from sub-modules
export * from './session'
export * from './message'
export * from './permission'
export * from './form'
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
// ⛔ 阶段 3b 已删除 `./tool` 与 `./lsp`：
//   - `tool.ts`：V2 删除了 `/experimental/tool` 与 `/experimental/tool/ids`，本仓库零调用点
//   - `lsp.ts` ：V2 不再运行语言服务器（`/lsp`、`/formatter` 端点已删），本仓库零调用点

// ============================================
// Model API Functions
// ============================================
//
// V1 用 `GET /config/providers` 一次性拿到
// `{ providers: { [id]: { models: { [id]: Model } } }, default }`。
// V2 把它拆成两个平铺列表：
//   - `GET /api/model`    → Model.Info[]
//   - `GET /api/provider` → Provider.Info[]
// 前端需要自己 join（providerID 关联），见 v2Convert.toUiModelInfos()。

/**
 * 获取当前可用的模型列表（已 join 上 provider 名称）
 */
export async function getActiveModels(directory?: string, serverId?: string): Promise<ModelInfo[]> {
  const sdk = getSDKClient(serverId)
  const location = locationInput(directory, serverId, 'GET /api/model + /api/provider')
  const [models, providers] = await Promise.all([sdk.model.list(location), sdk.provider.list(location)])
  return toUiModelInfos(models.data, providers.data)
}

/**
 * 获取默认模型
 *
 * V1: `config.providers()` 的 `default` 字段是 `{ [providerID]: modelID }` 映射
 * V2: `GET /api/model/default` 只返回**单个** Model.Info（或 null）
 * → 这里把单个默认模型包装成「只含一个键」的映射，保持下游 `Record<string,string>` 的约定。
 *   （该函数当前全仓库无调用点，属于保留接口。）
 */
export async function getDefaultModels(directory?: string): Promise<Record<string, string>> {
  const sdk = getSDKClient()
  const result = await sdk.model.default(locationInput(directory, undefined, 'GET /api/model/default'))
  if (!result.data) return {}
  const model = result.data
  return { [model.providerID]: model.modelID || model.id }
}

// ============================================
// Project API Functions
// ============================================

/**
 * 获取当前项目
 *
 * V1: `sdk.project.current({ directory })`
 * V2: **已删除**；替代品是 `GET /api/location`（返回 `{directory, project:{id,directory,canonical}}`），
 *     但它**不含 `vcs` / `time` / `sandboxes` / `name`** —— 而 `project.vcs` 是 UI
 *     判断「是否显示 git 相关 diff 选项」的依据，缺了会误判。
 * → 所以这里额外查一次 `GET /api/project` 按 id 取回完整项目对象。
 *   （`useProject` 里本来就会并发调用 `getProjects()`，代价可接受；属阶段 1 的务实取舍。）
 */
export async function getCurrentProject(directory?: string, serverId?: string): Promise<ApiProject> {
  const sdk = getSDKClient(serverId)
  const location = await sdk.location.get(locationInput(directory, serverId, 'GET /api/location'))
  const all = await sdk.project.list()
  const full = all.find(project => project.id === location.project.id)
  if (full) return toInternalProject(full)

  // 兜底：project.list 里找不到时，用 location 能给的信息拼一个最小对象
  return {
    id: location.project.id,
    worktree: location.project.canonical,
    time: { created: 0, updated: 0 },
    sandboxes: [],
  }
}

/**
 * 获取项目列表
 *
 * V1: `sdk.project.list({ directory })`（返回裸数组）
 * V2: `sdk.project.list()`（返回裸数组，但**不接受目录参数** —— 它是全局项目表）
 */
export async function getProjects(_directory?: string, serverId?: string): Promise<ApiProject[]> {
  const sdk = getSDKClient(serverId)
  // V2 的 project.list 没有任何入参；传 directory 反而会被当成 RequestOptions 而报错
  const projects = await sdk.project.list()
  return projects.map(toInternalProject)
}

// ⛔ 阶段 3b 已移除 `initGitProject()`：
//   V2 删除了 `POST /project/git/init`，且没有替代端点
//   —— git 仓库改由「location 首次被使用时自动初始化」。
//   对应的 UI 入口（SessionChangesPanel 的「初始化 git」按钮）已一并删除。

/**
 * 更新项目
 *
 * V1: `PATCH /project/{id}?directory=…`
 * V2: `PATCH /api/project/{projectID}`（SDK：`project.update`）
 *
 * ⚠️ 两处差异：
 *   1. 路径参数从 `directory` 查询参数改成 **`projectID`** —— 所以第二个位置参数
 *      `directory`（location 作用域）在 V2 里**没有任何用处**，保留只是为了不改签名。
 *   2. V2 的 body 是 `{ canonical?, name?, icon?, commands? }`；返回**完整的 Project**
 *      → 这里用 `toInternalProject()` 转回内部形状（`canonical` → `worktree`）。
 *
 * ⚠️ 该函数当前**全仓库零调用点**，属保留接口。
 */
export async function updateProject(
  projectId: string,
  params: {
    /** V2 的 `canonical`（项目根目录，内部模型里叫 `worktree`） */
    canonical?: string
    name?: string
    icon?: { url?: string; override?: string; color?: string }
    commands?: { start?: string }
  },
  _directory?: string,
): Promise<ApiProject> {
  const sdk = getSDKClient()
  const project = await sdk.project.update({ projectID: projectId, ...params })
  return toInternalProject(project)
}

// ============================================
// Location API Functions（V1 的 GET /path）
// ============================================

/**
 * 获取服务器路径信息
 *
 * 🔴 V1 的 `GET /path` 在 V2 中**被删除**，最接近的是 `GET /api/location`。
 * 但两者字段**不对等**：
 *   V1 `Path`  = { home, state, config, worktree, directory }
 *   V2 Location = { directory, project: { id, directory, canonical } }
 *
 * V2 **没有任何端点能拿到 home / state / config**（`GET /api/info` 的 `paths` 只有 `tmp`）。
 * 处理方式：
 *   - `worktree` ← `project.canonical`
 *   - `directory` ← `directory`
 *   - `home` / `state` / `config` → 无来源。`home` 被「目录选择器」当作默认起始路径用，
 *     给空串会让它落到文件系统根目录，体验很差 → 这里退而用**当前目录**兜底，
 *     并在阶段 1 报告中记为「文档未覆盖的缺口」。
 */
export async function getPath(serverId?: string): Promise<ApiPath> {
  const sdk = getSDKClient(serverId)
  const location = await sdk.location.get()
  return {
    home: location.directory,
    state: '',
    config: '',
    worktree: location.project.canonical,
    directory: location.directory,
  }
}

/** 保留给需要「当前 location 原始信息」的调用方（V2 原生形状） */
export async function getLocation(directory?: string, serverId?: string) {
  const sdk = getSDKClient(serverId)
  return sdk.location.get(locationInput(directory, serverId, 'GET /api/location'))
}
