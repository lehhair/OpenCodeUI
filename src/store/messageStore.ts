// ============================================
// MessageStore - 消息状态集中管理（OpenCode v2 原生）
// ============================================
//
// 核心设计：
// 1. 每个 session 直接持有**原生** `SessionMessageInfo[]`，按创建时间有序。
//    没有自制的 `{ info, parts }` 视图模型：消息判别走 `message.type`，
//    助手内容读 `message.content: Array<Text | Reasoning | Tool>`。
// 2. SSE 事件逐条对齐官方 client（`packages/client/src/solid/data.ts`）：
//    流式增量就地改写（官方同款，配 findLast 定位「最后一个同类片段」），
//    再由 rAF 统一生成新的对象标识 —— React 靠引用变化重渲染，
//    就地改写若不给新引用，界面会停在上一帧。
// 3. Undo/Redo 通过 revertState 实现
// 4. RAF 批量通知 React 组件更新
//
// ## sessionID 的作用域约定（多服务器）
//
// 本 app 支持多服务器，session id 按 server 作用域化成 `${serverId}::${sessionId}`，
// store 也以作用域 id 为键。事件负载里带的是**服务端本地原始 id**，因此：
//   调用方必须先把负载里的 sessionID 改写成作用域 id 再传进来
//   （`messageStore.handleX({ ...data, sessionID: scope(data.sessionID) })`）。
// store 只读负载里的 sessionID，**从不**读事件信封上的 sessionID —— 读原始
// id 会让两个服务器上的同 id 会话串台。

import type {
  AssistantContent,
  AssistantMessage,
  AssistantReasoning,
  AssistantText,
  AssistantTool,
  SessionMessage,
  ToolContent,
  UserMessage,
} from '../types/api/message'
import type { GlobalEvent, SessionMessageInfo } from '../types/api/event'
import type { SessionRevert } from '../types/api/session'
import { contentEntries, isUserMessage, userMessageText } from '../types/api/message'
import type { Attachment } from '../types/ui'
import type { APIError } from '../types/api/common'
import { logger } from '../utils/logger'
import type { RevertState, RevertHistoryItem, SessionState, SendRollbackSnapshot } from './messageStoreTypes'

// Re-export types for consumers
export type { RevertState, RevertHistoryItem, SessionState, SendRollbackSnapshot } from './messageStoreTypes'

type Subscriber = () => void

/** 从 v2 事件联合里取出某个具体事件（保留 `created` / `data` 的精确形状） */
type NativeEvent<T extends GlobalEvent['type']> = Extract<GlobalEvent, { type: T }>

/** 某个原生事件的负载；其中 sessionID 由调用方改写成作用域 id（见文件头约定） */
type EventPayload<T extends GlobalEvent['type']> = NativeEvent<T>['data']

/** 工具生命周期事件：input.started/delta/ended → called → progress* → success | failed */
type ToolEvent = Extract<GlobalEvent, { type: `session.tool.${string}` }>

/** 工具事件负载（sessionID 已作用域化） */
type ToolPayload<T extends ToolEvent['type']> = Extract<ToolEvent, { type: T }>['data']

/**
 * 执行结束的三种结局 —— 三者在 store 里走同一段收尾逻辑。
 */
type ExecutionOutcome = 'succeeded' | 'failed' | 'interrupted'

/**
 * 事件信封里 store 真正需要、且与 session 归属无关的部分。
 *
 * 这里**刻意不含 sessionID**：信封上的 sessionID 是服务端本地原始 id，
 * 多服务器下会串台，store 一律用负载里调用方改写过的值。
 *
 * 当前 `src/api/events.ts` 只把 `event.data` 交给事件回调，调用方拿不到
 * `id` / `created` / `metadata`；这时 facts 传 undefined，store 用本地时钟与
 * 随机 id 兜底。分发层一旦把信封透出，把 `{ id, created, metadata }` 传进来，
 * 时间戳就恢复成服务端权威值，派生消息 id 也恢复成可重放的稳定 id。
 */
export interface EventFacts {
  /** 事件 id —— 官方 messageIDFromEvent 用它派生 idle / synthetic / shell / compaction 的消息 id */
  id?: string
  /** 事件创建时间 —— 用于 time.created / time.completed / time.ran */
  created?: number
  /** 事件信封 metadata —— step.started / shell.started / instructions.updated 会透传 */
  metadata?: AssistantMessage['metadata']
}

/**
 * `handleToolEvent` 的入参。
 *
 * 工具负载本身不带判别字段（`type` 在信封上、不在 data 里），因此这里显式
 * 带上 `type`，让 TS 把 type 与 data 关联起来（免去手写 cast）。
 * `sessionID` 仍在 `data` 内，且必须是**已作用域化**的值。
 */
export type ToolEventInput = {
  [T in ToolEvent['type']]: { type: T; data: ToolPayload<T>; facts?: EventFacts }
}[ToolEvent['type']]

/** 压缩消息的三个状态分支 */
type CompactionRunning = Extract<SessionMessage, { type: 'compaction'; status: 'running' }>
type CompactionCompleted = Extract<SessionMessage, { type: 'compaction'; status: 'completed' }>
type CompactionFailed = Extract<SessionMessage, { type: 'compaction'; status: 'failed' }>

/** shell 消息（`session.shell.ended` 要按 shellID 回填） */
type ShellMessage = Extract<SessionMessage, { type: 'shell' }>

const MAX_CACHED_SESSIONS = 10

/**
 * 由事件 id 派生消息 id。
 *
 * 官方 `data.ts:76`：`eventID.replace(/^evt_/, "msg_")`。
 * idle / synthetic / shell / compaction / switched 这些消息没有服务端给的
 * 消息 id，只能靠事件 id 派生，重连重放时才能保持稳定（不会每次都新增一行）。
 */
function messageIDFromEvent(eventID: string): string {
  return eventID.replace(/^evt_/, 'msg_')
}

/**
 * 从事件事实里派生消息 id。
 *
 * 拿不到事件 id 时退化为随机 id：功能上可用，但重放同一条事件会产生第二行
 * （因此一旦分发层透出信封，务必把 id 传进来）。
 */
function messageIDFromFacts(facts: EventFacts | undefined): string {
  return facts?.id ? messageIDFromEvent(facts.id) : `msg_${crypto.randomUUID()}`
}

/**
 * 同步合并文本：live 更长且与服务端兼容（服务端是前缀）时不回退；
 * 服务端更长则跟上；分叉时以服务端为准。
 */
function preferCompatibleText(local: string, incoming: string): string {
  if (local === incoming) return incoming
  if (local.startsWith(incoming)) return local
  if (incoming.startsWith(local)) return incoming
  return incoming
}

/** 未定稿的助手消息：`time.completed` 缺省即仍在流式输出中 */
function isOpenAssistant(message: SessionMessageInfo | undefined): message is AssistantMessage {
  return !!message && message.type === 'assistant' && message.time.completed == null
}

function isRunningCompaction(message: SessionMessageInfo): message is CompactionRunning {
  return message.type === 'compaction' && message.status === 'running'
}

/**
 * 克隆一个内容片段。
 *
 * 工具片段的 `state` / `time` 是就地改写的可变对象（见 handleToolEvent），
 * 快照与回滚必须断开引用，否则「回滚」拿到的还是被后续事件改过的状态。
 */
