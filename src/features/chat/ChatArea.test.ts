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
  buildFlatTimeline,
} from './chatPageModel'
import { getStreamingHotIndexes, getTimelineRowYClass, mergeVirtualRangeIndexes } from './chatAreaUtils'
import { buildVisibleMessageEntries, getVisibleMessageForkTargetId } from './chatAreaVisibility'
import { buildChatPageViewModel } from './useChatPageViewModel'
import type { AssistantContent, AssistantMessage, SessionMessageInfo, UserMessage } from '../../types/api/message'
import { isAssistantMessage, isFailedIdleMessage, idleMessageError } from '../../types/api/message'

/** 助手消息的 content（非助手返回空数组，测试断言里方便用） */
function contentOf(message: SessionMessageInfo): AssistantContent[] {
  return isAssistantMessage(message) ? message.content : []
}

/** 断言辅助：把联合收窄成助手消息（不是助手则直接抛） */
function assistantOf(message: SessionMessageInfo): AssistantMessage {
  if (!isAssistantMessage(message)) throw new Error('expected assistant message')
  return message
}

/** 旧视图模型的 `markStreaming(message)`：清掉 completed 即「仍在流式」 */
function markStreaming(message: SessionMessageInfo): void {
  if (isAssistantMessage(message)) message.time.completed = undefined
}

function createUserMessage(id: string, created: number, text = ''): UserMessage {
  return {
    id,
    type: 'user',
    time: { created },
    text,
  }
}

function createAssistantMessage(
  id: string,
  content: AssistantContent[],
  created = 1,
  completed?: number,
  error?: AssistantMessage['error'],
): AssistantMessage {
  return {
    id,
    type: 'assistant',
    agent: 'build',
    model: { id: 'model-1', providerID: 'provider-1' },
    content,
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: completed == null ? { created } : { created, completed },
    error,
  }
}

/** 参数沿用旧的 part 工厂签名，返回值改成原生 content 片段 */
function createToolPart(id: string, _messageID: string): AssistantContent {
  return {
    type: 'tool',
    id,
    name: 'bash',
    state: {
      status: 'completed',
      input: { command: 'pwd' },
      content: [{ type: 'text', text: '/workspace' }],
      metadata: {},
    },
    time: { created: 1, ran: 1, completed: 2 },
  }
}

function createTextPart(_id: string, _messageID: string, text: string): AssistantContent {
  return { type: 'text', text }
}

