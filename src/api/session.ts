// ============================================
// Session API Functions
// 基于 @opencode/client（OpenCode V2）: /api/session 相关接口
// ============================================
//
// 阶段 3a 完成情况：
//   ✅ getSessions（列表）        GET /api/session
//   ✅ getSession（详情）         GET /api/session/{id}
//   ✅ getSessionStatus           GET /api/session/active（V1 叫 /session/status）
//   ✅ getSessionDiff             GET /api/session/{id}/diff
//   ✅ getLastTurnDiff            GET /api/session/{id}/diff（**默认即最新一轮**）
//   ✅ createSession              POST /api/session（body 里的 location）
//   ✅ updateSession              PATCH /api/session/{id}
//   ✅ deleteSession              DELETE /api/session/{id}（SDK 方法名 remove）
//   ✅ abortSession               POST /api/session/{id}/interrupt
//   ✅ stageRevert / commitRevert / clearRevert
//                                 POST .../revert/stage → POST .../revert/commit → DELETE .../revert
//   ✅ forkSession                POST /api/session/{id}/fork（body `{before}`）
//   ✅ summarizeSession           POST /api/session/{id}/compact
//   ✅ getSessionChildren         GET /api/session?parentID=
//   ⛔ 阶段 3b 已移除：shareSession / unshareSession / getSessionTodos（V2 无对应端点）
//
// 🔴 本文件最重要的两条 V2 陷阱：
//   1. `GET /api/session`（列表）**只认裸 `directory` 查询参数**。
//      实测：不带 directory 时不会报错，而是**静默返回全局所有项目**的会话。
//      → 见 v2Convert.sessionDirectory()
//   2. `POST /api/session`（创建）**忽略 location 中间件与请求头**，
//      只认 **body 里的 `location`**；缺省回落到服务进程的 `process.cwd()`
//      （源码 packages/server/src/handlers/session.ts:136）。
// ============================================

import { getSDKClient } from './sdk'
import { resolveSessionTarget } from '../utils/sessionKey'
import { sessionDirectory, toInternalSession, toInternalSessionStatusMap, toInternalRevert } from './v2Convert'
import { formatPathForApi } from '../utils/directoryUtils'
import { normalizeFileDiffs } from '../types/api/file'
import type { ApiSession, SessionListParams, FileDiff } from './types'
import type { SessionRevert, SessionStatusMap } from '../types/api/session'

// ============================================
// Session Status & Diff
// ============================================

/**
 * 获取所有 session 的当前状态
 *
 * V1: `sdk.session.status({ directory })` → SessionStatusMap（4 态）
 * V2: `sdk.session.active()`             → { [sessionID]: SessionActive }
 *     ⚠️ 语义变化：V2 **只返回"活跃"的会话**，不在表里 = 空闲；
 *        且该端点**不接受任何目录参数**（服务级）。转换见 toInternalSessionStatusMap()。
 */
export async function getSessionStatus(_directory?: string, serverId?: string): Promise<SessionStatusMap> {
  const sdk = getSDKClient(serverId)
  const active = await sdk.session.active()
  return toInternalSessionStatusMap(active)
}

/**
 * 🔴 V2 的 `GET /api/session/{id}/diff` 语义变了：**它是「按轮次」的 diff，不是全量**
 *
 * 官方 openapi 描述（v2.0.19 二进制导出）原文：
 * > Structured per-file diffs of the files a turn changed. A turn runs from the first
 * > prompt after the session was last idle until its next idle marker…
 * > `from`: User message whose turn to diff. **Defaults to the turn of the newest user message.**
 * > `to`: Later user message whose turn ends the range.
 *
 * 也就是说：
 *   - **不传 `from`** → 只返回**最新一轮**的 diff（= V1 的 `getLastTurnDiff` 语义）
 *   - 传 `from` + `to` → 返回这两条用户消息之间**跨多轮**的 diff
 *
 * ⚠️ 阶段 1 把 V1 的 `getSessionDiff`（全量）直接映成了不传参数的 `session.diff()`，
 *    于是它**悄悄退化成"只显示最后一轮"** —— 这是本次（阶段 3a）修掉的 bug。
 *    修法：先查出会话里**最早/最新一条 user 消息**，把它们当 `from`/`to` 传进去，
 *    覆盖整段历史。查询用 `limit=1 + type=user + order=asc|desc`，两个请求都很轻。
 *    （`from`/`to` 必须是 **user 消息**，否则服务端返回 `TurnRangeError`。）
 */
