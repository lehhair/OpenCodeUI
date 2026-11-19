import type { SessionMessageInfo } from '../types/api/message'
import { estimateMessagesChars } from './messageSize'

/** 一页历史大致允许持有的正文字符量 */
export const PAGE_CHAR_BUDGET = 256 * 1024
/** 单条消息就超过预算时，至少还按这个条数翻页，避免翻页细碎到不可用 */
export const MIN_PAGE_LIMIT = 4

/**
 * 按上一页的实际体积推导下一页的条数。
 *
 * 只按条数分页时，一页 50 条工具输出可能比一页 50 条闲聊大两个数量级；
 * 这里用正文量反推，让「肥页」自动变小。条数只会下调，不会超过调用方给的上限。
 */
export function derivePageLimit(messages: readonly SessionMessageInfo[], baseLimit: number): number {
  if (messages.length === 0 || baseLimit <= 0) return baseLimit
  const chars = estimateMessagesChars(messages)
  if (chars <= 0) return baseLimit
  const perMessage = chars / messages.length
  const fits = Math.floor(PAGE_CHAR_BUDGET / perMessage)
  return Math.max(MIN_PAGE_LIMIT, Math.min(baseLimit, fits))
}
