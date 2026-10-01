// ============================================
// Common API Types — OpenCode v2 原生
//
// v1 的 APIError / ProviderAuthError / MessageAbortedError 等错误联合
// 在 v2 被 `SessionStructuredError` 取代（挂在助手消息的 `error` 字段上）。
//
// 传输层错误是 `ClientError`（reason: Transport | UnexpectedStatus |
// UnsupportedContentType | MalformedResponse | SseEventTooLarge）。
// ============================================

import type { SessionStructuredError } from '@opencode/client/promise'

export type { ClientError, ClientErrorReason } from '@opencode/client/promise'

/**
 * 结构化错误（取代 v1 的 ApiError 联合）。
 *
 * v2 由会话/助手消息的 `error` 字段携带。
 */
export type APIError = SessionStructuredError

/** UI 侧的统一错误信息形状 */
export interface ErrorInfo {
  name: string
  data: unknown
}
