import { isAssistantMessage, isUserMessage } from '../../types/api/message'
import type { ProcessTimelineItem } from './chatPageModel'
import { isNoticeMessage } from './chatAreaVisibility'

/** 回合边界 / 用户消息：上下各 12px */
const ROW_Y_TURN = 'py-3'
/** 连续助手流：上下各 4px，相邻两行合计 8px（对齐消息内 stack gap） */
const ROW_Y_ASSISTANT_STACK = 'py-1'
const ROW_Y_ASSISTANT_AFTER_USER = 'pt-3 pb-1'
const ROW_Y_ASSISTANT_BEFORE_USER = 'pt-1 pb-3'

function isAssistantMessageItem(item: ProcessTimelineItem | undefined): boolean {
  return item?.kind === 'message' && isAssistantMessage(item.message)
}

/** 提示行自带上下留白，行容器不再加 py */
function isNoticeItem(item: ProcessTimelineItem | undefined): boolean {
  return item?.kind === 'message' && isNoticeMessage(item.message)
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
  if (item.kind === 'process-shell') return ROW_Y_TURN
  if (isNoticeItem(item)) return ''
  if (isUserMessage(item.message)) return ROW_Y_TURN

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

export type PrependAnchor = { key: string; offset: number }

export type PrependRowRect = {
  key?: string
  top: number
  bottom: number
}

/**
 * 选历史前插的锚点：视口内最靠上的那一行。
 *
 * 行 key 必须跨插入保持稳定（这里用 message.id）。锚点只记 key 和它相对视口顶的
 * 偏移，插入完成后按实测位移补偿 scrollTop——不依赖上方占位高度是多少。
 */
export function pickPrependAnchor(
  rows: readonly PrependRowRect[],
  viewTop: number,
  viewBottom: number,
): PrependAnchor | undefined {
  let best: PrependRowRect | undefined
  for (const row of rows) {
    if (!row.key) continue
    if (row.bottom <= viewTop || row.top >= viewBottom) continue
    if (!best || row.top < best.top) best = row
  }
  return best?.key ? { key: best.key, offset: best.top - viewTop } : undefined
}

export type PrependAdjustState = {
  frames: number
  stable: number
  /** 上一帧写入后读回的 scrollTop；第一帧没有 */
  expectedScrollTop?: number
}

export type PrependAdjustDecision = {
  /** 放弃锚点：视口被用户/其它补偿接管，或者已经稳定 */
  stop: boolean
  /** 本帧要写进 scrollTop 的增量 */
  delta: number
  frames: number
  stable: number
}

/**
 * prepend 锚点校正的每帧决策。
 *
 * 两条规则：
 * - 视口位置不是我们上一帧写下的那个（用户滚动、virtualizer 自己补偿过）→ 立即让位，
 *   绝不把人拽回旧位置；
 * - 位移连续稳定若干帧或跑满上限 → 结束（图片/字体/异步 markdown 会让高度继续变）。
 *
 * 位移本身是实测值，重复应用是幂等的，所以第一帧不判断漂移。
 */
export function nextPrependAdjustment(
  state: PrependAdjustState,
  sample: { scrollTop: number; delta: number | undefined },
  limits: { maxFrames?: number; stableFrames?: number; driftTolerance?: number } = {},
): PrependAdjustDecision {
  const maxFrames = limits.maxFrames ?? 180
  const stableFrames = limits.stableFrames ?? 30
  const driftTolerance = limits.driftTolerance ?? 1
  const frames = state.frames + 1

  if (
    state.expectedScrollTop !== undefined &&
    Math.abs(sample.scrollTop - state.expectedScrollTop) > driftTolerance
  ) {
    return { stop: true, delta: 0, frames, stable: state.stable }
  }

  const moving = sample.delta !== undefined && Math.abs(sample.delta) > 0.5
  const stable = moving ? 0 : state.stable + 1
  return {
    stop: frames >= maxFrames || stable >= stableFrames,
    delta: moving ? (sample.delta as number) : 0,
    frames,
    stable,
  }
}
