// ============================================
// Event API Types
// 基于 OpenAPI 规范
// ============================================

import type { Session } from './session'
import type { Message, Part } from './message'
import type { PermissionRequest, PermissionReply, QuestionRequest, QuestionAnswer } from './permission'
import type { Project } from './project'

// ============================================
// Event Payload Types
// ============================================

export interface SessionIdlePayload {
  sessionID: string
}

export interface SessionErrorPayload {
  sessionID: string
  name: string
  data: unknown
}

export interface SessionDiffPayload {
  sessionID: string
  diffs: Array<{
    file: string
    before: string
    after: string
    additions: number
    deletions: number
  }>
}

export interface PartRemovedPayload {
  id: string
  messageID: string
  sessionID: string
}

export interface PermissionRepliedPayload {
  sessionID: string
  requestID: string
  reply: PermissionReply
}

export interface QuestionRepliedPayload {
  sessionID: string
  requestID: string
  answers: QuestionAnswer[]
}

export interface QuestionRejectedPayload {
  sessionID: string
  requestID: string
}

export interface TodoItem {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  priority: 'high' | 'medium' | 'low'
}

export interface TodoUpdatedPayload {
  sessionID: string
  todos: TodoItem[]
}

// ============================================
// Global Event Type
// ============================================

/**
 * 全局事件包装器
 */
export interface GlobalEvent {
  directory: string
  payload: {
    type: string
    properties: unknown
  }
}

/**
 * 事件类型常量
 */
export const EventTypes = {
  // Session events
  SESSION_CREATED: 'session.created',
  SESSION_UPDATED: 'session.updated',
  SESSION_DELETED: 'session.deleted',
  SESSION_IDLE: 'session.idle',
  SESSION_ERROR: 'session.error',
  SESSION_STATUS: 'session.status',
  SESSION_DIFF: 'session.diff',
  SESSION_COMPACTED: 'session.compacted',
  
  // Message events
  MESSAGE_UPDATED: 'message.updated',
  MESSAGE_REMOVED: 'message.removed',
  MESSAGE_PART_UPDATED: 'message.part.updated',
  MESSAGE_PART_REMOVED: 'message.part.removed',
  
  // Permission events
  PERMISSION_ASKED: 'permission.asked',
  PERMISSION_REPLIED: 'permission.replied',
  
  // Question events
  QUESTION_ASKED: 'question.asked',
  QUESTION_REPLIED: 'question.replied',
  QUESTION_REJECTED: 'question.rejected',
  
  // Todo events
  TODO_UPDATED: 'todo.updated',
  
  // Project events
  PROJECT_UPDATED: 'project.updated',
  
  // Server events
  SERVER_CONNECTED: 'server.connected',
  SERVER_INSTANCE_DISPOSED: 'server.instance.disposed',
  GLOBAL_DISPOSED: 'global.disposed',
  
  // File events
  FILE_EDITED: 'file.edited',
  FILE_WATCHER_UPDATED: 'file.watcher.updated',
  
  // Other events
  INSTALLATION_UPDATED: 'installation.updated',
  INSTALLATION_UPDATE_AVAILABLE: 'installation.update-available',
  WORKTREE_READY: 'worktree.ready',
  WORKTREE_FAILED: 'worktree.failed',
  LSP_CLIENT_DIAGNOSTICS: 'lsp.client.diagnostics',
  LSP_UPDATED: 'lsp.updated',
  MCP_TOOLS_CHANGED: 'mcp.tools.changed',
  MCP_BROWSER_OPEN_FAILED: 'mcp.browser.open.failed',
  VCS_BRANCH_UPDATED: 'vcs.branch.updated',
  COMMAND_EXECUTED: 'command.executed',
  PTY_CREATED: 'pty.created',
  PTY_UPDATED: 'pty.updated',
  PTY_EXITED: 'pty.exited',
  PTY_DELETED: 'pty.deleted',
} as const

export type EventType = typeof EventTypes[keyof typeof EventTypes]

// ============================================
// Event Callbacks Interface
// ============================================

/**
 * 事件回调接口
 */
export interface EventCallbacks {
  onMessageUpdated?: (message: Message) => void
  onPartUpdated?: (part: Part) => void
  onPartRemoved?: (data: PartRemovedPayload) => void
  onSessionCreated?: (session: Session) => void
  onSessionUpdated?: (session: Session) => void
  onSessionDeleted?: (sessionId: string) => void
  onSessionIdle?: (data: SessionIdlePayload) => void
  onSessionError?: (data: SessionErrorPayload) => void
  onPermissionAsked?: (request: PermissionRequest) => void
  onPermissionReplied?: (data: PermissionRepliedPayload) => void
  onQuestionAsked?: (request: QuestionRequest) => void
  onQuestionReplied?: (data: QuestionRepliedPayload) => void
  onQuestionRejected?: (data: QuestionRejectedPayload) => void
  onTodoUpdated?: (data: TodoUpdatedPayload) => void
  onProjectUpdated?: (project: Project) => void
  onError?: (error: Error) => void
}
