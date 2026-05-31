import { fireEvent, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OutlineIndex } from './OutlineIndex'
import {
  outlineIndexCleanupOmoTitle,
  outlineIndexExtractLastUserRequest,
  outlineIndexExtractLastUserTask,
  outlineIndexHasOmoInternalInitiatorMarker,
  outlineIndexIsOmoInternalReminder,
  outlineIndexSimplifyModePrompt,
  outlineIndexSimplifySearchModePrompt,
} from './OutlineIndex.helpers'
import type { Message, TextPart } from '../types/message'

const { useChatViewportMock, useLayoutStoreMock } = vi.hoisted(() => ({
  useChatViewportMock: vi.fn(),
  useLayoutStoreMock: vi.fn(),
}))

vi.mock('../features/chat/chatViewport', () => ({
  useChatViewport: useChatViewportMock,
}))

vi.mock('../store', () => ({
  useLayoutStore: useLayoutStoreMock,
}))

const defaultChatViewport = {
  presentation: { surfaceVariant: 'desktop', isCompact: false },
  interaction: {
    mode: 'pointer',
    touchCapable: false,
    sidebarBehavior: 'docked',
    rightPanelBehavior: 'docked',
    bottomPanelBehavior: 'docked',
    outlineInteraction: 'pointer',
    enableCollapsedInputDock: false,
  },
}

function layoutSnapshot({
  omoConversationNavSimplify = false,
  alwaysLoadFullConversationNavigation = false,
}: {
  omoConversationNavSimplify?: boolean
  alwaysLoadFullConversationNavigation?: boolean
} = {}) {
  return { omoConversationNavSimplify, alwaysLoadFullConversationNavigation }
}

function textPart(messageId: string, text: string, synthetic = false): TextPart {
  return {
    id: `${messageId}-text-${synthetic ? 'synthetic' : 'visible'}`,
    sessionID: 'session-1',
    messageID: messageId,
    type: 'text',
    text,
    synthetic,
  }
}

function userMessage(id: string, text: string, summaryTitle?: string, syntheticText?: string): Message {
  return {
    info: {
      id,
      sessionID: 'session-1',
      role: 'user',
      time: { created: 1 },
      agent: 'build',
      model: { providerID: 'provider-1', modelID: 'model-1' },
      summary: summaryTitle ? { title: summaryTitle } : undefined,
    },
    parts: [
      ...(syntheticText ? [textPart(id, syntheticText, true)] : []),
      textPart(id, text),
    ],
    isStreaming: false,
  }
}

function titles(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-oi-item]')).map(item => item.title)
}

const omoReminderText = '<system-reminder>\nhidden\n</system-reminder>\n<!-- OMO_INTERNAL_INITIATOR -->'
const omoWakeText = 'wake\n<!-- OMO_INTERNAL_INITIATOR -->'
const omoRecoveryText = '[session recovered - continuing previous task]\n<!-- OMO_INTERNAL_INITIATOR -->'
const autoSlashCommandSearchModeText = `[search-mode]
MAXIMIZE SEARCH EFFORT.
---
<auto-slash-command>
## User Request

old-plan-name
</auto-slash-command>

---

<user-request>
vue-to-react-migration-progress-audit
</user-request>

---

## Auto-Selected Plan

**Plan**: vue-to-react-migration-progress-audit
**Path**: J:\\Coding\\ZhenQiao_V2\\.sisyphus\\plans\\vue-to-react-migration-progress-audit.md`
const autoSlashCommandMarkdownText = `<auto-slash-command>
# /handoff Command

**Description**: (builtin) Create a detailed context summary
**User Arguments**: legacy fallback

---

## Command Instructions

Create a handoff.

---

## User Request

handoff current OMO navigation work
</auto-slash-command>`