async function findTurnBoundaryMessages(
  sdk: ReturnType<typeof getSDKClient>,
  sessionID: string,
): Promise<{ from?: string; to?: string }> {
  const query = { sessionID, limit: 1, type: 'user' as const }
  const [oldest, newest] = await Promise.all([
    sdk.message.list({ ...query, order: 'asc' }).catch(() => undefined),
    sdk.message.list({ ...query, order: 'desc' }).catch(() => undefined),
  ])
  return {
    from: oldest?.data?.[0]?.id,
    to: newest?.data?.[0]?.id,
  }
}

/**
 * 获取 session 的 diff
 * 返回可在 UI 中渲染的 SnapshotFileDiff（过滤缺少 file 的异常项）
 *
 * V1: `sdk.session.diff({ sessionID, directory, messageID })` —— 全量 diff
 * V2: `sdk.session.diff({ sessionID, from, to, context })` —— **按轮次**，
 *     所以这里显式传 `from`（最早一条 user 消息）/ `to`（最新一条 user 消息）
 *     才能拿到「整段会话」的 diff（见上方长注释）。
 *
 * ⚠️ 这是 session 作用域端点，**不要传目录**（传了也会被忽略，location 由 session 行决定）。
 * 好消息：V2 的 `FileDiffInfo` 与内部 `FileDiff` 字段完全一致，无需转换。
 */
export async function getSessionDiff(
  sessionId: string,
  _directory?: string,
  _messageId?: string,
  serverId?: string,
): Promise<FileDiff[]> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)

  // 兜底：拿不到 user 消息边界时退化为 V2 默认（= 最新一轮），至少不报错。
  const { from, to } = await findTurnBoundaryMessages(sdk, target.sessionId)
  const diffs = await sdk.session.diff({
    sessionID: target.sessionId,
    ...(from ? { from } : {}),
    // `to` 必须晚于 `from`；两者相同（只有一个用户回合）时传了也无害，但省掉更清晰
    ...(to && to !== from ? { to } : {}),
  })
  return normalizeFileDiffs(diffs)
}

/**
 * 获取当前可见用户消息对应的**本轮** diff
 *
 * V2 里这个能力**就是 diff 的默认行为**：不传 `from` 时服务端返回
 * 「最新一条 user 消息所在轮次」的 diff（见上方长注释）。
 * 所以这里不需要任何额外参数，比 V1 更简单。
 *
 * ⚠️ 仍然依赖 `getSessionMessages()` 吗？—— **不依赖了**。
 *    阶段 1 的占位说明写的是「依赖阶段 2 的消息模型」，那是当时的判断；
 *    阶段 3a 核实后确认 V2 的 diff 端点自带「最新一轮」语义，无需前端先拉消息。
 */
export async function getLastTurnDiff(sessionId: string, directory?: string, serverId?: string): Promise<FileDiff[]> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  // `directory` 只用于多服务器定位（resolveSessionTarget 已处理），不发给服务端
  void directory
  return normalizeFileDiffs(await sdk.session.diff({ sessionID: target.sessionId }))
}

// ============================================
// Session CRUD
// ============================================