describe('buildVisibleMessageEntries', () => {
  it('keeps failed idle markers visible (session-level error must render)', () => {
    // pre-promotion failure：只有 user + 失败 idle 标记，过滤掉它错误就永远不渲染
    const failedIdle = {
      id: 'idle-1',
      type: 'idle',
      outcome: 'failed',
      error: { type: 'provider.no-route', message: 'Model unavailable' },
      time: { created: 2 },
    } as SessionMessageInfo
    const entries = buildVisibleMessageEntries([createUserMessage('user-1', 1, '你好'), failedIdle])

    expect(entries.some(e => e.message.id === 'idle-1')).toBe(true)
  })

  it('hides succeeded / interrupted idle markers', () => {
    const okIdle = { id: 'idle-ok', type: 'idle', outcome: 'succeeded', time: { created: 2 } } as SessionMessageInfo
    const abortedIdle = {
      id: 'idle-abort',
      type: 'idle',
      outcome: 'interrupted',
      time: { created: 3 },
    } as SessionMessageInfo
    const entries = buildVisibleMessageEntries([createUserMessage('user-1', 1, '你好'), okIdle, abortedIdle])

    expect(entries.some(e => e.message.id === 'idle-ok')).toBe(false)
    expect(entries.some(e => e.message.id === 'idle-abort')).toBe(false)
  })

  it('keeps timeline notices visible (switch records / system / skill / synthetic)', () => {
    const notices = [
      { id: 'agent-switch', type: 'agent-switched', agent: 'plan', time: { created: 2 } },
      {
        id: 'model-switch',
        type: 'model-switched',
        model: { providerID: 'openai', id: 'gpt-5' },
        time: { created: 3 },
      },
      { id: 'skill', type: 'skill', skill: 'pdf', name: 'PDF', text: '', time: { created: 4 } },
      {
        id: 'system',
        type: 'system',
        text: 'x',
        description: 'Instructions updated: AGENTS.md',
        time: { created: 5 },
      },
      { id: 'synthetic', type: 'synthetic', text: 'ctx', description: 'Explore finished', time: { created: 6 } },
      // 纯注入上下文没有 description：默认不占行（官方 isNotice 同款）
      { id: 'synthetic-context', type: 'synthetic', text: 'raw context', time: { created: 7 } },
      // 但错误状态必须露出
      {
        id: 'synthetic-error',
        type: 'synthetic',
        text: 'failed',
        metadata: { state: 'error' },
        time: { created: 8 },
      },
    ] as SessionMessageInfo[]

    const entries = buildVisibleMessageEntries([createUserMessage('user-1', 1, '你好'), ...notices], {
      showNotices: true,
    })
    const ids = entries.map(entry => entry.message.id)

    expect(ids).toEqual(
      expect.arrayContaining(['agent-switch', 'model-switch', 'skill', 'system', 'synthetic', 'synthetic-error']),
    )
    expect(ids).not.toContain('synthetic-context')
  })

  it('hides timeline notices by default but keeps synthetic failures', () => {
    const entries = buildVisibleMessageEntries([
      createUserMessage('user-1', 1, '你好'),
      { id: 'agent-switch', type: 'agent-switched', agent: 'plan', time: { created: 2 } } as SessionMessageInfo,
      { id: 'skill', type: 'skill', skill: 'pdf', name: 'PDF', text: '', time: { created: 3 } } as SessionMessageInfo,
      {
        id: 'synthetic-error',
        type: 'synthetic',
        text: 'failed',
        metadata: { state: 'error' },
        time: { created: 4 },
      } as SessionMessageInfo,
    ])

    // 普通提示默认关；错误是失败唯一记录，必须无条件露出
    expect(entries.map(entry => entry.message.id)).toEqual(['user-1', 'synthetic-error'])
  })

  it('keeps source ids for merged assistant tool messages', () => {
    const first = createAssistantMessage('assistant-1', [createToolPart('tool-1', 'assistant-1')])
    const second = createAssistantMessage('assistant-2', [createToolPart('tool-2', 'assistant-2')])

    const entries = buildVisibleMessageEntries([first, second])

    expect(entries).toHaveLength(1)
    expect(entries[0].sourceIds).toEqual(['assistant-1', 'assistant-2'])
    expect(contentOf(entries[0].message)).toHaveLength(2)
  })

  it('merges when first message ends with tool followed by empty reasoning', () => {
    const emptyReasoning: AssistantContent = { type: 'reasoning', text: '' }
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

    expect(previousEntry.message.id).toBe('assistant-1')
    expect(nextEntry.message.id).toBe('assistant-older')
    expect(getVisibleMessageForkTargetId(previousEntry)).toBe('assistant-2')
    expect(getVisibleMessageForkTargetId(nextEntry)).toBe('assistant-2')
  })

  it('stabilizes merged visible message id when older tool history is prepended', () => {
    const first = createAssistantMessage('assistant-1', [createToolPart('tool-1', 'assistant-1')])
    const second = createAssistantMessage('assistant-2', [createToolPart('tool-2', 'assistant-2')])
    const previous = buildChatPageViewModel([first, second])
    const older = createAssistantMessage('assistant-older', [createToolPart('tool-older', 'assistant-older')])
    const next = buildChatPageViewModel([older, first, second], previous)

    expect(previous.visibleMessages[0].id).toBe('assistant-1')
    expect(next.visibleMessages[0].id).toBe('assistant-1')
    expect(next.visibleMessageEntries[0].sourceIds).toEqual(['assistant-older', 'assistant-1', 'assistant-2'])
    expect(contentOf(next.visibleMessages[0])).toHaveLength(3)
    expect(next.pageRecords.map(page => page.key)).toEqual(previous.pageRecords.map(page => page.key))
  })

  it('keeps aborted assistant messages that already have renderable parts', () => {
    const message = createAssistantMessage(
      'assistant-aborted-with-tool',
      [createToolPart('tool-1', 'assistant-aborted-with-tool')],
      1,
      2,
      { type: 'MessageAbortedError', message: 'Aborted' },
    )

    const entries = buildVisibleMessageEntries([message])

    expect(entries).toHaveLength(1)
    expect(entries[0].message.id).toBe('assistant-aborted-with-tool')
  })

  it('hides aborted assistant messages without renderable parts', () => {
    const emptyReasoning: AssistantContent = { type: 'reasoning', text: '' }
    const message = createAssistantMessage('assistant-empty-abort', [emptyReasoning], 1, 2, {
      type: 'MessageAbortedError',
      message: 'Aborted',
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
        text: `prompt ${index}`,
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
    const nextMessages: SessionMessageInfo[] = [
      ...messages.slice(0, -1),
      {
        ...assistantOf(streamingMessage),
        content: [{ type: 'text', text: 'hello world' }],
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
        text: `prompt ${index}`,
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
        text: '# large markdown prompt',
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
        text: `prompt ${index}`,
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
        text: `older prompt ${index}`,
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
      text: `prompt ${index}`,
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
      text: `prompt ${index}`,
    }))
    const first = buildChatPageViewModel(messages)

    const nextMessage = {
      ...createUserMessage('user-20', 20),
      text: 'prompt 20',
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
      text: 'prompt',
    }
    const first = buildChatPageViewModel([user])
    const streaming = {
      ...createAssistantMessage('assistant-1', [createTextPart('assistant-text', 'assistant-1', 'hello')]),
    }

    const next = buildChatPageViewModel([user, streaming], first)
    const initial = buildChatPageViewModel([user, streaming])
    const grown = buildChatPageViewModel(
      [
        user,
        {
          ...streaming,
          content: [{ type: 'text', text: 'hello '.repeat(10000) }],
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
  const hasProcess = (message: SessionMessageInfo) =>
    contentOf(message).some(p => p.type === 'tool' || p.type === 'reasoning')
  const hasFinal = (message: SessionMessageInfo) => contentOf(message).some(p => p.type === 'text')

  it('keeps historical timeline item identity when only the last message streams', () => {
    const messages = [
      {
        ...createUserMessage('user-1', 1),
        text: 'prompt',
      },
      createAssistantMessage('assistant-1', [createTextPart('text-1', 'assistant-1', 'old')], 2, 3),
      {
        ...createUserMessage('user-2', 4),
        text: 'next',
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
    const nextMessages: SessionMessageInfo[] = [
      ...messages.slice(0, -1),
      {
        ...assistantOf(streaming),
        content: [{ type: 'text', text: 'hello world' }],
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
        text: 'prompt',
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
  const hasProcess = (message: SessionMessageInfo) =>
    contentOf(message).some(p => p.type === 'tool' || p.type === 'reasoning')
  const hasFinal = (message: SessionMessageInfo) => contentOf(message).some(p => p.type === 'text')

  const compactionMessage = (
    id: string,
    created: number,
    status: 'running' | 'completed' = 'completed',
  ): SessionMessageInfo =>
    ({
      id,
      type: 'compaction',
      status,
      reason: 'auto',
      summary: status === 'running' ? '' : '压缩完成',
      time: { created },
    }) as SessionMessageInfo

  const timelineOf = (
    messages: SessionMessageInfo[],
    options: { sessionIsStreaming?: boolean; isUserEntryReady?: (id: string) => boolean; turnDiff?: boolean } = {},
  ) =>
    buildProcessTimeline(messages, {
      turnDurationMap: new Map(),
      sessionIsStreaming: options.sessionIsStreaming ?? false,
      messageHasProcess: hasProcess,
      messageHasFinal: hasFinal,
      isUserEntryReady: options.isUserEntryReady,
      turnDiff: options.turnDiff,
    })

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
    markStreaming(mid)
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
      expect(shell.children.map(c => c.message.id)).toEqual(['assistant-1'])
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

  it('renders a failed idle marker as an error item (pre-promotion failure)', () => {
    // 会话级失败：prompt 没能提升成 assistant 工作，只剩一条带 error 的失败 idle 标记。
    // 不渲染它，错误就永远不可见（官方 session-ui projection.ts 的 isFailedIdle）。
    const failedIdle = {
      id: 'idle-1',
      type: 'idle',
      outcome: 'failed',
      error: { type: 'provider.auth', message: 'Invalid API key' },
      time: { created: 1001 },
    } as SessionMessageInfo
    const messages = [createUserMessage('user-1', 1000), failedIdle]
    const timeline = buildProcessTimeline(messages, {
      turnDurationMap: new Map(),
      sessionIsStreaming: false,
      messageHasProcess: hasProcess,
      messageHasFinal: hasFinal,
    })

    const errorItem = timeline.find(item => item.kind === 'message' && item.key === 'idle-1')
    expect(errorItem).toBeTruthy()
    if (errorItem?.kind === 'message') {
      expect(isFailedIdleMessage(errorItem.message)).toBe(true)
      expect(idleMessageError(errorItem.message)).toMatchObject({ type: 'provider.auth' })
    }
  })

  it('keeps notices outside the process shell, before/after by position', () => {
    const agentSwitch = {
      id: 'agent-switch',
      type: 'agent-switched',
      agent: 'plan',
      time: { created: 1000 },
    } as SessionMessageInfo
    const assistant = createAssistantMessage('assistant-1', [createToolPart('tool-1', 'assistant-1')], 1001, 1002)
    const skill = {
      id: 'skill-1',
      type: 'skill',
      skill: 'pdf',
      name: 'PDF',
      text: '',
      time: { created: 1003 },
    } as SessionMessageInfo
    const messages = [createUserMessage('user-1', 1000), agentSwitch, assistant, skill]
    const timeline = buildProcessTimeline(messages, {
      turnDurationMap: new Map(),
      sessionIsStreaming: false,
      messageHasProcess: hasProcess,
      messageHasFinal: hasFinal,
    })

    expect(timeline.map(item => item.key)).toEqual(['user-1', 'agent-switch', 'process-shell:user-1', 'skill-1'])
  })

  it('renders a compaction message as its own timeline row', () => {
    // 回归：compaction 既不是 assistant 也不是 notice，早先被 timeline 构建直接跳过，
    // 导致服务端明明压缩了、UI 刷新也看不到任何压缩记录。
    const before = createAssistantMessage('assistant-before', [createToolPart('tool-1', 'assistant-before')], 1001, 1002)
    const compaction = {
      id: 'compaction-1',
      type: 'compaction',
      status: 'completed',
      reason: 'manual',
      summary: '压缩完成',
      time: { created: 1003 },
    } as SessionMessageInfo
    const messages = [createUserMessage('user-1', 1000), before, compaction, createUserMessage('user-2', 1004)]
    const timeline = buildProcessTimeline(messages, {
      turnDurationMap: new Map(),
      sessionIsStreaming: false,
      messageHasProcess: hasProcess,
      messageHasFinal: hasFinal,
    })

    const compactionItem = timeline.find(item => item.key === 'compaction-1')
    expect(compactionItem).toMatchObject({ kind: 'message', key: 'compaction-1' })
    // 压缩行独立，不塞进上一回合的过程壳
    const shell = timeline.find(item => item.kind === 'process-shell')
    if (shell?.kind === 'process-shell') {
      expect(shell.children.some(child => child.message.id === 'compaction-1')).toBe(false)
    }
  })

  it('压缩打断回合后，压缩前的过程壳不再保持 Working，续写重新挂壳', () => {
    // 回归 #191：压缩后的续写曾经被时间线提前到最前面（看起来落进了压缩前的消息里）；
    // 压缩只切分过程，后续输出仍然要按过程壳分组，不能一路平铺。
    const messages = [
      createUserMessage('user-1', 1000),
      createAssistantMessage('assistant-before', [createToolPart('tool-1', 'assistant-before')], 1001, 1002),
      compactionMessage('compaction-1', 1003),
      createAssistantMessage('assistant-after', [createToolPart('tool-2', 'assistant-after')], 1004),
    ]
    const timeline = timelineOf(messages, { sessionIsStreaming: true })

    expect(timeline.map(item => item.key)).toEqual([
      'user-1',
      'process-shell:user-1',
      'compaction-1',
      'process-shell:assistant-after',
    ])
    const before = timeline.find(item => item.key === 'process-shell:user-1')
    expect(before?.kind === 'process-shell' && before.isActive).toBe(false)
    const continuation = timeline.find(item => item.key === 'process-shell:assistant-after')
    expect(continuation?.kind === 'process-shell' && continuation.isActive).toBe(true)
  })

  it('压缩前还没有助手输出时，不留下空的 Working 壳', () => {
    const messages = [createUserMessage('user-1', 1000), compactionMessage('compaction-1', 1001, 'running')]
    const timeline = timelineOf(messages, { sessionIsStreaming: true, isUserEntryReady: () => true })

    expect(timeline.map(item => item.key)).toEqual(['user-1', 'compaction-1'])
  })

  it('连续两次压缩：每一段续写都重新挂过程壳', () => {
    const messages = [
      createUserMessage('user-1', 1000),
      createAssistantMessage('assistant-1', [createToolPart('tool-1', 'assistant-1')], 1001, 1002),
      compactionMessage('compaction-1', 1003),
      createAssistantMessage('assistant-2', [createToolPart('tool-2', 'assistant-2')], 1004, 1005),
      compactionMessage('compaction-2', 1006),
      createAssistantMessage('assistant-3', [createToolPart('tool-3', 'assistant-3')], 1007),
    ]

    expect(timelineOf(messages, { sessionIsStreaming: true }).map(item => item.key)).toEqual([
      'user-1',
      'process-shell:user-1',
      'compaction-1',
      'process-shell:assistant-2',
      'compaction-2',
      'process-shell:assistant-3',
    ])
  })

  it('页首没有 user 的历史续段仍然平铺，提示行保持原位置', () => {
    const notice = {
      id: 'agent-switch',
      type: 'agent-switched',
      agent: 'plan',
      time: { created: 1003 },
    } as SessionMessageInfo
    const messages = [
      createAssistantMessage('assistant-1', [createToolPart('tool-1', 'assistant-1')], 1001, 1002),
      notice,
      createAssistantMessage('assistant-2', [createToolPart('tool-2', 'assistant-2')], 1004, 1005),
    ]

    expect(timelineOf(messages).map(item => item.key)).toEqual(['assistant-1', 'agent-switch', 'assistant-2'])
  })

  it('回合文件变更跨压缩聚合到最后一个续写段', () => {
    const before = createAssistantMessage('assistant-1', [createToolPart('tool-1', 'assistant-1')], 1001, 1002)
    before.snapshot = { files: ['src/a.ts'] }
    const after = createAssistantMessage('assistant-2', [createToolPart('tool-2', 'assistant-2')], 1004, 1005)
    after.snapshot = { files: ['src/b.ts', 'src/a.ts'] }
    const messages = [createUserMessage('user-1', 1000), before, compactionMessage('compaction-1', 1003), after]

    const timeline = timelineOf(messages, { turnDiff: true })
    const userShell = timeline.find(item => item.key === 'process-shell:user-1')
    // 文件变更行不能落在压缩行前面
    expect(userShell?.kind === 'process-shell' && userShell.turnDiff).toBeUndefined()
    const lastSegment = timeline.find(item => item.key === 'process-shell:assistant-2')
    expect(lastSegment?.kind === 'process-shell' && lastSegment.turnDiff).toEqual({
      from: 'user-1',
      files: ['src/a.ts', 'src/b.ts'],
    })
  })

  it('回合没结束前不提前显示文件变更', () => {
    const before = createAssistantMessage('assistant-1', [createToolPart('tool-1', 'assistant-1')], 1001, 1002)
    before.snapshot = { files: ['src/a.ts'] }
    const after = createAssistantMessage('assistant-2', [createToolPart('tool-2', 'assistant-2')], 1004, 1005)
    after.snapshot = { files: ['src/b.ts'] }
    const messages = [createUserMessage('user-1', 1000), before, compactionMessage('compaction-1', 1003), after]

    const timeline = timelineOf(messages, { turnDiff: true, sessionIsStreaming: true })
    const userShell = timeline.find(item => item.key === 'process-shell:user-1')
    const lastSegment = timeline.find(item => item.key === 'process-shell:assistant-2')
    expect(userShell?.kind === 'process-shell' && userShell.turnDiff).toBeUndefined()
    expect(lastSegment?.kind === 'process-shell' && lastSegment.turnDiff).toBeUndefined()
  })

  it('does not duplicate the error card when the last assistant already shows it', () => {
    // assistant.error 已由 MessageErrorView 渲染 → idle 卡片跳过（官方同款去重）
    const failedAssistant = createAssistantMessage(
      'assistant-1',
      [createTextPart('text-1', 'assistant-1', 'oops')],
      1001,
      1002,
      { type: 'provider', message: 'boom' },
    )
    const failedIdle = {
      id: 'idle-1',
      type: 'idle',
      outcome: 'failed',
      error: { type: 'provider', message: 'boom' },
      time: { created: 1003 },
    } as SessionMessageInfo
    const messages = [createUserMessage('user-1', 1000), failedAssistant, failedIdle]
    const timeline = buildProcessTimeline(messages, {
      turnDurationMap: new Map(),
      sessionIsStreaming: false,
      messageHasProcess: hasProcess,
      messageHasFinal: hasFinal,
    })

    expect(timeline.some(item => item.kind === 'message' && item.key === 'idle-1')).toBe(false)
  })

  it('still shows the idle error card when the assistant error was an interruption', () => {
    // assistant 是被中断的（abort）→ 不算「已显示错误」，idle 卡片仍要渲染
    const aborted = createAssistantMessage(
      'assistant-1',
      [createTextPart('text-1', 'assistant-1', 'partial')],
      1001,
      1002,
      { type: 'MessageAbortedError', message: 'aborted' },
    )
    const failedIdle = {
      id: 'idle-1',
      type: 'idle',
      outcome: 'failed',
      error: { type: 'provider', message: 'boom' },
      time: { created: 1003 },
    } as SessionMessageInfo
    const messages = [createUserMessage('user-1', 1000), aborted, failedIdle]
    const timeline = buildProcessTimeline(messages, {
      turnDurationMap: new Map(),
      sessionIsStreaming: false,
      messageHasProcess: hasProcess,
      messageHasFinal: hasFinal,
    })

    expect(timeline.some(item => item.kind === 'message' && item.key === 'idle-1')).toBe(true)
  })

  it('ignores succeeded idle markers', () => {
    const okIdle = {
      id: 'idle-1',
      type: 'idle',
      outcome: 'succeeded',
      time: { created: 1001 },
    } as SessionMessageInfo
    const messages = [createUserMessage('user-1', 1000), okIdle]
    const timeline = buildProcessTimeline(messages, {
      turnDurationMap: new Map(),
      sessionIsStreaming: false,
      messageHasProcess: hasProcess,
      messageHasFinal: hasFinal,
    })

    expect(timeline.some(item => item.key === 'idle-1')).toBe(false)
  })

  it('keeps only the earliest pending Working shell when a later user is queued', () => {
    // 第一轮仍 live，第二轮 user 已发出 → 只挂 user-1 的 Working，user-2 暂不挂空壳
    const mid = createAssistantMessage('assistant-1', [createToolPart('tool-1', 'assistant-1')], 1001)
    markStreaming(mid)
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
      expect(shells[0].children.map(c => c.message.id)).toEqual(['assistant-1'])
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
    markStreaming(earlierStillFlaggedLive)
    const laterLive = createAssistantMessage('assistant-2', [createToolPart('tool-2', 'assistant-2')], 2001)
    markStreaming(laterLive)
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

  it('keeps the last turn Working while the session is still busy (multi-step gap)', () => {
    // 上一步已 completed、下一步还没到，但 session.status 仍是 busy —— 这是多步 agent 的常态。
    // 不能在这一刻判成 Worked 收壳，否则下一步内容到达时又要展开，看着像「提前收工」。
    const stepped = createAssistantMessage(
      'assistant-1',
      [createToolPart('tool-1', 'assistant-1'), { type: 'text', text: '看一眼' }],
      1001,
      1500,
    )
    const messages = [createUserMessage('user-1', 1000), stepped]

    const busy = buildProcessTimeline(messages, {
      turnDurationMap: new Map([['assistant-1', 500]]),
      sessionIsStreaming: true,
      messageHasProcess: hasProcess,
      messageHasFinal: hasFinal,
    })
    expect(busy.find(item => item.kind === 'process-shell')).toMatchObject({
      kind: 'process-shell',
      isActive: true,
    })

    // busy 摘掉（idle）→ 收壳，并显示总耗时
    const settled = buildProcessTimeline(messages, {
      turnDurationMap: new Map([['assistant-1', 500]]),
      sessionIsStreaming: false,
      messageHasProcess: hasProcess,
      messageHasFinal: hasFinal,
    })
    expect(settled.find(item => item.kind === 'process-shell')).toMatchObject({
      kind: 'process-shell',
      isActive: false,
      durationMs: 500,
    })
  })

  it('settles the previous turn once the next user turn lands, even while busy', () => {
    // 发送瞬间：busy 已 true、新 user 已入列 → 上一轮立刻 Worked，不能闪回 Working
    const settled = createAssistantMessage(
      'assistant-1',
      [createToolPart('tool-1', 'assistant-1'), { type: 'text', text: 'done' }],
      1001,
      1500,
    )
    const messages = [createUserMessage('user-1', 1000), settled, createUserMessage('user-2', 2000)]
    const timeline = buildProcessTimeline(messages, {
      turnDurationMap: new Map([['assistant-1', 500]]),
      sessionIsStreaming: true,
      messageHasProcess: hasProcess,
      messageHasFinal: hasFinal,
    })

    const shells = timeline.filter(item => item.kind === 'process-shell')
    expect(shells[0]).toMatchObject({ userMessageId: 'user-1', isActive: false })
  })

  it('settles shell with process inside and final answer outside', () => {
    const processOnly = createAssistantMessage('assistant-1', [createToolPart('tool-1', 'assistant-1')], 1001, 1200)
    const finalAnswer = createAssistantMessage(
      'assistant-2',
      [createToolPart('tool-2', 'assistant-2'), { type: 'text', text: 'done' }],
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
    expect(shell.children.map(c => [c.message.id, c.processContentScope])).toEqual([
      ['assistant-1', 'inline'],
      ['assistant-2', 'process'],
    ])
    expect(shell.finalMessage?.id).toBe('assistant-2')
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
    const plain = createAssistantMessage('assistant-1', [{ type: 'text', text: 'hello' }], 1001, 1100)
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

  it('appends a turn diff after a settled turn with changed files', () => {
    const assistant = createAssistantMessage('assistant-1', [createToolPart('tool-1', 'assistant-1')], 1001, 1002)
    assistant.snapshot = { files: ['b.ts', 'a.ts', 'a.ts'] }
    const messages = [createUserMessage('user-1', 1000), assistant]
    const timeline = buildProcessTimeline(messages, {
      turnDurationMap: new Map(),
      sessionIsStreaming: false,
      messageHasProcess: hasProcess,
      messageHasFinal: hasFinal,
      turnDiff: true,
    })

    const shell = timeline.at(-1)
    expect(shell?.kind).toBe('process-shell')
    if (shell?.kind === 'process-shell') {
      expect(shell.turnDiff).toEqual({ from: 'user-1', files: ['a.ts', 'b.ts'] })
    }
  })

  it('does not append a turn diff while the turn is still running', () => {
    const assistant = createAssistantMessage('assistant-1', [createToolPart('tool-1', 'assistant-1')])
    assistant.snapshot = { files: ['a.ts'] }
    const messages = [createUserMessage('user-1', 1000), assistant]
    const timeline = buildProcessTimeline(messages, {
      turnDurationMap: new Map(),
      sessionIsStreaming: true,
      messageHasProcess: hasProcess,
      messageHasFinal: hasFinal,
      isUserEntryReady: () => true,
      turnDiff: true,
    })

    const shell = timeline.find(item => item.kind === 'process-shell')
    if (shell?.kind === 'process-shell') expect(shell.turnDiff).toBeUndefined()
  })
})

describe('buildFlatTimeline', () => {
  it('keeps messages flat and inserts a turn diff for settled turns', () => {
    const first = createAssistantMessage('assistant-1', [{ type: 'text', text: 'done' }], 1001, 1002)
    first.snapshot = { files: ['src/a.ts'] }
    const second = createAssistantMessage('assistant-2', [{ type: 'text', text: 'working' }], 2001)
    const messages = [
      createUserMessage('user-1', 1000),
      first,
      createUserMessage('user-2', 2000),
      second,
    ]

    const timeline = buildFlatTimeline(messages, true, true)
    expect(timeline.filter(item => item.kind === 'message')).toHaveLength(4)
    expect(timeline[1]).toMatchObject({
      kind: 'message',
      key: 'assistant-1',
      turnDiff: { from: 'user-1', files: ['src/a.ts'] },
    })
    // 最后一个回合还在跑：不放摘要
    expect(timeline.filter(item => item.kind === 'message' && item.turnDiff)).toHaveLength(1)
  })

  it('adds the last turn diff once streaming ends', () => {
    const assistant = createAssistantMessage('assistant-1', [{ type: 'text', text: 'done' }], 1001, 1002)
    assistant.snapshot = { files: ['src/a.ts'] }
    const messages = [createUserMessage('user-1', 1000), assistant]

    expect(
      buildFlatTimeline(messages, true, true).every(item => item.kind !== 'message' || !item.turnDiff),
    ).toBe(true)
    expect(buildFlatTimeline(messages, false, true)[1]).toMatchObject({
      turnDiff: { from: 'user-1', files: ['src/a.ts'] },
    })
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
    expect(pages[1].messageIds).toEqual(messages.slice(0, 6).map(message => message.id))
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
        text: `prompt ${index + 2}`,
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
        text: 'older prompt 0',
      },
      createAssistantMessage('assistant-0', [createTextPart('text-0', 'assistant-0', 'older answer 0')], 1, 2),
      {
        ...createUserMessage('user-1', 3),
        text: 'older prompt 1',
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
      expect(next.visibleMessages.find(candidate => candidate.id === message.id)).toBe(message)
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

describe('shell 消息（`!` 命令）', () => {
  function createShellMessage(id: string, created: number): SessionMessageInfo {
    return {
      id,
      type: 'shell',
      shellID: `sh_${id}`,
      command: 'echo hi',
      status: 'exited',
      exit: 0,
      time: { created },
    } as SessionMessageInfo
  }

  it('可见性：shell 消息不被过滤', () => {
    const entries = buildVisibleMessageEntries([createShellMessage('shell-1', 1000)])
    expect(entries.map(e => e.message.id)).toEqual(['shell-1'])
  })

  it('过程时间线：shell 消息独立成行并结束当前回合分组', () => {
    const hasProcess = (message: SessionMessageInfo) =>
      contentOf(message).some(p => p.type === 'tool' || p.type === 'reasoning')
    const hasFinal = (message: SessionMessageInfo) => contentOf(message).some(p => p.type === 'text')
    const opts = {
      turnDurationMap: new Map<string, number>(),
      sessionIsStreaming: false,
      messageHasProcess: hasProcess,
      messageHasFinal: hasFinal,
    }

    const messages = [
      createUserMessage('user-1', 1000),
      createAssistantMessage('assistant-1', [createTextPart('text-1', 'assistant-1', 'answer')], 1001, 1002),
      createShellMessage('shell-1', 1003),
      createUserMessage('user-2', 1004),
      createAssistantMessage('assistant-2', [createTextPart('text-2', 'assistant-2', 'answer2')], 1005, 1006),
    ]
    const timeline = buildProcessTimeline(messages, opts)

    const shellRow = timeline.find(item => item.kind === 'message' && item.message.id === 'shell-1')
    expect(shellRow).toBeTruthy()
    // shell 行夹在两个回合之间，不进任何过程壳
    const shellIndex = timeline.indexOf(shellRow!)
    expect(shellIndex).toBeGreaterThan(0)
    expect(shellIndex).toBeLessThan(timeline.length - 1)
    for (const item of timeline) {
      if (item.kind !== 'process-shell') continue
      expect(item.children.some(c => c.message.id === 'shell-1')).toBe(false)
    }
  })
})
