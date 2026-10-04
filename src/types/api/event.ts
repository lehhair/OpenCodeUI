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

import type { AssistantMessage } from './message'
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
  SessionInboxDeliveryChanged,
  SessionInboxEnqueued,
  SessionMessageInfo,
  SessionEventDurable,
  SessionMoved,
  SessionPermissions,
  SessionReasoningDelta,
  SessionReasoningEnded,
  SessionReasoningStarted,
  SessionRenamed,
  SessionRetryScheduled,
  SessionRevertCleared,
  SessionRevertCommitted,
  SessionRevertStaged,
  SessionStatus,
  SessionStatusUpdated,
  SessionStepEnded,
  SessionStepFailed,
  SessionStepStarted,
  SessionStepStreamed,
  SessionSynthetic,
  SessionTextDelta,
  SessionTextEnded,
  SessionTextStarted,
  SessionToolCalled,
  SessionToolFailed,
  SessionUsageUpdated,
  SessionToolInputDelta,
  SessionToolInputEnded,
  SessionToolInputStarted,
  SessionToolProgress,
  SessionToolSuccess,
  SessionViewed,
  SessionModelSelected,
  SessionCompactionStarted,
  SessionCompactionDelta,
  SessionCompactionEnded,
  SessionCompactionFailed,
  SessionShellStarted,
  SessionShellEnded,
  SessionSkillActivated,
  SessionInstructionsUpdated,
  V2Event,
  V2EventServerConnected,
  FilesystemChanged,
  FormCancelled,
  FormCreated,
  FormReplied,
  McpStatusChanged,
  ModelUpdated,
  ProjectUpdated,
  ProviderUpdated,
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

/**
 * provider / model 目录失效（负载为空 `{}`）。
 *
 * 真机验证（v2.0.14）：这两个事件在连接后与配置变更时确实会推。
 * 官方的处理是 invalidate + 重新 sync 该 location 的 provider/model 目录
 *（packages/client/src/solid/data.ts:1208-1215）。
 */
export type ProviderUpdatedPayload = ProviderUpdated['data']

export type ModelUpdatedPayload = ModelUpdated['data']

export type InboxEnqueuedPayload = SessionInboxEnqueued['data']

export type InboxDeliveredPayload = SessionInboxDelivered['data']

export type InboxCancelledPayload = SessionInboxCancelled['data']

export type InboxDeliveryChangedPayload = SessionInboxDeliveryChanged['data']

/**
 * 助手内容的完整快照事件负载。
 *
 * 注意：`session.message.content.updated` 属于 **durable** 事件
 * （见 `SessionEventDurable`），通过 `session.log()` 重放；
 * 它**不在**实时 `event.subscribe()` 的 `V2Event` 联合里。
 * 因此这里从 durable 联合中提取，而不是从 `V2Event`。
 */
export type SessionContentUpdatedEvent = Extract<SessionEventDurable, { type: 'session.message.content.updated' }>

export type SessionContentUpdatedPayload = SessionContentUpdatedEvent['data']

/**
 * 服务器已连接。
 *
 * v2 的 `server.connected` 负载是 `{}`（既没有服务端时间戳，也没有其它信息），
 * 因此这个回调**不带参数**——之前的签名要求传整个事件对象，导致分发层不得不
 * 把 event 硬塞给只想要负载的回调。需要时间戳的调用方自行取本地时间。
 */
export type ServerConnectedPayload = V2EventServerConnected['data']

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

/** 重试已排期：负载与 UI 的 RetryPart 一一对应（attempt / at / error） */
export type RetryScheduledPayload = SessionRetryScheduled['data']

/** 注入的系统上下文（合成消息） */
export type SyntheticPayload = SessionSynthetic['data']

/** 会话用量（成本 / token）更新 */
export type UsageUpdatedPayload = SessionUsageUpdated['data']

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

export type SessionModelSelectedPayload = SessionModelSelected['data']

// ---- 压缩 ----

export type CompactionStartedPayload = SessionCompactionStarted['data']

export type CompactionDeltaPayload = SessionCompactionDelta['data']

export type CompactionEndedPayload = SessionCompactionEnded['data']

export type CompactionFailedPayload = SessionCompactionFailed['data']

// ---- shell / skill / instructions ----

export type ShellStartedPayload = SessionShellStarted['data']

export type ShellEndedPayload = SessionShellEnded['data']

export type SkillActivatedPayload = SessionSkillActivated['data']

export type InstructionsUpdatedPayload = SessionInstructionsUpdated['data']

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

/**
 * 事件信封上、负载之外的信息。
 *
 * 官方 data.ts 的处理器拿得到整个事件；本仓的分发层只传 data，
 * 因此这里把信封里真正需要的三样东西单独传一个 facts 对象。
 *
 * **刻意不含 sessionID**：sessionID 必须来自负载（调用方注入已 scoped 的值），
 * 从原始事件里读会在多服务器下串会话。
 */
