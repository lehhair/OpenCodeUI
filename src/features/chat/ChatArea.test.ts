import { describe, expect, it } from 'vitest'
import {
  buildChatPages,
  buildExpandedPageSelection,
  buildPageRenderSegments,
  buildTurnDurationMap,
  computeAnchorRestoreScrollDelta,
  computeExpandedPageRange,
  computePremeasureMessageBudget,
  findPageToPremeasure,
  findPagesToPremeasure,
  findMessageSequenceOffset,
  reconcileStableChatPages,
  seedMeasuredPageHeightsFromPreviousPages,
} from './chatPageModel'
import { buildVisibleMessageEntries, getVisibleMessageForkTargetId } from './chatAreaVisibility'
import { buildChatPageViewModel } from './useChatPageViewModel'
import type { Message, MessageError, Part, ToolPart, ReasoningPart } from '../../types/message'

function createUserMessage(id: string, created: number): Message {
  return {
    info: {
      id,
      sessionID: 'session-1',
      role: 'user',
      agent: 'build',
      model: { providerID: 'openai', modelID: 'gpt-4.1' },
      time: { created },
    },
    parts: [],
    isStreaming: false,
  }
}

function createAssistantMessage(
  id: string,
  parts: Part[],
  created = 1,
  completed?: number,
  error?: MessageError,
): Message {
  return {
    info: {
      id,
      sessionID: 'session-1',
      role: 'assistant',
      parentID: 'user-1',
      modelID: 'model-1',
      providerID: 'provider-1',
      mode: 'chat',
      agent: 'build',
      path: { cwd: '/workspace', root: '/workspace' },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      time: completed == null ? { created } : { created, completed },
      error,
    },
    parts,
    isStreaming: false,
  }
}

function createToolPart(id: string, messageID: string): ToolPart {
  return {
    id,
    sessionID: 'session-1',
    messageID,
    type: 'tool',
    callID: `call-${id}`,
    tool: 'bash',
    state: {
      status: 'completed',
      input: { command: 'pwd' },
      output: '/workspace',
      title: 'pwd',
      metadata: {},
      time: { start: 1, end: 2 },
    },
  }
}

function createTextPart(id: string, messageID: string, text: string): Part {
  return {
    id,
    sessionID: 'session-1',
    messageID,
    type: 'text',
    text,
  }
}

describe('buildVisibleMessageEntries', () => {
  it('keeps source ids for merged assistant tool messages', () => {
    const first = createAssistantMessage('assistant-1', [createToolPart('tool-1', 'assistant-1')])
    const second = createAssistantMessage('assistant-2', [createToolPart('tool-2', 'assistant-2')])

    const entries = buildVisibleMessageEntries([first, second])

    expect(entries).toHaveLength(1)
    expect(entries[0].sourceIds).toEqual(['assistant-1', 'assistant-2'])
    expect(entries[0].message.parts).toHaveLength(2)
  })

  it('merges when first message ends with tool followed by empty reasoning', () => {
    const emptyReasoning: ReasoningPart = {
      id: 'reasoning-empty',
      sessionID: 'session-1',
      messageID: 'assistant-1',
      type: 'reasoning',
      text: '',
      time: { start: 1, end: 2 },
    }
    const first = createAssistantMessage('assistant-1', [createToolPart('tool-1', 'assistant-1'), emptyReasoning])
    const second = createAssistantMessage('assistant-2', [createToolPart('tool-2', 'assistant-2')])

    const entries = buildVisibleMessageEntries([first, second])

    expect(entries).toHaveLength(1)
    expect(entries[0].sourceIds).toEqual(['assistant-1', 'assistant-2'])
  })

  it('uses the latest merged assistant message as fork target', () => {
    const first = createAssistantMessage('assistant-1', [createToolPart('tool-1', 'assistant-1')])
    const second = createAssistantMessage('assistant-2', [createToolPart('tool-2', 'assistant-2')])

    const entries = buildVisibleMessageEntries([first, second])

    expect(entries).toHaveLength(1)
    expect(getVisibleMessageForkTargetId(entries[0])).toBe('assistant-2')
  })

  it('keeps aborted assistant messages that already have renderable parts', () => {
    const message = createAssistantMessage(
      'assistant-aborted-with-tool',
      [createToolPart('tool-1', 'assistant-aborted-with-tool')],
      1,
      2,
      { name: 'MessageAbortedError', data: { message: 'Aborted' } },
    )

    const entries = buildVisibleMessageEntries([message])

    expect(entries).toHaveLength(1)
    expect(entries[0].message.info.id).toBe('assistant-aborted-with-tool')
  })

  it('hides aborted assistant messages without renderable parts', () => {
    const emptyReasoning: ReasoningPart = {
      id: 'reasoning-empty',
      sessionID: 'session-1',
      messageID: 'assistant-empty-abort',
      type: 'reasoning',
      text: '',
      time: { start: 1, end: 2 },
    }
    const message = createAssistantMessage('assistant-empty-abort', [emptyReasoning], 1, 2, {
      name: 'MessageAbortedError',
      data: { message: 'Aborted' },
    })

    const entries = buildVisibleMessageEntries([message])

    expect(entries).toHaveLength(0)
  })
})