describe('OutlineIndex OMO cleanup helpers', () => {
  it('detects only trimmed OMO internal reminders with the exact normalized boundaries', () => {
    expect(
      outlineIndexIsOmoInternalReminder(
        ' \n<system-reminder>\ninternal\n</system-reminder>\n<!-- OMO_INTERNAL_INITIATOR -->\t',
      ),
    ).toBe(true)
    expect(outlineIndexIsOmoInternalReminder('<system-reminder>\ninternal\n</system-reminder>')).toBe(false)
    expect(
      outlineIndexIsOmoInternalReminder(
        'prefix <system-reminder>\ninternal\n</system-reminder>\n<!-- OMO_INTERNAL_INITIATOR -->',
      ),
    ).toBe(false)
    expect(
      outlineIndexIsOmoInternalReminder(
        '<system-reminder>\ninternal\n</system-reminder>\n<!-- OMO_INTERNAL_INITIATOR --> suffix',
      ),
    ).toBe(false)
  })

  it('simplifies LF search-mode prompts after the last exact separator line', () => {
    expect(outlineIndexSimplifySearchModePrompt('[search-mode]\nfirst\n---\nsecond\n---\nfinal body')).toBe('final body')
  })

  it('simplifies CRLF search-mode prompts and accepts whitespace around separator lines', () => {
    expect(outlineIndexSimplifySearchModePrompt('[search-mode]\r\nheader\r\n  ---  \r\n  final body  ')).toBe(
      'final body',
    )
  })

  it('ignores inline separator text and removes only the literal marker when no separator line exists', () => {
    expect(outlineIndexSimplifySearchModePrompt('[search-mode] prompt --- not a separator')).toBe(
      'prompt --- not a separator',
    )
  })

  it('extracts the last closed user-request block from auto slash command prompts', () => {
    const rawText = `<user-request>
old-plan-name
</user-request>

<auto-slash-command>
<user-request>
vue-to-react-migration-progress-audit
</user-request>
</auto-slash-command>

## Auto-Selected Plan

**Plan**: vue-to-react-migration-progress-audit`

    expect(outlineIndexExtractLastUserRequest(rawText)).toBe('vue-to-react-migration-progress-audit')
  })

  it('does not swallow trailing markdown when a later user-request tag is unclosed', () => {
    const rawText = `<user-request>
vue-to-react-migration-progress-audit
</user-request>

<user-request>
unterminated

## Auto-Selected Plan`

    expect(outlineIndexExtractLastUserRequest(rawText)).toBe('vue-to-react-migration-progress-audit')
  })

  it('uses the nearest opening tag before the final closing tag', () => {
    const rawText = `<user-request>
incomplete wrapper noise
<user-request>
vue-to-react-migration-progress-audit
</user-request>`

    expect(outlineIndexExtractLastUserRequest(rawText)).toBe('vue-to-react-migration-progress-audit')
  })

  it('prefers user-request content over the last separator body for search-mode auto slash commands', () => {
    expect(outlineIndexSimplifySearchModePrompt(autoSlashCommandSearchModeText)).toBe(
      'vue-to-react-migration-progress-audit',
    )
  })

  it('extracts the last closed user-task block from loop command prompts', () => {
    const rawText = `<command-instruction>
Loop until complete.
</command-instruction>

<user-task>
finish the migration audit
</user-task>`

    expect(outlineIndexExtractLastUserTask(rawText)).toBe('finish the migration audit')
    expect(outlineIndexCleanupOmoTitle(rawText)).toBe('finish the migration audit')
  })

  it('extracts markdown user request from auto slash command wrappers', () => {
    expect(outlineIndexCleanupOmoTitle(autoSlashCommandMarkdownText)).toBe('handoff current OMO navigation work')
  })

  it('falls back to user arguments inside auto slash command wrappers', () => {
    const rawText = `<auto-slash-command>
# /custom Command

**Description**: Run a custom command
**User Arguments**: inspect prompt wrappers

---

## Command Instructions

Inspect the wrappers.
</auto-slash-command>`

    expect(outlineIndexCleanupOmoTitle(rawText)).toBe('inspect prompt wrappers')
  })

  it('does not treat ordinary markdown user request headings as prompt wrappers', () => {
    const rawText = `## User Request

ordinary note`

    expect(outlineIndexCleanupOmoTitle(rawText)).toBe(rawText)
  })

  it('simplifies analyze-mode prompts after the injected separator', () => {
    expect(outlineIndexSimplifyModePrompt('[analyze-mode]\nmetadata\n---\nActual request')).toBe('Actual request')
    expect(outlineIndexCleanupOmoTitle('[analyze-mode]\nmetadata\n---\nActual request')).toBe('Actual request')
  })

  it('returns no title when search-mode cleanup leaves no display body', () => {
    expect(outlineIndexSimplifySearchModePrompt('[search-mode]\n---\n   ')).toBeUndefined()
    expect(outlineIndexCleanupOmoTitle('[search-mode]\n---\n   ')).toBeUndefined()
  })

  it('matches the search-mode marker after NFC normalization and leading trim only', () => {
    const decomposedBody = 'Cafe\u0301'

    expect(outlineIndexSimplifySearchModePrompt(`\t[search-mode] ${decomposedBody}`)).toBe('Café')
    expect(outlineIndexSimplifySearchModePrompt('prefix [search-mode] body')).toBeUndefined()
  })

  it('hides marker-only wake messages before any search-mode cleanup', () => {
    const rawText = omoWakeText

    expect(outlineIndexHasOmoInternalInitiatorMarker(rawText)).toBe(true)
    expect(outlineIndexCleanupOmoTitle(rawText)).toBeUndefined()
  })

  it('hides session recovery continuation messages with the official marker', () => {
    const rawText = omoRecoveryText

    expect(outlineIndexHasOmoInternalInitiatorMarker(rawText)).toBe(true)
    expect(outlineIndexCleanupOmoTitle(rawText)).toBeUndefined()
  })

  it('still recognizes the legacy reminder wrapper while cleanup is now marker-based', () => {
    const rawText = '<system-reminder>\ninternal\n</system-reminder>\n<!-- OMO_INTERNAL_INITIATOR -->'

    expect(outlineIndexIsOmoInternalReminder(rawText)).toBe(true)
    expect(outlineIndexCleanupOmoTitle(rawText)).toBeUndefined()
  })

  it('detects official markers with extra internal comment whitespace', () => {
    const rawText = 'wake\n<!--   OMO_INTERNAL_INITIATOR   -->'

    expect(outlineIndexHasOmoInternalInitiatorMarker(rawText)).toBe(true)
    expect(outlineIndexCleanupOmoTitle(rawText)).toBeUndefined()
  })

  it('does not hide plain text that only mentions the marker name', () => {
    const rawText = 'wake\nOMO_INTERNAL_INITIATOR'

    expect(outlineIndexHasOmoInternalInitiatorMarker(rawText)).toBe(false)
    expect(outlineIndexCleanupOmoTitle(rawText)).toBe(rawText)
  })

  it('leaves unsupported mode-like text unchanged', () => {
    const rawText = '[unknown-mode]\nmetadata\n---\nActual request'

    expect(outlineIndexCleanupOmoTitle(rawText)).toBe(rawText)
  })
})

