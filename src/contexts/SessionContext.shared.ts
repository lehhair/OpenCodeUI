import { createContext } from 'react'
import type { ApiSession } from '../api'
import type { ModelRef } from '../types/message'

export interface SessionContextValue {
  sessions: ApiSession[]
  isLoading: boolean
  isLoadingMore: boolean
  hasMore: boolean
  search: string
  setSearch: (term: string) => void
  refresh: () => Promise<void>
  loadMore: () => Promise<void>
  /**
   * 新建会话。
   *
   * @param title 会话标题（可选）
   * @param model V2 的模型是**会话级**的 —— 新建时带上界面所选模型，
   *              避免会话起在服务端默认模型上（见 src/api/message.ts 的 syncSessionModel）
   */
  createSession: (title?: string, model?: ModelRef) => Promise<ApiSession>
  deleteSession: (id: string) => Promise<void>
}

export const SessionContext = createContext<SessionContextValue | null>(null)
