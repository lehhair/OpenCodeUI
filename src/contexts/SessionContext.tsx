import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react'
import { 
  getSessions, 
  createSession as apiCreateSession, 
  deleteSession as apiDeleteSession, 
  subscribeToEvents,
  type ApiSession, 
  type SessionListParams 
} from '../api'
import { useDirectory } from './DirectoryContext'
import { sessionErrorHandler, normalizeToForwardSlash, isSameDirectory, autoDetectPathStyle } from '../utils'

interface SessionContextValue {
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
  currentSessionId: string | null
  setCurrentSessionId: (id: string | null) => void
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const { currentDirectory } = useDirectory()
  
  const [sessions, setSessions] = useState<ApiSession[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [search, setSearch] = useState('')
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)

  const requestIdRef = useRef(0)
  const searchTimerRef = useRef<number | null>(null)
  const currentDirectoryRef = useRef(currentDirectory)
  
  // 保持 ref 同步
  useEffect(() => {
    currentDirectoryRef.current = currentDirectory
  }, [currentDirectory])
  
  // 核心获取逻辑
  // 注意：directory 传给 getSessions 时使用正斜杠格式
  // http 层的 fetchWithBothSlashesAndMerge 会处理两种斜杠格式的兼容
  const fetchSessions = useCallback(async (params: SessionListParams & { append?: boolean } = {}) => {
    const { append = false, ...queryParams } = params
    const requestId = ++requestIdRef.current

    if (append) {
      setIsLoadingMore(true)
    } else {
      setIsLoading(true)
    }

    try {
      // 使用正斜杠格式传给 API（http 层会处理兼容）
      const targetDir = normalizeToForwardSlash(currentDirectory) || undefined

      const data = await getSessions({
        roots: true,
        limit: 30,
        directory: targetDir,
        search: search || undefined,
        ...queryParams,
      })

      if (requestId !== requestIdRef.current) return

      // 自动检测路径风格（从后端返回的 directory 字段）
      if (data.length > 0 && data[0].directory) {
        autoDetectPathStyle(data[0].directory)
      }

      if (append) {
        setSessions(prev => [...prev, ...data])
      } else {
        setSessions(data)
      }
      setHasMore(data.length >= 30)
    } catch (e) {
      sessionErrorHandler('fetch sessions', e)
    } finally {
      if (requestId === requestIdRef.current) {
        setIsLoading(false)
        setIsLoadingMore(false)
      }
    }
  }, [currentDirectory, search])

  // 监听 directory 和 search 变化
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    
    searchTimerRef.current = window.setTimeout(() => {
      fetchSessions()
    }, search ? 300 : 0)

    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    }
  }, [fetchSessions, search, currentDirectory])

  // 订阅 SSE 事件，实时更新 session 列表
  useEffect(() => {
    const unsubscribe = subscribeToEvents({
      onSessionCreated: (session) => {
        // 忽略子 session（有 parentID 的是子 agent 创建的）
        if (session.parentID) return
        
        // 使用 isSameDirectory 比较，处理斜杠和大小写差异
        if (isSameDirectory(currentDirectoryRef.current, session.directory)) {
          setSessions(prev => {
            // 避免重复
            if (prev.some(s => s.id === session.id)) return prev
            return [session, ...prev]
          })
        }
      },
      onSessionUpdated: (session) => {
        setSessions(prev => {
          const index = prev.findIndex(s => s.id === session.id)
          if (index === -1) return prev
          
          const updated = [...prev]
          updated[index] = session
          return updated
        })
      },
    })

    return unsubscribe
  }, [])

  // Actions
  const refresh = useCallback(() => fetchSessions(), [fetchSessions])

  const loadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore || sessions.length === 0) return
    const lastSession = sessions[sessions.length - 1]
    await fetchSessions({ start: lastSession.time.updated, append: true })
  }, [isLoadingMore, hasMore, sessions, fetchSessions])

  const createSession = useCallback(async (title?: string) => {
    // 使用正斜杠格式传给后端
    const targetDir = normalizeToForwardSlash(currentDirectory) || undefined
    
    const newSession = await apiCreateSession({ 
      title,
      directory: targetDir
    })
    // SSE 会处理添加到列表，这里只是更新 currentSessionId
    setCurrentSessionId(newSession.id)
    return newSession
  }, [currentDirectory])

  const deleteSession = useCallback(async (id: string) => {
    const targetDir = normalizeToForwardSlash(currentDirectory) || undefined
    await apiDeleteSession(id, targetDir)
    setSessions(prev => prev.filter(s => s.id !== id))
    if (currentSessionId === id) setCurrentSessionId(null)
  }, [currentSessionId, currentDirectory])

  return (
    <SessionContext.Provider value={{
      sessions,
      isLoading,
      isLoadingMore,
      hasMore,
      search,
      setSearch,
      refresh,
      loadMore,
      createSession,
      deleteSession,
      currentSessionId,
      setCurrentSessionId
    }}>
      {children}
    </SessionContext.Provider>
  )
}

export function useSessionContext() {
  const context = useContext(SessionContext)
  if (!context) {
    throw new Error('useSessionContext must be used within a SessionProvider')
  }
  return context
}
