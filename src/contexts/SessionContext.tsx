import { useState, useCallback, useEffect, useRef, useMemo, type ReactNode } from 'react'
import {
  getSessions,
  createSession as apiCreateSession,
  deleteSession as apiDeleteSession,
  subscribeToEvents,
  type ApiSession,
  type SessionListParams,
} from '../api'
import { childSessionStore } from '../store/childSessionStore'
import { todoStore } from '../store/todoStore'
import { useDirectory } from './useDirectory'
import { sessionErrorHandler, normalizeToForwardSlash, isSameDirectory, autoDetectPathStyle } from '../utils'
import { SessionContext, type SessionContextValue } from './SessionContext.shared'

export function SessionProvider({ children }: { children: ReactNode }) {
  const { currentDirectory } = useDirectory()

  const [sessions, setSessions] = useState<ApiSession[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [search, setSearch] = useState('')

  const requestIdRef = useRef(0)
  const searchTimerRef = useRef<number | null>(null)
  const currentDirectoryRef = useRef(currentDirectory)
  const searchRef = useRef(search)
  const isLoadingMoreRef = useRef(false) // 防止并发 loadMore
  const fetchSessionsRef = useRef<() => Promise<void>>(() => Promise.resolve())
  const currentLimitRef = useRef(30) // 当前 limit，loadMore 时递增

  // 保持 ref 同步
  useEffect(() => {
    currentDirectoryRef.current = currentDirectory
  }, [currentDirectory])

  useEffect(() => {
    searchRef.current = search
  }, [search])

  // 核心获取逻辑
  // 注意：directory 传给 getSessions 时使用正斜杠格式
  // http 层的 fetchWithBothSlashesAndMerge 会处理两种斜杠格式的兼容
  const fetchSessions = useCallback(
    async (params: SessionListParams & { append?: boolean } = {}) => {
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
          limit: currentLimitRef.current,
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
          // 去重：过滤掉已存在的 session
          setSessions(prev => {
            const existingIds = new Set(prev.map(s => s.id))
            const newSessions = data.filter(s => !existingIds.has(s.id))
            return [...prev, ...newSessions]
          })
        } else {
          setSessions(data)
        }
        setHasMore(data.length >= currentLimitRef.current)
      } catch (e) {
        sessionErrorHandler('fetch sessions', e)
      } finally {
        if (requestId === requestIdRef.current) {
          setIsLoading(false)
          setIsLoadingMore(false)
        }
      }
    },
    [currentDirectory, search],
  )

  // 保持 fetchSessions ref 同步（用于 SSE onReconnected 回调）
  fetchSessionsRef.current = fetchSessions

  const matchesCurrentDirectory = useCallback((session: ApiSession) => {
    return !currentDirectoryRef.current || isSameDirectory(currentDirectoryRef.current, session.directory)
  }, [])

  // 监听 directory 和 search 变化
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)

    // 切换目录或搜索时重置 limit
    currentLimitRef.current = 30

    searchTimerRef.current = window.setTimeout(
      () => {
        fetchSessions()
      },
      search ? 300 : 0,
    )

    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    }
  }, [fetchSessions, search, currentDirectory])

  // 订阅 SSE 事件，实时更新 session 列表
  useEffect(() => {
    const unsubscribe = subscribeToEvents({
      onSessionCreated: session => {
        // 忽略子 session（有 parentID 的是子 agent 创建的）
        if (session.parentID) return

        if (!matchesCurrentDirectory(session)) return

        // 搜索态下交给服务端重新给出结果，避免本地过滤和服务端逻辑不一致
        if (searchRef.current) {
          fetchSessionsRef.current()
          return
        }

        setSessions(prev => {
          if (prev.some(s => s.id === session.id)) return prev
          return [session, ...prev]
        })
      },
      onSessionUpdated: session => {
        if (session.parentID) return

        if (searchRef.current) {
          if (matchesCurrentDirectory(session)) {
            fetchSessionsRef.current()
          } else {
            setSessions(prev => prev.filter(s => s.id !== session.id))
          }
          return
        }

        setSessions(prev => {
          const index = prev.findIndex(s => s.id === session.id)

          if (!matchesCurrentDirectory(session)) {
            return index === -1 ? prev : prev.filter(s => s.id !== session.id)
          }

          if (index === -1) {
            return [session, ...prev]
          }

          const updated = prev.filter(s => s.id !== session.id)
          return [session, ...updated]
        })
      },
      onTodoUpdated: data => {
        // 更新 todoStore
        todoStore.setTodos(data.sessionID, data.todos)
      },
      onReconnected: () => {
        // SSE 重连成功后
        // 清空旧 session 列表，重新从服务器拉取
        setSessions([])

        // 重新加载 session 列表
        fetchSessionsRef.current()
      },
    })

    return unsubscribe
  }, [matchesCurrentDirectory])

  // Actions
  const refresh = useCallback(() => fetchSessions(), [fetchSessions])

  const loadMore = useCallback(async () => {
    // 使用 ref 检查，防止并发请求
    if (isLoadingMoreRef.current || !hasMore || sessions.length === 0) return
    isLoadingMoreRef.current = true

    try {
      // 跟官方 webui 一样，递增 limit 重新请求整个列表
      currentLimitRef.current += 15
      setIsLoadingMore(true)
      await fetchSessions()
    } finally {
      isLoadingMoreRef.current = false
      setIsLoadingMore(false)
    }
  }, [hasMore, sessions, fetchSessions])

  const createSession = useCallback(
    async (title?: string) => {
      // 使用正斜杠格式传给后端
      const targetDir = normalizeToForwardSlash(currentDirectory) || undefined

      const newSession = await apiCreateSession({
        title,
        directory: targetDir,
      })
      return newSession
    },
    [currentDirectory],
  )

  const deleteSession = useCallback(
    async (id: string) => {
      const targetDir = normalizeToForwardSlash(currentDirectory) || undefined
      await apiDeleteSession(id, targetDir)
      // 清理该 session 的子 session 记录，防止内存泄漏
      childSessionStore.clearChildren(id)
      setSessions(prev => prev.filter(s => s.id !== id))
    },
    [currentDirectory],
  )

  // 稳定化 Provider value，避免每次渲染创建新对象导致子组件不必要重渲染
  const value = useMemo<SessionContextValue>(
    () => ({
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
    }),
    [sessions, isLoading, isLoadingMore, hasMore, search, refresh, loadMore, createSession, deleteSession],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}