describe('OutlineIndex default extraction', () => {
  beforeEach(() => {
    useChatViewportMock.mockReturnValue(defaultChatViewport)
    useLayoutStoreMock.mockReturnValue(layoutSnapshot())
  })

  it('preserves current disabled title derivation behavior', () => {
    const messages = [
      userMessage('user-summary', 'raw text should not win', 'Summary wins'),
      userMessage('user-raw', '\n\nFirst raw line\nsecond line', undefined, 'synthetic prefix'),
      userMessage('user-omo', omoReminderText),
      userMessage('user-search', '[search-mode]\nmetadata\n---\nCleaned title'),
    ]
    const originalMessages = structuredClone(messages)

    const { container } = render(
      <OutlineIndex messages={messages} visibleMessageIds={[]} onScrollToMessageId={vi.fn()} />,
    )

    expect(titles(container)).toEqual(['Summary wins', 'First raw line', '<system-reminder>', '[search-mode]'])
    expect(messages).toEqual(originalMessages)
    expect(messages[1].parts[1]).toEqual(originalMessages[1].parts[1])
  })

  it('still renders official marker-bearing entries through existing disabled title derivation', () => {
    const messages = [
      userMessage('marker-wake', omoWakeText),
      userMessage('marker-recovery', omoRecoveryText, 'Recovered summary'),
      userMessage('normal-msg', 'Normal text'),
    ]
    const originalMessages = structuredClone(messages)

    const { container } = render(
      <OutlineIndex messages={messages} visibleMessageIds={[]} onScrollToMessageId={vi.fn()} />,
    )

    expect(titles(container)).toEqual(['wake', 'Recovered summary', 'Normal text'])
    expect(messages).toEqual(originalMessages)
  })
})

