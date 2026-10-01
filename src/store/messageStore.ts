// ============================================
// MessageStore - 消息状态集中管理
// ============================================
//
// 核心设计：
// 1. 每个 session 的消息独立存储在内存中
// 2. SSE 事件直接修改对应 session 的消息（找不到则丢弃）
// 3. Undo/Redo 通过 revertState 实现
// 4. RAF 批量通知 React 组件更新

import type { Message, MessageError, Part, FilePart, AgentPart } from '../types/message'
import type { ToolState as UIToolState } from '../types/message'
import type { Attachment } from '../types/ui'
import type { SessionMessage as ApiMessage, AssistantContent, Session as ApiSession } from '../api/types'
import { logger } from '../utils/logger'
import { isUserUIMessage, toUIMessage } from '../utils/messageConversion'
import { contentToParts } from '../utils/v2Projection'
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

  setMessages(
    sessionId: string,
    apiMessages: ApiMessage[],
    options?: {
      directory?: string
      title?: string
      hasMoreHistory?: boolean
      revertState?: ApiSession['revert'] | null
      },
  ) {
    const state = this.ensureSession(sessionId)
    const previousMessages = state.messages
    const previousById = new Map(previousMessages.map(message => [message.info.id, message]))

    state.messages = apiMessages.map(apiMessage => {
      const next = toUIMessage(apiMessage, sessionId)
      const previous = previousById.get(next.info.id)
      // 定稿（completed）强制采用服务端；仅流式/未完成时不回退更长 live
      if (!previous || !shouldPreserveLiveParts(previous, next)) return next
      return {
        ...next,
        parts: mergePartsPreferLiveText(previous.parts, next.parts),
        isStreaming: previous.isStreaming || next.isStreaming,
      }
    })

    // 保留「本地有、服务端列表还没返回」的流式消息。
    // v2 的 prompt 是入队语义：SSE 的 text.started 会先建出助手消息，
    // 而同期的一次 message.list 可能还没包含它；若直接以服务端列表覆盖，
    // 正在流式输出的内容会短暂消失。这里把它追加回去（按创建时间排序）。
    const apiIds = new Set(state.messages.map(message => message.info.id))
    const localOnlyStreaming = previousMessages.filter(m => m.isStreaming && !apiIds.has(m.info.id))
    if (localOnlyStreaming.length > 0) {
      state.messages = [...state.messages, ...localOnlyStreaming].sort(
        (a, b) => (a.info.time?.created ?? 0) - (b.info.time?.created ?? 0),
      )
    }

    state.loadState = 'loaded'
    state.loadError = undefined
    state.hasMoreHistory = options?.hasMoreHistory ?? false
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
              model: m.info.model ?? { providerID: '', modelID: '' },
              variant: m.info.model?.variant,
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

  prependMessages(sessionId: string, apiMessages: ApiMessage[], hasMore: boolean) {
    const state = this.sessions.get(sessionId)
    if (!state) return

    const newMessages = apiMessages.map(apiMessage => toUIMessage(apiMessage, sessionId))

    // 去重
    const existingIds = new Set(state.messages.map(m => m.info.id))
    const unique = newMessages.filter(m => !existingIds.has(m.info.id))

    if (unique.length > 0) {
      state.messages = [...unique, ...state.messages]
    }
    state.hasMoreHistory = hasMore

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
  // SSE Event Handlers
  // ============================================

  /**
   * v2：消息事件携带**完整消息**（含 content），不再有独立的 part 事件。
   *
   * 因此这里是「整条替换」，并按是否为助手消息维护 streaming 状态。
   * sessionID 由事件上下文注入（v2 消息本身不带）。
   */
  handleMessageUpdated(apiMsg: ApiMessage, sessionID: string) {
    const state = this.ensureSession(sessionID)
    const projected = toUIMessage(apiMsg, sessionID)
    const existingIndex = state.messages.findIndex(m => m.info.id === apiMsg.id)

    if (existingIndex >= 0) {
      const oldMessage = state.messages[existingIndex]
      // 未定稿时保护本地更长的 live 文本；已 completed 则强制服务端定稿
      const merged = shouldPreserveLiveParts(oldMessage, projected)
        ? {
            ...projected,
            parts: mergePartsPreferLiveText(oldMessage.parts, projected.parts),
            isStreaming: oldMessage.isStreaming || projected.isStreaming,
          }
        : projected
      state.messages = [...state.messages.slice(0, existingIndex), merged, ...state.messages.slice(existingIndex + 1)]
    } else {
      state.messages = [...state.messages, projected]
    }

    const isAssistant = apiMsg.type === 'assistant'
    if (isAssistant) {
      state.isStreaming = apiMsg.time.completed == null
    }

    this.notify([sessionID])
  }

  /**
   * v2 助手内容整体替换（`session.message.content.updated` 或完整消息回读）。
   *
   * content 数组是权威快照，直接重建 parts，不做增量合并。
   */
  handleMessageContent(messageID: string, sessionID: string, content: AssistantContent[]) {
    const state = this.sessions.get(sessionID)
    if (!state) return

    const msgIndex = state.messages.findIndex(m => m.info.id === messageID)
    if (msgIndex === -1) return

    const oldMessage = state.messages[msgIndex]
    const newMessage = { ...oldMessage, parts: contentToParts(content, sessionID, messageID) }
    state.messages = [...state.messages.slice(0, msgIndex), newMessage, ...state.messages.slice(msgIndex + 1)]
    this.notify([sessionID])
  }

  /**
   * v2 流式文本增量。
   *
   * v2 用 `data.ordinal` 标识助手消息内的第几段文本，
   * 与 UI 的 part 一一对应（投影时 id 为 `${messageID}:text:${ordinal}`）。
   */
  handleTextDelta(data: {
    sessionID: string
    assistantMessageID: string
    ordinal: number
    delta: string
  }) {
    const state = this.sessions.get(data.sessionID)
    if (!state) return

    const msgIndex = state.messages.findIndex(m => m.info.id === data.assistantMessageID)
    if (msgIndex === -1) return

    const message = state.messages[msgIndex]
    const partId = `${data.assistantMessageID}:text:${data.ordinal}`
    let partIndex = message.parts.findIndex(p => p.id === partId)

    // 首个 delta 可能先于 content 快照到达：就地补一个文本 part
    const parts =
      partIndex === -1
        ? [
            ...message.parts,
            {
              id: partId,
              sessionID: data.sessionID,
              messageID: data.assistantMessageID,
              type: 'text' as const,
              text: data.delta,
            },
          ]
        : (() => {
            const next = [...message.parts]
            const part = next[partIndex]
            // Mutable 拼接：一帧内多个 delta 只暴露最终状态，
            // flushDirtyMessages() 在 rAF 回调里统一生成新引用。
            if (part.type === 'text') part.text += data.delta
            return next
          })()

    if (partIndex === -1) partIndex = parts.length - 1

    const newMessage = { ...message, parts, isStreaming: true }
    state.messages = [...state.messages.slice(0, msgIndex), newMessage, ...state.messages.slice(msgIndex + 1)]
    state.isStreaming = true

    this.markDirty(data.sessionID, data.assistantMessageID, parts[partIndex].id)
    this.notify([data.sessionID])
  }

  /**
   * v2 推理增量。与文本增量同构，按 ordinal 定位。
   */
  handleReasoningDelta(data: {
    sessionID: string
    assistantMessageID: string
    ordinal: number
    delta: string
  }) {
    const state = this.sessions.get(data.sessionID)
    if (!state) return

    const msgIndex = state.messages.findIndex(m => m.info.id === data.assistantMessageID)
    if (msgIndex === -1) return

    const message = state.messages[msgIndex]
    const partId = `${data.assistantMessageID}:reasoning:${data.ordinal}`
    const partIndex = message.parts.findIndex(p => p.id === partId)

    const parts =
      partIndex === -1
        ? [
            ...message.parts,
            {
              id: partId,
              sessionID: data.sessionID,
              messageID: data.assistantMessageID,
              type: 'reasoning' as const,
              text: data.delta,
              time: { start: Date.now() },
            },
          ]
        : (() => {
            const next = [...message.parts]
            const part = next[partIndex]
            if (part.type === 'reasoning') part.text += data.delta
            return next
          })()

    const newMessage = { ...message, parts, isStreaming: true }
    state.messages = [...state.messages.slice(0, msgIndex), newMessage, ...state.messages.slice(msgIndex + 1)]
    state.isStreaming = true
    this.notify([data.sessionID])
  }

  /** 记录需要在新一帧刷新引用的 part */
  private markDirty(sessionID: string, messageID: string, partID: string) {
    let dirtyPartsByMessage = this.dirtyPartsBySession.get(sessionID)
    if (!dirtyPartsByMessage) {
      dirtyPartsByMessage = new Map<string, Set<string>>()
      this.dirtyPartsBySession.set(sessionID, dirtyPartsByMessage)
    }
    let dirtyPartIds = dirtyPartsByMessage.get(messageID)
    if (!dirtyPartIds) {
      dirtyPartIds = new Set<string>()
      dirtyPartsByMessage.set(messageID, dirtyPartIds)
    }
    dirtyPartIds.add(partID)
  }

  /**
   * v2 工具事件（called / progress / success / failed）。
   *
   * v2 的工具生命周期是独立事件，按 `data.id` 关联到 content 里的 tool 片段。
   * 这里就地更新对应 ToolPart 的状态，避免为了一个工具结果重拉整条消息。
   */
  handleToolEvent(
    sessionID: string,
    assistantMessageID: string,
    toolID: string,
    update: Partial<UIToolState> & { toolName?: string },
  ) {
    const state = this.sessions.get(sessionID)
    if (!state) return

    const msgIndex = state.messages.findIndex(m => m.info.id === assistantMessageID)
    if (msgIndex === -1) return

    const message = state.messages[msgIndex]
    const partId = `${assistantMessageID}:tool:${toolID}`
    const partIndex = message.parts.findIndex(p => p.id === partId)

    if (partIndex === -1) {
      // 工具事件先于 content 快照到达：补一个占位 tool part
      if (!update.toolName) return
      const parts = [
        ...message.parts,
        {
          id: partId,
          sessionID,
          messageID: assistantMessageID,
          type: 'tool' as const,
          callID: toolID,
          tool: update.toolName,
          state: { status: 'running', ...update } as UIToolState,
        },
      ]
      const newMessage = { ...message, parts }
      state.messages = [...state.messages.slice(0, msgIndex), newMessage, ...state.messages.slice(msgIndex + 1)]
      this.notify([sessionID])
      return
    }

    const parts = [...message.parts]
    const part = parts[partIndex]
    if (part.type !== 'tool') return
    parts[partIndex] = { ...part, state: { ...part.state, ...update } }

    const newMessage = { ...message, parts }
    state.messages = [...state.messages.slice(0, msgIndex), newMessage, ...state.messages.slice(msgIndex + 1)]
    this.notify([sessionID])
  }

  handlePartRemoved(data: { partID: string; messageID: string; sessionID: string }) {
    const state = this.sessions.get(data.sessionID)
    if (!state) return

    const msgIndex = state.messages.findIndex(m => m.info.id === data.messageID)
    if (msgIndex === -1) return

    const oldMessage = state.messages[msgIndex]
    if (!oldMessage.parts.some(p => p.id === data.partID)) return

    const newMessage = { ...oldMessage, parts: oldMessage.parts.filter(p => p.id !== data.partID) }
    state.messages = [...state.messages.slice(0, msgIndex), newMessage, ...state.messages.slice(msgIndex + 1)]
    this.notify([data.sessionID])
  }

  /**
   * 确保助手消息存在于 store。
   *
   * v2 的流式事件（text/reasoning/tool）**先于**完整消息到达，
   * 且事件只带 `assistantMessageID`，因此需要按需建一条占位助手消息，
   * 后续 content 快照或 delta 再往里填。
   */
  ensureAssistantMessage(sessionID: string, messageID: string): void {
    const state = this.ensureSession(sessionID)
    if (state.messages.some(m => m.info.id === messageID)) return

    const placeholder: ApiMessage = {
      id: messageID,
      type: 'assistant',
      agent: '',
      model: { id: '', providerID: '' },
      content: [],
      time: { created: Date.now() },
    }
    state.messages = [...state.messages, toUIMessage(placeholder, sessionID)]
    state.isStreaming = true
    this.notify([sessionID])
  }

  /**
   * 文本开始（v2）：确保消息与对应 ordinal 的文本 part 存在。
   */
  handleTextStarted(data: { sessionID: string; assistantMessageID: string; ordinal: number }): void {
    this.ensureAssistantMessage(data.sessionID, data.assistantMessageID)
    const state = this.sessions.get(data.sessionID)
    if (!state) return

    const msgIndex = state.messages.findIndex(m => m.info.id === data.assistantMessageID)
    if (msgIndex === -1) return

    const message = state.messages[msgIndex]
    const partId = `${data.assistantMessageID}:text:${data.ordinal}`
    if (message.parts.some(p => p.id === partId)) return

    const parts: Part[] = [
      ...message.parts,
      { id: partId, sessionID: data.sessionID, messageID: data.assistantMessageID, type: 'text', text: '' },
    ]
    const newMessage = { ...message, parts, isStreaming: true }
    state.messages = [...state.messages.slice(0, msgIndex), newMessage, ...state.messages.slice(msgIndex + 1)]
    this.notify([data.sessionID])
  }

  /**
   * 文本结束（v2）：用权威文本覆盖该 ordinal 的 part（delta 是易失的，以此对齐）。
   */
  handleTextEnded(data: {
    sessionID: string
    assistantMessageID: string
    ordinal: number
    text: string
  }): void {
    this.ensureAssistantMessage(data.sessionID, data.assistantMessageID)
    this.replaceTextPart(data.sessionID, data.assistantMessageID, data.ordinal, 'text', data.text)
  }

  /**
   * 推理开始（v2）
   */
  handleReasoningStarted(data: { sessionID: string; assistantMessageID: string; ordinal: number }): void {
    this.ensureAssistantMessage(data.sessionID, data.assistantMessageID)
    const state = this.sessions.get(data.sessionID)
    if (!state) return

    const msgIndex = state.messages.findIndex(m => m.info.id === data.assistantMessageID)
    if (msgIndex === -1) return

    const message = state.messages[msgIndex]
    const partId = `${data.assistantMessageID}:reasoning:${data.ordinal}`
    if (message.parts.some(p => p.id === partId)) return

    const parts: Part[] = [
      ...message.parts,
      {
        id: partId,
        sessionID: data.sessionID,
        messageID: data.assistantMessageID,
        type: 'reasoning',
        text: '',
        time: { start: Date.now() },
      },
    ]
    const newMessage = { ...message, parts, isStreaming: true }
    state.messages = [...state.messages.slice(0, msgIndex), newMessage, ...state.messages.slice(msgIndex + 1)]
    this.notify([data.sessionID])
  }

  /**
   * 推理结束（v2）
   */
  handleReasoningEnded(data: {
    sessionID: string
    assistantMessageID: string
    ordinal: number
    text: string
  }): void {
    this.ensureAssistantMessage(data.sessionID, data.assistantMessageID)
    this.replaceTextPart(data.sessionID, data.assistantMessageID, data.ordinal, 'reasoning', data.text)
  }

  /** 用权威文本覆盖某个 ordinal 的 text/reasoning part */
  private replaceTextPart(
    sessionID: string,
    messageID: string,
    ordinal: number,
    kind: 'text' | 'reasoning',
    text: string,
  ): void {
    const state = this.sessions.get(sessionID)
    if (!state) return

    const msgIndex = state.messages.findIndex(m => m.info.id === messageID)
    if (msgIndex === -1) return

    const message = state.messages[msgIndex]
    const partId = `${messageID}:${kind}:${ordinal}`
    const partIndex = message.parts.findIndex(p => p.id === partId)

    const parts =
      partIndex === -1
        ? [
            ...message.parts,
            kind === 'text'
              ? { id: partId, sessionID, messageID, type: 'text' as const, text }
              : {
                  id: partId,
                  sessionID,
                  messageID,
                  type: 'reasoning' as const,
                  text,
                  time: { start: Date.now() },
                },
          ]
        : message.parts.map((part, index) =>
            index === partIndex ? ({ ...part, text } as Part) : part,
          )

    const newMessage = { ...message, parts }
    state.messages = [...state.messages.slice(0, msgIndex), newMessage, ...state.messages.slice(msgIndex + 1)]
    this.notify([sessionID])
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
  extractUserText(message: Message): string {
    return message.parts
      .filter((p): p is Part & { type: 'text' } => p.type === 'text' && !p.synthetic)
      .map(p => p.text)
      .join('\n')
  }

  extractUserAttachments(message: Message): Attachment[] {
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
