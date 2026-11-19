import type { AssistantContent, AssistantMessage, SessionMessageInfo } from '../../types/api/message'
import { contentEntries, hasVisibleText } from '../../types/api/message'
import type { ToolEntry } from './toolSummary'

export type ProcessSplit = {
  processItems: RenderItem[]
  finalItems: RenderItem[]
  hasProcess: boolean
  hasFinal: boolean
}

// ============================================
// 渲染条目
//
// v2 的助手内容只有 text / reasoning / tool 三类，且元素**没有 id**：
// 稳定 id 一律由 `contentEntries()` 按官方算法派生
// （text/reasoning 用 `${message.id}:${type}:${perKindOrdinal}`，tool 用 `content.id`）。
// ============================================

/** 派生 id + 原生内容 */
export type RenderItem =
  | { type: 'single'; id: string; content: Exclude<AssistantContent, { type: 'tool' }> }
  | { type: 'tool-group'; tools: ToolEntry[] }

/**
 * 把 render items 拆成「过程」和「最终回答」。
 * 最终回答 = 消息中最后一段连续 text。
 * reasoning / tool 永远进过程。
 */
export function splitProcessRenderItems(items: RenderItem[]): ProcessSplit {
  if (items.length === 0) {
    return { processItems: [], finalItems: [], hasProcess: false, hasFinal: false }
  }

  let lastTextIdx = -1
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    if (item.type === 'single' && item.content.type === 'text') {
      lastTextIdx = i
      break
    }
    break
  }

  if (lastTextIdx < 0) {
    return {
      processItems: items,
      finalItems: [],
      hasProcess: items.length > 0,
      hasFinal: false,
    }
  }

  let textRunStart = lastTextIdx
  while (textRunStart > 0) {
    const prev = items[textRunStart - 1]
    if (prev.type === 'single' && prev.content.type === 'text') {
      textRunStart -= 1
      continue
    }
    break
  }

  const finalItems = items.slice(textRunStart)
  const processItems = items.slice(0, textRunStart)

  return {
    processItems,
    finalItems,
    hasProcess: processItems.length > 0,
    hasFinal: finalItems.length > 0,
  }
}

/** v2 没有 isStreaming 标志：助手消息 time.completed 缺失即仍在流式 */
export function messageStillStreamingProcess(message: SessionMessageInfo): boolean {
  if (message.type !== 'assistant') return false
  return message.time.completed == null
}

/** 是否有可收进过程块的内容（tool / reasoning 等，不含尾部最终 text） */
export function messageHasProcessContent(message: SessionMessageInfo): boolean {
  if (message.type !== 'assistant') return false
  if (messageStillStreamingProcess(message)) return true
  return getProcessSplit(message).hasProcess
}

/** 是否有应留在折叠块外的最终 text（仅消息已结束后才拆） */
export function messageHasFinalContent(message: SessionMessageInfo): boolean {
  if (message.type !== 'assistant') return false
  if (messageStillStreamingProcess(message)) return false
  return getProcessSplit(message).hasFinal
}

/**
 * 内容是否会被渲染。
 *
 * 规则取自官方 `renderable()`（packages/session-ui/src/timeline/projection.ts）：
 *   - text / reasoning：正文非空白才渲染
 *   - tool：始终渲染（解析中的 streaming 工具也要让用户看到正在做什么）
 */
function isRenderableContent(content: AssistantContent, isStreaming: boolean): boolean {
  if (content.type === 'tool') return true
  if (hasVisibleText(content)) return true
  // 流式中的空片段保留，避免文字刚到时闪一下
  return isStreaming
}

/**
 * 把原生 content 数组整成渲染条目。
 *
 * 与官方 `groupContent()` 的对应关系：官方会把相邻的 tool 合成一个
 * group（`toolGroupType`），这里沿用本仓库既有的「连续 tool 合并成一组」
 * 规则，视觉与交互保持不变。
 */
/** 按消息快照缓存内容分组：长会话里每个 assistant 每帧重算一遍分组纯属浪费 */
const renderGroupCache = new WeakMap<
  AssistantMessage,
  { source: AssistantContent[]; length: number; completed: number | undefined; items: RenderItem[] }
>()

export function groupContentForRender(message: AssistantMessage): RenderItem[] {
  const cached = renderGroupCache.get(message)
  if (
    cached &&
    cached.source === message.content &&
    cached.length === message.content.length &&
    cached.completed === message.time.completed
  ) {
    return cached.items
  }
  const isStreaming = message.time.completed == null
  const result: RenderItem[] = []
  let toolGroup: ToolEntry[] = []

  const flushToolGroup = () => {
    if (toolGroup.length === 0) return
    result.push({ type: 'tool-group', tools: toolGroup })
    toolGroup = []
  }

  for (const entry of contentEntries(message)) {
    if (!isRenderableContent(entry.content, isStreaming)) continue

    if (entry.content.type === 'tool') {
      // todowrite：官方整卡不渲染（session-ui/tool-renderer.tsx:1197）
      if (entry.content.name.toLowerCase() === 'todowrite') continue
      toolGroup.push(entry as ToolEntry)
      continue
    }

    flushToolGroup()
    result.push({ type: 'single', id: entry.id, content: entry.content })
  }

  flushToolGroup()
  renderGroupCache.set(message, {
    source: message.content,
    length: message.content.length,
    completed: message.time.completed,
    items: result,
  })
  return result
}

const processSplitCache = new WeakMap<RenderItem[], ProcessSplit>()

export function getProcessSplit(message: AssistantMessage): ProcessSplit {
  const items = groupContentForRender(message)
  const cached = processSplitCache.get(items)
  if (cached) return cached
  const split = splitProcessRenderItems(items)
  processSplitCache.set(items, split)
  return split
}
