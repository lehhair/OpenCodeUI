// ============================================
// MessageStore - 消息状态集中管理
// ============================================
// 
// 核心设计：
// 1. 每个 session 的消息独立存储，session 切换只改变 currentSessionId
// 2. Undo/Redo 通过 revertState 实现，不重新加载消息
// 3. SSE 更新直接修改对应 session 的消息
// 4. 使用发布-订阅模式通知 React 组件更新

import type { Message, Part, MessageInfo, FilePart, AgentPart } from '../types/message'
import type { 
  ApiMessageWithParts, 
  ApiMessage, 
  ApiPart,
  ApiSession,
  Attachment,
} from '../api/types'
import { MAX_HISTORY_MESSAGES, MESSAGE_PART_PERSIST_THRESHOLD, MESSAGE_PREFETCH_BUFFER } from '../constants'
import { messageCacheStore } from './messageCacheStore'

// ============================================
// Types
// ============================================

export interface RevertState {
  /** 撤销点的消息 ID */
  messageId: string
  /** 撤销历史栈 - 用于多步 redo */
  history: RevertHistoryItem[]
}

export interface RevertHistoryItem {
  messageId: string
  text: string
  attachments: unknown[]
  model?: { providerID: string; modelID: string }
  variant?: string
  agent?: string
}

export interface SessionState {
  /** 所有消息（包括被撤销的） */
  messages: Message[]
  /** 撤销状态 */
  revertState: RevertState | null
  /** 是否正在 streaming */
  isStreaming: boolean
  /** 加载状态 */
  loadState: 'idle' | 'loading' | 'loaded' | 'error'
  /** 向前加载的消息数（用于虚拟滚动定位） */
  prependedCount: number
  /** 是否还有更多历史消息 */
  hasMoreHistory: boolean
  /** session 目录 */
  directory: string
  /** 分享链接 */
  shareUrl?: string
}

type Subscriber = () => void

// ============================================
// Store Implementation
// ============================================

/** 最多缓存的 session 数量，超过时淘汰最久未访问的 */
const MAX_CACHED_SESSIONS = 10

class MessageStore {
  private sessions = new Map<string, SessionState>()
  private currentSessionId: string | null = null
  private subscribers = new Set<Subscriber>()
  /** LRU 追踪：sessionId -> 最后访问时间 */
  private sessionAccessTime = new Map<string, number>()
  
  // ============================================
  // 批量更新优化
  // ============================================
  
  /** 是否有待处理的通知 */
  private pendingNotify = false
  /** 用于 RAF 的 ID */
  private rafId: number | null = null
  /** visibleMessages 缓存 */
  private visibleMessagesCache: Message[] | null = null
  private visibleMessagesCacheSessionId: string | null = null
  private visibleMessagesCacheRevertId: string | null = null
  private visibleMessagesCacheLength: number = 0

  // ============================================
  // Parts Hydration Cache
  // ============================================

  private hydratedMessageIds = new Set<string>()
  private persistedMessageKeys = new Set<string>()
  private hydratedMessageKeys = new Set<string>()

  private makeMessageKey(sessionId: string, messageId: string): string {
    return `${sessionId}:${messageId}`
  }

  // ============================================
  // Message Trimming (Memory Guard)
  // ============================================

  private trimMessagesIfNeeded(sessionId: string, state: SessionState) {
    const excess = state.messages.length - MAX_HISTORY_MESSAGES
    if (excess <= 0) return

    if (import.meta.env.DEV) {
      console.warn('[MessageStore] Trimming messages for session:', sessionId, 'excess:', excess)
    }

    state.messages = state.messages.slice(excess)
    state.prependedCount = Math.max(0, state.prependedCount - excess)
    state.hasMoreHistory = false

    // 如果触发裁剪，清理对应的持久化索引和 hydration 缓存（避免内存泄漏）
    const prefix = `${sessionId}:`
    const keepIds = new Set(state.messages.map(m => m.info.id))
    
    // 清理 persistedMessageKeys
    for (const key of this.persistedMessageKeys) {
      if (key.startsWith(prefix)) {
        const id = key.slice(prefix.length)
        if (!keepIds.has(id)) {
          this.persistedMessageKeys.delete(key)
        }
      }
    }
    
    // 清理 hydratedMessageKeys
    for (const key of this.hydratedMessageKeys) {
      if (key.startsWith(prefix)) {
        const id = key.slice(prefix.length)
        if (!keepIds.has(id)) {
          this.hydratedMessageKeys.delete(key)
        }
      }
    }
    
    // 清理 hydratedMessageIds (这个是纯 messageId，需要检查是否在任何 session 中存在)
    // 为了安全，只在当前 session 上下文中清理
    for (const id of this.hydratedMessageIds) {
      if (!keepIds.has(id)) {
        // 检查是否在其他 session 中存在
        let existsInOtherSession = false
        for (const [sid, otherState] of this.sessions) {
          if (sid !== sessionId && otherState.messages.some(m => m.info.id === id)) {
            existsInOtherSession = true
            break
          }
        }
        if (!existsInOtherSession) {
          this.hydratedMessageIds.delete(id)
        }
      }
    }

    if (state.revertState) {
      const remainingIds = new Set(state.messages.map(m => m.info.id))
      if (!remainingIds.has(state.revertState.messageId)) {
        state.revertState = null
      } else if (state.revertState.history.length > 0) {
        state.revertState.history = state.revertState.history.filter(item => remainingIds.has(item.messageId))
        if (state.revertState.history.length === 0) {
          state.revertState = null
        }
      }
    }
  }

