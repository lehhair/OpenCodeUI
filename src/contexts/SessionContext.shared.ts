import { createContext } from 'react'
import type { ApiSession } from '../api'

export interface SessionContextValue {
  sessions: ApiSession[]
  isLoading: boolean
  isLoadingMore: boolean
  hasMore: boolean
  search: string
  setSearch: (term: string) => void
  refresh: () => Promise<void>
  loadMore: () => Promise<void>
  createSession: (title?: string) => Promise<ApiSession>
  deleteSession: (id: string) => Promise<void>
}

export const SessionContext = createContext<SessionContextValue | null>(null)
