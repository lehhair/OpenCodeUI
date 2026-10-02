// ============================================
// Types - 统一类型导出
// ============================================
//
// 推荐使用方式:
// - API 类型: import type { Session, SessionMessage } from '@/types/api'
// - UI 类型: import type { Attachment } from '@/types'
//
// 说明：v1 时代这里还导出一套自造的 `{ info, parts }` 视图模型与它的守卫
//（`isUserMessage` / `hasVisibleContent` / `getMessageText`）。v2 的消息自带
// content，UI 直接消费原生 `SessionMessage`，那套模型已整体删除；
// 原生等价的辅助函数在 `@/types/api/message`（contentEntries / resolveContent /
// isUserMessage / userMessageText / hasVisibleText …）。
// ============================================

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
// 类型别名
// ============================================

export type { SessionMessage as ApiMessage } from './api'
export type { Session as ApiSession } from './api'
