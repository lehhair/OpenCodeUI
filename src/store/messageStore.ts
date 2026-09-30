// ============================================
// MessageStore - 消息状态集中管理
// ============================================
//
// 核心设计：
// 1. 每个 session 的消息独立存储在内存中
// 2. SSE 事件直接修改对应 session 的消息（找不到则丢弃）
// 3. Undo/Redo 通过 revertState 实现
// 4. RAF 批量通知 React 组件更新

import type {
  AssistantMessageInfo,
  Message,
  MessageError,
  MessageInfo,
  Part,
  FilePart,
  AgentPart,
} from '../types/message'
import type { ApiSession, Attachment } from '../api/types'
import type { SessionMessageAssistantContent, SessionMessageInfo } from '../types/api/message'
import type {
  MessageContentUpdatedPayload,
  PartDeltaPayload,
  PartStepEndedPayload,
  PartStepStartedPayload,
  PartUpdatedPayload,
} from '../types/api/event'
import { logger } from '../utils/logger'
import {
  isUserUIMessage,
  toUIMessages,
  toUIPartFromContent,
  toStepFinishPart,
  toMessageError,
  toTokenUsage,
} from '../utils/messageConversion'
import type { RevertState, RevertHistoryItem, SessionState, SendRollbackSnapshot } from './messageStoreTypes'

// Re-export types for consumers
export type { RevertState, RevertHistoryItem, SessionState, SendRollbackSnapshot } from './messageStoreTypes'

type Subscriber = () => void

const MAX_CACHED_SESSIONS = 10

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

function partHasText(part: Part): part is Part & { text: string } {
  return 'text' in part && typeof (part as { text?: unknown }).text === 'string'
}

function mergePartPreferLiveText(local: Part | undefined, incoming: Part): Part {
  if (!local || local.id !== incoming.id) return incoming
  if (!partHasText(local) || !partHasText(incoming)) return incoming
  const text = preferCompatibleText(local.text, incoming.text)
  if (text === incoming.text) return incoming
  return { ...incoming, text } as Part
}

function mergePartsPreferLiveText(localParts: Part[], incomingParts: Part[]): Part[] {
  if (localParts.length === 0) return incomingParts
  const localById = new Map(localParts.map(part => [part.id, part]))
  return incomingParts.map(part => mergePartPreferLiveText(localById.get(part.id), part))
}

function messageIsIncomplete(message: { isStreaming?: boolean; info: { time?: { completed?: number } } }) {
  if (message.isStreaming) return true
  const completed = message.info.time && 'completed' in message.info.time ? message.info.time.completed : undefined
  return completed == null
}

/**
 * 仅未定稿时保护更长 live；incoming/本地已 completed 则强制服务端，不再 preserve。
 */
