// ============================================
// WSL Store —— 对齐官方 packages/app/src/wsl/context.tsx：
// 单一状态树由后端事件全量推送，store 只做订阅与粘合
// （把 WSL 服务器的 runtime 同步进 serverStore，供聊天界面选择服务器）
// ============================================

import { useSyncExternalStore } from 'react'
import type { WslServersState, WslServersEvent, WslServerItem } from '../features/wsl/types'
import { wslApi, subscribeWslState } from '../api/wsl'
import { serverStore, WSL_SERVER_PREFIX } from './serverStore'
import { multiServerStore } from './multiServerStore'
import { isTauri } from '../utils/tauri'

type Listener = () => void

interface WslStoreSnapshot {
  state: WslServersState | null
}

/**
 * 启动恢复判定（纯函数，独立导出便于测试）：
 * 默认服务器偏好优先（官方 defaultKey 语义：默认服务器是 WSL → 就绪后切回），
 * 否则回退「上次关闭时用户停留的 WSL 服务器」。只关心 WSL 目标——非 WSL 的
 * 启动偏好在 serverStore 加载时已直接生效，无需恢复。
 */
export function resolveWslBootTarget(input: {
  defaultServerId: string | null
  bootIntentServerId: string | null
}): string | null {
  if (input.defaultServerId?.startsWith(WSL_SERVER_PREFIX)) return input.defaultServerId
  if (input.bootIntentServerId?.startsWith(WSL_SERVER_PREFIX)) return input.bootIntentServerId
  return null
}

/** 恢复状态机状态：bootTarget 启动时算好（一次性消费）；pendingRestoreId 进程内累积 */
export interface WslRestoreState {
  /** 启动恢复目标：默认服务器偏好是 WSL，或上次关闭时停留在的 WSL 服务器 */
  bootTarget: string | null
  /** 待恢复：死亡（非 ready）前是 active 的 WSL 服务器。覆盖语义，只记最近一个 */
  pendingRestoreId: string | null
}

/** 服务器生命周期事件：runtime 变为 ready 或离开 ready（starting/failed/stopped 统称 unready） */
export type WslRestoreEvent = {
  kind: 'ready' | 'unready'
  serverId: string
  /** 事件发生时该服务器是否是 active（采样时机由调用方保证：unready 需在 removeServer 之前采样） */
  isActive: boolean
}

export interface WslRestoreOutcome {
  state: WslRestoreState
  /** true 表示应把 active 切回该服务器 */
  shouldRestore: boolean
}

/**
 * WSL 恢复判定状态机（纯函数 reducer，覆盖「启动切回」与「中途死亡-复活切回」两类场景）：
 * - unready：死亡前是 active 的服务器记入 pendingRestoreId（非 active 死亡不记录）；
 *   bootTarget 不受死亡事件影响。
 * - ready：命中 bootTarget（一次性消费，目标就绪即清）或 pendingRestoreId（消费即清），
 *   且当前 active 不是它 → 切回；active 已是它则只消费记忆不切回。
 * 启动恢复与中途恢复共用同一套判定，避免两套并行逻辑。
 */
export function reduceWslRestore(state: WslRestoreState, event: WslRestoreEvent): WslRestoreOutcome {
  if (event.kind === 'unready') {
    const pendingRestoreId = event.isActive ? event.serverId : state.pendingRestoreId
    return { state: { ...state, pendingRestoreId }, shouldRestore: false }
  }

  const hitBoot = state.bootTarget === event.serverId
  const hitPending = state.pendingRestoreId === event.serverId
  return {
    state: {
      bootTarget: hitBoot ? null : state.bootTarget,
      pendingRestoreId: hitPending ? null : state.pendingRestoreId,
    },
    shouldRestore: (hitBoot || hitPending) && !event.isActive,
  }
}

class WslStore {
  private _state: WslServersState | null = null
  private _listeners: Set<Listener> = new Set()
  private _snapshot: WslStoreSnapshot
  private _started = false
  // 恢复状态机：bootTarget 启动时算好，pendingRestoreId 随生命周期事件演进
  private _restoreState: WslRestoreState = { bootTarget: null, pendingRestoreId: null }

