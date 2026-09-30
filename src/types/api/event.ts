// ============================================
// Event API Types —— V2 事件层（阶段 2b 重写）
// ============================================
//
// 阶段 2a 冻结了本文件（仍是 V1 形状）；阶段 2b 按 V2 真实事件名整体重写。
//
// ── V2 事件帧（照 v2.0.19 源码 + 实测确认）──────────────────────────────
//
//   端点：`GET /api/event`（V1 是 `/global/event`）
//   帧格式（`packages/server/src/event-feed.ts:29` 的 `frame()`）：
//       `data: ${JSON.stringify(event)}\n\n`      ← 只有一层 JSON，没有 event: / id: 行
//   事件结构：`{ id, created?, metadata?, location?, type, data }` **扁平**
//   心跳：每 15 秒一行注释 `: heartbeat`（注释行，不是数据行）
//   首帧：连上立刻收到 `{ id, type: "server.connected", data: {} }`
//
// ⚠️ 帧的解析与心跳由 `@opencode/client` 的 `event.subscribe()` 负责
//    （见 `src/api/events.ts` 的取舍说明），本文件只描述**解析后的载荷**。
//
// ── 订阅语义：**易失（volatile）** ──────────────────────────────────────
//
//   官方契约原文：*"Volatile by contract: a slow consumer overflows and fails
//   the stream, and events during disconnection are missed."*
//   → **不回放、不自动重连**；订阅队列 4096，溢出直接断流。
//   → 事件回调里绝不能做耗时操作；断线恢复必须「重订阅 + 重拉」。
//
// ── 事件名对照（V1 → V2，只列本项目真正处理过的）───────────────────────
//
//   message.part.updated   → session.text.* / session.reasoning.* / session.tool.* / session.step.*
//   message.part.delta     → session.text.delta / session.reasoning.delta / session.tool.input.delta
//   message.part.removed   → 取消/回退 → **重拉消息**（无同名事件）
//   message.updated        → session.message.content.updated
//   session.error          → session.execution.failed
//   session.updated        → session.renamed / session.metadata.updated / session.agent.selected /
//                            session.model.selected / session.moved
//   question.asked/replied/rejected → form.created / form.replied / form.cancelled
//   worktree.ready / failed         → worktree.updated / worktree.resolved
//   todo.updated           → ❌ V2 源码中不存在（待办功能移除）
//   lsp.updated            → ❌ 不在 ServerDefinitions（V2 不跑 LSP）
//   session.created / deleted / idle / status、project.updated、permission.asked/replied、
//   vcs.branch.updated、server.connected → ✅ 原样可用
// ============================================

import type {
  V2Event,
  SessionMessageAssistantText,
  SessionMessageAssistantReasoning,
  SessionMessageAssistantTool,
  SessionMessageContentUpdated,
  SessionStatus as V2SessionStatus,
  SessionStructuredError,
  TokenUsageInfo,
  FormInfo,
  PermissionReplied,
  FormCreated,
  FormReplied,
  FormCancelled,
  WorktreeUpdated,
  WorktreeResolved,
  VcsBranchUpdated,
  ProjectUpdated,
  SessionIdle,
  SessionCreated,
} from '@opencode/client'
import type { Session } from './session'
import type { PermissionRequest } from './permission'
import type { Project } from './project'

// ============================================
// 一、事件联合与判别字段
// ============================================

/** V2 事件联合 */
export type V2EventUnion = V2Event | SessionMessageContentUpdated

/**
 * ⚠️ **V2 SDK 自身的联合类型遗漏**（阶段 2b 实测发现）
 *
 * `session.message.content.updated` 在 `@opencode/client` 里**有 schema 类型**
 * （`SessionMessageContentUpdated`），也出现在事件日志联合
 * `SessionEventDurable` 里，**但没有被并进 `V2Event` / `EventSubscribeOutput`**
 * （`dist/promise/generated/types.d.ts:3310` 的联合逐个核对过，确实没有它）。
 *
 * 后果：`client.event.subscribe()` 的静态类型**不包含**这个事件，
 * 直接 `satisfies Record<string, V2Event['type']>` 会编译失败，
 * 而运行时它又可能真的下发 → 只能在这里手工把它并回来。
 * 这是 V2 的枚举/联合不一致（与阶段 2a 发现的「`idle` 能返回但不能过滤」同类），
 * 不是本项目的 bug。
 */