  // ============================================
  // Parts Hydration & Persistence
  // ============================================

  getHydratedMessageIds(): Set<string> {
    return this.hydratedMessageIds
  }

  private markMessageHydrated(sessionId: string, messageId: string) {
    this.hydratedMessageIds.add(messageId)
    this.hydratedMessageKeys.add(this.makeMessageKey(sessionId, messageId))
  }

  private markMessagePersisted(sessionId: string, messageId: string) {
    this.persistedMessageKeys.add(this.makeMessageKey(sessionId, messageId))
  }

  private isMessagePersisted(sessionId: string, messageId: string): boolean {
    return this.persistedMessageKeys.has(this.makeMessageKey(sessionId, messageId))
  }

  private purgePersistedKeysForSession(sessionId: string) {
    const prefix = `${sessionId}:`
    for (const key of this.persistedMessageKeys) {
      if (key.startsWith(prefix)) {
        this.persistedMessageKeys.delete(key)
      }
    }
    for (const key of this.hydratedMessageKeys) {
      if (key.startsWith(prefix)) {
        this.hydratedMessageKeys.delete(key)
      }
    }
  }

  private computeMessageSize(message: Message): number {
    let total = 0
    for (const part of message.parts) {
      if (part.type === 'text' || part.type === 'reasoning') {
        total += part.text.length
      } else if (part.type === 'tool') {
        const state = part.state
        if (state.input) total += JSON.stringify(state.input).length
        if (state.output) total += state.output.length
        if (state.error) total += String(state.error).length
        if (state.metadata) total += JSON.stringify(state.metadata).length
      } else if (part.type === 'file') {
        if (part.source?.text?.value) total += part.source.text.value.length
      } else if (part.type === 'agent') {
        if (part.source?.value) total += part.source.value.length
      } else if (part.type === 'subtask') {
        total += part.prompt.length + part.description.length
      } else if (part.type === 'snapshot') {
        total += part.snapshot.length
      } else if (part.type === 'patch') {
        total += part.files.join('').length
      }
    }
    return total
  }

  private getTailKeepIds(state: SessionState): string[] {
    const totalMessages = state.messages.length
    if (totalMessages === 0) return []
    const tailSize = Math.max(60, MESSAGE_PREFETCH_BUFFER * 2)
    const keepFrom = Math.max(0, totalMessages - tailSize)
    return state.messages.slice(keepFrom).map(m => m.info.id)
  }

  private scheduleEvictAfterPersist(sessionId: string, state: SessionState) {
    void this.persistSessionParts(sessionId, state, true).then(() => {
      const latestState = this.sessions.get(sessionId)
      if (!latestState) return
      const keepIds = this.getTailKeepIds(latestState)
      if (keepIds.length > 0) {
        this.evictMessageParts(sessionId, keepIds)
      }
    })
  }

  private async persistMessagePartsIfNeeded(sessionId: string, message: Message, force: boolean = false) {
    if (!message.parts.length) return
    if (message.isStreaming) return
    const size = this.computeMessageSize(message)
    if (!force && size < MESSAGE_PART_PERSIST_THRESHOLD) return
    await messageCacheStore.setMessageParts(sessionId, message.info.id, message.parts)
    this.markMessagePersisted(sessionId, message.info.id)
  }

  private async persistSessionParts(sessionId: string, state: SessionState, force: boolean = false) {
    for (const message of state.messages) {
      await this.persistMessagePartsIfNeeded(sessionId, message, force)
    }
  }

  async hydrateMessageParts(sessionId: string, messageId: string): Promise<boolean> {
    if (this.hydratedMessageKeys.has(this.makeMessageKey(sessionId, messageId))) return true
    const state = this.sessions.get(sessionId)
    if (!state) return false

    const msgIndex = state.messages.findIndex(m => m.info.id === messageId)
    if (msgIndex === -1) return false

    const message = state.messages[msgIndex]
    if (message.parts.length > 0) {
      this.markMessageHydrated(sessionId, messageId)
      return true
    }

    if (!this.isMessagePersisted(sessionId, messageId)) return false
    const cached = await messageCacheStore.getMessageParts(sessionId, messageId)
    if (!cached) return false

    const newMessage: Message = { ...message, parts: cached.parts as Part[] }
    state.messages = [
      ...state.messages.slice(0, msgIndex),
      newMessage,
      ...state.messages.slice(msgIndex + 1),
    ]

    this.markMessageHydrated(sessionId, messageId)
    this.notify()
    return true
  }

