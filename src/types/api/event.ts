// ============================================
// Event Types — OpenCode v2 原生（扁平事件流）
//
// ## v2 的事件模型与 v1 根本不同
//
// v1：事件是「对某个 Part 的增量修改」——
//     `message.part.updated` / `message.part.delta` / `message.part.removed`，
//     UI 维护 parts 数组并按 partID 打补丁。
//
// v2：**没有 Part 概念，也没有 PartDelta 事件**。实时输出是一串扁平事件：
//
//   text:      session.text.started → session.text.delta* → session.text.ended
//   reasoning: session.reasoning.started → .delta* → .ended
//   tool:      session.tool.input.started → .delta* → .ended
//              → session.tool.called → session.tool.progress*
//              → session.tool.success | session.tool.failed
//
//   关联键：text/reasoning 用 `data.ordinal`，tool 用 `data.id`。
//   全部携带 `data.sessionID` + `data.assistantMessageID`。
//
//   另有**快照替换**事件 `session.message.content.updated`，携带完整
//   `data.content` 数组，用于校正本地累积的增量。
//
//   `*Delta` 与 `tool.progress` 是**易失**的（无 durable 块），
//   不参与 `session.log()` 重放。
// ============================================

import type {
  EventSubscribeOutput,
  LocationRef,
  PermissionAsked,
  PermissionReplied,
  SessionAgentSelected,
  SessionCreated,
  SessionDeleted,
  SessionExecutionFailed,
  SessionExecutionInterrupted,
  SessionExecutionStarted,
  SessionExecutionSucceeded,
  SessionForked,
  SessionIdle,
  SessionInboxCancelled,
  SessionInboxDelivered,
  SessionInboxEnqueued,
  SessionMessageInfo,
  SessionEventDurable,
  SessionMoved,
  SessionPermissions,
  SessionReasoningDelta,
  SessionReasoningEnded,
  SessionReasoningStarted,
  SessionRenamed,
  SessionRevertCleared,
  SessionRevertCommitted,
  SessionRevertStaged,
  SessionStatus,
  SessionStatusUpdated,
  SessionStepEnded,
  SessionStepFailed,
  SessionStepStarted,
  SessionStepStreamed,
  SessionTextDelta,
  SessionTextEnded,
  SessionTextStarted,
  SessionToolCalled,
  SessionToolFailed,
  SessionToolInputDelta,
  SessionToolInputEnded,
  SessionToolInputStarted,
  SessionToolProgress,
  SessionToolSuccess,
  SessionViewed,
  V2Event,
  V2EventServerConnected,
  FilesystemChanged,
  FormCancelled,
  FormCreated,
  FormReplied,
  McpStatusChanged,
  ProjectUpdated,
  PtyCreated,
  PtyDeleted,
  PtyExited,
  PtyUpdated,
  VcsBranchUpdated,
  WorktreeResolved,
  WorktreeUpdated,
} from '@opencode/client/promise'

// ============================================
// 事件联合类型
// ============================================

/** 全部 v2 事件 */
export type GlobalEvent = V2Event

/** `client.event.subscribe()` 产出的元素 */
export type OpenCodeEvent = EventSubscribeOutput

export type { LocationRef, SessionStatus }

// ============================================
// 常用负载别名
// ============================================

export type SessionIdlePayload = SessionIdle['data']

export type SessionStatusPayload = SessionStatusUpdated['data']

export type SessionCreatedPayload = SessionCreated['data']

export type SessionDeletedPayload = SessionDeleted['data']

export type SessionRenamedPayload = SessionRenamed['data']

export type PermissionAskedPayload = PermissionAsked['data']

export type PermissionRepliedPayload = PermissionReplied['data']

export type FormCreatedPayload = FormCreated['data']

export type FormRepliedPayload = FormReplied['data']

export type FormCancelledPayload = FormCancelled['data']

export type ProjectUpdatedPayload = ProjectUpdated['data']

export type WorktreeUpdatedPayload = WorktreeUpdated['data']

