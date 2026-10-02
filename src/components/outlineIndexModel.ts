import {
  hasVisibleText,
  isAssistantMessage,
  isUserMessage,
  userMessageText,
  type SessionMessageInfo,
} from '../types/api/message'
import { isInterruptedError } from '../utils/errorMessage'

const FULL_TITLE_MAX = 80

export interface OutlineSourceEntry {
  messageId: string
  title: string
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + '\u2026'
}

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/** 对应旧视图模型的 `hasRenderableParts(msg)` */
function hasRenderableMessageContent(msg: SessionMessageInfo): boolean {
  if (isUserMessage(msg)) {
    return userMessageText(msg).trim().length > 0 || (msg.files?.length ?? 0) > 0 || (msg.agents?.length ?? 0) > 0
  }
  if (isAssistantMessage(msg)) {
    if (msg.retry) return true
    return msg.content.some(content => content.type === 'tool' || hasVisibleText(content))
  }
  return msg.type === 'compaction'
}

/** 对应旧视图模型的 `msg.parts.length !== 0` */
function hasAnyMessageContent(msg: SessionMessageInfo): boolean {
  if (isUserMessage(msg)) {
    return userMessageText(msg).length > 0 || (msg.files?.length ?? 0) > 0 || (msg.agents?.length ?? 0) > 0
  }
  if (isAssistantMessage(msg)) return msg.content.length > 0 || msg.retry != null
  return msg.type === 'compaction'
}

function messageHasContent(msg: SessionMessageInfo): boolean {
  const hasRenderable = hasRenderableMessageContent(msg)
  if (isAssistantMessage(msg) && msg.error) {
    return isInterruptedError(msg.error) ? hasRenderable : true
  }
  if (!hasAnyMessageContent(msg)) return true
  return hasRenderable
}

export function truncateOutlineLabel(s: string, max: number): string {
  return truncate(s, max)
}

export function buildOutlineSourceEntries(messages: SessionMessageInfo[]): OutlineSourceEntry[] {
  const entries: OutlineSourceEntry[] = []
  for (const msg of messages.filter(messageHasContent)) {
    if (!isUserMessage(msg)) continue
    // v2 的用户消息没有 summary（旧视图模型优先用 summary.title），正文就是 message.text
    const raw = userMessageText(msg)
      .trim()
      .split(/\r?\n/)
      .map(l => l.trim())
      .find(Boolean)
    if (!raw) continue
    const n = normalizeWhitespace(raw)
    entries.push({
      messageId: msg.id,
      title: truncate(n, FULL_TITLE_MAX),
    })
  }
  return entries
}
