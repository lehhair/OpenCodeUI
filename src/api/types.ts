// ============================================
// API Types - 向后兼容层
// ============================================
//
// 此文件从 types/api/ 重新导出所有类型，保持向后兼容
// 新代码应该直接从 @/types 或 @/types/api 导入
//

// ============================================
// Re-export from types/api
// ============================================

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
} from '../types/api/common'

// Model types - with aliases for backward compatibility
export type {
  Model as ApiModel,
  Provider as ApiProvider,
  ProvidersResponse,
} from '../types/api/model'

// Project types - with aliases
export type {
  Project as ApiProject,
  PathResponse as ApiPath,
} from '../types/api/project'

// Session types - with aliases
export type {
  Session as ApiSession,
  SessionListParams,
  SessionRevert as SessionRevertState,
} from '../types/api/session'

// Message types - with aliases
export type {
  Message as ApiMessage,
  UserMessage as ApiUserMessage,
  AssistantMessage as ApiAssistantMessage,
  MessageWithParts as ApiMessageWithParts,
  Part as ApiPart,
  TextPart as ApiTextPart,
  ReasoningPart as ApiReasoningPart,
  ToolPart as ApiToolPart,
  FilePart as ApiFilePart,
  AgentPart as ApiAgentPart,
  StepStartPart as ApiStepStartPart,
  StepFinishPart as ApiStepFinishPart,
  SnapshotPart as ApiSnapshotPart,
  PatchPart as ApiPatchPart,
  RetryPart as ApiRetryPart,
  CompactionPart as ApiCompactionPart,
  SubtaskPart as ApiSubtaskPart,
} from '../types/api/message'

// Permission types - with aliases
export type {
  PermissionRequest as ApiPermissionRequest,
  PermissionReply,
  QuestionOption as ApiQuestionOption,
  QuestionInfo as ApiQuestionInfo,
  QuestionRequest as ApiQuestionRequest,
  QuestionAnswer,
} from '../types/api/permission'

// File types
export type {
  FileNode,
  FileContent,
  FileStatusItem,
  FileDiff,
  FilePatch,
  PatchHunk,
  Symbol as SymbolInfo,
} from '../types/api/file'

// Agent types - with aliases
export type {
  Agent as ApiAgent,
  AgentPermission as ApiAgentPermission,
} from '../types/api/agent'

// Event types
export type {
  GlobalEvent,
  EventCallbacks,
} from '../types/api/event'

// ============================================
// UI Types (from types/ui.ts)
// ============================================

export type {
  ModelInfo,
  Attachment,
  AttachmentType,
} from '../types/ui'

// ============================================
// Send Message Types (kept here for now)
// ============================================

import type { Attachment } from '../types/ui'

export interface RevertedMessage {
  text: string
  attachments: Attachment[]
}

export interface SendMessageParams {
  sessionId: string
  text: string
  attachments: Attachment[]
  model: {
    providerID: string
    modelID: string
  }
  agent?: string
  variant?: string
  /** 工作目录（项目目录） */
  directory?: string
}

export interface SendMessageResponse {
  info: import('../types/api/message').AssistantMessage
  parts: import('../types/api/message').Part[]
}
