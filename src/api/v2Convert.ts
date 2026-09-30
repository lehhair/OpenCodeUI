// ============================================
// V2 响应 → 项目内部模型 的转换层（阶段 1）
// ============================================
//
// 为什么需要它：
//   OpenCode V2 把「界面程序看到的数据结构」整体换掉了。本项目的 UI / store /
//   渲染层**仍然按 V1 模型编写**，而阶段 1 的授权范围禁止改动这些组件。
//   所以阶段 1 的策略是：**API 层做转换**，把 V2 响应映射回内部沿用的 V1 模型，
//   让下游零改动；等阶段 2/3 重写内部模型时，这一层会被整体删除。
//
// 目录参数策略（依据 docs/opencode-v2-migration.md §3.3 + 阶段 1 实测）：
//   - **locationRef 作用域端点**（config / agent / skill / command / model / provider /
//     location …共 57 个）：V2 客户端会自动把 `{ location: { directory } }` 序列化成
//     `?location[directory]=…`（deepObject）。实测请求头 `x-opencode-directory` 也有效，
//     但**优先用显式参数**，更贴近官方生成代码、也更容易排查。
//   - **`GET /api/session`（会话列表）是唯一例外**：它只认**裸 `?directory=`** 参数。
//     实测：不带 directory 时**不会报错**，而是静默返回**全局所有项目**的会话
//     → 必须显式传参，见 `sessionDirectory()`。
//   - **session 作用域端点**（`/api/session/{id}/*`）：目录由 session 行本身决定，
//     **不要**传任何目录信息（传了也被忽略）。
//
// 🔴 目录参数写错是「静默失效」的：HTTP 仍返回 200，只是悄悄回落到服务进程的
//    `process.cwd()`。所以下面所有构造目录入参的函数都会在**开发环境**打印告警。
// ============================================

import type {
  AgentInfo,
  ModelInfo as V2ModelInfo,
  PermissionAsked,
  ProviderInfo,
  SessionActive,
  SessionInfo,
  SkillInfo,
  Project as V2Project,
} from '@opencode/client'
import { formatPathForApi } from '../utils/directoryUtils'
import type { ApiAgent } from './types'
import type { ApiPermissionRequest, ApiProject, ApiSession, SessionStatusMap } from './types'
import type { SessionRevert } from '../types/api/session'
import type { ModelInfo as UiModelInfo } from '../types/ui'
import type { Skill } from '../types/api/skill'

// ============================================
// 目录 / location 入参
// ============================================

/**
 * 构造 locationRef 作用域端点的 location 入参。
 *
 * 返回 `{ location: { directory } }`，无目录时返回 `undefined`
 * （此时 V2 服务端会回落到 `process.cwd()`）。
 */
export function locationInput(
  directory: string | undefined,
  serverId: string | undefined,
  apiName: string,
): { location: { directory: string } } | undefined {
  const formatted = formatPathForApi(directory, serverId)
  if (!formatted) {
    warnMissingDirectory(apiName, serverId)
    return undefined
  }
  return { location: { directory: formatted } }
}

/**
 * 构造 `GET /api/session`（会话列表）的裸 `directory` 入参。
 *
 * 🔴 这个端点**只认裸 `directory`**：
 *   - 传 `?location[directory]=` → 被静默忽略
 *   - 只带 `x-opencode-directory` 请求头 → 被静默忽略
 *   - 什么都不带 → 返回**该服务器上全部项目**的会话
 * 因此这里必须显式传参。
 *
 * ⚠️ 但「不传」本身是**合法用法**，不能抛错：
 *   多服务器模式的全局搜索（`SearchResults.tsx:121`）就是要跨目录搜整个服务器。
 *   所以缺失时只记一条**开发期提示**（不是告警），把「本次查询是全局的」这件事说清楚。
 */
