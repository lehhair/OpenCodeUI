import { useState, useCallback, useEffect, useRef, useMemo, type ReactNode } from 'react'
import {
  getSessions,
  createSession as apiCreateSession,
  deleteSession as apiDeleteSession,
  subscribeToEvents,
  type ApiSession,
  type SessionListParams,
} from '../api'
import { affectsBoundServer } from '../store/serverChangeScope'
import { serverStore } from '../store/serverStore'
import { pinnedSessionsStore } from '../store/pinnedSessionsStore'
import { useDirectory } from './useDirectory'
import { sessionErrorHandler, normalizeToForwardSlash, isSameDirectory, autoDetectPathStyle } from '../utils'
import { clearSessionRuntimeState } from '../utils/sessionLifecycle'
import { SessionContext, type SessionContextValue } from './SessionContext.shared'
import type { ModelRef } from '../types/message'

/**
 * 去掉补丁里的 `undefined` 字段
 *
 * V2 的会话元信息事件是**部分字段**（`session.renamed` 只有 title、
 * `session.moved` 只有 directory …），缺省项在事件层会被填成 `undefined`。
 * 直接 `{...prev, ...patch}` 会把已有字段**覆盖成 undefined**，
 * 所以合并前必须先剔除。
 */
function stripUndefined<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as Partial<T>
}

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
  const isFetchingRef = useRef(false) // 防止 onReconnected 密集触发时重复请求
  const queuedReconnectRefreshRef = useRef(false)
  const retryTimerRef = useRef<number | null>(null)
  const fetchSessionsRef = useRef<
    (params?: SessionListParams & { append?: boolean; retryAttempt?: number }) => Promise<void>
  >(() => Promise.resolve())
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
    async (params: SessionListParams & { append?: boolean; retryAttempt?: number } = {}) => {
      const { append = false, retryAttempt = 0, ...queryParams } = params
      const requestId = ++requestIdRef.current
      isFetchingRef.current = true

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
        if (requestId === requestIdRef.current && !append) {
          if (retryAttempt < 3) {
            if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
            retryTimerRef.current = window.setTimeout(() => {
              if (requestId !== requestIdRef.current) return
              void fetchSessions({ ...queryParams, retryAttempt: retryAttempt + 1 })
            }, [500, 1500, 3000][retryAttempt])
          } else {
            setSessions([])
            setHasMore(false)
          }
        }
        sessionErrorHandler('fetch sessions', e)
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
    [currentDirectory, search],
  )

  // 保持 fetchSessions ref 同步（用于 SSE onReconnected 回调）
  fetchSessionsRef.current = fetchSessions

  const matchesCurrentDirectory = useCallback((session: { directory?: string }) => {
    return !currentDirectoryRef.current || isSameDirectory(currentDirectoryRef.current, session.directory ?? '')
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
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
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
      onSessionUpdated: patch => {
        if (patch.parentID) return

        if (searchRef.current) {
          if (matchesCurrentDirectory(patch)) {
            fetchSessionsRef.current()
          } else {
            setSessions(prev => prev.filter(s => s.id !== patch.id))
          }
          return
        }

        setSessions(prev => {
          const index = prev.findIndex(s => s.id === patch.id)

          // V2 的会话元信息变更只给**变化的字段**（renamed / metadata.updated / moved …），
          // 所以这里必须**合并**而不是整体替换；缺失的目录表示"目录没变"。
          if (!matchesCurrentDirectory(patch) && patch.directory) {
            return index === -1 ? prev : prev.filter(s => s.id !== patch.id)
          }

          // 本地列表里没有这条会话时无法凭补丁拼出完整对象 → 交给服务端重查
          if (index === -1) {
            fetchSessionsRef.current()
            return prev
          }

          const merged = { ...prev[index], ...stripUndefined(patch) }
          const updated = prev.filter(s => s.id !== patch.id)
          return [merged, ...updated]
        })
      },
      onSessionDeleted: data => {
        clearSessionRuntimeState(data.sessionID)
        setSessions(prev => prev.filter(s => s.id !== data.sessionID))
      },
      onReconnected: reason => {
        if (reason === 'server-switch') return
        if (isFetchingRef.current) {
          queuedReconnectRefreshRef.current = true
          return
        }
        setSessions([])
        fetchSessionsRef.current()
      },
    })

    return unsubscribe
  }, [matchesCurrentDirectory])

  useEffect(() => {
    return serverStore.onServerChange((serverId, reason) => {
      // 会话列表跟随 active server：非 active 服务器端点变化（WSL 重启）不影响本列表，
      // 避免无关事件触发「清空 → 重拉」的可见闪烁；只有 active 数据源真的变了才重置
      if (!affectsBoundServer(undefined, serverId, reason, serverStore.getActiveServerId())) return
      currentLimitRef.current = 30
      setSessions([])
      void fetchSessionsRef.current()
    })
  }, [])

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
    async (title?: string, model?: ModelRef) => {
      // 使用正斜杠格式传给后端
      const targetDir = normalizeToForwardSlash(currentDirectory) || undefined

      const newSession = await apiCreateSession({
        title,
        // V2：模型是会话级的 —— 带上调用方指定的模型（通常是界面当前选择）。
        // 否则新会话起在服务端默认模型上，发送前才被 switchModel 纠正，
        // 会在转录顶部留下一条多余的「切换模型」标记。
        model,
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
      pinnedSessionsStore.unpin(id)
      clearSessionRuntimeState(id)
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