export type SessionMessageContentUpdatedEvent = SessionMessageContentUpdated

/**
 * assistant 消息的 `content[]` 元素（3 种）
 *
 * ⚠️ `@opencode/client` **没有**导出这个联合（只有三个成员各自导出），
 *    所以这里本地拼一个。与 `src/types/api/message.ts` 的
 *    `SessionMessageAssistantContent` 是**同一个结构**，只是来源不同。
 */
export type AssistantContent =
  | SessionMessageAssistantText
  | SessionMessageAssistantReasoning
  | SessionMessageAssistantTool

/** 事件的判别字段取值（`type`） */
export type EventType = V2Event['type']

/** V2 的结构化错误（事件载荷里出现的那份，与消息模型共用） */
export type EventStructuredError = SessionStructuredError

/** token 用量（事件载荷里出现的那份） */
export type EventTokenUsage = TokenUsageInfo

/** 助手消息的结束原因（V2 收窄为 6 个字面量） */
export type AssistantFinish = 'stop' | 'length' | 'tool-calls' | 'content-filter' | 'error' | 'unknown'

// ============================================
// 二、消息族载荷（阶段 2b 核心）
// ============================================

/**
 * `session.message.content.updated` 的载荷
 *
 * 语义：**整条** assistant 消息的 `content` 数组被整体替换。
 * V1 的对应物是 `message.updated`（推整条消息）。
 *
 * ⚠️ V2 的 content 里 text / reasoning **没有 id**，所以「第几块」由数组下标
 *    决定 —— 转换层用 `消息id:content:下标` 合成 UI part id（与阶段 2a 同一规则）。
 */
export interface MessageContentUpdatedPayload {
  sessionID: string
  messageID: string
  /** 新的完整 content 数组（顺序即下标） */
  content: AssistantContent[]
}

/**
 * 单个 content 块的**整块**更新
 *
 * 对接的 V2 事件：
 *   - `session.text.started` / `session.text.ended`
 *   - `session.reasoning.started` / `session.reasoning.ended`
 *   - `session.tool.input.started` / `session.tool.input.ended`
 *   - `session.tool.called` / `session.tool.progress` / `session.tool.success` / `session.tool.failed`
 *
 * `content` 里 tool 块自带 `id`（全局唯一），text / reasoning 块没有 →
 * part id 由 `messageID` + `ordinal` 合成，规则见 `messageConversion.ts`。
 */
export interface PartContentUpdatedPayload {
  sessionID: string
  messageID: string
  /** 该块在 `assistant.content[]` 里的下标（tool 块可省略，它用 `content.id`） */
  ordinal: number
  content: AssistantContent
}

/**
 * step 结束 / 失败带来的**消息级**补丁
 *
 * 对接的 V2 事件：`session.step.ended` / `session.step.failed`。
 *
 * V1 把成本/用量/结束原因放在 `step-finish` **part** 上；V2 把它们上移到
 * assistant 消息顶层。渲染层仍依赖 `step-finish` part（过程拆分与工具组配对），
 * 所以 store 会**同时**更新消息顶层字段并合成一个尾部 step-finish part
 * （与阶段 2a 的 `toUIMessage` 完全同一套规则）。
 */
export interface PartStepEndedPayload {
  sessionID: string
  messageID: string
  finish?: AssistantFinish
  rawFinish?: string
  cost?: number
  tokens?: EventTokenUsage
  error?: SessionStructuredError
}

