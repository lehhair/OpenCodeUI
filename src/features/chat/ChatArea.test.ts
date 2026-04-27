import { describe, expect, it } from 'vitest'
import { buildTurnDurationMap } from './ChatArea'
import { buildVisibleMessageEntries, getVisibleMessageForkTargetId } from './chatAreaVisibility'
import type { Message, Part, ToolPart, ReasoningPart } from '../../types/message'

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

function createAssistantMessage(id: string, parts: Part[], created = 1, completed?: number): Message {
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