/**
 * 获取 session 列表
 *
 * 🔴 V2 关键陷阱（阶段 1 实测）：`GET /api/session` **只认裸 `directory` 参数**。
 *   - 传 `?location[directory]=` → 被静默忽略
 *   - 只带 `x-opencode-directory` 请求头 → 被静默忽略
 *   - 什么都不带 → **静默返回全局所有项目的会话**（不报错！）
 * 因此这里必须显式传 `directory`，见 v2Convert.sessionDirectory()。
 *
 * V1 的 `roots` / `start` 参数在 V2 中已删除（V2 改为 `parentID` / `cursor` 分页），
 * 这里不再转发。
 */
export async function getSessions(params: SessionListParams = {}, serverId?: string): Promise<ApiSession[]> {
  const sdk = getSDKClient(serverId)
  const { directory, search, limit } = params
  const result = await sdk.session.list({
    directory: sessionDirectory(directory, serverId, 'GET /api/session'),
    search,
    limit,
  })
  return result.data.map(toInternalSession)
}

/**
 * 获取单个 session
 *
 * V2 是 session 作用域端点：location 由 session 行本身决定，**不传目录**。
 */
export async function getSession(sessionId: string, _directory?: string, serverId?: string): Promise<ApiSession> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  return toInternalSession(await sdk.session.get({ sessionID: target.sessionId }))
}

/**
 * 创建 session
 *
 * 🔴 V2 关键陷阱（阶段 1 实测 + 源码确认，阶段 2b 实测再次确认）：
 *   `POST /api/session` 的 handler 是
 *     `location: ctx.payload.location ?? { directory: AbsolutePath.make(process.cwd()) }`
 *   （packages/server/src/handlers/session.ts:136）
 *   —— 它**完全忽略 location 中间件和 `x-opencode-directory` 请求头**，
 *   只认 body 里的 `location`；不传就落到**服务进程的 cwd**。
 *   实测：只带请求头创建会话，建出来的会话 location 是服务端 cwd，不是目标目录，且**不报错**。
 *   → 所以这里**必须**把目录写进 body 的 `location`。
 *
 * ⚠️ V2 的 `SessionCreateInput` 没有 `title` 以外的 V1 字段：
 *   `{ id?, title?, agent?, model?, location?, metadata?, permissions? }`
 *   —— V1 的 `parentID` **不在**创建入参里（父子关系由 fork / 子 agent 自己建立），
 *      所以形参保留了 `parentID` 但**不发送**，仅在调用方需要时由上层处理。
 */
export async function createSession(
  params: {
    directory?: string
    title?: string
    /** @deprecated V2 的创建入参没有 parentID（保留形参只为不改调用方签名） */
    parentID?: string
    /** V2 新增：创建时即指定会话模型（会话级，之后可用 session.switchModel 改） */
    model?: { providerID: string; modelID: string; variant?: string }
    agent?: string
  } = {},
  serverId?: string,
): Promise<ApiSession> {
  const sdk = getSDKClient(serverId)
  const directory = formatPathForApi(params.directory, serverId)

  const created = await sdk.session.create({
    title: params.title,
    agent: params.agent,
    model: params.model
      ? {
          // V1 用 modelID，V2 的 ModelRef 用 id（与 v2Convert.toInternalSession 一致）
          id: params.model.modelID,
          providerID: params.model.providerID,
          variant: params.model.variant,
        }
      : undefined,
    // 🔴 目录只认 body 里的 location（见上面的陷阱说明）
    ...(directory ? { location: { directory } } : {}),
  })

  return toInternalSession(created)
}

