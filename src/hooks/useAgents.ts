// ============================================
// useAgents - 共享的 agents 目录缓存（OpenCode v2）
// ============================================
//
// 设计对齐官方 app 的 location 级 sync store：
// （packages/app/src/runtime/server/global-sync/child-store.ts）
//
//   - 读取方（输入框 agent 选择器等）只读 store，不自己发请求
//   - 按 (serverId, directory) 缓存，多 pane 同目录共享一份、不重复拉取
//   - server.connected（含首次连接）时对健康度兜底补拉（ensureServerAgentsFresh）
//   - agent.updated / config.updated 事件触发整服务器刷新（refreshServerAgents）
//
// 这取代了旧的「pane 级 useState 拉一次」实现：那种实现下，App 启动先于
// 服务器就绪时 agents 必拉空且无任何重试路径，agent 选择器只能手动刷新。
// ============================================

import { useSyncExternalStore, useCallback, useEffect } from 'react'
import { getSelectableAgents } from '../api'
import { serverStore, subscribeServerStore } from '../store/serverStore'
import { normalizePathSeparators } from '../utils/pathUtils'
import type { Agent } from '../types/api/agent'

interface AgentsState {
  agents: Agent[]
  isLoading: boolean
  error: Error | null
  /** 是否成功拉到过一次（区分「真为空」与「还没拉到」） */
  fetchedOnce: boolean
}

type Listener = () => void

const _states = new Map<string, AgentsState>()
const _fetchPromises = new Map<string, Promise<void> | null>()
const _fetchGenerations = new Map<string, number>()
const _listeners = new Set<Listener>()

function _key(serverId: string, directory?: string) {
  return `${serverId}::${directory ? normalizePathSeparators(directory) : ''}`
}

function _getState(key: string): AgentsState {
  return _states.get(key) ?? { agents: [], isLoading: true, error: null, fetchedOnce: false }
}

function _notify() {
  for (const fn of _listeners) fn()
}

function _setState(key: string, patch: Partial<AgentsState>) {
  _states.set(key, { ..._getState(key), ...patch })
  _notify()
}

async function _fetchAgents(key: string, serverId: string, directory: string | undefined, force = false) {
  const existing = _fetchPromises.get(key)
  if (existing && !force) return existing

  const generation = (_fetchGenerations.get(key) ?? 0) + 1
  _fetchGenerations.set(key, generation)

  const promise = (async () => {
    _setState(key, { isLoading: true, error: null })
    try {
      const agents = await getSelectableAgents(directory, serverId)
      if (generation === _fetchGenerations.get(key)) {
        _setState(key, { agents, isLoading: false, fetchedOnce: true })
      }
    } catch (e) {
      if (generation === _fetchGenerations.get(key)) {
        _setState(key, { error: e instanceof Error ? e : new Error('Failed to fetch agents'), isLoading: false })
      }
    } finally {
      if (generation === _fetchGenerations.get(key)) {
        _fetchPromises.set(key, null)
      }
    }
  })()

  _fetchPromises.set(key, promise)
  return promise
}

/** 强制刷新某个 (服务器, 目录) 的 agents */
export function refreshAgents(serverId?: string, directory?: string) {
  const sid = serverId ?? serverStore.getActiveServerId()
  const key = _key(sid, directory)
  return _fetchAgents(key, sid, directory, true)
}

/**
 * 仅在不健康时刷新（从未拉成功过 / 上次失败）。
 * 用在 SSE server.connected（含首次连接）上——对齐官方每次连接都
 * refetch bootstrap 的行为，但健康时不重复请求。
 */
export function ensureAgentsFresh(serverId?: string, directory?: string) {
  const sid = serverId ?? serverStore.getActiveServerId()
  const key = _key(sid, directory)
  const state = _getState(key)
  if (state.isLoading) return
  if (state.fetchedOnce && !state.error) return
  void _fetchAgents(key, sid, directory, true)
}

function _forEachServerKey(serverId: string, fn: (key: string, directory: string | undefined) => void) {
  const prefix = `${serverId}::`
  for (const key of _states.keys()) {
    if (!key.startsWith(prefix)) continue
    const directory = key.slice(prefix.length) || undefined
    fn(key, directory)
  }
}

/** server.connected 兜底：该服务器所有已缓存目录里不健康的都补拉 */
export function ensureServerAgentsFresh(serverId: string) {
  _forEachServerKey(serverId, (key, directory) => {
    const state = _getState(key)
    if (state.isLoading) return
    if (state.fetchedOnce && !state.error) return
    void _fetchAgents(key, serverId, directory, true)
  })
}

/** agent.updated / config.updated：该服务器所有已缓存目录强制刷新 */
export function refreshServerAgents(serverId: string) {
  _forEachServerKey(serverId, (key, directory) => {
    void _fetchAgents(key, serverId, directory, true)
  })
}

// ============================================
// Hook — 指定目录与服务器（缺省跟随活动服务器）
// ============================================

interface UseAgentsResult {
  agents: Agent[]
  isLoading: boolean
  error: Error | null
  refetch: () => Promise<void>
}

export function useAgents(directory?: string, serverId?: string): UseAgentsResult {
  const activeServerId = useSyncExternalStore(
    subscribeServerStore,
    () => serverStore.getActiveServerId(),
    () => serverStore.getActiveServerId(),
  )
  const resolvedServerId = serverId ?? activeServerId
  const normalizedDirectory = directory ? normalizePathSeparators(directory) : undefined
  const key = _key(resolvedServerId, normalizedDirectory)

  const state = useSyncExternalStore(
    useCallback((cb: Listener) => {
      _listeners.add(cb)
      return () => {
        _listeners.delete(cb)
      }
    }, []),
    () => _getState(key),
    () => _getState(key),
  )

  // 首次挂载或 目录/服务器 变化时确保已拉取
  useEffect(() => {
    void _fetchAgents(key, resolvedServerId, normalizedDirectory)
  }, [key, resolvedServerId, normalizedDirectory])

  const refetch = useCallback(
    () => refreshAgents(resolvedServerId, normalizedDirectory),
    [resolvedServerId, normalizedDirectory],
  )

  return {
    agents: state.agents,
    isLoading: state.isLoading,
    error: state.error,
    refetch,
  }
}