export function sessionDirectory(
  directory: string | undefined,
  serverId: string | undefined,
  apiName: string,
): string | undefined {
  const formatted = formatPathForApi(directory, serverId)
  if (!formatted) {
    if (import.meta.env?.DEV) {
      console.info(
        `[OpenCode V2] ${apiName} 未指定 directory（serverId=${serverId ?? '活动服务器'}）：` +
          `本次将查询该服务器上**全部项目**的会话。` +
          `若调用方本意是「只看某个目录」，那就是漏传了 —— 这就是 V2 下最难查的一类 bug。`,
      )
    }
    return undefined
  }
  return formatted
}

/**
 * 开发期告警：目录缺失时服务端会静默回落到 process.cwd()。
 * 生产构建里这段会被 tree-shake 掉，不产生噪音。
 */
function warnMissingDirectory(apiName: string, serverId: string | undefined): void {
  if (import.meta.env?.DEV) {
    console.warn(
      `[OpenCode V2] ${apiName} 未指定目录（serverId=${serverId ?? '活动服务器'}）。` +
        `服务端会回落到它自己的 process.cwd()，可能导致「选了 A 目录却读到 B 目录」而不报错。`,
    )
  }
}

// ============================================
// Session
// ============================================

/**
 * V2 `Session.Info` → 内部 `Session`（V1 形状）
 *
 * 字段差异（V1 → V2）：
 *   - `directory`            → **`location.directory`**（改名 + 嵌套）
 *   - `slug` / `version`     → 已删除（下游未使用，填空串兜底）
 *   - `summary`              → 已删除（下游全部是可选的 `session.summary &&` 判断，安全）
 *   - `share`                → 已删除（V2 无分享 API）
 *   - `revert.diff`          → `revert.files`（类型不同，见下方注释）
 *   - `time.compacting`      → 已删除
 */
export function toInternalSession(session: SessionInfo): ApiSession {
  return {
    id: session.id,
    // V2 无 slug：下游没有任何地方读它，用 id 兜底避免 undefined
    slug: session.id,
    projectID: session.projectID,
    directory: session.location.directory,
    path: session.subpath,
    parentID: session.parentID,
    // V2 已删除会话级 summary（变更统计改由 /api/vcs/status 提供），下游判断都是可选的
    summary: undefined,
    cost: session.cost,
    tokens: session.tokens,
    share: undefined,
    title: session.title ?? '',
    agent: session.agent,
    model: session.model
      ? {
          // V1 用 modelID，V2 的 ModelRef 用 id（实测 id === modelID）
          id: session.model.id,
          providerID: session.model.providerID,
          variant: session.model.variant,
        }
      : undefined,
    // V2 已删除会话版本字段，下游未使用
    version: '',
    metadata: session.metadata,
    time: {
      created: session.time.created,
      updated: session.time.updated,
      archived: session.time.archived,
    },
    revert: toInternalRevert(session.revert),
  }
}

/**
 * V2 `Session.Revert` → 内部 `SessionRevert`（V1 形状 + V2 新增字段）
 *
 * 字段对照：
 *   | 概念 | V1 `Session['revert']` | V2 `Session.Revert` |
 *   |---|---|---|
 *   | 边界消息 | `messageID` | `messageID`（同名） |
 *   | 边界 part | `partID?` | `partID?`（同名；V2 的 stage 入参已不接受 partID） |
 *   | 快照 id | `snapshot?` | `snapshot?`（同名） |
 *   | 变更内容 | **`diff?: string`**（补丁文本） | **`files?: FileDiffInfo[]`**（结构化） |
 *
 * ⚠️ `diff` / `files` **语义不同、不能互转**：V1 的 `diff` 是一整段 patch 文本，
 *    V2 的 `files` 是逐文件的结构化 diff。这里保留 `files`（内部类型已在
 *    `src/types/api/session.ts` 里做了交叉类型扩展），`diff` 留 undefined。
 */
export function toInternalRevert(revert: SessionInfo['revert']): SessionRevert | undefined {
  if (!revert) return undefined
  return {
    messageID: revert.messageID,
    partID: revert.partID,
    snapshot: revert.snapshot,
    // V1 的 diff 是补丁文本，V2 没有对应物 → 不强行映射
    diff: undefined,
    // V2 新增：回退涉及的文件（结构化 diff）
    files: revert.files,
  }
}

