// ============================================
// Message Types — OpenCode v2 原生
//
// ## v2 的消息形状（与 v1 根本不同）
//
// v1：`{ info: Message, parts: Part[] }` —— 消息与内容分离，靠 messageID 关联。
// v2：消息**自带内容**，统一在 `content` 字段里，且是判别联合：
//
//   SessionMessageUser      → { type: 'user', text, files?, agents?, skills? }
//   SessionMessageAssistant → { type: 'assistant', content: AssistantContent[] }
//   SessionMessageSystem / Synthetic / Skill / Shell / ...
//
// 助手内容三态（`content` 数组元素）：
//   { type: 'text',      text }
//   { type: 'reasoning', text, time? }
//   { type: 'tool',      id, name, state }   state.status ∈ streaming|running|completed|error
//
// 因此本层**不提供** v1 的 `parts` 概念；UI 直接消费 `content`。
// 实时增量通过独立事件（text.delta / reasoning.delta / tool.*）到达，
// 由 store 投影进这些结构，见 `src/api/events.ts`。
// ============================================

import type {
  SessionMessageAgentSelected as V2AgentSelected,
  SessionMessageAssistant as V2Assistant,
  SessionMessageAssistantReasoning as V2AssistantReasoning,
  SessionMessageAssistantText as V2AssistantText,
  SessionMessageAssistantTool as V2AssistantTool,
  SessionMessageCompactionFailed as V2CompactionFailed,
  SessionMessageCompactionRunning as V2CompactionRunning,
  SessionMessageCompactionCompleted as V2CompactionCompleted,
  SessionMessageIdle as V2Idle,
  SessionMessageLocationSwitched as V2LocationSwitched,
  SessionMessageModelSelected as V2ModelSelected,
  SessionMessageShell as V2Shell,
  SessionMessageSkill as V2Skill,
  SessionMessageSynthetic as V2Synthetic,
  SessionMessageSystem as V2System,
  SessionMessageUser as V2User,
  SessionMessageToolStateCompleted as V2ToolStateCompleted,
  SessionMessageToolStateError as V2ToolStateError,
  SessionMessageToolStateRunning as V2ToolStateRunning,
  SessionMessageToolStateStreaming as V2ToolStateStreaming,
  SessionMessagesResponse as V2MessagesResponse,
  ToolContent as V2ToolContent,
} from '@opencode/client/promise'

// ============================================
// 消息实体
// ============================================

export type UserMessage = V2User

export type AssistantMessage = V2Assistant

/** 会话里的全部消息形态 */
export type SessionMessage =
  | V2User
  | V2Assistant
  | V2System
  | V2Synthetic
  | V2Skill
  | V2Shell
  | V2AgentSelected
  | V2ModelSelected
  | V2LocationSwitched
  | V2CompactionRunning
  | V2CompactionCompleted
  | V2CompactionFailed
  | V2Idle

/** 向后兼容别名（旧调用点仍写 Message） */
export type Message = SessionMessage

/** `message.list()` 的响应：{ data, cursor } */
export type MessagesResponse = V2MessagesResponse

// ============================================
// 助手内容（content 数组元素）
// ============================================

export type AssistantText = V2AssistantText

export type AssistantReasoning = V2AssistantReasoning

export type AssistantTool = V2AssistantTool

/** 助手消息的内容联合 */
export type AssistantContent = AssistantText | AssistantReasoning | AssistantTool

/** 工具调用状态（判别联合，按 status 细分） */
export type ToolStateStreaming = V2ToolStateStreaming

export type ToolStateRunning = V2ToolStateRunning

export type ToolStateCompleted = V2ToolStateCompleted

export type ToolStateError = V2ToolStateError

export type ToolState = ToolStateStreaming | ToolStateRunning | ToolStateCompleted | ToolStateError

/** 工具产出内容（文本或文件） */
export type ToolContent = V2ToolContent

// ============================================
// 判别辅助
// ============================================

export function isUserMessage(message: SessionMessage): message is UserMessage {
  return message.type === 'user'
}

export function isAssistantMessage(message: SessionMessage): message is AssistantMessage {
  return message.type === 'assistant'
}

export function isAssistantText(content: AssistantContent): content is AssistantText {
  return content.type === 'text'
}

export function isAssistantReasoning(content: AssistantContent): content is AssistantReasoning {
  return content.type === 'reasoning'
}

export function isAssistantTool(content: AssistantContent): content is AssistantTool {
  return content.type === 'tool'
}

/** 助手消息的可见文本（拼接全部 text 片段） */
export function assistantText(message: AssistantMessage): string {
  return message.content
    .filter(isAssistantText)
    .map(part => part.text)
    .join('')
}

/** 助手消息是否含可渲染内容 */
export function hasRenderableContent(message: AssistantMessage): boolean {
  return message.content.some(part => {
    if (part.type === 'text') return part.text.trim().length > 0
    return true
  })
}
