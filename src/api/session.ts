// ============================================
// Session API — OpenCode v2 原生
//
// ## v1 → v2 关键差异
//
//   - 所有会话方法只按 `sessionID` 定位，**不接受 location/directory**
//     （只有 create / import / list 涉及目录）
//   - `status()`     → `active()`（返回全部「运行中」会话）+ `session.status` 事件
//   - `delete()`     → `remove()`
//   - `abort()`      → `interrupt()`
//   - `revert()`     → `revert.stage()` / `revert.clear()` / `revert.commit()`
//   - `unrevert()`   → `revert.clear()`
//   - `summarize()`  → `compact()`
//   - `children()`   → `list({ parentID })`
//   - `messages()`   → `client.message.list()`（移出 session）
//   - `todo()`       → **v2 已移除**（无替代：整个 todo 能力连同 UI 一并删除）
//   - `share()/unshare()` → 移除（导出改走 `session.export()`）
//   - `archive`      → **v2 无归档端点**（`time.archived` 只读不可写，功能已移除）
//   - `list()` 返回 `{ data, cursor }`，不再是裸数组
// ============================================

import { getSDKClient } from './sdk'
import { isSessionBusyError } from '@opencode/client/promise'
import { locationParam } from './location'
import { resolveSessionTarget } from '../utils/sessionKey'
import { normalizeFileDiffs } from '../types/api/file'
import type { FileDiff, Session, SessionListParams, SessionRevert, SessionStatusMap } from './types'
import type { SessionTransferData, SessionInboxInfo } from '@opencode/client/promise'

// ============================================
// 会话状态
// ============================================

/**
 * 获取所有「运行中」的会话。
 *
 * v2 的 `session.active()` 只返回运行中的会话（`{ [sessionID]: {type:'running'} }`），
 * 完整的 idle/busy/retry 状态由 `session.status` 事件推送，
 * 由 store 维护成 SessionStatusMap。
 */
export async function getActiveSessions(serverId?: string): Promise<Record<string, { type: 'running' }>> {
  const sdk = getSDKClient(serverId)
  return await sdk.session.active()
}

/**
 * 兼容旧调用点：v2 没有「一次性拉全部状态」的接口，
 * 这里把 `active()` 的结果投影成 status map（只有 running 是确定的）。
 */
export async function getSessionStatus(_directory?: string, serverId?: string): Promise<SessionStatusMap> {
  const active = await getActiveSessions(serverId)
  const result: SessionStatusMap = {}
  for (const sessionID of Object.keys(active)) {
    result[sessionID] = { type: 'busy' }
  }
  return result
}

// ============================================
// Diff
// ============================================

/**
 * 获取会话的 diff。
 *
 * v2 的 `session.diff({ sessionID, from?, to?, context? })` 返回 `FileDiffInfo[]`，
 * 其中 `patch` 是 unified diff 文本。
 */
export async function getSessionDiff(
  sessionId: string,
  _directory?: string,
  _messageId?: string,
  serverId?: string,
): Promise<FileDiff[]> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  const diffs = await sdk.session.diff({ sessionID: target.sessionId })
  return normalizeFileDiffs(diffs)
}

// ============================================
// 会话 CRUD
// ============================================

/**
 * 获取会话列表。
 *
 * v2 返回 `{ data, cursor }`；调用点普遍期望数组，这里返回 `data`。
 */
export async function getSessions(params: SessionListParams = {}, serverId?: string): Promise<Session[]> {
  const sdk = getSDKClient(serverId)
  const { directory, parentID, search, limit, order, cursor, project, subpath } = params
  const result = await sdk.session.list({
    directory: locationParam(directory, serverId)?.directory,
    parentID,
    search,
    limit,
    order,
    cursor,
    project,
    subpath,
  })
  return result.data
}

/**
 * 获取子会话。
 *
 * v1 的 `session.children()` 在 v2 折进 `list({ parentID })`。
 */
export async function getSessionChildren(
  sessionId: string,
  _directory?: string,
  serverId?: string,
): Promise<Session[]> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  const result = await sdk.session.list({ parentID: target.sessionId })
  return result.data
}