describe('OutlineIndex enabled OMO simplification', () => {
  beforeEach(() => {
    useChatViewportMock.mockReturnValue(defaultChatViewport)
    useLayoutStoreMock.mockReturnValue(layoutSnapshot({ omoConversationNavSimplify: true }))
  })

  it('hides legacy wrapped OMO internal reminder even when summary.title exists', () => {
    const messages = [
      userMessage('user-omo', omoReminderText, 'Visible summary'),
      userMessage('user-normal', 'Normal text'),
      userMessage('user-extra', 'Extra text'),
    ]
    const { container } = render(
      <OutlineIndex messages={messages} visibleMessageIds={[]} onScrollToMessageId={vi.fn()} />,
    )

    expect(titles(container)).toEqual(['Normal text', 'Extra text'])
  })

  it('hides official marker-bearing wake messages while keeping adjacent normal entries', () => {
    const messages = [
      userMessage('normal-before', 'Normal before'),
      userMessage('marker-wake', omoWakeText),
      userMessage('normal-after', 'Normal after'),
    ]

    const { container } = render(
      <OutlineIndex messages={messages} visibleMessageIds={[]} onScrollToMessageId={vi.fn()} />,
    )

    expect(titles(container)).toEqual(['Normal before', 'Normal after'])
  })

  it('hides session recovery marker entries even when summary.title exists', () => {
    const messages = [
      userMessage('normal-before', 'Normal before'),
      userMessage('marker-recovery', omoRecoveryText, 'Recovered summary'),
      userMessage('normal-after', 'Normal after'),
    ]

    const { container } = render(
      <OutlineIndex messages={messages} visibleMessageIds={[]} onScrollToMessageId={vi.fn()} />,
    )

    expect(titles(container)).toEqual(['Normal before', 'Normal after'])
  })

  it('simplifies search-mode title from body after last separator', () => {
    const messages = [
      userMessage('user-search', '[search-mode]\nmetadata\n---\nsecond metadata\n---\nActual user request'),
      userMessage('user-normal', 'Normal text'),
    ]
    const { container } = render(
      <OutlineIndex messages={messages} visibleMessageIds={[]} onScrollToMessageId={vi.fn()} />,
    )

    expect(titles(container)).toEqual(['Actual user request', 'Normal text'])
  })

  it('simplifies Prometheus auto slash command search-mode prompts to the nested user request', () => {
    const messages = [
      userMessage('user-start-work', autoSlashCommandSearchModeText),
      userMessage('user-normal', 'Normal text'),
    ]
    const { container } = render(
      <OutlineIndex messages={messages} visibleMessageIds={[]} onScrollToMessageId={vi.fn()} />,
    )

    expect(titles(container)).toEqual(['vue-to-react-migration-progress-audit', 'Normal text'])
  })

  it('simplifies command and loop wrappers to their nested user text', () => {
    const messages = [
      userMessage('command-msg', '<command-instruction>Do work</command-instruction>\n\n<user-request>ship it</user-request>'),
      userMessage('task-msg', '<command-instruction>Loop</command-instruction>\n\n<user-task>finish it</user-task>'),
      userMessage('normal-msg', 'Normal text'),
    ]

    const { container } = render(
      <OutlineIndex messages={messages} visibleMessageIds={[]} onScrollToMessageId={vi.fn()} />,
    )

    expect(titles(container)).toEqual(['ship it', 'finish it', 'Normal text'])
  })

  it('simplifies auto slash command wrappers with markdown user request headings', () => {
    const messages = [userMessage('auto-command-msg', autoSlashCommandMarkdownText), userMessage('normal-msg', 'Normal text')]

    const { container } = render(
      <OutlineIndex messages={messages} visibleMessageIds={[]} onScrollToMessageId={vi.fn()} />,
    )

    expect(titles(container)).toEqual(['handoff current OMO navigation work', 'Normal text'])
  })

  it('preserves summary-title fallback for non-OMO non-search messages when enabled', () => {
    const messages = [
      userMessage('user-summary', 'raw text should not win', 'Summary wins'),
      userMessage('user-raw', '\n\nFirst raw line\nsecond line'),
    ]
    const { container } = render(
      <OutlineIndex messages={messages} visibleMessageIds={[]} onScrollToMessageId={vi.fn()} />,
    )

    expect(titles(container)).toEqual(['Summary wins', 'First raw line'])
  })

  it('does not mutate original message objects when enabled', () => {
    const messages = [
      userMessage('user-omo', omoReminderText, 'Visible summary'),
      userMessage('user-search', '[search-mode]\nmetadata\n---\nCleaned title'),
      userMessage('user-extra', 'Extra text'),
    ]
    const originalMessages = structuredClone(messages)

    const { container } = render(
      <OutlineIndex messages={messages} visibleMessageIds={[]} onScrollToMessageId={vi.fn()} />,
    )

    expect(titles(container)).toEqual(['Cleaned title', 'Extra text'])
    expect(messages).toEqual(originalMessages)
    expect(messages[1].parts[1]).toEqual(originalMessages[1].parts[1])
  })

  it('search-mode entry navigates to original message id', () => {
    useChatViewportMock.mockReturnValue({
      ...defaultChatViewport,
      interaction: { ...defaultChatViewport.interaction, outlineInteraction: 'touch' },
    })

    const onScrollMock = vi.fn()
    const messages = [
      userMessage('search-msg', '[search-mode]\nmeta\n---\nCleaned Body'),
      userMessage('normal-msg', 'Normal text'),
    ]

    const originalRAF = window.requestAnimationFrame
    const originalCancelRAF = window.cancelAnimationFrame
    let rafCallCount = 0
    window.requestAnimationFrame = (cb: FrameRequestCallback) => {
      rafCallCount++
      if (rafCallCount <= 10) {
        cb(0)
      }
      return 0
    }
    window.cancelAnimationFrame = () => {}

    const { container } = render(
      <OutlineIndex messages={messages} visibleMessageIds={[]} onScrollToMessageId={onScrollMock} />,
    )

    const rail = container.querySelector('[data-oi-item]')?.parentElement
    expect(rail).toBeTruthy()

    fireEvent.touchStart(rail!, {
      touches: [{ clientY: 0 }],
      targetTouches: [{ clientY: 0 }],
      changedTouches: [{ clientY: 0 }],
    })
    fireEvent.touchEnd(rail!)

    expect(onScrollMock).toHaveBeenCalledWith('search-msg')

    window.requestAnimationFrame = originalRAF
    window.cancelAnimationFrame = originalCancelRAF
  })

  it('simplifies analyze-mode entries from body after the injected separator', () => {
    const messages = [
      userMessage('analyze-msg', '[analyze-mode]\nmetadata\n---\nActual request', 'Analyze summary'),
      userMessage('normal-msg', 'Normal text'),
    ]

    const { container } = render(
      <OutlineIndex messages={messages} visibleMessageIds={[]} onScrollToMessageId={vi.fn()} />,
    )

    expect(titles(container)).toEqual(['Actual request', 'Normal text'])
  })

  it('hides search-mode entries when cleaned body is empty', () => {
    const messages = [
      userMessage('empty-search', '[search-mode]\n---\n   '),
      userMessage('normal-msg', 'Normal text'),
      userMessage('extra-msg', 'Extra text'),
    ]
    const { container } = render(
      <OutlineIndex messages={messages} visibleMessageIds={[]} onScrollToMessageId={vi.fn()} />,
    )

    expect(titles(container)).toEqual(['Normal text', 'Extra text'])
  })

  it('filters OMO entries before max-entry slicing on desktop', () => {
    const messages: Message[] = []
    for (let i = 0; i < 40; i++) {
      messages.push(userMessage(`normal-${i}`, `Message ${i}`))
    }
    messages.push(userMessage('omo-40', omoReminderText))
    messages.push(userMessage('omo-41', omoReminderText))

    const { container: enabledContainer } = render(
      <OutlineIndex messages={messages} visibleMessageIds={[]} onScrollToMessageId={vi.fn()} />,
    )
    const enabledTitles = titles(enabledContainer)
    expect(enabledTitles).toHaveLength(40)
    expect(enabledTitles).not.toContain('<system-reminder>')

    useLayoutStoreMock.mockReturnValue(layoutSnapshot())
    const { container: disabledContainer } = render(
      <OutlineIndex messages={messages} visibleMessageIds={[]} onScrollToMessageId={vi.fn()} />,
    )
    const disabledTitles = titles(disabledContainer)
    expect(disabledTitles).toHaveLength(40)
    expect(disabledTitles).toContain('<system-reminder>')
  })

  it('does not mutate original messages for marker, search-mode, and analyze-mode cases', () => {
    const messages = [
      userMessage('marker-wake', omoWakeText),
      userMessage('marker-recovery', omoRecoveryText, 'Recovered summary'),
      userMessage('search-msg', '[search-mode]\nmeta\n---\nCleaned Body'),
      userMessage('analyze-msg', '[analyze-mode]\nmetadata\n---\nActual request', 'Analyze summary'),
      userMessage('normal-msg', 'Normal text'),
    ]
    const originalMessages = structuredClone(messages)

    const { container } = render(
      <OutlineIndex messages={messages} visibleMessageIds={[]} onScrollToMessageId={vi.fn()} />,
    )

    expect(titles(container)).toEqual(['Cleaned Body', 'Actual request', 'Normal text'])
    expect(messages).toEqual(originalMessages)
  })
})