/**
 * step 开始：**新建 assistant 消息的权威信号**（`session.step.started`）
 *
 * 实测字段（真实事件帧）：
 * `{sessionID, assistantMessageID, agent, model: {id, providerID, variant?}, snapshot?, started}`
 *
 * 为什么需要它：V2 的 `session.text.started` 只给 `assistantMessageID` + `ordinal`，
 * 拿不到 agent / model；而 UI 的助手页脚要显示模型名。有了 step.started，
 * 流式期间就能把 `modelID` / `providerID` / `agent` 填对，不必等一次 REST 重拉。
 */
export interface PartStepStartedPayload {
  sessionID: string
  messageID: string
  agent: string
  model: { id: string; providerID: string; variant?: string }
  started: number
}

/**
 * `handlePartUpdated` 的入参：**content 块更新** / **step 结束** / **step 开始**
 *
 * 为什么合成一个类型：三者在 UI 模型里都表现为「消息内某个 part 或消息元信息的整块更新」，
 * 共用同一个 store 入口可以保证合并/去重/引用稳定性只有一份实现。
 */
export type PartUpdatedPayload =
  | ({ kind: 'content' } & PartContentUpdatedPayload)
  | ({ kind: 'step' } & PartStepEndedPayload)
  | ({ kind: 'step-start' } & PartStepStartedPayload)

/**
 * 增量事件载荷
 *
 * 对接的 V2 事件：`session.text.delta` / `session.reasoning.delta` /
 * `session.tool.input.delta`（对应 V1 的 `message.part.delta`）。
 *
 * ⚠️ `partID` 是**已经算好的 UI part id**（不是 V2 的 id）：
 *   - text / reasoning：`消息id:content:下标`
 *   - tool：工具自身的 id
 * 由 `events.ts` 在分发前算好，store 直接按 id 定位，避免两处各算一遍。
 */
export interface PartDeltaPayload {
  sessionID: string
  messageID: string
  partID: string
  /** 增量落到哪个字段 */
  kind: 'text' | 'reasoning' | 'input'
  delta: string
}

// ============================================
// 三、会话族载荷
// ============================================

/**
 * `session.created` 的载荷
 *
 * ⚠️ 事件里的字段与 REST 的 `Session.Info` **不完全一致**：
 *    - 事件有 `sessionID`（REST 是 `id`）、`slug`、`version`
 *    - 事件**没有** `time`（REST 有 `time.created/updated`）
 *   → 内部 `ApiSession` 的 `time` 用**事件自身的 `created`** 兜底（见 events.ts）。
 */
export type SessionCreatedPayload = SessionCreated['data']

/**
 * 会话元信息变更的**统一补丁**
 *
 * V2 把 V1 的 `session.updated` 拆成了多个事件：
 *   `session.renamed`（title）、`session.metadata.updated`、
 *   `session.agent.selected`、`session.model.selected`、`session.moved`（location）。
 * 消费者（会话列表 / active tab）只关心「哪个会话的哪个字段变了」，
 * 所以这里统一成一个**部分字段**的补丁，缺省表示"这一项没变"。
 */
export interface SessionInfoPatch {
  /** 会话 id（V2 的 `sessionID`） */
  id: string
  title?: string
  directory?: string
  parentID?: string
}

/** `session.deleted` 的载荷（就是 sessionID 本身） */
export type SessionDeletedPayload = { sessionID: string }

/** `session.idle` 的载荷 */
export type SessionIdlePayload = SessionIdle['data']

/** `session.status` 的载荷（`status` 与 V1 的 `SessionStatus` 结构兼容） */
export type SessionStatusPayload = { sessionID: string; status: V2SessionStatus }

/**
 * `session.execution.failed` 的载荷（V1 的 `session.error` 的替代）
 *
 * ⚠️ V1 是 `{name, data}` 判别联合（5 种具名错误），V2 是扁平的
 * `{type, message, status?}` 且 `type` 是**开放字符串**
 * （实测出现：`aborted` / `unknown` / `provider.error` /
 *  `provider.invalid-output` / `tool.execution`）。
 * → 本层**不做** V1 名字的归一化（迁移文档 §9.3 要求删掉那个 shim），
 *   直接把 V2 结构透传；需要判断"是否中止"的消费者按 `type` 关键字判断。
 */
