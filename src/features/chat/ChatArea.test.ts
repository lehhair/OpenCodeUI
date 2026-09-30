import { describe, expect, it } from 'vitest'
import {
  buildChatPages,
  buildExpandedPageSelection,
  buildPageRenderSegments,
  buildProcessTimeline,
  buildTurnDurationMap,
  buildTurnLatestAssistantIdSet,
  computeAnchorRestoreScrollDelta,
  computeExpandedPageRange,
  estimateMessageRenderWeight,
  expandSelectionWithPageKeys,
  findMessageSequenceOffset,
  reconcileStableChatPages,
  reuseProcessTimelineItems,
  seedMeasuredPageHeightsFromPreviousPages,
} from './chatPageModel'
import { getStreamingHotIndexes, getTimelineRowYClass, mergeVirtualRangeIndexes } from './chatAreaUtils'
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

  it('keeps the merged source anchor stable when older tool history is prepended', () => {
    const first = createAssistantMessage('assistant-1', [createToolPart('tool-1', 'assistant-1')])
    const second = createAssistantMessage('assistant-2', [createToolPart('tool-2', 'assistant-2')])
    const previousEntry = buildVisibleMessageEntries([first, second])[0]
    const older = createAssistantMessage('assistant-older', [createToolPart('tool-older', 'assistant-older')])
    const nextEntry = buildVisibleMessageEntries([older, first, second])[0]

    expect(previousEntry.message.info.id).toBe('assistant-1')
    expect(nextEntry.message.info.id).toBe('assistant-older')
    expect(getVisibleMessageForkTargetId(previousEntry)).toBe('assistant-2')
    expect(getVisibleMessageForkTargetId(nextEntry)).toBe('assistant-2')
  })

  it('stabilizes merged visible message id when older tool history is prepended', () => {
    const first = createAssistantMessage('assistant-1', [createToolPart('tool-1', 'assistant-1')])
    const second = createAssistantMessage('assistant-2', [createToolPart('tool-2', 'assistant-2')])
    const previous = buildChatPageViewModel([first, second])
    const older = createAssistantMessage('assistant-older', [createToolPart('tool-older', 'assistant-older')])
    const next = buildChatPageViewModel([older, first, second], previous)

    expect(previous.visibleMessages[0].info.id).toBe('assistant-1')
    expect(next.visibleMessages[0].info.id).toBe('assistant-1')
    expect(next.visibleMessageEntries[0].sourceIds).toEqual(['assistant-older', 'assistant-1', 'assistant-2'])
    expect(next.visibleMessages[0].parts).toHaveLength(3)
    expect(next.pageRecords.map(page => page.key)).toEqual(previous.pageRecords.map(page => page.key))
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

  it('keeps existing page keys stable when appending a new turn', () => {
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

    const previousNewestPage = next.pageRecords.find(page => page.key === first.pageRecords[0].key)
    expect(previousNewestPage?.key).toBe(first.pageRecords[0].key)
    expect(previousNewestPage?.messageIds).toContain(first.pageRecords[0].messageIds[0])
    expect(previousNewestPage?.messageIds).toContain('user-next')
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

  it('reuses page objects without preserving a stale page order', () => {
    const messages = Array.from({ length: 40 }, (_unused, index) => ({
      ...createUserMessage(`user-${index}`, index),
      parts: [createTextPart(`text-${index}`, `user-${index}`, `prompt ${index}`)],
    }))
    const first = buildChatPageViewModel(messages)
    const reordered = buildChatPageViewModel([...messages.slice(20), ...messages.slice(0, 20)], first)

    expect(first.pageRecords).toHaveLength(2)
    expect(reordered.pageRecords[0]).toBe(first.pageRecords[1])
    expect(reordered.pageRecords[1]).toBe(first.pageRecords[0])
  })

  it('starts a new stable page after twenty visible messages', () => {
    const messages = Array.from({ length: 20 }, (_unused, index) => ({
      ...createUserMessage(`user-${index}`, index),
      parts: [createTextPart(`text-${index}`, `user-${index}`, `prompt ${index}`)],
    }))
    const first = buildChatPageViewModel(messages)

    const nextMessage = {
      ...createUserMessage('user-20', 20),
      parts: [createTextPart('text-20', 'user-20', 'prompt 20')],
    }
    const next = buildChatPageViewModel([...messages, nextMessage], first)

    expect(first.pageRecords).toHaveLength(1)
    expect(next.pageRecords).toHaveLength(2)
    expect(next.pageRecords[1]).toBe(first.pageRecords[0])
    expect(next.pageRecords[0].messageIds).toEqual(['user-20'])
  })

  it('splits an oversized assistant group at the page limit', () => {
    const longText = 'markdown '.repeat(3500)
    const messages = Array.from({ length: 26 }, (_unused, index) =>
      createAssistantMessage(
        `assistant-${index}`,
        [createTextPart(`text-${index}`, `assistant-${index}`, longText)],
        index,
        index + 1,
      ),
    )

    const viewModel = buildChatPageViewModel(messages)
    const appended = buildChatPageViewModel(
      [
        ...messages,
        createAssistantMessage('assistant-26', [createTextPart('text-26', 'assistant-26', longText)], 26, 27),
      ],
      viewModel,
    )

    expect(viewModel.pageRecords).toHaveLength(2)
    expect(viewModel.pageRecords.map(page => page.messageIds.length)).toEqual([6, 20])
    expect(viewModel.pageRecords[0].rows[0].continuesFromPrevious).toBe(true)
    expect(viewModel.pageRecords[1].rows[0].continuesToNext).toBe(true)
    expect(appended.pageRecords[0].rows[0].continuesFromPrevious).toBe(true)
  })

  it('keeps a growing streaming assistant in the current stable page', () => {
    const user = {
      ...createUserMessage('user-1', 1),
      parts: [createTextPart('user-text', 'user-1', 'prompt')],
    }
    const first = buildChatPageViewModel([user])
    const streaming = {
      ...createAssistantMessage('assistant-1', [createTextPart('assistant-text', 'assistant-1', 'hello')]),
      isStreaming: true,
    }

    const next = buildChatPageViewModel([user, streaming], first)
    const initial = buildChatPageViewModel([user, streaming])
    const grown = buildChatPageViewModel(
      [
        user,
        {
          ...streaming,
          parts: [createTextPart('assistant-text', 'assistant-1', 'hello '.repeat(10000))],
        },
      ],
      next,
    )

    expect(next.pageRecords).toHaveLength(1)
    expect(initial.pageRecords).toHaveLength(1)
    expect(next.pageRecords[0].messageIds).toEqual(['user-1', 'assistant-1'])
    expect(grown.pageRecords[0].key).toBe(next.pageRecords[0].key)
    expect(grown.pageRecords[0].messageIds).toEqual(next.pageRecords[0].messageIds)
  })

  it('keeps the existing assistant row key when appending another assistant', () => {
    const firstAssistant = createAssistantMessage(
      'assistant-1',
      [createTextPart('assistant-text-1', 'assistant-1', 'first answer')],
      1,
      2,
    )
    const first = buildChatPageViewModel([firstAssistant])
    const secondAssistant = {
      ...createAssistantMessage('assistant-2', [createTextPart('assistant-text-2', 'assistant-2', 'second answer')], 3),
      isStreaming: true,
    }

    const next = buildChatPageViewModel([firstAssistant, secondAssistant], first)

    expect(first.pageRecords[0].rows[0].key).toBe('row:assistant-1')
    expect(next.pageRecords[0].rows[0].key).toBe(first.pageRecords[0].rows[0].key)
    expect(next.pageRecords[0].rows[0].messageIds).toEqual(['assistant-1', 'assistant-2'])
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

describe('buildTurnLatestAssistantIdSet', () => {
  it('keeps only the latest visible assistant id per user turn', () => {
    const messages = [
      createUserMessage('user-1', 1000),
      createAssistantMessage('assistant-1', [], 1001, 1200),
      createAssistantMessage('assistant-2', [], 1201, 1500),
      createUserMessage('user-2', 2000),
      createAssistantMessage('assistant-3', [], 2001, 2600),
    ]
    // 需要包含 user 消息才能划分回合边界
    const latest = buildTurnLatestAssistantIdSet(messages)

    expect(latest.has('assistant-1')).toBe(false)
    expect(latest.has('assistant-2')).toBe(true)
    expect(latest.has('assistant-3')).toBe(true)
  })
})

describe('streaming virtual range helpers', () => {
  it('pins the last one or two timeline indexes while streaming', () => {
    expect(getStreamingHotIndexes(0, true)).toEqual([])
    expect(getStreamingHotIndexes(5, false)).toEqual([])
    expect(getStreamingHotIndexes(1, true)).toEqual([0])
    expect(getStreamingHotIndexes(5, true)).toEqual([3, 4])
  })

  it('merges pinned indexes into the virtual range without duplicates', () => {
    expect(mergeVirtualRangeIndexes([1, 2, 3], [], [])).toEqual([1, 2, 3])
    expect(mergeVirtualRangeIndexes([1, 2, 3], [8, 9], [3, 9])).toEqual([1, 2, 3, 8, 9])
  })
})

describe('getTimelineRowYClass', () => {
  it('keeps turn padding on user rows and process shells', () => {
    const user = { kind: 'message' as const, key: 'user-1', message: createUserMessage('user-1', 1) }
    const shell = {
      kind: 'process-shell' as const,
      key: 'process-shell:user-1',
      userMessageId: 'user-1',
      startedAt: 1,
      isActive: false,
      children: [],
    }
    expect(getTimelineRowYClass(user)).toBe('py-3')
    expect(getTimelineRowYClass(shell)).toBe('py-3')
  })

  it('tightens vertical padding between consecutive assistant rows', () => {
    const prev = {
      kind: 'message' as const,
      key: 'assistant-1',
      message: createAssistantMessage('assistant-1', [], 1, 2),
    }
    const current = {
      kind: 'message' as const,
      key: 'assistant-2',
      message: createAssistantMessage('assistant-2', [], 3, 4),
    }
    const next = {
      kind: 'message' as const,
      key: 'assistant-3',
      message: createAssistantMessage('assistant-3', [], 5, 6),
    }
    const user = { kind: 'message' as const, key: 'user-2', message: createUserMessage('user-2', 7) }

    expect(getTimelineRowYClass(current, prev, next)).toBe('py-1')
    expect(getTimelineRowYClass(current, user, next)).toBe('pt-3 pb-1')
    expect(getTimelineRowYClass(current, prev, user)).toBe('pt-1 pb-3')
    expect(getTimelineRowYClass(current, user, user)).toBe('py-3')
  })
})

describe('reuseProcessTimelineItems', () => {
  const hasProcess = (message: Message) => message.parts.some(p => p.type === 'tool' || p.type === 'reasoning')
  const hasFinal = (message: Message) => message.parts.some(p => p.type === 'text')

  it('keeps historical timeline item identity when only the last message streams', () => {
    const messages = [
      {
        ...createUserMessage('user-1', 1),
        parts: [createTextPart('user-text-1', 'user-1', 'prompt')],
      },
      createAssistantMessage('assistant-1', [createTextPart('text-1', 'assistant-1', 'old')], 2, 3),
      {
        ...createUserMessage('user-2', 4),
        parts: [createTextPart('user-text-2', 'user-2', 'next')],
      },
      createAssistantMessage('assistant-2', [createTextPart('text-2', 'assistant-2', 'hello')], 5, undefined),
    ]

    const first = buildProcessTimeline(messages, {
      turnDurationMap: new Map([['assistant-1', 1000]]),
      sessionIsStreaming: true,
      messageHasProcess: hasProcess,
      messageHasFinal: hasFinal,
    })

    const streaming = messages[messages.length - 1]
    const nextMessages = [
      ...messages.slice(0, -1),
      {
        ...streaming,
        parts: [{ ...streaming.parts[0], text: 'hello world' }],
      },
    ]
    const rebuilt = buildProcessTimeline(nextMessages, {
      turnDurationMap: new Map([['assistant-1', 1000]]),
      sessionIsStreaming: true,
      messageHasProcess: hasProcess,
      messageHasFinal: hasFinal,
    })
    const reused = reuseProcessTimelineItems(first, rebuilt)

    expect(reused.length).toBe(first.length)
    for (let i = 0; i < reused.length - 1; i++) {
      expect(reused[i]).toBe(first[i])
    }
    expect(reused.at(-1)).not.toBe(first.at(-1))
    expect(reused.at(-1)?.key).toBe(first.at(-1)?.key)
  })

  it('returns the previous array reference when nothing changed', () => {
    const messages = [
      {
        ...createUserMessage('user-1', 1),
        parts: [createTextPart('user-text-1', 'user-1', 'prompt')],
      },
      createAssistantMessage('assistant-1', [createTextPart('text-1', 'assistant-1', 'done')], 2, 3),
    ]
    const first = buildProcessTimeline(messages, {
      turnDurationMap: new Map([['assistant-1', 500]]),
      sessionIsStreaming: false,
      messageHasProcess: hasProcess,
      messageHasFinal: hasFinal,
    })
    const rebuilt = buildProcessTimeline(messages, {
      turnDurationMap: new Map([['assistant-1', 500]]),
      sessionIsStreaming: false,
      messageHasProcess: hasProcess,
      messageHasFinal: hasFinal,
    })
    expect(reuseProcessTimelineItems(first, rebuilt)).toBe(first)
  })
})

describe('buildProcessTimeline', () => {
  const hasProcess = (message: Message) => message.parts.some(p => p.type === 'tool' || p.type === 'reasoning')
  const hasFinal = (message: Message) => message.parts.some(p => p.type === 'text')

  it('delays empty Working shell until entry-ready gate opens', () => {
    const messages = [createUserMessage('user-1', 1000)]
    // ChatArea 会在 user 入场完成后再额外 delay，再把 id 放进 ready 集合
    const ready = new Set<string>()
    const early = buildProcessTimeline(messages, {
      turnDurationMap: new Map(),
      sessionIsStreaming: true,
      messageHasProcess: hasProcess,
      messageHasFinal: hasFinal,
      isUserEntryReady: id => ready.has(id),
    })
    expect(early).toHaveLength(1)
    expect(early[0]).toMatchObject({ kind: 'message', key: 'user-1' })

    ready.add('user-1')
    const after = buildProcessTimeline(messages, {
      turnDurationMap: new Map(),
      sessionIsStreaming: true,
      messageHasProcess: hasProcess,
      messageHasFinal: hasFinal,
      isUserEntryReady: id => ready.has(id),
    })
    expect(after).toHaveLength(2)
    expect(after[1]).toMatchObject({
      kind: 'process-shell',
      isActive: true,
      startedAt: 1000,
      children: [],
    })
  })

  it('shows Working shell immediately once any assistant content exists', () => {
    const mid = createAssistantMessage('assistant-1', [createToolPart('tool-1', 'assistant-1')], 1001)
    mid.isStreaming = true
    const messages = [createUserMessage('user-1', 1000), mid]
    const timeline = buildProcessTimeline(messages, {
      turnDurationMap: new Map(),
      sessionIsStreaming: true,
      messageHasProcess: hasProcess,
      messageHasFinal: hasFinal,
      // 用户入场未完成也不拦：有 assistant 就立刻挂
      isUserEntryReady: () => false,
    })
    const shell = timeline.find(item => item.kind === 'process-shell')
    expect(shell).toBeTruthy()
    if (shell?.kind === 'process-shell') {
      expect(shell.children.map(c => c.message.info.id)).toEqual(['assistant-1'])
    }
  })

  it('drops empty Working shell after abort when no assistant ever arrived', () => {
    const messages = [createUserMessage('user-1', 1000)]
    const timeline = buildProcessTimeline(messages, {
      turnDurationMap: new Map(),
      sessionIsStreaming: false,
      messageHasProcess: hasProcess,
      messageHasFinal: hasFinal,
    })

    expect(timeline).toHaveLength(1)
    expect(timeline[0]).toMatchObject({ kind: 'message', key: 'user-1' })
  })

  it('keeps only the earliest pending Working shell when a later user is queued', () => {
    // 第一轮仍 live，第二轮 user 已发出 → 只挂 user-1 的 Working，user-2 暂不挂空壳
    const mid = createAssistantMessage('assistant-1', [createToolPart('tool-1', 'assistant-1')], 1001)
    mid.isStreaming = true
    const messages = [createUserMessage('user-1', 1000), mid, createUserMessage('user-2', 2000)]
    const timeline = buildProcessTimeline(messages, {
      turnDurationMap: new Map(),
      sessionIsStreaming: true,
      messageHasProcess: hasProcess,
      messageHasFinal: hasFinal,
      isUserEntryReady: id => id === 'user-2',
    })

    const shells = timeline.filter(item => item.kind === 'process-shell')
    expect(shells).toHaveLength(1)
    expect(shells[0]).toMatchObject({
      kind: 'process-shell',
      isActive: true,
      userMessageId: 'user-1',
    })
    if (shells[0].kind === 'process-shell') {
      expect(shells[0].children.map(c => c.message.info.id)).toEqual(['assistant-1'])
    }
    // user-2 只作为消息出现，不挂 Working
    expect(timeline.some(i => i.kind === 'message' && i.key === 'user-2')).toBe(true)
  })

  it('only arms the earliest empty turn when multiple users are pending', () => {
    // 快速连发：两轮都还没 assistant → 只在最早 user 下挂 Working
    const messages = [createUserMessage('user-1', 1000), createUserMessage('user-2', 1500)]
    const ready = new Set(['user-1', 'user-2'])
    const timeline = buildProcessTimeline(messages, {
      turnDurationMap: new Map(),
      sessionIsStreaming: true,
      messageHasProcess: hasProcess,
      messageHasFinal: hasFinal,
      isUserEntryReady: id => ready.has(id),
    })

    const shells = timeline.filter(item => item.kind === 'process-shell')
    expect(shells).toHaveLength(1)
    expect(shells[0]).toMatchObject({
      kind: 'process-shell',
      isActive: true,
      userMessageId: 'user-1',
      children: [],
    })
    expect(timeline.filter(i => i.kind === 'message').map(i => i.key)).toEqual(['user-1', 'user-2'])
  })

  it('closes earlier turn when later turn gets SSE live, even if earlier still looks live', () => {
    // 关键竞态：前轮 completed 常晚到；后轮 live 一到，前轮立刻 Worked
    const earlierStillFlaggedLive = createAssistantMessage(
      'assistant-1',
      [createToolPart('tool-1', 'assistant-1')],
      1001,
    )
    earlierStillFlaggedLive.isStreaming = true
    const laterLive = createAssistantMessage('assistant-2', [createToolPart('tool-2', 'assistant-2')], 2001)
    laterLive.isStreaming = true
    const messages = [
      createUserMessage('user-1', 1000),
      earlierStillFlaggedLive,
      createUserMessage('user-2', 2000),
      laterLive,
    ]
    const timeline = buildProcessTimeline(messages, {
      turnDurationMap: new Map(),
      sessionIsStreaming: true,
      messageHasProcess: hasProcess,
      messageHasFinal: hasFinal,
    })

    const shells = timeline.filter(item => item.kind === 'process-shell')
    expect(shells).toHaveLength(2)
    expect(shells[0]).toMatchObject({ userMessageId: 'user-1', isActive: false })
    expect(shells[1]).toMatchObject({ userMessageId: 'user-2', isActive: true })
  })

  it('does not reopen a completed turn when session becomes busy before the next user lands', () => {
    // 发送瞬间：streaming 已 true，新 user 还没进列表 → 已 Worked 的回合不能闪回 Working
    const settled = createAssistantMessage(
      'assistant-1',
      [
        createToolPart('tool-1', 'assistant-1'),
        {
          id: 'text-1',
          sessionID: 'session-1',
          messageID: 'assistant-1',
          type: 'text',
          text: 'done',
        },
      ],
      1001,
      1500,
    )
    const messages = [createUserMessage('user-1', 1000), settled]
    const timeline = buildProcessTimeline(messages, {
      turnDurationMap: new Map([['assistant-1', 500]]),
      sessionIsStreaming: true,
      messageHasProcess: hasProcess,
      messageHasFinal: hasFinal,
    })
    expect(timeline.find(item => item.kind === 'process-shell')).toMatchObject({
      kind: 'process-shell',
      isActive: false,
    })
  })

  it('settles shell with process inside and final answer outside', () => {
    const processOnly = createAssistantMessage('assistant-1', [createToolPart('tool-1', 'assistant-1')], 1001, 1200)
    const finalAnswer = createAssistantMessage(
      'assistant-2',
      [
        createToolPart('tool-2', 'assistant-2'),
        {
          id: 'text-1',
          sessionID: 'session-1',
          messageID: 'assistant-2',
          type: 'text',
          text: 'done',
        },
      ],
      1201,
      1500,
    )
    const messages = [createUserMessage('user-1', 1000), processOnly, finalAnswer]
    const durationMap = buildTurnDurationMap(messages, messages)
    const timeline = buildProcessTimeline(messages, {
      turnDurationMap: durationMap,
      sessionIsStreaming: false,
      messageHasProcess: hasProcess,
      messageHasFinal: hasFinal,
    })

    const shell = timeline.find(item => item.kind === 'process-shell')
    expect(shell).toBeTruthy()
    if (shell?.kind !== 'process-shell') return
    expect(shell.isActive).toBe(false)
    expect(shell.durationMs).toBe(500)
    expect(shell.children.map(c => [c.message.info.id, c.processContentScope])).toEqual([
      ['assistant-1', 'inline'],
      ['assistant-2', 'process'],
    ])
    expect(shell.finalMessage?.info.id).toBe('assistant-2')
  })

  it('does not reopen an aborted empty turn when streaming starts before the next user lands', () => {
    // 用户发了第一条、打断、再发：streaming 先 true，新 user 未入列，最新仍是空的 user-1
    // 若 isUserEntryReady(user-1) 仍 true（上次 Working 闸门残留），旧空壳会瞬间闪一下
    const messages = [createUserMessage('user-1', 1000)]
    const staleReady = new Set(['user-1'])
    const timeline = buildProcessTimeline(messages, {
      turnDurationMap: new Map(),
      sessionIsStreaming: true,
      messageHasProcess: hasProcess,
      messageHasFinal: hasFinal,
      // 模拟 idle 后闸门已清空：旧 user 不应再 armed
      isUserEntryReady: id => staleReady.has(id) && false,
    })
    expect(timeline).toHaveLength(1)
    expect(timeline[0]).toMatchObject({ kind: 'message', key: 'user-1' })

    // 闸门未清空时的错误形态（回归文档）：ready 仍在 → 会挂空壳
    const leaked = buildProcessTimeline(messages, {
      turnDurationMap: new Map(),
      sessionIsStreaming: true,
      messageHasProcess: hasProcess,
      messageHasFinal: hasFinal,
      isUserEntryReady: id => staleReady.has(id),
    })
    // 有 ready 时仍允许挂（当前发送周期内合法）；关键是 ChatArea idle 时清空 ready
    // 这里只断言：无 ready 时绝不挂
    expect(timeline.some(i => i.kind === 'process-shell')).toBe(false)
    expect(leaked.some(i => i.kind === 'process-shell')).toBe(true)
  })

  it('does not wrap pure final answer turns in an empty process shell', () => {
    const plain = createAssistantMessage(
      'assistant-1',
      [
        {
          id: 'text-1',
          sessionID: 'session-1',
          messageID: 'assistant-1',
          type: 'text',
          text: 'hello',
        },
      ],
      1001,
      1100,
    )
    const messages = [createUserMessage('user-1', 1000), plain]
    const timeline = buildProcessTimeline(messages, {
      turnDurationMap: new Map([['assistant-1', 100]]),
      sessionIsStreaming: false,
      messageHasProcess: hasProcess,
      messageHasFinal: hasFinal,
    })

    expect(timeline.map(item => item.kind)).toEqual(['message', 'message'])
    expect(timeline[1]).toMatchObject({ kind: 'message', key: 'assistant-1' })
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

  it('uses twenty visible messages as the default page size', () => {
    const messages = Array.from({ length: 25 }, (_unused, index) => createUserMessage(`user-${index}`, index))

    const pages = buildChatPages(messages)

    expect(pages).toHaveLength(2)
    expect(pages.map(page => page.messageIds.length)).toEqual([20, 5])
  })

  it('uses render weight only as an extreme page limit', () => {
    const largeMarkdown = Array.from(
      { length: 12 },
      (_unused, index) => `\`\`\`ts\nconst value${index} = ${index}\n\`\`\``,
    ).join('\n\n')
    const messages = [
      createUserMessage('user-1', 1),
      createAssistantMessage('assistant-heavy', [createTextPart('text-heavy', 'assistant-heavy', largeMarkdown)], 2, 3),
      createUserMessage('user-2', 4),
    ]

    const pages = buildChatPages(messages, 20, 12)

    expect(pages).toHaveLength(3)
    expect(pages[1].messageIds).toEqual(['assistant-heavy'])
    expect(pages[1].renderWeight).toBeGreaterThan(12)
  })

  it('counts blank lines before fenced code independently of indentation', () => {
    const suffix = '```ts\nconst value = 1\n```'
    const withoutIndent = createAssistantMessage('assistant-plain-lines', [
      createTextPart('text-plain-lines', 'assistant-plain-lines', `${'\n'.repeat(100)}${suffix}`),
    ])
    const withIndent = createAssistantMessage('assistant-indented-lines', [
      createTextPart('text-indented-lines', 'assistant-indented-lines', `${' \n'.repeat(100)}${suffix}`),
    ])

    expect(estimateMessageRenderWeight(withIndent)).toBe(estimateMessageRenderWeight(withoutIndent))
  })

  it('splits an oversized assistant group without breaking its visual continuation', () => {
    const messages = Array.from({ length: 8 }, (_unused, index) =>
      createAssistantMessage(`assistant-${index}`, [], index, index + 1),
    )

    const pages = buildChatPages(messages, 6)

    expect(pages).toHaveLength(2)
    expect(pages[0].messageIds).toEqual(['assistant-6', 'assistant-7'])
    expect(pages[1].messageIds).toEqual(messages.slice(0, 6).map(message => message.info.id))
    expect(pages[0].rows[0].continuesFromPrevious).toBe(true)
    expect(pages[1].rows[0].continuesToNext).toBe(true)
    const unsplitHeight = buildChatPages(messages.slice(0, 6), 6)[0].rows[0].estimatedHeight
    expect(pages[0].rows[0].estimatedHeight).toBe(buildChatPages(messages.slice(6), 6)[0].rows[0].estimatedHeight - 4)
    expect(pages[1].rows[0].estimatedHeight).toBe(unsplitHeight - 12)
  })
})

describe('computeExpandedPageRange', () => {
  it('preloads pages within two viewports around the visible range', () => {
    const pages = [
      { key: 'page-0', rows: [], messageIds: ['m0'], estimatedHeight: 1000 },
      { key: 'page-1', rows: [], messageIds: ['m1'], estimatedHeight: 1000 },
      { key: 'page-2', rows: [], messageIds: ['m2'], estimatedHeight: 1000 },
      { key: 'page-3', rows: [], messageIds: ['m3'], estimatedHeight: 1000 },
    ]

    const range = computeExpandedPageRange({
      pages,
      measuredPageHeights: {},
      scrollOffsetFromBottom: 1450,
      viewportHeight: 300,
    })

    expect(range).toEqual({ startIndex: 0, endIndex: 2 })
  })

  it('keeps the next coarse page mounted even when the current page is taller than pixel overscan', () => {
    const pages = [
      { key: 'page-0', rows: [], messageIds: ['m0'], estimatedHeight: 8286 },
      { key: 'page-1', rows: [], messageIds: ['m1'], estimatedHeight: 3664 },
    ]

    const range = computeExpandedPageRange({
      pages,
      measuredPageHeights: { 'page-0': 8286 },
      scrollOffsetFromBottom: 0,
      viewportHeight: 900,
      adjacentPageCount: 1,
      adjacentPageMaxSourceHeight: 10800,
    })

    expect(range).toEqual({ startIndex: 0, endIndex: 1 })
  })

  it('does not preload an adjacent page from an extremely tall source page', () => {
    const pages = [
      { key: 'page-0', rows: [], messageIds: ['m0'], estimatedHeight: 4000 },
      { key: 'page-1', rows: [], messageIds: ['m1'], estimatedHeight: 4000 },
    ]

    const range = computeExpandedPageRange({
      pages,
      measuredPageHeights: { 'page-0': 78312 },
      scrollOffsetFromBottom: 0,
      viewportHeight: 900,
      adjacentPageCount: 1,
      adjacentPageMaxSourceHeight: 10800,
    })

    expect(range).toEqual({ startIndex: 0, endIndex: 0 })
  })

  it('keeps adjacent pages mounted near a page boundary', () => {
    const pages = [
      { key: 'page-0', rows: [], messageIds: ['m0'], estimatedHeight: 1000 },
      { key: 'page-1', rows: [], messageIds: ['m1'], estimatedHeight: 1000 },
      { key: 'page-2', rows: [], messageIds: ['m2'], estimatedHeight: 1000 },
    ]

    const range = computeExpandedPageRange({
      pages,
      measuredPageHeights: {},
      scrollOffsetFromBottom: 850,
      viewportHeight: 300,
    })

    expect(range).toEqual({ startIndex: 0, endIndex: 1 })
  })

  it('does not mount adjacent pages in the middle of a tall page', () => {
    const pages = [
      { key: 'page-0', rows: [], messageIds: ['m0'], estimatedHeight: 2000 },
      { key: 'page-1', rows: [], messageIds: ['m1'], estimatedHeight: 2000 },
      { key: 'page-2', rows: [], messageIds: ['m2'], estimatedHeight: 2000 },
    ]

    const range = computeExpandedPageRange({
      pages,
      measuredPageHeights: {},
      scrollOffsetFromBottom: 1000,
      viewportHeight: 300,
    })

    expect(range).toEqual({ startIndex: 0, endIndex: 0 })
  })

  it('treats the overscan end as an exclusive boundary', () => {
    const pages = [
      { key: 'page-0', rows: [], messageIds: ['m0'], estimatedHeight: 400 },
      { key: 'page-1', rows: [], messageIds: ['m1'], estimatedHeight: 400 },
    ]

    const range = computeExpandedPageRange({
      pages,
      measuredPageHeights: {},
      scrollOffsetFromBottom: 0,
      viewportHeight: 200,
      overscanPx: 200,
    })

    expect(range).toEqual({ startIndex: 0, endIndex: 0 })
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

    expect(range).toEqual({ startIndex: 0, endIndex: 1 })
    expect(Array.from(buildExpandedPageSelection(range, 3))).toEqual([0, 1, 3])
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

describe('lightweight render selection', () => {
  const pages = [
    { key: 'page-0', rows: [], messageIds: ['m0'], estimatedHeight: 100 },
    { key: 'page-1', rows: [], messageIds: ['m1'], estimatedHeight: 110 },
    { key: 'page-2', rows: [], messageIds: ['m2'], estimatedHeight: 120 },
    { key: 'page-3', rows: [], messageIds: ['m3'], estimatedHeight: 130 },
    { key: 'page-4', rows: [], messageIds: ['m4'], estimatedHeight: 140 },
  ]

  it('expands explicit page keys without widening unrelated pages', () => {
    const selection = expandSelectionWithPageKeys({
      pages,
      expandedPageSelection: buildExpandedPageSelection({ startIndex: 1, endIndex: 1 }),
      pageKeys: new Set(['page-4']),
    })

    expect(Array.from(selection)).toEqual([1, 4])
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
    const nextPages = reconcileStableChatPages({
      currentPages,
      nextMessages,
      allocateKey: alloc,
      pageMessageCount: 2,
    })

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
    const nextPages = reconcileStableChatPages({
      currentPages,
      nextMessages,
      allocateKey: alloc,
      pageMessageCount: 2,
    })

    // 老的第二页 key 应该保住，避免整段历史一起重切
    expect(nextPages[nextPages.length - 1].key).toBe(currentPages[currentPages.length - 1].key)
  })

  it('keeps assistant continuation markers when an append crosses a page boundary', () => {
    const currentMessages = Array.from({ length: 8 }, (_unused, index) =>
      createAssistantMessage(`assistant-${index}`, [], index, index + 1),
    )
    const currentPages = reconcileStableChatPages({
      currentPages: [],
      nextMessages: currentMessages,
      allocateKey: alloc,
      pageMessageCount: 6,
    })
    const nextMessages = [
      ...currentMessages,
      ...Array.from({ length: 5 }, (_unused, index) =>
        createAssistantMessage(`assistant-${index + 8}`, [], index + 8, index + 9),
      ),
    ]

    const nextPages = reconcileStableChatPages({
      currentPages,
      nextMessages,
      allocateKey: alloc,
      pageMessageCount: 6,
    })

    expect(nextPages).toHaveLength(3)
    expect(nextPages[0].rows[0].continuesFromPrevious).toBe(true)
    expect(nextPages[1].rows[0].continuesFromPrevious).toBe(true)
    expect(nextPages[1].rows[0].continuesToNext).toBe(true)
    expect(nextPages[2].rows[0].continuesToNext).toBe(true)
  })

  it('keeps assistant continuation markers when prepending older history', () => {
    const currentMessages = Array.from({ length: 8 }, (_unused, index) =>
      createAssistantMessage(`assistant-${index + 2}`, [], index + 2, index + 3),
    )
    const currentPages = reconcileStableChatPages({
      currentPages: [],
      nextMessages: currentMessages,
      allocateKey: alloc,
      pageMessageCount: 6,
    })
    const olderMessages = [
      createAssistantMessage('assistant-0', [], 0, 1),
      createAssistantMessage('assistant-1', [], 1, 2),
    ]

    const nextPages = reconcileStableChatPages({
      currentPages,
      nextMessages: [...olderMessages, ...currentMessages],
      allocateKey: alloc,
      pageMessageCount: 6,
    })

    expect(nextPages).toHaveLength(3)
    // 已有页引用保持不变；continuation 只标在新 prepend 的老页上
    expect(nextPages[0]).toBe(currentPages[0])
    expect(nextPages[1]).toBe(currentPages[1])
    expect(nextPages[2].rows[0].continuesToNext).toBe(true)
  })

  it('does not rebuild existing pages when older turns are prepended', () => {
    const currentMessages = Array.from({ length: 8 }, (_unused, index) => [
      createUserMessage(`user-${index + 2}`, (index + 2) * 2),
      createAssistantMessage(`assistant-${index + 2}`, [], (index + 2) * 2 + 1, (index + 2) * 2 + 2),
    ]).flat()
    const currentPages = reconcileStableChatPages({
      currentPages: [],
      nextMessages: currentMessages,
      allocateKey: alloc,
      pageMessageCount: 4,
    })
    const olderMessages = [
      createUserMessage('user-0', 0),
      createAssistantMessage('assistant-0', [], 1, 2),
      createUserMessage('user-1', 3),
      createAssistantMessage('assistant-1', [], 4, 5),
    ]

    const nextPages = reconcileStableChatPages({
      currentPages,
      nextMessages: [...olderMessages, ...currentMessages],
      allocateKey: alloc,
      pageMessageCount: 4,
    })

    expect(nextPages.length).toBeGreaterThan(currentPages.length)
    expect(nextPages.slice(0, currentPages.length).map(page => page.key)).toEqual(currentPages.map(page => page.key))
    for (let index = 0; index < currentPages.length; index++) {
      expect(nextPages[index]).toBe(currentPages[index])
    }
  })

  it('keeps existing page object identity through view model when older turns are prepended', () => {
    const currentMessages = Array.from({ length: 8 }, (_unused, index) => [
      {
        ...createUserMessage(`user-${index + 2}`, (index + 2) * 2),
        parts: [createTextPart(`user-text-${index + 2}`, `user-${index + 2}`, `prompt ${index + 2}`)],
      },
      createAssistantMessage(
        `assistant-${index + 2}`,
        [createTextPart(`text-${index + 2}`, `assistant-${index + 2}`, `answer ${index + 2}`)],
        (index + 2) * 2 + 1,
        (index + 2) * 2 + 2,
      ),
    ]).flat()
    const previous = buildChatPageViewModel(currentMessages)
    const olderMessages = [
      {
        ...createUserMessage('user-0', 0),
        parts: [createTextPart('user-text-0', 'user-0', 'older prompt 0')],
      },
      createAssistantMessage('assistant-0', [createTextPart('text-0', 'assistant-0', 'older answer 0')], 1, 2),
      {
        ...createUserMessage('user-1', 3),
        parts: [createTextPart('user-text-1', 'user-1', 'older prompt 1')],
      },
      createAssistantMessage('assistant-1', [createTextPart('text-1', 'assistant-1', 'older answer 1')], 4, 5),
    ]

    const next = buildChatPageViewModel([...olderMessages, ...currentMessages], previous)

    expect(next.pageRecords.length).toBeGreaterThan(previous.pageRecords.length)
    for (const page of previous.pageRecords) {
      expect(next.pageRecords.find(candidate => candidate.key === page.key)).toBe(page)
    }
    // 旧消息对象引用保持，避免下游整页 refresh
    for (const message of previous.visibleMessages) {
      expect(next.visibleMessages.find(candidate => candidate.info.id === message.info.id)).toBe(message)
    }
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