/**
 * V2 `GET /api/session/active` → 内部 `SessionStatusMap`
 *
 * ⚠️ 语义变化：V1 的 `GET /session/status` 返回 4 态
 * （`idle` / `busy` / `retry` / `{type:'idle'}`…），V2 的 `/api/session/active`
 * **只返回"活跃"的会话**（值为 `{type:'running'}`），不在表里 = 空闲。
 * 这里把缺失的会话补成 `idle`，让下游判断逻辑不变。
 */
export function toInternalSessionStatusMap(active: Record<string, SessionActive>): SessionStatusMap {
  const result: SessionStatusMap = {}
  for (const [sessionID, state] of Object.entries(active)) {
    // V2 目前只有 running 一种；映射到 V1 的 busy，其余保持 idle
    result[sessionID] = state.type === 'running' ? { type: 'busy' } : { type: 'idle' }
  }
  return result
}

// ============================================
// Permission（阶段 2b 新增：事件载荷 → 内部模型）
// ============================================

/**
 * V2 `permission.asked` 事件的载荷 → 内部 `PermissionRequest`
 *
 * ⚠️ 字段对照（**阶段 2b 实测修正**：阶段 1 的注释曾写「多了 patterns」，
 *    实际 V2 是 `action` + `resources`，`patterns` 是 V1 的名字）：
 *
 *   | 概念 | V1 `PermissionRequest` | V2 `permission.asked.data` |
 *   |---|---|---|
 *   | 权限类别 | `permission: string` | **`action: string`** |
 *   | 匹配模式 | `patterns: string[]` | **`resources: string[]`** |
 *   | 总是允许的规则 | `always: string[]` | **`save?: string[]`** |
 *   | 来源工具 | `tool?: {messageID, callID}` | **`source?: {type:'tool', messageID, id}`** |
 *   | 附加信息 | `metadata`（必填） | `metadata?`（可选） |
 *
 * 为什么要转：权限 UI（`useChatSession` 的 pending permission 提示）与
 * `SessionEventCallbacks` 都按内部模型（V1 形状）写，转换后这两处零改动。
 * （✅ 阶段 3a 已把权限的**回复 API** 也迁移完成，见 `src/api/permission.ts`；
 *  本函数至今仍是「事件载荷 → 内部模型」的唯一入口。）
 */
export function toInternalPermissionRequest(data: PermissionAsked['data']): ApiPermissionRequest {
  return {
    id: data.id,
    sessionID: data.sessionID,
    permission: data.action,
    patterns: data.resources,
    metadata: (data.metadata as Record<string, unknown> | undefined) ?? {},
    always: data.save ?? [],
    tool:
      data.source && data.source.type === 'tool'
        ? { messageID: data.source.messageID, callID: data.source.id }
        : undefined,
  }
}

// ============================================
// Agent
// ============================================
/**
 * V2 `Agent.Info` → 内部 `Agent`（V1 形状）
 *
 * 字段差异：
 *   - `id`（新增，V2 有独立 id）→ 内部模型不需要
 *   - `permissions`（复数）→ V1 叫 `permission`
 *   - `system`（系统提示词）→ V1 叫 `prompt`
 *   - `native` / `topP` / `temperature` / `options` → V2 已删除
 *
 * 🔴 `permission` 字段**无法映射**：V2 的权限模型整个换了
 *   V1 `PermissionRule` = { permission, pattern, action: 'allow'|'deny'|'ask' }
 *   V2 `PermissionRule` = { action, resource, effect: 'allow'|'deny' }
 *   字段与语义都不同（见迁移文档 §3.4）。这里填空数组 ——
 *   经全仓库核对，**下游没有任何地方读取 `agent.permission`**，
 *   所以不会造成行为差异；阶段 3 适配配置编辑器时再处理。
 */