describe('buildChatPageViewModel', () => {
  it('reuses unchanged visible messages, pages, and maps during streaming updates', () => {
    const messages = Array.from({ length: 12 }, (_unused, index) => [
      {
        ...createUserMessage(`user-${index}`, index * 2 + 1),
        parts: [createTextPart(`user-text-${index}`, `user-${index}`, `prompt ${index}`)],
      },
      createAssistantMessage(
        `assistant-${index}`,
        [createTextPart(`text-${index}`, `assistant-${index}`, index === 11 ? 'hello' : `old ${index}`)],
        index * 2 + 2,
        index === 11 ? undefined : index * 2 + 3,
      ),
    ]).flat()
    const first = buildChatPageViewModel(messages)
    const streamingMessage = messages[messages.length - 1]
    const nextMessages = [
      ...messages.slice(0, -1),
      {
        ...streamingMessage,
        parts: [{ ...streamingMessage.parts[0], text: 'hello world' }],
      },
    ]

    const next = buildChatPageViewModel(nextMessages, first)

    expect(first.pageRecords.length).toBeGreaterThan(1)
    expect(next.visibleMessages[0]).toBe(first.visibleMessages[0])
    expect(next.visibleMessages[1]).toBe(first.visibleMessages[1])
    expect(next.visibleMessages.at(-1)).not.toBe(first.visibleMessages.at(-1))
    expect(next.pageRecords[1]).toBe(first.pageRecords[1])
    expect(next.forkTargetIdMap).toBe(first.forkTargetIdMap)
    expect(next.turnDurationMap).toBe(first.turnDurationMap)
  })

  it('keeps the newest page key stable when appending a new turn', () => {
    const messages = Array.from({ length: 8 }, (_unused, index) => [
      {
        ...createUserMessage(`user-${index}`, index * 2 + 1),
        parts: [createTextPart(`user-text-${index}`, `user-${index}`, `prompt ${index}`)],
      },
      createAssistantMessage(
        `assistant-${index}`,
        [createTextPart(`text-${index}`, `assistant-${index}`, `answer ${index}`)],
        index * 2 + 2,
        index * 2 + 3,
      ),
    ]).flat()
    const first = buildChatPageViewModel(messages)
    const nextMessages = [
      ...messages,
      {
        ...createUserMessage('user-next', 100),
        parts: [createTextPart('user-text-next', 'user-next', '# large markdown prompt')],
      },
    ]

    const next = buildChatPageViewModel(nextMessages, first)

    expect(next.pageRecords[0].key).toBe(first.pageRecords[0].key)
    expect(next.pageRecords[0].messageIds).toContain(first.pageRecords[0].messageIds[0])
  })

  it('keeps new history pages when there is no previous page match', () => {
    const messages = Array.from({ length: 12 }, (_unused, index) => [
      {
        ...createUserMessage(`user-${index}`, index * 2 + 1),
        parts: [createTextPart(`user-text-${index}`, `user-${index}`, `prompt ${index}`)],
      },
      createAssistantMessage(
        `assistant-${index}`,
        [createTextPart(`text-${index}`, `assistant-${index}`, `answer ${index}`)],
        index * 2 + 2,
        index * 2 + 3,
      ),
    ]).flat()
    const first = buildChatPageViewModel(messages)
    const olderMessages = Array.from({ length: 12 }, (_unused, index) => [
      {
        ...createUserMessage(`older-user-${index}`, index * 2 + 1),
        parts: [createTextPart(`older-user-text-${index}`, `older-user-${index}`, `older prompt ${index}`)],
      },
      createAssistantMessage(
        `older-assistant-${index}`,
        [createTextPart(`older-text-${index}`, `older-assistant-${index}`, `older answer ${index}`)],
        index * 2 + 2,
        index * 2 + 3,
      ),
    ]).flat()

    const next = buildChatPageViewModel([...olderMessages, ...messages], first)

    expect(next.pageRecords.length).toBeGreaterThan(first.pageRecords.length)
    expect(new Set(next.pageRecords.map(page => page.key)).size).toBe(next.pageRecords.length)
  })
})