describe('OutlineIndex full conversation navigation entry cap', () => {
  beforeEach(() => {
    useChatViewportMock.mockReturnValue(defaultChatViewport)
    useLayoutStoreMock.mockReturnValue(layoutSnapshot())
  })

  it('keeps max-entry slicing unchanged when full navigation loading is disabled', () => {
    const messages = Array.from({ length: 45 }, (_, index) =>
      userMessage(`user-${index + 1}`, `older user message ${String(index + 1).padStart(3, '0')}`),
    )

    const { container } = render(
      <OutlineIndex messages={messages} visibleMessageIds={[]} onScrollToMessageId={vi.fn()} />,
    )

    const renderedTitles = titles(container)
    expect(renderedTitles).toHaveLength(40)
    expect(renderedTitles).not.toContain('older user message 001')
    expect(renderedTitles).toContain('older user message 006')
    expect(renderedTitles).toContain('older user message 045')
  })

  it('bypasses max-entry slicing when full navigation loading is enabled', () => {
    useLayoutStoreMock.mockReturnValue(layoutSnapshot({ alwaysLoadFullConversationNavigation: true }))
    const messages = Array.from({ length: 45 }, (_, index) =>
      userMessage(`user-${index + 1}`, `older user message ${String(index + 1).padStart(3, '0')}`),
    )

    const { container } = render(
      <OutlineIndex messages={messages} visibleMessageIds={[]} onScrollToMessageId={vi.fn()} />,
    )

    const renderedTitles = titles(container)
    expect(renderedTitles).toHaveLength(45)
    expect(renderedTitles).toContain('older user message 001')
    expect(renderedTitles).toContain('older user message 045')
  })
})