  async prefetchMessageParts(sessionId: string, messageIds: string[]) {
    if (!messageIds.length) return
    const trimmed = messageIds.slice(0, MESSAGE_PREFETCH_BUFFER)
    for (const id of trimmed) {
      if (this.hydratedMessageKeys.has(this.makeMessageKey(sessionId, id))) continue
      const state = this.sessions.get(sessionId)
      if (!state) break
      const msg = state.messages.find(m => m.info.id === id)
      if (!msg) continue
      if (msg.parts.length > 0) {
        this.markMessageHydrated(sessionId, id)
        continue
      }
      if (!this.isMessagePersisted(sessionId, id)) continue
      const cached = await messageCacheStore.getMessageParts(sessionId, id)
      if (!cached) continue
      const msgIndex = state.messages.findIndex(m => m.info.id === id)
      if (msgIndex === -1) continue
      const newMessage: Message = { ...state.messages[msgIndex], parts: cached.parts as Part[] }
      state.messages = [
        ...state.messages.slice(0, msgIndex),
        newMessage,
        ...state.messages.slice(msgIndex + 1),
      ]
      this.markMessageHydrated(sessionId, id)
    }
    this.notify()
  }

  // 释放非关键消息的 parts（保持可用但不常驻内存）
  evictMessageParts(sessionId: string, keepMessageIds: string[]) {
    const state = this.sessions.get(sessionId)
    if (!state) return
    const keep = new Set(keepMessageIds)
    let updated = false

    state.messages = state.messages.map(msg => {
      if (keep.has(msg.info.id)) return msg
      if (msg.parts.length === 0) return msg
      if (msg.isStreaming) return msg
      if (msg.info.role === 'user') return msg
      if (!this.isMessagePersisted(sessionId, msg.info.id)) return msg

      updated = true
      this.hydratedMessageKeys.delete(this.makeMessageKey(sessionId, msg.info.id))
      return { ...msg, parts: [] }
    })

    if (updated) {
      this.notify()
    }
  }

