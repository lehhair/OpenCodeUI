import { useMemo, useRef } from 'react'
import { getMessageText, type Message } from '../../types/message'
import { buildOutlineSourceEntries, type OutlineSourceEntry } from '../../components/outlineIndexModel'
import {
  buildVisibleMessageEntries,
  getVisibleMessageForkTargetId,
  type VisibleMessageEntry,
} from './chatAreaVisibility'
import {
  buildContentKeyedChatPages,
  findMessageSequenceOffset,
  buildTurnDurationMap,
  type MessageGroupRow,
  type StableChatPage,
} from './chatPageModel'

export interface ChatPageViewModel {
  visibleMessageEntries: VisibleMessageEntry[]
  visibleMessages: Message[]
  pageRecords: StableChatPage[]
  outlineSourceEntries: OutlineSourceEntry[]
  outlineOwnerByMessageId: Map<string, string>
  forkTargetIdMap: Map<string, string | undefined>
  turnDurationMap: Map<string, number>
}

interface StableOutlineModel {
  signature: string
  entries: OutlineSourceEntry[]
  ownerByMessageId: Map<string, string>
}

const OUTLINE_MODEL_CACHE_LIMIT = 16
const outlineModelCache = new Map<string, StableOutlineModel>()

function buildOutlineSignature(messages: Message[]): string {
  let signature = ''
  for (const message of messages) {
    signature += `${message.info.id}:${message.info.role}|`
    if (message.info.role === 'user') {
      signature += `${message.info.summary?.title ?? getMessageText(message)}|`
    }
  }
  return signature
}

function buildOutlineOwnerByMessageId(messages: Message[]): Map<string, string> {
  const ownerByMessageId = new Map<string, string>()
  let lastUserMessageId: string | null = null

  for (const message of messages) {
    if (message.info.role === 'user') lastUserMessageId = message.info.id
    if (lastUserMessageId) ownerByMessageId.set(message.info.id, lastUserMessageId)
  }

  return ownerByMessageId
}

function getStableOutlineModel(messages: Message[]): StableOutlineModel {
  const signature = buildOutlineSignature(messages)
  const cached = outlineModelCache.get(signature)
  if (cached) {
    outlineModelCache.delete(signature)
    outlineModelCache.set(signature, cached)
    return cached
  }

  const next: StableOutlineModel = {
    signature,
    entries: buildOutlineSourceEntries(messages),
    ownerByMessageId: buildOutlineOwnerByMessageId(messages),
  }
  outlineModelCache.set(signature, next)
  if (outlineModelCache.size > OUTLINE_MODEL_CACHE_LIMIT) {
    const oldestKey = outlineModelCache.keys().next().value
    if (oldestKey) outlineModelCache.delete(oldestKey)
  }
  return next
}

function sameStringList(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function sameParts(a: Message['parts'], b: Message['parts']) {
  return a.length === b.length && a.every((part, index) => part === b[index])
}

function sameVisibleEntry(a: VisibleMessageEntry, b: VisibleMessageEntry) {
  return (
    sameStringList(a.sourceIds, b.sourceIds) &&
    a.message.info === b.message.info &&
    a.message.isStreaming === b.message.isStreaming &&
    sameParts(a.message.parts, b.message.parts)
  )
}

function reuseVisibleMessageEntries(
  previous: VisibleMessageEntry[] | undefined,
  next: VisibleMessageEntry[],
): VisibleMessageEntry[] {
  if (!previous || previous.length !== next.length) return next
  let changed = false
  const entries = next.map((entry, index) => {
    const previousEntry = previous[index]
    if (sameVisibleEntry(previousEntry, entry)) return previousEntry
    changed = true
    return entry
  })
  return changed ? entries : previous
}

function visibleMessagesFromEntries(previous: Message[] | undefined, entries: VisibleMessageEntry[]) {
  const messages = entries.map(entry => entry.message)
  if (
    previous &&
    previous.length === messages.length &&
    previous.every((message, index) => message === messages[index])
  ) {
    return previous
  }
  return messages
}

function sameRow(a: MessageGroupRow, b: MessageGroupRow) {
  return (
    a.key === b.key &&
    a.estimatedHeight === b.estimatedHeight &&
    sameStringList(a.messageIds, b.messageIds) &&
    a.messages.every((message, index) => message === b.messages[index])
  )
}

function reusePageRecords(previous: StableChatPage[] | undefined, next: StableChatPage[]): StableChatPage[] {
  if (!previous) return next
  const stableKeyPages = keepStablePageKeys(previous, next)
  if (previous.length !== stableKeyPages.length) return stableKeyPages
  let changed = false
  const pages = stableKeyPages.map((page, index) => {
    const previousPage = previous[index]
    if (
      previousPage.key === page.key &&
      previousPage.estimatedHeight === page.estimatedHeight &&
      sameStringList(previousPage.messageIds, page.messageIds) &&
      previousPage.rows.length === page.rows.length &&
      previousPage.rows.every((row, rowIndex) => sameRow(row, page.rows[rowIndex]))
    ) {
      return previousPage
    }
    changed = true
    return page
  })
  return changed ? pages : previous
}

function keepStablePageKeys(previous: StableChatPage[], next: StableChatPage[]): StableChatPage[] {
  if (previous.length === 0 || next.length === 0) return next
  const usedPreviousKeys = new Set<string>()
  let changed = false

  const pages = next.map(page => {
    const match = previous.find(previousPage => {
      if (usedPreviousKeys.has(previousPage.key)) return false
      return findMessageSequenceOffset(page.messageIds, previousPage.messageIds) !== -1
    })
    if (!match) return page
    usedPreviousKeys.add(match.key)
    if (match.key === page.key) return page
    changed = true
    return { ...page, key: match.key }
  })

  return changed ? pages : next
}

function buildForkTargetIdMap(entries: VisibleMessageEntry[]) {
  return new Map(entries.map(entry => [entry.message.info.id, getVisibleMessageForkTargetId(entry)]))
}

function reuseMap<K, V>(previous: Map<K, V> | undefined, next: Map<K, V>) {
  if (!previous || previous.size !== next.size) return next
  for (const [key, value] of next) {
    if (!previous.has(key) || previous.get(key) !== value) return next
  }
  return previous
}

export function buildChatPageViewModel(messages: Message[], previous?: ChatPageViewModel): ChatPageViewModel {
  const visibleMessageEntries = reuseVisibleMessageEntries(
    previous?.visibleMessageEntries,
    buildVisibleMessageEntries(messages),
  )
  const visibleMessages = visibleMessagesFromEntries(previous?.visibleMessages, visibleMessageEntries)
  const pageRecords = reusePageRecords(previous?.pageRecords, buildContentKeyedChatPages(visibleMessages))
  const forkTargetIdMap = reuseMap(previous?.forkTargetIdMap, buildForkTargetIdMap(visibleMessageEntries))
  const outlineModel = getStableOutlineModel(visibleMessages)
  const turnDurationMap = reuseMap(previous?.turnDurationMap, buildTurnDurationMap(messages, visibleMessages))

  return {
    visibleMessageEntries,
    visibleMessages,
    pageRecords,
    outlineSourceEntries: outlineModel.entries,
    outlineOwnerByMessageId: outlineModel.ownerByMessageId,
    forkTargetIdMap,
    turnDurationMap,
  }
}

export function useChatPageViewModel(messages: Message[]): ChatPageViewModel {
  const previousRef = useRef<ChatPageViewModel | undefined>(undefined)
  return useMemo(() => {
    const viewModel = buildChatPageViewModel(messages, previousRef.current)
    previousRef.current = viewModel
    return viewModel
  }, [messages])
}
