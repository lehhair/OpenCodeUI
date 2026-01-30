// ============================================
// useRevertState - Undo/Redo (Revert) 逻辑
// ============================================

import { useState, useCallback } from 'react'
import type { Message, Part } from '../types/message'
import {
  getSessionMessages,
  revertMessage,
  unrevertSession,
  extractUserMessageContent,
  type ApiSession,
  type RevertedMessage,
  type ApiMessageWithParts,
} from '../api'
import { revertErrorHandler } from '../utils'

/** 将 API 消息转换为 UI Message */
function convertApiToMessage(apiMsg: ApiMessageWithParts): Message {
  return {
    info: apiMsg.info as Message['info'],
    parts: apiMsg.parts as Part[],
    isStreaming: false,
  }
}

export interface RevertHistoryItem {
  messageId: string
  content: RevertedMessage
}

export interface UseRevertStateParams {
  routeSessionId: string | null
  messages: Message[]
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>
  agentPhase: string
  animateUndo: (messageIds: string[]) => Promise<void>
  animateRedo: () => Promise<void>
  /** Undo 完成后滚动到末尾 */
  scrollToEnd: () => void
}

export interface UseRevertStateResult {
  // State
  revertedMessage: RevertedMessage | undefined
  revertHistory: RevertHistoryItem[]
  // Computed
  canUndo: boolean
  canRedo: boolean
  revertSteps: number
  // Actions
  handleUndo: (userMessageId: string) => Promise<void>
  handleRedo: () => Promise<void>
  handleRedoAll: () => Promise<void>
  clearRevert: () => void
  // For session loading
  setRevertedMessage: React.Dispatch<React.SetStateAction<RevertedMessage | undefined>>
  setRevertHistory: React.Dispatch<React.SetStateAction<RevertHistoryItem[]>>
  setSessionRevertState: React.Dispatch<React.SetStateAction<ApiSession['revert'] | null>>
}