  // ============================================
  // Subscription
  // ============================================

  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn)
    return () => this.subscribers.delete(fn)
  }

  /**
   * 使用 requestAnimationFrame 合并多次 notify 调用
   * 在 streaming 时可以避免每个 part 更新都触发重渲染
   */
  private notify() {
    // 清除 visibleMessages 缓存
    this.visibleMessagesCache = null
    
    if (this.pendingNotify) return
    
    this.pendingNotify = true
    
    // 使用 RAF 批量处理
    if (typeof requestAnimationFrame !== 'undefined') {
      this.rafId = requestAnimationFrame(() => {
        this.pendingNotify = false
        this.rafId = null
        this.subscribers.forEach(fn => fn())
      })
    } else {
      // SSR 或不支持 RAF 的环境，直接同步通知
      this.pendingNotify = false
      this.subscribers.forEach(fn => fn())
    }
  }
  
  /**
   * 立即通知（用于关键操作，如 session 切换）
   */
  private notifyImmediate() {
    // 清除缓存
    this.visibleMessagesCache = null
    
    // 取消待处理的 RAF
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    this.pendingNotify = false
    
    this.subscribers.forEach(fn => fn())
  }

  // ============================================
  // Getters
  // ============================================

  getCurrentSessionId(): string | null {
    return this.currentSessionId
  }

  getSessionState(sessionId: string): SessionState | undefined {
    return this.sessions.get(sessionId)
  }

  getCurrentSessionState(): SessionState | undefined {
    if (!this.currentSessionId) return undefined
    return this.sessions.get(this.currentSessionId)
  }

  /**
   * 获取当前 session 的可见消息（基于 revert 状态过滤）
   * 带缓存优化，避免频繁创建新数组
   */
  getVisibleMessages(): Message[] {
    const state = this.getCurrentSessionState()
    if (!state) {
      return []
    }

    const { messages, revertState } = state
    const sessionId = this.currentSessionId
    const revertId = revertState?.messageId ?? null

    // 检查缓存是否有效
    if (
      this.visibleMessagesCache !== null &&
      this.visibleMessagesCacheSessionId === sessionId &&
      this.visibleMessagesCacheRevertId === revertId &&
      this.visibleMessagesCacheLength === messages.length
    ) {
      // 缓存命中，直接返回
      return this.visibleMessagesCache
    }

    // 计算可见消息
    let visibleMessages: Message[]
    
    if (!revertState) {
      visibleMessages = messages
    } else {
      // 找到 revert 点，只返回之前的消息
      const revertIndex = messages.findIndex(m => m.info.id === revertState.messageId)
      if (revertIndex === -1) {
        // 找不到 revert 点，返回所有消息
        visibleMessages = messages
      } else {
        visibleMessages = messages.slice(0, revertIndex)
      }
    }

    // 更新缓存
    this.visibleMessagesCache = visibleMessages
    this.visibleMessagesCacheSessionId = sessionId
    this.visibleMessagesCacheRevertId = revertId
    this.visibleMessagesCacheLength = messages.length

    return visibleMessages
  }

  getIsStreaming(): boolean {
    return this.getCurrentSessionState()?.isStreaming ?? false
  }

  getRevertState(): RevertState | null {
    return this.getCurrentSessionState()?.revertState ?? null
  }

  getPrependedCount(): number {
    return this.getCurrentSessionState()?.prependedCount ?? 0
  }

  getHasMoreHistory(): boolean {
    return this.getCurrentSessionState()?.hasMoreHistory ?? false
  }

  getSessionDirectory(): string {
    return this.getCurrentSessionState()?.directory ?? ''
  }

  getShareUrl(): string | undefined {
    return this.getCurrentSessionState()?.shareUrl
  }

  getLoadState(): SessionState['loadState'] {
    return this.getCurrentSessionState()?.loadState ?? 'idle'
  }

  // ============================================
  // Session Management
  // ============================================

  /**
   * 切换当前 session（不触发数据加载）
   */
  setCurrentSession(sessionId: string | null) {
    if (this.currentSessionId === sessionId) return
    
    this.currentSessionId = sessionId
    this.hydratedMessageIds.clear()
    this.hydratedMessageKeys.clear()
    // 使用立即通知，确保 session 切换立即生效
    this.notifyImmediate()
  }

  /**
   * 初始化 session 状态（如果不存在）
   * 包含 LRU 淘汰机制，防止内存无限增长
   */
  private ensureSession(sessionId: string): SessionState {
    // 更新访问时间
    this.sessionAccessTime.set(sessionId, Date.now())
    
    let state = this.sessions.get(sessionId)
    if (!state) {
      // 检查是否需要淘汰旧 session
      this.evictOldSessions()
      
      state = {
        messages: [],
        revertState: null,
        isStreaming: false,
        loadState: 'idle',
        prependedCount: 0,
        hasMoreHistory: false,
        directory: '',
        shareUrl: undefined,
      }
      this.sessions.set(sessionId, state)
    }
    return state
  }

  /**
   * LRU 淘汰：当 session 数量超过限制时，清除最久未访问的
   */
  private evictOldSessions() {
    if (this.sessions.size < MAX_CACHED_SESSIONS) return
    
    // 找出最久未访问的 session（排除当前 session）
    let oldestId: string | null = null
    let oldestTime = Infinity
    
    for (const [id, time] of this.sessionAccessTime) {
      // 不淘汰当前 session 和正在 streaming 的 session
      if (id === this.currentSessionId) continue
      const state = this.sessions.get(id)
      if (state?.isStreaming) continue
      
      if (time < oldestTime) {
        oldestTime = time
        oldestId = id
      }
    }
    
    if (oldestId) {
      console.log('[MessageStore] Evicting old session:', oldestId)
      this.sessions.delete(oldestId)
      this.sessionAccessTime.delete(oldestId)
      this.purgePersistedKeysForSession(oldestId)
      void messageCacheStore.clearSession(oldestId)
    }
  }

  /**
   * 设置 session 加载状态
   */
  setLoadState(sessionId: string, loadState: SessionState['loadState']) {
    const state = this.ensureSession(sessionId)
    state.loadState = loadState
    this.notify()
  }

  /**
   * 设置 session 消息（初始加载时使用）
   */
  setMessages(
    sessionId: string, 
    apiMessages: ApiMessageWithParts[], 
    options?: {
      directory?: string
      hasMoreHistory?: boolean
      revertState?: ApiSession['revert'] | null
      shareUrl?: string
    }
  ) {
    const state = this.ensureSession(sessionId)
    
    // 转换 API 消息为 UI 消息
    state.messages = apiMessages.map(this.convertApiMessage)
    state.loadState = 'loaded'
    state.prependedCount = 0
    state.hasMoreHistory = options?.hasMoreHistory ?? false
    state.directory = options?.directory ?? ''
    state.shareUrl = options?.shareUrl

    // 处理 revert 状态
    if (options?.revertState?.messageID) {
      const revertIndex = state.messages.findIndex(
        m => m.info.id === options.revertState!.messageID
      )
      if (revertIndex !== -1) {
        // 从 revert 点开始收集用户消息，构建 redo 历史
        const revertedUserMessages = state.messages
          .slice(revertIndex)
          .filter(m => m.info.role === 'user')

          state.revertState = {
            messageId: options.revertState.messageID,
            history: revertedUserMessages.map(m => {
              const userInfo = m.info as any
              return {
                messageId: m.info.id,
                text: this.extractUserText(m),
                attachments: this.extractUserAttachments(m),
                model: userInfo.model,
                variant: userInfo.variant,
                agent: userInfo.agent,
              }
            }),
          }
      }
    } else {
      state.revertState = null
    }

    // 检查最后一条消息是否在 streaming
    const lastMsg = state.messages[state.messages.length - 1]
    if (lastMsg?.info.role === 'assistant') {
      const assistantInfo = lastMsg.info as { time?: { completed?: number } }
      const isLastMsgStreaming = !assistantInfo.time?.completed
      state.isStreaming = isLastMsgStreaming
      
      // 关键：如果正在 streaming，需要把最后一条消息的 isStreaming 也设为 true
      // 这样 TextPartView 才能正确启用打字机效果
      if (isLastMsgStreaming && state.messages.length > 0) {
        const lastIndex = state.messages.length - 1
        state.messages[lastIndex] = {
          ...state.messages[lastIndex],
          isStreaming: true,
        }
      }
    } else {
      state.isStreaming = false
    }

    this.scheduleEvictAfterPersist(sessionId, state)

    for (const message of state.messages) {
      if (message.parts.length > 0) {
        this.markMessageHydrated(sessionId, message.info.id)
      }
    }

    this.trimMessagesIfNeeded(sessionId, state)

    this.notify()
  }

  /**
   * 向前添加历史消息（懒加载更多历史）
   */
  prependMessages(sessionId: string, apiMessages: ApiMessageWithParts[], hasMore: boolean) {
    const state = this.sessions.get(sessionId)
    if (!state) return

    const newMessages = apiMessages.map(this.convertApiMessage)
    state.messages = [...newMessages, ...state.messages]
    state.prependedCount += newMessages.length
    state.hasMoreHistory = hasMore

    this.trimMessagesIfNeeded(sessionId, state)

    const persistBatch = newMessages.map(message => this.persistMessagePartsIfNeeded(sessionId, message, true))
    void Promise.all(persistBatch).then(() => {
      const latestState = this.sessions.get(sessionId)
      if (!latestState) return
      const keepIds = this.getTailKeepIds(latestState)
      if (keepIds.length > 0) {
        this.evictMessageParts(sessionId, keepIds)
      }
    })

    this.notify()
  }

  /**
   * 清空所有 session 数据（服务器切换时调用）
   */
  clearAll() {
    this.currentSessionId = null
    this.sessions.clear()
    this.sessionAccessTime.clear()
    this.hydratedMessageIds.clear()
    this.persistedMessageKeys.clear()
    this.hydratedMessageKeys.clear()
    this.visibleMessagesCache = null
    this.visibleMessagesCacheSessionId = null
    this.visibleMessagesCacheRevertId = null
    this.visibleMessagesCacheLength = 0
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    this.pendingNotify = false
    this.notifyImmediate()
  }

  /**
   * 清空 session（用于新建对话）
   */
  clearSession(sessionId: string) {
    this.sessions.delete(sessionId)
    this.sessionAccessTime.delete(sessionId)
    this.hydratedMessageIds.clear()
    this.purgePersistedKeysForSession(sessionId)
    void messageCacheStore.clearSession(sessionId)
    this.notify()
  }

  setShareUrl(sessionId: string, url: string | undefined) {
    const state = this.sessions.get(sessionId)
    if (!state) return

    state.shareUrl = url
    this.notify()
  }

  // ============================================
  // SSE Event Handlers
  // ============================================

  /**
   * 处理消息创建/更新事件
   */
  handleMessageUpdated(apiMsg: ApiMessage) {
    // 确保 session 存在
    const state = this.ensureSession(apiMsg.sessionID)

    const existingIndex = state.messages.findIndex(m => m.info.id === apiMsg.id)
    
    if (existingIndex >= 0) {
      // 更新现有消息的 info (Immutable update)
      const oldMessage = state.messages[existingIndex]
      const newMessage = { ...oldMessage, info: apiMsg as MessageInfo }
      
      state.messages = [
        ...state.messages.slice(0, existingIndex),
        newMessage,
        ...state.messages.slice(existingIndex + 1)
      ]
    } else {
      // 创建新消息
      const newMsg: Message = {
        info: apiMsg as MessageInfo,
        parts: [],
        isStreaming: apiMsg.role === 'assistant',
      }
      // Immutable push
      state.messages = [...state.messages, newMsg]
      
      // 新的 assistant 消息表示开始 streaming
      if (apiMsg.role === 'assistant') {
        state.isStreaming = true
      }

      this.trimMessagesIfNeeded(apiMsg.sessionID, state)
    }

    // 尝试持久化 parts（适用于大消息）
    const targetIndex = existingIndex >= 0 ? existingIndex : state.messages.length - 1
    const targetMessage = state.messages[targetIndex]
    if (targetMessage) {
      void this.persistMessagePartsIfNeeded(apiMsg.sessionID, targetMessage)
    }

    if (targetMessage && targetMessage.parts.length > 0) {
      this.markMessageHydrated(apiMsg.sessionID, targetMessage.info.id)
    }

    this.notify()
  }

  /**
   * 处理 Part 更新事件
   * 支持流式追加和状态合并
   */
  handlePartUpdated(apiPart: ApiPart & { sessionID: string; messageID: string }) {
    // 确保 session 存在
    const state = this.ensureSession(apiPart.sessionID)

    const msgIndex = state.messages.findIndex(m => m.info.id === apiPart.messageID)
    if (msgIndex === -1) {
      console.warn('[MessageStore] Part received for unknown message:', apiPart.messageID)
      return
    }

    // Immutable update: Copy message and parts array
    const oldMessage = state.messages[msgIndex]
    const newMessage = { ...oldMessage, parts: [...oldMessage.parts] }
    
    const existingPartIndex = newMessage.parts.findIndex(p => p.id === apiPart.id)
    
    if (existingPartIndex >= 0) {
      // === 更新现有 part ===
      // 这里直接替换即可，因为 apiPart 已经是新的对象引用
      newMessage.parts[existingPartIndex] = apiPart as Part
    } else {
      // === 添加新 part ===
      newMessage.parts.push(apiPart as Part)
    }
    
    // Immutable update of messages array
    state.messages = [
      ...state.messages.slice(0, msgIndex),
      newMessage,
      ...state.messages.slice(msgIndex + 1)
    ]

    // 大块内容时持久化
    void this.persistMessagePartsIfNeeded(apiPart.sessionID, newMessage)
    this.markMessageHydrated(apiPart.sessionID, newMessage.info.id)
    
    this.notify()
  }

  /**
   * 处理 Part 移除事件
   */
  handlePartRemoved(data: { id: string; messageID: string; sessionID: string }) {
    const state = this.sessions.get(data.sessionID)
    if (!state) return

    const msgIndex = state.messages.findIndex(m => m.info.id === data.messageID)
    if (msgIndex === -1) return

    const oldMessage = state.messages[msgIndex]
    const newMessage = {
      ...oldMessage,
      parts: oldMessage.parts.filter(p => p.id !== data.id)
    }

    state.messages = [
      ...state.messages.slice(0, msgIndex),
      newMessage,
      ...state.messages.slice(msgIndex + 1)
    ]

    this.notify()
  }

  /**
   * 处理 Session 空闲事件
   */
  handleSessionIdle(sessionId: string) {
    const state = this.sessions.get(sessionId)
    if (!state) return

    state.isStreaming = false
    
    // Immutable update for messages
    // 只有当有消息状态改变时才更新引用
    const hasStreamingMessage = state.messages.some(m => m.isStreaming)
    if (hasStreamingMessage) {
      state.messages = state.messages.map(m => 
        m.isStreaming ? { ...m, isStreaming: false } : m
      )
    }

    this.trimMessagesIfNeeded(sessionId, state)

    this.scheduleEvictAfterPersist(sessionId, state)

    this.notify()
  }

  /**
   * 处理 Session 错误事件
   */
  handleSessionError(sessionId: string) {
    const state = this.sessions.get(sessionId)
    if (!state) return

    state.isStreaming = false
    
    // Immutable update for messages
    const hasStreamingMessage = state.messages.some(m => m.isStreaming)
    if (hasStreamingMessage) {
      state.messages = state.messages.map(m => 
        m.isStreaming ? { ...m, isStreaming: false } : m
      )
    }

    this.trimMessagesIfNeeded(sessionId, state)

    this.scheduleEvictAfterPersist(sessionId, state)

    this.notify()
  }

  // ============================================
  // Undo/Redo (本地操作，不调用 API)
  // ============================================

  /**
   * 截断 Revert 点之后的消息（用于发送新消息时）
   * 并清除 Revert 状态
   */
  truncateAfterRevert(sessionId: string) {
    const state = this.sessions.get(sessionId)
    if (!state || !state.revertState) return

    const revertIndex = state.messages.findIndex(m => m.info.id === state.revertState!.messageId)
    
    if (revertIndex !== -1) {
      // 保留 revertIndex 之前的消息（即 0 到 revertIndex-1）
      // 这里的语义是：revertMessageId 是要被撤销的第一条消息，还是保留的最后一条？
      // 根据 handleUndo 中的逻辑：revertIndex 是找到的 userMessageId。
      // Undo 通常意味着撤销这条消息及其之后的所有消息。
      // 所以我们应该保留 0 到 revertIndex。
      
      // 等等，handleUndo 逻辑是：
      // const revertIndex = state.messages.findIndex(m => m.info.id === userMessageId)
      // revertedUserMessages = state.messages.slice(revertIndex)
      // 看来 revertIndex 是要被撤销的消息。
      
      // 所以截断点应该是 revertIndex。
      state.messages = state.messages.slice(0, revertIndex)
    }

    state.revertState = null
    this.notify()
  }

  /**
   * 设置 revert 状态（由外部 API 调用后触发）
   */
  setRevertState(sessionId: string, revertState: RevertState | null) {
    const state = this.sessions.get(sessionId)
    if (!state) return

    state.revertState = revertState
    this.notify()
  }

  /**
   * 获取当前可以 undo 的最后一条用户消息 ID
   */
  getLastUserMessageId(): string | null {
    const messages = this.getVisibleMessages()
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].info.role === 'user') {
        return messages[i].info.id
      }
    }
    return null
  }

  /**
   * 检查是否可以 undo
   */
  canUndo(): boolean {
    const state = this.getCurrentSessionState()
    if (!state || state.isStreaming) return false
    return state.messages.some(m => m.info.role === 'user')
  }

  /**
   * 检查是否可以 redo
   */
  canRedo(): boolean {
    const state = this.getCurrentSessionState()
    if (!state || state.isStreaming) return false
    return (state.revertState?.history.length ?? 0) > 0
  }

  /**
   * 获取 redo 步数
   */
  getRedoSteps(): number {
    return this.getCurrentSessionState()?.revertState?.history.length ?? 0
  }

  /**
   * 获取当前 reverted 的消息内容（用于输入框回填）
   */
  getCurrentRevertedContent(): RevertHistoryItem | null {
    const revertState = this.getRevertState()
    if (!revertState || revertState.history.length === 0) return null
    return revertState.history[0]
  }

  // ============================================
  // Streaming Control
  // ============================================

  setStreaming(sessionId: string, isStreaming: boolean) {
    const state = this.sessions.get(sessionId)
    if (!state) return

    state.isStreaming = isStreaming
    if (!isStreaming) {
      this.trimMessagesIfNeeded(sessionId, state)
      this.scheduleEvictAfterPersist(sessionId, state)
    }
    this.notify()
  }

  // ============================================
  // Private Helpers
  // ============================================

  private convertApiMessage = (apiMsg: ApiMessageWithParts): Message => {
    return {
      info: apiMsg.info as MessageInfo,
      parts: apiMsg.parts as Part[],
      isStreaming: false,
    }
  }

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
        // 获取路径：FileSource 和 SymbolSource 有 path，ResourceSource 有 uri
        const sourcePath = fp.source && 'path' in fp.source ? fp.source.path : 
                          fp.source && 'uri' in fp.source ? fp.source.uri : undefined
        attachments.push({
          id: fp.id || crypto.randomUUID(),
          type: isFolder ? 'folder' : 'file',
          displayName: fp.filename || sourcePath || 'file',
          url: fp.url,
          mime: fp.mime,
          relativePath: sourcePath,
          textRange: fp.source?.text ? {
            value: fp.source.text.value,
            start: fp.source.text.start,
            end: fp.source.text.end,
          } : undefined,
        })
      } else if (part.type === 'agent') {
        const ap = part as AgentPart
        attachments.push({
          id: ap.id || crypto.randomUUID(),
          type: 'agent',
          displayName: ap.name,
          agentName: ap.name,
          textRange: ap.source ? {
            value: ap.source.value,
            start: ap.source.start,
            end: ap.source.end,
          } : undefined,
        })
      }
    }
    
    return attachments
  }
}

