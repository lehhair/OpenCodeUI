import { useRef, useMemo, useCallback, useEffect } from 'react'
import { useMessages } from '../../../store/messageStoreHooks'
import { isUserMessage } from '../../../types/api/message'
import { extractUserMessageContent } from '../../../api'
import type { Attachment } from '../../attachment'

// ============================================
// useInputHistory
// 类终端的历史消息导航（↑↓ 翻阅已发送消息）
// ============================================

interface HistoryEntry {
  text: string
  attachments: Attachment[]
}

interface UseInputHistoryOptions {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
}

interface UseInputHistoryReturn {
  /**
   * 在 handleKeyDown 中调用：处理 ArrowUp/ArrowDown 历史导航。
   * 若已处理返回 { text, attachments }（调用方应用到 state），否则返回 null。
   */
  handleHistoryKeyDown: (
    e: React.KeyboardEvent<HTMLTextAreaElement>,
    text: string,
    attachments: Attachment[],
  ) => { text: string; attachments: Attachment[]; cursor: 'start' | 'end' } | null
  /**
   * 在 handleChange 中调用：文本变化时检测是否应退出历史模式。
   */
  handleHistoryChange: (newText: string) => void
  /** 重置历史索引（发送消息后调用） */
  resetHistoryIndex: () => void
}

export function useInputHistory({ textareaRef }: UseInputHistoryOptions): UseInputHistoryReturn {
  // 构建历史条目：从消息列表中提取去重的用户消息
  const messages = useMessages()
  const userHistory = useMemo((): HistoryEntry[] => {
    const entries: HistoryEntry[] = []
    const seen = new Set<string>()
    for (const msg of messages) {
      if (!isUserMessage(msg)) continue
      // v2 的用户消息自带 text / files / agents；与 undo/redo 回填走同一个抽取器，
      // 保证「↑ 翻历史」与「撤销回填」拿到的附件形状完全一致。
      const { text, attachments } = extractUserMessageContent(msg)
      const t = text.trim()
      if (!t || seen.has(t)) continue
      seen.add(t)
      entries.push({ text: t, attachments })
    }
    return entries
  }, [messages])

  // -1 = 未进入历史模式，0 = 最后一条，往上递增
  const historyIndexRef = useRef(-1)
  // 进入历史前暂存用户的输入
  const savedInputRef = useRef<HistoryEntry>({ text: '', attachments: [] })
  // 稳定引用，供回调内读取最新值
  const userHistoryRef = useRef(userHistory)
  useEffect(() => {
    userHistoryRef.current = userHistory
  }, [userHistory])

  const resetHistoryIndex = useCallback(() => {
    historyIndexRef.current = -1
  }, [])

  const handleHistoryKeyDown = useCallback(
    (
      e: React.KeyboardEvent<HTMLTextAreaElement>,
      text: string,
      attachments: Attachment[],
    ): { text: string; attachments: Attachment[]; cursor: 'start' | 'end' } | null => {
      const history = userHistoryRef.current
      if (history.length === 0) return null

      const canNavigateHistoryAtCursor = (direction: 'up' | 'down', inHistory: boolean) => {
        const ta = textareaRef.current
        if (!ta) return false
        if (ta.selectionStart !== ta.selectionEnd) return false

        const cursor = ta.selectionStart
        const atStart = cursor === 0
        const atEnd = cursor === ta.value.length

        if (inHistory) {
          return atStart || atEnd
        }

        if (direction === 'up') {
          return atStart && ta.value.length === 0
        }

        return atEnd
      }

      // 检查历史内容是否未被用户修改
      const isHistoryUnmodified = () => {
        if (historyIndexRef.current < 0) return false
        const entry = history[history.length - 1 - historyIndexRef.current]
        if (!entry || text !== entry.text) return false
        if (attachments.length !== entry.attachments.length) return false
        return attachments.every((a, i) => a.id === entry.attachments[i].id)
      }

      if (e.key === 'ArrowUp') {
        const inHistory = historyIndexRef.current >= 0
        const isEmpty = text.trim() === '' && attachments.length === 0
        const canRecallHistory = inHistory ? isHistoryUnmodified() : isEmpty

        if (canRecallHistory && canNavigateHistoryAtCursor('up', inHistory)) {
          e.preventDefault()
          if (!inHistory) {
            savedInputRef.current = { text, attachments: [...attachments] }
          }
          const nextIndex = Math.min(historyIndexRef.current + 1, history.length - 1)
          if (nextIndex !== historyIndexRef.current) {
            historyIndexRef.current = nextIndex
            const entry = history[history.length - 1 - nextIndex]
            return { text: entry.text, attachments: entry.attachments, cursor: 'start' }
          }
        }
      }

      if (e.key === 'ArrowDown' && historyIndexRef.current >= 0) {
        if (canNavigateHistoryAtCursor('down', true) && isHistoryUnmodified()) {
          e.preventDefault()
          const nextIndex = historyIndexRef.current - 1
          historyIndexRef.current = nextIndex
          if (nextIndex < 0) {
            return { text: savedInputRef.current.text, attachments: savedInputRef.current.attachments, cursor: 'end' }
          }
          const entry = history[history.length - 1 - nextIndex]
          return { text: entry.text, attachments: entry.attachments, cursor: 'end' }
        }
      }

      return null
    },
    [textareaRef],
  )

  const handleHistoryChange = useCallback((newText: string) => {
    if (historyIndexRef.current >= 0) {
      const history = userHistoryRef.current
      const currentEntry = history[history.length - 1 - historyIndexRef.current]
      if (!currentEntry || newText !== currentEntry.text) {
        historyIndexRef.current = -1
      }
    }
  }, [])

  return {
    handleHistoryKeyDown,
    handleHistoryChange,
    resetHistoryIndex,
  }
}
