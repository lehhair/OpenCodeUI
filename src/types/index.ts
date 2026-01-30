// ============================================
// Types - 统一类型导出
// ============================================
//
// 推荐使用方式:
// - API 类型: import type { Session, Message } from '@/types/api'
// - UI 类型: import type { UIMessage, Attachment } from '@/types'
//

// Re-export all API types
export * from './api'

// Re-export UI types
export * from './ui'

// Re-export legacy chat types (for backward compatibility)
export type {
  ToolType,
  ToolStatus,
  ToolCall,
  AgentBlockType,
  ThinkingBlock,
  ToolCallsBlock,
  TextBlock,
  StepInfoBlock,
  SubtaskBlock,
  AgentBlock,
  PermissionDecision,
  PermissionMode,
  ChatSettings,
} from './chat'

// ============================================
// Type Guards
// ============================================

import type { Message, UserMessage, AssistantMessage, Part } from './api'
import type { UIMessage } from './ui'

/** 检查消息是否为用户消息 */
export function isUserMessage(msg: Message): msg is UserMessage {
  return msg.role === 'user'
}

/** 检查消息是否为助手消息 */
export function isAssistantMessage(msg: Message): msg is AssistantMessage {
  return msg.role === 'assistant'
}

/** 检查 UI 消息是否有可见内容 */
export function hasVisibleContent(message: UIMessage): boolean {
  return message.parts.some(part => {
    switch (part.type) {
      case 'text':
        return part.text.trim().length > 0
      case 'reasoning':
        return part.text.trim().length > 0
      case 'tool':
      case 'file':
      case 'agent':
      case 'step-finish':
      case 'subtask':
        return true
      default:
        return false
    }
  })
}

/** 获取消息的纯文本内容 */
export function getMessageText(message: UIMessage): string {
  return message.parts
    .filter((p): p is Part & { type: 'text' } => p.type === 'text' && !p.synthetic)
    .map(p => p.text)
    .join('')
}

// ============================================
// 类型别名（向后兼容）
// ============================================

// 为了向后兼容，保留一些旧的类型别名
export type { Message as ApiMessage } from './api'
export type { Part as ApiPart } from './api'
export type { Session as ApiSession } from './api'