// ============================================
// Singleton Export
// ============================================

export const messageStore = new MessageStore()

// ============================================
// Snapshot Cache (避免 useSyncExternalStore 无限循环)
// ============================================

export interface MessageStoreSnapshot {
  sessionId: string | null
  messages: Message[]
  isStreaming: boolean
  revertState: RevertState | null
  prependedCount: number
  hasMoreHistory: boolean
  sessionDirectory: string
  shareUrl: string | undefined
  canUndo: boolean
  canRedo: boolean
  redoSteps: number
  revertedContent: RevertHistoryItem | null
  loadState: SessionState['loadState']
}

let cachedSnapshot: MessageStoreSnapshot | null = null
let snapshotVersion = 0

function createSnapshot(): MessageStoreSnapshot {
  return {
    sessionId: messageStore.getCurrentSessionId(),
    messages: messageStore.getVisibleMessages(),
    isStreaming: messageStore.getIsStreaming(),
    revertState: messageStore.getRevertState(),
    prependedCount: messageStore.getPrependedCount(),
    hasMoreHistory: messageStore.getHasMoreHistory(),
    sessionDirectory: messageStore.getSessionDirectory(),
    shareUrl: messageStore.getShareUrl(),
    canUndo: messageStore.canUndo(),
    canRedo: messageStore.canRedo(),
    redoSteps: messageStore.getRedoSteps(),
    revertedContent: messageStore.getCurrentRevertedContent(),
    loadState: messageStore.getLoadState(),
  }
}

