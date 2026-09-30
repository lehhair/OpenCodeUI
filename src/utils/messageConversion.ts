// ============================================
// 消息转换层：V2 扁平消息 → UI 展示模型
// ============================================
//
// 阶段 2a 重写读侧（`toUIMessage` / `toUIMessageInfo` / `toUIMessages` / `isUserUIMessage`）；
// 阶段 2b 新增 `toUIPartFromContent` / `toStepFinishPart`，让**事件侧与读侧共用同一套
// part id 合成规则**（见这两个函数的注释），并删除已无引用的 V1 形状适配函数。
//
//   V1：`{ info, parts }` 两层 —— 转换基本是「类型断言」，UI 模型直接对齐 API
//   V2：`Session.Message.Info` 扁平联合 —— 需要**真正摊平 + 补字段**
//
// ── 为什么不让渲染层直接用 V2 模型 ────────────────────────────────────────
//
// 渲染层（src/features/message/**，约 5,900 行）只认 `src/types/message.ts`。
// 把 V2 摊平成那个模型，渲染组件就能基本零改动。三个必须补的东西：
//
//   1. **`sessionID`**：V2 消息里没有，必须由调用方传进来
//      （messageStore / useSessionManager 都知道当前 session）。
//   2. **part `id`**：V2 的 `assistant.content[]` 里 text / reasoning **没有 id**，
//      只有 tool 有。UI 用 id 做 React key 与折叠状态 → 按 `消息id:类型:序号` 合成。
//      ⚠️ 序号必须**按 content 数组下标**算（不能按同类型计数），否则
//      同一条消息里插入新块会导致已有块的 id 漂移、折叠状态错位。
//   3. **`step-finish`**：V2 删除了 step 分隔 part，把成本/用量移到了
//      `assistant.cost` / `assistant.tokens` / `assistant.finish`。
//      渲染层的「过程 / 最终内容」拆分（splitProcessRenderItems）与
//      工具组配对（groupPartsForRender）**依赖 step-finish** →
//      这里在 assistant 末尾**合成一个** step-finish part 承载这些字段。
//      只在 `finish` 已出现（即该步已结束）时合成，流式中不合成。
//
// ── V2 字段丢失清单（转换后 UI 侧拿不到，已确认渲染层不用）─────────────────
//   assistant：`metadata`、`rawFinish`、`providerState`、`snapshot`、
//              `providerResultState`、`executed`
//   user：`metadata`（仅用于兜底取 agent/model，见下）
//   工具：`state.content` 里的 **file 类型产出**（V1 的 `state.attachments`
//         在渲染层**零消费**，故不做映射）
//
// ── ⚠️ V2 的 user 消息没有 agent / model 字段 ─────────────────────────────
//   实测官方 TUI 会把它们写进 `metadata`（`metadata.agent` / `metadata.model`，
//   且 `metadata.model` 用的是 V1 命名 `modelID`）。`metadata` 在 schema 里是
//   `Record<string, unknown>`，**不是契约字段**，所以这里只做「有就取」的兜底，
//   取不到就留空 —— 绝不假设它一定存在。
// ============================================

import type {
  SessionMessageAssistant,
  SessionMessageAssistantContent,
  SessionMessageAssistantReasoning,
  SessionMessageAssistantText,
  SessionMessageAssistantTool,
  SessionMessageCompaction,
  SessionMessageInfo,
  SessionMessageToolState,
  SessionMessageUser,
  SessionStructuredError,
  SessionTokenUsage,
} from '../types/api/message'
import type {
  AgentPart,
  AssistantMessageInfo,
  FilePart,
  FilePartSource,
  Message,
  MessageError,
  MessageInfo,
  ModelRef,
  Part,
  ReasoningPart,
  RetryPart,
  SkillPart,
  SessionMarkerPart,
  SessionMarkerMessage,
  StepFinishPart,
  SystemMessageInfo,
  TextPart,
  TokenUsage,
  ToolPart,
  ToolState,
  UserMessageInfo,
} from '../types/message'
import { isUserMessage } from '../types/message'

// ============================================
// 工具函数
// ============================================

/** 空的 token 用量（V2 的 tokens 是可选的，UI 侧要求必有） */
const EMPTY_TOKENS: TokenUsage = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }

/** 合成 part id：`消息id:类型:下标`（见文件头注释 2） */
function partId(messageID: string, kind: string, index: number): string {
  return `${messageID}:${kind}:${index}`
}