export interface EventFacts {
  /** 事件 id —— 官方 messageIDFromEvent 用它派生 idle/synthetic/shell/compaction 的消息 id */
  id?: string
  /** 事件创建时间 —— reasoning/compaction/idle 的 time.created / time.completed / time.ran */
  created?: number
  /**
   * 事件信封 metadata —— step.started / shell.started / instructions.updated 会透传。
   *
   * 类型刻意与 `AssistantMessage['metadata']` 完全一致：store 的 `EventFacts`
   * 用的是同一个表达式，两边必须结构相同，否则调用点无法直接转发。
   */
  metadata?: AssistantMessage['metadata']
}

export interface EventCallbacks {
  // ---- 会话生命周期 ----
  onSessionCreated?: (data: SessionCreatedPayload, facts?: EventFacts) => void
  onSessionRenamed?: (data: SessionRenamedPayload, facts?: EventFacts) => void
  onSessionDeleted?: (data: SessionDeletedPayload, facts?: EventFacts) => void
  onSessionIdle?: (data: SessionIdlePayload, facts?: EventFacts) => void
  onSessionStatus?: (data: SessionStatusPayload, facts?: EventFacts) => void
  onSessionViewed?: (data: SessionViewedPayload, facts?: EventFacts) => void
  onSessionMoved?: (data: SessionMovedPayload, facts?: EventFacts) => void
  onSessionForked?: (data: SessionForkedPayload, facts?: EventFacts) => void
  onSessionPermissions?: (data: SessionPermissionsPayload, facts?: EventFacts) => void

  // ---- 消息快照 ----
  /** 完整消息内容替换（含最终 content 数组） */
  onMessageContentUpdated?: (data: SessionContentUpdatedPayload, facts?: EventFacts) => void

  // ---- 文本流 ----
  onTextStarted?: (data: TextStartedPayload, facts?: EventFacts) => void
  onTextDelta?: (data: TextDeltaPayload, facts?: EventFacts) => void
  onTextEnded?: (data: TextEndedPayload, facts?: EventFacts) => void

  // ---- 推理流 ----
  onReasoningStarted?: (data: ReasoningStartedPayload, facts?: EventFacts) => void
  onReasoningDelta?: (data: ReasoningDeltaPayload, facts?: EventFacts) => void
  onReasoningEnded?: (data: ReasoningEndedPayload, facts?: EventFacts) => void

  // ---- 工具流 ----
  onToolInputStarted?: (data: ToolInputStartedPayload, facts?: EventFacts) => void
  onToolInputDelta?: (data: ToolInputDeltaPayload, facts?: EventFacts) => void
  onToolInputEnded?: (data: ToolInputEndedPayload, facts?: EventFacts) => void
  onToolCalled?: (data: ToolCalledPayload, facts?: EventFacts) => void
  onToolProgress?: (data: ToolProgressPayload, facts?: EventFacts) => void
  onToolSuccess?: (data: ToolSuccessPayload, facts?: EventFacts) => void
  onToolFailed?: (data: ToolFailedPayload, facts?: EventFacts) => void

  // ---- 会话内的实时补充信息 ----
  /** 重试已排期：实时补出 RetryPart（否则只在重新加载后才显示） */
  onRetryScheduled?: (data: RetryScheduledPayload, facts?: EventFacts) => void
  /** 注入的系统上下文（合成消息），对应 UI 的 synthetic part */
  onSynthetic?: (data: SyntheticPayload, facts?: EventFacts) => void
  /** 会话用量更新：让上下文用量指示在流式期间就准确 */
  onUsageUpdated?: (data: UsageUpdatedPayload, facts?: EventFacts) => void

  // ---- 会话级切换 / 压缩 / shell / skill / instructions ----
  /** 会话切换了 agent（v2 的 agent 是会话级状态，不在用户消息上） */
  onAgentSelected?: (data: SessionAgentSelectedPayload, facts?: EventFacts) => void
  /** 会话切换了模型（同上；供输入框恢复模型选择） */
  onModelSelected?: (data: SessionModelSelectedPayload, facts?: EventFacts) => void
  /** 压缩（v2 是一条独立消息，不再是挂在消息上的 part） */
  onCompactionStarted?: (data: CompactionStartedPayload, facts?: EventFacts) => void
  onCompactionDelta?: (data: CompactionDeltaPayload, facts?: EventFacts) => void
  onCompactionEnded?: (data: CompactionEndedPayload, facts?: EventFacts) => void
  onCompactionFailed?: (data: CompactionFailedPayload, facts?: EventFacts) => void
  /** shell 生命周期 */
  onShellStarted?: (data: ShellStartedPayload, facts?: EventFacts) => void
  onShellEnded?: (data: ShellEndedPayload, facts?: EventFacts) => void
  /** 激活 skill */
  onSkillActivated?: (data: SkillActivatedPayload, facts?: EventFacts) => void
  /** 指令文件变更（插入 system 消息） */
  onInstructionsUpdated?: (data: InstructionsUpdatedPayload, facts?: EventFacts) => void