function cloneContent(content: AssistantContent): AssistantContent {
  if (content.type === 'tool') {
    return { ...content, time: { ...content.time }, state: { ...content.state } }
  }
  return { ...content }
}

/** 深一层克隆原生消息（数组与两个可变子对象都换新引用） */
function cloneMessage(message: SessionMessageInfo): SessionMessageInfo {
  if (message.type === 'assistant') {
    return {
      ...message,
      time: { ...message.time },
      content: message.content.map(cloneContent),
    }
  }
  return { ...message, time: { ...message.time } }
}

/**
 * 服务端整条消息覆盖本地时，保留本地更长的 live 文本。
 *
 * 只对「两边都还没定稿」的助手消息生效：定稿（completed）以服务端为准。
 * 内容片段没有 id，按官方 projection 的派生 id（text/reasoning 各自计数）对齐。
 */
function mergeAssistantPreferLive(local: AssistantMessage, incoming: AssistantMessage): AssistantMessage {
  const localById = new Map(contentEntries(local).map(entry => [entry.id, entry.content]))
  const content = contentEntries(incoming).map(entry => {
    const localItem = localById.get(entry.id)
    if (!localItem) return entry.content
    return preferLiveText(localItem, entry.content)
  })
  return { ...incoming, content }
}

function preferLiveText(localItem: AssistantContent, incomingItem: AssistantContent): AssistantContent {
  if (localItem.type === 'tool' || incomingItem.type === 'tool') return incomingItem
  // 两边都是 text / reasoning（只有这两种带 text 字段）
  const text = preferCompatibleText(localItem.text, incomingItem.text)
  return text === incomingItem.text ? incomingItem : { ...incomingItem, text }
}

function mergeIncomingMessage(
  previous: SessionMessageInfo | undefined,
  incoming: SessionMessageInfo,
): SessionMessageInfo {
  if (!previous) return incoming
  if (isOpenAssistant(previous) && isOpenAssistant(incoming)) return mergeAssistantPreferLive(previous, incoming)
  return incoming
}

class MessageStore {
  private sessions = new Map<string, SessionState>()
  private subscribers = new Set<Subscriber>()
  private sessionSubscribers = new Map<string, Map<Subscriber, number>>()
  private sessionVersions = new Map<string, number>()
  private allSessionsVersion = 0
  private changeVersion = 0
  private sessionAccessTime = new Map<string, number>()
  /** 被分屏 pane 保护的 sessionId 集合，evict 时跳过 */
  private protectedSessions = new Set<string>()
  private pendingNotify = false
  private pendingNotifyAllSessions = false
  private pendingSessionNotifyIds = new Set<string>()
  private rafId: number | null = null
  // delta 批量化：记录本帧内被**就地改写**过的消息与内容片段。
  // rAF 回调里只给它们换新引用，同消息内稳定的片段继续复用引用，
  // 否则流式期间每个工具结果都会跟着重渲染。
  private dirtyContentBySession = new Map<string, Map<string, Set<AssistantContent>>>()

