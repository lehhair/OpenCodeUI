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
import { affectsBoundServer } from '../store/serverChangeScope'
import { serverStore } from '../store/serverStore'
import { pinnedSessionsStore } from '../store/pinnedSessionsStore'
import { autoDetectPathStyle, isSameDirectory } from '../utils'

// 会话列表加载失败的重试退避（毫秒）。退避间隔内仍算「加载中」，
// 不落空态——消费方据此区分「还在加载」与「确实没有对话」
const SESSION_RETRY_DELAYS_MS = [500, 1500, 3000]

/**
 * 去掉补丁里的 `undefined` 字段
 *
 * V2 把 V1 的 `session.updated` 拆成了多个事件（renamed / metadata.updated /
 * agent.selected / model.selected / moved），每个只带**变化的字段**；
 * 事件层把缺省项填成 `undefined`。直接 `{...prev, ...patch}` 会把已有字段
 * 覆盖成 undefined → 合并前必须先剔除。
 */
function stripUndefined<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as Partial<T>
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
  const fetchSessionsRef = useRef<(params?: SessionListParams & { append?: boolean }) => Promise<void>>(() =>
    Promise.resolve(),
  )
  // 重试退避的在途句柄：unmount 时清 timer 并唤醒循环，防止组件消失后仍继续发请求
  const pendingRetryRef = useRef<{ cancel: () => void } | null>(null)
  // 卸载标记：重试循环与 finally 的后续动作据此整体退出（React 卸载后不应再有网络/状态动作）
  const unmountedRef = useRef(false)

  // unmount 中断在途重试（对齐旧实现 retryTimerRef 的清理语义）
  useEffect(() => {
    unmountedRef.current = false
    return () => {
      unmountedRef.current = true
      pendingRetryRef.current?.cancel()
    }
  }, [])

  useEffect(() => {
    enabledRef.current = enabled
  }, [enabled])

  useEffect(() => {
    searchRef.current = search
  }, [search])

  const matchesDirectory = useCallback(
    (session: { directory?: string }) =>
      !normalizedDirectory || isSameDirectory(normalizedDirectory, session.directory ?? ''),
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
            // 重试未耗尽 = 仍在加载：loading 不落地，按退避表等待后进入下一轮。
            // 等待做成「可取消」：unmount 的 cleanup 会清 timer 并立即 resolve，
            // 循环经下面的 unmounted 检查正常退出，不会再发重试请求
            await new Promise<void>(resolve => {
              const timer = window.setTimeout(() => {
                pendingRetryRef.current = null
                resolve()
              }, SESSION_RETRY_DELAYS_MS[retryAttempt])
              pendingRetryRef.current = {
                cancel: () => {
                  window.clearTimeout(timer)
                  pendingRetryRef.current = null
                  resolve()
                },
              }
            })
            // 等待期间可能被新请求覆盖、组件已禁用（懒加载闸门回退）或已卸载
            if (unmountedRef.current || requestId !== requestIdRef.current || !enabledRef.current) return
          }
        }
      } finally {
        // 卸载后状态与排队动作整体跳过：退避 promise 被 cancel 唤醒时 finally 也会执行
        if (!unmountedRef.current && requestId === requestIdRef.current) {
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
      onSessionUpdated: patch => {
        if (patch.parentID) return

        if (searchRef.current) {
          if (matchesDirectory(patch)) {
            void fetchSessionsRef.current({ search: searchRef.current || undefined })
          } else {
            setSessions(prev => prev.filter(item => item.id !== patch.id))
          }
          return
        }

        setSessions(prev => {
          const index = prev.findIndex(item => item.id === patch.id)

          // V2 的会话元信息事件只给**变化的字段** → 必须合并而不是整体替换；
          // 缺失的 directory 表示"目录没变"，不能当作"不在本目录"而误删
          if (patch.directory !== undefined && !matchesDirectory(patch)) {
            return index === -1 ? prev : prev.filter(item => item.id !== patch.id)
          }

          // 本地列表里没有这条会话时无法凭补丁拼出完整对象 → 交给服务端重查
          if (index === -1) {
            void fetchSessionsRef.current({ search: searchRef.current || undefined })
            return prev
          }

          const merged = { ...prev[index], ...stripUndefined(patch) }
          const updated = prev.filter(item => item.id !== patch.id)
          return [merged, ...updated]
        })
      },
      onSessionDeleted: data => {
        setSessions(prev => prev.filter(item => item.id !== data.sessionID))
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

    return serverStore.onServerChange((changedServerId, reason) => {
      // 本实例跟随 active server：非 active 服务器端点变化（WSL 重启）与列表无关，
      // 不该触发「清空 → 重拉」；仅 active 换了或变的这台就是 active 时才重置
      if (!affectsBoundServer(undefined, changedServerId, reason, serverStore.getActiveServerId())) return
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