  // ---- step ----
  onStepStarted?: (data: StepStartedPayload, facts?: EventFacts) => void
  onStepStreamed?: (data: StepStreamedPayload, facts?: EventFacts) => void
  onStepEnded?: (data: StepEndedPayload, facts?: EventFacts) => void
  onStepFailed?: (data: StepFailedPayload, facts?: EventFacts) => void

  // ---- 执行生命周期 ----
  onExecutionStarted?: (data: ExecutionStartedPayload, facts?: EventFacts) => void
  onExecutionSucceeded?: (data: ExecutionSucceededPayload, facts?: EventFacts) => void
  onExecutionFailed?: (data: ExecutionFailedPayload, facts?: EventFacts) => void
  onExecutionInterrupted?: (data: ExecutionInterruptedPayload, facts?: EventFacts) => void

  // ---- 权限 ----
  onPermissionAsked?: (data: PermissionAskedPayload, facts?: EventFacts) => void
  onPermissionReplied?: (data: PermissionRepliedPayload, facts?: EventFacts) => void

  // ---- 表单（取代 v1 question） ----
  onFormCreated?: (data: FormCreatedPayload, facts?: EventFacts) => void
  onFormReplied?: (data: FormRepliedPayload, facts?: EventFacts) => void
  onFormCancelled?: (data: FormCancelledPayload, facts?: EventFacts) => void

  // ---- 回退 ----
  onRevertStaged?: (data: RevertStagedPayload, facts?: EventFacts) => void
  onRevertCleared?: (data: RevertClearedPayload, facts?: EventFacts) => void
  onRevertCommitted?: (data: RevertCommittedPayload, facts?: EventFacts) => void

  // ---- inbox / 队列 ----
  onInboxEnqueued?: (data: InboxEnqueuedPayload, facts?: EventFacts) => void
  onInboxDelivered?: (data: InboxDeliveredPayload, facts?: EventFacts) => void
  onInboxCancelled?: (data: InboxCancelledPayload, facts?: EventFacts) => void
  onInboxDeliveryChanged?: (data: InboxDeliveryChangedPayload, facts?: EventFacts) => void

  // ---- 外围 ----
  onProjectUpdated?: (data: ProjectUpdatedPayload, facts?: EventFacts) => void
  onWorktreeUpdated?: (data: WorktreeUpdatedPayload, facts?: EventFacts) => void
  onWorktreeResolved?: (data: WorktreeResolvedPayload, facts?: EventFacts) => void
  onVcsBranchUpdated?: (data: VcsBranchUpdatedPayload, facts?: EventFacts) => void
  onMcpStatusChanged?: (data: McpStatusChangedPayload, facts?: EventFacts) => void
  /**
   * provider / model 目录失效 → 调用方应重新拉取模型目录。
   *
   * 本地只有 `useModels` 是模块级缓存（其余目录如 agents/commands/skills 都是
   * 打开即拉，不存在陈旧问题），所以这两个事件的消费方就是它。
   */
  onProviderUpdated?: (data: ProviderUpdatedPayload, facts?: EventFacts) => void
  onModelUpdated?: (data: ModelUpdatedPayload, facts?: EventFacts) => void
  onFilesystemChanged?: (data: FilesystemChangedPayload, facts?: EventFacts) => void
  onPtyCreated?: (data: PtyCreatedPayload, facts?: EventFacts) => void
  onPtyUpdated?: (data: PtyUpdatedPayload, facts?: EventFacts) => void
  onPtyExited?: (data: PtyExitedPayload, facts?: EventFacts) => void
  onPtyDeleted?: (data: PtyDeletedPayload, facts?: EventFacts) => void

  // ---- 连接 ----
  onServerConnected?: () => void
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

  AGENT_SELECTED: 'session.agent.selected',
  MODEL_SELECTED: 'session.model.selected',

  COMPACTION_STARTED: 'session.compaction.started',
  COMPACTION_DELTA: 'session.compaction.delta',
  COMPACTION_ENDED: 'session.compaction.ended',
  COMPACTION_FAILED: 'session.compaction.failed',

  SHELL_STARTED: 'session.shell.started',
  SHELL_ENDED: 'session.shell.ended',

  SKILL_ACTIVATED: 'session.skill.activated',

  INSTRUCTIONS_UPDATED: 'session.instructions.updated',

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
  INBOX_DELIVERY_CHANGED: 'session.inbox.delivery.changed',

  PROJECT_UPDATED: 'project.updated',
  WORKTREE_UPDATED: 'worktree.updated',
  WORKTREE_RESOLVED: 'worktree.resolved',
  VCS_BRANCH_UPDATED: 'vcs.branch.updated',
  MCP_STATUS_CHANGED: 'mcp.status.changed',
  PROVIDER_UPDATED: 'provider.updated',
  MODEL_UPDATED: 'model.updated',
  FILESYSTEM_CHANGED: 'filesystem.changed',

  PTY_CREATED: 'pty.created',
  PTY_UPDATED: 'pty.updated',
  PTY_EXITED: 'pty.exited',
  PTY_DELETED: 'pty.deleted',

  SERVER_CONNECTED: 'server.connected',
} as const satisfies Record<string, V2Event['type']>

export type EventType = V2Event['type']
