// ============================================
// Message Types —— UI 展示模型
// ============================================
//
// 定位（阶段 2a 起明确）：
//   这是**渲染层唯一消费**的消息模型。API 层的 V2 扁平消息
//   （`Session.Message.Info`）由 `src/utils/messageConversion.ts` 转换成本模型。
//   渲染组件（src/features/message/**）**不直接 import API 类型**，只认这里。
//
// 为什么不让渲染层直接用 V2 模型：
//   V2 把「文本/推理/工具」塞进 `assistant.content[]`，且 text/reasoning **没有 id**、
//   工具产出是 `content: ToolContent[]` 而非 `output: string`。
//   渲染层需要的是「稳定的 part 列表 + 稳定的 id + 可直接渲染的字段」，
//   这层摊平/补全的逻辑集中在转换层，渲染组件因此基本零改动。
//
// 阶段 2a 新增（对应 V2 新增的消息类型）：
//   - `SystemMessageInfo`（`role: 'system'`）—— 承载 V2 的 9 种非 user/assistant 消息
//   - `SessionMarkerPart` —— 这些消息的渲染载体（保留 V2 原始字段，按 `marker.type` 判别）
//   - `SkillPart` —— 用户技能附件（V2 的 `User.skills`）
//   - `CompactionPart` 增补 V2 的 status/reason/summary 等字段

import type {
  SessionMessageAgentSelected,
  SessionMessageIdle,
  SessionMessageLocationSwitched,
  SessionMessageModelSelected,
  SessionMessageShell,
  SessionMessageSkill,
  SessionMessageSynthetic,
  SessionMessageSystem,
} from './api/message'

// ============================================
// Common Types
// ============================================

export interface MessageTime {
  created: number
  completed?: number
}

export interface TokenUsage {
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
}

export interface ModelRef {
  providerID: string
  modelID: string
  variant?: string
}

export interface PathInfo {
  cwd: string
  root: string
}

export interface MessageSummary {
  title?: string
  body?: string
  diffs?: FileDiff[]
}

export interface FileDiff {
  path: string
  additions: number
  deletions: number
  diff?: string
}

// ============================================
// Error Types
// ============================================

export interface ProviderAuthError {
  name: 'ProviderAuthError'
  data: { providerID: string; message: string }
}

export interface UnknownError {
  name: 'UnknownError'
  data: { message: string }
}

export interface MessageOutputLengthError {
  name: 'MessageOutputLengthError'
  data: Record<string, never>
}

export interface MessageAbortedError {
  name: 'MessageAbortedError'
  data: { message: string }
}

export interface APIError {
  name: 'APIError'
  data: {
    message: string
    statusCode?: number
    isRetryable: boolean
    responseHeaders?: Record<string, string>
    responseBody?: string
    metadata?: Record<string, string>
  }
}

export type MessageError = ProviderAuthError | UnknownError | MessageOutputLengthError | MessageAbortedError | APIError

// ============================================
// Message Info (元信息)
// ============================================

// User message info
export interface UserMessageInfo {
  id: string
  sessionID: string
  role: 'user'
  time: MessageTime
  agent: string
  model: ModelRef
  summary?: MessageSummary
}

// Assistant message info
export interface AssistantMessageInfo {
  id: string
  sessionID: string
  role: 'assistant'
  time: MessageTime
  parentID: string // 指向用户消息
  modelID: string
  providerID: string
  mode: string
  agent: string
  path: PathInfo
  cost: number
  tokens: TokenUsage
  finish?: 'stop' | 'tool-calls' | string
  error?: MessageError
  summary?: boolean // 是否为摘要消息
}

export type MessageInfo = UserMessageInfo | AssistantMessageInfo | SystemMessageInfo

// ============================================
// 系统类消息（V2 新增）
// ============================================

/**
 * V2 里非 user / assistant 的 9 种消息，统一归到 `role: 'system'`。
 *
 * 为什么合并成一个 role：
 *   - UI 里大量判断是 `role === 'user'` / `role === 'assistant'`，
 *     新增一个 role 不会影响这些判断（它们只会正确地把系统消息排除掉）；
 *   - 具体是哪种消息由 `kind` 给出，渲染层按 `kind` 分支。
 */
export type SessionMessageKind =
  | 'system'
  | 'synthetic'
  | 'skill'
  | 'shell'
  | 'idle'
  | 'compaction'
  | 'agent-switched'
  | 'model-switched'
  | 'location-switched'

