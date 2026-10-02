import type { AssistantContent, AssistantMessage, SessionMessageInfo, ToolState } from '../types/api/message'
import { contentEntries, isAssistantMessage, isUserMessage, userMessageText } from '../types/api/message'
import { currentToolError, currentToolOutput } from '../types/api/toolState'
import type { SessionStats } from './sessionStatsTypes'

function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4)
}

/**
 * 用户消息在上下文里占的字符数。
 *
 * v2 的用户消息正文就是 `message.text`；`files` / `agents` / `skills` 是附件，
 * 旧视图模型里它们的 `source` 一律为空（`charsFromUserPart` 恒返回 0），
 * 这里保持同样的口径：只数正文。
 */
function charsFromUserMessage(message: Extract<SessionMessageInfo, { type: 'user' }>): number {
  return userMessageText(message).length
}

/** 工具 input 的体积估算：旧视图模型用「键数 × 16」 */
function toolInputSize(state: ToolState): number {
  if (state.status === 'streaming') {
    // 旧视图模型里 pending 的 input 是空对象、原始 JSON 放在 raw 里
    return 0
  }
  return Object.keys(state.input ?? {}).length * 16
}

function charsFromAssistantContent(content: AssistantContent): {
  assistant: number
  tool: number
} {
  if (content.type === 'text') return { assistant: content.text.length, tool: 0 }
  if (content.type === 'reasoning') return { assistant: content.text.length, tool: 0 }

  const state = content.state
  const inputSize = toolInputSize(state)
  // streaming 时 input 还是半截 JSON 字符串，按原始长度计
  if (state.status === 'streaming') {
    return { assistant: 0, tool: (typeof state.input === 'string' ? state.input.length : 0) + inputSize }
  }
  if (state.status === 'completed') {
    return { assistant: 0, tool: inputSize + (currentToolOutput(content)?.length ?? 0) }
  }
  if (state.status === 'error') {
    return { assistant: 0, tool: inputSize + (currentToolError(content)?.length ?? 0) }
  }
  return { assistant: 0, tool: inputSize }
}

/**
 * 本地估算当前上下文占用。
 *
 * v2 里「系统上下文」不再挂在用户消息的 `system` 字段上，而是独立的
 * `type: 'system'` 消息；这里取最后一条系统消息的正文作为系统开销。
 */
function estimateCurrentContext(messages: SessionMessageInfo[]): number {
  const system = [...messages].reverse().find(message => message.type === 'system')
  const systemChars = system ? system.text.trim().length || 0 : 0

  let userChars = 0
  let assistantChars = 0
  let toolChars = 0

  for (const message of messages) {
    if (isUserMessage(message)) {
      userChars += charsFromUserMessage(message)
      continue
    }

    if (!isAssistantMessage(message)) continue
    for (const { content } of contentEntries(message)) {
      const next = charsFromAssistantContent(content)
      assistantChars += next.assistant
      toolChars += next.tool
    }
  }

  return (
    estimateTokens(systemChars) + estimateTokens(userChars) + estimateTokens(assistantChars) + estimateTokens(toolChars)
  )
}

function shouldUseEstimatedContext(
  messages: SessionMessageInfo[],
  lastAssistantWithTokensIndex: number,
  lastAssistantWithTokens: AssistantMessage | null,
) {
  if (messages.length === 0) return false
  // 一条带 tokens 的助手消息都没有 → 只能估
  if (!lastAssistantWithTokens) return true

  for (let i = Math.max(0, lastAssistantWithTokensIndex + 1); i < messages.length; i++) {
    // v2 把「压缩」从 v1 的 part 提升为独立消息（type === 'compaction'）；
    // 压缩之后服务端 tokens 不再代表当前上下文，必须回落到本地估算。
    if (messages[i].type === 'compaction') return true
  }

  return false
}

export function computeSessionStats(messages: SessionMessageInfo[], contextLimit: number = 200000): SessionStats {
  const tokenTotal = (tokens: AssistantMessage['tokens']): number => {
    if (!tokens) return 0
    return tokens.input + tokens.output + tokens.reasoning + (tokens.cache?.read || 0) + (tokens.cache?.write || 0)
  }

  let inputTokens = 0
  let outputTokens = 0
  let reasoningTokens = 0
  let cacheRead = 0
  let cacheWrite = 0
  let totalCost = 0
  let lastAssistantWithTokens: AssistantMessage | null = null
  let lastAssistantWithTokensIndex = -1

  for (const msg of messages) {
    if (!isAssistantMessage(msg)) continue
    const tokens = msg.tokens

    if (tokens && tokenTotal(tokens) > 0) {
      inputTokens += tokens.input
      outputTokens += tokens.output
      reasoningTokens += tokens.reasoning
      cacheRead += tokens.cache?.read || 0
      cacheWrite += tokens.cache?.write || 0
    }
    if (msg.cost) {
      totalCost += msg.cost
    }
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (!isAssistantMessage(msg)) continue
    if (tokenTotal(msg.tokens) <= 0) continue
    lastAssistantWithTokens = msg
    lastAssistantWithTokensIndex = i
    break
  }

  const totalTokens = inputTokens + outputTokens + reasoningTokens + cacheRead + cacheWrite
  const estimatedContextUsed = estimateCurrentContext(messages)
  const contextEstimated = shouldUseEstimatedContext(messages, lastAssistantWithTokensIndex, lastAssistantWithTokens)
  const contextUsed = contextEstimated
    ? estimatedContextUsed
    : lastAssistantWithTokens
      ? tokenTotal(lastAssistantWithTokens.tokens)
      : estimatedContextUsed
  const contextPercent = contextLimit > 0 ? Math.min(100, (contextUsed / contextLimit) * 100) : 0

  return {
    inputTokens,
    outputTokens,
    reasoningTokens,
    cacheRead,
    cacheWrite,
    totalTokens,
    totalCost,
    contextUsed,
    contextLimit,
    contextPercent,
    contextEstimated,
  }
}

export function isSameSessionStats(a: SessionStats, b: SessionStats): boolean {
  return (
    a.inputTokens === b.inputTokens &&
    a.outputTokens === b.outputTokens &&
    a.reasoningTokens === b.reasoningTokens &&
    a.cacheRead === b.cacheRead &&
    a.cacheWrite === b.cacheWrite &&
    a.totalTokens === b.totalTokens &&
    a.totalCost === b.totalCost &&
    a.contextUsed === b.contextUsed &&
    a.contextLimit === b.contextLimit &&
    a.contextPercent === b.contextPercent &&
    a.contextEstimated === b.contextEstimated
  )
}
