/**
 * 消息时间线的高度估算与会话测量缓存。
 *
 * 从 ChatArea 里拆出来：这部分是纯数据计算，应该能单独测试，
 * 而不是埋在一个一千多行、同时管虚拟化/滚动/命令式接口的组件里。
 */
import type { VirtualItem } from '@tanstack/react-virtual'
import {
  isAssistantMessage,
  isUserMessage,
  userMessageText,
  type SessionMessageInfo,
} from '../../types/api/message'
import type { ProcessTimelineItem } from './chatPageModel'

export const ROW_ESTIMATE = 60
/** 过程壳 header 行高（Working / Worked 一行） */
export const PROCESS_SHELL_HEADER = 36
const SESSION_CACHE_LIMIT = 16
/** 每个会话最多保留这么多条真实高度：长会话只缓存靠底部的一段 */
const SESSION_MEASUREMENT_LIMIT = 3000

/** 文本高度粗估：大致每行 56 字符，行高 24；上限避免单条异常长消息把估算拉爆 */
export function estimateTextHeight(text: string): number {
  if (!text) return 0
  return Math.min(2000, 24 + Math.ceil(text.length / 56) * 24)
}

const messageHeightCache = new WeakMap<SessionMessageInfo, number>()

/**
 * 单条消息的初始高度估算。
 *
 * 只在消息还没被真实测量过时使用；历史消息的 reasoning 默认折叠，
 * 按 header 高度算，不能按全文长度算（否则初始位置会被大幅高估）。
 */
export function estimateMessageHeight(message: SessionMessageInfo): number {
  const cached = messageHeightCache.get(message)
  if (cached != null) return cached

  let height: number
  if (isAssistantMessage(message)) {
    height = 64
    for (const content of message.content) {
      if (content.type === 'reasoning') height += 44
      else if (content.type === 'text') height += estimateTextHeight(content.text)
      else if (content.type === 'tool') height += 64
    }
    height = Math.min(2400, height)
  } else if (isUserMessage(message)) {
    // 用户消息默认折叠到 8 行预览
    height = 80 + Math.min(8, Math.ceil(userMessageText(message).length / 48)) * 24
  } else {
    height = ROW_ESTIMATE
  }

  messageHeightCache.set(message, height)
  return height
}

const timelineItemHeightCache = new WeakMap<ProcessTimelineItem, number>()

export function estimateTimelineItemSize(item: ProcessTimelineItem | undefined): number {
  if (!item) return ROW_ESTIMATE
  const cached = timelineItemHeightCache.get(item)
  if (cached != null) return cached

  let size: number
  if (item.kind === 'message') {
    size = estimateMessageHeight(item.message)
  } else if (item.isActive) {
    // 进行中默认展开：header + 壳内消息
    const body = item.children.reduce((total, child) => total + estimateMessageHeight(child.message), 0)
    size = PROCESS_SHELL_HEADER + Math.max(body, ROW_ESTIMATE)
  } else {
    // 结束后默认折叠：只估 header + 壳外 final
    size = PROCESS_SHELL_HEADER + (item.finalMessage ? estimateMessageHeight(item.finalMessage) : 0)
  }

  timelineItemHeightCache.set(item, size)
  return size
}

export function sessionCacheKey(sessionId: string, processCollapseEnabled: boolean): string {
  return `${sessionId}:${processCollapseEnabled ? 'process' : 'flat'}`
}

const sessionCache = new Map<string, VirtualItem[]>()

export function readSessionMeasurements(key: string): VirtualItem[] | undefined {
  const measurements = sessionCache.get(key)
  if (!measurements) return undefined
  // 读命中刷新 LRU 顺序
  sessionCache.delete(key)
  sessionCache.set(key, measurements)
  return measurements
}

export function writeSessionMeasurements(key: string, snapshot: VirtualItem[]): void {
  const measurements =
    snapshot.length > SESSION_MEASUREMENT_LIMIT ? snapshot.slice(-SESSION_MEASUREMENT_LIMIT) : snapshot
  sessionCache.delete(key)
  sessionCache.set(key, measurements)
  while (sessionCache.size > SESSION_CACHE_LIMIT) {
    const oldest = sessionCache.keys().next().value
    if (oldest === undefined) break
    sessionCache.delete(oldest)
  }
}

/**
 * 把缓存的 key→size 重新映射到当前 timeline。
 *
 * 旧快照里的绝对 start/end 在消息追加/删除后不可信，只有 key→size 还有效。
 */
export function restoreMeasurements(
  measurements: VirtualItem[] | undefined,
  timeline: ProcessTimelineItem[],
): VirtualItem[] | undefined {
  if (!measurements?.length || timeline.length === 0) return undefined
  const sizeByKey = new Map(measurements.map(item => [item.key, item.size]))
  const restored: VirtualItem[] = []
  let start = 0
  for (let index = 0; index < timeline.length; index += 1) {
    const item = timeline[index]
    const size = sizeByKey.get(item.key)
    if (size == null) continue
    restored.push({ index, key: item.key, size, start, end: start + size, lane: 0 })
    start += size
  }
  return restored.length > 0 ? restored : undefined
}

export function buildCachedSizeMap(measurements: VirtualItem[] | undefined): Map<string, number> | null {
  if (!measurements?.length) return null
  return new Map(measurements.map(item => [String(item.key), item.size]))
}

/** 已知 key 用真实高度，新消息用估算值累加 */
export function estimateTimelineTotalHeight(
  timeline: ProcessTimelineItem[],
  sizeByKey: Map<string, number> | null,
): number {
  let total = 0
  for (const item of timeline) {
    total += sizeByKey?.get(item.key) ?? estimateTimelineItemSize(item)
  }
  return total
}

/** 仅测试/会话清理用 */
export function clearTimelineSessionCache(): void {
  sessionCache.clear()
}