/** 系统类消息的元信息（V2 的 system / synthetic / skill / shell / idle / *-switched） */
export interface SystemMessageInfo {
  id: string
  /** ⚠️ V2 消息里没有 sessionID，由转换层从调用上下文补进来 */
  sessionID: string
  role: 'system'
  time: MessageTime
  /** V2 原始消息类型，渲染层据此分支 */
  kind: SessionMessageKind
}

// ============================================
// Part Types (内容部分)
// ============================================

interface PartBase {
  id: string
  sessionID: string
  messageID: string
}

export interface TextPart extends PartBase {
  type: 'text'
  text: string
  synthetic?: boolean // 系统生成的上下文
  time?: { start: number; end?: number }
}

export interface ReasoningPart extends PartBase {
  type: 'reasoning'
  text: string
  time: { start: number; end?: number }
}

// ToolState - 按状态细分的联合类型
export interface ToolStatePending {
  status: 'pending'
  input: Record<string, unknown>
  raw?: string
}

export interface ToolStateRunning {
  status: 'running'
  input: Record<string, unknown>
  title?: string
  metadata?: Record<string, unknown>
  time: { start: number }
}

export interface ToolStateCompleted {
  status: 'completed'
  input: Record<string, unknown>
  output: string
  title: string
  metadata: Record<string, unknown>
  time: { start: number; end: number; compacted?: number }
  attachments?: FilePart[]
}

export interface ToolStateError {
  status: 'error'
  input: Record<string, unknown>
  error: string
  metadata?: Record<string, unknown>
  time: { start: number; end: number }
}

export type ToolStateStrict = ToolStatePending | ToolStateRunning | ToolStateCompleted | ToolStateError

// 宽松的 ToolState 类型，用于实际渲染（API 返回的数据可能不完全符合严格类型）
export interface ToolState {
  status: 'pending' | 'running' | 'completed' | 'error'
  input?: Record<string, unknown>
  output?: string
  title?: string
  error?: string
  time?: { start: number; end?: number; compacted?: number }
  metadata?: Record<string, unknown>
  attachments?: FilePart[]
  raw?: string
}

export interface ToolPart extends PartBase {
  type: 'tool'
  callID: string
  tool: string
  state: ToolState
}

// FilePartSource - 3种来源类型
export interface FilePartSourceText {
  value: string
  start: number
  end: number
}

export interface FileSource {
  type: 'file'
  text: FilePartSourceText
  path: string
}

export interface SymbolSource {
  type: 'symbol'
  text: FilePartSourceText
  path: string
  range: { start: { line: number; character: number }; end: { line: number; character: number } }
  name: string
  kind: number
}

export interface ResourceSource {
  type: 'resource'
  text: FilePartSourceText
  clientName: string
  uri: string
}

export type FilePartSource = FileSource | SymbolSource | ResourceSource

export interface FilePart extends PartBase {
  type: 'file'
  mime: string
  filename?: string
  url: string
  source?: FilePartSource
}

export interface AgentPart extends PartBase {
  type: 'agent'
  name: string
  source?: { value: string; start: number; end: number }
}

export interface StepStartPart extends PartBase {
  type: 'step-start'
  snapshot?: string
}

export interface StepFinishPart extends PartBase {
  type: 'step-finish'
  reason: string
  cost: number
  tokens: TokenUsage
  snapshot?: string
}

export interface SubtaskPart extends PartBase {
  type: 'subtask'
  prompt: string
  description: string
  agent: string
  model?: ModelRef
  command?: string
}

export interface SnapshotPart extends PartBase {
  type: 'snapshot'
  snapshot: string
}

export interface PatchPart extends PartBase {
  type: 'patch'
  hash: string
  files: string[]
}

export interface RetryPart extends PartBase {
  type: 'retry'
  attempt: number
  error: APIError
  time: { created: number }
}

/**
 * 上下文压缩（V2 改成**独立的 compaction 消息类型**，带 3 态）
 *
 * 阶段 2a 增补：V2 的 `status` / `reason` / `summary` / `model` / `error`。
 * `auto` 是 V1 遗留字段（V2 用 `reason: 'auto' | 'manual'` 表达同一件事）。
 */
export interface CompactionPart extends PartBase {
  type: 'compaction'
  /** @deprecated V1 遗留：V2 用 `reason === 'auto'` 表达 */
  auto?: boolean
  /** V2：压缩阶段 */
  status?: 'running' | 'completed' | 'failed'
  /** V2：触发原因 */
  reason?: 'auto' | 'manual'
  /** V2：压缩后的摘要文本（running/completed 有） */
  summary?: string
  /** V2：保留的最近对话（running/completed 有） */
  recent?: string
  /** V2：执行压缩用的模型（completed 有） */
  model?: ModelRef
  /** V2：失败原因（failed 有） */
  error?: MessageError
}

