// ============================================
// PromptHistoryStore — 全局输入历史（跨会话、跨重启）
//
// 对齐官方 packages/app/src/composer/history/（store.ts + entry.ts）：
// - 全局持久化（prompt-history / prompt-history-shell 两个 localStorage 键）
// - normal / shell 分轨
// - 发送即记账（prepend，上限 100），与最新一条相同则跳过；
//   发送失败移除（官方 removeHistoryEntry 同款）
// - 附件只持久化可序列化部分（路径/agent/skill 引用）；内联图片的
//   data URL 过大且重启后失效，不入库（回忆时该附件缺席，与官方
//   blob 引用失效后的行为一致）
// ============================================

import { useSyncExternalStore } from 'react'
import type { Attachment } from '../api/types'

const MAX_HISTORY = 100
const KEY_NORMAL = 'prompt-history'
const KEY_SHELL = 'prompt-history-shell'

export type PromptHistoryMode = 'normal' | 'shell'

/** 可序列化的附件子集（重启后仍有效） */
export interface HistoryAttachment {
  type: 'file' | 'folder' | 'agent' | 'skill'
  displayName: string
  relativePath?: string
  url?: string
  mime?: string
  agentName?: string
  skillId?: string
}

export interface PromptHistoryEntry {
  text: string
  attachments: HistoryAttachment[]
}

function toSerializable(attachments: Attachment[]): HistoryAttachment[] {
  return attachments.flatMap(attachment => {
    if (attachment.type !== 'file' && attachment.type !== 'folder' && attachment.type !== 'agent' && attachment.type !== 'skill') {
      return []
    }
    // data: URL（内联图片）重启后无意义且体积大，不落盘
    const url = attachment.url?.startsWith('data:') ? undefined : attachment.url
    if (attachment.type === 'file' && !url && !attachment.relativePath) return []
    return [
      {
        type: attachment.type,
        displayName: attachment.displayName,
        ...(attachment.relativePath ? { relativePath: attachment.relativePath } : {}),
        ...(url ? { url } : {}),
        ...(attachment.mime ? { mime: attachment.mime } : {}),
        ...(attachment.agentName ? { agentName: attachment.agentName } : {}),
        ...(attachment.skillId ? { skillId: attachment.skillId } : {}),
      },
    ]
  })
}

/** 回忆时重建 Attachment（新 id，避免与现用附件冲突） */
export function fromHistoryEntry(entry: HistoryAttachment): Attachment {
  return {
    id: crypto.randomUUID(),
    type: entry.type,
    displayName: entry.displayName,
    ...(entry.relativePath ? { relativePath: entry.relativePath } : {}),
    ...(entry.url ? { url: entry.url } : {}),
    ...(entry.mime ? { mime: entry.mime } : {}),
    ...(entry.agentName ? { agentName: entry.agentName } : {}),
    ...(entry.skillId ? { skillId: entry.skillId } : {}),
  } as Attachment
}

function signature(entry: PromptHistoryEntry): string {
  return `${entry.text}${entry.attachments.map(a => `${a.type}:${a.displayName}:${a.relativePath ?? a.url ?? ''}`).join('')}`
}

class PromptHistoryStore {
  private normal: PromptHistoryEntry[] = []
  private shell: PromptHistoryEntry[] = []
  private loaded = false
  private listeners = new Set<() => void>()
  // 快照引用缓存：useSyncExternalStore 要求同状态返回同引用
  private normalSnapshot: PromptHistoryEntry[] = []
  private shellSnapshot: PromptHistoryEntry[] = []

  private ensureLoaded() {
    if (this.loaded) return
    this.loaded = true
    try {
      this.normal = JSON.parse(localStorage.getItem(KEY_NORMAL) ?? '[]')
      this.shell = JSON.parse(localStorage.getItem(KEY_SHELL) ?? '[]')
    } catch {
      this.normal = []
      this.shell = []
    }
    this.normalSnapshot = this.normal
    this.shellSnapshot = this.shell
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit() {
    this.listeners.forEach(listener => listener())
  }

  private list(mode: PromptHistoryMode): PromptHistoryEntry[] {
    return mode === 'shell' ? this.shell : this.normal
  }

  /** 最新在前 */
  entries(mode: PromptHistoryMode): PromptHistoryEntry[] {
    this.ensureLoaded()
    if (mode === 'shell') return this.shellSnapshot
    return this.normalSnapshot
  }

  /** 发送即记账（官方 prependHistoryEntry 同款：与最新一条相同则跳过） */
  add(text: string, attachments: Attachment[], mode: PromptHistoryMode) {
    this.ensureLoaded()
    const trimmed = text.trim()
    const serializable = toSerializable(attachments)
    if (!trimmed && serializable.length === 0) return
    const entry: PromptHistoryEntry = { text: trimmed, attachments: serializable }
    const list = this.list(mode)
    const last = list[0]
    if (last && signature(last) === signature(entry)) return
    const next = [entry, ...list].slice(0, MAX_HISTORY)
    this.commit(mode, next)
  }

  /** 发送失败移除（官方 removeHistoryEntry 同款：失败回填不应在历史里留重复） */
  remove(text: string, attachments: Attachment[], mode: PromptHistoryMode) {
    this.ensureLoaded()
    const entry: PromptHistoryEntry = { text: text.trim(), attachments: toSerializable(attachments) }
    const list = this.list(mode)
    const next = list.filter(item => signature(item) !== signature(entry))
    if (next.length === list.length) return
    this.commit(mode, next)
  }

  private commit(mode: PromptHistoryMode, next: PromptHistoryEntry[]) {
    if (mode === 'shell') {
      this.shell = next
      this.shellSnapshot = next
    } else {
      this.normal = next
      this.normalSnapshot = next
    }
    try {
      localStorage.setItem(mode === 'shell' ? KEY_SHELL : KEY_NORMAL, JSON.stringify(next))
    } catch {
      // 存储满/不可用时历史退化为内存态
    }
    this.emit()
  }

  /** 测试用：清空全部历史 */
  reset() {
    this.normal = []
    this.shell = []
    this.normalSnapshot = []
    this.shellSnapshot = []
    this.loaded = false
    try {
      localStorage.removeItem(KEY_NORMAL)
      localStorage.removeItem(KEY_SHELL)
    } catch {
      // 忽略
    }
    this.emit()
  }
}

export const promptHistoryStore = new PromptHistoryStore()

export function usePromptHistory(mode: PromptHistoryMode): PromptHistoryEntry[] {
  return useSyncExternalStore(promptHistoryStore.subscribe, () => promptHistoryStore.entries(mode))
}