export function useRevertState({
  routeSessionId,
  messages,
  setMessages,
  agentPhase,
  animateUndo,
  animateRedo,
  scrollToEnd,
}: UseRevertStateParams): UseRevertStateResult {
  // ============================================
  // State
  // ============================================
  const [, setSessionRevertState] = useState<ApiSession['revert'] | null>(null)
  const [revertedMessage, setRevertedMessage] = useState<RevertedMessage | undefined>(undefined)
  const [revertHistory, setRevertHistory] = useState<RevertHistoryItem[]>([])

  // ============================================
  // Computed
  // ============================================
  const canUndo = messages.length > 0 && messages.some(m => m.info.role === 'user') && agentPhase === 'idle'
  const canRedo = revertHistory.length > 0 && agentPhase === 'idle'
  const revertSteps = revertHistory.length

  // ============================================
  // Handlers
  // ============================================
  
  const handleUndo = useCallback(async (userMessageId: string) => {
    if (!routeSessionId) return
    
    try {
      // 1. 找到 UI 中要删除的消息（从点击的消息开始到最后）
      const targetUIIndex = messages.findIndex(m => m.info.id === userMessageId)
      if (targetUIIndex === -1) {
        revertErrorHandler('user message not found in UI', new Error(`Message ID: ${userMessageId}`))
        return
      }
      
      // 获取所有要删除的消息 ID（用于动画）
      const messageIdsToRemove = messages.slice(targetUIIndex).map(m => m.info.id)
      
      // 2. 播放消失动画
      await animateUndo(messageIdsToRemove)
      
      // 3. 获取 API 消息
      const apiMessages = await getSessionMessages(routeSessionId)
      const targetIndex = apiMessages.findIndex(m => m.info.id === userMessageId)
      
      if (targetIndex === -1) {
        revertErrorHandler('user message not found in API', new Error(`Message ID: ${userMessageId}`))
        return
      }
      
      // 4. 调用 revert API（传入用户消息 ID）
      const updatedSession = await revertMessage(routeSessionId, userMessageId)
      setSessionRevertState(updatedSession.revert || null)
      
      // 5. 从点击的消息开始，收集所有 user 消息，构建完整的撤销历史
      const revertedUserMessages = apiMessages
        .slice(targetIndex)
        .filter(m => m.info.role === 'user')
      
      const fullRevertHistory = revertedUserMessages.map(m => ({
        messageId: m.info.id,
        content: extractUserMessageContent(m)
      }))
      
      // 6. 设置完整的撤销历史（覆盖之前的）
      setRevertHistory(fullRevertHistory)
      
      // 7. 设置 revert 点（第一条，用户点击的那条）的内容到输入框
      const firstRevertedContent = fullRevertHistory[0]?.content
      setRevertedMessage(firstRevertedContent)
      
      // 8. 过滤掉被撤销的消息及其后的所有消息
      const filteredApiMessages = apiMessages.slice(0, targetIndex)
      setMessages(filteredApiMessages.map(convertApiToMessage))
      
      // 9. 滚动到末尾，让用户看到"断点"
      // 需要等 React 渲染完成和 Virtuoso 更新
      setTimeout(() => {
        requestAnimationFrame(() => scrollToEnd())
      }, 50)
    } catch (error) {
      revertErrorHandler('undo', error)
    }
  }, [routeSessionId, animateUndo, messages, setMessages])

  const handleRedo = useCallback(async () => {
    if (!routeSessionId || revertHistory.length === 0) return
    
    try {
      // 1. 播放恢复动画
      await animateRedo()
      
      // 2. 从历史栈中移除第一条（最早撤销的）
      const newHistory = revertHistory.slice(1)
      
      let updatedSession: ApiSession
      
      if (newHistory.length > 0) {
        // 还有更多撤销历史，设置 revert 点到新的第一条
        const newFirstReverted = newHistory[0]
        updatedSession = await revertMessage(routeSessionId, newFirstReverted.messageId)
        // 输入框显示新的 revert 点的内容（当前要编辑的消息）
        setRevertedMessage(newFirstReverted.content)
      } else {
        // 没有更多撤销历史，完全清除 revert 状态
        updatedSession = await unrevertSession(routeSessionId)
        setRevertedMessage(undefined)
      }
      
      setSessionRevertState(updatedSession.revert || null)
      setRevertHistory(newHistory)
      
      // 3. 重新加载消息
      const apiMessages = await getSessionMessages(routeSessionId)
      
      // 如果还有 revert 状态，需要过滤消息
      if (updatedSession.revert?.messageID) {
        const revertedIndex = apiMessages.findIndex(m => m.info.id === updatedSession.revert!.messageID)
        const filteredApiMessages = apiMessages.slice(0, revertedIndex)
        setMessages(filteredApiMessages.map(convertApiToMessage))
      } else {
        // 没有 revert 状态，显示所有消息
        setMessages(apiMessages.map(convertApiToMessage))
      }
    } catch (error) {
      revertErrorHandler('redo', error)
    }
  }, [routeSessionId, revertHistory, animateRedo, setMessages])

  const handleRedoAll = useCallback(async () => {
    if (!routeSessionId || revertHistory.length === 0) return
    
    try {
      // 调用 unrevert API 清除所有 revert 状态
      const updatedSession = await unrevertSession(routeSessionId)
      setSessionRevertState(updatedSession.revert || null)
      
      // 清空历史栈
      setRevertHistory([])
      setRevertedMessage(undefined)
      
      // 重新加载所有消息
      const apiMessages = await getSessionMessages(routeSessionId)
      setMessages(apiMessages.map(convertApiToMessage))
    } catch (error) {
      revertErrorHandler('redo all', error)
    }
  }, [routeSessionId, revertHistory.length, setMessages])

  const clearRevert = useCallback(() => {
    setRevertedMessage(undefined)
    setRevertHistory([])
  }, [])

  return {
    // State
    revertedMessage,
    revertHistory,
    // Computed
    canUndo,
    canRedo,
    revertSteps,
    // Actions
    handleUndo,
    handleRedo,
    handleRedoAll,
    clearRevert,
    // For session loading
    setRevertedMessage,
    setRevertHistory,
    setSessionRevertState,
  }
}