export interface SessionErrorPayload {
  sessionID: string
  error: SessionStructuredError
}

/** `session.usage.updated` 的载荷（会话级累计用量） */
export interface SessionUsagePayload {
  sessionID: string
  cost: number
  tokens: EventTokenUsage
}

/** `session.retry.scheduled` 的载荷 */
export interface SessionRetryPayload {
  sessionID: string
  assistantMessageID: string
  attempt: number
  at: number
  error: SessionStructuredError
}

// ============================================
// 四、其它载荷
// ============================================

/**
 * `server.connected` 的载荷
 *
 * ⚠️ V2 的 `data` 是**空对象**（`{}`），V1 那个 `properties.timestamp` 没有了。
 * `serverStore` 用它做**时钟校准**（服务器时间 ↔ 本地单调时间），拿不到时间戳
 * 就只能放弃校准（`applyServerConnectedTimestamp` 对非数字会直接返回 false）。
 * 这里把事件的 `created`（如果服务端给了）作为尽力而为的兜底。
 */
export interface ServerConnectedPayload {
  timestamp?: unknown
}

/**
 * `permission.asked` 的载荷
 *
 * ⚠️ V2 的原始载荷是 `{id, sessionID, action, resources, save?, source?, message?}`，
 * 与内部 `PermissionRequest`（V1 形状）字段名不同 →
 * 由 `v2Convert.toInternalPermissionRequest()` 转换后交给回调，
 * 这样权限 UI 与 `SessionEventCallbacks` 在本阶段零改动
 * （回复 API 已在阶段 3a 迁移，见 `src/api/permission.ts`）。
 */
export type PermissionAskedPayload = PermissionRequest

/** `permission.replied` 的载荷（V2 形状） */
export type PermissionRepliedPayload = PermissionReplied['data']

/** `form.created` 的载荷（V2 用 Form 体系取代了 V1 的 question） */
export type FormCreatedPayload = FormCreated['data']

/** `form.replied` 的载荷 */
export type FormRepliedPayload = FormReplied['data']

/** `form.cancelled` 的载荷 */
export type FormCancelledPayload = FormCancelled['data']

/** `worktree.updated` 的载荷（V1 `worktree.ready` 的替代） */
export type WorktreeUpdatedPayload = WorktreeUpdated['data']

/** `worktree.resolved` 的载荷（V1 `worktree.failed` 的替代） */
export type WorktreeResolvedPayload = WorktreeResolved['data']

/** `vcs.branch.updated` 的载荷（原样可用） */
export type VcsBranchUpdatedPayload = VcsBranchUpdated['data']

/** `project.updated` 的载荷（原样可用） */
export type ProjectUpdatedPayload = ProjectUpdated['data']

// ============================================
// 五、事件类型常量表（V2 真实事件名）
// ============================================
//
// ⚠️ 只列**本项目真正会处理**的事件 + 少量明确要接的会话事件。
//    值必须与 `@opencode/client` 的 `V2Event['type']` 完全一致 ——
//    下面的 `satisfies` 会在 SDK 改名时让编译失败，起到守卫作用。
//
// ⚠️ `session.step.streamed` **故意不列**：它只是「这一步产生了流式内容」的标记
//    （载荷仅 `{sessionID, assistantMessageID}`），本项目没有任何消费点。
//
// 已**移除**的 V1 常量（V2 无对应事件，见迁移文档 §6.4 存活判定表）：
//   TODO_UPDATED（`todo.updated` 源码中不存在）、LSP_UPDATED（不在 ServerDefinitions）、
//   MESSAGE_*（4 个）、QUESTION_*（3 个）、WORKTREE_READY/FAILED、
//   SESSION_UPDATED / SESSION_ERROR / SESSION_COMPACTED / SESSION_DIFF、
//   TUI_*、FILE_*、WORKSPACE_*、MCP_*、COMMAND_EXECUTED、PTY_*、
//   SERVER_INSTANCE_DISPOSED / GLOBAL_DISPOSED、INSTALLATION_*