describe('buildTurnDurationMap', () => {
  it('assigns each turn duration to the latest visible assistant message in that turn', () => {
    const messages = [
      createUserMessage('user-1', 1000),
      createAssistantMessage('assistant-1', [], 1001, 1200),
      createAssistantMessage('assistant-2', [], 1201, 1500),
      createUserMessage('user-2', 2000),
      createAssistantMessage('assistant-3', [], 2001, 2600),
    ]

    const visibleMessages = [messages[1], messages[2], messages[4]]
    const durationMap = buildTurnDurationMap(messages, visibleMessages)

    expect(durationMap.get('assistant-2')).toBe(500)
    expect(durationMap.get('assistant-3')).toBe(600)
    expect(durationMap.has('assistant-1')).toBe(false)
  })
})

describe('buildChatPages', () => {
  it('chunks messages into render-order pages while preserving assistant groups', () => {
    const messages = [
      createUserMessage('user-1', 1),
      createAssistantMessage('assistant-1', [], 2, 3),
      createAssistantMessage('assistant-2', [], 4, 5),
      createUserMessage('user-2', 6),
      createAssistantMessage('assistant-3', [], 7, 8),
    ]

    const pages = buildChatPages(messages, 2)

    // render order: newest page first
    expect(pages).toHaveLength(3)
    expect(pages[0].messageIds).toEqual(['user-2', 'assistant-3'])
    // assistant-1 + assistant-2 应该保持在同一个 group/page，不被拆开
    expect(pages[1].messageIds).toEqual(['assistant-1', 'assistant-2'])
    expect(pages[2].messageIds).toEqual(['user-1'])
  })
})

describe('computeExpandedPageRange', () => {
  it('expands only the current page by default around the viewport center', () => {
    const pages = [
      { key: 'page-0', rows: [], messageIds: ['m0'], estimatedHeight: 400 },
      { key: 'page-1', rows: [], messageIds: ['m1'], estimatedHeight: 400 },
      { key: 'page-2', rows: [], messageIds: ['m2'], estimatedHeight: 400 },
      { key: 'page-3', rows: [], messageIds: ['m3'], estimatedHeight: 400 },
    ]

    const range = computeExpandedPageRange({
      pages,
      measuredPageHeights: {},
      scrollOffsetFromBottom: 450,
      viewportHeight: 300,
    })

    expect(range).toEqual({ startIndex: 1, endIndex: 1 })
  })

  it('expands every page intersecting the viewport to avoid blank page seams', () => {
    const pages = [
      { key: 'page-0', rows: [], messageIds: ['m0'], estimatedHeight: 400 },
      { key: 'page-1', rows: [], messageIds: ['m1'], estimatedHeight: 400 },
      { key: 'page-2', rows: [], messageIds: ['m2'], estimatedHeight: 400 },
    ]

    const range = computeExpandedPageRange({
      pages,
      measuredPageHeights: {},
      scrollOffsetFromBottom: 350,
      viewportHeight: 300,
    })

    expect(range).toEqual({ startIndex: 0, endIndex: 1 })
  })

  it('keeps the viewport range narrow for far jump targets', () => {
    const pages = [
      { key: 'page-0', rows: [], messageIds: ['m0'], estimatedHeight: 400 },
      { key: 'page-1', rows: [], messageIds: ['m1'], estimatedHeight: 400 },
      { key: 'page-2', rows: [], messageIds: ['m2'], estimatedHeight: 400 },
      { key: 'page-3', rows: [], messageIds: ['m3'], estimatedHeight: 400 },
    ]

    const range = computeExpandedPageRange({
      pages,
      measuredPageHeights: {},
      scrollOffsetFromBottom: 0,
      viewportHeight: 200,
    })

    expect(range).toEqual({ startIndex: 0, endIndex: 0 })
    expect(Array.from(buildExpandedPageSelection(range, 3))).toEqual([0, 3])
  })
})

