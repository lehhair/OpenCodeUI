import type { SessionMessageInfo } from '../types/api/message'

/**
 * 估算一条消息占用的正文字符量。
 *
 * 只统计真正会被渲染/持有的文本：正文、推理、工具产出、shell 输出。
 * 不序列化工具入参（那是纯 CPU 开销，而且通常远小于产出），
 * 因此这是下界估算，但足够用来判断「这一页是不是特别肥」。
 */
export function estimateMessageChars(message: SessionMessageInfo): number {
  switch (message.type) {
    case 'user':
      return message.text?.length ?? 0
    case 'system':
    case 'synthetic':
      return message.text?.length ?? 0
    case 'skill':
      return message.text?.length ?? 0
    case 'shell':
      return (message.command?.length ?? 0) + (message.output?.output.length ?? 0)
    case 'assistant': {
      let total = 0
      for (const part of message.content) {
        if (part.type === 'text' || part.type === 'reasoning') {
          total += part.text.length
          continue
        }
        if (part.type !== 'tool') continue
        const state = part.state
        if (state.status === 'completed' || state.status === 'error') {
          const content = state.content
          if (content) {
            for (const item of content) {
              if (item.type === 'text') total += item.text.length
            }
          }
        } else if (state.status === 'running') {
          const output = state.metadata.output
          if (typeof output === 'string') total += output.length
        } else if (state.status === 'streaming') {
          total += state.input.length
        }
      }
      return total
    }
    default:
      return 0
  }
}

export function estimateMessagesChars(messages: readonly SessionMessageInfo[]): number {
  let total = 0
  for (const message of messages) total += estimateMessageChars(message)
  return total
}
