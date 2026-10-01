// ============================================
// v2 → UI 视图模型投影
//
// ## 为什么需要这一层
//
// UI 的渲染层（message/parts/*、chat/*）建立在 `{ info, parts }` 视图模型上，
// 有 60+ 处读 `info.role`、70+ 处读 `.parts`、58 处按 `part.type` 分发。
// 那套结构承载的是**设计语言与交互**，与协议无关。
//
// OpenCode v2 换了协议形状（`type` 取代 `role`、`content` 取代 `parts`、
// tool 状态机不同、消息自带内容），但 UI 要表达的东西没变。
// 因此这一层负责把 v2 形状**投影**成 UI 既有模型，让渲染层继续工作。
//
// 投影是纯粹的、可测的：输入 v2 消息，输出 UI 消息。
// ============================================

import type {
  AssistantContent,
  AssistantMessage,
  SessionMessage,
  ToolContent,
  ToolState,
} from '../types/api'
import type {
  AssistantMessageInfo,
  Message,
  MessageInfo,
  Part,
  ToolPart,
  ToolState as UIToolState,
  UserMessageInfo,
} from '../types/message'

// ============================================
// 时间戳
// ============================================

function toMessageTime(time: { created: number; completed?: number }): { created: number; completed?: number } {
  return { created: time.created, completed: time.completed }
}

// ============================================
// 消息 info 投影
// ============================================

/**
 * v2 用户消息 → UI UserMessageInfo
 *
 * 字段映射：
 *   type 'user' → role 'user'
 *   （v2 没有 sessionID，由调用方按所在会话注入）
 */
export function toUserMessageInfo(message: SessionMessage, sessionID: string): UserMessageInfo {
  const user = message as Extract<SessionMessage, { type: 'user' }>
  return {
    id: user.id,
    sessionID,
    role: 'user',
    time: toMessageTime(user.time),
    agent: '',
    model: { providerID: '', modelID: '' },
  }
}

/**
 * v2 助手消息 → UI AssistantMessageInfo
 *
 * 字段映射：
 *   type 'assistant' → role 'assistant'
 *   model.{id,providerID} → modelID/providerID
 *   agent → agent
 *   error 透传
 */
export function toAssistantMessageInfo(message: AssistantMessage, sessionID: string): AssistantMessageInfo {
  return {
    id: message.id,
    sessionID,
    role: 'assistant',
    time: toMessageTime(message.time),
    parentID: '',
    modelID: message.model?.id ?? '',
    providerID: message.model?.providerID ?? '',
    mode: '',
    agent: message.agent ?? '',
    path: { cwd: '', root: '' },
    cost: message.cost ?? 0,
    tokens: {
      input: message.tokens?.input ?? 0,
      output: message.tokens?.output ?? 0,
      reasoning: message.tokens?.reasoning ?? 0,
      cache: {
        read: message.tokens?.cache?.read ?? 0,
        write: message.tokens?.cache?.write ?? 0,
      },
    },
    finish: message.finish,
    error: message.error as never,
  }
}

/**
 * v2 消息 → UI MessageInfo。
 *
 * 非 user/assistant 的消息（system / synthetic / skill / shell / 各类
 * 选择事件 / compaction / idle）在 UI 里没有对应展示，
 * 用 assistant 形状承载以免渲染层拿到 undefined。
 */
export function toMessageInfo(message: SessionMessage, sessionID: string): MessageInfo {
  if (message.type === 'user') return toUserMessageInfo(message, sessionID)
  if (message.type === 'assistant') return toAssistantMessageInfo(message, sessionID)
  return toAssistantMessageInfo(
    {
      id: message.id,
      time: message.time,
      type: 'assistant',
      agent: '',
      model: { id: '', providerID: '' },
      content: [],
      metadata: message.metadata,
    } as AssistantMessage,
    sessionID,
  )
}

// ============================================
// 工具状态投影
// ============================================