export type WorktreeResolvedPayload = WorktreeResolved['data']

export type VcsBranchUpdatedPayload = VcsBranchUpdated['data']

export type McpStatusChangedPayload = McpStatusChanged['data']

export type InboxEnqueuedPayload = SessionInboxEnqueued['data']

export type InboxDeliveredPayload = SessionInboxDelivered['data']

export type InboxCancelledPayload = SessionInboxCancelled['data']

/**
 * 助手内容的完整快照事件负载。
 *
 * 注意：`session.message.content.updated` 属于 **durable** 事件
 * （见 `SessionEventDurable`），通过 `session.log()` 重放；
 * 它**不在**实时 `event.subscribe()` 的 `V2Event` 联合里。
 * 因此这里从 durable 联合中提取，而不是从 `V2Event`。
 */
export type SessionContentUpdatedEvent = Extract<
  SessionEventDurable,
  { type: 'session.message.content.updated' }
>

export type SessionContentUpdatedPayload = SessionContentUpdatedEvent['data']

/** 服务器已连接（v2 为带 type 的事件对象） */
export type ServerConnectedPayload = V2EventServerConnected

// ---- 流式增量负载 ----

export type TextStartedPayload = SessionTextStarted['data']

export type TextDeltaPayload = SessionTextDelta['data']

export type TextEndedPayload = SessionTextEnded['data']

export type ReasoningStartedPayload = SessionReasoningStarted['data']

export type ReasoningDeltaPayload = SessionReasoningDelta['data']

export type ReasoningEndedPayload = SessionReasoningEnded['data']

export type ToolInputStartedPayload = SessionToolInputStarted['data']

export type ToolInputDeltaPayload = SessionToolInputDelta['data']

export type ToolInputEndedPayload = SessionToolInputEnded['data']

export type ToolCalledPayload = SessionToolCalled['data']

export type ToolProgressPayload = SessionToolProgress['data']

export type ToolSuccessPayload = SessionToolSuccess['data']

export type ToolFailedPayload = SessionToolFailed['data']

export type StepStartedPayload = SessionStepStarted['data']

export type StepStreamedPayload = SessionStepStreamed['data']

export type StepEndedPayload = SessionStepEnded['data']

export type StepFailedPayload = SessionStepFailed['data']

// ---- 执行生命周期 ----

export type ExecutionStartedPayload = SessionExecutionStarted['data']

export type ExecutionSucceededPayload = SessionExecutionSucceeded['data']

export type ExecutionFailedPayload = SessionExecutionFailed['data']

export type ExecutionInterruptedPayload = SessionExecutionInterrupted['data']

// ---- 回退 ----

export type RevertStagedPayload = SessionRevertStaged['data']

export type RevertClearedPayload = SessionRevertCleared['data']

export type RevertCommittedPayload = SessionRevertCommitted['data']

// ---- 其他 ----

export type SessionViewedPayload = SessionViewed['data']

export type SessionMovedPayload = SessionMoved['data']

export type SessionForkedPayload = SessionForked['data']

export type SessionPermissionsPayload = SessionPermissions['data']

export type SessionAgentSelectedPayload = SessionAgentSelected['data']

export type FilesystemChangedPayload = FilesystemChanged['data']

export type PtyCreatedPayload = PtyCreated['data']

export type PtyUpdatedPayload = PtyUpdated['data']

export type PtyExitedPayload = PtyExited['data']

export type PtyDeletedPayload = PtyDeleted['data']

/** 消息实体（content.updated 之外的完整消息） */
export type { SessionMessageInfo }

// ============================================
// 事件回调接口（v2 形状）
// ============================================
//
// 与 v1 的差异：
//   - 移除 onPartUpdated / onPartDelta / onPartRemoved（v2 无 Part）
//   - 移除 onQuestion*（并入 onForm*）
//   - 移除 onTodoUpdated（v2 无 todo）
//   - 移除 onSessionError / onSessionDiff（改为 execution.* 与 session.diff 拉取）
//   - 新增 text / reasoning / tool 的增量与生命周期回调

