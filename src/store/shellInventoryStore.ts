// ============================================
// shellInventoryStore — shell 库存（后台任务可见性的数据源）
//
// 关键事实：serve --service 模式下 shell 按工作区目录隔离，
// listShells 必须带 location.directory（不带查的是服务根目录，永远空）。
// 所以库存按 directory 维护，订阅者（侧边栏挂载行/活跃判定）用
// trackDirectory 登记自己关心的目录，store 只拉登记过的目录。
//
// 数据节奏（对齐官方 location 级懒同步）：
//   - 只有被真正打开/展示的目录（当前会话、可见会话行）才登记并立即拉一次
//   - 其它目录完全靠全局 shell.created/exited/deleted 事件维护内存
//   - session.shell.started / ended 事件 → 500ms 防抖重取**已登记**目录
//   - 15s 兜底轮询也只覆盖已登记目录
//
// 之前 SidePanel 把所有最近会话的目录一次性登记（200 条会话可能几十个项目），
// 启动就是几十个 shell.list 并持续轮询，等于把用户没打开的工作区全开了。
// v1 边界：只跟活动服务器（getSDKClient 缺省），多服务器会话行不挂 shell。
// ============================================

import type { ShellInfo } from '@opencode/client/promise'
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { listShells } from '../api/shell'

type Subscriber = () => void

const REFRESH_DEBOUNCE_MS = 500
const FALLBACK_POLL_MS = 15_000

class ShellInventoryStore {
  /** directory → 该工作区的 shell 清单 */
  private shellsByDir = new Map<string, ShellInfo[]>()
  /** directory → 引用计数（多少个组件关心这个目录） */
  private dirRefs = new Map<string, number>()
  private version = 0
  private subscribers = new Set<Subscriber>()
  private refreshTimer: ReturnType<typeof setTimeout> | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private refreshing = false

  // 箭头属性：useSyncExternalStore(store.subscribe, ...) 直接引用不丢 this
  subscribe = (fn: Subscriber): (() => void) => {
    const wasEmpty = this.subscribers.size === 0
    this.subscribers.add(fn)
    if (wasEmpty) {
      this.pollTimer = setInterval(() => void this.refreshAll(), FALLBACK_POLL_MS)
    }
    return () => {
      this.subscribers.delete(fn)
      if (this.subscribers.size === 0) {
        if (this.pollTimer) {
          clearInterval(this.pollTimer)
          this.pollTimer = null
        }
        if (this.refreshTimer) {
          clearTimeout(this.refreshTimer)
          this.refreshTimer = null
        }
      }
    }
  }

  getVersion = (): number => this.version

  getShellsForDir = (directory?: string): ShellInfo[] =>
    (directory && this.shellsByDir.get(directory)) || EMPTY_SHELLS

  /** 收集所有已登记目录里「有 running shell」的会话 raw id（活跃 tab 合成条目用，非响应式） */
  collectShellActiveSessionIds = (out: Set<string>): void => {
    for (const shells of this.shellsByDir.values()) {
      for (const shell of shells) {
        if (shell.status !== 'running') continue
        const sessionID = shell.metadata?.sessionID
        if (typeof sessionID === 'string') out.add(sessionID)
      }
    }
  }

  /**
   * 登记关心的目录（引用计数）。首次登记立即拉一次；归零后丢弃该目录数据。
   *
   * 只该被「用户真正打开的会话 / 可见的会话行」调用。把一个服务器上
   * 最近会话涉及的所有目录一次性登记，就等于冷启动把几十个工作区全开了。
   */
  trackDirectory = (directory: string): (() => void) => {
    const count = this.dirRefs.get(directory) ?? 0
    this.dirRefs.set(directory, count + 1)
    if (count === 0) void this.refreshDir(directory).then(changed => changed && this.bump())
    return () => {
      const next = (this.dirRefs.get(directory) ?? 1) - 1
      if (next <= 0) {
        this.dirRefs.delete(directory)
        if (this.shellsByDir.delete(directory)) this.bump()
      } else {
        this.dirRefs.set(directory, next)
      }
    }
  }