export async function getSession(sessionId: string, _directory?: string, serverId?: string): Promise<Session> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  return await sdk.session.get({ sessionID: target.sessionId })
}

/**
 * 创建会话。
 *
 * v2 的目录参数是 `location.directory`；title / agent / model 直接传。
 *
 * 注意：v2 **没有**「直接创建子会话」的入口——子会话只能由 task 工具、
 * fork 或 import（带 parentID）产生；把 parentID 塞进 metadata 只会被
 * 服务端原样存储，不会建立父子关系（官方 handlers/session.ts 无此处理），
 * 因此这里不接受 parentID。
 */
export async function createSession(
  params: {
    directory?: string
    title?: string
    agent?: string
    model?: { id: string; providerID: string; variant?: string }
  } = {},
  serverId?: string,
): Promise<Session> {
  const sdk = getSDKClient(serverId)
  const { directory, title, agent, model } = params
  const location = locationParam(directory, serverId)
  return await sdk.session.create({
    title,
    agent,
    model,
    // v2 的 create 里 location.directory 是必填的（给了 location 就必须带目录）
    ...(location ? { location: { directory: location.directory as string } } : {}),
  })
}

/**
 * 更新会话。
 *
 * v2 的 update 接受 title / metadata / permissions，但目前所有调用点只改标题
 * （重命名），因此这里只暴露 `title`——不保留 `metadata` 这个没人传的参数，
 * 它之前只是为了让 `metadata as never` 这个强转有地方待着。
 *
 * 注意：v2 **没有归档端点**——`SessionInfo.time.archived` 只读不可写，
 * 因此 v1 的归档功能整体移除了（不再用 metadata 假装归档）。
 */
export async function updateSession(
  sessionId: string,
  params: { title?: string },
  _directory?: string,
  serverId?: string,
): Promise<Session> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  await sdk.session.update({
    sessionID: target.sessionId,
    title: params.title,
  })
  // v2 的 update 返回 void，回读一次保证调用点拿到最新会话
  return await sdk.session.get({ sessionID: target.sessionId })
}

/** 删除会话（v1 的 delete → v2 的 remove） */
export async function deleteSession(sessionId: string, _directory?: string, serverId?: string): Promise<boolean> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  await sdk.session.remove({ sessionID: target.sessionId })
  return true
}

// ============================================
// 会话动作
// ============================================

/**
 * 中断会话（v1 的 abort → v2 的 interrupt）。
 * 返回是否真的中断了正在进行的执行。
 */
export async function abortSession(sessionId: string, _directory?: string, serverId?: string): Promise<boolean> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  const result = await sdk.session.interrupt({ sessionID: target.sessionId })
  return result.interrupted
}

/**
 * 回退到某条消息（v1 revert → v2 revert.stage）。
 *
 * 服务端在会话执行活跃时会拒绝 stage（409 SessionBusyError），
 * 官方 app 的做法是先 interrupt 再 stage（packages/app/src/session/revert.ts），
 * 这里复刻：遇到 busy 就先中断一次再重试。
 */
export async function revertMessage(
  sessionId: string,
  messageId: string,
  _partId?: string,
  _directory?: string,
  serverId?: string,
): Promise<SessionRevert> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  try {
    return await sdk.session.revert.stage({ sessionID: target.sessionId, messageID: messageId })
  } catch (error) {
    if (!isSessionBusyError(error)) throw error
    await sdk.session.interrupt({ sessionID: target.sessionId }).catch(() => undefined)
    return await sdk.session.revert.stage({ sessionID: target.sessionId, messageID: messageId })
  }
}

/**
 * 取消已 staged 的回退（v1 的 unrevert → v2 revert.clear）。
 */
export async function unrevertSession(sessionId: string, _directory?: string, serverId?: string): Promise<void> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  await sdk.session.revert.clear({ sessionID: target.sessionId })
}

/**
 * 提交已 staged 的回退（v2 新增）。
 */
