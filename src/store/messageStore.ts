// ============================================
// MessageStore - 消息状态集中管理
// ============================================
//
// 核心设计：
// 1. 每个 session 的消息独立存储在内存中
// 2. SSE 事件直接修改对应 session 的消息（找不到则丢弃）
// 3. Undo/Redo 通过 revertState 实现
// 4. RAF 批量通知 React 组件更新

import type { Message, Part, FilePart, AgentPart } from '../types/message'
import type { ApiMessageWithParts, ApiMessage, ApiPart, ApiSession, Attachment } from '../api/types'
import { logger } from '../utils/logger'
import { isUserUIMessage, toUIMessage, toUIMessageInfo, toUIPart } from '../utils/messageConversion'
import type { RevertState, RevertHistoryItem, SessionState, SendRollbackSnapshot } from './messageStoreTypes'

// Re-export types for consumers
export type { RevertState, RevertHistoryItem, SessionState, SendRollbackSnapshot } from './messageStoreTypes'

type Subscriber = () => void

const MAX_CACHED_SESSIONS = 10

class MessageStore {
  private sessions = new Map<string, SessionState>()
  private subscribers = new Set<Subscriber>()
  private sessionAccessTime = new Map<string, number>()
  /** 被分屏 pane 保护的 sessionId 集合，evict 时跳过 */
  private protectedSessions = new Set<string>()
  private pendingNotify = false
  private rafId: number | null = null
  // delta 批量化：按 session 追踪被 mutable 修改过的消息，在 notify 前统一做不可变快照
  private dirtyMessagesBySession = new Map<string, Set<string>>()

