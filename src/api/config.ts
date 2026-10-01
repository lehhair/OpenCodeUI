// ============================================
// Config API — OpenCode v2 原生
//
// ## v1 → v2 的重大变化
//
// v1：`config.get()` 返回一份扁平可读写 Config；
//     `config.update(config, dir)` 可写回任意字段；
//     另有 `global.config.get/update` 管全局配置；
//     `config.providers()` 拿 provider 列表。
//
// v2：
//   - `config.get({ location })` → **`ConfigEntry[]`**（配置来源清单）：
//       { type: 'document', path?, info }  真实配置文档，`info` 是内容
//       { type: 'directory', path }        目录来源标记
//     生效值 = 按数组顺序深合并各 document 的 info。
//   - `config.update(input)` **只接受 `{ shell }`** —— 没有整份配置写回，
//     也没有 global 配置写入。
//   - `config.providers()` 被 `model.list()` / `provider.list()` 取代。
//   - `config.shells()` 提供可用 shell 列表（取代 v1 的 `pty.shells()`）。
// ============================================

import { getSDKClient } from './sdk'
import { locationParam } from './location'
import type { ConfigSource, ConfigInfo, ConfigShellsResponse } from './types'

/**
 * 获取配置来源清单。
 *
 * v2 的 `config.get()` 直接返回 `ConfigEntry[]`（不是包装对象）。
 */
export async function getConfigSources(directory?: string, serverId?: string): Promise<ConfigSource[]> {
  const sdk = getSDKClient(serverId)
  return await sdk.config.get({ location: locationParam(directory, serverId) })
}

/**
 * 获取合并后的生效配置。
 *
 * v2 返回来源数组；这里按顺序深合并每个 document 的 info，
 * 让调用点仍能拿到一份可读的配置对象。
 */
export async function getConfig(directory?: string, serverId?: string): Promise<ConfigInfo> {
  const sources = await getConfigSources(directory, serverId)
  return mergeConfigInfo(sources)
}

/**
 * 获取全局（无 location）配置。
 */
export async function getGlobalConfig(serverId?: string): Promise<ConfigInfo> {
  const sdk = getSDKClient(serverId)
  const sources = await sdk.config.get()
  return mergeConfigInfo(sources)
}

/** 深合并若干配置文档（后者覆盖前者） */
export function mergeConfigInfo(sources: ConfigSource[]): ConfigInfo {
  const documents = sources.filter(
    (source): source is Extract<ConfigSource, { type: 'document' }> => source.type === 'document',
  )

  let merged: Record<string, unknown> = {}
  for (const doc of documents) {
    merged = deepMerge(merged, doc.info as Record<string, unknown>)
  }
  return merged as ConfigInfo
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function deepMerge(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    const existing = result[key]
    if (isPlainObject(existing) && isPlainObject(value)) {
      result[key] = deepMerge(existing, value)
    } else {
      result[key] = value
    }
  }
  return result
}

/**
 * 更新 shell。
 *
 * v2 的 `config.update` 只支持 shell 这一个字段。
 */
export async function updateShell(shell: string | null, serverId?: string): Promise<void> {
  const sdk = getSDKClient(serverId)
  await sdk.config.update({ shell })
}

/**
 * 获取可用 shell 列表（取代 v1 的 `pty.shells()`）。
 */
export async function getAvailableShells(serverId?: string): Promise<ConfigShellsResponse> {
  const sdk = getSDKClient(serverId)
  return await sdk.config.shells()
}
