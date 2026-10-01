// ============================================
// Global API — OpenCode v2 原生
//
// ## v1 → v2 关键差异
//
//   - `global.health()` → **`server.info()`**
//     v1 返回 `{ healthy: true, version }`；v2 返回
//     `{ version, pid, urls, paths: { tmp } }` —— **没有 `healthy` 字段**，
//     promise 成功即视为健康。
//   - `global.dispose()` 与 `instance.dispose({directory})` **已移除**；
//     重新加载位置改走 `location.reload()`。
//   - `global.config.get/update` 已移除，配置统一走 `config.*`。
// ============================================

import { getSDKClient } from './sdk'
import { locationParam } from './location'
import type { ServerInfo } from '@opencode/client/promise'

/**
 * 获取服务器信息（含版本）。
 *
 * v2 没有独立的 health 端点：能拿到 info 就说明服务可用。
 */
export async function getServerInfo(serverId?: string): Promise<ServerInfo> {
  const sdk = getSDKClient(serverId)
  return await sdk.server.info()
}

/**
 * 获取服务器健康状态。
 *
 * 投影成 v1 的形状（{ healthy, version }）以免调用点大改；
 * healthy 由「info 请求是否成功」推导。
 */
export async function getHealth(serverId?: string): Promise<{ healthy: boolean; version: string }> {
  const info = await getServerInfo(serverId)
  return { healthy: true, version: info.version }
}

/**
 * 让服务器重新加载当前 location（取代 v1 的 instance.dispose）。
 */
export async function reloadLocation(): Promise<void> {
  const sdk = getSDKClient()
  await sdk.location.reload()
}

/**
 * 获取当前 location 信息（工作目录 + 所属项目）。
 */
export async function getLocationInfo(directory?: string, serverId?: string) {
  const sdk = getSDKClient(serverId)
  return await sdk.location.get({ location: locationParam(directory, serverId) })
}