/**
 * 更新 session（改名）
 *
 * V1: `sdk.session.update({ sessionID, directory, title, time })` → Session（返回更新后的会话）
 * V2: `sdk.session.update({ sessionID, title?, metadata?, permissions? })` → **void**
 *     → 所以写完要**回读一次**（`session.get`）才能保持「返回更新后的会话」这个约定，
 *       否则 `Header.tsx` / `PaneHeader.tsx` 里的 `updated.title` 会变成 undefined。
 *
 * 🔴 **V2 删除了「归档会话」能力**（阶段 3b 复核后确认，且**官方自己也缺**）：
 *    - `SessionUpdateInput` 只有 `title` / `metadata` / `permissions`，没有 `time.archived`；
 *    - v2.0.19 的 server handler / protocol / core 里 grep `archiv` **零命中**
 *      （数据库 `session_v2.time_archived` 列还在，但没有任何写入口；本地库 660 个会话里
 *       `time_archived` **全为 NULL**，实测印证）；
 *    - 官方 V2 app 的 `packages/app/src/home/sessions/controller.tsx:325` 同样写着
 *      `// TODO: Restore archiving when the V2 client exposes a session archive API.`
 *    → 本函数已删掉 `params.time` 入参（阶段 3b），UI 的「归档」入口（侧栏）已一并移除。
 */
export async function updateSession(
  sessionId: string,
  params: { title?: string },
  _directory?: string,
  serverId?: string,
): Promise<ApiSession> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)

  await sdk.session.update({ sessionID: target.sessionId, title: params.title })
  // 回读：V2 的 update 返回 void，而调用方需要「更新后的会话」
  return toInternalSession(await sdk.session.get({ sessionID: target.sessionId }))
}

/**
 * 删除 session
 * V2: `DELETE /api/session/{id}` —— ⚠️ SDK 方法名从 `delete` 改成 **`remove`**。
 * 官方描述：*"Delete session and its child sessions"*（**子会话会一起删**）。
 */
export async function deleteSession(sessionId: string, _directory?: string, serverId?: string): Promise<boolean> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  await sdk.session.remove({ sessionID: target.sessionId })
  return true
}

// ============================================
// Session Actions
// ============================================

/**
 * 中止 session 的当前生成
 *
 * V1: `POST /session/{id}/abort` → boolean
 * V2: `POST /api/session/{id}/interrupt` → `{ interrupted: boolean }`
 *
 * ⚠️ 语义细节（openapi 原文）：
 *   *"Interrupt active execution owned by this OpenCode process. Returns interrupted=true when an
 *     active execution was interrupted and false for the idle no-op."*
 *   → **会话本来就空闲时返回 false，不是错误**。调用方不要把 false 当失败。
 *
 * ⚠️ 事件侧：用户中断后服务端会下发 `session.execution.interrupted`（`reason:"user"`）
 *   + `session.step.failed`（`error.type === 'aborted'`）。
 *   阶段 2b 已把 `execution.interrupted` 映射为「idle + onSessionIdle + onMessagesInvalidated」，
 *   所以这里**不需要**再手动 `messageStore.handleSessionIdle()`（`useChatSession` 里那句是冗余的
 *   本地兜底，保留无副作用）。
 */
export async function abortSession(sessionId: string, _directory?: string, serverId?: string): Promise<boolean> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  const result = await sdk.session.interrupt({ sessionID: target.sessionId })
  return result.interrupted
}

// ============================================
// 回退（V2 三段式：stage → commit → clear）
// ============================================
//
// 🔴 V1 的 `revert` / `unrevert` **两个端点都已删除**，V2 换成三段式：
//
//   | 阶段 | 端点 | 语义 |
//   |---|---|---|
//   | **stage**  | `POST /api/session/{id}/revert/stage`  | 设置/移动「回退边界」到某条消息，并把文件快照恢复到该边界（可用 `files:false` 只动边界不动文件） |
//   | **commit** | `POST /api/session/{id}/revert/commit` | **真正落地**：删除边界及其之后的所有消息 + 清空 revert 标记 |
//   | **clear**  | `DELETE /api/session/{id}/revert`      | **撤销暂存**：把文件快照恢复回去 + 清空 revert 标记（消息本来就没删，所以"取消回退"= 让它们重新可见） |
//
// 源码依据（tag v2.0.19）：
//   - `packages/core/src/session/revert.ts` —— stage 只写 `session.revert = {messageID, snapshot, files}`
//     并 restore 文件快照；**不删消息**。clear 只 restore 文件快照 + 清标记。
//     commit 只发 `RevertEvent.Committed`。
//   - `packages/core/src/session/projector.ts:739` —— Committed 事件才真正
//     `DELETE FROM session_message WHERE seq >= boundary.seq`。
//   - `packages/core/src/session/session.ts:165` —— **发新消息（prompt）会自动 commit**
//     （注释原文：*"Commit a staged revert only after preparation succeeds, before admitting new work."*）
//     → 所以「回退后改一下再发送」这条自然流不需要前端显式 commit。
//
// ⚠️ 与 V1 的**行为差异**（UI 必须自己处理）：
//   stage 之后，**被回退的消息仍然留在服务端**，`GET .../message` 依然会返回它们。
//   所以「回退后消息消失」这件事**必须由前端按 `session.revert.messageID` 过滤** ——
//   这正是 `messageStore` 的 `revertState` 在做的事（阶段 2a 已实现）。

