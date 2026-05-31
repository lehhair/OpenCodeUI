import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useInputHistory } from './useInputHistory'
import type { Attachment } from '../../attachment'
import type { AgentPart, FilePart, Message, TextPart } from '../../../types/message'
import type { KeyboardEvent, RefObject } from 'react'

const { useMessagesMock, themeState, themeListeners } = vi.hoisted(() => ({
  useMessagesMock: vi.fn(),
  themeState: { omoInputHistorySimplify: false },
  themeListeners: new Set<() => void>(),
}))

vi.mock('../../../store/messageStoreHooks', () => ({
  useMessages: useMessagesMock,
}))

vi.mock('../../../store/themeStore', () => ({
  themeStore: {
    subscribe: (listener: () => void) => {
      themeListeners.add(listener)
      return () => themeListeners.delete(listener)
    },
    getSnapshot: () => ({ omoInputHistorySimplify: themeState.omoInputHistorySimplify }),
  },
}))

function textPart(messageId: string, text: string): TextPart {
  return {
    id: `${messageId}-text`,
    sessionID: 'session-1',
    messageID: messageId,
    type: 'text',
    text,
  }
}

function filePart(messageId: string, id: string, filename: string): FilePart {
  const mention = `@${filename}`
  return {
    id,
    sessionID: 'session-1',
    messageID: messageId,
    type: 'file',
    mime: 'text/plain',
    filename,
    url: `file://${filename}`,
    source: {
      type: 'file',
      path: filename,
      text: { value: mention, start: 0, end: mention.length },
    },
  }
}

function agentPart(messageId: string, id: string, name: string): AgentPart {
  const mention = `@${name}`
  return {
    id,
    sessionID: 'session-1',
    messageID: messageId,
    type: 'agent',
    name,
    source: { value: mention, start: 0, end: mention.length },
  }
}

function userMessage(id: string, text: string, extraParts: Message['parts'] = []): Message {
  return {
    info: {
      id,
      sessionID: 'session-1',
      role: 'user',
      time: { created: 1 },
      agent: 'build',
      model: { providerID: 'provider-1', modelID: 'model-1' },
    },
    parts: [textPart(id, text), ...extraParts],
  }
}

function keyboardEvent(key: 'ArrowUp' | 'ArrowDown'): KeyboardEvent<HTMLTextAreaElement> {
  return { key, preventDefault: vi.fn() } as unknown as KeyboardEvent<HTMLTextAreaElement>
}

function setTextareaCursor(textarea: HTMLTextAreaElement, text: string, position: 'start' | 'end') {
  textarea.value = text
  const cursor = position === 'start' ? 0 : text.length
  textarea.setSelectionRange(cursor, cursor)
}

function renderHistoryHook(messages: Message[]) {
  useMessagesMock.mockReturnValue(messages)
  const textarea = document.createElement('textarea')
  const textareaRef: RefObject<HTMLTextAreaElement | null> = { current: textarea }
  const hook = renderHook(() => useInputHistory({ textareaRef }))
  return { ...hook, textarea }
}

function setOmoInputHistorySimplify(enabled: boolean) {
  act(() => {
    themeState.omoInputHistorySimplify = enabled
    themeListeners.forEach(listener => {
      listener()
    })
  })
}

describe('useInputHistory', () => {
  beforeEach(() => {
    themeState.omoInputHistorySimplify = false
    themeListeners.clear()
    useMessagesMock.mockReset()
  })

  it('keeps OMO-marked entries reachable by default', () => {
    const omoText = `wake
<!-- OMO_INTERNAL_INITIATOR -->`
    const { result, textarea } = renderHistoryHook([
      userMessage('normal', 'normal request'),
      userMessage('omo', omoText),
    ])

    setTextareaCursor(textarea, '', 'start')

    expect(result.current.handleHistoryKeyDown(keyboardEvent('ArrowUp'), '', [])).toMatchObject({
      text: omoText,
      attachments: [],
      cursor: 'start',
    })
  })

  it('filters only marker-tagged user history entries when OMO input history simplify is enabled', () => {
    const omoText = `wake
<!-- OMO_INTERNAL_INITIATOR -->`
    const { result, textarea } = renderHistoryHook([
      userMessage('normal', 'normal request'),
      userMessage('omo', omoText),
    ])

    setTextareaCursor(textarea, '', 'start')
    expect(result.current.handleHistoryKeyDown(keyboardEvent('ArrowUp'), '', [])?.text).toBe(omoText)

    result.current.resetHistoryIndex()
    setOmoInputHistorySimplify(true)
    setTextareaCursor(textarea, '', 'start')

    expect(result.current.handleHistoryKeyDown(keyboardEvent('ArrowUp'), '', [])).toMatchObject({
      text: 'normal request',
      attachments: [],
      cursor: 'start',
    })
  })

  it('does not filter non-marker system-reminder text when simplify is enabled', () => {
    const systemLikeText = `<system-reminder>
visible reminder
</system-reminder>`
    setOmoInputHistorySimplify(true)
    const { result, textarea } = renderHistoryHook([
      userMessage('normal', 'normal request'),
      userMessage('system-like', systemLikeText),
    ])

    setTextareaCursor(textarea, '', 'start')

    expect(result.current.handleHistoryKeyDown(keyboardEvent('ArrowUp'), '', [])).toMatchObject({
      text: systemLikeText,
      attachments: [],
      cursor: 'start',
    })
  })

  it('preserves attachments while navigating down and restores the saved draft at the end', () => {
    const olderFilePart = filePart('older', 'file-1', 'src/older.ts')
    const newerAgentPart = agentPart('newer', 'agent-1', 'build')
    const { result, textarea } = renderHistoryHook([
      userMessage('older', 'older request', [olderFilePart]),
      userMessage('newer', 'newer request', [newerAgentPart]),
    ])

    setTextareaCursor(textarea, '', 'start')
    const newer = result.current.handleHistoryKeyDown(keyboardEvent('ArrowUp'), '', [])
    expect(newer).toMatchObject({ text: 'newer request', cursor: 'start' })
    expect(newer?.attachments).toEqual<Attachment[]>([
      {
        id: 'agent-1',
        type: 'agent',
        displayName: 'build',
        agentName: 'build',
        textRange: { value: '@build', start: 0, end: 6 },
      },
    ])

    setTextareaCursor(textarea, newer!.text, 'start')
    const older = result.current.handleHistoryKeyDown(keyboardEvent('ArrowUp'), newer!.text, newer!.attachments)
    expect(older).toMatchObject({ text: 'older request', cursor: 'start' })
    expect(older?.attachments).toEqual<Attachment[]>([
      {
        id: 'file-1',
        type: 'file',
        displayName: 'src/older.ts',
        url: 'file://src/older.ts',
        mime: 'text/plain',
        relativePath: 'src/older.ts',
        textRange: { value: '@src/older.ts', start: 0, end: 13 },
      },
    ])

    setTextareaCursor(textarea, older!.text, 'end')
    const backToNewer = result.current.handleHistoryKeyDown(keyboardEvent('ArrowDown'), older!.text, older!.attachments)
    expect(backToNewer?.attachments).toEqual(newer?.attachments)
    expect(backToNewer).toMatchObject({ text: 'newer request', cursor: 'end' })

    setTextareaCursor(textarea, backToNewer!.text, 'end')
    expect(
      result.current.handleHistoryKeyDown(keyboardEvent('ArrowDown'), backToNewer!.text, backToNewer!.attachments),
    ).toEqual({ text: '', attachments: [], cursor: 'end' })
  })
})
