import { useRef, useCallback, useEffect } from 'react'
import { usePromptHistory, fromHistoryEntry } from '../../../store/promptHistoryStore'
import type { Attachment } from '../../attachment'

// ============================================
// useInputHistory
// 类终端的历史消息导航（↑↓ 翻阅已发送消息）
//
// 数据源是**全局持久化**的 prompt 历史（官方 composer/history 同款：
// 跨会话跨重启保留，normal/shell 分轨，发送即记账、失败移除）。
// ============================================

interface HistoryEntry {
  text: string
  attachments: Attachment[]
}

interface UseInputHistoryOptions {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  /** 输入模式：normal / shell 分轨（官方同款） */
  mode: 'normal' | 'shell'
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

export function useInputHistory({ textareaRef, mode }: UseInputHistoryOptions): UseInputHistoryReturn {
  // store 条目最新在前；导航时下标 0 = 最新一条
  const storeEntries = usePromptHistory(mode)
  const historyRef = useRef(storeEntries)
  useEffect(() => {
    historyRef.current = storeEntries
  }, [storeEntries])

  // -1 = 未进入历史模式，0 = 最新一条，往上递增
  const historyIndexRef = useRef(-1)
  // 进入历史前暂存用户的输入
  const savedInputRef = useRef<HistoryEntry>({ text: '', attachments: [] })

  const resetHistoryIndex = useCallback(() => {
    historyIndexRef.current = -1
  }, [])

  const handleHistoryKeyDown = useCallback(
    (
      e: React.KeyboardEvent<HTMLTextAreaElement>,
      text: string,
      attachments: Attachment[],
    ): { text: string; attachments: Attachment[]; cursor: 'start' | 'end' } | null => {
      const history = historyRef.current
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
        const entry = history[historyIndexRef.current]
        if (!entry || text !== entry.text) return false
        if (attachments.length !== entry.attachments.length) return false
        return attachments.every((a, i) => {
          const h = entry.attachments[i]
          return a.type === h.type && a.displayName === h.displayName
        })
      }

      const entryAt = (index: number): HistoryEntry => {
        const entry = history[index]
        return { text: entry.text, attachments: entry.attachments.map(fromHistoryEntry) }
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
            return { ...entryAt(nextIndex), cursor: 'start' }
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
          return { ...entryAt(nextIndex), cursor: 'end' }
        }
      }

      return null
    },
    [textareaRef],
  )

  const handleHistoryChange = useCallback((newText: string) => {
    if (historyIndexRef.current >= 0) {
      const history = historyRef.current
      const currentEntry = history[historyIndexRef.current]
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
