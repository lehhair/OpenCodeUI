// ============================================
// Reference API — OpenCode v2 原生
//
// reference.list：某个 location 下挂载的「引用目录」（命名外部目录/git 仓库）。
// 官方在 composer 的 @ 提及菜单里列出它们（composer/model.ts:147-166），
// 选中后作为目录附件插入。
// ============================================

import { getSDKClient } from './sdk'
import { locationParam } from './location'
import type { ReferenceInfo } from '@opencode/client/promise'

export type { ReferenceInfo }

/** 列出某 location 的引用目录（默认含 hidden，过滤交给调用方——与官方一致） */
export async function getReferences(directory?: string, serverId?: string): Promise<ReferenceInfo[]> {
  const sdk = getSDKClient(serverId)
  const result = await sdk.reference.list({ location: locationParam(directory, serverId) })
  return result.data
}
