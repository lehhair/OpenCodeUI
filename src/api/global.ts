// ============================================
// Global API - 全局管理
// 基于 @opencode/client（OpenCode V2）
// ============================================

import type { ServerInfo } from '@opencode/client'
import { getSDKClient } from './sdk'
import { locationInput } from './v2Convert'

/**
 * 服务器健康状态（V2 形状）
 *
 * V1: `GET /global/health` → `{ healthy: boolean, version: string }`
 * V2: **`GET /api/info`**   → `{ version, pid, urls: string[], paths: { tmp } }`
 *
 * 🔴 注意：V2 的响应里**没有 `healthy` 字段** —— 能返回 200 就说明服务活着。
 * 判活条件要改成「版本号是非空字符串」这类结构校验，详见
 * `src/store/serverStore.ts` 的 checkHealth()。
 */
export type HealthInfo = ServerInfo

/**
 * 获取服务器信息（用作健康检查）
 *
 * V1: `sdk.global.health()` → GlobalHealthResponse
 * V2: `sdk.server.info()`   → ServerInfo（**无 healthy 字段**）
 */
export async function getHealth(): Promise<HealthInfo> {
  const sdk = getSDKClient()
  return sdk.server.info()
}

// ⛔ 阶段 3b 已删除 `disposeGlobal()`：
//   V2 删除了 `POST /global/dispose`，且**没有等价物** —— 最接近的
//   `DELETE /api/debug/location` 一次只能驱逐**一个** location（见 `disposeInstance`），
//   无法一次性释放整个服务进程的全部资源。本仓库零调用点，故直接下架。

/**
 * 释放当前实例（V2 口径：**驱逐该 location 的服务端缓存**）
 *
 * V1: `POST /instance/dispose?directory=…` —— 「释放这个目录的实例」
 * V2: `DELETE /api/debug/location`（SDK：`debug.location.evict`）—— 「把这个 location 从
 *     服务端已加载的 location 表里**驱逐**出去」，下次再访问它时重新冷启动
 *     （重新读配置、重建索引等）。
 *
 * ⚠️ **语义差异（重要）**：V1 是「把实例停掉」，V2 是「把缓存踢掉，用到再冷启动」。
 *    对调用方（`WorktreePanel` 删除/重置 worktree 前清理资源）而言效果相似
 *    —— 目的是让该目录上挂着的服务（PTY 之外的后台状态）不再持有旧状态 ——
 *    但**不是同一件事**：驱逐后该 location 仍可能被其他请求立刻重新加载。
 *
 * ⚠️ 目录仍必须显式传（走 `locationInput()`）：
 *    不传时服务端会驱逐它自己 `process.cwd()` 对应的 location，
 *    而不是调用方想清理的那个目录 —— 且**不会报错**。
 */
export async function disposeInstance(directory?: string): Promise<boolean> {
  const sdk = getSDKClient()
  await sdk.debug.location.evict(locationInput(directory, undefined, 'DELETE /api/debug/location'))
  // V2 返回 204 无内容；保持调用方的 boolean 约定
  return true
}