  // ============================================
  // Subscription & Notification
  // ============================================

  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn)
    return () => this.subscribers.delete(fn)
  }

  private notify() {
    if (this.pendingNotify) return
    this.pendingNotify = true

    if (typeof requestAnimationFrame !== 'undefined') {
      this.rafId = requestAnimationFrame(() => {
        this.pendingNotify = false
        this.rafId = null
        this.flushDirtyMessages()
        this.subscribers.forEach(fn => fn())
      })
    } else {
      this.pendingNotify = false
      this.flushDirtyMessages()
      this.subscribers.forEach(fn => fn())
    }
  }

  /**
   * 将 delta 期间 mutable 修改过的消息做一次不可变快照。
   * 这样一帧内多个 delta 只产生一次数组拷贝，而不是每个 delta 都拷贝。
   */
  private flushDirtyMessages() {
    if (this.dirtyMessagesBySession.size === 0) return

    for (const [sessionId, dirtyMessages] of this.dirtyMessagesBySession) {
      const state = this.sessions.get(sessionId)
      if (!state) continue

      // 只对被标记 dirty 的消息生成新引用（包括 parts 内的对象）
      let changed = false
      const newMessages = state.messages.map(m => {
        if (dirtyMessages.has(m.info.id)) {
          changed = true
          return { ...m, parts: m.parts.map(p => ({ ...p })) }
        }
        return m
      })

      if (changed) {
        state.messages = newMessages
      }
    }

    this.dirtyMessagesBySession.clear()
  }

  private notifyImmediate() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    this.pendingNotify = false
    this.flushDirtyMessages()
    this.subscribers.forEach(fn => fn())
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

  getShareUrl(sessionId: string | null): string | undefined {
    if (!sessionId) return undefined
    return this.sessions.get(sessionId)?.shareUrl
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
        shareUrl: undefined,
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
      shareUrl?: string
    },
  ) {
    const state = this.sessions.get(sessionId)
    if (!state) return

    if (options.hasMoreHistory !== undefined) state.hasMoreHistory = options.hasMoreHistory
    if (options.directory !== undefined) state.directory = options.directory
    if (options.title !== undefined) state.title = options.title
    if (options.loadState !== undefined) state.loadState = options.loadState
    if (options.shareUrl !== undefined) state.shareUrl = options.shareUrl

    this.notify()
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

    this.notify()
  }

  removeMessage(sessionId: string, messageId: string) {
    const state = this.sessions.get(sessionId)
    if (!state) return
    const nextMessages = state.messages.filter(message => message.info.id !== messageId)
    if (nextMessages.length === state.messages.length) return
    state.messages = nextMessages
    this.notify()
  }

  markAllSessionsStale() {
    let updated = false
    for (const state of this.sessions.values()) {
      if (state.loadState !== 'loaded' || state.isStale) continue
      state.isStale = true
      updated = true
    }
    if (updated) this.notify()
  }

  setLoadState(sessionId: string, loadState: SessionState['loadState']) {
    const state = this.ensureSession(sessionId)
    state.loadState = loadState
    this.notify()
  }

  // ============================================
  // Message CRUD
  // ============================================

  setMessages(
    sessionId: string,
    apiMessages: ApiMessageWithParts[],
    options?: {
      directory?: string
      title?: string
      hasMoreHistory?: boolean
      revertState?: ApiSession['revert'] | null
      shareUrl?: string
    },
  ) {
    const state = this.ensureSession(sessionId)

    state.messages = apiMessages.map(toUIMessage)
    state.loadState = 'loaded'
    state.hasMoreHistory = options?.hasMoreHistory ?? false
    state.directory = options?.directory ?? ''
    if (options?.title !== undefined) state.title = options.title
    state.shareUrl = options?.shareUrl
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

    this.notify()
  }

  prependMessages(sessionId: string, apiMessages: ApiMessageWithParts[], hasMore: boolean) {
    const state = this.sessions.get(sessionId)
    if (!state) return

    const newMessages = apiMessages.map(toUIMessage)

    // 去重
    const existingIds = new Set(state.messages.map(m => m.info.id))
    const unique = newMessages.filter(m => !existingIds.has(m.info.id))

    if (unique.length > 0) {
      state.messages = [...unique, ...state.messages]
    }
    state.hasMoreHistory = hasMore

    this.notify()
  }

  clearAll() {
    this.sessions.clear()
    this.sessionAccessTime.clear()
    this.dirtyMessagesBySession.clear()
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    this.pendingNotify = false
    this.notifyImmediate()
  }

  clearSession(sessionId: string) {
    this.sessions.delete(sessionId)
    this.sessionAccessTime.delete(sessionId)
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

  handleMessageUpdated(apiMsg: ApiMessage) {
    const state = this.ensureSession(apiMsg.sessionID)
    const existingIndex = state.messages.findIndex(m => m.info.id === apiMsg.id)

    if (existingIndex >= 0) {
      const oldMessage = state.messages[existingIndex]
      const newMessage = { ...oldMessage, info: toUIMessageInfo(apiMsg) }
      state.messages = [
        ...state.messages.slice(0, existingIndex),
        newMessage,
        ...state.messages.slice(existingIndex + 1),
      ]
    } else {
      const newMsg: Message = {
        info: toUIMessageInfo(apiMsg),
        parts: [],
        isStreaming: apiMsg.role === 'assistant',
      }
      state.messages = [...state.messages, newMsg]
      if (apiMsg.role === 'assistant') {
        state.isStreaming = true
      }
    }

    this.notify()
  }

  handlePartUpdated(apiPart: ApiPart & { sessionID: string; messageID: string }) {
    const state = this.sessions.get(apiPart.sessionID)
    if (!state) return

    const msgIndex = state.messages.findIndex(m => m.info.id === apiPart.messageID)
    if (msgIndex === -1) return

    const oldMessage = state.messages[msgIndex]
    const newParts = [...oldMessage.parts]
    const existingPartIndex = newParts.findIndex(p => p.id === apiPart.id)

    if (existingPartIndex >= 0) {
      newParts[existingPartIndex] = toUIPart(apiPart)
    } else {
      newParts.push(toUIPart(apiPart))
    }

    const newMessage = { ...oldMessage, parts: newParts }
    state.messages = [...state.messages.slice(0, msgIndex), newMessage, ...state.messages.slice(msgIndex + 1)]
    this.notify()
  }

  handlePartDelta(data: { sessionID: string; messageID: string; partID: string; field: string; delta: string }) {
    const state = this.sessions.get(data.sessionID)
    if (!state) return

    const msg = state.messages.find(m => m.info.id === data.messageID)
    if (!msg) return

    const part = msg.parts.find(p => p.id === data.partID)
    if (!part) return

    if (!(data.field === 'text' && 'text' in part))
      return // Mutable 修改：直接拼接 text，不做不可变拷贝。
      // 一帧内可能收到多个 delta，只有最后的状态会被 React 看到。
      // flushDirtyMessages() 会在 notify 的 rAF 回调中统一生成新引用。
    ;(part as { text: string }).text += data.delta

    let dirtyMessages = this.dirtyMessagesBySession.get(data.sessionID)
    if (!dirtyMessages) {
      dirtyMessages = new Set<string>()
      this.dirtyMessagesBySession.set(data.sessionID, dirtyMessages)
    }
    dirtyMessages.add(data.messageID)
    this.notify()
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
    this.notify()
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
    this.notify()
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
    this.notify()
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
    this.notify()
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
    this.notify()
  }

  setRevertState(sessionId: string, revertState: RevertState | null) {
    const state = this.sessions.get(sessionId)
    if (!state) return
    state.revertState = revertState
    this.notify()
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
    const state = this.sessions.get(sessionId)
    if (!state) return
    state.isStreaming = isStreaming
    this.notify()
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