  /** 事件触发（shell.started/ended）：防抖合并连续事件，避免一次回合启动多个 shell 时连打 */
  requestRefresh = () => {
    if (this.subscribers.size === 0) return
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null
      void this.refreshAll()
    }, REFRESH_DEBOUNCE_MS)
  }

  /**
   * shell.created 事件直写（官方客户端数据层同款实时来源）：
   * 完整 ShellInfo 就地 upsert，挂载行/活跃判定即时出现，不等重取。
   *
   * 事件是**全局**的（带 location.directory），因此不要求目录已被登记：
   * 未登记目录只做内存维护，不参与兜底轮询——用户没打开那个工作区，
   * 就不该为它主动发请求。没有目录信息时才退化为防抖重取兜底。
   */
  applyShellCreated = (directory: string | undefined, info: ShellInfo) => {
    if (!directory) {
      this.requestRefresh()
      return
    }
    const list = this.shellsByDir.get(directory) ?? []
    const idx = list.findIndex(shell => shell.id === info.id)
    if (idx >= 0 && sameShellList([list[idx]], [info])) return
    const next = idx >= 0 ? list.map((shell, i) => (i === idx ? info : shell)) : [...list, info]
    this.shellsByDir.set(directory, next)
    this.bump()
  }

  /** shell.exited：状态/退出码就地更新——挂载行即时消失、弹窗状态即时翻转 */
  applyShellExited = (directory: string | undefined, id: string, status: ShellInfo['status'], exit?: number) => {
    if (!directory) {
      this.requestRefresh()
      return
    }
    const list = this.shellsByDir.get(directory)
    if (!list) return
    const idx = list.findIndex(shell => shell.id === id)
    if (idx < 0) return
    const prev = list[idx]
    if (prev.status === status && prev.exit === exit) return
    const updated: ShellInfo = {
      ...prev,
      status,
      ...(exit !== undefined ? { exit } : {}),
      time: { ...prev.time, completed: prev.time.completed ?? Date.now() },
    }
    const next = list.map((shell, i) => (i === idx ? updated : shell))
    // 事件发现但没人打开的工作区：最后一个 running shell 退出后就丢掉，
    // 否则仅靠事件见过的目录会无限累积在内存里
    if (!this.dirRefs.has(directory) && next.every(shell => shell.status !== 'running')) {
      this.shellsByDir.delete(directory)
    } else {
      this.shellsByDir.set(directory, next)
    }
    this.bump()
  }

  /** shell.deleted：从库存移除（服务端清理/被 remove） */
  applyShellDeleted = (directory: string | undefined, id: string) => {
    if (!directory) {
      this.requestRefresh()
      return
    }
    const list = this.shellsByDir.get(directory)
    if (!list || !list.some(shell => shell.id === id)) return
    const next = list.filter(shell => shell.id !== id)
    if (next.length === 0 && !this.dirRefs.has(directory)) this.shellsByDir.delete(directory)
    else this.shellsByDir.set(directory, next)
    this.bump()
  }

  private bump() {
    this.version++
    this.subscribers.forEach(fn => fn())
  }

  private async refreshDir(directory: string): Promise<boolean> {
    try {
      const list = await listShells(directory)
      const prev = this.shellsByDir.get(directory)
      if (sameShellList(prev, list)) return false
      this.shellsByDir.set(directory, list)
      return true
    } catch {
      // 失败保留旧数据，下一轮再试
      return false
    }
  }

  private async refreshAll() {
    if (this.refreshing || this.dirRefs.size === 0) return
    this.refreshing = true
    try {
      const results = await Promise.all([...this.dirRefs.keys()].map(dir => this.refreshDir(dir)))
      if (results.some(Boolean)) this.bump()
    } finally {
      this.refreshing = false
    }
  }
}

const EMPTY_SHELLS: ShellInfo[] = []

function sameShellList(a: ShellInfo[] | undefined, b: ShellInfo[]): boolean {
  if (!a || a.length !== b.length) return false
  // status/exit 会变，id 集合也会变；command/cwd 不变。逐字段比对太贵，
  // 比 id+status+exit 足够覆盖 running↔exited 流转
  return a.every((shell, i) => shell.id === b[i].id && shell.status === b[i].status && shell.exit === b[i].exit)
}

export const shellInventoryStore = new ShellInventoryStore()

/** 某会话名下仍在运行的 shell（挂载到侧边栏父会话下的数据） */
export function runningShellsForSession(shells: ShellInfo[], rawSessionId: string): ShellInfo[] {
  return shells.filter(shell => shell.status === 'running' && shell.metadata?.sessionID === rawSessionId)
}

/** 挂载期间登记目录 + 订阅库存版本（ShellOutputDialog 跟状态也用这份） */
export function useShellsForDir(directory?: string): ShellInfo[] {
  useEffect(() => (directory ? shellInventoryStore.trackDirectory(directory) : undefined), [directory])
  const version = useSyncExternalStore(shellInventoryStore.subscribe, shellInventoryStore.getVersion)
  return useMemo(
    () => shellInventoryStore.getShellsForDir(directory),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version, directory],
  )
}

/** 订阅某会话的 running shell 列表（SessionShellsSlot 用） */
export function useRunningShellsForSession(rawSessionId: string, directory?: string): ShellInfo[] {
  const shells = useShellsForDir(directory)
  return useMemo(() => runningShellsForSession(shells, rawSessionId), [shells, rawSessionId])
}

/** 某会话是否有后台 shell 在跑（SessionListItem 活跃判定用，自己订阅不用外部喂） */
export function useHasBackgroundShells(rawSessionId: string, directory?: string): boolean {
  const shells = useShellsForDir(directory)
  return useMemo(() => runningShellsForSession(shells, rawSessionId).length > 0, [shells, rawSessionId])
}

/** 所有已登记目录里「有 running shell」的会话 raw id 集合（SidePanel 活跃 tab 合成条目用） */
export function useShellActiveSessionIds(): Set<string> {
  const version = useSyncExternalStore(shellInventoryStore.subscribe, shellInventoryStore.getVersion)
  return useMemo(() => {
    const ids = new Set<string>()
    shellInventoryStore.collectShellActiveSessionIds(ids)
    return ids
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version])
}