  // ============================================
  // Subscription & Notification
  // ============================================

  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn)
    return () => this.subscribers.delete(fn)
  }

  subscribeSession(sessionId: string, fn: Subscriber): () => void {
    let subscribers = this.sessionSubscribers.get(sessionId)
    if (!subscribers) {
      subscribers = new Map()
      this.sessionSubscribers.set(sessionId, subscribers)
    }
    subscribers.set(fn, this.getSessionVersion(sessionId))
    return () => {
      subscribers.delete(fn)
      if (subscribers.size === 0) this.sessionSubscribers.delete(sessionId)
    }
  }

  private getSessionVersion(sessionId: string) {
    return Math.max(this.sessionVersions.get(sessionId) ?? 0, this.allSessionsVersion)
  }

  private markPendingSessionNotifications(sessionIds?: Iterable<string> | 'all') {
    if (sessionIds === 'all') {
      this.changeVersion += 1
      this.allSessionsVersion = this.changeVersion
      this.pendingNotifyAllSessions = true
      this.pendingSessionNotifyIds.clear()
      return
    }
    if (!sessionIds || this.pendingNotifyAllSessions) return
    for (const sessionId of sessionIds) {
      this.changeVersion += 1
      this.sessionVersions.set(sessionId, this.changeVersion)
      this.pendingSessionNotifyIds.add(sessionId)
    }
  }

  private notify(sessionIds?: Iterable<string> | 'all') {
    this.markPendingSessionNotifications(sessionIds)
    if (this.pendingNotify) return
    this.pendingNotify = true

    if (typeof requestAnimationFrame !== 'undefined') {
      this.rafId = requestAnimationFrame(() => {
        this.pendingNotify = false
        this.rafId = null
        this.flushDirtyMessages()
        this.subscribers.forEach(fn => fn())
        this.flushSessionSubscribers()
      })
    } else {
      this.pendingNotify = false
      this.flushDirtyMessages()
      this.subscribers.forEach(fn => fn())
      this.flushSessionSubscribers()
    }
  }

  private flushSessionSubscribers() {
    if (this.pendingNotifyAllSessions) {
      this.pendingNotifyAllSessions = false
      this.pendingSessionNotifyIds.clear()
      this.sessionSubscribers.forEach((subscribers, sessionId) => {
        this.flushSubscribersForSession(sessionId, subscribers)
      })
      return
    }

    if (this.pendingSessionNotifyIds.size === 0) return
    const sessionIds = Array.from(this.pendingSessionNotifyIds)
    this.pendingSessionNotifyIds.clear()
    for (const sessionId of sessionIds) {
      const subscribers = this.sessionSubscribers.get(sessionId)
      if (subscribers) this.flushSubscribersForSession(sessionId, subscribers)
    }
  }

  private flushSubscribersForSession(sessionId: string, subscribers: Map<Subscriber, number>) {
    const version = this.getSessionVersion(sessionId)
    subscribers.forEach((seenVersion, fn) => {
      if (seenVersion === version) return
      subscribers.set(fn, version)
      fn()
    })
  }

  /** 把本帧内被就地改写过的东西标记为「下一帧要换新引用」 */
  private markMessageDirty(sessionID: string, messageID: string, touched?: AssistantContent | AssistantContent[]) {
    let dirtyByMessage = this.dirtyContentBySession.get(sessionID)
    if (!dirtyByMessage) {
      dirtyByMessage = new Map<string, Set<AssistantContent>>()
      this.dirtyContentBySession.set(sessionID, dirtyByMessage)
    }
    let dirty = dirtyByMessage.get(messageID)
    if (!dirty) {
      dirty = new Set<AssistantContent>()
      dirtyByMessage.set(messageID, dirty)
    }
    if (!touched) return
    if (Array.isArray(touched)) {
      for (const item of touched) dirty.add(item)
    } else {
      dirty.add(touched)
    }
  }

  /**
   * 把 delta 期间就地改写过的消息做一次「不可变快照」：
   *   - 消息对象换新引用（React 才会重渲染）
   *   - 只克隆本帧真正动过的内容片段，稳定片段继续复用引用
   * 一帧内多个 delta 因此只产生一次拷贝。
   */
  private flushDirtyMessages() {
    if (this.dirtyContentBySession.size === 0) return

    for (const [sessionID, dirtyByMessage] of this.dirtyContentBySession) {
      const state = this.sessions.get(sessionID)
      if (!state) continue

      let changed = false
      const messages = state.messages.map(message => {
        const dirty = dirtyByMessage.get(message.id)
        if (!dirty) return message
        changed = true
        if (message.type === 'assistant') {
          return {
            ...message,
            time: { ...message.time },
            content: message.content.map(item => (dirty.has(item) ? cloneContent(item) : item)),
          }
        }
        return { ...message, time: { ...message.time } }
      })

      if (changed) state.messages = messages
    }

    this.dirtyContentBySession.clear()
  }

  private notifyImmediate(sessionIds?: Iterable<string> | 'all') {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    this.markPendingSessionNotifications(sessionIds)
    this.pendingNotify = false
    this.flushDirtyMessages()
    this.subscribers.forEach(fn => fn())
    this.flushSessionSubscribers()
  }

  // ============================================
  // Getters
  // ============================================

  getSessionState(sessionId: string): SessionState | undefined {
    return this.sessions.get(sessionId)
  }

  /** 可见消息：undo 生效后，撤销点及其之后的消息不再展示 */
  getVisibleMessages(sessionId: string | null): SessionMessageInfo[] {
    if (!sessionId) return []
    const state = this.sessions.get(sessionId)
    if (!state) return []

    const { messages, revertState } = state
    if (!revertState) return messages

    const revertIndex = messages.findIndex(message => message.id === revertState.messageId)
    return revertIndex === -1 ? messages : messages.slice(0, revertIndex)
  }

  getIsStreaming(sessionId: string | null): boolean {
    if (!sessionId) return false
    return this.sessions.get(sessionId)?.isStreaming ?? false
  }

  getRevertState(sessionId: string | null): RevertState | null {
    if (!sessionId) return null
    return this.sessions.get(sessionId)?.revertState ?? null
  }

  getHasMoreHistory(sessionId: string | null): boolean {
    if (!sessionId) return false
    return this.sessions.get(sessionId)?.hasMoreHistory ?? false
  }

  getSessionDirectory(sessionId: string | null): string {
    if (!sessionId) return ''
    return this.sessions.get(sessionId)?.directory ?? ''
  }

  getSessionTitle(sessionId: string | null): string {
    if (!sessionId) return ''
    return this.sessions.get(sessionId)?.title ?? ''
  }

  getLoadState(sessionId: string | null): SessionState['loadState'] {
    if (!sessionId) return 'idle'
    return this.sessions.get(sessionId)?.loadState ?? 'idle'
  }

  isSessionStale(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.isStale ?? false
  }

  // ============================================
  // Session Management
  // ============================================

  private ensureSession(sessionId: string): SessionState {
    this.sessionAccessTime.set(sessionId, Date.now())

    let state = this.sessions.get(sessionId)
    if (!state) {
      this.evictOldSessions()
      state = {
        messages: [],
        revertState: null,
        isStreaming: false,
        loadState: 'idle',
        hasMoreHistory: false,
        directory: '',
        title: undefined,
        agent: undefined,
        model: undefined,
        cost: undefined,
        tokens: undefined,
        localMessageIds: new Set(),
        loadError: undefined,
        isStale: false,
      }
      this.sessions.set(sessionId, state)
    }
    return state
  }

  private evictOldSessions() {
    if (this.sessions.size < MAX_CACHED_SESSIONS) return

    let oldestId: string | null = null
    let oldestTime = Infinity

    for (const [id, time] of this.sessionAccessTime) {
      if (this.protectedSessions.has(id)) continue
      const state = this.sessions.get(id)
      if (state?.isStreaming) continue
      if (time < oldestTime) {
        oldestTime = time
        oldestId = id
      }
    }

    if (oldestId) {
      logger.log('[MessageStore] Evicting old session:', oldestId)
      this.sessions.delete(oldestId)
      this.sessionAccessTime.delete(oldestId)
      this.dirtyContentBySession.delete(oldestId)
    }
  }

  /** 保护 sessionId 不被 evict（分屏 pane 使用） */
  protectSession(sessionId: string) {
    this.protectedSessions.add(sessionId)
  }

  /** 取消保护（pane 关闭或切换 session 时调用） */
  unprotectSession(sessionId: string) {
    this.protectedSessions.delete(sessionId)
  }

  updateSessionMetadata(
    sessionId: string,
    options: {
      hasMoreHistory?: boolean
      directory?: string
      title?: string
      loadState?: SessionState['loadState']
      loadError?: APIError
    },
  ) {
    const state = this.sessions.get(sessionId)
    if (!state) return

    if (options.hasMoreHistory !== undefined) state.hasMoreHistory = options.hasMoreHistory
    if (options.directory !== undefined) state.directory = options.directory
    if (options.title !== undefined) state.title = options.title
    if (options.loadState !== undefined) state.loadState = options.loadState
    if (options.loadError !== undefined) state.loadError = options.loadError

    this.notify([sessionId])
  }

  /**
   * 本地乐观插入消息（用户刚发出、服务端还没确认）。
   *
   * v2 的原生消息**不带 sessionID**（会话归属是事件上下文给的），
   * 因此 sessionId 必须显式传入，且必须是作用域 id。
   */
  upsertLocalMessage(sessionId: string, message: SessionMessageInfo) {
    const state = this.ensureSession(sessionId)
    const existingIndex = state.messages.findIndex(item => item.id === message.id)

    if (existingIndex >= 0) {
      const messages = state.messages.slice()
      messages[existingIndex] = message
      state.messages = messages
    } else {
      state.messages = [...state.messages, message].sort((a, b) => a.time.created - b.time.created)
    }

    // 记下「本地有、服务端列表还没有」的 id：setMessages 不能把它冲掉
    state.localMessageIds.add(message.id)

    this.notify([sessionId])
  }

  removeMessage(sessionId: string, messageId: string) {
    const state = this.sessions.get(sessionId)
    if (!state) return
    const nextMessages = state.messages.filter(message => message.id !== messageId)
    if (nextMessages.length === state.messages.length) return
    state.messages = nextMessages
    state.localMessageIds.delete(messageId)
    this.notify([sessionId])
  }

  markAllSessionsStale() {
    let updated = false
    for (const state of this.sessions.values()) {
      if (state.loadState !== 'loaded' || state.isStale) continue
      state.isStale = true
      updated = true
    }
    if (updated) this.notify('all')
  }

  setLoadState(sessionId: string, loadState: SessionState['loadState']) {
    const state = this.ensureSession(sessionId)
    state.loadState = loadState
    if (loadState !== 'error') state.loadError = undefined
    this.notify([sessionId])
  }

  setLoadError(sessionId: string, error: APIError) {
    const state = this.ensureSession(sessionId)
    state.loadState = 'error'
    state.loadError = error
    this.notify([sessionId])
  }

  // ============================================
  // Message CRUD
  // ============================================

  setMessages(
    sessionId: string,
    apiMessages: SessionMessageInfo[],
    options?: {
      directory?: string
      title?: string
      hasMoreHistory?: boolean
      revertState?: SessionRevert | null
    },
  ) {
    const state = this.ensureSession(sessionId)
    const previousMessages = state.messages
    const previousById = new Map(previousMessages.map(message => [message.id, message]))

    // 定稿（completed）强制采用服务端；仅「两边都还在流式」时才保留本地更长的 live 文本
    let messages = apiMessages.map(apiMessage => mergeIncomingMessage(previousById.get(apiMessage.id), apiMessage))

    // 保留「本地有、服务端列表还没返回」的消息：
    //   - 正在流式输出的助手消息（v2 的 prompt 是入队语义，step.started 会先建出
    //     助手消息，而同期的一次 message.list 可能还没包含它，直接覆盖会让正在
    //     输出的内容短暂消失）
    //   - 本地乐观插入、服务端尚未确认的用户消息（官方 outbox 的本地等价物）
    const apiIds = new Set(messages.map(message => message.id))
    const localOnly = previousMessages.filter(
      message => !apiIds.has(message.id) && (isOpenAssistant(message) || state.localMessageIds.has(message.id)),
    )
    if (localOnly.length > 0) {
      messages = [...messages, ...localOnly].sort((a, b) => a.time.created - b.time.created)
    }
    state.messages = messages

    // 服务端已确认的本地消息不再需要保护
    for (const id of Array.from(state.localMessageIds)) {
      if (apiIds.has(id)) state.localMessageIds.delete(id)
    }

    state.loadState = 'loaded'
    state.loadError = undefined
    state.hasMoreHistory = options?.hasMoreHistory ?? false
    state.directory = options?.directory ?? ''
    if (options?.title !== undefined) state.title = options.title
    state.isStale = false

    // Revert 状态
    const revert = options?.revertState
    if (revert?.messageID) {
      const revertIndex = state.messages.findIndex(message => message.id === revert.messageID)
      if (revertIndex !== -1) {
        const revertedUserMessages = state.messages.slice(revertIndex).filter(isUserMessage)
        state.revertState = {
          messageId: revert.messageID,
          // buildRevertHistoryItem 在 session 不存在时返回 undefined；此处 state 必然存在
          history: revertedUserMessages
            .map(message => this.buildRevertHistoryItem(sessionId, message))
            .filter((item): item is RevertHistoryItem => item !== undefined),
        }
      }
    } else {
      state.revertState = null
    }

    // 最后一条助手消息还没定稿 → 会话仍在输出
    const lastMessage = state.messages.at(-1)
    state.isStreaming = isOpenAssistant(lastMessage)

    this.notify([sessionId])
  }

  prependMessages(sessionId: string, apiMessages: SessionMessageInfo[], hasMore: boolean) {
    const state = this.sessions.get(sessionId)
    if (!state) return

    // 去重后整体前插（历史页总是更早的消息）
    const existingIds = new Set(state.messages.map(message => message.id))
    const unique = apiMessages.filter(message => !existingIds.has(message.id))

    if (unique.length > 0) {
      state.messages = [...unique, ...state.messages]
    }
    state.hasMoreHistory = hasMore

    this.notify([sessionId])
  }

  clearAll() {
    this.sessions.clear()
    this.sessionAccessTime.clear()
    this.dirtyContentBySession.clear()
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    this.pendingNotify = false
    this.notifyImmediate('all')
  }

  clearSession(sessionId: string) {
    this.sessions.delete(sessionId)
    this.sessionAccessTime.delete(sessionId)
    this.dirtyContentBySession.delete(sessionId)
    this.notify([sessionId])
  }

  /**
   * 用一条权威消息整条落库（重新读取 message.list / 单条 message.get 后的回填）。
   *
   * v2 没有 v1 的 `message.updated` 事件，但「拿到一条完整消息就覆盖」的入口
   * 仍然需要：未定稿时保留本地更长的 live 文本，定稿后以服务端为准。
   */
  handleMessageUpdated(apiMessage: SessionMessageInfo, sessionID: string) {
    const state = this.ensureSession(sessionID)
    const existingIndex = state.messages.findIndex(message => message.id === apiMessage.id)

    if (existingIndex >= 0) {
      const messages = state.messages.slice()
      messages[existingIndex] = mergeIncomingMessage(state.messages[existingIndex], apiMessage)
      state.messages = messages
    } else {
      this.appendMessage(state, apiMessage)
    }

    if (apiMessage.type === 'assistant') {
      state.isStreaming = apiMessage.time.completed == null
    }

    this.notify([sessionID])
  }

  /**
   * 助手内容整体替换（`session.message.content.updated` 重放 / 完整消息回读）。
   *
   * content 数组是权威快照，直接替换，不做增量合并。
   */
  handleMessageContent(messageID: string, sessionID: string, content: AssistantContent[]) {
    // 内容快照可能早于任何文本/推理事件到达（例如一轮里只有工具调用），
    // 甚至早于会话被登记；用 ensureSession 而不是「没有就 return」，
    // 否则首轮快照会被整条丢弃。
    this.ensureSession(sessionID)
    this.ensureAssistantMessage(sessionID, messageID)

    const state = this.sessions.get(sessionID)
    if (!state) return
    const message = this.findAssistant(state, messageID)
    if (!message) return

    message.content = [...content]
    this.markMessageDirty(sessionID, messageID, message.content)
    this.notify([sessionID])
  }

  // ============================================
  // SSE Event Handlers —— step / 文本 / 推理 / 工具
  // ============================================

  /**
   * `session.step.started`：创建（或就地重置）助手消息，官方 `data.ts:838-871`。
   *
   * 「已存在同 id」的分支**不清空 content**：text.started 可能先于本事件到达
   * （本地占位消息已经累积了内容），清空会把已经流出来的内容丢掉。
   */
  handleStepStarted(data: EventPayload<'session.step.started'>, facts?: EventFacts) {
    const { sessionID, assistantMessageID } = data
    const state = this.ensureSession(sessionID)
    const existing = this.findMessage(state, assistantMessageID)

    if (existing && existing.type === 'assistant') {
      existing.agent = data.agent
      existing.model = data.model
      existing.retry = undefined
      existing.error = undefined
      existing.finish = undefined
      existing.rawFinish = undefined
      existing.providerState = undefined
      existing.time.created = data.started
      existing.time.streamed = undefined
      existing.time.completed = undefined
      if (data.snapshot) existing.snapshot = { ...existing.snapshot, start: data.snapshot }
      this.markMessageDirty(sessionID, assistantMessageID, existing.content)
      state.isStreaming = true
      this.notify([sessionID])
      return
    }

    // 上一条仍开着的助手消息在这一步开始时定稿（官方同一位置）
    const active = this.activeAssistant(state.messages)
    if (active) {
      active.retry = undefined
      active.time.completed = facts?.created ?? Date.now()
      this.markMessageDirty(sessionID, active.id)
    }

    this.appendMessage(state, {
      id: assistantMessageID,
      type: 'assistant',
      agent: data.agent,
      model: data.model,
      metadata: facts?.metadata,
      content: [],
      snapshot: data.snapshot ? { start: data.snapshot } : undefined,
      time: { created: data.started },
    })
    state.isStreaming = true
    this.notify([sessionID])
  }

  handleStepStreamed(data: EventPayload<'session.step.streamed'>, facts?: EventFacts) {
    const state = this.sessions.get(data.sessionID)
    if (!state) return
    const message = this.findAssistant(state, data.assistantMessageID)
    if (!message) return
    message.time.streamed = facts?.created ?? Date.now()
    this.markMessageDirty(data.sessionID, message.id)
    this.notify([data.sessionID])
  }

  handleStepEnded(data: EventPayload<'session.step.ended'>, facts?: EventFacts) {
    const { sessionID, assistantMessageID } = data
    const state = this.sessions.get(sessionID)
    if (!state) return
    const message = this.findAssistant(state, assistantMessageID)
    if (!message) return

    message.time.completed = facts?.created ?? Date.now()
    message.finish = data.finish
    message.rawFinish = data.rawFinish
    message.providerState = data.providerState
    message.cost = data.cost
    message.tokens = data.tokens
    if (data.snapshot) message.snapshot = { ...message.snapshot, end: data.snapshot }

    this.markMessageDirty(sessionID, assistantMessageID)
    this.notify([sessionID])
  }

  handleStepFailed(data: EventPayload<'session.step.failed'>, facts?: EventFacts) {
    const { sessionID, assistantMessageID } = data
    const state = this.sessions.get(sessionID)
    if (!state) return
    const message = this.findAssistant(state, assistantMessageID)
    if (!message) return

    message.time.completed = facts?.created ?? Date.now()
    message.finish = data.finish ?? 'error'
    message.rawFinish = data.rawFinish
    message.providerState = data.providerState
    message.error = data.error
    message.retry = undefined
    if (data.cost !== undefined && data.tokens !== undefined) {
      message.cost = data.cost
      message.tokens = data.tokens
    }

    this.markMessageDirty(sessionID, assistantMessageID)
    this.notify([sessionID])
  }

  /** `session.text.started`：往 content 里追加一个空文本片段 */
  handleTextStarted(data: EventPayload<'session.text.started'>) {
    const { sessionID, assistantMessageID } = data
    this.ensureAssistantMessage(sessionID, assistantMessageID)
    this.editAssistant(sessionID, assistantMessageID, assistant => {
      const text: AssistantText = { type: 'text', text: '' }
      assistant.content.push(text)
      return text
    })
    this.notify([sessionID])
  }

  /**
   * `session.text.delta`：追加到**最后一个**文本片段（官方用 findLast）。
   *
   * 注意不能用 ordinal 定位：ordinal 是「第几段文本」，而重试/多次 step 会让
   * content 里同时存在多段文本，按 ordinal 找会写错片段。
   */
  handleTextDelta(data: EventPayload<'session.text.delta'>) {
    const { sessionID, assistantMessageID, delta } = data
    this.editText(sessionID, assistantMessageID, text => {
      text.text += delta
    })
    this.notify([sessionID])
  }

  /** `session.text.ended`：用权威文本覆盖（delta 是易失的，以此对齐） */
  handleTextEnded(data: EventPayload<'session.text.ended'>) {
    const { sessionID, assistantMessageID, text } = data
    this.editText(sessionID, assistantMessageID, item => {
      item.text = text
    })
    this.notify([sessionID])
  }

  handleReasoningStarted(data: EventPayload<'session.reasoning.started'>, facts?: EventFacts) {
    const { sessionID, assistantMessageID, state: providerState } = data
    const created = facts?.created ?? Date.now()
    this.ensureAssistantMessage(sessionID, assistantMessageID)
    this.editAssistant(sessionID, assistantMessageID, assistant => {
      const reasoning: AssistantReasoning = {
        type: 'reasoning',
        text: '',
        state: providerState,
        time: { created },
      }
      assistant.content.push(reasoning)
      return reasoning
    })
    this.notify([sessionID])
  }

  /** `session.reasoning.delta`：追加到最后一个**尚未完成**的推理片段 */
  handleReasoningDelta(data: EventPayload<'session.reasoning.delta'>) {
    const { sessionID, assistantMessageID, delta } = data
    this.editReasoning(sessionID, assistantMessageID, reasoning => {
      reasoning.text += delta
    })
    this.notify([sessionID])
  }

  /** `session.reasoning.ended`：写回权威文本，并标记该片段已完成 */
  handleReasoningEnded(data: EventPayload<'session.reasoning.ended'>, facts?: EventFacts) {
    const { sessionID, assistantMessageID, text, state: providerState } = data
    const created = facts?.created ?? Date.now()
    this.editReasoning(sessionID, assistantMessageID, reasoning => {
      reasoning.text = text
      reasoning.time = { created: reasoning.time?.created ?? created, completed: created }
      if (providerState !== undefined) reasoning.state = providerState
    })
    this.notify([sessionID])
  }

  /**
   * 工具生命周期事件（官方 `data.ts:919-981` 逐条对应）。
   *
   * 工具在 content 里按 `id` 定位（`findLast`），不像文本那样用 ordinal：
   * 同一个工具 id 只会有一个运行中的片段。
   *
   * `input.data.sessionID` 必须是**已作用域化**的会话 id（见文件头约定）。
   */
  handleToolEvent(input: ToolEventInput) {
    const { sessionID, assistantMessageID, id } = input.data
    this.ensureAssistantMessage(sessionID, assistantMessageID)
    const created = input.facts?.created ?? Date.now()

    switch (input.type) {
      case 'session.tool.input.started': {
        const { name } = input.data
        const startedAt = created
        this.editAssistant(sessionID, assistantMessageID, assistant => {
          const tool: AssistantTool = {
            type: 'tool',
            id,
            name,
            time: { created: startedAt },
            state: { status: 'streaming', input: '' },
          }
          assistant.content.push(tool)
          return tool
        })
        break
      }
      case 'session.tool.input.delta': {
        const { delta } = input.data
        this.editTool(sessionID, assistantMessageID, id, tool => {
          if (tool.state.status === 'streaming') tool.state.input += delta
        })
        break
      }
      case 'session.tool.input.ended': {
        const { text } = input.data
        this.editTool(sessionID, assistantMessageID, id, tool => {
          if (tool.state.status === 'streaming') tool.state.input = text
        })
        break
      }
      case 'session.tool.called': {
        const { input: toolInput, executed, state: providerState } = input.data
        const ranAt = created
        this.editTool(sessionID, assistantMessageID, id, tool => {
          tool.time.ran = ranAt
          tool.executed = executed
          tool.providerState = providerState
          tool.state = { status: 'running', input: toolInput, metadata: {} }
        })
        break
      }
      case 'session.tool.progress': {
        const { metadata } = input.data
        this.editTool(sessionID, assistantMessageID, id, tool => {
          if (tool.state.status === 'running') tool.state.metadata = metadata
        })
        break
      }
      case 'session.tool.success': {
        const { content, metadata, executed, resultState } = input.data
        const completedAt = created
        this.editTool(sessionID, assistantMessageID, id, tool => {
          if (tool.state.status !== 'running') return
          tool.state = {
            status: 'completed',
            input: tool.state.input,
            metadata,
            content: [...content] as [ToolContent, ...ToolContent[]],
          }
          tool.executed = executed || tool.executed === true
          tool.providerResultState = resultState
          tool.time.completed = completedAt
        })
        break
      }
      case 'session.tool.failed': {
        const { error, content, metadata, executed, resultState } = input.data
        const completedAt = created
        this.editTool(sessionID, assistantMessageID, id, tool => {
          if (tool.state.status !== 'streaming' && tool.state.status !== 'running') return
          tool.state = {
            status: 'error',
            error,
            // 流式阶段的 input 还是一段没解析完的字符串，失败时不能塞进结构化 input
            input: typeof tool.state.input === 'string' ? {} : tool.state.input,
            metadata,
            content,
          }
          tool.executed = executed || tool.executed === true
          tool.providerResultState = resultState
          tool.time.completed = completedAt
        })
        break
      }
    }

    this.notify([sessionID])
  }

  /** `session.retry.scheduled`：把重试信息挂到助手消息上（官方 data.ts:1004-1008） */
  handleRetryScheduled(data: EventPayload<'session.retry.scheduled'>) {
    const { sessionID, assistantMessageID, attempt, at, error } = data
    this.ensureAssistantMessage(sessionID, assistantMessageID)
    const state = this.sessions.get(sessionID)
    if (!state) return
    const message = this.findAssistant(state, assistantMessageID)
    if (!message) return

    message.retry = { attempt, at, error }
    this.markMessageDirty(sessionID, assistantMessageID)
    this.notify([sessionID])
  }

  /**
   * 确保助手消息存在于 store。
   *
   * 官方在消息未装载时**丢弃**流式事件（`message.editAssistant` 找不到就 return）。
   * 这里保留本仓库原有的占位行为：v2 的 text / tool 事件只带
   * `assistantMessageID`，若因为重连/时序导致 step.started 缺失，丢弃会让整轮
   * 输出凭空消失；先建一条空助手消息，step.started 到达时会就地重置它。
   */
  ensureAssistantMessage(sessionID: string, messageID: string): void {
    const state = this.ensureSession(sessionID)
    if (state.messages.some(message => message.id === messageID)) return

    this.appendMessage(state, {
      id: messageID,
      type: 'assistant',
      agent: state.agent ?? '',
      model: state.model ?? { id: '', providerID: '' },
      content: [],
      time: { created: Date.now() },
    })
    this.markMessageDirty(sessionID, messageID)
  }

  // ============================================
  // SSE Event Handlers —— 执行生命周期 / 压缩 / 其它原生消息
  // ============================================

  /** `session.execution.started`：会话开始执行 */
  handleExecutionStarted(data: EventPayload<'session.execution.started'>) {
    const state = this.ensureSession(data.sessionID)
    state.isStreaming = true
    this.notify([data.sessionID])
  }

  handleExecutionSucceeded(data: EventPayload<'session.execution.succeeded'>, facts?: EventFacts) {
    this.closeExecution(data.sessionID, 'succeeded', facts)
  }

  handleExecutionFailed(data: EventPayload<'session.execution.failed'>, facts?: EventFacts) {
    this.closeExecution(data.sessionID, 'failed', facts)
  }

  handleExecutionInterrupted(data: EventPayload<'session.execution.interrupted'>, facts?: EventFacts) {
    // 服务器关机导致的打断不产生 idle 标记（官方 data.ts:1033）
    this.closeExecution(data.sessionID, 'interrupted', facts, data.reason === 'shutdown')
  }

  /**
   * 执行结束的公共收尾（官方 `data.ts:1025-1062`）。
   *
   * 除了把会话置回 idle、清掉重试提示，还要**补一条 idle 标记消息**：
   * 它是服务端投影里就有的轮次边界，不补的话本地要等下一次 message.list
   * 才能对齐（期间轮次分组会错位）。
   */
  private closeExecution(sessionID: string, outcome: ExecutionOutcome, facts?: EventFacts, skipIdle = false) {
    const state = this.ensureSession(sessionID)
    state.isStreaming = false

    const active = this.activeAssistant(state.messages)
    if (active) {
      active.retry = undefined
      this.markMessageDirty(sessionID, active.id)
    }

    if (!skipIdle) {
      this.appendMessage(state, {
        id: messageIDFromFacts(facts),
        type: 'idle',
        outcome,
        time: { created: facts?.created ?? Date.now() },
      })
    }

    this.notify([sessionID])
  }

  /** `session.compaction.started`：插入一条 running 的压缩消息 */
  handleCompactionStarted(data: EventPayload<'session.compaction.started'>, facts?: EventFacts) {
    const { sessionID, inputID, reason, recent } = data
    const state = this.ensureSession(sessionID)
    this.appendMessage(state, {
      id: inputID ?? messageIDFromFacts(facts),
      type: 'compaction',
      status: 'running',
      reason,
      summary: '',
      recent: recent ?? '',
      time: { created: facts?.created ?? Date.now() },
    })
    this.notify([sessionID])
  }

  /** `session.compaction.delta`：把增量文本接到正在运行的压缩摘要上 */
  handleCompactionDelta(data: EventPayload<'session.compaction.delta'>) {
    const { sessionID, text } = data
    const state = this.sessions.get(sessionID)
    if (!state) return
    const current = state.messages.findLast(isRunningCompaction)
    if (!current) return
    current.summary += text
    this.markMessageDirty(sessionID, current.id)
    this.notify([sessionID])
  }

  /** `session.compaction.ended`：把 running 的压缩消息改写成 completed */
  handleCompactionEnded(data: EventPayload<'session.compaction.ended'>, facts?: EventFacts) {
    const { sessionID, reason, model, providerState, providerContext, text, recent, cost, tokens } = data
    const state = this.ensureSession(sessionID)
    const current = state.messages.findLast(isRunningCompaction)

    if (current) {
      const completed: CompactionCompleted = {
        id: current.id,
        type: 'compaction',
        status: 'completed',
        reason,
        model,
        providerState,
        providerContext,
        summary: text,
        recent,
        cost,
        tokens,
        metadata: current.metadata,
        time: current.time,
      }
      this.replaceMessage(state, current.id, completed)
    } else {
      this.appendMessage(state, {
        id: messageIDFromFacts(facts),
        type: 'compaction',
        status: 'completed',
        reason,
        model,
        providerState,
        providerContext,
        summary: text,
        recent,
        cost,
        tokens,
        time: { created: facts?.created ?? Date.now() },
      })
    }

    this.notify([sessionID])
  }

  /** `session.compaction.failed`：running 的压缩消息改写成 failed（没有则新插一条） */
  handleCompactionFailed(data: EventPayload<'session.compaction.failed'>, facts?: EventFacts) {
    const { sessionID, inputID, reason, error, cost, tokens } = data
    const state = this.ensureSession(sessionID)
    const current = state.messages.findLast(isRunningCompaction)

    const failed: CompactionFailed = {
      id: current?.id ?? inputID ?? messageIDFromFacts(facts),
      type: 'compaction',
      status: 'failed',
      reason: reason ?? 'manual',
      error: error ?? { type: 'compaction.failed', message: 'Compaction failed before recording an error' },
      metadata: current?.metadata ?? facts?.metadata,
      cost,
      tokens,
      time: current?.time ?? { created: facts?.created ?? Date.now() },
    }

    if (current) {
      this.replaceMessage(state, current.id, failed)
    } else {
      this.appendMessage(state, failed)
    }

    this.notify([sessionID])
  }

  /** `session.synthetic`：注入的系统上下文（合成消息） */
  handleSynthetic(data: EventPayload<'session.synthetic'>, facts?: EventFacts) {
    const { sessionID, text, description, metadata } = data
    const state = this.ensureSession(sessionID)
    this.appendMessage(state, {
      id: messageIDFromFacts(facts),
      type: 'synthetic',
      text,
      description,
      metadata: metadata ?? facts?.metadata,
      time: { created: facts?.created ?? Date.now() },
    })
    this.notify([sessionID])
  }

  /** `session.usage.updated`：会话级成本 / token（官方记在 session.info 上） */
  handleUsageUpdated(data: EventPayload<'session.usage.updated'>) {
    const state = this.sessions.get(data.sessionID)
    if (!state) return
    state.cost = data.cost
    state.tokens = data.tokens
    this.notify([data.sessionID])
  }

  /** `session.agent.selected`：切换 agent，并在消息流里留下一条切换记录 */
  handleAgentSelected(data: EventPayload<'session.agent.selected'>, facts?: EventFacts) {
    const { sessionID, agent } = data
    const state = this.ensureSession(sessionID)
    const previous = state.agent
    state.agent = agent
    this.appendMessage(state, {
      id: messageIDFromFacts(facts),
      type: 'agent-switched',
      agent,
      previous,
      time: { created: facts?.created ?? Date.now() },
    })
    this.notify([sessionID])
  }

  /**
   * `session.model.selected`：切换模型。
   *
   * 官方（`data.ts:668`）只在**会话已经装载过消息数组**时才补 `model-switched`
   * 行，避免在还没读过消息的会话里插出一条孤立的切换记录 —— 这里用
   * 「会话已在 store 里」作为同一判据。
   *
   * 官方随后还会 `session.message.get` 回读这一条消息做校正；本仓库的
   * `src/api/message.ts` 只有 `getSessionMessages`（列表），没有单条 get 的封装，
   * 因此这里不做回读（迁移层若要补，可拿到消息后调 `handleMessageUpdated`）。
   */
  handleModelSelected(data: EventPayload<'session.model.selected'>, facts?: EventFacts) {
    const { sessionID, model } = data
    const state = this.sessions.get(sessionID)
    if (!state) return
    state.model = model
    this.appendMessage(state, {
      id: messageIDFromFacts(facts),
      type: 'model-switched',
      model,
      time: { created: facts?.created ?? Date.now() },
    })
    this.notify([sessionID])
  }

  /** `session.shell.started`：插入 shell 消息 */
  handleShellStarted(data: EventPayload<'session.shell.started'>, facts?: EventFacts) {
    const { sessionID, shell } = data
    const state = this.ensureSession(sessionID)
    this.appendMessage(state, {
      id: messageIDFromFacts(facts),
      type: 'shell',
      shellID: shell.id,
      command: shell.command,
      status: shell.status,
      exit: shell.exit,
      // 后台命令在 UI 上有独立呈现，标记透传（官方 data.ts:823-825）
      metadata: shell.metadata.background === true ? { ...facts?.metadata, background: true } : facts?.metadata,
      time: { created: facts?.created ?? Date.now() },
    })
    this.notify([sessionID])
  }

  /** `session.shell.ended`：按 shellID 回填最后一条同 id 的 shell 消息 */
  handleShellEnded(data: EventPayload<'session.shell.ended'>, facts?: EventFacts) {
    const { sessionID, shell, output } = data
    const state = this.sessions.get(sessionID)
    if (!state) return
    const match = state.messages.findLast(
      (message): message is ShellMessage => message.type === 'shell' && message.shellID === shell.id,
    )
    if (!match) return

    match.status = shell.status
    match.exit = shell.exit
    match.output = output
    match.time.completed = facts?.created ?? Date.now()
    this.markMessageDirty(sessionID, match.id)
    this.notify([sessionID])
  }

  /** `session.skill.activated`：插入 skill 消息 */
  handleSkillActivated(data: EventPayload<'session.skill.activated'>, facts?: EventFacts) {
    const { sessionID, id, name, text } = data
    const state = this.ensureSession(sessionID)
    this.appendMessage(state, {
      id: messageIDFromFacts(facts),
      type: 'skill',
      skill: id,
      name,
      text,
      time: { created: facts?.created ?? Date.now() },
    })
    this.notify([sessionID])
  }

  /**
   * `session.instructions.updated`：插入 system 消息。
   *
   * 与官方一致（`data.ts:791-804`）：没有 text 的更新（初始基线与空 delta）
   * 不产生消息，否则每轮都会多出一行空记录。
   */
  handleInstructionsUpdated(data: EventPayload<'session.instructions.updated'>, facts?: EventFacts) {
    const { sessionID, text, delta } = data
    if (text === undefined) return
    const state = this.ensureSession(sessionID)
    this.appendMessage(state, {
      id: messageIDFromFacts(facts),
      type: 'system',
      text,
      description: `Instructions updated: ${Object.keys(delta).join(', ')}`,
      metadata: facts?.metadata,
      time: { created: facts?.created ?? Date.now() },
    })
    this.notify([sessionID])
  }

  handleSessionIdle(sessionId: string) {
    const state = this.sessions.get(sessionId)
    if (!state) return

    state.isStreaming = false
    // 会话已 idle，但助手消息可能没等到 step.ended（断线/被中断）：
    // 这里补一个完成时间，否则它会永远被当成「正在输出」。
    const completedAt = Date.now()
    for (const message of state.messages) {
      if (!isOpenAssistant(message)) continue
      message.time.completed = completedAt
      this.markMessageDirty(sessionId, message.id)
    }
    this.notify([sessionId])
  }

  handleSessionError(sessionId: string) {
    const state = this.sessions.get(sessionId)
    if (!state) return

    state.isStreaming = false
    const completedAt = Date.now()
    for (const message of state.messages) {
      if (!isOpenAssistant(message)) continue
      message.time.completed = completedAt
      this.markMessageDirty(sessionId, message.id)
    }
    this.notify([sessionId])
  }

  // ============================================
  // Undo/Redo
  // ============================================

  truncateAfterRevert(sessionId: string) {
    const state = this.sessions.get(sessionId)
    if (!state || !state.revertState) return

    const revertIndex = state.messages.findIndex(message => message.id === state.revertState!.messageId)
    if (revertIndex !== -1) {
      state.messages = state.messages.slice(0, revertIndex)
    }
    state.revertState = null
    this.notify([sessionId])
  }

  createSendRollbackSnapshot(sessionId: string): SendRollbackSnapshot | null {
    const state = this.sessions.get(sessionId)
    if (!state?.revertState) return null

    return {
      messages: state.messages.map(cloneMessage),
      revertState: {
        ...state.revertState,
        history: state.revertState.history.map(item => ({ ...item, attachments: [...item.attachments] })),
      },
    }
  }

  restoreSendRollback(sessionId: string, snapshot: SendRollbackSnapshot) {
    const state = this.sessions.get(sessionId)
    if (!state) return

    state.messages = snapshot.messages.map(cloneMessage)
    state.revertState = snapshot.revertState
      ? {
          ...snapshot.revertState,
          history: snapshot.revertState.history.map(item => ({ ...item, attachments: [...item.attachments] })),
        }
      : null
    state.isStreaming = false
    // 快照已经把旧对象换掉了，上一帧记下的脏引用不能再作用到新数组上
    this.dirtyContentBySession.delete(sessionId)
    this.notify([sessionId])
  }

  setRevertState(sessionId: string, revertState: RevertState | null) {
    const state = this.sessions.get(sessionId)
    if (!state) return
    state.revertState = revertState
    this.notify([sessionId])
  }

  canUndo(sessionId: string | null): boolean {
    if (!sessionId) return false
    const state = this.sessions.get(sessionId)
    if (!state || state.isStreaming) return false
    return this.getVisibleMessages(sessionId).some(isUserMessage)
  }

  canRedo(sessionId: string | null): boolean {
    if (!sessionId) return false
    const state = this.sessions.get(sessionId)
    if (!state || state.isStreaming) return false
    return (state.revertState?.history.length ?? 0) > 0
  }

  getRedoSteps(sessionId: string | null): number {
    if (!sessionId) return 0
    const state = this.sessions.get(sessionId)
    return state?.revertState?.history.length ?? 0
  }

  getCurrentRevertedContent(sessionId: string | null): RevertHistoryItem | null {
    if (!sessionId) return null
    const state = this.sessions.get(sessionId)
    const revertState = state?.revertState ?? null
    if (!revertState || revertState.history.length === 0) return null
    return revertState.history[0]
  }

  // ============================================
  // Streaming Control
  // ============================================

  setStreaming(sessionId: string, isStreaming: boolean) {
    const state = isStreaming ? this.ensureSession(sessionId) : this.sessions.get(sessionId)
    if (!state) return
    state.isStreaming = isStreaming
    this.notify([sessionId])
  }

  // ============================================
  // Private Helpers
  // ============================================

  /** 用户消息的可见正文（v2 里正文就是 `message.text`） */
  extractUserText(message: SessionMessageInfo): string {
    return isUserMessage(message) ? userMessageText(message) : ''
  }

  /**
   * 用户消息的附件（v2 拆成 files / agents 两个数组，不再有 file / agent 片段）。
   *
   * 消息记录里的 files 是 `PromptFileAttachment`（`{ data, mime, source, name? }`，
   * 没有 url），路径只能从 `source` 取。
   */
  extractUserAttachments(message: SessionMessageInfo): Attachment[] {
    if (!isUserMessage(message)) return []

    const attachments: Attachment[] = []

    for (const file of message.files ?? []) {
      const source = file.source
      const uri = source?.type === 'uri' ? source.uri : ''
      const displayName = file.name || uri || file.mime || 'attachment'
      attachments.push({
        id: crypto.randomUUID(),
        type: 'file',
        displayName,
        url: uri,
        mime: file.mime,
        relativePath: uri || displayName,
      })
    }

    for (const agent of message.agents ?? []) {
      attachments.push({
        id: crypto.randomUUID(),
        type: 'agent',
        displayName: agent.name,
        agentName: agent.name,
      })
    }

    return attachments
  }

  /**
   * 构造一条撤销历史项。
   *
   * 公开：`useSessionManager` 的 undo 路径需要构造同样的结构，这里保持**唯一实现**，
   * 否则两份会漂移（v2 的用户消息不带 model/agent，必须按会话级当前值回填，
   * 这种细节最容易两边写得不一致）。
   */
  buildRevertHistoryItem(sessionId: string, message: UserMessage): RevertHistoryItem | undefined {
    const state = this.sessions.get(sessionId)
    if (!state) return undefined
    const model = state.model
    return {
      messageId: message.id,
      text: this.extractUserText(message),
      attachments: this.extractUserAttachments(message),
      // v2 的用户消息不带 model / agent，用会话级当前值回填（见 SessionState 注释）
      model: model ? { providerID: model.providerID, modelID: model.id, variant: model.variant } : undefined,
      variant: model?.variant,
      agent: state.agent,
    }
  }

  /** 官方 `message.append`：按 id 去重后追加（保持创建顺序） */
  private appendMessage(state: SessionState, item: SessionMessageInfo): void {
    if (state.messages.some(message => message.id === item.id)) return
    state.messages = [...state.messages, item]
  }

  /** 就地替换一条消息（状态跃迁用，例如 running 压缩 → completed） */
  private replaceMessage(state: SessionState, messageID: string, next: SessionMessageInfo): void {
    const index = state.messages.findIndex(message => message.id === messageID)
    if (index === -1) return
    const messages = state.messages.slice()
    messages[index] = next
    state.messages = messages
  }

  private findMessage(state: SessionState, messageID: string): SessionMessageInfo | undefined {
    return state.messages.find(message => message.id === messageID)
  }

  private findAssistant(state: SessionState, messageID: string): AssistantMessage | undefined {
    const message = this.findMessage(state, messageID)
    return message?.type === 'assistant' ? message : undefined
  }

  /** 官方 `message.activeAssistant`：最后一条还没定稿的助手消息 */
  private activeAssistant(messages: SessionMessageInfo[]): AssistantMessage | undefined {
    return messages.findLast(isOpenAssistant)
  }

  /**
   * 就地改写助手消息的内容片段（官方 `message.editAssistant`）。
   *
   * 返回被改动的片段（或片段数组），由 `markMessageDirty` 记下来 ——
   * rAF 时只克隆这些片段，其余片段继续复用引用。
   */
  private editAssistant(
    sessionID: string,
    messageID: string,
    fn: (assistant: AssistantMessage) => AssistantContent | AssistantContent[] | undefined,
  ): void {
    const state = this.sessions.get(sessionID)
    if (!state) return
    const assistant = this.findAssistant(state, messageID)
    if (!assistant) return
    const touched = fn(assistant)
    this.markMessageDirty(sessionID, messageID, touched)
  }

  /** 官方 `message.editText`：定位最后一个文本片段 */
  private editText(sessionID: string, messageID: string, fn: (text: AssistantText) => void): void {
    this.editAssistant(sessionID, messageID, assistant => {
      const text = assistant.content.findLast((item): item is AssistantText => item.type === 'text')
      if (!text) return undefined
      fn(text)
      return text
    })
  }

  /** 官方 `message.editReasoning`：定位最后一个**未完成**的推理片段 */
  private editReasoning(sessionID: string, messageID: string, fn: (reasoning: AssistantReasoning) => void): void {
    this.editAssistant(sessionID, messageID, assistant => {
      const reasoning = assistant.content.findLast(
        (item): item is AssistantReasoning => item.type === 'reasoning' && !item.time?.completed,
      )
      if (!reasoning) return undefined
      fn(reasoning)
      return reasoning
    })
  }

  /** 官方 `message.editTool`：按 id 定位工具片段（同一个 id 只保留最后一条） */
  private editTool(sessionID: string, messageID: string, toolID: string, fn: (tool: AssistantTool) => void): void {
    this.editAssistant(sessionID, messageID, assistant => {
      const tool = assistant.content.findLast(
        (item): item is AssistantTool => item.type === 'tool' && item.id === toolID,
      )
      if (!tool) return undefined
      fn(tool)
      return tool
    })
  }
}

export const messageStore = new MessageStore()