/**
 * V2 `Session.StructuredError` → UI `MessageError`
 *
 * ⚠️ V2 的 `type` 是**开放字符串**（实测出现：`aborted`、`unknown`、
 *    `provider.error`、`provider.invalid-output`、`tool.execution`），
 *    而 V1/UI 是 5 个具名判别类型 → 只能按关键字启发式映射。
 *
 * 最关键的一条：**`aborted` → `MessageAbortedError`**。
 *   UI 的 `isAbortedMessage()` 靠 `error.name === 'MessageAbortedError'` 判断
 *   「这条回复是被中止的」，实测库里 57 条 assistant 是这个类型，映射错了 UI 就不显示中止态。
 *
 * 阶段 2b 起**导出**：`session.step.failed` / `session.execution.failed` 事件
 * 也要把 V2 错误映射成同一个 UI 形状（事件侧与读侧必须共用，否则同一条错误
 * 从 REST 加载和从事件推送会得到两种显示）。
 */
export function toMessageError(error: SessionStructuredError | undefined): MessageError | undefined {
  if (!error) return undefined
  const type = (error.type ?? '').toLowerCase()

  if (type.includes('abort')) {
    return { name: 'MessageAbortedError', data: { message: error.message } }
  }
  if (type.includes('auth') || type.includes('credential')) {
    return { name: 'ProviderAuthError', data: { providerID: '', message: error.message } }
  }
  if (type.includes('length') || type.includes('token-limit')) {
    return { name: 'MessageOutputLengthError', data: {} }
  }
  // 兜底用 APIError：它是信息量最大的一个（带 statusCode / isRetryable）
  return {
    name: 'APIError',
    data: {
      message: error.message,
      statusCode: error.status,
      isRetryable: true,
    },
  }
}

/** V2 的 `Model.Ref`（`{id, providerID, variant?}`）→ UI 的 `ModelRef`（`{providerID, modelID, variant?}`） */
function toModelRef(model: { id: string; providerID: string; variant?: string }): ModelRef {
  return { providerID: model.providerID, modelID: model.id, variant: model.variant }
}

/** V2 的 token 用量 → UI（字段一致，只是可选性不同） */
export function toTokenUsage(tokens: SessionTokenUsage | undefined): TokenUsage {
  if (!tokens) return EMPTY_TOKENS
  return {
    input: tokens.input,
    output: tokens.output,
    reasoning: tokens.reasoning,
    cache: { read: tokens.cache.read, write: tokens.cache.write },
  }
}

