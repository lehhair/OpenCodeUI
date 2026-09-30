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
// 类型守卫 —— 阶段 2b 已删除
// ============================================
//
// 这里原先有 4 个 V1 形状的守卫 / 辅助函数：
//   isUserMessage(msg: ApiMessage)        —— 读 V1 消息的 `msg.role`
//   isAssistantMessage(msg: ApiMessage)
//   hasVisibleContent(message: UIMessage) —— V1 的 {info, parts} 两层结构
//   getMessageText(message: UIMessage)
//
// 它们全部基于 V1 消息模型（`ApiMessage` = `UserMessage | AssistantMessage`，
// `UIMessage = {info, parts}`），而 V2 把消息模型换成了扁平联合 + 内嵌 content。
// **全仓库零引用**（阶段 2b 逐个 grep 核对）→ 随 A 桶一起删除。
//
// 同名的正确实现现在在 `src/types/message.ts`（UI 展示模型）：
//   `isUserMessage(info)` / `isAssistantMessage(info)` / `hasVisibleContent(msg)` / `getMessageText(msg)`
// 调用方请从 `@/types/message` 导入。

// ============================================
// 类型别名（向后兼容）
// ============================================

// 为了向后兼容，保留一些旧的类型别名
export type { Session as ApiSession } from './api'
