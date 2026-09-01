import { useState, useEffect, useCallback, useRef } from 'react'
import {
  getSessions,
  createSession,
  deleteSession,
  subscribeToEvents,
  subscribeToServerEvents,
  type ApiSession,
  type SessionListParams,
} from '../api'
import { serverStore } from '../store/serverStore'
import { pinnedSessionsStore } from '../store/pinnedSessionsStore'
import { autoDetectPathStyle, isSameDirectory } from '../utils'

// 会话列表加载失败的重试退避（毫秒）。退避间隔内仍算「加载中」，
// 不落空态——消费方据此区分「还在加载」与「确实没有对话」
const SESSION_RETRY_DELAYS_MS = [500, 1500, 3000]

function delay(ms: number): Promise<void> {
  return new Promise(resolve => {
    window.setTimeout(resolve, ms)
  })
}

interface UseSessionsOptions {
  /** 每页数量 */
  pageSize?: number
  /** 初始搜索词 */
  initialSearch?: string
  /** 只加载根会话 */
  rootsOnly?: boolean
  /** 按目录过滤 */
  directory?: string
  /** 延迟启用，用于懒加载 */
  enabled?: boolean
  /** 指定服务器（缺省用活动服务器）。多服务器模式下每个服务器一个实例 */
  serverId?: string
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
  /** 本地更新会话 */
  patchLocalSession: (sessionId: string, patch: Partial<ApiSession>) => void
  /** 本地移除会话 */
  removeLocalSession: (sessionId: string) => void
}

