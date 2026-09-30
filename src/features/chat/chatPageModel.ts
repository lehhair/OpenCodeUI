import type { Message } from '../../types/message'

export const PAGE_MESSAGE_COUNT = 20
export const PAGE_EXTREME_RENDER_WEIGHT = 700
export const PAGE_OVERSCAN_VIEWPORTS = 2
export const PAGE_ADJACENT_OVERSCAN = 1

export interface MessageGroupRow {
  key: string
  messages: Message[]
  messageIds: string[]
  estimatedHeight: number
  renderWeight?: number
  continuesFromPrevious?: boolean
  continuesToNext?: boolean
}

export interface ChatPage {
  key: string
  rows: MessageGroupRow[]
  messageIds: string[]
  estimatedHeight: number
  renderWeight?: number
}

export interface StableChatPage extends ChatPage {
  key: string
}

export interface PageRange {
  startIndex: number
  endIndex: number
}

export type PageRenderSegment =
  | {
      kind: 'expanded'
      key: string
      page: StableChatPage
      measuredHeight: number
    }
  | {
      kind: 'collapsed'
      key: string
      height: number
    }

export type ExpandedPageSelection = Set<number>

const messageRenderWeightCache = new WeakMap<Message, number>()

export function computeAnchorRestoreScrollDelta(previousTopOffset: number, nextTopOffset: number): number {
  return nextTopOffset - previousTopOffset
}