export interface EventCallbacks {
  // ---- 会话生命周期 ----
  onSessionCreated?: (data: SessionCreatedPayload) => void
  onSessionRenamed?: (data: SessionRenamedPayload) => void
  onSessionDeleted?: (data: SessionDeletedPayload) => void
  onSessionIdle?: (data: SessionIdlePayload) => void
  onSessionStatus?: (data: SessionStatusPayload) => void
  onSessionViewed?: (data: SessionViewedPayload) => void
  onSessionMoved?: (data: SessionMovedPayload) => void
  onSessionForked?: (data: SessionForkedPayload) => void
  onSessionPermissions?: (data: SessionPermissionsPayload) => void

  // ---- 消息快照 ----
  /** 完整消息内容替换（含最终 content 数组） */
  onMessageContentUpdated?: (data: SessionContentUpdatedPayload) => void

  // ---- 文本流 ----
  onTextStarted?: (data: TextStartedPayload) => void
  onTextDelta?: (data: TextDeltaPayload) => void
  onTextEnded?: (data: TextEndedPayload) => void

  // ---- 推理流 ----
  onReasoningStarted?: (data: ReasoningStartedPayload) => void
  onReasoningDelta?: (data: ReasoningDeltaPayload) => void
  onReasoningEnded?: (data: ReasoningEndedPayload) => void

  // ---- 工具流 ----
  onToolInputStarted?: (data: ToolInputStartedPayload) => void
  onToolInputDelta?: (data: ToolInputDeltaPayload) => void
  onToolInputEnded?: (data: ToolInputEndedPayload) => void
  onToolCalled?: (data: ToolCalledPayload) => void
  onToolProgress?: (data: ToolProgressPayload) => void
  onToolSuccess?: (data: ToolSuccessPayload) => void
  onToolFailed?: (data: ToolFailedPayload) => void

  // ---- step ----
  onStepStarted?: (data: StepStartedPayload) => void
  onStepStreamed?: (data: StepStreamedPayload) => void
  onStepEnded?: (data: StepEndedPayload) => void
  onStepFailed?: (data: StepFailedPayload) => void

  // ---- 执行生命周期 ----
  onExecutionStarted?: (data: ExecutionStartedPayload) => void
  onExecutionSucceeded?: (data: ExecutionSucceededPayload) => void
  onExecutionFailed?: (data: ExecutionFailedPayload) => void
  onExecutionInterrupted?: (data: ExecutionInterruptedPayload) => void

  // ---- 权限 ----
  onPermissionAsked?: (data: PermissionAskedPayload) => void
  onPermissionReplied?: (data: PermissionRepliedPayload) => void

  // ---- 表单（取代 v1 question） ----
  onFormCreated?: (data: FormCreatedPayload) => void
  onFormReplied?: (data: FormRepliedPayload) => void
  onFormCancelled?: (data: FormCancelledPayload) => void

  // ---- 回退 ----
  onRevertStaged?: (data: RevertStagedPayload) => void
  onRevertCleared?: (data: RevertClearedPayload) => void
  onRevertCommitted?: (data: RevertCommittedPayload) => void

  // ---- inbox / 队列 ----
  onInboxEnqueued?: (data: InboxEnqueuedPayload) => void
  onInboxDelivered?: (data: InboxDeliveredPayload) => void
  onInboxCancelled?: (data: InboxCancelledPayload) => void

  // ---- 外围 ----
  onProjectUpdated?: (data: ProjectUpdatedPayload) => void
  onWorktreeUpdated?: (data: WorktreeUpdatedPayload) => void
  onWorktreeResolved?: (data: WorktreeResolvedPayload) => void
  onVcsBranchUpdated?: (data: VcsBranchUpdatedPayload) => void
  onMcpStatusChanged?: (data: McpStatusChangedPayload) => void
  onFilesystemChanged?: (data: FilesystemChangedPayload) => void
  onPtyCreated?: (data: PtyCreatedPayload) => void
  onPtyUpdated?: (data: PtyUpdatedPayload) => void
  onPtyExited?: (data: PtyExitedPayload) => void
  onPtyDeleted?: (data: PtyDeletedPayload) => void

