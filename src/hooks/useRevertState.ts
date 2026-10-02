// ============================================
// useRevertState - Undo/Redo (Revert) 逻辑
// ============================================

import { useState, useCallback } from 'react'
import {
  getSessionMessages,
  revertMessage,
  unrevertSession,
  extractUserMessageContent,
  type RevertedMessage,
  type SessionRevert,
} from '../api'
import { isUserMessage, type SessionMessageInfo } from '../types/api/message'
import { revertErrorHandler } from '../utils'
import { INITIAL_MESSAGE_LIMIT } from '../constants'

export interface RevertHistoryItem {
  messageId: string
  content: RevertedMessage
}

export interface UseRevertStateParams {
  routeSessionId: string | null
  messages: SessionMessageInfo[]
  setMessages: React.Dispatch<React.SetStateAction<SessionMessageInfo[]>>
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
  setSessionRevertState: React.Dispatch<React.SetStateAction<SessionRevert | null>>
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
  const [, setSessionRevertState] = useState<SessionRevert | null>(null)
  const [revertedMessage, setRevertedMessage] = useState<RevertedMessage | undefined>(undefined)
  const [revertHistory, setRevertHistory] = useState<RevertHistoryItem[]>([])

  // ============================================
  // Computed
  // ============================================
  const canUndo = messages.length > 0 && messages.some(isUserMessage) && agentPhase === 'idle'
  const canRedo = revertHistory.length > 0 && agentPhase === 'idle'
  const revertSteps = revertHistory.length

  // ============================================
  // Handlers
  // ============================================

  const handleUndo = useCallback(
    async (userMessageId: string) => {
      if (!routeSessionId) return

      try {
        // 1. 找到本地列表里要删除的消息（从点击的消息开始到最后）
        const targetUiIndex = messages.findIndex(m => m.id === userMessageId)
        if (targetUiIndex === -1) {
          revertErrorHandler('user message not found in UI', new Error(`Message ID: ${userMessageId}`))
          return
        }

        // 获取所有要删除的消息 ID（用于动画）
        const messageIdsToRemove = messages.slice(targetUiIndex).map(m => m.id)

        // 2. 播放消失动画
        await animateUndo(messageIdsToRemove)

        // 3. 拉取服务端的原生消息，直接按 id / type 处理（v2 没有 info/parts 包装）
        const apiMessages = await getSessionMessages(routeSessionId, Math.max(INITIAL_MESSAGE_LIMIT, 200))
        const targetIndex = apiMessages.findIndex(m => m.id === userMessageId)

        if (targetIndex === -1) {
          revertErrorHandler('user message not found in API', new Error(`Message ID: ${userMessageId}`))
          return
        }

        // 4. 调用 revert API（传入用户消息 ID）
        // v2：revert.stage() 直接返回 SessionRevert（不再是包着 revert 的会话对象）
        const stagedRevert = await revertMessage(routeSessionId, userMessageId)
        setSessionRevertState(stagedRevert ?? null)

        // 5. 从点击的消息开始，收集所有 user 消息，构建完整的撤销历史
        const revertedUserMessages = apiMessages.slice(targetIndex).filter(isUserMessage)

        const fullRevertHistory = revertedUserMessages.map(message => ({
          messageId: message.id,
          content: extractUserMessageContent(message),
        }))

        // 6. 设置完整的撤销历史（覆盖之前的）
        setRevertHistory(fullRevertHistory)

        // 7. 设置 revert 点（第一条，用户点击的那条）的内容到输入框
        const firstRevertedContent = fullRevertHistory[0]?.content
        setRevertedMessage(firstRevertedContent)

        // 8. 过滤掉被撤销的消息及其后的所有消息
        setMessages(apiMessages.slice(0, targetIndex))

        // 9. 滚动到末尾，让用户看到"断点"
        // 等 React 渲染完成后再滚动
        requestAnimationFrame(() => scrollToEnd())
      } catch (error) {
        revertErrorHandler('undo', error)
      }
    },
    [routeSessionId, animateUndo, messages, setMessages, scrollToEnd],
  )

  const handleRedo = useCallback(async () => {
    if (!routeSessionId || revertHistory.length === 0) return

    try {
      // 1. 播放恢复动画
      await animateRedo()

      // 2. 从历史栈中移除第一条（最早撤销的）
      const newHistory = revertHistory.slice(1)

      let stagedRevert: SessionRevert | null

      if (newHistory.length > 0) {
        // 还有更多撤销历史，设置 revert 点到新的第一条
        const newFirstReverted = newHistory[0]
        stagedRevert = await revertMessage(routeSessionId, newFirstReverted.messageId)
        // 输入框显示新的 revert 点的内容（当前要编辑的消息）
        setRevertedMessage(newFirstReverted.content)
      } else {
        // 没有更多撤销历史，完全清除 revert 状态（v2 的 revert.clear 返回 void）
        await unrevertSession(routeSessionId)
        stagedRevert = null
        setRevertedMessage(undefined)
      }

      setSessionRevertState(stagedRevert)
      setRevertHistory(newHistory)

      // 3. 重新加载原生消息
      const apiMessages = await getSessionMessages(routeSessionId, Math.max(INITIAL_MESSAGE_LIMIT, 200))

      // 如果还有 revert 状态，需要过滤消息
      if (stagedRevert?.messageID) {
        const revertedIndex = apiMessages.findIndex(m => m.id === stagedRevert.messageID)
        // findIndex 找不到时返回 -1，而 slice(0, -1) 会「只砍掉最后一条」——
        // 静默显示几乎全部消息，看起来像撤销成功后消息又冒出来。
        // 撤销点早于本次拉取窗口（这里最多 200 条）时就会命中这种情况。
        setMessages(revertedIndex === -1 ? apiMessages : apiMessages.slice(0, revertedIndex))
      } else {
        // 没有 revert 状态，显示所有消息
        setMessages(apiMessages)
      }
    } catch (error) {
      revertErrorHandler('redo', error)
    }
  }, [routeSessionId, revertHistory, animateRedo, setMessages])

  const handleRedoAll = useCallback(async () => {
    if (!routeSessionId || revertHistory.length === 0) return

    try {
      // 调用 unrevert API 清除所有 revert 状态（v2 返回 void）
      await unrevertSession(routeSessionId)
      setSessionRevertState(null)

      // 清空历史栈
      setRevertHistory([])
      setRevertedMessage(undefined)

      // 重新加载所有消息
      const apiMessages = await getSessionMessages(routeSessionId, Math.max(INITIAL_MESSAGE_LIMIT, 200))
      setMessages(apiMessages)
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