export function useSessions(options: UseSessionsOptions = {}): UseSessionsResult {
  const { pageSize = 20, initialSearch = '', rootsOnly = true, directory, enabled = true, serverId } = options

  // 标准化 directory 路径 (移除末尾斜杠，统一正斜杠)
  const normalizedDirectory = directory ? directory.replace(/\\/g, '/').replace(/\/$/, '') : undefined

  const [sessions, setSessions] = useState<ApiSession[]>([])
  const [isLoading, setIsLoading] = useState(enabled)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const [search, setSearch] = useState(initialSearch)

  // 用于跟踪最后一次请求，避免竞态条件
  const requestIdRef = useRef(0)
  // 防抖 timer
  const searchTimerRef = useRef<number | null>(null)
  // 当前 limit，loadMore 时递增（与 SessionContext 保持一致）
  const currentLimitRef = useRef(pageSize)
  const searchRef = useRef(search)
  // enabled 实时值：重试循环等待期间读取（懒加载闸门关闭时中断在途重试）
  const enabledRef = useRef(enabled)
  // 防止 onReconnected 密集触发时重复请求
  const isFetchingRef = useRef(false)
  const queuedReconnectRefreshRef = useRef(false)
  const fetchSessionsRef = useRef<(params?: SessionListParams & { append?: boolean }) => Promise<void>>(
    () => Promise.resolve(),
  )

  useEffect(() => {
    enabledRef.current = enabled
  }, [enabled])

  useEffect(() => {
    searchRef.current = search
  }, [search])

  const matchesDirectory = useCallback(
    (session: ApiSession) => !normalizedDirectory || isSameDirectory(normalizedDirectory, session.directory),
    [normalizedDirectory],
  )

  // 获取会话列表
  // append 仅用于控制 loading 状态：true 时用 isLoadingMore，false 时用 isLoading
  // 数据始终全量替换（递增 limit 策略）
  // 重试为显式循环而非 setTimeout 自调用：loading 的生命周期 = 循环的生命周期，
  // 重试空档不再以「空列表 + 非 loading」示人（空态文案闪现的根因）
  const fetchSessions = useCallback(
    async (params: SessionListParams & { append?: boolean } = {}) => {
      if (!enabled) return

      const { append = false, ...queryParams } = params
      const requestId = ++requestIdRef.current
      isFetchingRef.current = true

      if (append) {
        setIsLoadingMore(true)
      } else {
        setIsLoading(true)
        setError(null)
      }

      try {
        for (let retryAttempt = 0; ; retryAttempt++) {
          try {
            const data = await getSessions(
              {
                roots: rootsOnly,
                limit: currentLimitRef.current,
                directory: normalizedDirectory,
                ...queryParams,
              },
              serverId,
            )

            // 已被更新的请求覆盖：静默退出，不碰任何状态
            if (requestId !== requestIdRef.current) return

            if (data.length > 0 && data[0].directory) {
              // 按服务器记录路径风格（多服务器连不同操作系统时互不干扰）
              autoDetectPathStyle(data[0].directory, serverId)
            }

            setSessions(data)
            setHasMore(data.length >= currentLimitRef.current)
            setError(null)
            return
          } catch (e) {
            // 已被更新的请求覆盖：静默退出，状态恢复交给新请求的 finally
            if (requestId !== requestIdRef.current) return
            const exhausted = retryAttempt >= SESSION_RETRY_DELAYS_MS.length
            if (append || exhausted) {
              // 失败终态：error 落定后退出，finally 统一恢复 loading
              setError(e instanceof Error ? e : new Error('Failed to fetch sessions'))
              return
            }
            // 重试未耗尽 = 仍在加载：loading 不落地，按退避表等待后进入下一轮
            await delay(SESSION_RETRY_DELAYS_MS[retryAttempt])
            // 等待期间可能被新请求覆盖，或组件已禁用（懒加载闸门回退）
            if (requestId !== requestIdRef.current || !enabledRef.current) return
          }
        }
      } finally {
        if (requestId === requestIdRef.current) {
          isFetchingRef.current = false
          setIsLoading(false)
          setIsLoadingMore(false)
          if (queuedReconnectRefreshRef.current) {
            queuedReconnectRefreshRef.current = false
            setSessions([])
            void fetchSessionsRef.current({ search: searchRef.current || undefined })
          }
        }
      }
    },
    [rootsOnly, normalizedDirectory, enabled, serverId],
  )

  fetchSessionsRef.current = fetchSessions

  // 初始加载和搜索变化时重新加载
  useEffect(() => {
    if (!enabled) {
      setIsLoading(false)
      setIsLoadingMore(false)
      return
    }

    // 搜索或 enabled 变化时重置 limit
    currentLimitRef.current = pageSize

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
  }, [search, fetchSessions, enabled, pageSize])

  useEffect(() => {
    if (!enabled) return

    const subscribe = serverId
      ? (cb: Parameters<typeof subscribeToServerEvents>[1]) => subscribeToServerEvents(serverId, cb)
      : subscribeToEvents

    const unsubscribe = subscribe({
      onSessionCreated: session => {
        if (session.parentID) return
        if (!matchesDirectory(session)) return

        if (searchRef.current) {
          void fetchSessionsRef.current({ search: searchRef.current || undefined })
          return
        }

        setSessions(prev => {
          if (prev.some(item => item.id === session.id)) return prev
          return [session, ...prev]
        })
      },
      onSessionUpdated: session => {
        if (session.parentID) return

        if (searchRef.current) {
          if (matchesDirectory(session)) {
            void fetchSessionsRef.current({ search: searchRef.current || undefined })
          } else {
            setSessions(prev => prev.filter(item => item.id !== session.id))
          }
          return
        }

        setSessions(prev => {
          const index = prev.findIndex(item => item.id === session.id)

          if (!matchesDirectory(session)) {
            return index === -1 ? prev : prev.filter(item => item.id !== session.id)
          }

          if (index === -1) {
            return [session, ...prev]
          }

          const updated = prev.filter(item => item.id !== session.id)
          return [session, ...updated]
        })
      },
      onSessionDeleted: sessionId => {
        setSessions(prev => prev.filter(item => item.id !== sessionId))
      },
      onReconnected: reason => {
        if (reason === 'server-switch') return
        if (isFetchingRef.current) {
          queuedReconnectRefreshRef.current = true
          return
        }
        setSessions([])
        void fetchSessionsRef.current({ search: searchRef.current || undefined })
      },
    })

    return unsubscribe
  }, [enabled, matchesDirectory, pageSize, serverId])

  useEffect(() => {
    if (!enabled) return

    // 固定服务器订阅（多服务器模式）：不随 active server 切换刷新
    if (serverId) return

    return serverStore.onServerChange(() => {
      currentLimitRef.current = pageSize
      setSessions([])
      void fetchSessionsRef.current({ search: searchRef.current || undefined })
    })
  }, [enabled, pageSize, serverId])

  // 加载更多：递增 limit 重新拉取完整列表（与 SessionContext 一致）
  const loadMore = useCallback(async () => {
    if (!enabled || isLoadingMore || !hasMore || sessions.length === 0) return

    currentLimitRef.current += pageSize
    await fetchSessions({
      search: search || undefined,
      append: true,
    })
  }, [sessions, search, hasMore, isLoadingMore, fetchSessions, enabled, pageSize])

  // 刷新
  const refresh = useCallback(async () => {
    if (!enabled) return
    await fetchSessions({ search: search || undefined })
  }, [search, fetchSessions, enabled])

  // 创建新会话
  const create = useCallback(
    async (title?: string) => {
      // 创建时也要传 directory
      const newSession = await createSession(
        {
          title,
          directory: normalizedDirectory,
        },
        serverId,
      )

      if (searchRef.current) {
        void fetchSessionsRef.current({ search: searchRef.current || undefined })
      } else {
        setSessions(prev => {
          if (prev.some(session => session.id === newSession.id)) return prev
          return [newSession, ...prev]
        })
      }

      return newSession
    },
    [normalizedDirectory, serverId],
  )

  // 删除会话
  const remove = useCallback(
    async (sessionId: string) => {
      await deleteSession(sessionId, normalizedDirectory, serverId)
      pinnedSessionsStore.unpin(sessionId)
      setSessions(prev => prev.filter(s => s.id !== sessionId))
    },
    [normalizedDirectory, serverId],
  )

  const patchLocalSession = useCallback((sessionId: string, patch: Partial<ApiSession>) => {
    setSessions(prev => prev.map(session => (session.id === sessionId ? { ...session, ...patch } : session)))
  }, [])

  const removeLocalSession = useCallback((sessionId: string) => {
    setSessions(prev => prev.filter(session => session.id !== sessionId))
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
    patchLocalSession,
    removeLocalSession,
  }
}
