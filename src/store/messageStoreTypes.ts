// ============================================
// MessageStore Types
// ============================================

import type { Message, MessageError, Part } from '../types/message'

export interface RevertState {
  /** 撤销点的消息 ID */
  messageId: string
  /** 撤销历史栈 - 用于多步 redo */
  history: RevertHistoryItem[]
}

export interface RevertHistoryItem {
  messageId: string
  text: string
  attachments: unknown[]
  model?: { providerID: string; modelID: string; variant?: string }
  variant?: string
  agent?: string
}

export interface SessionState {
  /** 所有消息（包括被撤销的） */
  messages: Message[]
  /** 撤销状态 */
  revertState: RevertState | null
  /** 是否正在 streaming */
  isStreaming: boolean
  /** 加载状态 */
  loadState: 'idle' | 'loading' | 'loaded' | 'error'
  /** 空会话加载失败时展示在消息流里的错误 */
  loadError?: MessageError
  /** 是否还有更多历史消息 */
  hasMoreHistory: boolean
  /**
   * 向前（更旧）翻页的游标 —— V2 游标分页（阶段 2a 新增）
   *
   * 语义：`GET /api/session/{id}/message` 返回的 `cursor.next`。
   * ⚠️ 服务端默认 `order=desc`（新→旧），此游标指向**更旧**的一页
   *    （方向推导见 src/api/message.ts 文件头注释）。
   * `null` = 还没有游标（未加载过，或已确认没有更早的历史）。
   */
  historyCursor: string | null
  /** session 目录 */
  directory: string
  /** session 标题 */
  title?: string
  /** 断线重连后是否需要重新全量拉取 */
  isStale: boolean
}

export interface SendRollbackSnapshot {
  messages: Message[]
  revertState: RevertState | null
}

export interface MessageStoreSnapshot {
  sessionId: string | null
  messages: Message[]
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
  loadError?: MessageError
}

export interface SessionStateSnapshot {
  messages: Message[]
  isStreaming: boolean
  loadState: SessionState['loadState']
  loadError?: MessageError
  revertState: RevertState | null
  canUndo: boolean
  canRedo: boolean
  redoSteps: number
  revertedContent: RevertHistoryItem | null
  hasMoreHistory: boolean
  directory: string
  title: string | null
}

// Re-export Part for convenience
export type { Message, Part }
