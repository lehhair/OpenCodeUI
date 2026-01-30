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

class MessageStore {
  private sessions = new Map<string, SessionState>()
  private currentSessionId: string | null = null
  private subscribers = new Set<Subscriber>()

  // ============================================
  // Subscription
  // ============================================

  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn)
    return () => this.subscribers.delete(fn)
  }

  private notify() {
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
   */
  getVisibleMessages(): Message[] {
    const state = this.getCurrentSessionState()
    if (!state) {
      return []
    }

    const { messages, revertState } = state

    if (!revertState) {
      return messages
    }

    // 找到 revert 点，只返回之前的消息
    const revertIndex = messages.findIndex(m => m.info.id === revertState.messageId)
    if (revertIndex === -1) {
      // 找不到 revert 点，返回所有消息
      return messages
    }

    return messages.slice(0, revertIndex)
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

  // ============================================
  // Session Management
  // ============================================

  /**
   * 切换当前 session（不触发数据加载）
   */
  setCurrentSession(sessionId: string | null) {
    if (this.currentSessionId === sessionId) return
    
    this.currentSessionId = sessionId
    this.notify()
  }

  /**
   * 初始化 session 状态（如果不存在）
   */
  private ensureSession(sessionId: string): SessionState {
    let state = this.sessions.get(sessionId)
    if (!state) {
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

    this.notify()
  }

  /**
   * 清空 session（用于新建对话）
   */
  clearSession(sessionId: string) {
    this.sessions.delete(sessionId)
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
        attachments.push({
          id: fp.id || crypto.randomUUID(),
          type: isFolder ? 'folder' : 'file',
          displayName: fp.filename || fp.source?.path || 'file',
          url: fp.url,
          mime: fp.mime,
          relativePath: fp.source?.path,
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

import { useSyncExternalStore } from 'react'

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
