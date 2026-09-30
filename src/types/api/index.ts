// ============================================
// API Types - 统一导出
// ============================================
//
// 所有 API 类型都从这里导出
// 使用方式: import type { Session, Message, Part } from '@/types/api'
//

// Common types
export type { ErrorInfo } from './common'

// Session types
export type {
  Session,
  SessionStatus,
  SessionStatusMap,
  SessionSummary,
  SessionShare,
  SessionRevert,
  SessionListParams,
  SessionCreateParams,
  SessionUpdateParams,
  SessionForkParams,
} from './session'

// Message types（阶段 2b：V1 别名（Message / Part 联合 / 各种 *Input）已删除，
// 定义源头是 `v1Model.ts` 的 A 桶；V2 侧类型见本文件上方的 SessionMessage* 一组）
export type {
  SessionMessageInfo,
  SessionMessageType,
  SessionMessageFilterType,
  SessionMessageUser,
  SessionMessageAssistant,
  SessionMessageAssistantContent,
  SessionMessageAssistantText,
  SessionMessageAssistantReasoning,
  SessionMessageAssistantTool,
  SessionMessageToolState,
  SessionMessageToolStateStreaming,
  SessionMessageToolStateRunning,
  SessionMessageToolStateCompleted,
  SessionMessageToolStateError,
  SessionMessageSystem,
  SessionMessageSkill,
  SessionMessageShell,
  SessionMessageSynthetic,
  SessionMessageIdle,
  SessionMessageCompaction,
  SessionMessageAgentSelected,
  SessionMessageModelSelected,
  SessionMessageLocationSwitched,
  PromptFileAttachment,
  PromptAgentAttachment,
  PromptSkillAttachment,
  SessionMessagesResponse,
  MessageCursor,
  MessageListParams,
  MessagePage,
  SessionStructuredError,
  SessionTokenUsage,
  SessionModelRef,
  SessionLocationPublicRef,
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
  PermissionToolInfo,
  PermissionRequest,
  PermissionReply,
  PermissionSavedRule,
  PermissionSavedListParams,
} from './permission'

// Form types（V2 新增体系，取代 V1 的 question）
export type {
  FormField,
  FormFieldOfType,
  FormWhen,
  FormOption,
  FormValue,
  FormAnswer,
  FormState,
  FormInfo,
  FormDetail,
} from './form'

// File types
// ⛔ 阶段 3b 删除了 FilePatch / PatchHunk / Symbol / SymbolLocation / SymbolRange / TextSearchMatch：
//   前两个只服务 V1 的 `FileContent.patch`（V2 的 fs/read 只给原始字节）；
//   后四个服务已删除的符号搜索与内容搜索（V2 不再跑语言服务器、无内容搜索端点）。
export type { FileNode, FileNodeType, FileContent, FileDiff, FileStatusItem } from './file'

// Project types
export type { Project, ProjectIcon, ProjectCommands, ProjectUpdateParams, PathResponse } from './project'

// Agent types
export type { Agent, AgentMode, AgentPermission } from './agent'

// Event types
export type {
  V2EventUnion,
  EventType,
  EventCallbacks,
  EventStructuredError,
  EventTokenUsage,
  AssistantFinish,
  AssistantContent,
  MessageContentUpdatedPayload,
  PartContentUpdatedPayload,
  PartStepEndedPayload,
  PartUpdatedPayload,
  PartDeltaPayload,
  SessionCreatedPayload,
  SessionInfoPatch,
  SessionDeletedPayload,
  SessionIdlePayload,
  SessionStatusPayload,
  SessionErrorPayload,
  SessionUsagePayload,
  SessionRetryPayload,
  ServerConnectedPayload,
  PermissionAskedPayload,
  PermissionRepliedPayload,
  FormCreatedPayload,
  FormRepliedPayload,
  FormCancelledPayload,
  WorktreeUpdatedPayload,
  WorktreeResolvedPayload,
  VcsBranchUpdatedPayload,
  ProjectUpdatedPayload,
} from './event'
export { EventTypes } from './event'

// ⛔ 阶段 3b 已删除 `./todo` 的类型转发（TodoItem）：
//   V2 没有任何待办能力（端点删除 / 事件不存在 / 无 todo 工具）→
//   `src/api/todo.ts`、`src/types/api/todo.ts`、`src/store/todoStore.ts` 一并下架。

// Config types
export type {
  Config,
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
  MCPResource,
  MCPStatusResponse,
  McpServerConfig,
} from './mcp'

// Skill types
export type { Skill, SkillList } from './skill'

// PTY types
export type { Pty, PtySize, PtyCreateParams, PtyUpdateParams } from './pty'

// VCS types
export type { VcsInfo, VcsDiffMode } from './vcs'

// Worktree types
export type { Worktree, WorktreeCreateInput, WorktreeRemoveInput } from './worktree'

// ⛔ 阶段 3b 已删除 `./tool` 的类型转发（ToolIDs / ToolList / ToolListItem）：
//   V2 删除了 `/experimental/tool` 与 `/experimental/tool/ids` 两个端点，
//   本仓库零调用点，`src/types/api/tool.ts` 与 `src/api/tool.ts` 一并删除。