/**
 * 回退：把「回退边界」暂存到指定消息（V2 三段式的第一段）
 *
 * @param messageId 边界消息 id。**该消息本身也会被回退**（stage 之后 commit 会从它开始删）。
 * @param options.files 是否同时把文件快照恢复到该边界。默认 `true`（与 V1 revert 行为一致）。
 *                      `false` = 只挪动消息边界、不动磁盘文件。
 * @returns 服务端当前的 revert 状态（`{messageID, partID?, snapshot?, files?}`）
 */
export async function stageRevert(
  sessionId: string,
  messageId: string,
  options: { files?: boolean } = {},
  _directory?: string,
  serverId?: string,
): Promise<SessionRevert> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  const revert = await sdk.session.revert.stage({
    sessionID: target.sessionId,
    messageID: messageId,
    ...(options.files === undefined ? {} : { files: options.files }),
  })
  // stage 一定会返回一个 revert（服务端保证），所以这里断言非空
  return toInternalRevert(revert)!
}

/**
 * 回退：**落地**已暂存的回退（V2 三段式的第二段）
 *
 * 官方描述只有一句 *"Commit staged revert"*，但源码里它会：
 *   ① 删除边界及其之后的**全部消息**（含排队中的 inbox 项）② 清空 `session.revert` 标记
 *   ③ 重置该会话的 instruction 状态（`InstructionState.reset`）
 *
 * ⚠️ **不可逆**（消息真的从库里删掉了）。前端的「撤销」走 clear，不要走 commit。
 * ⚠️ 没有暂存回退时调用是**幂等无操作**（源码 `if (!session.revert) return`）。
 */
export async function commitRevert(sessionId: string, _directory?: string, serverId?: string): Promise<void> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  await sdk.session.revert.commit({ sessionID: target.sessionId })
}

/**
 * 回退：**清除**已暂存的回退（V2 三段式的第三段）—— 相当于 V1 的 `unrevert`
 *
 * 会把 stage 时改动的文件快照恢复回去，并清空 `session.revert` 标记；
 * 消息从未被删除，所以清掉标记后它们会重新出现在消息列表里。
 */
export async function clearRevert(sessionId: string, _directory?: string, serverId?: string): Promise<void> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  await sdk.session.revert.clear({ sessionID: target.sessionId })
}

// ============================================
// Fork / 摘要 / 子会话
// ============================================
//
// ⛔ 阶段 3b 已移除本文件里的三个「V2 无端点」函数：
//   - `shareSession` / `unshareSession` —— V2 删除了分享端点
//     （配置层只留 `share: "auto"` 策略，无 API；本地库 `session_share` 表 0 行、
//      `session_v2.share_url` 全为 NULL，实测印证）。
//   - `getSessionTodos` —— V2 删除了待办端点，事件侧也没有 `todo.updated`
//     （阶段 2b 已确认源码中不存在该事件）。
//   对应的 UI 入口（ShareDialog / Header 分享按钮 / InputFooter 待办面板）已一并删除。

