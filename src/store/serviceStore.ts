// ============================================
// Service Store - opencode serve 进程管理
// 管理自动启动设置 + 可执行文件路径 + 进程生命周期
// 仅在 Tauri 桌面端有效
// ============================================

import { useSyncExternalStore } from 'react'

const STORAGE_KEY_AUTO_START = 'opencode-auto-start-service'
const STORAGE_KEY_BINARY_PATH = 'opencode-binary-path'

interface ServiceStoreSnapshot {
  autoStart: boolean
  /** opencode 可执行文件路径，空字符串表示使用默认 "opencode" */
  binaryPath: string
  /** 服务是否正在运行（最后一次检测结果） */
  running: boolean
  /** 是否由我们启动（用于关闭时判断） */
  startedByUs: boolean
  /** 当前是否正在启动中 */
  starting: boolean
}

class ServiceStore {
  private _autoStart: boolean
  private _binaryPath: string
  private _running = false
  private _startedByUs = false
  private _starting = false
  private _listeners: Set<() => void> = new Set()
  private _snapshot: ServiceStoreSnapshot

  constructor() {
    try {
      this._autoStart = localStorage.getItem(STORAGE_KEY_AUTO_START) === 'true'
    } catch {
      this._autoStart = false
    }
    try {
      this._binaryPath = localStorage.getItem(STORAGE_KEY_BINARY_PATH) || ''
    } catch {
      this._binaryPath = ''
    }
    this._snapshot = this._buildSnapshot()
  }

  // ---- Getters ----

  get autoStart() { return this._autoStart }
  get binaryPath() { return this._binaryPath }
  get running() { return this._running }
  get startedByUs() { return this._startedByUs }
  get starting() { return this._starting }

  /** 返回实际要用的可执行文件路径，空则回退默认值 */
  get effectiveBinaryPath() { return this._binaryPath.trim() || 'opencode' }

  // ---- Setters ----

  setAutoStart(v: boolean) {
    this._autoStart = v
    try { localStorage.setItem(STORAGE_KEY_AUTO_START, String(v)) } catch { /* */ }
    this._notify()
  }

  setBinaryPath(v: string) {
    this._binaryPath = v
    try { localStorage.setItem(STORAGE_KEY_BINARY_PATH, v) } catch { /* */ }
    this._notify()
  }

  setRunning(v: boolean) {
    this._running = v
    this._notify()
  }

  setStartedByUs(v: boolean) {
    this._startedByUs = v
    this._notify()
  }

  setStarting(v: boolean) {
    this._starting = v
    this._notify()
  }

  // ---- React useSyncExternalStore 接口 ----

  subscribe = (fn: () => void) => {
    this._listeners.add(fn)
    return () => { this._listeners.delete(fn) }
  }

  getSnapshot = (): ServiceStoreSnapshot => this._snapshot

  // ---- Internal ----

  private _buildSnapshot(): ServiceStoreSnapshot {
    return {
      autoStart: this._autoStart,
      binaryPath: this._binaryPath,
      running: this._running,
      startedByUs: this._startedByUs,
      starting: this._starting,
    }
  }

  private _notify() {
    this._snapshot = this._buildSnapshot()
    this._listeners.forEach(fn => fn())
  }
}

export const serviceStore = new ServiceStore()

/** React hook */
export function useServiceStore() {
  return useSyncExternalStore(serviceStore.subscribe, serviceStore.getSnapshot)
}
