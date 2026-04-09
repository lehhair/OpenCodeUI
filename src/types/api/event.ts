// ============================================
// Event API Types
// SDK 是类型真相源，本地只保留必要的运行时适配
// ============================================

import type {
  EventMessagePartDelta as SDKEventMessagePartDelta,
  EventMessagePartRemoved as SDKEventMessagePartRemoved,
  EventPermissionReplied as SDKEventPermissionReplied,
  EventQuestionRejected as SDKEventQuestionRejected,
  EventQuestionReplied as SDKEventQuestionReplied,
  EventSessionDiff as SDKEventSessionDiff,
  EventSessionIdle as SDKEventSessionIdle,
  EventSessionStatus as SDKEventSessionStatus,
  EventTodoUpdated as SDKEventTodoUpdated,
  EventVcsBranchUpdated as SDKEventVcsBranchUpdated,
  EventWorktreeFailed as SDKEventWorktreeFailed,
  EventWorktreeReady as SDKEventWorktreeReady,
  GlobalEvent as SDKGlobalEvent,
  Todo as SDKTodo,
} from '@opencode-ai/sdk/v2/client'
import type { Session } from './session'
import type { Message, Part } from './message'
import type { PermissionRequest, QuestionRequest } from './permission'
import type { Project } from './project'

// ============================================
// Event Payload Types
// ============================================

export type SessionIdlePayload = SDKEventSessionIdle['properties']

export interface SessionErrorPayload {
  sessionID: string
  name: string
  data: unknown
}

export type SessionStatusPayload = SDKEventSessionStatus['properties']

export type SessionDiffPayload = SDKEventSessionDiff['properties']

export type PartRemovedPayload = SDKEventMessagePartRemoved['properties']

export type PartDeltaPayload = SDKEventMessagePartDelta['properties']

export type PermissionRepliedPayload = SDKEventPermissionReplied['properties']

export type QuestionRepliedPayload = SDKEventQuestionReplied['properties']

export type QuestionRejectedPayload = SDKEventQuestionRejected['properties']

export type TodoItem = SDKTodo & {
  // SDK 的 Todo 没有 id，这里是前端适配层补上的稳定 key
  id: string
}

export type TodoUpdatedPayload = Omit<SDKEventTodoUpdated['properties'], 'todos'> & {
  todos: TodoItem[]
}

export type WorktreeReadyPayload = SDKEventWorktreeReady['properties']

export type WorktreeFailedPayload = SDKEventWorktreeFailed['properties']

export type VcsBranchUpdatedPayload = SDKEventVcsBranchUpdated['properties']

// ============================================
// Global Event Type
// ============================================

export type GlobalEvent = SDKGlobalEvent

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
  MESSAGE_PART_DELTA: 'message.part.delta',
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

  // TUI events
  TUI_PROMPT_APPEND: 'tui.prompt.append',
  TUI_COMMAND_EXECUTE: 'tui.command.execute',
  TUI_TOAST_SHOW: 'tui.toast.show',
  TUI_SESSION_SELECT: 'tui.session.select',

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
  WORKSPACE_READY: 'workspace.ready',
  WORKSPACE_FAILED: 'workspace.failed',
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
} as const satisfies Record<string, SDKGlobalEvent['payload']['type']>

export type EventType = SDKGlobalEvent['payload']['type']

// ============================================
// Event Callbacks Interface
// ============================================

export interface EventCallbacks {
  onMessageUpdated?: (message: Message) => void
  onPartUpdated?: (part: Part, delta?: string) => void
  onPartDelta?: (data: PartDeltaPayload) => void
  onPartRemoved?: (data: PartRemovedPayload) => void
  onSessionCreated?: (session: Session) => void
  onSessionUpdated?: (session: Session) => void
  onSessionDeleted?: (sessionId: string) => void
  onSessionIdle?: (data: SessionIdlePayload) => void
  onSessionError?: (data: SessionErrorPayload) => void
  onSessionStatus?: (data: SessionStatusPayload) => void
  onPermissionAsked?: (request: PermissionRequest) => void
  onPermissionReplied?: (data: PermissionRepliedPayload) => void
  onQuestionAsked?: (request: QuestionRequest) => void
  onQuestionReplied?: (data: QuestionRepliedPayload) => void
  onQuestionRejected?: (data: QuestionRejectedPayload) => void
  onTodoUpdated?: (data: TodoUpdatedPayload) => void
  onProjectUpdated?: (project: Project) => void
  onWorktreeReady?: (data: WorktreeReadyPayload) => void
  onWorktreeFailed?: (data: WorktreeFailedPayload) => void
  onVcsBranchUpdated?: (data: VcsBranchUpdatedPayload) => void
  onError?: (error: Error) => void
  onReconnected?: (reason: 'network' | 'server-switch') => void
}