describe('buildPageRenderSegments', () => {
  it('aggregates collapsed pages on both sides of the expanded range', () => {
    const pages = [
      { key: 'page-0', rows: [], messageIds: ['m0'], estimatedHeight: 100 },
      { key: 'page-1', rows: [], messageIds: ['m1'], estimatedHeight: 110 },
      { key: 'page-2', rows: [], messageIds: ['m2'], estimatedHeight: 120 },
      { key: 'page-3', rows: [], messageIds: ['m3'], estimatedHeight: 130 },
      { key: 'page-4', rows: [], messageIds: ['m4'], estimatedHeight: 140 },
    ]

    const segments = buildPageRenderSegments({
      pages,
      expandedPageSelection: buildExpandedPageSelection({ startIndex: 1, endIndex: 3 }),
      measuredPageHeights: { 'page-4': 200 },
    })

    expect(segments).toEqual([
      { kind: 'collapsed', key: 'collapsed:page-0:page-0', height: 100 },
      { kind: 'expanded', key: 'page-1', page: pages[1], measuredHeight: 110 },
      { kind: 'expanded', key: 'page-2', page: pages[2], measuredHeight: 120 },
      { kind: 'expanded', key: 'page-3', page: pages[3], measuredHeight: 130 },
      { kind: 'collapsed', key: 'collapsed:page-4:page-4', height: 200 },
    ])
  })

  it('keeps collapsed aggregates between the current page and a far jump target', () => {
    const pages = [
      { key: 'page-0', rows: [], messageIds: ['m0'], estimatedHeight: 100 },
      { key: 'page-1', rows: [], messageIds: ['m1'], estimatedHeight: 110 },
      { key: 'page-2', rows: [], messageIds: ['m2'], estimatedHeight: 120 },
      { key: 'page-3', rows: [], messageIds: ['m3'], estimatedHeight: 130 },
    ]

    const segments = buildPageRenderSegments({
      pages,
      expandedPageSelection: buildExpandedPageSelection({ startIndex: 0, endIndex: 0 }, 3),
      measuredPageHeights: {},
    })

    expect(segments).toEqual([
      { kind: 'expanded', key: 'page-0', page: pages[0], measuredHeight: 100 },
      { kind: 'collapsed', key: 'collapsed:page-1:page-2', height: 230 },
      { kind: 'expanded', key: 'page-3', page: pages[3], measuredHeight: 130 },
    ])
  })
})

describe('findPageToPremeasure', () => {
  const pages = [
    { key: 'page-0', rows: [], messageIds: ['m0'], estimatedHeight: 100 },
    { key: 'page-1', rows: [], messageIds: ['m1'], estimatedHeight: 110 },
    { key: 'page-2', rows: [], messageIds: ['m2'], estimatedHeight: 120 },
    { key: 'page-3', rows: [], messageIds: ['m3'], estimatedHeight: 130 },
    { key: 'page-4', rows: [], messageIds: ['m4'], estimatedHeight: 140 },
  ]

  it('premeasures the next older page when scrolling toward history', () => {
    expect(
      findPageToPremeasure({
        pages,
        expandedPageRange: { startIndex: 2, endIndex: 2 },
        measuredPageHeights: {},
        direction: 'older',
        radius: 2,
      }),
    ).toBe(pages[3])
  })

  it('premeasures the next newer page when scrolling back toward latest messages', () => {
    expect(
      findPageToPremeasure({
        pages,
        expandedPageRange: { startIndex: 2, endIndex: 2 },
        measuredPageHeights: {},
        direction: 'newer',
        radius: 2,
      }),
    ).toBe(pages[1])
  })

  it('falls back to the opposite side when the preferred side is already measured', () => {
    expect(
      findPageToPremeasure({
        pages,
        expandedPageRange: { startIndex: 2, endIndex: 2 },
        measuredPageHeights: { 'page-3': 130, 'page-4': 140 },
        direction: 'older',
        radius: 2,
      }),
    ).toBe(pages[1])
  })

  it('remeasures stale pages without dropping their cached heights', () => {
    expect(
      findPageToPremeasure({
        pages,
        expandedPageRange: { startIndex: 2, endIndex: 2 },
        measuredPageHeights: { 'page-3': 130 },
        stalePageKeys: new Set(['page-3']),
        direction: 'older',
        radius: 2,
      }),
    ).toBe(pages[3])
  })

  it('premeasures multiple small pages to satisfy the message budget', () => {
    const smallPages = Array.from({ length: 8 }, (_, index) => ({
      key: `small-page-${index}`,
      rows: [],
      messageIds: Array.from({ length: 5 }, (_unused, messageIndex) => `m${index}-${messageIndex}`),
      estimatedHeight: 100,
    }))

    const planned = findPagesToPremeasure({
      pages: smallPages,
      expandedPageRange: { startIndex: 1, endIndex: 1 },
      measuredPageHeights: {},
      direction: 'older',
      radius: 1,
      messageBudget: 20,
    })

    expect(planned.map(page => page.key)).toEqual(['small-page-2', 'small-page-3', 'small-page-4', 'small-page-5'])
  })
})

