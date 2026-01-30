// ============================================
// API Types - 统一导出
// ============================================
// 
// 所有 API 类型都从这里导出
// 使用方式: import type { Session, Message, Part } from '@/types/api'
//

// Common types
export type {
  TimeInfo,
  TokenUsage,
  ModelRef,
  PathInfo,
  ErrorInfo,
  TextRange,
  BadRequestError,
  NotFoundError,
  ProviderAuthError,
  UnknownError,
  MessageOutputLengthError,
  MessageAbortedError,
  APIError,
} from './common'

// Session types
export type {
  Session,
  SessionStatus,
  SessionSummary,
  SessionShare,
  SessionRevert,
  SessionListParams,
  SessionCreateParams,
  SessionUpdateParams,
  SessionForkParams,
} from './session'

// Message types
export type {
  Message,
  UserMessage,
  AssistantMessage,
  MessageSummary,
  MessageWithParts,
  Part,
  TextPart,
  ReasoningPart,
  ToolPart,
  ToolState,
  FilePart,
  FileSource,
  FileSourceType,
  AgentPart,
  StepStartPart,
  StepFinishPart,
  SnapshotPart,
  PatchPart,
  SubtaskPart,
  RetryPart,
  CompactionPart,
  TextPartInput,
  FilePartInput,
  AgentPartInput,
  SubtaskPartInput,
  SendMessageBody,
} from './message'

// Model types
export type {
  Model,
  ModelStatus,
  ModelLimit,
  ModelCapabilities,
  ModelIOCapabilities,
  Provider,
  ProvidersResponse,
  ProviderAuthMethod,
  ProviderAuthAuthorization,
} from './model'

// Permission types
export type {
  PermissionAction,
  PermissionRule,
  PermissionRuleset,
  PermissionToolInfo,
  PermissionRequest,
  PermissionReply,
  QuestionOption,
  QuestionInfo,
  QuestionRequest,
  QuestionAnswer,
} from './permission'

// File types
export type {
  FileNode,
  FileNodeType,
  FileContent,
  FileDiff,
  FileStatus,
  Symbol,
  SymbolLocation,
  SymbolRange,
} from './file'

// Project types
export type {
  Project,
  ProjectIcon,
  ProjectCommands,
  ProjectUpdateParams,
  PathResponse,
} from './project'

// Agent types
export type {
  Agent,
  AgentMode,
  AgentPermission,
} from './agent'

// Event types
export type {
  GlobalEvent,
  EventType,
  EventCallbacks,
  SessionIdlePayload,
  SessionErrorPayload,
  SessionDiffPayload,
  PartRemovedPayload,
  PermissionRepliedPayload,
  QuestionRepliedPayload,
  QuestionRejectedPayload,
  TodoItem,
  TodoUpdatedPayload,
} from './event'
export { EventTypes } from './event'

// Config types
export type {
  Config,
  KeybindsConfig,
  LogLevel,
  ServerConfig,
  PermissionConfig,
  PermissionActionConfig,
  PermissionObjectConfig,
  PermissionRuleConfig,
  AgentConfig,
  ProviderConfig,
  McpLocalConfig,
  McpOAuthConfig,
  McpRemoteConfig,
  LayoutConfig,
} from './config'

// MCP types
export type {
  MCPStatus,
  MCPStatusConnected,
  MCPStatusDisabled,
  MCPStatusFailed,
  MCPStatusNeedsAuth,
  MCPStatusNeedsClientRegistration,
  MCPResource,
  MCPStatusResponse,
} from './mcp'

// PTY types
export type {
  Pty,
  PtySize,
  PtyCreateParams,
  PtyUpdateParams,
} from './pty'

// VCS types
export type {
  VcsInfo,
} from './vcs'

// Worktree types
export type {
  Worktree,
  WorktreeCreateInput,
  WorktreeRemoveInput,
  WorktreeResetInput,
} from './worktree'

// Tool types
export type {
  ToolIDs,
  ToolList,
  ToolListItem,
} from './tool'
