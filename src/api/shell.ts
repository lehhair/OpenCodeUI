// ============================================
// Shell API — 后台 shell 清单与输出（v2 shell.*）
//
// 官方两处消费（SDK 审查发现的真实缺口）：
//   1. shell.list：「移到后台」把 running shells 并入阻塞候选
//      （packages/app/src/session/requests/background.ts:100-109）
//   2. shell.get/output：转写里运行中 shell 的实时输出跟随
//      （session-ui/src/tools/shell-output.ts 的 followShellOutput）
// ============================================

import { getSDKClient } from './sdk'
import type { ShellInfo } from '@opencode/client/promise'

/** 列出当前服务器的 shell（官方 data.shell.list） */
export async function listShells(serverId?: string): Promise<ShellInfo[]> {
  const sdk = getSDKClient(serverId)
  const result = await sdk.shell.list()
  return result.data
}

/**
 * 读取 shell 输出（游标分页，官方 shellOutput 数据通道）。
 * cursor 之前的内容不重复返回；返回的 cursor 用于下次增量。
 */
export async function getShellOutput(
  id: string,
  cursor: number,
  directory?: string,
  serverId?: string,
): Promise<{ output: string; cursor: number; size: number; truncated: boolean }> {
  const sdk = getSDKClient(serverId)
  const result = await sdk.shell.output({
    id,
    ...(directory ? { location: { directory } } : {}),
    cursor,
  })
  return result.data
}
