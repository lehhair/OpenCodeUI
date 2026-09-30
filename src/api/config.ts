// ============================================
// Config API - 配置管理
// 基于 @opencode/client（OpenCode V2）: GET /api/config
// ============================================
//
// 🔴 V2 的配置模型与 V1 **完全不同**（见 docs/opencode-v2-migration.md §3.4 / §4.4）：
//
//   V1：`GET /config` 直接返回**已合并**的单个 Config 对象
//   V2：`GET /api/config` 返回 **`Config.Entry[]`** —— 一份「配置文档 + 发现来源」的
//       **有序数组**（优先级从低到高），前端需要自己合并
//
//   而且 **V2 的配置字段名也改了**（`permission`→`permissions`、`agent`→`agents`、
//   `command`→`commands`、`provider`→`providers`、`mcp`→`mcp.servers` …）。
//
// 阶段 1 的做法（受授权范围限制，配置编辑器本阶段不改）：
//   - 读出真实数据（V2 形状）并**按优先级合并**成一个对象返回；
//   - 返回类型仍沿用内部的 `Config`，但**内容其实是 V2 形状** ——
//     这是阶段 1 的已知妥协，配置编辑器的字段适配属于阶段 3（迁移文档 §7 P2）。
//   - 好消息：UI 实际读的两个字段 `providers` / `shell` 在 V2 里**同名**，不受影响。
//
// 🔴 V2 的写入口严重缩水（阶段 1 实测 + 源码确认）：
//   `PATCH /api/experimental/config` 的 payload 是 `Config.Patch`，而
//   `packages/schema/src/config.ts:112` 里它**只有 `shell` 一个字段**：
//       export const Patch = Schema.Struct({ shell: Schema.NullOr(Schema.String) })
//   也就是说 **V2 没有「写任意配置」的 API**，只能改 `shell`。
//   迁移文档 §4.4 认为 `updateGlobalConfig` 「可迁移」，**这一条是错的**。
//   → `updateGlobalConfig` 只在 patch 仅含 `shell` 时放行，其余一律显式报错。
// ============================================

import { getSDKClient } from './sdk'
import { locationInput } from './v2Convert'
import { normalizeForComparison } from '../utils/directoryUtils'
import type { ConfigEntry } from '@opencode/client'
import type { Config } from '../types/api/config'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * 深合并两份配置：对象递归合并，其余（数组/标量）直接覆盖。
 * 对应 V2 「优先级从低到高」的文档顺序 —— 后面的覆盖前面的。
 */
function deepMergeConfig(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(override)) {
    const previous = result[key]
    result[key] = isPlainObject(previous) && isPlainObject(value) ? deepMergeConfig(previous, value) : value
  }
  return result
}

/**
 * 把 `Config.Entry[]` 按顺序合并成一个配置对象。
 * `type: "directory"` 的条目只是「发现来源」标记，没有 info，跳过。
 */
function mergeConfigEntries(entries: ConfigEntry[]): Record<string, unknown> {
  let merged: Record<string, unknown> = {}
  for (const entry of entries) {
    if (entry.type !== 'document') continue
    merged = deepMergeConfig(merged, entry.info as Record<string, unknown>)
  }
  return merged
}

/**
 * 判断路径是否位于给定目录之下（用于区分「全局配置」与「项目配置」）
 */
function isPathUnder(path: string, directory: string): boolean {
  const child = normalizeForComparison(path)
  const parent = normalizeForComparison(directory)
  if (!child || !parent) return false
  if (child === parent) return true
  const prefix = parent.endsWith('/') ? parent : `${parent}/`
  return child.startsWith(prefix)
}

/**
 * 获取**当前目录生效**的配置（V2 的所有文档按优先级合并后的结果）
 *
 * V1: `sdk.config.get({ directory })`  → Config（已合并）
 * V2: `sdk.config.get({ location })`   → Config.Entry[]（多文档，需自行合并）
 */
