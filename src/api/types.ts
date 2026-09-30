// API Types - 向后兼容层

export type * from '../types/api'

export type { ModelInfo, FileCapabilities, Attachment, AttachmentType } from '../types/ui'

export type { Model as ApiModel, Provider as ApiProvider, ProvidersResponse } from '../types/api/model'
export type { Project as ApiProject, PathResponse as ApiPath } from '../types/api/project'
export type {
  Session as ApiSession,
  SessionListParams,
  SessionRevert as SessionRevertState,
} from '../types/api/session'
export type { SessionMessageInfo as ApiSessionMessage } from '../types/api/message'
export type {
  PermissionRequest as ApiPermissionRequest,
  PermissionReply,
  PermissionSavedRule,
  PermissionSavedListParams,
} from '../types/api/permission'
export type { Agent as ApiAgent, AgentPermission as ApiAgentPermission } from '../types/api/agent'

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
  directory?: string
}

export interface SendMessageResponse {
  /**
   * ⚠️ **阶段 2b 语义变更**：V2 没有「一次请求拿回复」的接口
   * （`prompt` 只是把输入入队，回复只出现在转录里）。
   * 所以这里返回的是**入队记录**，不是 AI 回复 —— 见 `src/api/message.ts` 的说明。
   * 保留这两个字段只是为了不改动调用方签名。
   */
  info: import('../types/message').AssistantMessageInfo
  parts: import('../types/message').Part[]
}