function getSnapshot(): MessageStoreSnapshot {
  // 只有在 store 变化时才创建新 snapshot
  if (cachedSnapshot === null) {
    cachedSnapshot = createSnapshot()
  }
  return cachedSnapshot
}

// 订阅 store 变化，清除缓存
messageStore.subscribe(() => {
  cachedSnapshot = null
  snapshotVersion++
})

// ============================================
// React Hook
// ============================================

import { useSyncExternalStore, useRef, useCallback } from 'react'

/**
 * React hook to subscribe to message store
 * (Global / Current Session)
 */
export function useMessageStore(): MessageStoreSnapshot {
  return useSyncExternalStore(
    (onStoreChange) => messageStore.subscribe(onStoreChange),
    getSnapshot,
    getSnapshot
  )
}

/**
 * 选择器模式 - 只订阅需要的字段，减少不必要的重渲染
 * 
 * @example
 * // 只订阅 sessionId 和 isStreaming
 * const { sessionId, isStreaming } = useMessageStoreSelector(
 *   state => ({ sessionId: state.sessionId, isStreaming: state.isStreaming })
 * )
 */
export function useMessageStoreSelector<T>(
  selector: (state: MessageStoreSnapshot) => T,
  equalityFn: (a: T, b: T) => boolean = shallowEqual
): T {
  const prevResultRef = useRef<T | undefined>(undefined)
  
  const getSelectedSnapshot = useCallback(() => {
    const fullSnapshot = getSnapshot()
    const newResult = selector(fullSnapshot)
    
    // 如果结果相等，返回之前的引用以避免重渲染
    if (prevResultRef.current !== undefined && equalityFn(prevResultRef.current, newResult)) {
      return prevResultRef.current
    }
    
    prevResultRef.current = newResult
    return newResult
  }, [selector, equalityFn])
  
  return useSyncExternalStore(
    (onStoreChange) => messageStore.subscribe(onStoreChange),
    getSelectedSnapshot,
    getSelectedSnapshot
  )
}