/** 从 `Record<string, unknown>` 里安全读字符串 */
function readString(source: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = source?.[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

// ============================================
// 用户消息
// ============================================

/**
 * 读 V2 user 消息 `metadata` 里的 agent / model 兜底信息。
 *
 * ⚠️ `metadata` **不是 V2 契约字段**（schema 是 `Record<string, unknown>`）。
 *    实测官方 TUI 会写 `{ agent, model, displayText, comments, attachments }`，
 *    但第三方写入方可以不写 → 全部按可选处理。
 *    注意 `metadata.model` 用的是 **V1 命名 `modelID`**（实测），
 *    这里同时兼容 `id`，避免 V2 后续归一化后取不到。
 */
function readUserMetadata(metadata: Record<string, unknown> | undefined): {
  agent?: string
  model?: ModelRef
} {
  const agent = readString(metadata, 'agent')

  let model: ModelRef | undefined
  const raw = metadata?.['model']
  if (raw && typeof raw === 'object') {
    const m = raw as Record<string, unknown>
    const providerID = readString(m, 'providerID')
    const modelID = readString(m, 'modelID') ?? readString(m, 'id')
    if (providerID && modelID) {
      model = { providerID, modelID, variant: readString(m, 'variant') }
    }
  }

  return { agent, model }
}

function toUserInfo(message: SessionMessageUser, sessionID: string): UserMessageInfo {
  const meta = readUserMetadata(message.metadata as Record<string, unknown> | undefined)
  return {
    id: message.id,
    sessionID,
    role: 'user',
    time: { created: message.time.created },
    // V2 没有顶层 agent / model → 从 metadata 兜底，取不到填空串 / undefined
    agent: meta.agent ?? '',
    model: meta.model ?? { providerID: '', modelID: '' },
    // V1 的 summary（标题/正文/diffs）V2 已删除 → 留空，下游会回退到正文首行
    summary: undefined,
  }
}

/** V2 附件来源（`inline` / `uri`）→ V1 的 `FilePartSource`（UI 只认 `{type:'file', path}` 这一支） */
function toFilePartSource(
  source: SessionMessageUser['files'] extends Array<infer T> | undefined
    ? T extends { source: infer S }
      ? S
      : never
    : never,
  mention: { start: number; end: number; text: string } | undefined,
): FilePartSource | undefined {
  // mention 提供「在原始输入文本里的位置」，正好对应 V1 FilePartSource 的 text 字段
  const text = mention ? { value: mention.text, start: mention.start, end: mention.end } : undefined
  if (!text) return undefined
  const path = source?.type === 'uri' ? source.uri : ''
  return { type: 'file', text, path }
}

/**
 * V2 的 `PromptFileAttachment` → UI `FilePart`
 *
 * 字段差异：
 *   - V2 没有 `id` / `filename` / `url`：`name` → `filename`；
 *     `url` 由 `source` 拼：`uri` 直接用；`inline` 用 base64 拼 `data:` URL。
 *     ⚠️ 实测库里 22 条带附件的 user 消息全是 **inline base64 图片**，
 *        V1 的 `url` 字段是渲染层直接塞给 `<img src>` 的 → 必须拼成 data URL。
 */
function toFilePart(
  messageID: string,
  sessionID: string,
  index: number,
  file: {
    data: string
    mime: string
    source: { type: 'inline' } | { type: 'uri'; uri: string }
    name?: string
    mention?: { start: number; end: number; text: string }
  },
): FilePart {
  const url = file.source.type === 'uri' ? file.source.uri : `data:${file.mime};base64,${file.data}`
  return {
    type: 'file',
    id: partId(messageID, 'file', index),
    sessionID,
    messageID,
    mime: file.mime,
    filename: file.name,
    url,
    source: toFilePartSource(file.source, file.mention),
  }
}

/** V2 的 `PromptAgentAttachment` → UI `AgentPart`（V2 没有 id，用下标合成） */
function toAgentPart(
  messageID: string,
  sessionID: string,
  index: number,
  agent: { name: string; mention?: { start: number; end: number; text: string } },
): AgentPart {
  return {
    type: 'agent',
    id: partId(messageID, 'agent', index),
    sessionID,
    messageID,
    name: agent.name,
    source: agent.mention
      ? { value: agent.mention.text, start: agent.mention.start, end: agent.mention.end }
      : undefined,
  }
}

/** V2 的 `PromptSkillAttachment` → UI `SkillPart`（V1 无此概念，V2 新增） */
function toSkillPart(
  messageID: string,
  sessionID: string,
  index: number,
  skill: { id: string; name: string; text?: string },
): SkillPart {
  return {
    type: 'skill',
    id: partId(messageID, 'skill', index),
    sessionID,
    messageID,
    skill: skill.id,
    name: skill.name,
    text: skill.text,
  }
}

function userToParts(message: SessionMessageUser, sessionID: string): Part[] {
  const parts: Part[] = []

  // 用户文本：V2 是**直接字段**，V1 是 `parts[].type === 'text'`
  if (message.text) {
    parts.push({
      type: 'text',
      id: partId(message.id, 'text', 0),
      sessionID,
      messageID: message.id,
      text: message.text,
      // V2 的 user 文本没有 synthetic 标志（synthetic 变成了独立的**消息类型**）
      synthetic: false,
    })
  }

  for (const [i, file] of (message.files ?? []).entries()) {
    parts.push(toFilePart(message.id, sessionID, i, file))
  }
  for (const [i, agent] of (message.agents ?? []).entries()) {
    parts.push(toAgentPart(message.id, sessionID, i, agent))
  }
  for (const [i, skill] of (message.skills ?? []).entries()) {
    parts.push(toSkillPart(message.id, sessionID, i, skill))
  }

  return parts
}

// ============================================
// 助手消息
// ============================================

function toAssistantInfo(message: SessionMessageAssistant, sessionID: string): AssistantMessageInfo {
  return {
    id: message.id,
    sessionID,
    role: 'assistant',
    time: {
      created: message.time.created,
      completed: message.time.completed,
    },
    // ── 以下 4 个字段 V2 已删除，填占位值 ──
    // `parentID`（指向用户消息）：V2 删除；UI 侧只有 childSessionStore 用它，
    // 而那里读的是 **Session.parentID**（会话树），不是消息的 → 填空串安全。
    parentID: '',
    // `mode`：V2 删除，渲染层零消费
    mode: '',
    // `path`：V2 删除，渲染层零消费
    path: { cwd: '', root: '' },
    // `summary`（是否摘要消息）：V2 删除（改用独立的 compaction 消息类型），
    // UI 侧 outline 会回退到正文首行 → 填 false
    summary: false,
    // ── V2 改名的字段 ──
    // V1 是散字段 modelID / providerID；V2 是 model: ModelRef（注意字段名是 id）
    modelID: message.model.id,
    providerID: message.model.providerID,
    agent: message.agent,
    // ── V2 从 step-finish part 上移过来的字段 ──
    cost: message.cost ?? 0,
    tokens: toTokenUsage(message.tokens),
    finish: message.finish,
    // V1 是 {name,data} 判别联合，V2 是扁平的 {type,message,status?}
    error: toMessageError(message.error),
  }
}

function toAssistantTextPart(
  messageID: string,
  content: SessionMessageAssistantText,
  index: number,
  sessionID: string,
): TextPart {
  return {
    type: 'text',
    id: partId(messageID, 'content', index),
    sessionID,
    messageID,
    text: content.text,
    // V2 的 assistant 文本没有 synthetic 标志（V1 有）→ 一律视为可见
    synthetic: false,
  }
}

function toAssistantReasoningPart(
  messageID: string,
  content: SessionMessageAssistantReasoning,
  index: number,
  sessionID: string,
  fallbackCreated: number,
): Part {
  return {
    type: 'reasoning',
    id: partId(messageID, 'content', index),
    sessionID,
    messageID,
    text: content.text,
    // V2 的 time 是可选的 → 缺省用消息创建时间兜底（UI 用它算耗时）
    time: {
      start: content.time?.created ?? fallbackCreated,
      end: content.time?.completed,
    },
  }
}

/**
 * V2 工具状态 → UI 工具状态
 *
 * 字段差异（V1 → V2）：
 *   - `pending` → **`streaming`**（且 `input` 从对象变成**未解析的字符串**）
 *     → 映射回 `pending`，原始串放进 V1 就有的 `raw` 字段（UI 不读，留作排查）
 *   - `time: {start,end}` → 移到工具层 `time: {created,ran?,completed?}`
 *   - `output: string` → **`content: ToolContent[]`**（只有 text 能还原成文本）
 *   - `title` / `attachments` → **V2 删除**（title 从 metadata 里兜底取）
 */
function toToolState(tool: SessionMessageAssistantTool): ToolState {
  const state: SessionMessageToolState = tool.state
  // V1 的时间是 {start, end}，V2 是 {created, ran?, completed?}
  const time = {
    start: tool.time.created,
    end: tool.time.completed,
  }

  switch (state.status) {
    case 'streaming':
      // V1 的 pending：输入还没解析完
      return { status: 'pending', input: {}, raw: state.input, time }

    case 'running':
      return {
        status: 'running',
        input: state.input as Record<string, unknown>,
        metadata: state.metadata as Record<string, unknown>,
        time,
      }

    case 'completed': {
      // V2 的产出是内容块数组，只有 text 能还原成 V1 的 output 字符串
      const output = state.content
        .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
        .map(c => c.text)
        .join('\n')
      const metadata = (state.metadata ?? {}) as Record<string, unknown>
      return {
        status: 'completed',
        input: state.input as Record<string, unknown>,
        output,
        // V2 删除了 title；官方把摘要放在 metadata 里（非契约）→ 有就取
        title: readString(metadata, 'title') ?? '',
        metadata,
        time,
      }
    }

    case 'error':
      return {
        status: 'error',
        input: state.input as Record<string, unknown>,
        // V1 这里是字符串，V2 是结构化错误 → 取 message
        error: state.error.message,
        metadata: state.metadata as Record<string, unknown> | undefined,
        time,
      }
  }
}

function toToolPart(messageID: string, tool: SessionMessageAssistantTool, sessionID: string): ToolPart {
  return {
    type: 'tool',
    // V2 的工具 id 形如 `call_00_...`，全局唯一，直接复用
    id: tool.id,
    sessionID,
    messageID,
    // V1 叫 callID，V2 叫 id
    callID: tool.id,
    // V1 叫 tool，V2 叫 name
    tool: tool.name,
    state: toToolState(tool),
  }
}

/**
 * **单个 content 块 → UI part**（阶段 2b 新增，事件侧与读侧**共用同一套规则**）
 *
 * 为什么必须共用：`assistant.content[]` 里 **只有 tool 有 `id`**，
 * text / reasoning 的 UI part id 只能靠「消息 id + 下标」合成。
 * 如果读侧（`assistantToParts`）与事件侧（`messageStore.handlePartUpdated`）
 * 各算一遍，规则一旦漂移就会出现「同一条消息两个 id」→ React key 冲突 +
 * 折叠状态错位 + delta 找不到目标 part。
 *
 * 规则（与阶段 2a 完全一致）：
 *   - text / reasoning：`消息id:content:下标`（**下标按 content 数组算**，不是同类型计数）
 *   - tool：工具自身的 `id`
 *
 * @param index content 数组下标。tool 块传 `-1` 即可（它不用下标）。
 * @param fallbackCreated reasoning 的 `time` 缺省兜底（消息创建时间）
 */
export function toUIPartFromContent(
  messageID: string,
  sessionID: string,
  index: number,
  content: SessionMessageAssistantContent,
  fallbackCreated = 0,
): Part | null {
  switch (content.type) {
    case 'text':
      return toAssistantTextPart(messageID, content, index, sessionID)
    case 'reasoning':
      return toAssistantReasoningPart(messageID, content, index, sessionID, fallbackCreated)
    case 'tool':
      return toToolPart(messageID, content, sessionID)
    default:
      return null
  }
}

/**
 * 合成 assistant 尾部的 `step-finish` part（**事件侧与读侧共用**）
 *
 * 导出原因：`session.step.ended` / `session.step.failed` 到达时，
 * store 需要立刻把同一个 step-finish part 挂到消息尾部。
 */
export function toStepFinishPart(
  messageID: string,
  sessionID: string,
  finish: string | undefined,
  cost: number | undefined,
  tokens: SessionTokenUsage | undefined,
): StepFinishPart {
  return {
    type: 'step-finish',
    id: partId(messageID, 'step-finish', 0),
    sessionID,
    messageID,
    reason: finish ?? '',
    cost: cost ?? 0,
    tokens: toTokenUsage(tokens),
  }
}

/** 判断某个 UI part 是否 text / reasoning（可接受 delta 的类型） */
export function isTextLikePart(part: Part): part is TextPart | ReasoningPart {
  return part.type === 'text' || part.type === 'reasoning'
}

/**
 * 合成 assistant 尾部的 `step-finish` part
 *
 * V2 把成本 / 用量 / 结束原因从 part 移到了 assistant 顶层，但渲染层的
 * 「过程 vs 最终内容」拆分与工具组配对**依赖 step-finish**，所以这里合成一个。
 *
 * ⚠️ 只在 `finish` 已存在（该步已结束）时合成；流式过程中不合成，
 *    否则工具组会提前挂上未完成的用量、并影响过程折叠的判定。
 */
function toSynthesizedStepFinishPart(message: SessionMessageAssistant, sessionID: string): StepFinishPart {
  return toStepFinishPart(message.id, sessionID, message.finish, message.cost, message.tokens)
}

/** V2 的 `Assistant.retry` → V1 的独立 `retry` part（渲染层有专门的 RetryPartView） */
function toRetryPart(message: SessionMessageAssistant, sessionID: string): RetryPart | undefined {
  const retry = message.retry
  if (!retry) return undefined
  return {
    type: 'retry',
    id: partId(message.id, 'retry', 0),
    sessionID,
    messageID: message.id,
    attempt: retry.attempt,
    // RetryPartView 读的是 APIError 的 data 形状（isRetryable / statusCode / message）
    error: {
      name: 'APIError',
      data: {
        message: retry.error.message,
        statusCode: retry.error.status,
        isRetryable: true,
      },
    },
    time: { created: retry.at },
  }
}

function assistantToParts(message: SessionMessageAssistant, sessionID: string): Part[] {
  const parts: Part[] = []

  message.content.forEach((content, index) => {
    const part = toUIPartFromContent(message.id, sessionID, index, content)
    if (part) parts.push(part)
  })

  const retry = toRetryPart(message, sessionID)
  if (retry) parts.push(retry)

  if (message.finish !== undefined) {
    parts.push(toSynthesizedStepFinishPart(message, sessionID))
  }

  return parts
}

// ============================================
// 系统类消息（V2 新增的 9 种）
// ============================================

/** 非 user/assistant 消息 → `kind`（渲染层据此分支） */
function markerKind(message: SessionMarkerMessage | SessionMessageCompaction): SystemMessageInfo['kind'] {
  return message.type as SystemMessageInfo['kind']
}

/** 把 V2 标记消息包成 UI part */
function toMarkerPart(message: SessionMarkerMessage, sessionID: string): SessionMarkerPart {
  return {
    type: 'session-marker',
    id: partId(message.id, 'marker', 0),
    sessionID,
    messageID: message.id,
    marker: message,
  }
}

/** compaction 用 UI 已有的 `compaction` part（渲染层有 CompactionPartView） */
function toCompactionPart(message: SessionMessageCompaction, sessionID: string): Part {
  const base = {
    type: 'compaction' as const,
    id: partId(message.id, 'compaction', 0),
    sessionID,
    messageID: message.id,
    auto: message.reason === 'auto',
    status: message.status,
    reason: message.reason,
  }
  switch (message.status) {
    case 'running':
      return { ...base, summary: message.summary, recent: message.recent }
    case 'completed':
      return {
        ...base,
        summary: message.summary,
        recent: message.recent,
        model: message.model ? toModelRef(message.model) : undefined,
      }
    case 'failed':
      return { ...base, error: toMessageError(message.error) }
  }
}

// ============================================
// 对外 API
// ============================================

/**
 * V2 扁平消息 → UI 消息（**阶段 2a 主路径**）
 *
 * @param apiMessage V2 的 `Session.Message.Info`
 * @param sessionID  ⚠️ **必传**：V2 消息里没有 sessionID，
 *                   而 store / 渲染层的多处逻辑（按 session 分组、revert 定位）依赖它
 */
export function toUIMessage(apiMessage: SessionMessageInfo, sessionID: string): Message {
  switch (apiMessage.type) {
    case 'user':
      return { info: toUserInfo(apiMessage, sessionID), parts: userToParts(apiMessage, sessionID), isStreaming: false }

    case 'assistant':
      return {
        info: toAssistantInfo(apiMessage, sessionID),
        parts: assistantToParts(apiMessage, sessionID),
        // 没有 completed 就是还在流式（实测库里 8/14972 条是这个状态）
        isStreaming: apiMessage.time.completed == null,
      }

    case 'compaction':
      return {
        info: systemInfo(apiMessage, sessionID),
        parts: [toCompactionPart(apiMessage, sessionID)],
        isStreaming: apiMessage.status === 'running',
      }

    default:
      // system / synthetic / skill / shell / idle / agent-switched /
      // model-switched / location-switched —— 统一用 session-marker 承载
      return {
        info: systemInfo(apiMessage, sessionID),
        parts: [toMarkerPart(apiMessage, sessionID)],
        isStreaming: false,
      }
  }
}

function systemInfo(
  message: Exclude<SessionMessageInfo, SessionMessageUser | SessionMessageAssistant>,
  sessionID: string,
): SystemMessageInfo {
  return {
    id: message.id,
    sessionID,
    role: 'system',
    time: { created: message.time.created },
    kind: markerKind(message),
  }
}

/** 批量转换（store 的两个入口都用它，避免逐条传 sessionID） */
export function toUIMessages(apiMessages: SessionMessageInfo[], sessionID: string): Message[] {
  return apiMessages.map(message => toUIMessage(message, sessionID))
}

/**
 * V2 扁平消息 → UI 消息元信息（只要 info，不要 parts）
 *
 * 用于「消息已存在，只更新元信息」的场景（如流式结束时补 completed 时间）。
 */
export function toUIMessageInfo(apiMessage: SessionMessageInfo, sessionID: string): MessageInfo {
  return toUIMessage(apiMessage, sessionID).info
}

// ============================================
// 阶段 2b 已删除的 V1 形状转换函数
// ============================================
//
// 下面这几个函数在阶段 2a 里是「事件层仍在用的 V1 形状适配」，2b 重写事件层后
// 已全部无引用，**整体删除**（保留此注释是为了让后来者知道它们曾经存在）：
//
//   toLegacyUIMessage(apiMessageWithParts)      → 改用 toUIMessage(msg, sessionID)
//   toLegacyUIMessageInfo(apiMessage)           → 改用 toUIMessageInfo(msg, sessionID)
//   toUIPart(apiPart)                           → 改用 toUIPartFromContent(...)
//   toApiMessageWithParts(message)              → V1 的 {info, parts} 结构已不存在

/**
 * 判断 UI 消息是否用户消息
 *
 * ✅ 保留原名：调用方（store / useSessionManager / hooks）最多。
 * V2 之后 `role` 仍是 `'user' | 'assistant' | 'system'`，判断逻辑不变。
 */
export function isUserUIMessage(message: Message): message is Message & { info: UserMessageInfo } {
  return isUserMessage(message.info)
}
