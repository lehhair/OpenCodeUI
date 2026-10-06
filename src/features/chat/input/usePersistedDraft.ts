// ============================================
// usePersistedDraft — 输入草稿持久化（按会话/工作区）
//
// 对齐官方 composer/persistence（Persist.serverScoped(server, dir,
// sessionID, "prompt")）：草稿按会话作用域持久化，切换会话/重启后
// 恢复；发送成功清空。附件沿用 promptHistory 的可序列化子集
//（data URL 内联图片不落盘）。
// ============================================

import { useEffect, useRef } from 'react'
import { fromHistoryEntry, toHistoryAttachment, type PromptHistoryEntry } from '../../../store/promptHistoryStore'
import type { Attachment } from '../../attachment'

const SAVE_DEBOUNCE_MS = 300

interface PersistedDraftOptions {
  /** 持久化 key（null = 不持久化） */
  storageKey: string | null
  text: string
  attachments: Attachment[]
  setText: (text: string) => void
  setAttachments: (attachments: Attachment[]) => void
}

export function usePersistedDraft({ storageKey, text, attachments, setText, setAttachments }: PersistedDraftOptions) {
  // 当前 key 是否已完成初始加载（加载完成前不写盘，避免空值覆盖已有草稿）
  const loadedKeyRef = useRef<string | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // key 变化（切会话）→ 读回草稿
  useEffect(() => {
    if (!storageKey) return
    loadedKeyRef.current = null
    let entry: PromptHistoryEntry | null = null
    try {
      const raw = localStorage.getItem(storageKey)
      entry = raw ? (JSON.parse(raw) as PromptHistoryEntry) : null
    } catch {
      entry = null
    }
    setText(entry?.text ?? '')
    setAttachments(entry?.attachments.map(fromHistoryEntry) ?? [])
    loadedKeyRef.current = storageKey
    // 故意只随 key 执行：读写器引用随渲染变化但语义稳定
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey])

  // 内容变化 → 防抖写盘；空草稿删除键
  useEffect(() => {
    if (!storageKey || loadedKeyRef.current !== storageKey) return
    if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null
      try {
        const serializable = attachments.flatMap(attachment => {
          const item = toHistoryAttachment(attachment)
          return item ? [item] : []
        })
        if (!text.trim() && serializable.length === 0) {
          localStorage.removeItem(storageKey)
          return
        }
        localStorage.setItem(storageKey, JSON.stringify({ text, attachments: serializable }))
      } catch {
        // 存储满/不可用时草稿退化为内存态
      }
    }, SAVE_DEBOUNCE_MS)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, text, attachments])

  // 卸载清理定时器
  useEffect(
    () => () => {
      if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current)
    },
    [],
  )
}

/** 会话作用域的草稿 key（官方 serverScoped(server, dir, sessionID) 同款维度） */
export function draftStorageKey(sessionId: string | null | undefined, directory: string | undefined): string | null {
  if (sessionId) return `srv:draft:${sessionId}`
  if (!directory) return null
  return `srv:draft:workspace:${directory}`
}

/** 发送成功后清空草稿（resetDraft 时同步删键） */
export function clearPersistedDraft(storageKey: string | null) {
  if (!storageKey) return
  try {
    localStorage.removeItem(storageKey)
  } catch {
    // 忽略
  }
}