export async function commitRevert(sessionId: string, _directory?: string, serverId?: string): Promise<void> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  await sdk.session.revert.commit({ sessionID: target.sessionId })
}

/**
 * Fork 会话。
 *
 * v2 用 `before`（消息 ID）表达分叉边界，取代 v1 的 messageID。
 */
export async function forkSession(
  sessionId: string,
  messageId?: string,
  _directory?: string,
  serverId?: string,
): Promise<Session> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  return await sdk.session.fork({ sessionID: target.sessionId, before: messageId })
}

/**
 * 压缩上下文（v1 summarise → v2 compact）。
 *
 * v2 不再需要显式传 provider/model —— 会话已绑定模型。
 */
export async function summarizeSession(
  sessionId: string,
  _params?: { providerID?: string; modelID?: string; auto?: boolean },
  _directory?: string,
  serverId?: string,
): Promise<boolean> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  await sdk.session.compact({ sessionID: target.sessionId })
  return true
}

/**
 * 等待会话进入 idle。
 */
export async function waitSession(sessionId: string, serverId?: string): Promise<void> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  await sdk.session.wait({ sessionID: target.sessionId })
}

// 占位会话构造器在 utils/sessionPlaceholder（纯函数，不经 api 桶导出，
// 否则 mock 了 api 模块的测试会拿到 undefined）
export { createSessionPlaceholder } from '../utils/sessionPlaceholder'
export type { SessionPlaceholderInput } from '../utils/sessionPlaceholder'

// ============================================
// 会话导出 / 导入（取代 v1 的 share / unshare）
// ============================================
/**
 * 导出会话转写。
 *
 * v2 用 export 取代了 v1 的 share：不再生成公开链接，
 * 而是返回 `{ info, messages }` 的可序列化转写数据。
 */
export async function exportSession(
  sessionId: string,
  _directory?: string,
  serverId?: string,
): Promise<SessionTransferData> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  return await sdk.session.export({ sessionID: target.sessionId })
}

/**
 * 导入会话转写。
 *
 * v2 的 import 接受可选 `location`；不传会落到服务端的 process.cwd()
 * （官方 app 传 `location: { directory: project.worktree }`）。
 */
export async function importSession(
  transfer: SessionTransferData,
  directory?: string,
  serverId?: string,
): Promise<Session> {
  const sdk = getSDKClient(serverId)
  const location = locationParam(directory, serverId)
  return await sdk.session.import({
    ...transfer,
    ...(location ? { location: { directory: location.directory as string } } : {}),
  })
}

/**
 * 取本轮可见 diff。
 *
 * v2 的会话不再带 `summary.diffs`，diff 统一由 `session.diff()` 提供，
 * 因此这里退化为直接取会话 diff。
 */
export async function getLastTurnDiff(sessionId: string, directory?: string, serverId?: string): Promise<FileDiff[]> {
  return getSessionDiff(sessionId, directory, undefined, serverId)
}

// ============================================
// Inbox（服务端队列）
//
// v2 的 prompt 是入队语义：delivery='queue' 的条目由服务端在当前回合
// 排空后自动投递。队列视图读 inbox.list，取消/插队走 cancel/update
//（官方 packages/app/src/session/composer/queue.ts 同款）。
// ============================================

/** 列出会话的 inbox 条目（排队中的 prompt / compaction 等） */
export async function getSessionInbox(sessionId: string, serverId?: string): Promise<SessionInboxInfo[]> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  return await sdk.session.inbox.list({ sessionID: target.sessionId })
}

/** 取消 inbox 条目（官方 retractLocal：回声会把转写里的对应用户消息一并撤下） */
export async function cancelInboxItem(sessionId: string, inboxID: string, serverId?: string): Promise<void> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  await sdk.session.inbox.cancel({ sessionID: target.sessionId, inboxID })
}

/** 把排队条目改为 steer（插队注入当前回合） */
export async function steerInboxItem(sessionId: string, inboxID: string, serverId?: string): Promise<void> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  await sdk.session.inbox.update({ sessionID: target.sessionId, inboxID, delivery: 'steer' })
}