/**
 * 浅比较两个对象
 */
function shallowEqual<T>(a: T, b: T): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object') return false
  if (a === null || b === null) return false
  
  const keysA = Object.keys(a as object)
  const keysB = Object.keys(b as object)
  
  if (keysA.length !== keysB.length) return false
  
  for (const key of keysA) {
    if ((a as any)[key] !== (b as any)[key]) return false
  }
  
  return true
}

// 缓存：sessionId -> Snapshot
const sessionSnapshots = new Map<string, any>()

// 订阅 store 变化，清除相关缓存
messageStore.subscribe(() => {
  sessionSnapshots.clear()
})

/**
 * React hook to subscribe to a SPECIFIC session state
 */
export function useSessionState(sessionId: string | null) {
  const getSnapshot = () => {
    if (!sessionId) return null
    
    // 如果缓存中有，直接返回
    if (sessionSnapshots.has(sessionId)) {
      return sessionSnapshots.get(sessionId)
    }
    
    const state = messageStore.getSessionState(sessionId)
    if (!state) return null
    
    // 构建 snapshot 并缓存
    const snapshot = {
      messages: state.messages,
      isStreaming: state.isStreaming,
      loadState: state.loadState,
      revertState: state.revertState,
      canUndo: state.messages.some(m => m.info.role === 'user' && !state.isStreaming),
    }
    
    sessionSnapshots.set(sessionId, snapshot)
    return snapshot
  }

  return useSyncExternalStore(
    (onStoreChange) => messageStore.subscribe(onStoreChange),
    getSnapshot,
    getSnapshot
  )
}

// ============================================
// 便捷选择器 Hooks
// ============================================

/** 只订阅 sessionId */
export function useCurrentSessionId(): string | null {
  return useMessageStoreSelector(state => state.sessionId)
}

/** 只订阅 isStreaming */
export function useIsStreaming(): boolean {
  return useMessageStoreSelector(state => state.isStreaming)
}

/** 只订阅 messages */
export function useMessages(): Message[] {
  return useMessageStoreSelector(state => state.messages, (a, b) => a === b)
}

/** 只订阅 canUndo/canRedo */
export function useUndoRedoState() {
  return useMessageStoreSelector(state => ({
    canUndo: state.canUndo,
    canRedo: state.canRedo,
    redoSteps: state.redoSteps,
  }))
}