export function toInternalAgent(agent: AgentInfo): ApiAgent {
  return {
    name: agent.name,
    description: agent.description,
    mode: agent.mode,
    hidden: agent.hidden,
    color: agent.color,
    permission: [],
    model: agent.model ? { modelID: agent.model.id, providerID: agent.model.providerID } : undefined,
    variant: agent.model?.variant,
    prompt: agent.system,
    steps: agent.steps,
    options: {},
  }
}

// ============================================
// Skill
// ============================================

/**
 * V2 `Skill.Info` → 内部 `Skill`（V1 形状）
 *
 * 字段差异：`id`（新增）、`path` → V1 叫 `location`、`autoinvoke`（新增，内部模型不保留）
 */
export function toInternalSkill(skill: SkillInfo): Skill {
  return {
    name: skill.name,
    description: skill.description,
    location: skill.path,
    content: skill.content,
  }
}

// ============================================
// Project
// ============================================

/**
 * V2 `Project` → 内部 `Project`（V1 形状）
 *
 * 字段差异：
 *   - V1 的 `worktree` 在 V2 里改名为 **`canonical`**（同一个含义：项目根目录）
 *   - V2 的 `vcs` 类型放宽为 `string`（V1 是字面量 `"git"`），下游只用它判断「是不是 git」，
 *     所以这里原样透传并断言成 V1 的字面量类型
 *   - 其余（id / name / icon / commands / time / sandboxes）保持一致
 */
export function toInternalProject(project: V2Project): ApiProject {
  return {
    id: project.id,
    worktree: project.canonical,
    vcs: project.vcs as ApiProject['vcs'],
    name: project.name,
    icon: project.icon,
    commands: project.commands,
    time: project.time,
    sandboxes: project.sandboxes,
  }
}

// ============================================
// Model / Provider
// ============================================

/**
 * V2 `Model.Info` + `Provider.Info` → UI 层 `ModelInfo`
 *
 * 背景：V1 用 `GET /config/providers` 一次性拿到
 * `{ providers: { [id]: { models: { [id]: Model } } }, default }`；
 * V2 拆成了 `GET /api/model` + `GET /api/provider` 两个平铺列表，需要前端 join。
 *
 * 能力字段映射（V2 的 capabilities 是 `{tools, input: string[], output: string[]}`）：
 *   - `tools`            → supportsToolcall
 *   - `input` 含 'image' → supportsImages（pdf / audio / video 同理）
 *   - `reasoning`        → ⚠️ **V2 没有这个布尔字段**。这里用两个信号取并集：
 *                          ① `compatibility.reasoningField` 存在
 *                          ② 有 `variants`（V2 的 variant 就是推理档位）
 *                          这是启发式判断，不是 V2 官方契约，已在阶段 1 报告中注明。
 */
export function toUiModelInfos(models: V2ModelInfo[], providers: ProviderInfo[]): UiModelInfo[] {
  const providerNames = new Map(providers.map(p => [p.id, p.name]))
  const result: UiModelInfo[] = []

  for (const model of models) {
    // V1 的 /config/providers 只返回可用模型；V2 的 /api/model 会带上被禁用的
    if (model.status !== 'active' || model.enabled === false) continue

    const inputs = model.capabilities?.input ?? []
    const modelId = model.modelID || model.id
    if (!modelId) continue

    result.push({
      id: modelId,
      name: model.name || modelId,
      providerId: model.providerID,
      providerName: providerNames.get(model.providerID) ?? model.providerID,
      family: model.family ?? '',
      contextLimit: model.limit?.context ?? 0,
      outputLimit: model.limit?.output ?? 0,
      supportsReasoning: !!model.compatibility?.reasoningField || (model.variants?.length ?? 0) > 0,
      supportsImages: inputs.includes('image'),
      supportsPdf: inputs.includes('pdf'),
      supportsAudio: inputs.includes('audio'),
      supportsVideo: inputs.includes('video'),
      supportsToolcall: model.capabilities?.tools === true,
      variants: (model.variants ?? []).map(v => v.id),
    })
  }

  return result
}
