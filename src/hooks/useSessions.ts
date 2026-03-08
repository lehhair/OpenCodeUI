import { useState, useEffect, useCallback, useRef } from 'react'
import { getSessions, createSession, deleteSession, type ApiSession, type SessionListParams } from '../api'

interface UseSessionsOptions {
  /** 每页数量 */
  pageSize?: number
  /** 初始搜索词 */
  initialSearch?: string
  /** 只加载根会话 */
  rootsOnly?: boolean
  /** 按目录过滤 */
  directory?: string
}

interface UseSessionsResult {
  sessions: ApiSession[]
  isLoading: boolean
  isLoadingMore: boolean
  error: Error | null
  hasMore: boolean
  /** 搜索词 */
  search: string
  setSearch: (search: string) => void
  /** 加载更多 */
  loadMore: () => Promise<void>
  /** 刷新列表 */
  refresh: () => Promise<void>
  /** 创建新会话 */
  create: (title?: string) => Promise<ApiSession>
  /** 删除会话 */
  remove: (sessionId: string) => Promise<void>
}

export function useSessions(options: UseSessionsOptions = {}): UseSessionsResult {
  const { pageSize = 20, initialSearch = '', rootsOnly = true, directory } = options

  // 标准化 directory 路径 (移除末尾斜杠，统一正斜杠)
  const normalizedDirectory = directory ? directory.replace(/\\/g, '/').replace(/\/$/, '') : undefined

  const [sessions, setSessions] = useState<ApiSession[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const [search, setSearch] = useState(initialSearch)

  // 用于跟踪最后一次请求，避免竞态条件
  const requestIdRef = useRef(0)
  // 防抖 timer
  const searchTimerRef = useRef<number | null>(null)

  // 获取会话列表
  const fetchSessions = useCallback(
    async (params: SessionListParams & { append?: boolean } = {}) => {
      const { append = false, ...queryParams } = params
      const requestId = ++requestIdRef.current

      if (append) {
        setIsLoadingMore(true)
      } else {
        setIsLoading(true)
        setError(null)
      }

      try {
        const data = await getSessions({
          roots: rootsOnly,
          limit: pageSize,
          directory: normalizedDirectory,
          ...queryParams,
        })

        // 检查是否是最新的请求
        if (requestId !== requestIdRef.current) return

        if (append) {
          setSessions(prev => [...prev, ...data])
        } else {
          setSessions(data)
        }

        // 如果返回的数量小于 pageSize，说明没有更多了
        setHasMore(data.length >= pageSize)
      } catch (e) {
        if (requestId !== requestIdRef.current) return
        setError(e instanceof Error ? e : new Error('Failed to fetch sessions'))
      } finally {
        if (requestId === requestIdRef.current) {
          setIsLoading(false)
          setIsLoadingMore(false)
        }
      }
    },
    [pageSize, rootsOnly, normalizedDirectory],
  )

  // 初始加载和搜索变化时重新加载
  useEffect(() => {
    // 防抖处理搜索
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current)
    }

    searchTimerRef.current = window.setTimeout(
      () => {
        fetchSessions({ search: search || undefined })
      },
      search ? 300 : 0,
    ) // 有搜索词时延迟 300ms，无搜索词时立即执行

    return () => {
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current)
      }
    }
  }, [search, fetchSessions])

  // 加载更多
  const loadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore || sessions.length === 0) return

    // 使用最后一个 session 的更新时间作为游标
    const lastSession = sessions[sessions.length - 1]
    const startTime = lastSession.time.updated

    await fetchSessions({
      search: search || undefined,
      start: startTime,
      append: true,
    })
  }, [sessions, search, hasMore, isLoadingMore, fetchSessions])

  // 刷新
  const refresh = useCallback(async () => {
    await fetchSessions({ search: search || undefined })
  }, [search, fetchSessions])

  // 创建新会话
  const create = useCallback(
    async (title?: string) => {
      // 创建时也要传 directory
      const newSession = await createSession({
        title,
        directory: normalizedDirectory,
      })
      // 添加到列表开头
      setSessions(prev => [newSession, ...prev])
      return newSession
    },
    [normalizedDirectory],
  )

  // 删除会话
  const remove = useCallback(async (sessionId: string) => {
    await deleteSession(sessionId)
    // 从列表中移除
    setSessions(prev => prev.filter(s => s.id !== sessionId))
  }, [])

  return {
    sessions,
    isLoading,
    isLoadingMore,
    error,
    hasMore,
    search,
    setSearch,
    loadMore,
    refresh,
    create,
    remove,
  }
}
