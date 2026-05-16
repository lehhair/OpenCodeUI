// ============================================
// Message Types - 直接对齐 API 数据结构
// ============================================

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

export type MessageInfo = UserMessageInfo | AssistantMessageInfo

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

export interface CompactionPart extends PartBase {
  type: 'compaction'
  auto?: boolean
}

export type Part =
  | TextPart
  | ReasoningPart
  | ToolPart
  | FilePart
  | AgentPart
  | StepStartPart
  | StepFinishPart
  | SubtaskPart
  | SnapshotPart
  | PatchPart
  | RetryPart
  | CompactionPart

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
    case 'step-finish':
    case 'subtask':
    case 'retry':
    case 'compaction':
      return true
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
