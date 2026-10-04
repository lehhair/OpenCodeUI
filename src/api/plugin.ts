// ============================================
// Plugin API — OpenCode v2 原生
//
// plugin.list  → PluginInfo[]（扩展管理面板）
// plugin.check → 检查更新（CLI plugin update 用，面板预留）
// plugin.update → 更新指定 target
//
// 官方 web 端只用 list（settings/providers/extensions.tsx、
// session/summary/server-panel.tsx:285），check/update 只有 CLI 用。
// ============================================

import { getSDKClient } from './sdk'
import { locationParam } from './location'
import type { PluginInfo } from '@opencode/client/promise'

export type { PluginInfo }

/** 官方 providers/catalog/plugin.ts 的 pluginLabel 同款 */
export function pluginLabel(plugin: PluginInfo): string {
  if (plugin.id) return plugin.id
  if (plugin.source.type === 'package') return plugin.source.target
  if (plugin.source.type === 'local') return plugin.source.path
  return plugin.source.type
}

/** 列出插件（默认含 builtin，过滤交给调用方——与官方一致） */
export async function getPlugins(directory?: string, serverId?: string): Promise<PluginInfo[]> {
  const sdk = getSDKClient(serverId)
  const result = await sdk.plugin.list({ location: locationParam(directory, serverId) })
  return result.data
}

/** 检查插件更新（target 缺省检查全部） */
export async function checkPlugins(directory?: string, target?: string, serverId?: string): Promise<PluginInfo[]> {
  const sdk = getSDKClient(serverId)
  const result = await sdk.plugin.check({
    location: locationParam(directory, serverId),
    ...(target ? { target } : {}),
  })
  return result.data
}

/** 更新指定插件 target */
export async function updatePlugins(targets: string[], directory?: string, serverId?: string): Promise<void> {
  const sdk = getSDKClient(serverId)
  await sdk.plugin.update({ location: locationParam(directory, serverId), targets })
}
