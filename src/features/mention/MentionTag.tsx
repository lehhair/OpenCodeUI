// ============================================
// MentionTag Component
// 可复用的 mention 标签，支持点击复制
// ============================================

import { useState, useCallback, useRef, useEffect } from 'react'
import type { MentionType } from './types'
import { formatMentionLabel, getFileName, MENTION_COLORS } from './utils'
import { CheckIcon } from '../../components/Icons'
import { clipboardErrorHandler, copyTextToClipboard } from '../../utils'

interface MentionTagProps {
  /** Mention 类型 */
  type: MentionType
  /** 完整值（用于复制） */
  value: string
  /** 显示名称，不传则从 value 提取 */
  displayName?: string
  /** 自定义点击回调 */
  onClick?: () => void
  /** 额外的 className */
  className?: string
  /** 是否在 contentEditable 中使用（影响事件处理） */
  inEditor?: boolean
}

/**
 * MentionTag - 显示一个 mention 标签
 * - 显示格式：@Type: name
 * - 点击复制完整路径
 * - 复制成功显示 ✓ 图标（不改变文字）
 */
export function MentionTag({ type, value, displayName, onClick, className = '', inEditor = false }: MentionTagProps) {
  const [copied, setCopied] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 清理 timeout，防止内存泄漏
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  const name = displayName || getFileName(value)
  const label = formatMentionLabel(type, name)
  const colors = MENTION_COLORS[type]

  const handleClick = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()

      if (onClick) {
        onClick()
        return
      }

      try {
        await copyTextToClipboard(value)
        setCopied(true)
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current)
        }
        timeoutRef.current = setTimeout(() => setCopied(false), 1500)
      } catch (err) {
        clipboardErrorHandler('copy mention', err)
      }
    },
    [onClick, value],
  )

  return (
    <span
      className={`
        inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[length:var(--fs-sm)] font-medium
        border cursor-pointer select-none transition-all
        hover:brightness-95 active:scale-[0.98]
        ${colors.bg} ${colors.text} ${colors.darkText} ${colors.border}
        ${className}
      `}
      onClick={handleClick}
      title={value}
      // contentEditable 相关属性
      {...(inEditor ? { contentEditable: 'false' } : {})}
    >
      {copied && <CheckIcon className="w-3 h-3 flex-shrink-0" />}
      <span className="truncate max-w-[200px]">{label}</span>
    </span>
  )
}

// ============================================
// RichText - 渲染包含 mention 的文本
// ============================================

import { parseMentions } from './utils'

interface RichTextProps {
  /** 包含 [[type:value]] 格式的文本 */
  text: string
  /** 额外的 className */
  className?: string
}

/**
 * RichText - 将带有 mention 标记的文本渲染为富文本
 */
export function RichText({ text, className = '' }: RichTextProps) {
  const segments = parseMentions(text)

  if (segments.length === 0) {
    return <span className={className}>{text}</span>
  }

  return (
    <span className={className}>
      {segments.map((segment, index) => {
        if (segment.type === 'text') {
          return <span key={index}>{segment.content}</span>
        }
        return <MentionTag key={index} type={segment.mentionType!} value={segment.mentionValue!} />
      })}
    </span>
  )
}
