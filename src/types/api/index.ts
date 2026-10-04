// ============================================
// API Types — OpenCode v2 原生统一导出
// ============================================
//
// 本层是 UI 与 @opencode/client 之间的唯一边界：
//   - 类型直接取自 v2 客户端（或做最小收敛）
//   - 不再有任何 v1 形状的兼容包装
//
// 使用方式: import type { Session, SessionMessage } from '../types/api'
//

// ---- Session ----
export type {
  Session,
  SessionActive,
  SessionStatus,
  SessionStatusMap,
  SessionRevert,
  SessionListParams,
  SessionCreateParams,
  SessionUpdateParams,
  SessionForkParams,
} from './session'
export { sessionDirectory } from './session'

// ---- Message ----
export type {
  Message,
  SessionMessage,
  UserMessage,
  AssistantMessage,
  AssistantContent,
  AssistantText,
  AssistantReasoning,
  AssistantTool,
  ToolState,
  ToolStateStreaming,
  ToolStateRunning,
  ToolStateCompleted,
  ToolStateError,
  ToolContent,
  MessagesResponse,
  ContentEntry,
} from './message'
export {
  isUserMessage,
  isAssistantMessage,
  isAssistantText,
  isAssistantReasoning,
  isAssistantTool,
  assistantText,
  hasRenderableContent,
  // 原生 content 的 id 派生 / 反查（与官方 contentEntries/resolveContent 同算法）
  contentEntries,
  resolveContent,
  hasVisibleText,
  userMessageText,
} from './message'

// 工具状态读取（移植自官方 message/current-tool-state.ts）
export {
  currentToolInput,
  currentToolMetadata,
  currentToolOutput,
  currentToolFiles,
  currentToolError,
  currentToolErrorStatus,
  currentToolFailed,
  currentToolHasLoadedFiles,
  currentContentDefaultOpen,
  shellResultFailed,
  executeToolFailed,
} from './toolState'

// ---- Model / Provider ----
export type {
  Model,
  ModelStatus,
  ModelLimit,
  ModelCapabilities,
  ModelIOCapabilities,
  Provider,
  ProvidersResponse,
  ModelListResponse,
  ProviderListResponse,
  ModelDefaultResponse,
} from './model'

// ---- Permission / Form ----
export type {
  PermissionRequestModel,
  PermissionRequestType,
  PermissionRequestPayload,
  PermissionReply,
  PermissionEffect,
  PermissionSavedInfo,
  PermissionSourceInfo,
  PermissionToolInfo,
  FormInfo,
  FormDetail,
  FormField,
  FormFields,
  FormState,
  FormValue,
  FormAnswer,
  FormMetadata,
  FormOptionInfo,
  FormWhenCondition,
  FormStringFieldType,
  FormNumberFieldType,
  FormIntegerFieldType,
  FormBooleanFieldType,
  FormMultiselectFieldType,
  FormExternalFieldType,
  QuestionRequest,
  QuestionInfo,
  QuestionOption,
  QuestionAnswer,
} from './permission'
export { isChoiceField } from './permission'

// ---- File ----
export type {
  FileNode,
  FileNodeType,
  FileContent,
  FileDiff,
  FileStatusItem,
  FilePatch,
  PatchHunk,
  FileListResponse,
  FileFindResponse,
  FileWriteResponse,
} from './file'
export { normalizeFileDiffs } from './file'

// ---- Project ----
export type {
  Project,
  ProjectIcon,
  ProjectCommands,
  ProjectVcs,
  ProjectList,
  ProjectUpdateParams,
  PathResponse,
} from './project'

// ---- Agent ----
export type { Agent, AgentMode, AgentPermission } from './agent'

// ---- Event ----
export type {
  GlobalEvent,
  OpenCodeEvent,
  EventType,
  EventCallbacks,
  ServerConnectedPayload,
  SessionIdlePayload,
  SessionStatusPayload,
  SessionCreatedPayload,
  SessionDeletedPayload,
  SessionRenamedPayload,
  SessionContentUpdatedPayload,
  TextStartedPayload,
  TextDeltaPayload,
  TextEndedPayload,
  ReasoningStartedPayload,
  ReasoningDeltaPayload,
  ReasoningEndedPayload,
  ToolInputStartedPayload,
  ToolInputDeltaPayload,
  ToolInputEndedPayload,
  ToolCalledPayload,
  ToolProgressPayload,
  ToolSuccessPayload,
  ToolFailedPayload,
  StepStartedPayload,
  StepStreamedPayload,
  StepEndedPayload,
  StepFailedPayload,
  ExecutionStartedPayload,
  ExecutionSucceededPayload,
  ExecutionFailedPayload,
  ExecutionInterruptedPayload,
  PermissionAskedPayload,
  PermissionRepliedPayload,
  FormCreatedPayload,
  FormRepliedPayload,
  FormCancelledPayload,
  RevertStagedPayload,
  RevertClearedPayload,
  RevertCommittedPayload,
  InboxEnqueuedPayload,
  InboxDeliveredPayload,
  InboxCancelledPayload,
  ProjectUpdatedPayload,
  WorktreeUpdatedPayload,
  PluginUpdatedPayload,
  WorktreeResolvedPayload,
  VcsBranchUpdatedPayload,
  McpStatusChangedPayload,
  FilesystemChangedPayload,
  PtyCreatedPayload,
  PtyUpdatedPayload,
  PtyExitedPayload,
  PtyDeletedPayload,
} from './event'
export { EventTypes } from './event'

// ---- Config ----
export type {
  Config,
  ConfigSource,
  ConfigDocument,
  ConfigInfo,
  ConfigUpdateParams,
  ConfigShellsResponse,
  PermissionConfig,
  PermissionRuleConfig,
  PermissionActionConfig,
  PermissionObjectConfig,
  LogLevel,
  ServerConfig,
  AgentConfig,
  ProviderConfig,
  McpServerConfig,
  McpLocalConfig,
  McpRemoteConfig,
  McpOAuthConfig,
  McpProtocol,
  LayoutConfig,
} from './config'

// ---- MCP ----
export type {
  MCPServer,
  MCPStatus,
  MCPStatusConnected,
  MCPStatusPending,
  MCPStatusDisabled,
  MCPStatusFailed,
  MCPStatusNeedsAuth,
  MCPResource,
  MCPResourceMap,
  MCPStatusResponse,
  MCPResourceCatalogResponse,
} from './mcp'

// ---- Skill ----
export type { Skill, SkillList } from './skill'

// ---- PTY ----
export type { Pty, PtySize, PtyCreateParams, PtyUpdateParams, ShellList } from './pty'

// ---- VCS ----
export type {
  VcsInfo,
  VcsDiffMode,
  VcsFileStatus,
  VcsBaseOutput,
  VcsBranchListOutput,
  VcsDiffOutput,
  VcsGetOutput,
  VcsStatusOutput,
} from './vcs'

// ---- Worktree ----
export type {
  Worktree,
  WorktreeDirectory,
  WorktreeList,
  WorktreeListInput,
  WorktreeCreateInput,
  WorktreeRemoveInput,
  WorktreeRefreshInput,
} from './worktree'
