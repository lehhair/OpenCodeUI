import { useSyncExternalStore, useCallback, useEffect } from 'react'
import { getActiveModels, getProviders, type Model, type Provider } from '../api'
import { getSDKClientAsync } from '../api/sdk'
import { serverStore, subscribeServerStore } from '../store/serverStore'

// ============================================
// Per-server models cache — 每个服务器独立维护模型列表。
//
// 多服务器模式：每个 pane 绑定自己的服务器，模型选择器必须显示
// 该 pane 服务器的模型（而不是活动服务器的）。
// 单例缓存避免重复 API 请求与"后挂载 pane 看到空列表"的竞态。
// ============================================

interface ModelsState {
  models: Model[]
  providers: Provider[]
  isLoading: boolean
  error: Error | null
  /** 是否成功拉到过一次（区分「真为空」与「还没拉到」） */
  fetchedOnce: boolean
}

type Listener = () => void

const _states = new Map<string, ModelsState>()
const _fetchPromises = new Map<string, Promise<void> | null>()
const _fetchGenerations = new Map<string, number>()
const _listeners = new Set<Listener>()

function _getState(serverId: string): ModelsState {
  return _states.get(serverId) ?? { models: [], providers: [], isLoading: true, error: null, fetchedOnce: false }
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
      // 模型与 provider 目录是两个独立原生资源（官方同样分开 sync）
      const [models, providers] = await Promise.all([
        getActiveModels(undefined, serverId),
        getProviders(undefined, serverId).catch(() => [] as Provider[]),
      ])
      if (generation === _fetchGenerations.get(serverId)) {
        _setState(serverId, { models, providers, isLoading: false, fetchedOnce: true })
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

/**
 * 仅在不健康时刷新（从未拉成功过 / 上次失败）。
 *
 * 用在 SSE `server.connected`（含首次连接）上：App 启动先于服务器就绪时
 * 预取必然失败，没有这条补拉路径的话模型/agent/思考等级会**永远空着，
 * 只能手动刷新**（官方做法：每次 server.connected 都 refetch bootstrap，
 * 见 packages/app/src/runtime/server/server-sync/connection.ts）。
 * 数据健康时什么都不做，避免每次重连都白白重拉。
 */
export function ensureModelsFresh(serverId?: string) {
  const sid = serverId ?? serverStore.getActiveServerId()
  const state = _getState(sid)
  if (state.isLoading) return
  if (state.fetchedOnce && !state.error) return
  void _fetchModels(sid, true)
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
  models: Model[]
  providers: Provider[]
  isLoading: boolean
  error: Error | null
  refetch: () => Promise<void>
}

export function useModels(serverId?: string): UseModelsResult {
  const activeServerId = useSyncExternalStore(
    subscribeServerStore,
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
    providers: state.providers,
    isLoading: state.isLoading,
    error: state.error,
    refetch,
  }
}
