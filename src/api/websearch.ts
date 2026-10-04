// ============================================
// Websearch API — OpenCode v2 原生
//
// websearch.providers：列出可用的第三方搜索 provider
// （官方 session/requests/model.ts:50 用于 websearch.provider 表单的选项）。
// 返回值映射为表单选项 { value: id, label: name }。
// ============================================

import { getSDKClient } from './sdk'
import { locationParam } from './location'

export interface WebsearchProviderOption {
  value: string
  label: string
}

/** 列出某 location 可用的第三方搜索 provider（官方 model.ts:48-54 同款映射） */
export async function getWebsearchProviders(directory?: string, serverId?: string): Promise<WebsearchProviderOption[]> {
  const sdk = getSDKClient(serverId)
  const result = await sdk.websearch.providers({ location: locationParam(directory, serverId) })
  return result.data.map(provider => ({ value: provider.id, label: provider.name }))
}
