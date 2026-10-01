// ============================================
// Session Types — OpenCode v2 原生
//
// v2 的会话类型直接来自 @opencode/client，本文件只做
// 「取别名 + 收敛输入形状」两件事，不再包装 v1 概念。
//
// 与 v1 的关键差异（UI 必须按此调整）：
//   - 目录从 `session.directory` 移到 `session.location.directory`
//   - 没有 `share` / `summary` / `version` / `time.compacted`
//   - 新增 `cost` / `tokens` / `outcome` / `subpath` / `metadata` / `permissions`
//   - `revert` 新增 `files`，回退拆成 stage / commit / clear 三个动作
// ============================================

import type {
  SessionActive as V2SessionActive,
  SessionCreateInput as V2SessionCreateInput,
  SessionForkInput as V2SessionForkInput,
  SessionInfo as V2SessionInfo,
  SessionListInput as V2SessionListInput,
  SessionRevert as V2SessionRevert,
  SessionStatus as V2SessionStatus,
  SessionUpdateInput as V2SessionUpdateInput,
} from '@opencode/client/promise'

/** 会话实体 */
export type Session = V2SessionInfo

/** 会话运行状态：idle / busy / retry */
export type SessionStatus = V2SessionStatus

/** sessionID → 状态。v2 由 `session.active()` 与 `session.status` 事件共同维护 */
export type SessionStatusMap = Record<string, SessionStatus>

/**
 * v2 的 `session.active()` 只返回「正在运行」的会话集合。
 * 保留独立别名，避免与完整 status map 混淆。
 */
export type SessionActive = V2SessionActive

/** 会话的回退（staged revert）状态 */
export type SessionRevert = V2SessionRevert

/** `session.list()` 的查询参数（v2 为 location + 分页游标） */
export type SessionListParams = V2SessionListInput

/** `session.create()` 的入参 */
export type SessionCreateParams = V2SessionCreateInput

/** `session.update()` 的入参 */
export type SessionUpdateParams = V2SessionUpdateInput

/** `session.fork()` 的入参 */
export type SessionForkParams = V2SessionForkInput

/**
 * 取会话所在目录。
 *
 * v2 把目录放在 `location.directory`；这里提供唯一入口，
 * 避免调用点各自记忆字段路径。
 */
export function sessionDirectory(session: Pick<Session, 'location'> | null | undefined): string | undefined {
  return session?.location?.directory
}
