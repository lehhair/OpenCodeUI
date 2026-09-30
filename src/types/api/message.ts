// ============================================
// V2 消息模型（Session.Message.Info 联合）—— 阶段 2a 重写
// ============================================
//
// 本文件是**读侧**（历史消息加载与渲染）的类型真相源。
//
// V2 把 V1 的两层结构推翻，换成**扁平联合 + 游标分页**：
//
//   V1  GET /session/{id}/message      →  MessageWithParts[]        （{info, parts} 两层）
//   V2  GET /api/session/{id}/message  →  { data, cursor }          （扁平联合 + 游标）
//
// 结构对照见 docs/opencode-v2-migration.md §5。
//
// ── 照 v2.0.19 源码 + openapi 核实的关键事实（非推测）────────────────────────
//
// 1. **路径是 `GET /api/session/{sessionID}/message`**，不是 `GET /api/message`。
//    SDK 入口是**顶层** `client.message.list()`（不是 `client.session.message.list()`）。
//    源码：packages/protocol/src/groups/message.ts（tag v2.0.19）。
//
// 2. **判别字段是 `type`**（V1 用 `role`），共 **11 种**。注意 TypeScript 类型名
//    与线上的 `type` 字符串**不一致**：`SessionMessageAgentSelected` 的
//    `type` 实际是 `"agent-switched"`（同理 model-switched / location-switched）。
//
// 3. **消息里没有 `sessionID`** —— V1 每条消息都带，V2 一律不带（会话上下文由
//    请求路径给出）。转换层必须由调用方把 sessionID 补进去，否则
//    `messageStore` / `useChatSession` 里所有按 session 分组的逻辑都会失效。
//
// 4. **Assistant 的 content 里 text / reasoning 没有 `id`** —— 只有 tool 有。
//    而 UI 需要 id 做 React key 与折叠状态 → 转换层按 `消息id:类型:序号` 合成。
//
// 5. **游标方向是相对于本次排序的，不是绝对时间方向**：
//    `order=desc`（默认，新→旧）时 `cursor.next` = 更旧、`cursor.previous` = 更新。
//    `cursor` 与 `order` **互斥**（同时传会 400 InvalidCursorError）。
//    完整推导见 src/api/message.ts 的 `getSessionMessages()` 注释。
//
// 6. `limit` 在服务端是 `NumberFromString` 且**限定 1..200**，省略时默认 50。
//
// 7. ⚠️ 游标**不表示"还有没有更多"**：只要本页非空，`previous` / `next` 都会返回
//    一个值，即使该方向已经没有数据（跟过去会拿到空数组）。判断"还有更多"
//    必须靠 `limit+1` 溢出法，见 src/api/message.ts。
// ============================================

import type {
  // ── 消息联合与成员 ────────────────────────────────────────────────
  SessionMessageInfo as SDKSessionMessageInfo,
  SessionMessageUser as SDKSessionMessageUser,
  SessionMessageAssistant as SDKSessionMessageAssistant,
  SessionMessageSystem as SDKSessionMessageSystem,
  SessionMessageSkill as SDKSessionMessageSkill,
  SessionMessageShell as SDKSessionMessageShell,
  SessionMessageSynthetic as SDKSessionMessageSynthetic,
  SessionMessageIdle as SDKSessionMessageIdle,
  SessionMessageCompaction as SDKSessionMessageCompaction,
  SessionMessageCompactionRunning as SDKSessionMessageCompactionRunning,
  SessionMessageCompactionCompleted as SDKSessionMessageCompactionCompleted,
  SessionMessageCompactionFailed as SDKSessionMessageCompactionFailed,
  SessionMessageAgentSelected as SDKSessionMessageAgentSelected,
  SessionMessageModelSelected as SDKSessionMessageModelSelected,
  SessionMessageLocationSwitched as SDKSessionMessageLocationSwitched,
  // ── Assistant 内容 ───────────────────────────────────────────────
  SessionMessageAssistantText as SDKAssistantText,
  SessionMessageAssistantReasoning as SDKAssistantReasoning,
  SessionMessageAssistantTool as SDKAssistantTool,
  SessionMessageAssistantRetry as SDKAssistantRetry,
  SessionMessageToolStateStreaming as SDKToolStateStreaming,
  SessionMessageToolStateRunning as SDKToolStateRunning,
  SessionMessageToolStateCompleted as SDKToolStateCompleted,
  SessionMessageToolStateError as SDKToolStateError,
  SessionMessageProviderState as SDKProviderState,
  // ── 工具产出 ─────────────────────────────────────────────────────
  ToolContent as SDKToolContent,
  ToolTextContent as SDKToolTextContent,
  ToolFileContent as SDKToolFileContent,
  // ── 用户附件（V2 的 Prompt.* 系列）────────────────────────────────
  PromptFileAttachment as SDKPromptFileAttachment,
  PromptAgentAttachment as SDKPromptAgentAttachment,
  PromptSkillAttachment as SDKPromptSkillAttachment,
  PromptFileSource as SDKPromptFileSource,
  PromptMention as SDKPromptMention,
  // ── 分页 / 响应 ──────────────────────────────────────────────────
  SessionMessagesResponse as SDKSessionMessagesResponse,
  // ── 公共标量 ─────────────────────────────────────────────────────
  SessionStructuredError as SDKSessionStructuredError,
  TokenUsageInfo as SDKTokenUsageInfo,
  ModelRef as SDKModelRef,
  LocationPublicRef as SDKLocationPublicRef,
} from '@opencode/client'