/** 把 v2 工具产出的 content 数组拼成文本（UI 的 ToolState.output） */
function toolContentToText(content: readonly ToolContent[] | undefined): string {
  if (!Array.isArray(content)) return ''
  return content
    .map(entry => {
      if (!entry || typeof entry !== 'object') return ''
      if (entry.type === 'text') return entry.text
      if (entry.type === 'file') return entry.name ? `[file: ${entry.name}]` : `[file: ${entry.uri}]`
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

/**
 * v2 工具状态 → UI ToolState。
 *
 * v2 的 state 是判别联合（streaming | running | completed | error），
 * 其中:
 *   - streaming: input 是**字符串**（增量 JSON）
 *   - running:   input 是对象，metadata 必填
 *   - completed: input 对象 + content 数组（非空元组）
 *   - error:     input 对象 + error
 *
 * UI 的 ToolState 是宽松形状（status/input/output/title/error/time/metadata），
 * 这里做一次映射，把 content 拼成 output。
 */
export function toUIToolState(state: ToolState): UIToolState {
  switch (state.status) {
    case 'streaming':
      return {
        status: 'running',
        input: {},
        raw: typeof state.input === 'string' ? state.input : '',
      }
    case 'running':
      return {
        status: 'running',
        input: (state.input ?? {}) as Record<string, unknown>,
        metadata: (state.metadata ?? {}) as Record<string, unknown>,
      }
    case 'completed':
      return {
        status: 'completed',
        input: (state.input ?? {}) as Record<string, unknown>,
        output: toolContentToText(state.content),
        title: typeof state.metadata?.title === 'string' ? state.metadata.title : undefined,
        metadata: (state.metadata ?? {}) as Record<string, unknown>,
      }
    case 'error':
      return {
        status: 'error',
        input: (state.input ?? {}) as Record<string, unknown>,
        error: typeof state.error === 'string' ? state.error : JSON.stringify(state.error),
        metadata: (state.metadata ?? {}) as Record<string, unknown>,
      }
    default:
      return { status: 'running', input: {} }
  }
}

// ============================================
// content → parts 投影
// ============================================

/**
 * 把 v2 助手 content 数组投影成 UI parts。
 *
 * 映射：
 *   { type:'text', text }        → TextPart
 *   { type:'reasoning', text }   → ReasoningPart
 *   { type:'tool', id, name, state } → ToolPart（callID=id, tool=name）
 *
 * UI part 需要 `id` / `sessionID` / `messageID`，由参数补全。
 */
export function contentToParts(
  content: AssistantContent[],
  sessionID: string,
  messageID: string,
): Part[] {
  const parts: Part[] = []

  content.forEach((entry, index) => {
    if (entry.type === 'text') {
      parts.push({
        id: `${messageID}:text:${index}`,
        sessionID,
        messageID,
        type: 'text',
        text: entry.text,
      })
      return
    }

    if (entry.type === 'reasoning') {
      parts.push({
        id: `${messageID}:reasoning:${index}`,
        sessionID,
        messageID,
        type: 'reasoning',
        text: entry.text,
        time: { start: entry.time?.created ?? 0, end: entry.time?.completed },
      })
      return
    }

    if (entry.type === 'tool') {
      parts.push({
        id: `${messageID}:tool:${entry.id}`,
        sessionID,
        messageID,
        type: 'tool',
        callID: entry.id,
        tool: entry.name,
        state: toUIToolState(entry.state),
      } satisfies ToolPart)
    }
  })

  return parts
}

/**
 * 用户消息的附件投影成 UI parts。
 *
 * v2 的用户消息把附件放在 `files` / `agents` / `skills` 数组里，
 * UI 侧把它渲染成 file / agent parts。
 */
function userAttachmentsToParts(
  message: Extract<SessionMessage, { type: 'user' }>,
  sessionID: string,
  messageID: string,
): Part[] {
  const parts: Part[] = []

  message.files?.forEach((file, index) => {
    parts.push({
      id: `${messageID}:file:${index}`,
      sessionID,
      messageID,
      type: 'file',
      mime: file.mime ?? '',
      filename: file.name,
      url: file.data ?? '',
    } as Part)
  })

  message.agents?.forEach((agent, index) => {
    parts.push({
      id: `${messageID}:agent:${index}`,
      sessionID,
      messageID,
      type: 'agent',
      name: agent.name,
    } as Part)
  })

  return parts
}

// ============================================
// 完整消息投影
// ============================================

/**
 * v2 消息 → UI Message（`{ info, parts }`）。
 *
 * @param message   v2 消息
 * @param sessionID 所在会话（v2 消息本身不带 sessionID）
 */
export function toUIMessage(message: SessionMessage, sessionID: string): Message {
  const info = toMessageInfo(message, sessionID)

  let parts: Part[] = []
  if (message.type === 'user') {
    parts = userAttachmentsToParts(message, sessionID, message.id)
  } else if (message.type === 'assistant') {
    parts = contentToParts(message.content, sessionID, message.id)
  }

  return {
    info,
    parts,
    isStreaming: message.type === 'assistant' && message.time.completed == null,
  }
}

/**
 * 批量投影。
 */
export function toUIMessages(messages: SessionMessage[], sessionID: string): Message[] {
  return messages.map(message => toUIMessage(message, sessionID))
}
