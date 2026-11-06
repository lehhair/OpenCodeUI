// ============================================
// SessionIndexStore — 每个服务器一份根会话索引
//
// 侧栏的会话列表过去按「目录」各拉各的：文件夹模式下一个文件夹一次
// `session.list`，切目录/切服务器再各拉一次。同一台服务器上的会话被
// 重复请求了 N 遍，目录切换也永远要等一次网络往返。
//
// 官方 app 的做法是拉一份「根会话索引」（`loadHomeSessionIndex`），
// 在本地按目录分组、按时间切片（home/sessions/index.ts）。这里做同一件事：
//
//   - `ensure(serverId)` 拉首页（limit 200），30s 内复用
//     官方 home 一次拉 5000（HOME_V2_SESSION_PAGE_LIMIT）；这里为了首屏更快
//     只拉一页，目录覆盖交给 ensureDirectory（一次也拿满 5000）
//   - 各列表从 `getSnapshot(serverId)` 里按目录过滤、按需切片，零额外请求
//   - 某个目录被挤出索引时 `ensureDirectory` 按目录补一次（见下）
//   - SSE 增量（新增/重命名/删除/移动）直接写进索引，所有列表同步更新
//   - 重连直接重拉第一页，旧数据保留到新数据到达，列表不会闪一下空态
//
// 索引只存根会话（parentID 为空、未归档）：子会话由 childSessionStore
// 管理，不属于侧栏列表。
//
// 不传 `directory` 表示「全服务器」：上游 `session.list` 的 `ListAllInput`
// 就是不带 location 的那支（packages/core/src/session/store.ts）。
//
// 实测（v2.0.29，200 条样本）：
//   - 不传 `directory` 返回全服务器、多目录的会话，不是只给默认 location
//   - 不传 `parentID` 会把子会话一起带回来；`parentID: null` 才只要根会话
//   - `cursor.next` 直接续页，跨页无重复
// 所以下面每处 list 都显式带 `parentID: null`，别省。
// ============================================

import { getSession, listSessionsPage } from '../api/session'
import { subscribeToServerEvents } from '../api/events'
import { autoDetectPathStyle } from '../utils/directoryUtils'
import { serverStore, WSL_SERVER_PREFIX } from './serverStore'
import type { Session } from '../types/api/session'

/** 与官方 home 列表的 staleTime 对齐：30s 内重复挂载不再请求 */
const TTL_MS = 30_000
/** 单页条数：首屏一页就要出内容，大库靠 cursor 续页 / 目录补拉 */
const PAGE_LIMIT = 200
/** 目录级补拉的条数：对齐官方 home 的会话页大小（HOME_V2_SESSION_PAGE_LIMIT） */
const DIRECTORY_LIMIT = 5_000
/** 首屏失败的重试退避（启动可能早于本地服务端就绪） */
const RETRY_DELAYS_MS = [500, 1_500, 3_000]

export interface SessionIndexSnapshot {
  /** 根会话，按更新时间倒序 */
  sessions: Session[]
  /** 服务端还有下一页没拉 */
  hasMore: boolean
  /** 至少成功拉过一页（空列表也算 ready） */
  ready: boolean
  loading: boolean
  error: Error | null
}

const EMPTY_SNAPSHOT: SessionIndexSnapshot = Object.freeze({
  sessions: [],
  hasMore: false,
  ready: false,
  loading: false,
  error: null,
})

interface Entry {
  sessions: Session[]
  cursor: string | null
  exhausted: boolean
  ready: boolean
  fetchedAt: number
  loading: Promise<void> | null
  error: Error | null
  /** 拉取期间收到的增量（整页替换后重放，避免刚创建的会话被覆盖掉） */
  pending: Mutation[]
  /** 在途请求落地后是否还要补一次强制刷新（重连撞上请求时用） */
  refreshQueued: boolean
  snapshot: SessionIndexSnapshot
}

type Mutation =
  | { type: 'upsert'; session: Session }
  | { type: 'upsertMany'; sessions: Session[] }
  | { type: 'patch'; sessionId: string; patch: Partial<Session> }
  | { type: 'remove'; sessionId: string }