const TEXT_RENDER_FEATURE_PATTERN = /\n|^[ \t]*```([^\r\n]*)|!\[[^\]]*\]\([^)]*\)/gm

function estimateTextRenderWeight(text: string): number {
  if (!text) return 0
  if (!text.trim()) return 0

  let lineCount = 1
  let fenceCount = 0
  let mermaidBlocks = 0
  let images = 0
  TEXT_RENDER_FEATURE_PATTERN.lastIndex = 0
  for (let match = TEXT_RENDER_FEATURE_PATTERN.exec(text); match; match = TEXT_RENDER_FEATURE_PATTERN.exec(text)) {
    if (match[0] === '\n') {
      lineCount += 1
    } else if (match[0].startsWith('!')) {
      images += 1
    } else {
      fenceCount += 1
      if (match[1]?.trim().toLowerCase() === 'mermaid') mermaidBlocks += 1
    }
  }
  const fencedBlocks = Math.ceil(fenceCount / 2)

  return Math.max(
    1,
    1 + Math.floor(text.length / 1400) + Math.floor(lineCount / 40) + fencedBlocks * 2 + mermaidBlocks * 4 + images * 2,
  )
}

export function estimateMessageRenderWeight(message: Message): number {
  const cached = messageRenderWeightCache.get(message)
  if (cached != null) return cached

  let weight = message.info.role === 'user' ? 1 : 2

  for (const part of message.parts) {
    switch (part.type) {
      case 'text':
        weight += part.synthetic ? 1 : estimateTextRenderWeight(part.text)
        break
      case 'reasoning':
        weight += 1 + estimateTextRenderWeight(part.text)
        break
      case 'tool': {
        const outputLength = part.state.output?.length ?? part.state.error?.length ?? 0
        weight += 4 + Math.min(8, Math.floor(outputLength / 4000))
        break
      }
      case 'file':
        weight += 2
        break
      case 'subtask':
        weight += 3
        break
      case 'step-finish':
      case 'retry':
        weight += 2
        break
      case 'agent':
      case 'compaction':
        weight += 1
        break
      default:
        break
    }
  }

  const result = Math.max(1, weight)
  messageRenderWeightCache.set(message, result)
  return result
}

function estimateMessageHeight(message: Message): number {
  if (message.info.role === 'user') {
    return Math.max(72, message.parts.length * 40)
  }
  return Math.max(160, message.parts.length * 80)
}

function estimateGroupHeight(messages: Message[]): number {
  let total = 24
  for (let index = 0; index < messages.length; index++) {
    if (index > 0) total += 8
    total += estimateMessageHeight(messages[index])
  }
  return total
}

function estimateRowHeight(
  messages: Message[],
  options?: { continuesFromPrevious?: boolean; continuesToNext?: boolean },
) {
  const paddingReduction = (options?.continuesFromPrevious ? 4 : 0) + (options?.continuesToNext ? 12 : 0)
  return estimateGroupHeight(messages) - paddingReduction
}

function estimateGroupRenderWeight(messages: Message[]): number {
  return messages.reduce((total, message) => total + estimateMessageRenderWeight(message), 0)
}

function buildMessageGroupRow(
  group: Message[],
  options?: { continuesFromPrevious?: boolean; continuesToNext?: boolean },
): MessageGroupRow {
  const firstId = group[0]?.info.id ?? 'empty'
  return {
    key: `row:${firstId}`,
    messages: group,
    messageIds: group.map(message => message.info.id),
    estimatedHeight: estimateRowHeight(group, options),
    renderWeight: estimateGroupRenderWeight(group),
    continuesFromPrevious: options?.continuesFromPrevious,
    continuesToNext: options?.continuesToNext,
  }
}

function buildMessageGroups(messages: Message[]): MessageGroupRow[] {
  const groups: Message[][] = []
  for (const message of messages) {
    const previous = groups[groups.length - 1]
    if (previous && message.info.role === 'assistant' && previous[0].info.role === 'assistant') {
      previous.push(message)
    } else {
      groups.push([message])
    }
  }

  return groups.map(group => buildMessageGroupRow(group))
}

function splitOversizedMessageGroups(
  rows: MessageGroupRow[],
  pageMessageCount: number,
  maxRenderWeight: number,
): MessageGroupRow[] {
  return rows.flatMap(row => {
    if (row.messages.length <= pageMessageCount && (row.renderWeight ?? 0) <= maxRenderWeight) return row

    const chunks: Message[][] = []
    let currentChunk: Message[] = []
    let currentWeight = 0
    for (const message of row.messages) {
      const messageWeight = estimateMessageRenderWeight(message)
      if (
        currentChunk.length > 0 &&
        (currentChunk.length >= pageMessageCount || currentWeight + messageWeight > maxRenderWeight)
      ) {
        chunks.push(currentChunk)
        currentChunk = []
        currentWeight = 0
      }
      currentChunk.push(message)
      currentWeight += messageWeight
    }
    if (currentChunk.length > 0) chunks.push(currentChunk)

    return chunks.map((chunk, index) =>
      buildMessageGroupRow(chunk, {
        continuesFromPrevious: index > 0,
        continuesToNext: index < chunks.length - 1,
      }),
    )
  })
}

export function buildChatPages(
  messages: Message[],
  pageMessageCount = PAGE_MESSAGE_COUNT,
  maxRenderWeight = PAGE_EXTREME_RENDER_WEIGHT,
): ChatPage[] {
  const rows = splitOversizedMessageGroups(buildMessageGroups(messages), pageMessageCount, maxRenderWeight)
  const renderPages: ChatPage[] = []

  let currentRows: MessageGroupRow[] = []
  let currentMessageCount = 0
  let currentRenderWeight = 0
  for (let rowIndex = rows.length - 1; rowIndex >= 0; rowIndex--) {
    const row = rows[rowIndex]
    const rowRenderWeight = row.renderWeight ?? estimateGroupRenderWeight(row.messages)
    if (
      currentRows.length > 0 &&
      (currentMessageCount + row.messages.length > pageMessageCount ||
        currentRenderWeight + rowRenderWeight > maxRenderWeight)
    ) {
      renderPages.push(buildChatPage(currentRows))
      currentRows = []
      currentMessageCount = 0
      currentRenderWeight = 0
    }
    currentRows.unshift(row)
    currentMessageCount += row.messages.length
    currentRenderWeight += rowRenderWeight
  }

  if (currentRows.length > 0) {
    renderPages.push(buildChatPage(currentRows))
  }

  return renderPages
}

function buildChatPage(rows: MessageGroupRow[]): ChatPage {
  const messageIds = rows.flatMap(row => row.messageIds)
  const newestId = messageIds[messageIds.length - 1] ?? 'empty'
  const oldestId = messageIds[0] ?? newestId
  return {
    key: `${newestId}:${oldestId}:${messageIds.length}`,
    rows,
    messageIds,
    estimatedHeight: rows.reduce((sum, row) => sum + row.estimatedHeight, 0),
    renderWeight: rows.reduce((sum, row) => sum + (row.renderWeight ?? estimateGroupRenderWeight(row.messages)), 0),
  }
}

function connectAssistantPageBoundary(
  olderPage: StableChatPage,
  newerPage: StableChatPage,
): { olderPage: StableChatPage; newerPage: StableChatPage } | null {
  const olderBoundaryRow = olderPage.rows.at(-1)
  const newerBoundaryRow = newerPage.rows[0]
  if (
    olderBoundaryRow?.messages[0]?.info.role !== 'assistant' ||
    newerBoundaryRow?.messages[0]?.info.role !== 'assistant'
  ) {
    return null
  }

  const olderRows = olderPage.rows.slice()
  olderRows[olderRows.length - 1] = buildMessageGroupRow(olderBoundaryRow.messages, {
    continuesFromPrevious: olderBoundaryRow.continuesFromPrevious,
    continuesToNext: true,
  })
  const newerRows = newerPage.rows.slice()
  newerRows[0] = buildMessageGroupRow(newerBoundaryRow.messages, {
    continuesFromPrevious: true,
    continuesToNext: newerBoundaryRow.continuesToNext,
  })

  return {
    olderPage: { ...buildChatPage(olderRows), key: olderPage.key },
    newerPage: { ...buildChatPage(newerRows), key: newerPage.key },
  }
}

export function buildStableChatPages(
  messages: Message[],
  allocateKey: (page: ChatPage) => string,
  pageMessageCount = PAGE_MESSAGE_COUNT,
  maxRenderWeight = PAGE_EXTREME_RENDER_WEIGHT,
): StableChatPage[] {
  return buildChatPages(messages, pageMessageCount, maxRenderWeight).map(page => ({ ...page, key: allocateKey(page) }))
}

export function buildContentKeyedChatPages(
  messages: Message[],
  pageMessageCount = PAGE_MESSAGE_COUNT,
  maxRenderWeight = PAGE_EXTREME_RENDER_WEIGHT,
): StableChatPage[] {
  return buildChatPages(messages, pageMessageCount, maxRenderWeight)
}

function flattenPageMessagesChronological(page: ChatPage): Message[] {
  return page.rows.flatMap(row => row.messages)
}

function flattenPagesMessageIdsChronological(pages: ChatPage[]): string[] {
  return pages
    .slice()
    .reverse()
    .flatMap(page => page.messageIds)
}

export function findMessageSequenceOffset(nextIds: string[], previousIds: string[]): number {
  if (previousIds.length === 0) return 0
  if (previousIds.length > nextIds.length) return -1

  const firstId = previousIds[0]
  for (let startIndex = 0; startIndex <= nextIds.length - previousIds.length; startIndex++) {
    if (nextIds[startIndex] !== firstId) continue

    let matches = true
    for (let index = 1; index < previousIds.length; index++) {
      if (nextIds[startIndex + index] !== previousIds[index]) {
        matches = false
        break
      }
    }
    if (matches) return startIndex
  }

  return -1
}

function rebuildPageWithFreshMessages(page: StableChatPage, nextById: Map<string, Message>): StableChatPage {
  let pageChanged = false
  const rows = page.rows.map(row => {
    const messages = row.messages.map(message => nextById.get(message.info.id) ?? message)
    if (messages.every((message, index) => message === row.messages[index])) return row
    pageChanged = true
    return {
      key: row.key,
      messages,
      messageIds: messages.map(message => message.info.id),
      estimatedHeight: estimateRowHeight(messages, row),
      renderWeight: estimateGroupRenderWeight(messages),
      continuesFromPrevious: row.continuesFromPrevious,
      continuesToNext: row.continuesToNext,
    }
  })

  if (!pageChanged) return page

  return {
    key: page.key,
    rows,
    messageIds: rows.flatMap(row => row.messageIds),
    estimatedHeight: rows.reduce((sum, row) => sum + row.estimatedHeight, 0),
    renderWeight: rows.reduce((sum, row) => sum + (row.renderWeight ?? estimateGroupRenderWeight(row.messages)), 0),
  }
}

export function reconcileStableChatPages(options: {
  currentPages: ChatPage[]
  nextMessages: Message[]
  allocateKey: (page: ChatPage) => string
  pageMessageCount?: number
  maxRenderWeight?: number
}): StableChatPage[] {
  const { currentPages, nextMessages, allocateKey } = options
  const pageMessageCount = options.pageMessageCount ?? PAGE_MESSAGE_COUNT
  const maxRenderWeight = options.maxRenderWeight ?? PAGE_EXTREME_RENDER_WEIGHT
  if (nextMessages.length === 0) return []
  if (currentPages.length === 0) {
    return buildStableChatPages(nextMessages, allocateKey, pageMessageCount, maxRenderWeight)
  }

  const previousIds = flattenPagesMessageIdsChronological(currentPages)
  const nextIds = nextMessages.map(message => message.info.id)
  const offset = findMessageSequenceOffset(nextIds, previousIds)
  if (offset === -1) {
    return buildStableChatPages(nextMessages, allocateKey, pageMessageCount, maxRenderWeight)
  }

  const nextById = new Map(nextMessages.map(message => [message.info.id, message]))
  const refreshedPages = currentPages.map(page => rebuildPageWithFreshMessages(page as StableChatPage, nextById))
  const prefixMessages = nextMessages.slice(0, offset)
  const suffixMessages = nextMessages.slice(offset + previousIds.length)

  let nextPages = refreshedPages
  if (suffixMessages.length > 0) {
    const newestPage = refreshedPages[0]
    const newestMessages = newestPage ? flattenPageMessagesChronological(newestPage) : []
    const suffixWeight = suffixMessages.reduce((sum, message) => sum + estimateMessageRenderWeight(message), 0)
    const newestWeight = newestPage?.renderWeight ?? 0

    if (
      newestPage &&
      newestPage.messageIds.length + suffixMessages.length <= pageMessageCount &&
      newestWeight + suffixWeight <= maxRenderWeight
    ) {
      const combinedRows = buildMessageGroups([...newestMessages, ...suffixMessages])
      const previousFirstRow = newestPage.rows[0]
      if (
        previousFirstRow?.continuesFromPrevious &&
        combinedRows[0]?.messageIds[0] === previousFirstRow.messageIds[0]
      ) {
        combinedRows[0] = buildMessageGroupRow(combinedRows[0].messages, { continuesFromPrevious: true })
      }
      const combinedPage = buildChatPage(combinedRows)
      nextPages = [{ ...combinedPage, key: newestPage.key }, ...refreshedPages.slice(1)]
    } else {
      let appendedPages = buildStableChatPages(suffixMessages, allocateKey, pageMessageCount, maxRenderWeight)
      let continuedNewestPage = newestPage
      const boundaryPage = appendedPages.at(-1)
      const connection = newestPage && boundaryPage ? connectAssistantPageBoundary(newestPage, boundaryPage) : null
      if (connection) {
        continuedNewestPage = connection.olderPage
        appendedPages = appendedPages.slice()
        appendedPages[appendedPages.length - 1] = connection.newerPage
      }
      nextPages = [...appendedPages, ...(continuedNewestPage ? [continuedNewestPage] : []), ...refreshedPages.slice(1)]
    }
  }

  if (prefixMessages.length > 0) {
    // 纯 prepend：已有页对象尽量保持引用不变，只在更老一侧挂新页。
    // 不改写 currentOldestPage（connect 会换新对象），避免视口内页重组抖动。
    let prependedOlderPages = buildStableChatPages(prefixMessages, allocateKey, pageMessageCount, maxRenderWeight)
    const currentOldestPage = nextPages.at(-1)
    const prefixBoundaryPage = prependedOlderPages[0]
    if (prefixBoundaryPage && currentOldestPage) {
      const olderBoundaryRow = prefixBoundaryPage.rows.at(-1)
      const newerBoundaryRow = currentOldestPage.rows[0]
      if (
        olderBoundaryRow?.messages[0]?.info.role === 'assistant' &&
        newerBoundaryRow?.messages[0]?.info.role === 'assistant'
      ) {
        const olderRows = prefixBoundaryPage.rows.slice()
        olderRows[olderRows.length - 1] = buildMessageGroupRow(olderBoundaryRow.messages, {
          continuesFromPrevious: olderBoundaryRow.continuesFromPrevious,
          continuesToNext: true,
        })
        prependedOlderPages = [
          { ...buildChatPage(olderRows), key: prefixBoundaryPage.key },
          ...prependedOlderPages.slice(1),
        ]
      }
    }
    nextPages = [...nextPages, ...prependedOlderPages]
  }

  return nextPages
}

export function buildPageOffsets(pages: ChatPage[], measuredPageHeights: Record<string, number>): number[] {
  const offsets = new Array<number>(pages.length + 1)
  offsets[0] = 0
  for (let index = 0; index < pages.length; index++) {
    offsets[index + 1] = offsets[index] + (measuredPageHeights[pages[index].key] ?? pages[index].estimatedHeight)
  }
  return offsets
}

export function seedMeasuredPageHeightsFromPreviousPages(options: {
  pages: ChatPage[]
  previousPages: ChatPage[]
  measuredPageHeights: Record<string, number>
}): Record<string, number> {
  const { pages, previousPages, measuredPageHeights } = options
  if (pages.length === 0 || previousPages.length === 0) return measuredPageHeights

  let nextHeights = measuredPageHeights
  for (const page of pages) {
    if (nextHeights[page.key] != null) continue

    const seedHeight = findMeasuredPageHeightSeed(page, previousPages, measuredPageHeights)
    if (seedHeight == null) continue

    if (nextHeights === measuredPageHeights) nextHeights = { ...measuredPageHeights }
    nextHeights[page.key] = seedHeight
  }

  return nextHeights
}

function findMeasuredPageHeightSeed(
  page: ChatPage,
  previousPages: ChatPage[],
  measuredPageHeights: Record<string, number>,
): number | null {
  let best: { messageCount: number; height: number } | null = null

  for (const previousPage of previousPages) {
    const measuredHeight = measuredPageHeights[previousPage.key]
    if (measuredHeight == null || measuredHeight <= 0) continue
    if (previousPage.messageIds.length === 0 || previousPage.messageIds.length > page.messageIds.length) continue
    if (findMessageSequenceOffset(page.messageIds, previousPage.messageIds) === -1) continue

    const estimatedAddedHeight = Math.max(0, page.estimatedHeight - previousPage.estimatedHeight)
    const height = Math.max(1, Math.ceil(measuredHeight + estimatedAddedHeight))
    if (!best || previousPage.messageIds.length > best.messageCount) {
      best = { messageCount: previousPage.messageIds.length, height }
    }
  }

  return best?.height ?? null
}

function findPageIndexAtOffset(offsets: number[], offset: number): number {
  let low = 0
  let high = offsets.length - 2
  let result = 0

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    if (offsets[mid] <= offset && offsets[mid + 1] > offset) return mid
    if (offsets[mid] > offset) {
      high = mid - 1
    } else {
      result = mid
      low = mid + 1
    }
  }

  return Math.max(0, Math.min(result, offsets.length - 2))
}

export function computeExpandedPageRange(options: {
  pages: ChatPage[]
  measuredPageHeights: Record<string, number>
  scrollOffsetFromBottom: number
  viewportHeight: number
  overscanPx?: number
  adjacentPageCount?: number
  adjacentPageMaxSourceHeight?: number
}): PageRange {
  const { pages, measuredPageHeights, scrollOffsetFromBottom, viewportHeight } = options
  if (pages.length === 0) return { startIndex: 0, endIndex: -1 }

  const offsets = buildPageOffsets(pages, measuredPageHeights)
  const viewportSpan = Math.max(1, viewportHeight)
  const overscanPx = Math.max(0, options.overscanPx ?? viewportSpan * PAGE_OVERSCAN_VIEWPORTS)
  const viewportStart = Math.max(0, scrollOffsetFromBottom - overscanPx)
  const viewportEnd = scrollOffsetFromBottom + viewportSpan + overscanPx
  const firstVisiblePageIndex = findPageIndexAtOffset(offsets, viewportStart)
  const lastVisiblePageIndex = findPageIndexAtOffset(offsets, Math.max(viewportStart, viewportEnd - 1))
  const adjacentPageCount = Math.max(0, Math.floor(options.adjacentPageCount ?? 0))
  const maxSourceHeight = options.adjacentPageMaxSourceHeight
  const canExpandFrom = (pageIndex: number) => {
    if (maxSourceHeight == null) return true
    const measuredHeight = measuredPageHeights[pages[pageIndex].key]
    return measuredHeight != null && measuredHeight <= maxSourceHeight
  }

  return {
    startIndex: canExpandFrom(firstVisiblePageIndex)
      ? Math.max(0, firstVisiblePageIndex - adjacentPageCount)
      : firstVisiblePageIndex,
    endIndex: canExpandFrom(lastVisiblePageIndex)
      ? Math.min(pages.length - 1, lastVisiblePageIndex + adjacentPageCount)
      : lastVisiblePageIndex,
  }
}

export function buildExpandedPageSelection(
  range: PageRange,
  forcedPageIndex?: number | readonly number[] | null,
): ExpandedPageSelection {
  const selection = new Set<number>()
  if (range.endIndex >= range.startIndex) {
    for (let index = range.startIndex; index <= range.endIndex; index++) selection.add(index)
  }
  if (typeof forcedPageIndex === 'number') {
    if (forcedPageIndex >= 0) selection.add(forcedPageIndex)
  } else if (forcedPageIndex) {
    for (const index of forcedPageIndex) {
      if (index >= 0) selection.add(index)
    }
  }
  return selection
}

export function expandSelectionWithPageKeys(options: {
  pages: ChatPage[]
  expandedPageSelection: ExpandedPageSelection
  pageKeys: ReadonlySet<string>
}): ExpandedPageSelection {
  const { pages, expandedPageSelection, pageKeys } = options
  if (pages.length === 0 || pageKeys.size === 0) return expandedPageSelection

  let nextSelection = expandedPageSelection
  for (let index = 0; index < pages.length; index += 1) {
    if (!pageKeys.has(pages[index].key) || nextSelection.has(index)) continue
    if (nextSelection === expandedPageSelection) nextSelection = new Set(expandedPageSelection)
    nextSelection.add(index)
  }

  return nextSelection
}

export function buildPageRenderSegments(options: {
  pages: StableChatPage[]
  expandedPageSelection: ExpandedPageSelection
  measuredPageHeights: Record<string, number>
}): PageRenderSegment[] {
  const { pages, expandedPageSelection, measuredPageHeights } = options
  if (pages.length === 0) return []

  const segments: PageRenderSegment[] = []
  const appendCollapsedSegment = (startPageIndex: number, endPageIndex: number) => {
    if (startPageIndex > endPageIndex) return

    let height = 0
    for (let index = startPageIndex; index <= endPageIndex; index++) {
      height += measuredPageHeights[pages[index].key] ?? pages[index].estimatedHeight
    }

    segments.push({
      kind: 'collapsed',
      key: `collapsed:${pages[startPageIndex].key}:${pages[endPageIndex].key}`,
      height,
    })
  }

  let collapsedStartIndex: number | null = null
  for (let index = 0; index < pages.length; index++) {
    if (!expandedPageSelection.has(index)) {
      if (collapsedStartIndex === null) collapsedStartIndex = index
      continue
    }

    if (collapsedStartIndex !== null) {
      appendCollapsedSegment(collapsedStartIndex, index - 1)
      collapsedStartIndex = null
    }

    const page = pages[index]
    segments.push({
      kind: 'expanded',
      key: page.key,
      page,
      measuredHeight: measuredPageHeights[page.key] ?? page.estimatedHeight,
    })
  }

  if (collapsedStartIndex !== null) appendCollapsedSegment(collapsedStartIndex, pages.length - 1)
  return segments
}

export function buildTurnDurationMap(messages: Message[], visibleMessages: Message[]): Map<string, number> {
  const map = new Map<string, number>()
  const visibleAssistantIds = new Set(
    visibleMessages.filter(message => message.info.role === 'assistant').map(message => message.info.id),
  )

  let currentUserCreated: number | null = null
  let currentVisibleAssistantId: string | null = null
  let currentLastCompleted: number | null = null

  const commitTurn = () => {
    if (currentUserCreated == null || currentVisibleAssistantId == null || currentLastCompleted == null) return
    map.set(currentVisibleAssistantId, currentLastCompleted - currentUserCreated)
  }

  for (const message of messages) {
    if (message.info.role === 'user') {
      commitTurn()
      currentUserCreated = message.info.time.created
      currentVisibleAssistantId = null
      currentLastCompleted = null
      continue
    }

    if (currentUserCreated == null || message.info.role !== 'assistant') continue

    if (visibleAssistantIds.has(message.info.id)) {
      currentVisibleAssistantId = message.info.id
    }
    if (message.info.time.completed != null) {
      currentLastCompleted = message.info.time.completed
    }
  }

  commitTurn()

  return map
}

/**
 * 每个用户回合里，最后一条可见 assistant 消息的 id 集合。
 * 用于「仅最新 Step」：中间 assistant 消息不显示 step 完成信息。
 */
export function buildTurnLatestAssistantIdSet(visibleMessages: Message[]): Set<string> {
  const latestIds = new Set<string>()
  let currentLatestAssistantId: string | null = null

  const commitTurn = () => {
    if (currentLatestAssistantId) latestIds.add(currentLatestAssistantId)
  }

  for (const message of visibleMessages) {
    if (message.info.role === 'user') {
      commitTurn()
      currentLatestAssistantId = null
      continue
    }
    if (message.info.role === 'assistant') {
      currentLatestAssistantId = message.info.id
    }
  }

  commitTurn()
  return latestIds
}

/** 过程折叠：虚拟时间线上的一行 */
export type ProcessTimelineItem =
  | {
      kind: 'message'
      key: string
      message: Message
      /** 过程壳内消息的内容范围 */
      processContentScope?: 'process' | 'final' | 'inline'
    }
  | {
      kind: 'process-shell'
      key: string
      userMessageId: string | null
      startedAt?: number
      durationMs?: number
      isActive: boolean
      /** 壳内消息（不含壳外 final） */
      children: Array<{
        message: Message
        processContentScope: 'process' | 'inline'
      }>
      /** 壳外最终回答（结束后才有） */
      finalMessage?: Message
    }

/** 两行是否可共享同一对象（VirtualRow 靠 item 引用短路） */
export function sameProcessTimelineItem(a: ProcessTimelineItem, b: ProcessTimelineItem): boolean {
  if (a === b) return true
  if (a.kind !== b.kind || a.key !== b.key) return false

  if (a.kind === 'message' && b.kind === 'message') {
    return a.message === b.message && a.processContentScope === b.processContentScope
  }

  if (a.kind === 'process-shell' && b.kind === 'process-shell') {
    if (
      a.userMessageId !== b.userMessageId ||
      a.startedAt !== b.startedAt ||
      a.durationMs !== b.durationMs ||
      a.isActive !== b.isActive ||
      a.finalMessage !== b.finalMessage ||
      a.children.length !== b.children.length
    ) {
      return false
    }
    for (let i = 0; i < a.children.length; i++) {
      const left = a.children[i]
      const right = b.children[i]
      if (left.message !== right.message || left.processContentScope !== right.processContentScope) {
        return false
      }
    }
    return true
  }

  return false
}

/**
 * 流式时只脏最后一行：按 key 复用未变 timeline item，让 VirtualRow memo 命中历史行。
 * 数组本身若完全未变则复用 previous 数组引用。
 */
export function reuseProcessTimelineItems(
  previous: ProcessTimelineItem[] | undefined,
  next: ProcessTimelineItem[],
): ProcessTimelineItem[] {
  if (!previous || previous.length === 0) return next
  if (previous === next) return previous

  const prevByKey = new Map(previous.map(item => [item.key, item]))
  let allSame = previous.length === next.length
  const result = new Array<ProcessTimelineItem>(next.length)

  for (let i = 0; i < next.length; i++) {
    const item = next[i]
    const prev = prevByKey.get(item.key)
    if (prev && sameProcessTimelineItem(prev, item)) {
      result[i] = prev
      if (previous[i] !== prev) allSame = false
    } else {
      result[i] = item
      allSame = false
    }
  }

  return allSame ? previous : result
}

function assistantHasLiveWork(message: Message): boolean {
  if (message.info.role !== 'assistant') return false
  if (message.info.time.completed == null || message.isStreaming) return true
  return message.parts.some(p => p.type === 'tool' && (p.state.status === 'running' || p.state.status === 'pending'))
}

function resolveTurnDurationMs(
  assistants: Message[],
  userStart: number | undefined,
  turnDurationMap: Map<string, number>,
): number | undefined {
  if (userStart == null) return undefined
  for (const m of [...assistants].reverse()) {
    const mapped = turnDurationMap.get(m.info.id)
    if (mapped != null && mapped > 0) return mapped
  }
  let latestEnd: number | undefined
  for (const m of assistants) {
    const completed = m.info.time.completed
    if (completed != null && (latestEnd == null || completed > latestEnd)) latestEnd = completed
    for (const p of m.parts) {
      if (p.type !== 'tool') continue
      const toolEnd = p.state.time?.end
      if (toolEnd != null && (latestEnd == null || toolEnd > latestEnd)) latestEnd = toolEnd
    }
  }
  if (latestEnd != null && latestEnd > userStart) return latestEnd - userStart
  return undefined
}

/**
 * 过程折叠时间线：按用户消息分组。
 *
 * 异步多发：
 * - 同一时刻只一个 Working，挂在最早仍 pending 的 user 回合
 * - 更晚空回合先只显示 user
 * - 后面回合 SSE live 一到，前面一律 Worked（不必等 completed / idle）
 * - 本轮 assistant 全 completed 且无 live → 永远 Worked，不因 session busy 重开
 *   （否则发送瞬间 streaming 先到、新 user 未入列，会把已 Worked 闪回 Working）
 *
 * isUserEntryReady：空壳等用户入场生长完成后再挂。
 */
export function buildProcessTimeline(
  visibleMessages: Message[],
  options: {
    turnDurationMap: Map<string, number>
    sessionIsStreaming: boolean
    messageHasProcess: (message: Message) => boolean
    messageHasFinal: (message: Message) => boolean
    /** 用户消息入场生长是否完成；缺省视为已完成（历史消息 / 测试） */
    isUserEntryReady?: (userMessageId: string) => boolean
  },
): ProcessTimelineItem[] {
  const {
    turnDurationMap,
    sessionIsStreaming,
    messageHasProcess,
    messageHasFinal,
    isUserEntryReady = () => true,
  } = options
  const items: ProcessTimelineItem[] = []

  type TurnBag = {
    user: Message | null
    assistants: Message[]
  }

  const turns: TurnBag[] = []
  let current: TurnBag | null = null

  for (const message of visibleMessages) {
    if (message.info.role === 'user') {
      if (current) turns.push(current)
      current = { user: message, assistants: [] }
      continue
    }
    if (message.info.role !== 'assistant') continue
    if (!current) {
      // 历史续段 / 页首无 user：直接平铺，不挂壳
      items.push({ kind: 'message', key: message.info.id, message })
      continue
    }
    current.assistants.push(message)
  }
  if (current) turns.push(current)

  // 只关心带 user 的回合（过程壳的锚点）
  const userTurns = turns.filter((t): t is TurnBag & { user: Message } => t.user != null)

  const laterHasAssistant = (fromIndex: number) => {
    for (let j = fromIndex + 1; j < userTurns.length; j++) {
      if (userTurns[j].assistants.length > 0) return true
    }
    return false
  }

  /** 更晚回合是否已有 live 助手——SSE 挂 Working 的绝对条件 */
  const laterHasLive = (fromIndex: number) => {
    for (let j = fromIndex + 1; j < userTurns.length; j++) {
      if (userTurns[j].assistants.some(assistantHasLiveWork)) return true
    }
    return false
  }

  const isTurnSettled = (turn: TurnBag & { user: Message }, index: number): boolean => {
    const assistants = turn.assistants
    // 后面 SSE live → 前面 Worked（须最先判断；前轮 completed 常晚到）
    if (laterHasLive(index)) return true
    if (assistants.some(assistantHasLiveWork)) return false
    if (assistants.length === 0) {
      // 空回合：idle 结束；或后面已有 assistant（被跳过）
      return !sessionIsStreaming || laterHasAssistant(index)
    }
    // 全 completed 且无 live → 锁定 Worked。
    // 不要再用 sessionIsStreaming 重开：发送时 busy 常早于新 user 入列，会闪一下。
    // 工具循环间隙若下一助手还没到，会短暂 Worked；下一助手 live 后自然回到 Working。
    return assistants.every(m => m.info.time.completed != null && !m.isStreaming)
  }

  const isTurnPending = (turn: TurnBag & { user: Message }, index: number): boolean => {
    if (isTurnSettled(turn, index)) return false
    if (turn.assistants.length > 0) return true
    return sessionIsStreaming && isUserEntryReady(turn.user.info.id)
  }

  // 唯一 Working：最早 pending 的用户回合
  let activeUserId: string | null = null
  for (let i = 0; i < userTurns.length; i++) {
    if (isTurnPending(userTurns[i], i)) {
      activeUserId = userTurns[i].user.info.id
      break
    }
  }

  for (const turn of turns) {
    if (turn.user) {
      items.push({ kind: 'message', key: turn.user.info.id, message: turn.user })
    }

    const assistants = turn.assistants
    if (!turn.user && assistants.length === 0) continue

    // 无 user 的续段：平铺
    if (!turn.user) {
      for (const m of assistants) {
        items.push({ kind: 'message', key: m.info.id, message: m })
      }
      continue
    }

    const userId = turn.user.info.id
    const turnIsActive = activeUserId != null && userId === activeUserId

    const finalAssistant = assistants.length > 0 ? assistants[assistants.length - 1] : null
    const finalId = finalAssistant?.info.id ?? null
    const startedAt = turn.user.info.time.created
    const durationMs = turnIsActive ? undefined : resolveTurnDurationMs(assistants, startedAt, turnDurationMap)

    // 进行中：全部进壳；结束：中间全进 + 末尾仅 process
    const children: Array<{ message: Message; processContentScope: 'process' | 'inline' }> = []
    if (turnIsActive) {
      for (const m of assistants) {
        children.push({
          message: m,
          processContentScope: m.info.id === finalId ? 'process' : 'inline',
        })
      }
    } else {
      for (const m of assistants) {
        if (m.info.id === finalId) {
          if (messageHasProcess(m)) {
            children.push({ message: m, processContentScope: 'process' })
          }
        } else {
          children.push({ message: m, processContentScope: 'inline' })
        }
      }
    }

    const finalOutside = !turnIsActive && finalAssistant && messageHasFinal(finalAssistant) ? finalAssistant : undefined

    // 进行中或有过程内容 → 挂壳
    // 更晚的空 pending 回合：turnIsActive=false 且无 children → 不挂壳（只显示 user）
    // 纯 final 正文、无过程 → 直接平铺
    if (children.length > 0 || turnIsActive) {
      items.push({
        kind: 'process-shell',
        key: `process-shell:${userId}`,
        userMessageId: userId,
        startedAt,
        durationMs,
        isActive: turnIsActive,
        children,
        finalMessage: finalOutside,
      })
    } else if (finalOutside) {
      items.push({
        kind: 'message',
        key: finalOutside.info.id,
        message: finalOutside,
      })
    } else {
      for (const m of assistants) {
        items.push({ kind: 'message', key: m.info.id, message: m })
      }
    }
  }

  return items
}
