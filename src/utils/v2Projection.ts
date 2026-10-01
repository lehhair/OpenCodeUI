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

import type { AssistantContent, AssistantMessage, SessionMessage, ToolContent, ToolState } from '../types/api'
import type {
  APIError,
  AssistantMessageInfo,
  Message,
  MessageError,
  MessageInfo,
  Part,
  ToolPart,
  ToolState as UIToolState,
  UserMessageInfo,
} from '../types/message'

// ============================================
// 错误投影
// ============================================

/**
 * v2 的结构化错误 → UI 的 MessageError 联合。
 *
 * 两边形状完全不同，**必须显式映射**：
 *   v2: { type: string; message: string; status?: number; response?: { body: string } }
 *   UI: { name: 'APIError' | 'ProviderAuthError' | ...; data: { ... } }
 *
 * 之前这里是 `error: message.error as never`，等于把不匹配的形状硬塞进 UI 模型：
 * MessageErrorView 按 `error.name` 分支、读 `error.data.*`，拿到 v2 形状后
 * name 与 data 都是 undefined，只能落到 default 分支显示通用的
 * 「未知错误」——真实错误信息（以及状态码、响应体）全丢了。
 */
function toMessageError(error: NonNullable<AssistantMessage['error']>): MessageError {
  const message = error.message ?? ''
  const type = (error.type ?? '').toLowerCase()

  // 中断：v2 通过 type 表达
  if (type.includes('abort')) {
    return { name: 'MessageAbortedError', data: { message } }
  }

  // 输出长度上限
  if (type.includes('length') || type.includes('max_token') || type.includes('context')) {
    return { name: 'MessageOutputLengthError', data: {} }
  }

  // 认证：v2 不在这里带 providerID，只能留空
  if (type.includes('auth')) {
    return { name: 'ProviderAuthError', data: { providerID: '', message } }
  }

  // 带 HTTP 状态或响应体 → 按 API 错误展示，保留状态码与响应体
  if (error.status != null || error.response) {
    return {
      name: 'APIError',
      data: {
        message,
        statusCode: error.status,
        responseBody: error.response?.body,
        // 429/5xx 这类通常是可重试的瞬时错误
        isRetryable: error.status == null || error.status === 429 || error.status >= 500,
      },
    }
  }

  return { name: 'UnknownError', data: { message } }
}

/**
 * 重试原因 → UI 的 APIError。
 *
 * `RetryPart.error` 在 UI 里被窄化成 APIError（RetryPartView 直接读
 * `data.isRetryable` / `data.statusCode`），而 v2 的重试本身也是传输/接口层
 * 失败，所以统一按 APIError 承载；非 API 类的结构化错误取其 message 后
 * 仍以 APIError 形状包装，避免组件拿到缺少 data 的对象。
 */
export function toRetryError(error: NonNullable<AssistantMessage['retry']>['error']): APIError {
  const mapped = toMessageError(error)
  if (mapped.name === 'APIError') return mapped

  const message = 'data' in mapped ? ((mapped.data as { message?: string }).message ?? '') : ''
  return {
    name: 'APIError',
    data: { message, isRetryable: true, statusCode: error.status },
  }
}

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
    error: message.error ? toMessageError(message.error) : undefined,
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

/**
 * 把 v2 的结构化错误转成可读文案。
 *
 * v2 的 `SessionStructuredError = { type, message, status?, response? }` 是**对象**，
 * 而 UI 侧（工具状态、流式事件）都要字符串。之前有两处各自写成
 * `typeof x === 'string' ? x : JSON.stringify(x)`——类型上永远不是字符串，
 * 于是界面显示一坨原始 JSON。统一走这里。
 */
export function structuredErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const { message, type } = error as { message?: unknown; type?: unknown }
    if (typeof message === 'string' && message) return message
    if (typeof type === 'string' && type) return type
  }
  return ''
}

/** 把 v2 工具产出的 content 数组拼成文本（UI 的 ToolState.output） */
export function toolContentToText(content: readonly ToolContent[] | undefined): string {
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
    case 'error': {
      // v2 的 state.error 是结构化对象，UI 要的是可读字符串（见 structuredErrorMessage）
      const readable = structuredErrorMessage(state.error) || 'Tool failed'

      return {
        status: 'error',
        input: (state.input ?? {}) as Record<string, unknown>,
        error: readable,
        metadata: (state.metadata ?? {}) as Record<string, unknown>,
      }
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
export function contentToParts(content: AssistantContent[], sessionID: string, messageID: string): Part[] {
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

  // v2 把用户输入的正文放在 message.text 上，而 UI 的 UserMessageInfo **没有**
  // text 字段——渲染层（UserMessageView）与 extractUserText 都只从
  // `parts` 里取 `type === 'text' && !synthetic` 的 part 来拼正文。
  // 因此这里必须把 text 投影成 text part；漏掉的话重新加载后
  // **用户自己的消息会一条不剩地变成空白气泡**。
  //
  // part id 用 `${messageID}:text`，与发送时本地乐观消息
  //（useChatSession.buildLocalQueuedMessage）保持同一套 id，
  // 这样服务端回显替换本地消息时不会换 key 导致重挂载。
  const text = typeof message.text === 'string' ? message.text : ''
  if (text) {
    parts.push({
      id: `${messageID}:text`,
      sessionID,
      messageID,
      type: 'text',
      text,
      synthetic: false,
    } as Part)
  }

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

    // v2 把「重试」放在助手消息的 retry 字段上（{ attempt, at, error }），
    // 而 UI 有专门的 RetryPartView。不投影的话那条渲染分支永远不会命中，
    // 用户看不到重试提示与原因。
    if (message.retry) {
      const retry = message.retry
      parts = [
        ...parts,
        {
          id: `${message.id}:retry:${retry.attempt}`,
          sessionID,
          messageID: message.id,
          type: 'retry',
          attempt: retry.attempt,
          error: toRetryError(retry.error),
          time: { created: retry.at },
        },
      ]
    }
  } else if (message.type === 'compaction') {
    // v2 把「压缩」从 v1 的 part 提升为**独立消息类型**。
    // UI 的上下文估算（sessionStatsCompute）靠「压缩之后重新计」来决定是
    // 用服务端 tokens 还是本地估算，因此这里必须投影出一个 compaction part，
    // 否则压缩后的用量会一直按压缩前累计。
    parts = [
      {
        id: `${message.id}:compaction:0`,
        sessionID,
        messageID: message.id,
        type: 'compaction',
        auto: message.reason === 'auto',
      },
    ]
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
