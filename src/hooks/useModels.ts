import { useSyncExternalStore, useCallback, useEffect } from 'react'
import { getActiveModels, type ModelInfo } from '../api'
import { getSDKClientAsync } from '../api/sdk'
import { serverStore } from '../store/serverStore'

// ============================================
// Per-server models cache — 每个服务器独立维护模型列表。
//
// 多服务器模式：每个 pane 绑定自己的服务器，模型选择器必须显示
// 该 pane 服务器的模型（而不是活动服务器的）。
// 单例缓存避免重复 API 请求与"后挂载 pane 看到空列表"的竞态。
// ============================================

interface ModelsState {
  models: ModelInfo[]
  isLoading: boolean
  error: Error | null
}

type Listener = () => void

const _states = new Map<string, ModelsState>()
const _fetchPromises = new Map<string, Promise<void> | null>()
const _fetchGenerations = new Map<string, number>()
const _listeners = new Set<Listener>()

function _getState(serverId: string): ModelsState {
  return _states.get(serverId) ?? { models: [], isLoading: true, error: null }
}

function _notify() {
  for (const fn of _listeners) fn()
}

function _setState(serverId: string, patch: Partial<ModelsState>) {
  const next = { ..._getState(serverId), ...patch }
  _states.set(serverId, next)
  _notify()
}

async function _fetchModels(serverId: string, force = false) {
  const existing = _fetchPromises.get(serverId)
  if (existing && !force) return existing

  const generation = (_fetchGenerations.get(serverId) ?? 0) + 1
  _fetchGenerations.set(serverId, generation)

  const promise = (async () => {
    _setState(serverId, { isLoading: true, error: null })
    try {
      await getSDKClientAsync(serverId)
      const data = await getActiveModels(undefined, serverId)
      if (generation === _fetchGenerations.get(serverId)) {
        _setState(serverId, { models: data, isLoading: false })
      }
    } catch (e) {
      if (generation === _fetchGenerations.get(serverId)) {
        _setState(serverId, { error: e instanceof Error ? e : new Error('Failed to fetch models'), isLoading: false })
      }
    } finally {
      if (generation === _fetchGenerations.get(serverId)) {
        _fetchPromises.set(serverId, null)
      }
    }
  })()

  _fetchPromises.set(serverId, promise)
  return promise
}

/** 强制刷新指定服务器（缺省 = 活动服务器）的模型列表 */
export function refreshModels(serverId?: string) {
  const sid = serverId ?? serverStore.getActiveServerId()
  return _fetchModels(sid, true)
}

// 预取活动服务器的模型 — 组件挂载前模型就已就绪
_fetchModels(serverStore.getActiveServerId())

serverStore.onServerChange((serverId, reason) => {
  // 只为「UI 正在消费的服务器」刷新模型：
  // - server-switch：active 变了 → 需要新服务器的模型列表
  // - server-runtime-updated：仅当变的是 active 自身（WSL 换端口重启）才值得重拉；
  //   非 active 服务器换端点与模型栏无关，切过去时 server-switch 会拉到
  if (reason === 'server-runtime-updated' && serverStore.getActiveServerId() !== serverId) return
  void refreshModels(serverId)
})

function _subscribe(listener: Listener) {
  _listeners.add(listener)
  return () => _listeners.delete(listener)
}

// ============================================
// Hook — 指定服务器（缺省跟随活动服务器）
// ============================================

interface UseModelsResult {
  models: ModelInfo[]
  isLoading: boolean
  error: Error | null
  refetch: () => Promise<void>
}

export function useModels(serverId?: string): UseModelsResult {
  const activeServerId = useSyncExternalStore(
    cb => serverStore.subscribe(cb),
    () => serverStore.getActiveServerId(),
    () => serverStore.getActiveServerId(),
  )
  const resolvedServerId = serverId ?? activeServerId

  const state = useSyncExternalStore(
    _subscribe,
    () => _getState(resolvedServerId),
    () => _getState(resolvedServerId),
  )

  // 首次挂载或服务器变化时确保已拉取
  useEffect(() => {
    void _fetchModels(resolvedServerId)
  }, [resolvedServerId])

  const refetch = useCallback(() => refreshModels(resolvedServerId), [resolvedServerId])

  return {
    models: state.models,
    isLoading: state.isLoading,
    error: state.error,
    refetch,
  }
}
