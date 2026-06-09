import type { Message } from '../types/message'
import { getMessageText, hasRenderableParts, isAbortedMessage, isUserMessage } from '../types/message'
import { detectOmoWrapper } from '../utils/omo'

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

function messageHasContent(msg: Message): boolean {
  const hasRenderable = hasRenderableParts(msg)
  if (msg.info.role === 'assistant' && 'error' in msg.info && msg.info.error) {
    return isAbortedMessage(msg.info) ? hasRenderable : true
  }
  if (msg.parts.length === 0) return true
  return hasRenderable
}

export function truncateOutlineLabel(s: string, max: number): string {
  return truncate(s, max)
}

export function buildOutlineSourceEntries(messages: Message[]): OutlineSourceEntry[] {
  const entries: OutlineSourceEntry[] = []
  for (const msg of messages.filter(messageHasContent)) {
    if (!isUserMessage(msg.info)) continue
    let raw =
      msg.info.summary?.title?.trim() ||
      getMessageText(msg)
        .trim()
        .split(/\r?\n/)
        .map(l => l.trim())
        .find(Boolean)
    if (!raw) continue
    // 清理 OMO 包装
    const wrapper = detectOmoWrapper(raw)
    // 纯系统消息（无用户 prompt）直接跳过，不显示在指示条中
    if (wrapper.isWrapped && !wrapper.userText) continue
    if (wrapper.userText) {
      raw = wrapper.userText
    }
    const n = normalizeWhitespace(raw)
    entries.push({
      messageId: msg.info.id,
      title: truncate(n, FULL_TITLE_MAX),
    })
  }
  return entries
}