// ============================================
// 一、V2 消息联合（11 种）—— 读侧主类型
// ============================================

/**
 * V2 会话消息联合（`Session.Message.Info`），按 `type` 判别，共 11 种。
 *
 * ⚠️ 与 V1 的 `Message`（`UserMessage | AssistantMessage`）**不兼容**：
 *    - V1 靠 `role: 'user' | 'assistant'` 二分；
 *    - V2 靠 `type` 十一分，且 user / assistant 只是其中两种。
 *
 * 11 种按"渲染时是否产生内容"可分为三类：
 *  ① 有实际内容：`user`、`assistant`、`system`、`synthetic`、`shell`、`skill`、`compaction`
 *  ② 状态标记：`idle`（一轮结束）
 *  ③ 会话设置变更：`agent-switched`、`model-switched`、`location-switched`
 */
export type SessionMessageInfo = SDKSessionMessageInfo

/** 消息的判别字段取值集合（`type`） */
export type SessionMessageType = SessionMessageInfo['type']

/**
 * 可**过滤**的消息类型 —— ⚠️ 比 `SessionMessageType` 少一个 `'idle'`。
 *
 * 依据：`packages/protocol/src/groups/message.ts`（tag v2.0.19）里
 * `SessionMessagesQuery.type` 的枚举**只列了 10 个**，没有 `idle`；
 * 但同一文件的响应联合 `PublicSessionMessage` **包含** `SessionMessage.Idle`。
 * → 即 `idle` 消息**会正常返回**，只是**不能按它过滤**（传了会 400）。
 * 这是 V2 自身的枚举不一致，不是本项目的问题（阶段 2a 实测记录）。
 */
export type SessionMessageFilterType = Exclude<SessionMessageType, 'idle'>

// ── ① 用户消息 ────────────────────────────────────────────────────

/**
 * 用户消息（`type: 'user'`）
 *
 * 与 V1 `UserMessage` 的字段差异（逐条）：
 *   | 概念 | V1 | V2 |
 *   |---|---|---|
 *   | 文本 | `parts[].type === 'text'` | **`text`（直接字段）** |
 *   | 附件 | `parts[].type === 'file'` | **`files`**（`PromptFileAttachment[]`） |
 *   | 指定 agent | `parts[].type === 'agent'` | **`agents`** |
 *   | 技能 | —（V1 无） | **`skills`**（新增） |
 *   | `sessionID` | ✅ 有 | ❌ **没有**（需调用方补） |
 *   | `agent` | ✅ 顶层字段 | ❌ 移到 `metadata.agent`（**非契约字段**，实测官方 TUI 会写） |
 *   | `model` | ✅ 顶层字段 | ❌ 移到 `metadata.model`（同上） |
 *   | `summary` | ✅ 有 | ❌ 删除 |
 *   | `role` | `'user'` | 改名为 `type` |
 *   | `time.completed` | ✅ 有 | ❌ 只剩 `time.created` |
 */
export type SessionMessageUser = SDKSessionMessageUser

// ── ② 助手消息 ────────────────────────────────────────────────────

