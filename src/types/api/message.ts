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
  PromptAgentAttachment as V2PromptAgentAttachment,
  PromptFileAttachment as V2PromptFileAttachment,
  SessionMessageAgentSelected as V2AgentSelected,
  SessionMessageAssistant as V2Assistant,
  SessionMessageAssistantReasoning as V2AssistantReasoning,
  SessionMessageAssistantText as V2AssistantText,
  SessionMessageAssistantTool as V2AssistantTool,
  SessionMessageCompactionFailed as V2CompactionFailed,
  SessionMessageCompactionRunning as V2CompactionRunning,
  SessionMessageCompactionCompleted as V2CompactionCompleted,
  SessionMessageIdle as V2Idle,
  SessionMessageInfo as V2MessageInfo,
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

/**
 * 会话消息的完整判别联合（含 idle / shell / 各类 switched 事件）。
 *
 * 这是 `message.list()` 的元素类型，也是渲染层的输入：
 * 每条消息**自带内容**，渲染层不再需要 `{ info, parts }` 视图模型。
 */
export type SessionMessageInfo = V2MessageInfo

/** `message.list()` 的响应：{ data, cursor } */
export type MessagesResponse = V2MessagesResponse

/** 用户消息里的文件附件（消息**记录**里的形状：data + source，没有 uri） */
export type PromptFileAttachment = V2PromptFileAttachment

/** 用户消息里的 agent 提及 */
export type PromptAgentAttachment = V2PromptAgentAttachment

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

// ============================================
// 内容条目（带稳定 id）
//
// v2 的 `content` 数组元素**没有 id 字段**（只有 tool 有 `id`）。
// 官方在 `packages/session-ui/src/timeline/projection.ts` 里按需派生出 id：
//
//   const ordinals = { text: 0, reasoning: 0 }
//   id = content.type === "tool"
//     ? content.id
//     : `${message.id}:${content.type}:${ordinals[content.type]++}`
//
// 注意 ordinal 是**按 kind 各自计数**（text 一个、reasoning 一个），
// 不是混合 content 数组的下标。官方 core 的 publish-llm-event.ts 也是每个
// fragment kind 各自 `nextOrdinal++`，cli/acp/event.ts 里有一句明确注释：
// "Live reasoning ordinals count only reasoning parts, not the mixed content array."
//
// 这个 id 只用于**渲染时的 React key / 展开状态 / 滚动锚点**，
// 流式事件本身用 findLast 定位（见 store 的 handleTextDelta 等）。
// ============================================

/** 内容条目：原生 content 元素 + 派生 id */
export type ContentEntry<T extends AssistantContent = AssistantContent> = {
  id: string
  content: T
}

/** 给助手消息的 content 数组补齐稳定 id（与官方算法一致） */
export function contentEntries(message: AssistantMessage): Array<ContentEntry> {
  const ordinals = { text: 0, reasoning: 0 }
  return message.content.map(content => ({
    id: content.type === 'tool' ? content.id : `${message.id}:${content.type}:${ordinals[content.type]++}`,
    content,
  }))
}

/** 按派生 id 反查内容条目（与官方 resolveContent 同一算法，单次遍历） */
export function resolveContent(message: SessionMessage | undefined, partID: string): AssistantContent | undefined {
  if (message?.type !== 'assistant') return undefined
  const ordinals: { text: number; reasoning: number } = { text: 0, reasoning: 0 }
  for (const content of message.content) {
    const id = content.type === 'tool' ? content.id : `${message.id}:${content.type}:${ordinals[content.type]++}`
    if (id === partID) return content
  }
  return undefined
}

/** 文本类内容（text / reasoning）是否为「可见正文」（非空白） */
export function hasVisibleText(content: AssistantContent): boolean {
  return content.type === 'text' || content.type === 'reasoning' ? content.text.trim().length > 0 : false
}

/** 用户消息的可见正文（v2 里正文就是 message.text） */
export function userMessageText(message: UserMessage): string {
  return typeof message.text === 'string' ? message.text : ''
}