// ============================================
// V2 专有转录标记
// ============================================

/**
 * V2 非 user / assistant 消息的渲染载体。
 *
 * 设计取舍：**不把 V2 的 9 种消息各拆成一个 part 类型**，而是统一用
 * `type: 'session-marker'` + 一个 `marker` 字段承载原始 V2 消息。
 * 理由：
 *   1. 渲染上它们都是「一行提示」，共用同一个视图组件即可；
 *   2. 保留 `marker` 的完整类型（判别联合），渲染层能按 `marker.type` 拿到强类型字段，
 *      不需要在转换层做有损的字段摊平；
 *   3. 新增 V2 消息类型时只需扩 `SessionMarkerMessage` 联合，渲染层 switch 会提示补分支。
 */
export interface SessionMarkerPart extends PartBase {
  type: 'session-marker'
  marker: SessionMarkerMessage
}

/** 能落到 `SessionMarkerPart` 里的 V2 消息（= 11 种里去掉 user / assistant / compaction） */
export type SessionMarkerMessage =
  | SessionMessageSystem
  | SessionMessageSynthetic
  | SessionMessageSkill
  | SessionMessageShell
  | SessionMessageIdle
  | SessionMessageAgentSelected
  | SessionMessageModelSelected
  | SessionMessageLocationSwitched

/**
 * 用户技能附件（V2 的 `User.skills[]`）
 *
 * V1 没有这个概念（技能是 V2 新增能力），所以这是个新 part 类型。
 */
export interface SkillPart extends PartBase {
  type: 'skill'
  skill: string
  name: string
  text?: string
}

export type Part =
  | TextPart
  | ReasoningPart
  | ToolPart
  | FilePart
  | AgentPart
  | SkillPart
  | StepStartPart
  | StepFinishPart
  | SubtaskPart
  | SnapshotPart
  | PatchPart
  | RetryPart
  | CompactionPart
  | SessionMarkerPart

// ============================================
// Message (完整消息)
// ============================================

export interface Message {
  info: MessageInfo
  parts: Part[]
  // UI 状态
  isStreaming?: boolean
}

// ============================================
// 辅助类型
// ============================================

/** 检查消息是否为用户消息 */
export function isUserMessage(info: MessageInfo): info is UserMessageInfo {
  return info.role === 'user'
}

/** 检查消息是否为助手消息 */
export function isAssistantMessage(info: MessageInfo): info is AssistantMessageInfo {
  return info.role === 'assistant'
}

/**
 * 检查消息是否为系统类消息（V2 新增）
 *
 * 覆盖 V2 的 9 种非 user/assistant 消息：system / synthetic / skill / shell /
 * idle / compaction / agent-switched / model-switched / location-switched。
 */
export function isSystemMessage(info: MessageInfo): info is SystemMessageInfo {
  return info.role === 'system'
}

/** 检查 part 是否为工具调用 */
export function isToolPart(part: Part): part is ToolPart {
  return part.type === 'tool'
}

/** 检查 part 是否为可见文本 */
export function isVisibleTextPart(part: Part): part is TextPart {
  return part.type === 'text' && !!part.text.trim() && !part.synthetic
}

/** 检查 part 是否为可见 reasoning */
export function isVisibleReasoningPart(part: Part): part is ReasoningPart {
  return part.type === 'reasoning' && !!part.text.trim()
}

/** 检查 part 是否会在信息流里产生实际内容 */
export function isRenderablePart(part: Part): boolean {
  switch (part.type) {
    case 'text':
      return isVisibleTextPart(part)
    case 'reasoning':
      return isVisibleReasoningPart(part)
    case 'tool':
    case 'file':
    case 'agent':
    case 'skill':
    case 'step-finish':
    case 'subtask':
    case 'retry':
    case 'compaction':
      return true
    case 'session-marker':
      // idle 只是「一轮结束」的边界标记，不产生可见内容（由 assistant 尾部耗时兜底展示）
      return part.marker.type !== 'idle'
    default:
      return false
  }
}

export function isAbortedMessage(info: MessageInfo): boolean {
  return info.role === 'assistant' && info.error?.name === 'MessageAbortedError'
}

export function hasRenderableParts(message: Message): boolean {
  return message.parts.some(isRenderablePart)
}

/** 检查消息是否有可见内容 */
export function hasVisibleContent(message: Message): boolean {
  return hasRenderableParts(message)
}

/** 获取消息的纯文本内容 */
export function getMessageText(message: Message): string {
  return message.parts
    .filter((p): p is TextPart => p.type === 'text' && !p.synthetic)
    .map(p => p.text)
    .join('')
}
