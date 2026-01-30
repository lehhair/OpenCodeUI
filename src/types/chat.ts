// ============================================
// Chat Domain Types
// ============================================

export type ToolType = 
  | 'read_file' 
  | 'edit_file' 
  | 'write_file' 
  | 'bash' 
  | 'search' 
  | 'thinking'
  | 'web_browse'

export type ToolStatus = 'pending' | 'running' | 'done' | 'error' | 'waiting_approval'

export interface ToolCall {
  id: string
  tool: ToolType
  title: string
  input?: string  // 原始输入（如 bash 命令）
  args?: Record<string, unknown>
  status: ToolStatus
  result?: string
  error?: string   // 错误信息（如拒绝权限）
  duration?: number // ms
  requiresApproval?: boolean
  // File diff 相关（edit/write 工具）
  diff?: string           // unified diff 格式
  fileDiff?: {            // 结构化 diff 信息
    file: string
    before: string
    after: string
    additions: number
    deletions: number
  }
  // 文件内容（read 工具）
  fileContent?: string
  filePath?: string       // 文件路径
}

// ============================================
// Agent Flow Block Types
// 消息内部的流程块，按时间顺序排列
// ============================================

export type AgentBlockType = 'thinking' | 'tool_calls' | 'text' | 'step_info' | 'subtask'

export interface ThinkingBlock {
  type: 'thinking'
  id: string
  content: string
  isStreaming: boolean  // 是否还在思考中
}

export interface ToolCallsBlock {
  type: 'tool_calls'
  id: string
  tools: ToolCall[]
}

export interface TextBlock {
  type: 'text'
  id: string
  content: string
  isStreaming: boolean
}

export interface StepInfoBlock {
  type: 'step_info'
  id: string
  reason: string
  cost: number
  tokens: {
    input: number
    output: number
    reasoning: number
    cache: { read: number; write: number }
  }
}

export interface SubtaskBlock {
  type: 'subtask'
  id: string
  description: string
  agent: string
  prompt: string
  status: 'pending' | 'running' | 'completed'
}

export type AgentBlock = ThinkingBlock | ToolCallsBlock | TextBlock | StepInfoBlock | SubtaskBlock

import type { Attachment } from '../features/attachment'

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string  // 用户消息内容，或 assistant 最终文本
  timestamp: Date
  // 附件（用户消息的文件/图片/agent引用）
  attachments?: Attachment[]
  // Agent 流程块（仅 assistant）
  blocks?: AgentBlock[]
  // 是否整体还在处理中
  isStreaming?: boolean
  pendingApproval?: PermissionRequest // 当前等待批准的请求
}

// ============================================
// Permission Types
// ============================================

export type PermissionDecision = 
  | 'pending'           // 等待用户决定
  | 'approved_once'     // 仅本次批准
  | 'approved_session'  // 本次会话永久批准
  | 'rejected'          // 拒绝

export interface PermissionRequest {
  id: string
  tool: ToolType
  title: string
  description?: string
  sites?: string[]      // 涉及的站点 (可选)
  steps?: string[]      // 执行步骤
}

// ============================================
// Settings Types
// ============================================

export type PermissionMode = 'ask' | 'act'

export interface ChatSettings {
  model: string
  permissionMode: PermissionMode
}