/**
 * Fork session
 *
 * V1: `POST /session/{id}/fork`，body `{ messageID }` —— messageID 指定的消息**不包含**在新会话里
 * V2: `POST /api/session/{id}/fork`，body **`{ before? }`** —— 语义同样是
 *     *"Create a child session by copying projected history **before** a message.
 *       Omit before to copy the full history."*
 *     → 字段名从 `messageID` 改成 `before`，**语义一致**（都不含该消息）。
 *     （SDK 类型里另有一个 `Session.ForkBoundary = {type:'before'|'through', messageID}`，
 *       那是 `Session.Info.fork.boundary` 这个**只读字段**的形状，不是请求体 —— 别搞混。）
 */
export async function forkSession(
  sessionId: string,
  messageId?: string,
  _directory?: string,
  serverId?: string,
): Promise<ApiSession> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  const forked = await sdk.session.fork({
    sessionID: target.sessionId,
    ...(messageId ? { before: messageId } : {}),
  })
  return toInternalSession(forked)
}

/**
 * 总结 session
 *
 * V1: `POST /session/{id}/summarize`，body `{ providerID, modelID, auto? }`
 * V2: **已删除**；替代品 `POST /api/session/{id}/compact`（SDK：`session.compact`）
 *
 * ⚠️ 语义变化：V2 的 compact **不接受模型参数**（`{id?, delivery?}`）——
 *    用哪个模型压缩由会话/服务端决定。所以这里**忽略** `params` 里的模型信息，
 *    只保留形参以免改动调用方签名（写注释说明，避免后来者以为模型生效了）。
 * ⚠️ 和 prompt 一样是**非阻塞**的（返回 `SessionInboxCompaction` 入队记录），
 *    真正的压缩进度由 `session.compaction.*` 事件推送。
 */
export async function summarizeSession(
  sessionId: string,
  _params: { providerID: string; modelID: string; auto?: boolean },
  _directory?: string,
  serverId?: string,
): Promise<boolean> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  await sdk.session.compact({ sessionID: target.sessionId })
  return true
}

/**
 * 获取子 session
 *
 * V1: `GET /session/{id}/children`（**已删除**）
 * V2: `GET /api/session?parentID=<id>`（SDK：`session.list({ parentID })`）
 *
 * ⚠️ 目录参数：`GET /api/session` **只认裸 `directory`**（见 getSessions 的注释）。
 *    这里优先用调用方给的 directory；拿不到就不传 —— `parentID` 本身已经唯一，
 *    跨项目扫描也不会返回错的子会话，只是白扫一点数据。
 */
export async function getSessionChildren(
  sessionId: string,
  directory?: string,
  serverId?: string,
): Promise<ApiSession[]> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  const result = await sdk.session.list({
    parentID: target.sessionId,
    directory: sessionDirectory(directory, target.serverId, 'GET /api/session?parentID='),
  })
  return result.data.map(toInternalSession)
}

// ⛔ 阶段 3b 已移除 `ApiTodo` / `getSessionTodos()`：V2 删除了待办端点，
//    事件侧也没有 `todo.updated`（阶段 2b 已确认源码中不存在）→ 待办功能整体下架。
//    UI 入口（InputFooter 的待办面板 + todoStore）已一并删除。
//    注意：**历史消息里的 `todowrite` 工具卡片仍会被渲染**（TodoRenderer），
//    因为本地库里 328 条 `todowrite` 工具调用所在会话**都在 V2 的 session_v2 表里**（可见）。

/**
 * 读取某个 location 上**全部**待处理表单（`GET /api/form`）
 *
 * 放在 session.ts 而不是 permission.ts，是因为它的消费方（usePermissionHandler 的
 * refreshPendingRequests）与权限列表成对出现；Form 的详细说明见 `src/api/form.ts`。
 */
export { listPendingForms } from './form'