/**
 * 助手消息（`type: 'assistant'`）
 *
 * 与 V1 `AssistantMessage` 的字段差异（逐条）：
 *   | 概念 | V1 | V2 |
 *   |---|---|---|
 *   | 内容 | `parts: Part[]`（**独立数组**，靠 messageID 关联） | **`content`（内嵌数组）** |
 *   | `sessionID` / `parentID` | ✅ 有 | ❌ **都没有**（父子关系改用会话树 `parentID`） |
 *   | 模型 | `modelID` + `providerID` 两个散字段 | **`model: ModelRef`**（`{id, providerID, variant?}`） |
 *   | `mode` | ✅ 有 | ❌ 删除 |
 *   | `path`（cwd/root） | ✅ 有 | ❌ 删除 |
 *   | `summary`（是否摘要） | ✅ 有 | ❌ 删除 |
 *   | 成本 / 用量 | 分散在 `step-finish` part | **`cost` / `tokens`（顶层，且可选）** |
 *   | `finish` | `string` | 收窄为 6 个字面量联合 |
 *   | `rawFinish` | ❌ 无 | ✅ 新增 |
 *   | 错误 | `error: MessageError`（`{name,data}` 判别联合） | **`error: SessionStructuredError`**（`{type,message,status?}` 扁平） |
 *   | 重试 | `retry` part | **`retry` 字段**（内嵌） |
 *   | 快照 | `snapshot` part | `snapshot` 字段（`{start,end,files?}`） |
 *   | 步骤分隔 | `step-start` / `step-finish` part | ❌ 删除 → 见 `SessionMessageIdle` |
 */
export type SessionMessageAssistant = SDKSessionMessageAssistant

/** Assistant 的 `content` 元素联合（3 种） */
export type SessionMessageAssistantContent =
  | SessionMessageAssistantText
  | SessionMessageAssistantReasoning
  | SessionMessageAssistantTool

/**
 * 助手文本（`type: 'text'`）
 *
 * ⚠️ **没有 `id`**（V1 `TextPart` 有 `id` / `sessionID` / `messageID`）。
 * ⚠️ **没有 `synthetic` 标志**（V1 有）→ V2 改用独立的 `system` / `synthetic` **消息类型**。
 */
export type SessionMessageAssistantText = SDKAssistantText

/** 推理过程（`type: 'reasoning'`）。同样**没有 `id`**。 */
export type SessionMessageAssistantReasoning = SDKAssistantReasoning

/**
 * 工具调用（`type: 'tool'`）
 *
 * 与 V1 `ToolPart` 的字段差异：
 *   | 概念 | V1 | V2 |
 *   |---|---|---|
 *   | 调用 id | `callID` | **`id`**（改名） |
 *   | 工具名 | `tool` | **`name`**（改名） |
 *   | 状态 | `state.status: pending\|running\|completed\|error` | **`streaming`\|running\|completed\|error**（`pending` → `streaming`，且此时 `input` 是**字符串**） |
 *   | 时间 | `state.time: {start,end}` | **`time: {created,ran?,completed?}`**（移到工具层） |
 *   | 产出 | `state.output: string` + `state.title` + `state.attachments` | **`state.content: ToolContent[]`**（`title`/`attachments` 均删除） |
 */
export type SessionMessageAssistantTool = SDKAssistantTool

/** 工具状态机（4 态，按 `status` 判别） */
export type SessionMessageToolState =
  | SessionMessageToolStateStreaming
  | SessionMessageToolStateRunning
  | SessionMessageToolStateCompleted
  | SessionMessageToolStateError

/** 工具输入仍在流式传输中：`input` 是**未解析的原始字符串**（V1 的 `pending`） */
export type SessionMessageToolStateStreaming = SDKToolStateStreaming

/** 工具执行中 */
export type SessionMessageToolStateRunning = SDKToolStateRunning

/** 工具成功完成：产出在 `content`（非空数组） */
export type SessionMessageToolStateCompleted = SDKToolStateCompleted

/** 工具失败：错误是 `SessionStructuredError`（V1 这里是 `error: string`） */
export type SessionMessageToolStateError = SDKToolStateError

/** 工具产出的内容块（`text` | `file`） */
export type ToolContent = SDKToolContent

export type ToolTextContent = SDKToolTextContent

export type ToolFileContent = SDKToolFileContent

/** 供应商透传状态（`Record<string, JsonValue>`，本项目不做解释） */
export type SessionMessageProviderState = SDKProviderState

