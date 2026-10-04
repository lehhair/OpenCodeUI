import type { AssistantMessage, AssistantContent, SessionMessageInfo, UserMessage } from '../../types/api/message'
import {
  contentEntries,
  hasVisibleText,
  isAssistantMessage,
  isUserMessage,
  userMessageText,
} from '../../types/api/message'
import { isInterruptedError } from '../../utils/errorMessage'

function isVisibleThinking(content: AssistantContent): boolean {
  return content.type === 'reasoning' && hasVisibleText(content)
}

function isVisibleText(content: AssistantContent): boolean {
  return content.type === 'text' && hasVisibleText(content)
}

/** 用户消息在 v2 里自带正文与附件 */
function userMessageHasAnyContent(message: UserMessage): boolean {
  return userMessageText(message).length > 0 || (message.files?.length ?? 0) > 0 || (message.agents?.length ?? 0) > 0
}

function userMessageHasRenderableContent(message: UserMessage): boolean {
  return (
    userMessageText(message).trim().length > 0 || (message.files?.length ?? 0) > 0 || (message.agents?.length ?? 0) > 0
  )
}

/** 对应旧视图模型的 `message.parts.length !== 0`（原始存在性，不做 trim） */
function hasAnyContent(message: SessionMessageInfo): boolean {
  if (isUserMessage(message)) return userMessageHasAnyContent(message)
  if (isAssistantMessage(message)) return message.content.length > 0 || message.retry != null
  if (message.type === 'compaction') return true
  // `!` shell 命令消息：command + 状态即内容（官方 timeline 里独立成行）
  if (message.type === 'shell') return true
  return false
}

/** 对应旧视图模型的 `hasRenderableParts(message)` */
function hasRenderableContent(message: SessionMessageInfo): boolean {
  if (isUserMessage(message)) return userMessageHasRenderableContent(message)
  if (isAssistantMessage(message)) {
    if (message.retry) return true
    return contentEntries(message).some(({ content }) => {
      if (content.type === 'tool') return true
      return hasVisibleText(content)
    })
  }
  if (message.type === 'compaction') return true
  if (message.type === 'shell') return true
  return false
}

function messageHasContent(message: SessionMessageInfo): boolean {
  const hasRenderable = hasRenderableContent(message)
  // 有非 abort 错误的助手消息始终可见（展示错误信息）。
  // abort 只有在已经产生可见内容时才显示；空 abort 不占信息流位置。
  if (isAssistantMessage(message) && message.error) {
    return isInterruptedError(message.error) ? hasRenderable : true
  }
  if (!hasAnyContent(message)) {
    // 任何角色的空消息都不可见：没有内容可展示
    // 内容到达后自动进入可见列表；abort 后永远不会有内容 → 永远不可见
    return false
  }
  return hasRenderable
}

function endsWithTool(msg: SessionMessageInfo): msg is AssistantMessage {
  if (!isAssistantMessage(msg) || msg.content.length === 0) return false
  const entries = contentEntries(msg)
  for (let i = entries.length - 1; i >= 0; i--) {
    const { content } = entries[i]
    // skip empty reasoning / empty text — they carry no visible content
    // （只有「空的 text/reasoning」才跳过；工具的 hasVisibleText 恒为 false，不能当空内容）
    if ((content.type === 'text' || content.type === 'reasoning') && !hasVisibleText(content)) continue
    return content.type === 'tool'
  }
  return false
}

function isToolOnlyFollowUp(msg: SessionMessageInfo): boolean {
  if (!isAssistantMessage(msg)) return false
  // 旧视图模型把 retry 投影成一个 part，见到就判定为不可合并
  if (msg.retry) return false

  let sawTool = false
  for (const { content } of contentEntries(msg)) {
    if (isVisibleThinking(content) || isVisibleText(content)) return false
    if (content.type === 'tool') sawTool = true
  }
  return sawTool
}

function isMergeableTrailing(msg: SessionMessageInfo): boolean {
  if (!isAssistantMessage(msg)) return false
  if (msg.retry) return false

  let sawTool = false
  let sawVisibleText = false
  for (const { content } of contentEntries(msg)) {
    if (isVisibleThinking(content)) return false
    if (content.type === 'tool') {
      sawTool = true
      continue
    }
    if (isVisibleText(content)) {
      sawVisibleText = true
      continue
    }
  }
  return sawTool && sawVisibleText
}

function isStreamingMessage(message: SessionMessageInfo): boolean {
  return isAssistantMessage(message) && message.time.completed == null
}

/** 合并多段助手消息的内容（旧视图模型合并的是 parts + isStreaming） */
function mergeAssistantMessages(
  base: AssistantMessage,
  rest: SessionMessageInfo[],
  anyStreaming: boolean,
): AssistantMessage {
  const content = [...base.content]
  for (const message of rest) {
    if (isAssistantMessage(message)) content.push(...message.content)
  }
  return {
    ...base,
    content,
    time: anyStreaming ? { ...base.time, completed: undefined } : base.time,
  }
}

export interface VisibleMessageEntry {
  message: SessionMessageInfo
  sourceIds: string[]
}

export function getVisibleMessageForkTargetId(entry: VisibleMessageEntry): string {
  return entry.sourceIds[entry.sourceIds.length - 1] || entry.message.id
}

export function buildVisibleMessageEntries(messages: SessionMessageInfo[]): VisibleMessageEntry[] {
  // 防御性去重：保证输入无重复 ID
  const seenIds = new Set<string>()
  const unique: SessionMessageInfo[] = []
  for (const m of messages) {
    if (!seenIds.has(m.id)) {
      seenIds.add(m.id)
      unique.push(m)
    }
  }
  const filteredMessages = unique.filter(messageHasContent)
  const result: VisibleMessageEntry[] = []

  for (let i = 0; i < filteredMessages.length; i++) {
    const msg = filteredMessages[i]
    if (!endsWithTool(msg)) {
      result.push({ message: msg, sourceIds: [msg.id] })
      continue
    }

    const sourceIds = [msg.id]
    let j = i + 1

    while (j < filteredMessages.length) {
      if (isToolOnlyFollowUp(filteredMessages[j])) {
        sourceIds.push(filteredMessages[j].id)
        j++
      } else if (isMergeableTrailing(filteredMessages[j])) {
        sourceIds.push(filteredMessages[j].id)
        j++
        // 如果该消息也以 tool 结尾（text 在 tool 前面，是中间说明不是结论），
        // 继续合并链；只有 text 在 tool 后面（真正收尾）才终止
        if (!endsWithTool(filteredMessages[j - 1])) break
      } else {
        break
      }
    }

    if (j === i + 1) {
      result.push({ message: msg, sourceIds })
    } else {
      const mergedMessages = filteredMessages.slice(i + 1, j)
      // 合并后如果任何源消息在 streaming，合并结果也应该是 streaming
      const anyStreaming = isStreamingMessage(msg) || mergedMessages.some(isStreamingMessage)
      result.push({
        message: mergeAssistantMessages(msg, mergedMessages, anyStreaming),
        sourceIds,
      })
      i = j - 1
    }
  }

  return result
}