describe('computePremeasureMessageBudget', () => {
  it('scales with viewport height within a bounded message budget', () => {
    expect(computePremeasureMessageBudget(0)).toBe(20)
    expect(computePremeasureMessageBudget(600)).toBe(20)
    expect(computePremeasureMessageBudget(1200)).toBe(30)
    expect(computePremeasureMessageBudget(2400)).toBe(60)
    expect(computePremeasureMessageBudget(4000)).toBe(60)
  })
})

describe('findMessageSequenceOffset', () => {
  it('finds the old message sequence inside the new one', () => {
    expect(findMessageSequenceOffset(['a', 'b', 'c', 'd'], ['b', 'c'])).toBe(1)
  })

  it('returns -1 when the old sequence is not contiguous', () => {
    expect(findMessageSequenceOffset(['a', 'b', 'x', 'c'], ['b', 'c'])).toBe(-1)
  })
})

describe('seedMeasuredPageHeightsFromPreviousPages', () => {
  it('carries measured height forward when a page appends to measured content', () => {
    const previousPages = [{ key: 'old-page', rows: [], messageIds: ['user-1', 'assistant-1'], estimatedHeight: 240 }]
    const pages = [{ key: 'new-page', rows: [], messageIds: ['user-1', 'assistant-1', 'user-2'], estimatedHeight: 320 }]
    const measuredPageHeights = { 'old-page': 980 }

    const seeded = seedMeasuredPageHeightsFromPreviousPages({ pages, previousPages, measuredPageHeights })

    expect(seeded).not.toBe(measuredPageHeights)
    expect(seeded['new-page']).toBe(1060)
  })

  it('does not seed from partial page overlap', () => {
    const previousPages = [{ key: 'old-page', rows: [], messageIds: ['user-1', 'assistant-1'], estimatedHeight: 240 }]
    const pages = [{ key: 'new-page', rows: [], messageIds: ['assistant-1', 'user-2'], estimatedHeight: 220 }]
    const measuredPageHeights = { 'old-page': 980 }

    const seeded = seedMeasuredPageHeightsFromPreviousPages({ pages, previousPages, measuredPageHeights })

    expect(seeded).toBe(measuredPageHeights)
    expect(seeded['new-page']).toBeUndefined()
  })
})

describe('reconcileStableChatPages', () => {
  const alloc = (() => {
    let index = 0
    return () => `page-${index++}`
  })()

  it('preserves existing page keys when loading older history', () => {
    const currentMessages = [
      createUserMessage('user-2', 6),
      createAssistantMessage('assistant-3', [], 7, 8),
      createUserMessage('user-3', 9),
      createAssistantMessage('assistant-4', [], 10, 11),
    ]
    const currentPages = reconcileStableChatPages({
      currentPages: [],
      nextMessages: currentMessages,
      allocateKey: alloc,
      pageMessageCount: 2,
    })

    const nextMessages = [
      createUserMessage('user-1', 1),
      createAssistantMessage('assistant-1', [], 2, 3),
      createAssistantMessage('assistant-2', [], 4, 5),
      ...currentMessages,
    ]
    const nextPages = reconcileStableChatPages({ currentPages, nextMessages, allocateKey: alloc, pageMessageCount: 2 })

    expect(nextPages.slice(0, currentPages.length).map(page => page.key)).toEqual(currentPages.map(page => page.key))
  })

  it('only rebuilds the newest page segment when appending new messages', () => {
    const currentMessages = [
      createUserMessage('user-1', 1),
      createAssistantMessage('assistant-1', [], 2, 3),
      createUserMessage('user-2', 4),
      createAssistantMessage('assistant-2', [], 5, 6),
    ]
    const currentPages = reconcileStableChatPages({
      currentPages: [],
      nextMessages: currentMessages,
      allocateKey: alloc,
      pageMessageCount: 2,
    })

    const nextMessages = [
      ...currentMessages,
      createUserMessage('user-3', 7),
      createAssistantMessage('assistant-3', [], 8, 9),
    ]
    const nextPages = reconcileStableChatPages({ currentPages, nextMessages, allocateKey: alloc, pageMessageCount: 2 })

    // 老的第二页 key 应该保住，避免整段历史一起重切
    expect(nextPages[nextPages.length - 1].key).toBe(currentPages[currentPages.length - 1].key)
  })
})

describe('computeAnchorRestoreScrollDelta', () => {
  it('returns the amount the anchor drifted downward', () => {
    expect(computeAnchorRestoreScrollDelta(24, 180)).toBe(156)
  })

  it('returns a negative value when the anchor drifted upward', () => {
    expect(computeAnchorRestoreScrollDelta(180, 24)).toBe(-156)
  })
})
