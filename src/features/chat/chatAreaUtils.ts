import { isAssistantMessage, isUserMessage } from '../../types/api/message'
import type { ProcessTimelineItem } from './chatPageModel'

/** 回合边界 / 用户消息：上下各 12px */
const ROW_Y_TURN = 'py-3'
/** 连续助手流：上下各 4px，相邻两行合计 8px（对齐消息内 stack gap） */
const ROW_Y_ASSISTANT_STACK = 'py-1'
const ROW_Y_ASSISTANT_AFTER_USER = 'pt-3 pb-1'
const ROW_Y_ASSISTANT_BEFORE_USER = 'pt-1 pb-3'

function isAssistantMessageItem(item: ProcessTimelineItem | undefined): boolean {
  return item?.kind === 'message' && isAssistantMessage(item.message)
}

/**
 * 用户和过程壳保留回合边界；连续助手按消息内 stack 节奏收紧。
 * 连续助手 py-1+py-1=8px，与 MSG_SPACING.stack / processBody 的 gap-2 同距。
 */
export function getTimelineRowYClass(
  item: ProcessTimelineItem,
  prev?: ProcessTimelineItem,
  next?: ProcessTimelineItem,
): string {
  if (item.kind === 'process-shell' || isUserMessage(item.message)) return ROW_Y_TURN

  const prevAssistant = isAssistantMessageItem(prev)
  const nextAssistant = isAssistantMessageItem(next)
  if (prevAssistant && nextAssistant) return ROW_Y_ASSISTANT_STACK
  if (prevAssistant) return ROW_Y_ASSISTANT_BEFORE_USER
  if (nextAssistant) return ROW_Y_ASSISTANT_AFTER_USER
  return ROW_Y_TURN
}

/** 流式热行 index：末 1～2 行，避免 virtual range 边界卸载正在生成的行 */
export function getStreamingHotIndexes(count: number, isStreaming: boolean): number[] {
  if (!isStreaming || count <= 0) return []
  if (count === 1) return [0]
  return [count - 2, count - 1]
}

/** 合并 range 与 pin index（resize pin + 流式热行） */
export function mergeVirtualRangeIndexes(base: number[], ...pinnedGroups: number[][]): number[] {
  const pinned = pinnedGroups.flat()
  if (pinned.length === 0) return base
  return [...new Set([...pinned, ...base])].sort((a, b) => a - b)
}
