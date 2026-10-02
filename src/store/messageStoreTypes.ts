// ============================================
// MessageStore Types
// ============================================
//
// store 里存的是**原生** OpenCode v2 消息（`SessionMessageInfo`），
// 不再是自制的 `{ info: Message, parts: Part[] }` 视图模型。
// 因此这里不再有 `Part`，消息判别统一走 `message.type`。

import type { ModelRef, MoneyUSD, TokenUsageInfo } from '@opencode/client/promise'
import type { SessionMessageInfo } from '../types/api/event'
import type { Attachment } from '../types/ui'
import type { APIError } from '../types/api/common'

export interface RevertState {
  /** 撤销点的消息 ID */
  messageId: string
  /** 撤销历史栈 - 用于多步 redo */
  history: RevertHistoryItem[]
}

export interface RevertHistoryItem {
  messageId: string
  text: string
  attachments: Attachment[]
  /**
   * 恢复输入框时要带回的模型 / agent。
   *
   * v2 的用户消息本身**不带** model / agent（那是 v1 的形状），
   * 因此这里取会话级的 `SessionState.model` / `SessionState.agent`
   * （由 `session.agent.selected` / `session.model.selected` 维护）。
   */
  model?: { providerID: string; modelID: string; variant?: string }
  variant?: string
  agent?: string
}

export interface SessionState {
  /** 全部原生消息（含被撤销的），按创建时间有序 */
  messages: SessionMessageInfo[]
  /** 撤销状态 */
  revertState: RevertState | null
  /** 会话是否正在执行（官方 session.active 的本地投影） */
  isStreaming: boolean
  /** 加载状态 */
  loadState: 'idle' | 'loading' | 'loaded' | 'error'
  /** 空会话加载失败时展示在消息流里的错误 */
  loadError?: APIError
  /** 是否还有更多历史消息 */
  hasMoreHistory: boolean
  /** session 目录 */
  directory: string
  /** session 标题 */
  title?: string
  /** 当前 agent（`session.agent.selected` 维护） */
  agent?: string
  /** 当前模型（`session.model.selected` 维护） */
  model?: ModelRef
  /** 会话级成本 / token（`session.usage.updated` 维护） */
  cost?: MoneyUSD
  tokens?: TokenUsageInfo
  /**
   * 本地乐观插入、服务端消息列表尚未包含的消息 id。
   *
   * 官方在 outbox / pending 里维护同一语义：重新拉取消息列表时，
   * 这些消息不能被服务端快照冲掉（否则用户刚发出去的消息会闪一下消失）。
   */
  localMessageIds: Set<string>
  /** 断线重连后是否需要重新全量拉取 */
  isStale: boolean
}

export interface SendRollbackSnapshot {
  messages: SessionMessageInfo[]
  revertState: RevertState | null
}

export interface MessageStoreSnapshot {
  sessionId: string | null
  messages: SessionMessageInfo[]
  isStreaming: boolean
  revertState: RevertState | null
  hasMoreHistory: boolean
  sessionDirectory: string
  sessionTitle: string
  canUndo: boolean
  canRedo: boolean
  redoSteps: number
  revertedContent: RevertHistoryItem | null
  loadState: SessionState['loadState']
  loadError?: APIError
}

export interface SessionStateSnapshot {
  messages: SessionMessageInfo[]
  isStreaming: boolean
  loadState: SessionState['loadState']
  loadError?: APIError
  revertState: RevertState | null
  canUndo: boolean
  canRedo: boolean
  redoSteps: number
  revertedContent: RevertHistoryItem | null
  hasMoreHistory: boolean
  directory: string
  title: string | null
}

// Re-export for convenience
export type { SessionMessageInfo }