/** 重试记录（V1 是独立的 `retry` part，V2 内嵌在 assistant 上） */
export type SessionMessageAssistantRetry = SDKAssistantRetry

// ── ③ 系统消息 ────────────────────────────────────────────────────

/**
 * 系统消息（`type: 'system'`）—— **V2 新增**
 *
 * 实测用途：指令/上下文更新通知。`description` 是给人看的短摘要
 * （例：`"Instructions updated: core/environment"`），`text` 是给模型看的原文。
 */
export type SessionMessageSystem = SDKSessionMessageSystem

// ── ④ 技能激活 ────────────────────────────────────────────────────

/** 技能激活记录（`type: 'skill'`）—— **V2 新增** */
export type SessionMessageSkill = SDKSessionMessageSkill

// ── ⑤ shell 命令消息 ──────────────────────────────────────────────

/**
 * shell 命令消息（`type: 'shell'`）—— **V2 新增**
 *
 * ⚠️ 与工具里的 `shell` 工具（`assistant.content[].name === 'shell'`）**不是一回事**：
 *    这是会话级的独立消息类型。
 */
export type SessionMessageShell = SDKSessionMessageShell

// ── ⑥ 合成消息 ────────────────────────────────────────────────────

/**
 * 合成消息（`type: 'synthetic'`）—— **V2 新增**
 *
 * 可由 `POST /api/session/{id}/synthetic` 写入；实测官方用它在转录里
 * 插入 shell 作业产出（`metadata.source === 'shell'`）。
 */
export type SessionMessageSynthetic = SDKSessionMessageSynthetic

// ── ⑦ 空闲标记 ────────────────────────────────────────────────────

/**
 * 空闲标记（`type: 'idle'`）—— **V2 新增，替代 V1 的 step 分隔符**
 *
 * 语义（源码注释原文）：*"Marks the Session going idle: every step since the
 * previous marker belongs to one turn"* —— 即**一轮对话的结束边界**。
 */
export type SessionMessageIdle = SDKSessionMessageIdle

// ── ⑧ 上下文压缩 ──────────────────────────────────────────────────

/** 上下文压缩（`type: 'compaction'`，按 `status` 再分 3 态） */
export type SessionMessageCompaction = SDKSessionMessageCompaction

export type SessionMessageCompactionRunning = SDKSessionMessageCompactionRunning

export type SessionMessageCompactionCompleted = SDKSessionMessageCompactionCompleted

export type SessionMessageCompactionFailed = SDKSessionMessageCompactionFailed

// ── ⑨⑩⑪ 会话设置变更记录 ─────────────────────────────────────────

/** 切换 agent 记录（`type: 'agent-switched'`） */
export type SessionMessageAgentSelected = SDKSessionMessageAgentSelected

/** 切换模型记录（`type: 'model-switched'`） */
export type SessionMessageModelSelected = SDKSessionMessageModelSelected

/** 切换目录记录（`type: 'location-switched'`） */
export type SessionMessageLocationSwitched = SDKSessionMessageLocationSwitched

// ============================================
// 二、用户附件（V2 的 `Prompt.*` 系列）
// ============================================
//
// V1 把附件建模成 `file` / `agent` 两种 **Part**，挂在 `parts[]` 上；
// V2 改成 User 消息上的三个**扁平数组**，且结构完全不同：
//   - V1 `FilePart`：`{ id, mime, filename?, url, source? }`（url 可直接渲染）
//   - V2 `PromptFileAttachment`：`{ data(base64), mime, source, name?, description?, mention? }`
//     ⚠️ **没有 url / id / filename**，图片内容以 base64 内联 → 转换层要自己拼 data URL。

/** 用户附件：文件 */
export type PromptFileAttachment = SDKPromptFileAttachment

/** 用户附件：agent（`@agent` 提及） */
export type PromptAgentAttachment = SDKPromptAgentAttachment

/** 用户附件：技能 */
export type PromptSkillAttachment = SDKPromptSkillAttachment

/** 附件来源：内联（base64 在 `data` 里）或 URI */
export type PromptFileSource = SDKPromptFileSource

/** 提及范围（在原始输入文本中的起止位置） */
export type PromptMention = SDKPromptMention

// ============================================
// 三、分页（游标）
// ============================================