  // ---- 连接 ----
  onServerConnected?: (data: ServerConnectedPayload) => void
  onError?: (error: Error) => void
  onReconnected?: (reason: 'network' | 'server-switch') => void
}

// ============================================
// 事件类型常量
// ============================================

export const EventTypes = {
  SESSION_CREATED: 'session.created',
  SESSION_RENAMED: 'session.renamed',
  SESSION_DELETED: 'session.deleted',
  SESSION_IDLE: 'session.idle',
  SESSION_STATUS: 'session.status',
  SESSION_VIEWED: 'session.viewed',
  SESSION_MOVED: 'session.moved',
  SESSION_FORKED: 'session.forked',
  SESSION_PERMISSIONS: 'session.permissions',

  // 注意：`session.message.content.updated` 是 durable 事件，
  // 不在实时订阅的 V2Event 联合里，因此不列入本表（见 SessionContentUpdatedPayload）。
  // MESSAGE_CONTENT_UPDATED: 'session.message.content.updated',

  TEXT_STARTED: 'session.text.started',
  TEXT_DELTA: 'session.text.delta',
  TEXT_ENDED: 'session.text.ended',

  REASONING_STARTED: 'session.reasoning.started',
  REASONING_DELTA: 'session.reasoning.delta',
  REASONING_ENDED: 'session.reasoning.ended',

  TOOL_INPUT_STARTED: 'session.tool.input.started',
  TOOL_INPUT_DELTA: 'session.tool.input.delta',
  TOOL_INPUT_ENDED: 'session.tool.input.ended',
  TOOL_CALLED: 'session.tool.called',
  TOOL_PROGRESS: 'session.tool.progress',
  TOOL_SUCCESS: 'session.tool.success',
  TOOL_FAILED: 'session.tool.failed',

  STEP_STARTED: 'session.step.started',
  STEP_STREAMED: 'session.step.streamed',
  STEP_ENDED: 'session.step.ended',
  STEP_FAILED: 'session.step.failed',

  EXECUTION_STARTED: 'session.execution.started',
  EXECUTION_SUCCEEDED: 'session.execution.succeeded',
  EXECUTION_FAILED: 'session.execution.failed',
  EXECUTION_INTERRUPTED: 'session.execution.interrupted',

  PERMISSION_ASKED: 'permission.asked',
  PERMISSION_REPLIED: 'permission.replied',

  FORM_CREATED: 'form.created',
  FORM_REPLIED: 'form.replied',
  FORM_CANCELLED: 'form.cancelled',

  REVERT_STAGED: 'session.revert.staged',
  REVERT_CLEARED: 'session.revert.cleared',
  REVERT_COMMITTED: 'session.revert.committed',

  INBOX_ENQUEUED: 'session.inbox.enqueued',
  INBOX_DELIVERED: 'session.inbox.delivered',
  INBOX_CANCELLED: 'session.inbox.cancelled',

  PROJECT_UPDATED: 'project.updated',
  WORKTREE_UPDATED: 'worktree.updated',
  WORKTREE_RESOLVED: 'worktree.resolved',
  VCS_BRANCH_UPDATED: 'vcs.branch.updated',
  MCP_STATUS_CHANGED: 'mcp.status.changed',
  FILESYSTEM_CHANGED: 'filesystem.changed',

  PTY_CREATED: 'pty.created',
  PTY_UPDATED: 'pty.updated',
  PTY_EXITED: 'pty.exited',
  PTY_DELETED: 'pty.deleted',

  SERVER_CONNECTED: 'server.connected',
} as const satisfies Record<string, V2Event['type']>

export type EventType = V2Event['type']
