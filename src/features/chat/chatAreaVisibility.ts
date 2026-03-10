import type { Message, Part, TextPart, ReasoningPart } from '../../types/message'

function messageHasContent(message: Message): boolean {
  if (message.parts.length === 0) {
    if (message.info.role === 'assistant' && 'error' in message.info && message.info.error) {
      return message.info.error.name !== 'MessageAbortedError'
    }
    return true
  }
  return message.parts.some(part => {
    switch (part.type) {
      case 'text':
        return !!(part as TextPart).text?.trim() && !(part as TextPart).synthetic
      case 'reasoning':
        return !!(part as ReasoningPart).text?.trim()
      case 'tool':
      case 'file':
      case 'agent':
      case 'step-finish':
      case 'subtask':
      case 'retry':
      case 'compaction':
        return true
      default:
        return false
    }
  })
}

function isVisibleThinking(part: Part): boolean {
  return part.type === 'reasoning' && !!(part as ReasoningPart).text?.trim()
}

function isVisibleText(part: Part): boolean {
  return part.type === 'text' && !!(part as TextPart).text?.trim() && !(part as TextPart).synthetic
}

function endsWithTool(msg: Message): boolean {
  if (msg.info.role !== 'assistant' || msg.parts.length === 0) return false
  for (let i = msg.parts.length - 1; i >= 0; i--) {
    const p = msg.parts[i]
    if (p.type === 'snapshot' || p.type === 'patch' || p.type === 'step-start' || p.type === 'step-finish') continue
    // skip empty reasoning / empty text — they carry no visible content
    if (p.type === 'reasoning' && !(p as ReasoningPart).text?.trim()) continue
    if (p.type === 'text' && (!(p as TextPart).text?.trim() || (p as TextPart).synthetic)) continue
    return p.type === 'tool'
  }
  return false
}

function isToolOnlyFollowUp(msg: Message): boolean {
  if (msg.info.role !== 'assistant') return false
  let sawTool = false
  for (const p of msg.parts) {
    if (p.type === 'snapshot' || p.type === 'patch' || p.type === 'step-start' || p.type === 'step-finish') continue
    if (isVisibleThinking(p) || isVisibleText(p)) return false
    if (p.type === 'tool') sawTool = true
    else if (p.type === 'subtask' || p.type === 'retry' || p.type === 'compaction') return false
  }
  return sawTool
}

function isMergeableTrailing(msg: Message): boolean {
  if (msg.info.role !== 'assistant') return false
  let sawTool = false
  let sawVisibleText = false
  for (const p of msg.parts) {
    if (p.type === 'snapshot' || p.type === 'patch' || p.type === 'step-start' || p.type === 'step-finish') continue
    if (isVisibleThinking(p)) return false
    if (p.type === 'tool') {
      sawTool = true
      continue
    }
    if (isVisibleText(p)) {
      sawVisibleText = true
      continue
    }
    if (p.type === 'subtask' || p.type === 'retry' || p.type === 'compaction') return false
  }
  return sawTool && sawVisibleText
}

export interface VisibleMessageEntry {
  message: Message
  sourceIds: string[]
}

export function buildVisibleMessageEntries(messages: Message[]): VisibleMessageEntry[] {
  const filteredMessages = messages.filter(messageHasContent)
  const result: VisibleMessageEntry[] = []

  for (let i = 0; i < filteredMessages.length; i++) {
    const msg = filteredMessages[i]
    if (!endsWithTool(msg)) {
      result.push({ message: msg, sourceIds: [msg.info.id] })
      continue
    }

    const sourceIds = [msg.info.id]
    let j = i + 1

    while (j < filteredMessages.length) {
      if (isToolOnlyFollowUp(filteredMessages[j])) {
        sourceIds.push(filteredMessages[j].info.id)
        j++
      } else if (isMergeableTrailing(filteredMessages[j])) {
        sourceIds.push(filteredMessages[j].info.id)
        j++
        break
      } else {
        break
      }
    }

    if (j === i + 1) {
      result.push({ message: msg, sourceIds })
    } else {
      const mergedMessages = filteredMessages.slice(i + 1, j)
      const tailParts = mergedMessages.flatMap(message => message.parts)
      result.push({
        message: { ...msg, parts: [...msg.parts, ...tailParts] },
        sourceIds,
      })
      i = j - 1
    }
  }

  return result
}