  constructor() {
    this._snapshot = this._makeSnapshot()
  }

  /** 应用启动时调用一次：订阅后端状态推送并拉取初始状态 */
  start() {
    if (this._started || !isTauri()) return
    this._started = true

    // 计算启动恢复目标：默认服务器偏好是 WSL，或上次关闭时停留在 WSL → 该服务器就绪后自动切回
    this._restoreState = {
      bootTarget: resolveWslBootTarget({
        defaultServerId: serverStore.getDefaultServerId(),
        bootIntentServerId: serverStore.getBootIntentServerId(),
      }),
      pendingRestoreId: null,
    }

    // 订阅周期与应用一致，无需退订
    subscribeWslState((event: WslServersEvent) => {
      this._state = event.state
      this._syncServers()
      this._emit()
    })
    void wslApi
      .getState()
      .then(state => {
        this._state = state
        this._syncServers()
        this._emit()
      })
      .catch(error => {
        console.error('Failed to load WSL state:', error)
      })
  }

  private _makeSnapshot(): WslStoreSnapshot {
    return { state: this._state }
  }

  private _emit() {
    this._snapshot = this._makeSnapshot()
    for (const listener of this._listeners) {
      listener()
    }
  }

  subscribe = (listener: Listener): (() => void) => {
    this._listeners.add(listener)
    return () => {
      this._listeners.delete(listener)
    }
  }

  getSnapshot = (): WslStoreSnapshot => {
    return this._snapshot
  }

  /** 把 WSL 服务器的 runtime 同步进 serverStore（聊天界面服务器列表粘合层）：
   *  Ready → 注册带鉴权的连接；Failed/Stopped/Starting 未就绪 → 移除 */
  private _syncServers() {
    const state = this._state
    if (!state) return
    for (const item of state.servers) {
      this._syncServer(item)
    }
  }

  private _syncServer(item: WslServerItem) {
    const { config, runtime } = item
    if (runtime.kind === 'ready') {
      serverStore.upsertServer({
        id: config.id,
        name: config.distro,
        url: runtime.url,
        auth:
          runtime.username && runtime.password
            ? { username: runtime.username, password: runtime.password }
            : undefined,
      })
      // 就绪的 WSL 服务器自动进入多服务器侧边栏（setSubscribed 幂等，重复调用无副作用）
      multiServerStore.setSubscribed(config.id, true)

      // 恢复判定：命中启动目标或「死亡前是 active」记忆 → 切回（覆盖安装 opencode 后
      // sidecar 自动重启等中途死亡-复活场景）。必须 upsert 之后判定，active 状态才反映最新事实
      this._applyRestore({ kind: 'ready', serverId: config.id })
      return
    }
    // 非 ready（starting/failed/stopped）：先采样 isActive 并记入恢复状态机——
    // removeServer 会把 active 优雅降级（见 serverStore.removeServer），之后采样就失真了；
    // 然后再把未就绪的 WSL 服务器从连接列表里移除（幂等）
    this._applyRestore({ kind: 'unready', serverId: config.id })
    serverStore.removeServer(config.id)
  }

  /** 应用恢复状态机：采样 isActive → 演进状态 → 需要时把 active 切回 */
  private _applyRestore(event: { kind: 'ready' | 'unready'; serverId: string }) {
    const outcome = reduceWslRestore(this._restoreState, {
      ...event,
      isActive: serverStore.getActiveServerId() === event.serverId,
    })
    this._restoreState = outcome.state
    if (outcome.shouldRestore) {
      serverStore.setActiveServer(event.serverId)
    }
  }
}

export const wslStore = new WslStore()

/** React 绑定：组件里用 useWslStore() 拿整个状态树 */
export function useWslStore(): WslServersState | null {
  const snapshot = useSyncExternalStore(wslStore.subscribe, wslStore.getSnapshot)
  return snapshot.state
}
