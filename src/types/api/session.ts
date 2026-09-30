import type {
  Session as SDKSession,
  SessionCreateData as SDKSessionCreateData,
  SessionForkData as SDKSessionForkData,
  SessionListData as SDKSessionListData,
  SessionStatus as SDKSessionStatus,
  SessionUpdateData as SDKSessionUpdateData,
} from './v1Model'
import type { FileDiff } from './file'

export type SessionStatus = SDKSessionStatus

export type SessionStatusMap = Record<string, SessionStatus>

export type SessionSummary = NonNullable<SDKSession['summary']>

export type SessionShare = NonNullable<SDKSession['share']>

/**
 * 回退状态（内部形状）
 *
 * ⚠️ **阶段 3a**：V1 的 `revert.diff`（补丁文本）在 V2 里换成了 `files`（逐文件结构化 diff），
 * 两者语义不同不能互转，所以这里用**交叉类型**在 V1 形状上**追加** `files`：
 *   - V1 字段（`messageID` / `partID?` / `snapshot?` / `diff?`）保留 —— 下游按它们读
 *   - `files?` 是 V2 新增（`Session.Revert.files`），供「回退影响哪些文件」的展示用
 *
 * 为什么不直接改 `v1Model.ts`：硬性约束禁止改 B 桶 104 个导出（`v1Model.ts` 整体）。
 */
export type SessionRevert = NonNullable<SDKSession['revert']> & {
  /** V2 新增：本轮回退涉及的文件 diff（V1 无对应字段，V1 的 `diff` 是整段补丁文本） */
  files?: FileDiff[]
}

export type Session = SDKSession

export type SessionListParams = NonNullable<SDKSessionListData['query']>

export type SessionCreateParams = NonNullable<SDKSessionCreateData['query']> & NonNullable<SDKSessionCreateData['body']>

export type SessionUpdateParams = NonNullable<SDKSessionUpdateData['body']>

export type SessionForkParams = NonNullable<SDKSessionForkData['query']> & NonNullable<SDKSessionForkData['body']>
