// ============================================
// Location Helper — v2 的 location 参数收敛
//
// v2 把所有「以某个工作目录为作用域」的入参统一为：
//
//     location: { directory?: string }
//
// 而不是 v1 的顶层 `directory` 字段。本文件提供唯一入口，
// 避免每个 API 模块各自拼装，也统一处理路径分隔符。
//
// 注意：`directory` 为 undefined 时返回 undefined，让服务器
// 回落到它自己的默认工作目录（与 v1 行为一致）。
// ============================================

import { formatPathForApi } from '../utils/directoryUtils'

/** v2 的 location 入参形状 */
export interface LocationParam {
  directory?: string
}

/**
 * 构造 v2 的 location 参数。
 *
 * @param directory 目录（内部存储用正斜杠，这里按服务器风格转换）
 * @param serverId  目标服务器（决定路径分隔符风格）
 */
export function locationParam(directory?: string | null, serverId?: string): LocationParam | undefined {
  const formatted = formatPathForApi(directory, serverId)
  return formatted ? { directory: formatted } : undefined
}