type Listener = () => void

function updatedAt(session: Session): number {
  return session.time?.updated ?? session.time?.created ?? 0
}

/** 根会话、未归档才进索引 */
function isIndexable(session: Session): boolean {
  return !session.parentID && typeof session.time?.archived !== 'number'
}

/** 目录键：分隔符与末尾斜杠归一化，避免同一目录重复补拉 */
function normalizeDirectoryKey(directory: string): string {
  return directory.replace(/\\/g, '/').replace(/\/+$/, '')
}

function sortSessions(sessions: Session[]): Session[] {
  return [...sessions].sort((a, b) => {
    // 与官方 home 的 retainHomeSessions 同款排序：只看 time.updated，
    // 流式输出期间服务端不改这个时间，所以行不会立刻跳到顶部。
    const diff = updatedAt(b) - updatedAt(a)
    if (diff !== 0) return diff
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

/** 按 id 去重（同 id 后出现的为准），再统一排序 */
function normalize(sessions: Session[]): Session[] {
  const byId = new Map<string, Session>()
  for (const session of sessions) {
    if (!isIndexable(session)) continue
    byId.set(session.id, session)
  }
  return sortSessions([...byId.values()])
}

class SessionIndexStore {
  private entries = new Map<string, Entry>()
  private listeners = new Set<Listener>()
  private subscriptions = new Map<string, () => void>()
  /** 单会话回读去重：多个列表同时收到 created/移动事件只打一次 getSession */
  private refreshing = new Map<string, Promise<void>>()
  /** 目录级补拉的 TTL（key = serverId\0directory） */
  private directoryFetchedAt = new Map<string, number>()
  /** 目录级补拉去重（同一目录并发只打一次） */
  private directoryLoading = new Map<string, Promise<void>>()
  /** 上一次看到的服务器集合：用来发现「哪台被删了」 */
  private knownServerIds: Set<string>
  /** 上一次处理的服务器快照（引用不变 = 没有真实变更，直接跳过） */
  private lastServersSnapshot: ReturnType<typeof serverStore.getServers> | null = null

  constructor() {
    this.knownServerIds = new Set(serverStore.getServers().map(server => server.id))
    this.lastServersSnapshot = serverStore.getServers()
    serverStore.subscribe(this.handleServerStoreChange)
  }

  /**
   * 服务器被删除时释放对应索引和 SSE 订阅。
   *
   * 不能只增不减：删掉的服务器会一直留着一条连接和一份会话列表，
   * 直到应用退出。这里只处理「上次见过、这次不见了」的 id，新增不受影响。
   *
   * WSL 例外：`wsl:` 服务器在 starting/stopped 期间会被临时移出列表，
   * 稍后带着同一个 id 回来。这时丢掉索引没人会重新 ensure（hook 的
   * serverKey 没变），列表会一直空着，所以宁可留着内存。
   */
  private handleServerStoreChange = (): void => {
    const servers = serverStore.getServers()
    // serverStore 的通知也来自健康检查/时钟校准等与服务器列表无关的写入。
    // 快照引用没变说明列表真的没动，跳过整轮 Set 构造。
    if (servers === this.lastServersSnapshot) return
    this.lastServersSnapshot = servers
    const current = new Set(servers.map(server => server.id))
    for (const serverId of this.knownServerIds) {
      if (current.has(serverId) || serverId.startsWith(WSL_SERVER_PREFIX)) continue
      this.forget(serverId)
    }
    this.knownServerIds = current
  }

  /** 丢弃某台服务器的全部内存状态（下次 ensure 重新拉） */
  forget(serverId: string): void {
    this.subscriptions.get(serverId)?.()
    this.subscriptions.delete(serverId)
    this.entries.delete(serverId)
    // 键都是 `${serverId}\0...` 形式，按前缀一起清
    const prefix = `${serverId}\0`
    for (const map of [this.refreshing, this.directoryFetchedAt, this.directoryLoading]) {
      for (const key of map.keys()) {
        if (key.startsWith(prefix)) map.delete(key)
      }
    }
    this.notify()
  }

  // ============================================
  // 订阅（useSyncExternalStore）
  // ============================================

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (serverId: string): SessionIndexSnapshot => {
    return this.entries.get(serverId)?.snapshot ?? EMPTY_SNAPSHOT
  }

  // ============================================
  // 拉取
  // ============================================

  /**
   * 确保索引可用。30s 内命中缓存直接返回；并发调用共享同一个请求。
   */
  ensure(serverId: string, options: { force?: boolean } = {}): Promise<void> {
    this.ensureSubscription(serverId)
    const entry = this.entries.get(serverId)

    if (entry?.loading) {
      // 重连补偿可能正好撞上在途请求：光等它拿不到断连后的新数据，
      // 但要等它落地后再拉一次，否则两个全量请求会互相覆盖
      if (!options.force || entry.refreshQueued) return entry.loading
      entry.refreshQueued = true
      return entry.loading.then(() => {
        entry.refreshQueued = false
        if (this.entries.get(serverId) !== entry) return
        // 期间又起了一次拉取：等它，不叠第三个
        if (entry.loading) return entry.loading
        return this.fetchPage(serverId, null)
      })
    }

    if (!options.force && entry?.ready && Date.now() - entry.fetchedAt < TTL_MS) {
      return Promise.resolve()
    }
    return this.fetchPage(serverId, null)
  }

  /** 翻下一页（列表滚到底时调用） */
  loadMore(serverId: string): Promise<void> {
    this.ensureSubscription(serverId)
    const entry = this.entries.get(serverId)
    if (!entry) return this.ensure(serverId)
    if (entry.loading) return entry.loading
    if (entry.exhausted || !entry.cursor) return Promise.resolve()
    return this.fetchPage(serverId, entry.cursor)
  }

  /**
   * 目录兜底补拉。
   *
   * 全局索引只保证最近若干页；某个项目的会话如果都比这些页旧，切过去会是空的。
   * 这时按目录单独问一次（最多 DIRECTORY_LIMIT 条），结果直接并进索引。
   *
   * 顺带兜住「服务端在缺省目录时只返回默认 location」的实现差异：真有这种
   * 服务端，每个目录第一次挂载都会走这里，列表仍然是对的。
   */
  ensureDirectory(serverId: string, directory: string): Promise<void> {
    this.ensureSubscription(serverId)
    const dir = normalizeDirectoryKey(directory)
    if (!dir) return Promise.resolve()

    const key = `${serverId}\0${dir}`
    const loading = this.directoryLoading.get(key)
    if (loading) return loading
    const fetchedAt = this.directoryFetchedAt.get(key)
    if (fetchedAt !== undefined && Date.now() - fetchedAt < TTL_MS) return Promise.resolve()

    const request = (async () => {
      try {
        const page = await listSessionsPage(
          { directory: dir, parentID: null, order: 'desc', limit: DIRECTORY_LIMIT },
          serverId,
        )
        // 走 mutate 而不是直接改：整页刷新在飞时先排队，落地后重放。
        // 一次合并（而不是逐条 upsert）——5000 条逐条排序会是 O(n²)。
        this.mutate(serverId, { type: 'upsertMany', sessions: page.data })
        this.directoryFetchedAt.set(key, Date.now())
      } catch {
        // 补拉失败不记 TTL：下次挂载还有机会再试
      } finally {
        this.directoryLoading.delete(key)
      }
    })()

    this.directoryLoading.set(key, request)
    return request
  }

  // ============================================
  // 增量更新（事件 / 单会话回读）
  // ============================================

  /** 回读单个会话并写回索引（created / forked / moved） */
  refreshSession(serverId: string, sessionId: string): Promise<void> {
    const key = `${serverId}\0${sessionId}`
    const existing = this.refreshing.get(key)
    if (existing) return existing

    const request = getSession(sessionId, undefined, serverId)
      .then(session => {
        this.upsert(serverId, session)
      })
      .catch(() => {
        // 回读失败：整页重拉一次兜底（和旧实现「回读失败退回整表刷新」一致）
        void this.ensure(serverId, { force: true })
      })
      .finally(() => {
        this.refreshing.delete(key)
      })

    this.refreshing.set(key, request)
    return request
  }

  upsert(serverId: string, session: Session): void {
    this.mutate(serverId, { type: 'upsert', session })
  }

  patch(serverId: string, sessionId: string, patch: Partial<Session>): void {
    this.mutate(serverId, { type: 'patch', sessionId, patch })
  }

  remove(serverId: string, sessionId: string): void {
    this.mutate(serverId, { type: 'remove', sessionId })
  }

  /** 测试用：清空全部索引与订阅 */
  reset(): void {
    for (const unsubscribe of this.subscriptions.values()) unsubscribe()
    this.subscriptions.clear()
    this.refreshing.clear()
    this.directoryFetchedAt.clear()
    this.directoryLoading.clear()
    this.entries.clear()
    this.notify()
  }

  // ============================================
  // 内部
  // ============================================

  private mutableEntry(serverId: string): Entry {
    const existing = this.entries.get(serverId)
    if (existing) return existing
    const entry: Entry = {
      sessions: [],
      cursor: null,
      exhausted: true,
      ready: false,
      fetchedAt: 0,
      loading: null,
      error: null,
      pending: [],
      refreshQueued: false,
      snapshot: EMPTY_SNAPSHOT,
    }
    this.entries.set(serverId, entry)
    return entry
  }

  /**
   * 增量入口：拉取进行中先排队，等整页落地后重放。
   * 否则「刷新第一页」会用旧快照覆盖掉刚创建的会话。
   */
  private mutate(serverId: string, mutation: Mutation): void {
    const entry = this.entries.get(serverId)
    // 索引还没加载过：没有可改的东西，等 ensure 拉回来自然包含
    if (!entry) return
    if (entry.loading) {
      entry.pending.push(mutation)
      return
    }
    this.applyMutation(entry, mutation)
    this.commit(entry)
  }

  private applyMutation(entry: Entry, mutation: Mutation): void {
    if (mutation.type === 'upsert') {
      const { session } = mutation
      const rest = entry.sessions.filter(item => item.id !== session.id)
      if (isIndexable(session)) rest.push(session)
      entry.sessions = normalize(rest)
      return
    }

    if (mutation.type === 'upsertMany') {
      // 目录补拉一次 5000 条：逐条走 upsert 会对整个列表做 5000 次
      // filter + sort + notify（O(n²)），页面直接卡住。这里合并去重后
      // 只排一次序、只提交一次。
      const byId = new Map<string, Session>()
      for (const session of entry.sessions) byId.set(session.id, session)
      for (const session of mutation.sessions) byId.set(session.id, session)
      entry.sessions = normalize([...byId.values()])
      return
    }

    if (mutation.type === 'patch') {
      const index = entry.sessions.findIndex(session => session.id === mutation.sessionId)
      if (index === -1) return
      const next = [...entry.sessions]
      next[index] = { ...next[index], ...mutation.patch }
      entry.sessions = normalize(next)
      return
    }

    const next = entry.sessions.filter(session => session.id !== mutation.sessionId)
    if (next.length !== entry.sessions.length) entry.sessions = next
  }

  private fetchPage(serverId: string, cursor: string | null): Promise<void> {
    const entry = this.mutableEntry(serverId)
    // 已有数据时刷新不清空：stale-while-revalidate
    const request = (async () => {
      // 只有首屏值得重试（启动早于服务端就绪是常态）；
      // 续页失败就让用户再点一次「显示更多」，别在后台反复打
      const delays = cursor ? [] : RETRY_DELAYS_MS

      for (let attempt = 0; ; attempt++) {
        try {
          const page = await listSessionsPage(
            {
              parentID: null,
              order: 'desc',
              limit: PAGE_LIMIT,
              ...(cursor ? { cursor } : {}),
            },
            serverId,
          )
          // 期间被 reset / 重新 ensure 顶掉：丢弃这次结果
          if (this.entries.get(serverId) !== entry) return

          // 首屏整页替换，续页追加；normalize 按 id 去重并统一排序
          entry.sessions = normalize([...(cursor ? entry.sessions : []), ...page.data])
          entry.cursor = page.next
          // 到底只看服务端游标：不加本地条数上限，用户点多少就能翻多少
          entry.exhausted = !page.next
          entry.ready = true
          entry.error = null
          entry.fetchedAt = Date.now()

          const sampleDirectory = page.data[0]?.location?.directory
          if (!cursor && sampleDirectory) autoDetectPathStyle(sampleDirectory, serverId)

          // 拉取期间排队的增量现在重放（整页替换会覆盖它们）
          for (const mutation of entry.pending) this.applyMutation(entry, mutation)
          entry.pending = []
          this.commit(entry)
          return
        } catch (error) {
          if (this.entries.get(serverId) !== entry) return
          if (attempt >= delays.length) {
            // 失败也要把排队增量落下来，别把用户刚做的操作丢了
            for (const mutation of entry.pending) this.applyMutation(entry, mutation)
            entry.pending = []
            entry.error = error instanceof Error ? error : new Error('Failed to fetch sessions')
            this.commit(entry)
            return
          }
          await new Promise<void>(resolve => {
            setTimeout(resolve, delays[attempt])
          })
          if (this.entries.get(serverId) !== entry) return
        }
      }
    })()

    entry.loading = request
    this.commit(entry)
    // 用 then(成功, 失败) 而不是 `void request.finally(...)`：
    // finally 会返回一个同样会 reject 的新 promise，没人接就是
    // unhandledrejection（首屏请求失败时每次都刷一条全局错误）
    const settle = () => {
      if (entry.loading === request) entry.loading = null
      this.commit(entry)
    }
    void request.then(settle, settle)
    return request
  }

  private commit(entry: Entry): void {
    entry.snapshot = {
      sessions: entry.sessions,
      hasMore: !entry.exhausted,
      ready: entry.ready,
      loading: entry.loading !== null,
      error: entry.error,
    }
    this.notify()
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }

  /**
   * 索引自己的事件订阅：列表层不再各订一份，新增/改名/删除只处理一次。
   * 连接是引用计数的，同一服务器已有订阅时不会新建传输。
   */
  private ensureSubscription(serverId: string): void {
    if (this.subscriptions.has(serverId)) return
    const unsubscribe = subscribeToServerEvents(serverId, {
      onSessionCreated: data => {
        // 子会话不进根索引；父会话的关系由 childSessionStore 处理
        if (data.parentID) return
        void this.refreshSession(serverId, data.sessionID)
      },
      onSessionForked: data => {
        void this.refreshSession(serverId, data.sessionID)
      },
      onSessionRenamed: data => {
        this.patch(serverId, data.sessionID, { title: data.title })
      },
      onSessionDeleted: data => {
        this.remove(serverId, data.sessionID)
      },
      onSessionMoved: data => {
        // 目录变了：回读后按新 location 落到对应目录
        void this.refreshSession(serverId, data.sessionID)
      },
      onServerConnected: () => {
        // 首次连上（本地 serve 刚拉起）时补一次：启动期的重试可能已经耗尽。
        // 这里用 force：初始拉取可能还挂在「服务端尚未监听」的请求上，
        // 普通 ensure 只会复用在途 promise，等它失败后没人再发起新的请求，
        // 列表就停在失败态。force 会排队到在途请求落地后再拉一页。
        const entry = this.entries.get(serverId)
        if (!entry?.ready || entry.error || entry.loading) void this.ensure(serverId, { force: true })
      },
      onReconnected: reason => {
        if (reason === 'server-switch') return
        // 断连期间的新增/删除都丢了：直接重拉第一页，旧数据保留到新数据到达
        void this.ensure(serverId, { force: true })
      },
    })
    this.subscriptions.set(serverId, unsubscribe)
  }
}

export const sessionIndexStore = new SessionIndexStore()