export const EventTypes = {
  // ── 消息族（V2 流式事件，阶段 2b 核心）──────────────────────────────
  SESSION_MESSAGE_CONTENT_UPDATED: 'session.message.content.updated',

  SESSION_TEXT_STARTED: 'session.text.started',
  SESSION_TEXT_DELTA: 'session.text.delta',
  SESSION_TEXT_ENDED: 'session.text.ended',

  SESSION_REASONING_STARTED: 'session.reasoning.started',
  SESSION_REASONING_DELTA: 'session.reasoning.delta',
  SESSION_REASONING_ENDED: 'session.reasoning.ended',

  SESSION_TOOL_INPUT_STARTED: 'session.tool.input.started',
  SESSION_TOOL_INPUT_DELTA: 'session.tool.input.delta',
  SESSION_TOOL_INPUT_ENDED: 'session.tool.input.ended',
  SESSION_TOOL_CALLED: 'session.tool.called',
  SESSION_TOOL_PROGRESS: 'session.tool.progress',
  SESSION_TOOL_SUCCESS: 'session.tool.success',
  SESSION_TOOL_FAILED: 'session.tool.failed',

  SESSION_STEP_STARTED: 'session.step.started',
  SESSION_STEP_ENDED: 'session.step.ended',
  SESSION_STEP_FAILED: 'session.step.failed',

  SESSION_RETRY_SCHEDULED: 'session.retry.scheduled',
  SESSION_USAGE_UPDATED: 'session.usage.updated',

  // ── 会话族 ────────────────────────────────────────────────────────
  SESSION_CREATED: 'session.created',
  SESSION_DELETED: 'session.deleted',
  /**
   * ⚠️ **V2 实测：`session.idle` 已废弃、不再下发**（schema 里标了 `// deprecated`）。
   * 保留常量与分发分支是为了「将来恢复了也能用」，**但不要依赖它** ——
   * 「一轮结束」的可用信号是 `session.execution.succeeded/failed/interrupted`
   * （见下方 EXECUTION_*，以及 src/api/events.ts 的分发注释）。
   */
  SESSION_IDLE: 'session.idle',
  /** ⚠️ 同上：`session.status` 在 v2.0.19 实测**从未下发**（busy/idle 都由 execution.* 表达） */
  SESSION_STATUS: 'session.status',
  SESSION_RENAMED: 'session.renamed',
  SESSION_METADATA_UPDATED: 'session.metadata.updated',
  SESSION_AGENT_SELECTED: 'session.agent.selected',
  SESSION_MODEL_SELECTED: 'session.model.selected',
  SESSION_MOVED: 'session.moved',
  SESSION_EXECUTION_FAILED: 'session.execution.failed',
  SESSION_EXECUTION_INTERRUPTED: 'session.execution.interrupted',
  SESSION_EXECUTION_STARTED: 'session.execution.started',
  SESSION_EXECUTION_SUCCEEDED: 'session.execution.succeeded',
  // 取消/回退：V2 的 revert 三段式，到达时转录已变 → 触发「重拉消息」
  SESSION_REVERT_STAGED: 'session.revert.staged',
  SESSION_REVERT_COMMITTED: 'session.revert.committed',
  SESSION_REVERT_CLEARED: 'session.revert.cleared',

  // ── 权限 / 表单 ───────────────────────────────────────────────────
  PERMISSION_ASKED: 'permission.asked',
  PERMISSION_REPLIED: 'permission.replied',
  FORM_CREATED: 'form.created',
  FORM_REPLIED: 'form.replied',
  FORM_CANCELLED: 'form.cancelled',

  // ── 项目 / Worktree / VCS ─────────────────────────────────────────
  PROJECT_UPDATED: 'project.updated',
  WORKTREE_UPDATED: 'worktree.updated',
  WORKTREE_RESOLVED: 'worktree.resolved',
  VCS_BRANCH_UPDATED: 'vcs.branch.updated',

  // ── 服务 ─────────────────────────────────────────────────────────
  SERVER_CONNECTED: 'server.connected',
} as const satisfies Record<string, V2Event['type'] | SessionMessageContentUpdated['type']>

