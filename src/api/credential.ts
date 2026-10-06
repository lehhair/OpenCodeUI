// ============================================
// Credential API — 凭据管理（OpenCode v2 原生）
//
// 对应官方 providers/connect 的凭据操作：
//   - credential.list    → 凭据列表（设置页 connected 状态判定）
//   - credential.create  → 新建凭据（API key 表单）
//   - credential.update  → 更新凭据内容
//   - credential.activate → 切换激活凭据
//   - credential.remove  → 断开连接（设置页 disconnect 同款）
// ============================================

import { getSDKClient } from './sdk'
import type { CredentialEntry } from '@opencode/client/promise'

export type { CredentialEntry }

/** 列出凭据（默认含全部 integration 的凭据） */
export async function getCredentials(serverId?: string): Promise<CredentialEntry[]> {
  const sdk = getSDKClient(serverId)
  return await sdk.credential.list()
}

/** 新建凭据 */
export async function createCredential(
  input: { integrationID: string; label?: string; value: CredentialEntry['value'] },
  serverId?: string,
): Promise<CredentialEntry> {
  const sdk = getSDKClient(serverId)
  return await sdk.credential.create(input)
}

/** 更新凭据标签（credential.update 只改 label） */
export async function updateCredentialLabel(credentialID: string, label: string, serverId?: string): Promise<void> {
  const sdk = getSDKClient(serverId)
  await sdk.credential.update({ credentialID, label })
}

/** 切换激活凭据 */
export async function activateCredential(credentialID: string, serverId?: string): Promise<void> {
  const sdk = getSDKClient(serverId)
  await sdk.credential.activate({ credentialID })
}

/** 删除凭据（官方设置页 disconnect：遍历 credential connections 逐个 remove） */
export async function removeCredential(credentialID: string, serverId?: string): Promise<void> {
  const sdk = getSDKClient(serverId)
  await sdk.credential.remove({ credentialID })
}
