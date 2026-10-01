// ============================================
// Permission & Form API — OpenCode v2 原生
//
// ## Permission（v1 → v2 语义变化）
//
// v1：`permission.list({directory})` 返回全部待处理；回复走
//     `permission.reply({ requestID, reply })` 或 `permission.respond(...)`。
//     请求体带 `tool: { messageID, callID }`。
//
// v2：请求体改为**动作 + 资源**模型，没有 `tool` 字段：
//       { id, sessionID, action, resources[], save?, metadata?, source?, message? }
//     - 按会话查询：`permission.list({ sessionID })` → 裸数组
//     - 按位置查询：`permission.request.list({ location })` → { location, data }
//     - 回复：`permission.reply({ sessionID, requestID, decision, message? })`
//       **字段名是 `decision`，不是 `reply`**；`respond` 已移除
//     - 新增：`permission.create` / `permission.saved.list` / `saved.remove`
//       （持久化的「总是允许」规则，取代 v1 的 `always` 语义）
//
// ## Question → Form（完全替换）
//
// v1 的 `question.list / reply / reject` 在 v2 由 form.* 承担：
//     - `form.list({ location })`        → { location, data: FormInfo[] }
//     - `session.form.list({ sessionID })` → 裸 FormInfo[]
//     - `session.form.get({ sessionID, formID })` → FormDetail
//     - `session.form.reply({ sessionID, formID, answer })` → void
//       **answer 是 `{ [fieldKey]: FormValue }` 的键值对象**，
//       不是 v1 的 answers 位置数组
//     - `session.form.cancel({ sessionID, formID, message? })` → void
// ============================================

import { getSDKClient } from './sdk'
import { locationParam } from './location'
import { resolveSessionTarget } from '../utils/sessionKey'
import type {
  FormAnswer,
  FormDetail,
  FormInfo,
  PermissionReply,
  PermissionRequestModel,
  PermissionSavedInfo,
} from './types'

// ============================================
// Permission
// ============================================

/**
 * 获取待处理的权限请求。
 *
 * v2 优先用按会话的 `permission.list`（裸数组）；
 * 给了 sessionId 时用它，否则用位置级 `permission.request.list`。
 */
export async function getPendingPermissions(
  sessionId?: string,
  directory?: string,
  serverId?: string,
): Promise<PermissionRequestModel[]> {
  const sdk = getSDKClient(serverId)

  if (sessionId) {
    const target = resolveSessionTarget(sessionId, serverId)
    return await sdk.permission.list({ sessionID: target.sessionId })
  }

  const result = await sdk.permission.request.list({ location: locationParam(directory, serverId) })
  return result.data
}

/**
 * 回复权限请求。
 *
 * v2 的字段是 `decision`；且必须带 sessionID。
 */
export async function replyPermission(
  requestId: string,
  decision: PermissionReply,
  message?: string,
  _directory?: string,
  sessionId?: string,
  serverId?: string,
): Promise<boolean> {
  if (!sessionId) {
    throw new Error('replyPermission: sessionId is required in OpenCode v2')
  }
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  await sdk.permission.reply({
    sessionID: target.sessionId,
    requestID: requestId,
    decision,
    message,
  })
  return true
}

/**
 * 列出已保存的「总是允许」规则（v2 新增）。
 */
export async function getSavedPermissions(projectID?: string, serverId?: string): Promise<PermissionSavedInfo[]> {
  const sdk = getSDKClient(serverId)
  return await sdk.permission.saved.list({ projectID })
}

/**
 * 删除一条已保存的权限规则（v2 新增）。
 */
export async function removeSavedPermission(id: string, serverId?: string): Promise<void> {
  const sdk = getSDKClient(serverId)
  await sdk.permission.saved.remove({ id })
}

// ============================================
// Form（取代 v1 的 Question）
// ============================================

/**
 * 获取待处理的表单。
 *
 * 与权限一致：给了 sessionId 用按会话接口（裸数组），
 * 否则用全局 `form.list`（{ location, data }）。
 */
export async function getPendingForms(
  sessionId?: string,
  directory?: string,
  serverId?: string,
): Promise<FormInfo[]> {
  const sdk = getSDKClient(serverId)

  if (sessionId) {
    const target = resolveSessionTarget(sessionId, serverId)
    return await sdk.session.form.list({ sessionID: target.sessionId })
  }

  const result = await sdk.form.list({ location: locationParam(directory, serverId) })
  return result.data
}

/**
 * 获取表单详情（含 state）。
 */
export async function getFormDetail(
  sessionId: string,
  formId: string,
  serverId?: string,
): Promise<FormDetail> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  return await sdk.session.form.get({ sessionID: target.sessionId, formID: formId })
}

/**
 * 提交表单答案。
 *
 * v2 的答案是 `{ [fieldKey]: FormValue }` 的键值对象，
 * 不是 v1 的位置数组。
 */
export async function replyForm(
  sessionId: string,
  formId: string,
  answer: FormAnswer,
  serverId?: string,
): Promise<boolean> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  await sdk.session.form.reply({ sessionID: target.sessionId, formID: formId, answer })
  return true
}

/**
 * 取消表单（取代 v1 的 question.reject）。
 */
export async function cancelForm(
  sessionId: string,
  formId: string,
  message?: string,
  serverId?: string,
): Promise<boolean> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  await sdk.session.form.cancel({ sessionID: target.sessionId, formID: formId, message })
  return true
}
