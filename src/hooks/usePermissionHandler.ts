// ============================================
// usePermissionHandler - Permission & Question 处理 (Enhanced)
// ============================================

import { useState, useCallback, useRef } from 'react'
import {
  replyPermission,
  replyQuestion,
  rejectQuestion,
  getPendingPermissions,
  getPendingQuestions,
  type ApiPermissionRequest,
  type ApiQuestionRequest,
  type PermissionReply,
  type QuestionAnswer,
} from '../api'
import { permissionErrorHandler } from '../utils'

export interface UsePermissionHandlerResult {
  // State
  pendingPermissionRequests: ApiPermissionRequest[]
  pendingQuestionRequests: ApiQuestionRequest[]
  // Setters (for SSE events)
  setPendingPermissionRequests: React.Dispatch<React.SetStateAction<ApiPermissionRequest[]>>
  setPendingQuestionRequests: React.Dispatch<React.SetStateAction<ApiQuestionRequest[]>>
  // Handlers
  handlePermissionReply: (requestId: string, reply: PermissionReply, directory?: string) => Promise<boolean>
  handleQuestionReply: (requestId: string, answers: QuestionAnswer[], directory?: string) => Promise<boolean>
  handleQuestionReject: (requestId: string, directory?: string) => Promise<boolean>
  // Refresh (poll for pending requests) - 支持单个或多个 session IDs
  refreshPendingRequests: (sessionIds?: string | string[], directory?: string) => Promise<void>
  // Reset
  resetPendingRequests: () => void
  // Loading state
  isReplying: boolean
}

const MAX_RETRIES = 3
const RETRY_DELAY = 500

async function withRetry<T>(
  fn: () => Promise<T>,
  retries = MAX_RETRIES,
  delay = RETRY_DELAY
): Promise<T> {
  let lastError: Error | undefined
  
  for (let i = 0; i < retries; i++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      console.warn(`[Permission] Attempt ${i + 1} failed:`, lastError.message)
      
      if (i < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, delay * (i + 1)))
      }
    }
  }
  
  throw lastError
}

export function usePermissionHandler(): UsePermissionHandlerResult {
  const [pendingPermissionRequests, setPendingPermissionRequests] = useState<ApiPermissionRequest[]>([])
  const [pendingQuestionRequests, setPendingQuestionRequests] = useState<ApiQuestionRequest[]>([])
  const [isReplying, setIsReplying] = useState(false)
  
  // 防止重复回复
  const replyingIdsRef = useRef<Set<string>>(new Set())

  const handlePermissionReply = useCallback(async (
    requestId: string, 
    reply: PermissionReply,
    directory?: string
  ): Promise<boolean> => {
    // 防止重复回复
    if (replyingIdsRef.current.has(requestId)) {
      console.warn(`[Permission] Already replying to ${requestId}`)
      return false
    }
    
    replyingIdsRef.current.add(requestId)
    setIsReplying(true)
    
    try {
      await withRetry(() => replyPermission(requestId, reply, undefined, directory))
      
      // 成功后从列表移除
      setPendingPermissionRequests(prev => prev.filter(r => r.id !== requestId))
      return true
    } catch (error) {
      permissionErrorHandler('reply after retries', error)
      
      // 即使失败也从列表移除，避免卡住 UI
      // 用户可以通过刷新重新获取
      setPendingPermissionRequests(prev => prev.filter(r => r.id !== requestId))
      return false
    } finally {
      replyingIdsRef.current.delete(requestId)
      setIsReplying(false)
    }
  }, [])

  const handleQuestionReply = useCallback(async (
    requestId: string, 
    answers: QuestionAnswer[],
    directory?: string
  ): Promise<boolean> => {
    if (replyingIdsRef.current.has(requestId)) {
      console.warn(`[Question] Already replying to ${requestId}`)
      return false
    }
    
    replyingIdsRef.current.add(requestId)
    setIsReplying(true)
    
    try {
      await withRetry(() => replyQuestion(requestId, answers, directory))
      setPendingQuestionRequests(prev => prev.filter(r => r.id !== requestId))
      return true
    } catch (error) {
      permissionErrorHandler('question reply after retries', error)
      setPendingQuestionRequests(prev => prev.filter(r => r.id !== requestId))
      return false
    } finally {
      replyingIdsRef.current.delete(requestId)
      setIsReplying(false)
    }
  }, [])

  const handleQuestionReject = useCallback(async (
    requestId: string,
    directory?: string
  ): Promise<boolean> => {
    if (replyingIdsRef.current.has(requestId)) {
      return false
    }
    
    replyingIdsRef.current.add(requestId)
    setIsReplying(true)
    
    try {
      await withRetry(() => rejectQuestion(requestId, directory))
      setPendingQuestionRequests(prev => prev.filter(r => r.id !== requestId))
      return true
    } catch (error) {
      permissionErrorHandler('question reject after retries', error)
      setPendingQuestionRequests(prev => prev.filter(r => r.id !== requestId))
      return false
    } finally {
      replyingIdsRef.current.delete(requestId)
      setIsReplying(false)
    }
  }, [])

  // 主动轮询获取 pending 请求（用于 SSE 可能丢失事件的情况）
  // 支持传入多个 sessionIds（包括子 session）
  const refreshPendingRequests = useCallback(async (
    sessionIds?: string | string[], 
    directory?: string
  ) => {
    try {
      // 规范化为数组
      const ids = sessionIds 
        ? (Array.isArray(sessionIds) ? sessionIds : [sessionIds])
        : []
      
      // 并行获取所有 session 的权限请求
      const results = await Promise.all(
        ids.map(async (sessionId) => {
          const [permissions, questions] = await Promise.all([
            getPendingPermissions(sessionId, directory).catch(() => []),
            getPendingQuestions(sessionId, directory).catch(() => []),
          ])
          return { permissions, questions }
        })
      )
      
      // 合并所有结果
      const allPermissions = results.flatMap(r => r.permissions)
      const allQuestions = results.flatMap(r => r.questions)
      
      // 合并而不是替换，避免丢失刚收到的 SSE 事件
      setPendingPermissionRequests(prev => {
        const existingIds = new Set(prev.map(r => r.id))
        const newRequests = allPermissions.filter(r => !existingIds.has(r.id))
        return newRequests.length > 0 ? [...prev, ...newRequests] : prev
      })
      
      setPendingQuestionRequests(prev => {
        const existingIds = new Set(prev.map(r => r.id))
        const newRequests = allQuestions.filter(r => !existingIds.has(r.id))
        return newRequests.length > 0 ? [...prev, ...newRequests] : prev
      })
    } catch (error) {
      permissionErrorHandler('refresh pending requests', error)
    }
  }, [])

  const resetPendingRequests = useCallback(() => {
    setPendingPermissionRequests([])
    setPendingQuestionRequests([])
    replyingIdsRef.current.clear()
  }, [])

  return {
    pendingPermissionRequests,
    pendingQuestionRequests,
    setPendingPermissionRequests,
    setPendingQuestionRequests,
    handlePermissionReply,
    handleQuestionReply,
    handleQuestionReject,
    refreshPendingRequests,
    resetPendingRequests,
    isReplying,
  }
}
