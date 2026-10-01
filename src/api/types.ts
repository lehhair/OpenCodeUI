// ============================================
// API Types — UI 侧别名层（OpenCode v2 原生）
//
// 这里把 `src/types/api` 的 v2 类型收敛成 UI 习惯的命名，
// 不引入任何 v1 形状。
// ============================================

export type * from '../types/api'

/** 运行时辅助：判断表单字段是否属于「有选项可点」的类型 */
export { isChoiceField } from '../types/api'

export type { ModelInfo, FileCapabilities, Attachment, AttachmentType } from '../types/ui'

export type { Model as ApiModel, Provider as ApiProvider, ProvidersResponse } from '../types/api/model'
export type { Project as ApiProject, PathResponse as ApiPath } from '../types/api/project'
export type {
  Session as ApiSession,
  SessionListParams,
  SessionRevert as SessionRevertState,
} from '../types/api/session'
export type {
  SessionMessage as ApiMessage,
  SessionMessage as ApiMessageWithParts,
  UserMessage as ApiUserMessage,
  AssistantMessage as ApiAssistantMessage,
  AssistantContent as ApiPart,
  AssistantText as ApiTextPart,
  AssistantReasoning as ApiReasoningPart,
  AssistantTool as ApiToolPart,
  ToolState as ApiToolState,
} from '../types/api/message'
export type {
  PermissionRequestModel as ApiPermissionRequest,
  PermissionReply,
  FormInfo as ApiFormInfo,
  FormField as ApiFormField,
  FormAnswer,
  QuestionRequest as ApiQuestionRequest,
  QuestionOption as ApiQuestionOption,
  QuestionInfo as ApiQuestionInfo,
  QuestionAnswer,
} from '../types/api/permission'
export type { Agent as ApiAgent, AgentPermission as ApiAgentPermission } from '../types/api/agent'

import type { Attachment } from '../types/ui'

// ============================================
// 发送消息
// ============================================

export interface RevertedMessage {
  text: string
  attachments: Attachment[]
}

export interface SendMessageParams {
  sessionId: string
  text: string
  attachments: Attachment[]
  model?: {
    providerID: string
    modelID: string
  }
  agent?: string
  variant?: string
  directory?: string
}
