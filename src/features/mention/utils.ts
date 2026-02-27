// ============================================
// Mention Utility Functions
// ============================================

import type { MentionType, MentionItem, ParsedSegment } from './types'
import { getMentionPattern } from './types'

/**
 * 规范化路径（统一使用 /，移除重复斜杠）
 */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/')
}

/**
 * 从路径中提取文件名
 */
export function getFileName(path: string): string {
  const normalized = normalizePath(path)
  const parts = normalized.split('/')
  return parts[parts.length - 1] || path
}

/**
 * 将相对路径转换为绝对路径
 */
export function toAbsolutePath(relativePath: string, rootPath: string): string {
  const normalizedRoot = normalizePath(rootPath).replace(/\/$/, '')
  const normalizedRel = normalizePath(relativePath).replace(/^\/+/, '') // 移除开头的斜杠
  
  if (/^[a-zA-Z]:/.test(normalizedRel)) {
    // 已经是 Windows 绝对路径
    return normalizedRel
  }
  
  if (normalizedRel === '.' || normalizedRel === '') {
    return normalizedRoot
  }
  
  return `${normalizedRoot}/${normalizedRel}`
}

/**
 * 将文件路径转换为 file:// URL
 * Windows 路径需要用 file:/// 格式
 */
export function toFileUrl(filePath: string): string {
  const normalized = normalizePath(filePath)
  // Windows 路径 (C:/...) 需要 file:///
  if (/^[a-zA-Z]:/.test(normalized)) {
    return `file:///${normalized}`
  }
  // Unix 绝对路径 (/...)
  if (normalized.startsWith('/')) {
    return `file://${normalized}`
  }
  // 相对路径（不应该出现，但保险起见）
  return `file:///${normalized}`
}

/**
 * 生成 mention 的显示文本（带 @ 前缀）
 */
export function formatMentionLabel(type: MentionType, displayName: string): string {
  const prefix = type.charAt(0).toUpperCase() + type.slice(1)
  return `@${prefix}: ${displayName}`
}

/**
 * 生成 mention 的短显示文本（用于 tag）
 */
export function formatMentionShort(item: MentionItem): string {
  return formatMentionLabel(item.type, item.displayName)
}

/**
 * 序列化 mention 为文本格式 [[type:value]]
 */
export function serializeMention(item: MentionItem): string {
  return `[[${item.type}:${item.value}]]`
}

/**
 * 解析文本中的 mentions
 * 返回文本和 mention 交替的数组
 */
export function parseMentions(text: string): ParsedSegment[] {
  const pattern = getMentionPattern()
  const segments: ParsedSegment[] = []
  let lastIndex = 0
  let match
  
  while ((match = pattern.exec(text)) !== null) {
    // 添加 match 之前的文本
    if (match.index > lastIndex) {
      segments.push({
        type: 'text',
        content: text.slice(lastIndex, match.index),
      })
    }
    
    // 添加 mention
    segments.push({
      type: 'mention',
      content: match[2], // value
      mentionType: match[1] as MentionType,
      mentionValue: match[2],
    })
    
    lastIndex = match.index + match[0].length
  }
  
  // 添加剩余文本
  if (lastIndex < text.length) {
    segments.push({
      type: 'text',
      content: text.slice(lastIndex),
    })
  }
  
  return segments
}

/**
 * 从文本中提取所有 mentions
 */
export function extractMentions(text: string): MentionItem[] {
  const pattern = getMentionPattern()
  const mentions: MentionItem[] = []
  let match
  
  while ((match = pattern.exec(text)) !== null) {
    mentions.push({
      type: match[1] as MentionType,
      value: match[2],
      displayName: getFileName(match[2]),
    })
  }
  
  return mentions
}

/**
 * 移除文本中的 mention 标记，返回纯文本
 */
export function stripMentions(text: string): string {
  return text.replace(getMentionPattern(), '').trim()
}

/**
 * 检测文本中光标位置是否在 @ 触发区域
 * 返回 @ 的位置和查询字符串，或 null
 */
export function detectMentionTrigger(
  text: string,
  cursorPos: number,
  trigger = '@'
): { startIndex: number; query: string } | null {
  const textBeforeCursor = text.slice(0, cursorPos)
  const lastTriggerIndex = textBeforeCursor.lastIndexOf(trigger)
  
  if (lastTriggerIndex === -1) {
    return null
  }
  
  // 检查触发字符之前是否是空格或开头
  const charBefore = lastTriggerIndex > 0 ? textBeforeCursor[lastTriggerIndex - 1] : ' '
  // 支持普通空格和 NBSP (\u00A0)
  if (charBefore !== ' ' && charBefore !== '\u00A0' && charBefore !== '\n' && lastTriggerIndex !== 0) {
    return null
  }
  
  // 检查触发字符之后是否有空格（如果有则关闭）
  const textAfterTrigger = textBeforeCursor.slice(lastTriggerIndex + 1)
  if (textAfterTrigger.includes(' ') || textAfterTrigger.includes('\u00A0')) {
    return null
  }
  
  return {
    startIndex: lastTriggerIndex,
    query: textAfterTrigger,
  }
}

/**
 * Mention 类型对应的颜色配置
 */
export const MENTION_COLORS: Record<MentionType, {
  bg: string
  text: string
  border: string
  darkText: string
}> = {
  agent: {
    bg: 'bg-warning-bg',
    text: 'text-warning-100',
    border: 'border-warning-100/20',
    darkText: '',
  },
  file: {
    bg: 'bg-info-bg',
    text: 'text-info-100',
    border: 'border-info-100/20',
    darkText: '',
  },
  folder: {
    bg: 'bg-success-bg',
    text: 'text-success-100',
    border: 'border-success-100/20',
    darkText: '',
  },
}