export async function getConfig(directory?: string): Promise<Config> {
  const sdk = getSDKClient()
  const entries = await sdk.config.get(locationInput(directory, undefined, 'GET /api/config'))
  // ⚠️ 返回的是 V2 形状的合并结果（字段名与 V1 不同），见文件头说明
  return mergeConfigEntries(entries) as unknown as Config
}

/**
 * 获取**用户全局配置**（官方桌面设置写入的那份配置源）
 *
 * V1: `sdk.global.config.get()` —— V2 **没有**独立端点（`GET /global/config` 已删除）。
 * V2 替代方案：从 `GET /api/config` 的 Entry[] 里挑出「不在当前目录下」的那些文档
 * （全局配置位于 `~/.config/opencode/`，优先级最低，排在最前面）。
 *
 * 实现：先问 `GET /api/location` 拿到服务端当前目录，再用它做过滤。
 */
export async function getGlobalConfig(): Promise<Config> {
  const sdk = getSDKClient()
  const location = await sdk.location.get()
  const entries = await sdk.config.get()
  const globalEntries = entries.filter(entry => {
    // 没有 path 的文档无法判断来源，保守起见算作全局
    if (!entry.path) return true
    return !isPathUnder(entry.path, location.directory)
  })
  return mergeConfigEntries(globalEntries) as unknown as Config
}

// ⛔ 阶段 3b 已移除 `updateConfig()`（location 级配置写）：
//   V2 的 `/api/config` **只有 GET**，不存在任何 location 级写入口，也没有替代端点。
//   UI 入口：配置编辑器（`src/features/settings`）的保存链路 —— 阶段 3b 已把编辑器
//   降级为「只读展示 + 仅 shell 可写 + 一键复制 JSON」，不再有任何「保存其他字段」的按钮。

/**
 * 更新**用户全局配置**
 *
 * 🔴 V2 的写入口严重缩水：`PATCH /api/experimental/config` 的 payload 是
 * `Config.Patch`，而它**只有 `shell` 一个字段**（`packages/schema/src/config.ts:112`）。
 *
 * 所以本函数**只接受 `shell`**：
 *   - 调用方（配置编辑器）在阶段 3b 已改为「只有 shell 一项可图形化编辑」，
 *     其它字段一律只读展示 + 「复制 JSON」引导用户直接编辑 `opencode.json`。
 *   - 这里保留一道**运行时防线**：万一将来有人传入其它字段，直接抛错而不是
 *     让服务端静默丢弃（HTTP 200 但没生效，比报错更难排查）。
 */
export async function updateGlobalConfig(config: Config): Promise<Config> {
  const sdk = getSDKClient()
  const patch = config as unknown as Record<string, unknown>
  const keys = Object.keys(patch).filter(key => patch[key] !== undefined)
  const unsupported = keys.filter(key => key !== 'shell')

  if (unsupported.length > 0) {
    throw new Error(
      `[OpenCode V2] 保存全局配置失败：V2 的 PATCH /api/experimental/config 只接受 { shell } 一个字段，` +
        `本次请求含不支持的字段（${unsupported.join(', ')}），服务端会**静默丢弃**它们。` +
        `请改为直接编辑 opencode.json（界面上的「复制 JSON」按钮可帮你取到当前值）。`,
    )
  }

  await sdk.config.update({ shell: (patch.shell as string | null | undefined) ?? null })
  // 写完后回读一次，保持与调用方「返回保存后的配置」的约定
  return getGlobalConfig()
}

// ⛔ 阶段 3b 已删除 `getProviderConfigs()`：
//   它唯一的消费方是配置编辑器的 provider 下拉（`configEditorProviders.tsx`）。
//   配置编辑器降级为「只读 + 仅 shell 可写 + 复制 JSON」后，那些编辑器组件已整体删除
//   → 本函数零调用点，一并下架。
//   （V2 侧信息：配置文档里的 `providers` 本身就是 `{ [providerID]: {...} }` 映射，
//     与 V1 的 `GET /config/providers` 信封不同。）
