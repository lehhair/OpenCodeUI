// ============================================
// Message API Types
// 基于 OpenAPI 规范
// ============================================

import type { TimeInfo, TokenUsage, ModelRef, PathInfo, ErrorInfo, TextRange } from './common'

// ============================================
// Message Types
// ============================================

/**
 * 消息摘要
 */
export interface MessageSummary {
  title?: string
  body?: string
}

/**
 * 用户消息
 */
export interface UserMessage {
  id: string
  sessionID: string
  role: 'user'
  time: { created: number }
  agent: string
  model: ModelRef
  variant?: string
  summary?: MessageSummary
}

/**
 * 助手消息
 */
export interface AssistantMessage {
  id: string
  sessionID: string
  role: 'assistant'
  time: TimeInfo
  parentID: string
  modelID: string
  providerID: string
  mode: string
  agent: string
  path: PathInfo
  cost: number
  tokens: TokenUsage
  error?: ErrorInfo
  finish?: string
}

/**
 * 消息联合类型
 */
export type Message = UserMessage | AssistantMessage

// ============================================
// Part Types
// ============================================

/**
 * Part 基础接口
 */
interface PartBase {
  id: string
  sessionID: string
  messageID: string
}

/**
 * 文本部分
 */
export interface TextPart extends PartBase {
  type: 'text'
  text: string
  synthetic?: boolean
  time?: { start: number; end?: number }
}

/**
 * 推理部分
 */
export interface ReasoningPart extends PartBase {
  type: 'reasoning'
  text: string
  time: { start: number; end?: number }
}

/**
 * 工具状态
 */
export interface ToolState {
  status: 'pending' | 'running' | 'completed' | 'error'
  input?: unknown
  output?: unknown
  title?: string
  time?: { start: number; end?: number }
  error?: ErrorInfo
  metadata?: {
    diff?: string
    filediff?: {
      file: string
      before: string
      after: string
      additions: number
      deletions: number
    }
    filepath?: string
    output?: string
    exit?: number
    truncated?: boolean
    [key: string]: unknown
  }
}

/**
 * 工具调用部分
 */
export interface ToolPart extends PartBase {
  type: 'tool'
  callID: string
  tool: string
  state: ToolState
}

/**
 * 文件来源类型
 */
export type FileSourceType = 'text' | 'file' | 'symbol' | 'resource'

/**
 * 文件来源
 */
export interface FileSource {
  text?: TextRange
  type?: FileSourceType
  path?: string
}

/**
 * 文件部分
 */
export interface FilePart extends PartBase {
  type: 'file'
  mime: string
  filename?: string
  url: string
  source?: FileSource
}

/**
 * Agent 部分
 */
export interface AgentPart extends PartBase {
  type: 'agent'
  name: string
  source?: TextRange
}

/**
 * 步骤开始部分
 */
export interface StepStartPart extends PartBase {
  type: 'step-start'
  snapshot?: string
}

/**
 * 步骤完成部分
 */
export interface StepFinishPart extends PartBase {
  type: 'step-finish'
  reason: string
  cost: number
  tokens: TokenUsage
  snapshot?: string
}

/**
 * 快照部分
 */
export interface SnapshotPart extends PartBase {
  type: 'snapshot'
  snapshot: string
}

/**
 * 补丁部分
 */
export interface PatchPart extends PartBase {
  type: 'patch'
  hash: string
  files: string[]
}

/**
 * 子任务部分
 */
export interface SubtaskPart extends PartBase {
  type: 'subtask'
  prompt: string
  description: string
  agent: string
  model?: ModelRef
  command?: string
}

/**
 * 重试部分
 */
export interface RetryPart extends PartBase {
  type: 'retry'
  attempt: number
  error: ErrorInfo
  time: { created: number }
}

/**
 * 压缩部分
 */
export interface CompactionPart extends PartBase {
  type: 'compaction'
  auto?: boolean
}

/**
 * Part 联合类型
 */
export type Part =
  | TextPart
  | ReasoningPart
  | ToolPart
  | FilePart
  | AgentPart
  | StepStartPart
  | StepFinishPart
  | SnapshotPart
  | PatchPart
  | SubtaskPart
  | RetryPart
  | CompactionPart

/**
 * 消息及其部分（API 响应格式）
 */
export interface MessageWithParts {
  info: Message
  parts: Part[]
}

// ============================================
// Send Message Types
// ============================================

/**
 * 文本输入部分
 */
export interface TextPartInput {
  type: 'text'
  text: string
}

/**
 * 文件输入部分
 */
export interface FilePartInput {
  type: 'file'
  mime: string
  url: string
  filename?: string
  source?: FileSource
}

/**
 * Agent 输入部分
 */
export interface AgentPartInput {
  type: 'agent'
  name: string
  source?: TextRange
}

/**
 * 子任务输入部分
 */
export interface SubtaskPartInput {
  type: 'subtask'
  prompt: string
  description: string
  agent: string
  model?: ModelRef
  command?: string
}

/**
 * 发送消息请求体
 */
export interface SendMessageBody {
  parts: (TextPartInput | FilePartInput | AgentPartInput | SubtaskPartInput)[]
  model?: ModelRef
  agent?: string
  variant?: string
}