/**
 * 单页响应（`SessionMessagesResponse`）
 *
 * ⚠️ 与 V1 的 `MessageWithParts[]` 是**不兼容**的结构：
 *    V1 直接返回数组，V2 返回 `{ data, cursor }`。
 */
export type SessionMessagesResponse = SDKSessionMessagesResponse

/** 游标对。⚠️ 只要本页非空，两者都会给出值，**不代表该方向还有数据** */
export interface MessageCursor {
  /** 按本次排序的"上一页"游标 */
  previous: string | null
  /** 按本次排序的"下一页"游标 */
  next: string | null
}

/**
 * `GET /api/session/{sessionID}/message` 的查询参数
 *
 * ⚠️ `cursor` 与 `order` **互斥**（同时传 → 400 InvalidCursorError），
 *    因为游标里已经编码了排序方向（源码 `cursor.encode` 把 order 写进游标）。
 */
export interface MessageListParams {
  /** 每页条数。服务端限定 **1..200**，省略时默认 50（DefaultMessagesLimit） */
  limit?: number
  /** 首页排序：`desc` = 新→旧（**默认**），`asc` = 旧→新。⚠️ 与 `cursor` 互斥 */
  order?: 'asc' | 'desc'
  /** 上一页返回的游标，原样回传。⚠️ 与 `order` 互斥 */
  cursor?: string
  /**
   * 按类型过滤（在分页**之前**生效）。
   * ⚠️ 翻页时必须**原样带上**，否则页边界会错位。
   * ⚠️ 不能传 `'idle'` —— 服务端的过滤枚举里没有它（见 `SessionMessageFilterType`）。
   */
  type?: SessionMessageFilterType
}

/**
 * 本项目内部使用的"一页消息"
 *
 * 与 `SessionMessagesResponse` 的区别：`messages` 里的 `cursor` 已归一化成
 * 非可选的 `string | null`（服务端可能给 `undefined`，JSON 里是 `null`）。
 */
export interface MessagePage {
  /** 本页消息，顺序与请求的 `order` 一致 */
  messages: SessionMessageInfo[]
  /** 游标 */
  cursor: MessageCursor
  /**
   * 本页之后**是否真的还有**更多消息（按本次排序的方向）。
   *
   * ⚠️ 服务端的 `cursor` 无法表达这一点（非空页永远给游标），
   *    所以这里由 API 层用 `limit + 1` 溢出法算出来。
   */
  hasMore: boolean
}

// ============================================
// 四、公共标量（V2）
// ============================================

/**
 * V2 的结构化错误（`Session.StructuredError`）
 *
 * ⚠️ 与 V1 的 `MessageError`（`{name, data}` 判别联合，5 种）完全不同：
 *    V2 是扁平的 `{type, message, status?}`，`type` 是**开放字符串**。
 *    转换层负责把它映射回 UI 认识的那 5 种，见 `messageConversion.ts`。
 */
export type SessionStructuredError = SDKSessionStructuredError

/** token 用量（V2 与 V1 字段一致，无变化） */
export type SessionTokenUsage = SDKTokenUsageInfo

/**
 * 模型引用（`Model.Ref`）
 *
 * ⚠️ 注意字段名：**`id`**（V1 是 `modelID`）。转换层需改名。
 */
export type SessionModelRef = SDKModelRef

/** 目录引用（`Location.PublicRef` = `{ directory }`） */
export type SessionLocationPublicRef = SDKLocationPublicRef

// ============================================
// 五、阶段 2b 已删除的 V1 别名
// ============================================
//
// 下面这一整组 V1 别名（`UserMessage` / `AssistantMessage` / `Message` /
// `Part` 联合 / 12 种 Part / `ToolState` / 各种 `*Input` …）在阶段 2a 时
// **不能删**，因为被冻结的事件层（`src/api/events.ts`）钉住了。
//
// 阶段 2b 重写事件层后已全部无引用，**整体删除**：
//   - 定义源头 `src/types/api/v1Model.ts` 的 A 桶 66 个已删除
//   - 本文件的别名（含 `MessageSummary` / `FileSourceType`）随之删除
//   - `src/api/types.ts` / `src/types/api/index.ts` 的转发也已清理
//
// V2 侧请用：`SessionMessageInfo`（消息联合）、`SessionMessageAssistantContent`
// （助手内容块）、`SessionStructuredError`（错误）。