// ============================================
// 六、订阅回调接口（V2 形状）
// ============================================
//
// 命名尽量与 V1 保持一致的，是为了让消费者（useGlobalEvents / SessionContext /
// useChatSession …）的改动集中在**载荷字段**上，而不是回调名上。

export interface EventCallbacks {
  // ── 消息族 ────────────────────────────────────────────────────────
  /** `session.message.content.updated`：整条 assistant 消息的 content 被替换 */
  onMessageUpdated?: (data: MessageContentUpdatedPayload) => void
  /**
   * 单个 part 的整块更新
   *
   * 对接 `session.text.*` / `session.reasoning.*` / `session.tool.*` / `session.step.*`。
   * 入参是判别联合：`kind: 'content'` 是 content 块更新，`kind: 'step'` 是 step 结束。
   */
  onPartUpdated?: (data: PartUpdatedPayload) => void
  /** 增量：`session.text.delta` / `session.reasoning.delta` / `session.tool.input.delta` */
  onPartDelta?: (data: PartDeltaPayload) => void
  /**
   * 转录被外部改动，本地缓存已不可信 → 需要**重拉消息**
   *
   * 对接 `session.revert.staged/committed/cleared` 与 `session.execution.interrupted`
   * （V1 的 `message.part.removed` 没有 V2 对应事件，取消/回退都走这条）。
   */
  onMessagesInvalidated?: (sessionID: string) => void

  // ── 会话族 ────────────────────────────────────────────────────────
  onSessionCreated?: (session: Session) => void
  /** 会话元信息变更（由 renamed / metadata.updated / agent.selected / model.selected / moved 合成） */
  onSessionUpdated?: (patch: SessionInfoPatch) => void
  onSessionDeleted?: (data: SessionDeletedPayload) => void
  onSessionIdle?: (data: SessionIdlePayload) => void
  onSessionError?: (data: SessionErrorPayload) => void
  onSessionStatus?: (data: SessionStatusPayload) => void
  onSessionUsage?: (data: SessionUsagePayload) => void
  onSessionRetry?: (data: SessionRetryPayload) => void

  // ── 权限 / 表单 ───────────────────────────────────────────────────
  onPermissionAsked?: (data: PermissionAskedPayload) => void
  onPermissionReplied?: (data: PermissionRepliedPayload) => void
  onFormCreated?: (data: FormCreatedPayload) => void
  onFormReplied?: (data: FormRepliedPayload) => void
  onFormCancelled?: (data: FormCancelledPayload) => void

  // ── 项目 / Worktree / VCS ─────────────────────────────────────────
  onProjectUpdated?: (data: ProjectUpdatedPayload) => void
  onWorktreeUpdated?: (data: WorktreeUpdatedPayload) => void
  onWorktreeResolved?: (data: WorktreeResolvedPayload) => void
  onVcsBranchUpdated?: (data: VcsBranchUpdatedPayload) => void

  // ── 服务 ─────────────────────────────────────────────────────────
  onServerConnected?: (data: ServerConnectedPayload) => void

  // ── 连接生命周期 ──────────────────────────────────────────────────
  onError?: (error: Error) => void
  onReconnected?: (reason: 'network' | 'server-switch') => void
}

// ============================================
// 七、供其它模块复用的别名
// ============================================
//
// ⚠️ 这几个是**类型别名**（不是 V2 事件载荷），保留是因为下游（useGlobalEvents /
//    SessionContext）在事件回调里直接用到它们，改名会造成无关 diff。

/** 权限请求（V1 形状；回复 API 已在阶段 3a 迁移到 V2） */
export type EventPermissionRequest = PermissionRequest

/** 表单信息（V2 的 Form 体系；渲染器 `FormDialog` 已在阶段 3a 落地） */
export type EventFormInfo = FormInfo

/** 项目（V1 形状；project 链路已在阶段 1/3a 迁移，见 `src/api/client.ts`） */
export type EventProject = Project