function shouldPreserveLiveParts(
  previous: { isStreaming?: boolean; info: { time?: { completed?: number } } },
  incoming?: { isStreaming?: boolean; info: { time?: { completed?: number } } },
) {
  if (incoming && !messageIsIncomplete(incoming)) return false
  return messageIsIncomplete(previous)
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
  // delta 批量化：只追踪真正变化的 part，避免同消息内稳定 part 的 memo 引用失效
  private dirtyPartsBySession = new Map<string, Map<string, Set<string>>>()

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

  /**
   * 将 delta 期间 mutable 修改过的消息做一次不可变快照。
   * 这样一帧内多个 delta 只产生一次数组拷贝，未变化的 part 继续复用引用。
   */
  private flushDirtyMessages() {
    if (this.dirtyPartsBySession.size === 0) return

    for (const [sessionId, dirtyPartsByMessage] of this.dirtyPartsBySession) {
      const state = this.sessions.get(sessionId)
      if (!state) continue

      let changed = false
      const newMessages = state.messages.map(m => {
        const dirtyPartIds = dirtyPartsByMessage.get(m.info.id)
        if (!dirtyPartIds) return m

        let partsChanged = false
        const parts = m.parts.map(part => {
          if (!dirtyPartIds.has(part.id)) return part
          partsChanged = true
          return { ...part }
        })
        if (!partsChanged) return m

        changed = true
        return { ...m, parts }
      })

      if (changed) {
        state.messages = newMessages
      }
    }

    this.dirtyPartsBySession.clear()
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

  getVisibleMessages(sessionId: string | null): Message[] {
    if (!sessionId) return []
    const state = this.sessions.get(sessionId)
    if (!state) return []

    const { messages, revertState } = state
    if (!revertState) return messages

    const revertIndex = messages.findIndex(m => m.info.id === revertState.messageId)
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

  getPrependedCount(): number {
    return 0
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
        // V2 游标分页：null = 还没拿到过游标
        historyCursor: null,
        directory: '',
        title: undefined,
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
      loadError?: MessageError
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

  upsertLocalMessage(message: Message) {
    const state = this.ensureSession(message.info.sessionID)
    const existingIndex = state.messages.findIndex(item => item.info.id === message.info.id)

    if (existingIndex >= 0) {
      state.messages = [...state.messages.slice(0, existingIndex), message, ...state.messages.slice(existingIndex + 1)]
    } else {
      state.messages = [...state.messages, message].sort((a, b) => {
        const aCreated = a.info.time?.created ?? 0
        const bCreated = b.info.time?.created ?? 0
        return aCreated - bCreated
      })
    }

    this.notify([message.info.sessionID])
  }

  removeMessage(sessionId: string, messageId: string) {
    const state = this.sessions.get(sessionId)
    if (!state) return
    const nextMessages = state.messages.filter(message => message.info.id !== messageId)
    if (nextMessages.length === state.messages.length) return
    state.messages = nextMessages
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

  setLoadError(sessionId: string, error: MessageError) {
    const state = this.ensureSession(sessionId)
    state.loadState = 'error'
    state.loadError = error
    this.notify([sessionId])
  }

  // ============================================
  // Message CRUD
  // ============================================

  /**
   * 用一页 V2 消息**整体替换**当前 session 的消息（阶段 2a 重写）
   *
   * 改动点：
   *   - 入参从 V1 的 `ApiMessageWithParts[]`（`{info, parts}`）换成
   *     **V2 的 `Session.Message.Info[]`**（扁平联合）；
   *   - 转换交给 `toUIMessages(messages, sessionId)`（V2 消息不带 sessionID，必须在这里补）；
   *   - 新增 `historyCursor`：V2 的向前翻页游标。
   *
   * ⚠️ **去重/排序规则**：
   *    入参已经由 `getSessionMessages()` 重排成**旧→新**，这里**不再排序**，
   *    保持服务端顺序（服务端按 `seq` 排，是权威顺序；本地按 `time.created`
   *    排序会在同一毫秒内出现不稳定顺序）。
   */
  setMessages(
    sessionId: string,
    apiMessages: SessionMessageInfo[],
    options?: {
      directory?: string
      title?: string
      hasMoreHistory?: boolean
      /** V2 游标分页：更旧一页的游标（`cursor.next`） */
      historyCursor?: string | null
      /**
       * 保留「本地独有」的消息（本地有、这一页里没有）。
       *
       * 用途：流式中刷新历史时，SSE 已经推过来的消息可能还没进 REST 页，
       * 若直接整体替换就会把它们抹掉。
       * ⚠️ 仅在 `state.isStreaming` 为真时调用方才该置 true（与 V1 行为一致）。
       */
      keepLocalOnly?: boolean
      revertState?: ApiSession['revert'] | null
    },
  ) {
    const state = this.ensureSession(sessionId)
    const previousMessages = state.messages
    const previousById = new Map(previousMessages.map(message => [message.info.id, message]))

    const nextMessages = toUIMessages(apiMessages, sessionId).map(next => {
      const previous = previousById.get(next.info.id)
      // 定稿（completed）强制采用服务端；仅流式/未完成时不回退更长 live
      if (!previous || !shouldPreserveLiveParts(previous, next)) return next
      return {
        ...next,
        parts: mergePartsPreferLiveText(previous.parts, next.parts),
        isStreaming: previous.isStreaming || next.isStreaming,
      }
    })

    // 保留本地独有消息（流式中 SSE 抢先推送、REST 页里还没有的那些）
    if (options?.keepLocalOnly) {
      const incomingIds = new Set(nextMessages.map(m => m.info.id))
      const localOnly = previousMessages.filter(m => !incomingIds.has(m.info.id))
      state.messages = localOnly.length > 0 ? [...nextMessages, ...localOnly] : nextMessages
    } else {
      state.messages = nextMessages
    }
    state.loadState = 'loaded'
    state.loadError = undefined
    state.hasMoreHistory = options?.hasMoreHistory ?? false
    // 只有显式传了才覆盖游标（避免刷新元数据时把游标清掉）
    if (options?.historyCursor !== undefined) state.historyCursor = options.historyCursor
    state.directory = options?.directory ?? ''
    if (options?.title !== undefined) state.title = options.title
    state.isStale = false

    // Revert 状态
    if (options?.revertState?.messageID) {
      const revertIndex = state.messages.findIndex(m => m.info.id === options.revertState!.messageID)
      if (revertIndex !== -1) {
        const revertedUserMessages = state.messages.slice(revertIndex).filter(isUserUIMessage)
        state.revertState = {
          messageId: options.revertState.messageID,
          history: revertedUserMessages.map(m => {
            return {
              messageId: m.info.id,
              text: this.extractUserText(m),
              attachments: this.extractUserAttachments(m),
              model: m.info.model,
              variant: m.info.model.variant,
              agent: m.info.agent,
            }
          }),
        }
      }
    } else {
      state.revertState = null
    }

    // Streaming 检测
    const lastMsg = state.messages[state.messages.length - 1]
    if (lastMsg?.info.role === 'assistant') {
      const isLastMsgStreaming = !lastMsg.info.time?.completed
      state.isStreaming = isLastMsgStreaming
      if (isLastMsgStreaming) {
        const lastIndex = state.messages.length - 1
        state.messages[lastIndex] = { ...state.messages[lastIndex], isStreaming: true }
      }
    } else {
      state.isStreaming = false
    }

    this.notify([sessionId])
  }

  /**
   * 把**更旧的一页** V2 消息插到当前消息列表前面（阶段 2a 重写）
   *
   * 调用方是 `useSessionManager.loadMoreHistory()`：滚动到顶部时用
   * `state.historyCursor`（= 服务端的 `cursor.next`）拉更旧的一页。
   *
   * @param apiMessages 已经由 `getSessionMessages()` 重排成**旧→新**的一页
   * @param hasMore     该页之后是否还有更早的历史（由 `limit + 1` 溢出法算出）
   * @param historyCursor 下一页（更旧）的游标；`null` 表示已到最早
   */
  prependMessages(
    sessionId: string,
    apiMessages: SessionMessageInfo[],
    hasMore: boolean,
    historyCursor?: string | null,
  ) {
    const state = this.sessions.get(sessionId)
    if (!state) return

    const newMessages = toUIMessages(apiMessages, sessionId)

    // 去重：游标分页的边界处可能重复（服务端游标锚定在「本页最后一条」，
    // 正常不会重复，但重试/并发加载时可能出现）→ 按 id 去重，保留已有的那份。
    const existingIds = new Set(state.messages.map(m => m.info.id))
    const unique = newMessages.filter(m => !existingIds.has(m.info.id))

    if (unique.length > 0) {
      // 入参已是旧→新，直接前置即可（不重新排序，保持服务端 seq 顺序）
      state.messages = [...unique, ...state.messages]
    }
    state.hasMoreHistory = hasMore
    if (historyCursor !== undefined) state.historyCursor = historyCursor

    this.notify([sessionId])
  }

  /** 读取向前（更旧）翻页的游标；`null` 表示没有更早的历史或尚未加载 */
  getHistoryCursor(sessionId: string | null): string | null {
    if (!sessionId) return null
    return this.sessions.get(sessionId)?.historyCursor ?? null
  }

  /** 写入向前翻页游标（`getSessionMessages()` 返回后调用） */
  setHistoryCursor(sessionId: string, cursor: string | null) {
    const state = this.sessions.get(sessionId)
    if (!state) return
    state.historyCursor = cursor
  }

  /**
   * 按 id 插入/更新一批 V2 消息（**不整体替换**，阶段 2a 新增）
   *
   * 用于「补齐」场景：SSE 可能漏推（或断流），需要主动回拉一次把缺口补上，
   * 但**不能**用 `setMessages` —— 那只拉了一小页，会把已加载的历史全部抹掉。
   *
   * 合并规则与 `setMessages` 一致（未定稿时保留更长的 live 文本）；
   * 新增的消息按 `time.created` 升序插入。
   */
  upsertMessages(sessionId: string, apiMessages: SessionMessageInfo[]) {
    const state = this.ensureSession(sessionId)
    const incoming = toUIMessages(apiMessages, sessionId)
    if (incoming.length === 0) return

    const previousById = new Map(state.messages.map(m => [m.info.id, m]))
    const incomingIds = new Set<string>()

    const merged = incoming.map(next => {
      incomingIds.add(next.info.id)
      const previous = previousById.get(next.info.id)
      if (!previous || !shouldPreserveLiveParts(previous, next)) return next
      return {
        ...next,
        parts: mergePartsPreferLiveText(previous.parts, next.parts),
        isStreaming: previous.isStreaming || next.isStreaming,
      }
    })

    const untouched = state.messages.filter(m => !incomingIds.has(m.info.id))
    // 增量补齐场景拿不到服务端 seq 顺序，只能按创建时间排（稳定排序）
    state.messages = [...untouched, ...merged].sort((a, b) => (a.info.time?.created ?? 0) - (b.info.time?.created ?? 0))

    this.notify([sessionId])
  }

  clearAll() {
    this.sessions.clear()
    this.sessionAccessTime.clear()
    this.dirtyPartsBySession.clear()
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
    this.dirtyPartsBySession.delete(sessionId)
    this.notify([sessionId])
  }

  // ============================================
  // SSE Event Handlers —— V2 形状（阶段 2b 重写）
  // ============================================
  //
  // 对接的 V2 事件族（V1 的 4 个 handler 逐一对应）：
  //
  //   handleMessageUpdated      ← session.message.content.updated（整条 content 替换）
  //   handlePartUpdated         ← session.text.* / session.reasoning.* / session.tool.* / session.step.*
  //   handlePartDelta           ← session.text.delta / session.reasoning.delta / session.tool.input.delta
  //   handleSessionInvalidated  ← 取消/回退（session.revert.* / execution.interrupted）→ **重拉消息**
  //                               （V1 的 message.part.removed 在 V2 没有对应事件，
  //                                 本地增量删除无法保证与服务器转录一致 → 只能重拉）
  //
  // ⚠️ 三条硬规则（与阶段 2a 的转换层**必须一致**，否则 id 会漂移）：
  //   1. `sessionID` 由事件层从 `event.data.sessionID` 取，**强制入参**，不给默认值；
  //   2. text / reasoning 的 part id = `消息id:content:下标`（**下标**，不是同类型计数）；
  //   3. 尾部 `step-finish` part **只在 finish 已存在时**合成（流式中不合成）。

  /**
   * 整条 assistant 消息的 content 被替换（`session.message.content.updated`）
   *
   * 与 `handlePartUpdated` 的区别：这里是**权威全量**，直接重建 parts 列表。
   * 消息不存在时会先建一条占位（流式中事件可能先于 REST 页到达）。
   */
  handleMessageUpdated(payload: MessageContentUpdatedPayload) {
    const { sessionID, messageID, content } = payload
    const state = this.ensureSession(sessionID)
    const existingIndex = state.messages.findIndex(m => m.info.id === messageID)

    const existing = existingIndex >= 0 ? state.messages[existingIndex] : undefined
    const sessionInfo = existing?.info ?? this.createStreamingAssistantInfo(messageID, sessionID)
    const parts = this.buildContentParts(messageID, sessionID, content, sessionInfo)

    const nextMessage: Message = { ...existing, info: sessionInfo, parts, isStreaming: existing?.isStreaming ?? true }

    if (existingIndex >= 0) {
      state.messages = [
        ...state.messages.slice(0, existingIndex),
        nextMessage,
        ...state.messages.slice(existingIndex + 1),
      ]
    } else {
      state.messages = [...state.messages, nextMessage]
      state.isStreaming = true
    }

    this.notify([sessionID])
  }

  /**
   * 单个 part 的整块更新（`session.text.*` / `session.reasoning.*` / `session.tool.*` / `session.step.*`）
   *
   * `kind: 'content'` 是 content 块更新；`kind: 'step'` 是 step 结束（成本/用量/结束原因）。
   */
  handlePartUpdated(payload: PartUpdatedPayload) {
    const { sessionID, messageID } = payload
    const state = this.sessions.get(sessionID)
    if (!state) return

    const msgIndex = state.messages.findIndex(m => m.info.id === messageID)

    // 消息还不存在（事件先于 REST 页到达）→ 先建一条流式占位，避免丢事件
    if (msgIndex === -1) {
      const placeholder: Message = {
        info: this.createStreamingAssistantInfo(messageID, sessionID),
        parts: [],
        isStreaming: true,
      }
      state.messages = [...state.messages, placeholder]
      state.isStreaming = true
    }

    const index = state.messages.findIndex(m => m.info.id === messageID)
    if (index === -1) return
    const oldMessage = state.messages[index]

    if (payload.kind === 'step') {
      this.applyStepEnded(state, index, oldMessage, payload)
      this.notify([sessionID])
      return
    }

    if (payload.kind === 'step-start') {
      this.applyStepStarted(state, index, oldMessage, payload)
      this.notify([sessionID])
      return
    }
    const incoming = toUIPartFromContent(
      messageID,
      sessionID,
      payload.ordinal,
      payload.content,
      oldMessage.info.time?.created ?? Date.now(),
    )
    if (!incoming) return

    const newParts = this.upsertPart(oldMessage.parts, incoming, oldMessage)
    const newMessage: Message = { ...oldMessage, parts: newParts }
    state.messages = [...state.messages.slice(0, index), newMessage, ...state.messages.slice(index + 1)]
    this.notify([sessionID])
  }

  /**
   * 增量追加（`session.text.delta` / `session.reasoning.delta` / `session.tool.input.delta`）
   *
   * ⚠️ `partID` 是**事件层已经算好的 UI part id**（规则见 messageConversion.toUIPartFromContent）。
   * 目标 part 不存在时**直接丢弃**：V2 的 `*.delta` 一定跟在 `*.started` 后面，
   * 丢一两条增量比凭空造一个 part 更安全（造出来的 part 没有正确的位置信息）。
   */
  handlePartDelta(data: PartDeltaPayload) {
    const state = this.sessions.get(data.sessionID)
    if (!state) return

    const msg = state.messages.find(m => m.info.id === data.messageID)
    if (!msg) return

    const part = msg.parts.find(p => p.id === data.partID)
    if (!part) return

    // Mutable 修改：直接拼接，不做不可变拷贝。
    // 一帧内可能收到多个 delta，只有最后的状态会被 React 看到；
    // flushDirtyMessages() 会在 notify 的 rAF 回调中统一生成新引用。
    if (data.kind === 'input') {
      // 工具输入：`streaming` 态下 `state.raw` 是未解析的原始 JSON 字符串
      if (part.type !== 'tool') return
      part.state.raw = (part.state.raw ?? '') + data.delta
    } else {
      if (part.type !== 'text' && part.type !== 'reasoning') return
      part.text += data.delta
    }

    let dirtyPartsByMessage = this.dirtyPartsBySession.get(data.sessionID)
    if (!dirtyPartsByMessage) {
      dirtyPartsByMessage = new Map<string, Set<string>>()
      this.dirtyPartsBySession.set(data.sessionID, dirtyPartsByMessage)
    }
    let dirtyPartIds = dirtyPartsByMessage.get(data.messageID)
    if (!dirtyPartIds) {
      dirtyPartIds = new Set<string>()
      dirtyPartsByMessage.set(data.messageID, dirtyPartIds)
    }
    dirtyPartIds.add(data.partID)
    this.notify([data.sessionID])
  }

  /**
   * 转录被外部改动，本地缓存不可信 → 标记为 stale，由上层**重拉一次全量消息**
   *
   * 触发源：`session.revert.staged/committed/cleared`（取消/回退三段式）、
   * `session.execution.interrupted`（用户中断）。
   *
   * 为什么不是本地删除：V2 的 revert 会**重写服务端转录**（可能截断、也可能重排），
   * 事件流本身是易失的、不回放，本地增量删除无法与服务器对齐 → 只能重拉。
   * `isStale = true` 后 `useSessionManager` 的 `canUseCached` 会失效并强制重新加载。
   */
  handleSessionInvalidated(sessionId: string) {
    const state = this.sessions.get(sessionId)
    if (!state) return
    state.isStale = true
    this.notify([sessionId])
  }

  /**
   * step 开始（`session.step.started`）：新建 assistant 消息的权威信号
   *
   * V2 的 `session.text.started` 只给 `assistantMessageID` + `ordinal`，
   * 拿不到 agent / model；UI 的助手页脚要显示模型名 → 这里把
   * `modelID` / `providerID` / `agent` / `time.created` 补上，
   * 流式期间就能显示正确模型，不必等一次 REST 重拉。
   */
  private applyStepStarted(state: SessionState, index: number, oldMessage: Message, payload: PartStepStartedPayload) {
    const info = oldMessage.info
    if (info.role !== 'assistant') return

    const nextInfo: AssistantMessageInfo = {
      ...info,
      agent: payload.agent || info.agent,
      // V2 的 `Model.Ref` 用 `id`，UI 用 `modelID`（与转换层同一套改名规则）
      modelID: payload.model.id || info.modelID,
      providerID: payload.model.providerID || info.providerID,
      time: { ...info.time, created: payload.started || info.time.created },
    }

    const nextMessage: Message = { ...oldMessage, info: nextInfo }
    state.messages = [...state.messages.slice(0, index), nextMessage, ...state.messages.slice(index + 1)]
  }

  /**
   * step 结束 / 失败：把成本、用量、结束原因写到 assistant 顶层，
   * 并在**finish 已存在时**合成尾部 step-finish part（与读侧同一套规则）。
   */
  private applyStepEnded(state: SessionState, index: number, oldMessage: Message, payload: PartStepEndedPayload) {
    const info = oldMessage.info
    if (info.role !== 'assistant') return

    const nextInfo: AssistantMessageInfo = {
      ...info,
      cost: payload.cost ?? info.cost,
      tokens: payload.tokens ? toTokenUsage(payload.tokens) : info.tokens,
      finish: payload.finish ?? info.finish,
      // step.failed 带 error → 复用阶段 2a 的错误映射（aborted / provider.error / …）
      error: payload.error ? toMessageError(payload.error) : info.error,
    }

    // ⚠️ 只在 finish 已出现时合成 step-finish（流式中不合成，否则工具组会提前挂上用量）
    const parts =
      nextInfo.finish !== undefined
        ? this.upsertPart(
            oldMessage.parts,
            toStepFinishPart(info.id, nextInfo.sessionID, nextInfo.finish, nextInfo.cost, payload.tokens),
            oldMessage,
          )
        : oldMessage.parts

    const nextMessage: Message = { ...oldMessage, info: nextInfo, parts }
    state.messages = [...state.messages.slice(0, index), nextMessage, ...state.messages.slice(index + 1)]
  }

  /**
   * 插入或替换一个 part（按 id 定位）
   *
   * 合并规则（沿用 V1 的「未定稿保留更长 live 文本」思路）：
   *   - 已有同 id → 未定稿时保留更长的文本（服务端是前缀，避免把本地更长的 delta 回退掉）
   *   - 事件侧推来的 tool part 常常**没有 name**（V2 只有 `session.tool.input.started` 带 name，
   *     后续事件都不带）→ 保留已有的 name，否则工具卡片会变成空白标题
   *   - 没有同 id → 追加到末尾（V2 的 content 顺序即事件到达顺序）
   */
  private upsertPart(parts: Part[], incoming: Part, message: Message): Part[] {
    const index = parts.findIndex(p => p.id === incoming.id)
    if (index === -1) return [...parts, incoming]

    const existing = parts[index]
    let merged = shouldPreserveLiveParts(message) ? mergePartPreferLiveText(existing, incoming) : incoming

    if (merged.type === 'tool' && existing.type === 'tool' && !merged.tool) {
      merged = { ...merged, tool: existing.tool, callID: existing.callID || merged.callID }
    }

    const next = [...parts]
    next[index] = merged
    return next
  }

  /** 用 V2 的 content 数组重建 parts（tool / text / reasoning 一律按同一规则取 id） */
  private buildContentParts(
    messageID: string,
    sessionID: string,
    content: SessionMessageAssistantContent[],
    info: MessageInfo,
  ): Part[] {
    const parts: Part[] = []
    content.forEach((block, index) => {
      const part = toUIPartFromContent(messageID, sessionID, index, block, info.time?.created ?? Date.now())
      if (part) parts.push(part)
    })
    return parts
  }

  /** 流式占位消息的 info（事件先于 REST 页到达时使用） */
  private createStreamingAssistantInfo(messageID: string, sessionID: string): AssistantMessageInfo {
    return {
      id: messageID,
      sessionID,
      role: 'assistant',
      time: { created: Date.now() },
      parentID: '',
      modelID: '',
      providerID: '',
      mode: '',
      agent: '',
      path: { cwd: '', root: '' },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      summary: false,
    }
  }

  handleSessionIdle(sessionId: string) {
    const state = this.sessions.get(sessionId)
    if (!state) return

    state.isStreaming = false
    const hasStreamingMessage = state.messages.some(m => m.isStreaming)
    if (hasStreamingMessage) {
      const completedAt = Date.now()
      state.messages = state.messages.map(m => {
        if (!m.isStreaming) return m
        return {
          ...m,
          isStreaming: false,
          info: {
            ...m.info,
            time: {
              ...m.info.time,
              completed: m.info.time.completed ?? completedAt,
            },
          },
        }
      })
    }
    this.notify([sessionId])
  }

  handleSessionError(sessionId: string) {
    const state = this.sessions.get(sessionId)
    if (!state) return

    state.isStreaming = false
    const hasStreamingMessage = state.messages.some(m => m.isStreaming)
    if (hasStreamingMessage) {
      const completedAt = Date.now()
      state.messages = state.messages.map(m => {
        if (!m.isStreaming) return m
        return {
          ...m,
          isStreaming: false,
          info: {
            ...m.info,
            time: {
              ...m.info.time,
              completed: m.info.time.completed ?? completedAt,
            },
          },
        }
      })
    }
    this.notify([sessionId])
  }

  // ============================================
  // Undo/Redo
  // ============================================

  truncateAfterRevert(sessionId: string) {
    const state = this.sessions.get(sessionId)
    if (!state || !state.revertState) return

    const revertIndex = state.messages.findIndex(m => m.info.id === state.revertState!.messageId)
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
      messages: state.messages.map(m => ({ ...m, parts: [...m.parts] })),
      revertState: {
        ...state.revertState,
        history: state.revertState.history.map(item => ({ ...item, attachments: [...item.attachments] })),
      },
    }
  }

  restoreSendRollback(sessionId: string, snapshot: SendRollbackSnapshot) {
    const state = this.sessions.get(sessionId)
    if (!state) return

    state.messages = snapshot.messages.map(m => ({ ...m, parts: [...m.parts] }))
    state.revertState = snapshot.revertState
      ? {
          ...snapshot.revertState,
          history: snapshot.revertState.history.map(item => ({ ...item, attachments: [...item.attachments] })),
        }
      : null
    state.isStreaming = false
    this.notify([sessionId])
  }

  setRevertState(sessionId: string, revertState: RevertState | null) {
    const state = this.sessions.get(sessionId)
    if (!state) return
    state.revertState = revertState
    this.notify([sessionId])
  }

  getLastUserMessageId(sessionId: string | null): string | null {
    const messages = this.getVisibleMessages(sessionId)
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].info.role === 'user') return messages[i].info.id
    }
    return null
  }

  canUndo(sessionId: string | null): boolean {
    if (!sessionId) return false
    const state = this.sessions.get(sessionId)
    if (!state || state.isStreaming) return false
    return this.getVisibleMessages(sessionId).some(m => m.info.role === 'user')
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
  private extractUserText(message: Message): string {
    return message.parts
      .filter((p): p is Part & { type: 'text' } => p.type === 'text' && !p.synthetic)
      .map(p => p.text)
      .join('\n')
  }

  private extractUserAttachments(message: Message): Attachment[] {
    const attachments: Attachment[] = []

    for (const part of message.parts) {
      if (part.type === 'file') {
        const fp = part as FilePart
        const isFolder = fp.mime === 'application/x-directory'
        const sourcePath =
          fp.source && 'path' in fp.source
            ? fp.source.path
            : fp.source && 'uri' in fp.source
              ? fp.source.uri
              : undefined
        attachments.push({
          id: fp.id || crypto.randomUUID(),
          type: isFolder ? 'folder' : 'file',
          displayName: fp.filename || sourcePath || 'file',
          url: fp.url,
          mime: fp.mime,
          relativePath: sourcePath,
          textRange: fp.source?.text
            ? {
                value: fp.source.text.value,
                start: fp.source.text.start,
                end: fp.source.text.end,
              }
            : undefined,
        })
      } else if (part.type === 'agent') {
        const ap = part as AgentPart
        attachments.push({
          id: ap.id || crypto.randomUUID(),
          type: 'agent',
          displayName: ap.name,
          agentName: ap.name,
          textRange: ap.source
            ? {
                value: ap.source.value,
                start: ap.source.start,
                end: ap.source.end,
              }
            : undefined,
        })
      }
    }

    return attachments
  }
}

export const messageStore = new MessageStore()
