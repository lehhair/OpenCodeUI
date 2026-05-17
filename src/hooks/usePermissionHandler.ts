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
import { activeSessionStore } from '../store'
import { permissionErrorHandler } from '../utils'

export interface UsePermissionHandlerResult {
  // State
  pendingPermissionRequests: ApiPermissionRequest[]
  pendingQuestionRequests: ApiQuestionRequest[]
  // Setters (for SSE events)
  setPendingPermissionRequests: React.Dispatch<React.SetStateAction<ApiPermissionRequest[]>>
  setPendingQuestionRequests: React.Dispatch<React.SetStateAction<ApiQuestionRequest[]>>
  // Handlers
  handlePermissionReply: (
    requestId: string,
    reply: PermissionReply,
    directory?: string,
    sessionId?: string,
  ) => Promise<boolean>
  handleQuestionReply: (requestId: string, answers: QuestionAnswer[], directory?: string) => Promise<boolean>
  handleQuestionReject: (requestId: string, directory?: string) => Promise<boolean>
  // Refresh (fallback sync for pending requests) - 支持单个或多个 session IDs
  refreshPendingRequests: (sessionIds?: string | string[], directory?: string) => Promise<void>
  // Reset
  resetPendingRequests: () => void
  // Loading state
  isReplying: boolean
}

const MAX_RETRIES = 3
const RETRY_DELAY = 500

async function withRetry<T>(fn: () => Promise<T>, retries = MAX_RETRIES, delay = RETRY_DELAY): Promise<T> {
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

  const handlePermissionReply = useCallback(
    async (requestId: string, reply: PermissionReply, directory?: string, sessionId?: string): Promise<boolean> => {
      // 防止重复回复
      if (replyingIdsRef.current.has(requestId)) {
        console.warn(`[Permission] Already replying to ${requestId}`)
        return false
      }

      replyingIdsRef.current.add(requestId)
      setIsReplying(true)

      try {
        await withRetry(() => replyPermission(requestId, reply, undefined, directory, sessionId))

        // 等待 permission.replied SSE 再移除。部分后端路径会在找不到 pending 时
        // 仍返回 200/true，提前移除会让真实未处理的权限请求从 UI 消失。
        return true
      } catch (error) {
        permissionErrorHandler('reply after retries', error)

        return false
      } finally {
        replyingIdsRef.current.delete(requestId)
        setIsReplying(false)
      }
    },
    [],
  )

  const handleQuestionReply = useCallback(
    async (requestId: string, answers: QuestionAnswer[], directory?: string): Promise<boolean> => {
      if (replyingIdsRef.current.has(requestId)) {
        console.warn(`[Question] Already replying to ${requestId}`)
        return false
      }

      replyingIdsRef.current.add(requestId)
      setIsReplying(true)

      try {
        await withRetry(() => replyQuestion(requestId, answers, directory))
        setPendingQuestionRequests(prev => prev.filter(r => r.id !== requestId))
        activeSessionStore.resolvePendingRequest(requestId)
        return true
      } catch (error) {
        permissionErrorHandler('question reply after retries', error)
        setPendingQuestionRequests(prev => prev.filter(r => r.id !== requestId))
        activeSessionStore.resolvePendingRequest(requestId)
        return false
      } finally {
        replyingIdsRef.current.delete(requestId)
        setIsReplying(false)
      }
    },
    [],
  )

  const handleQuestionReject = useCallback(async (requestId: string, directory?: string): Promise<boolean> => {
    if (replyingIdsRef.current.has(requestId)) {
      return false
    }

    replyingIdsRef.current.add(requestId)
    setIsReplying(true)

    try {
      await withRetry(() => rejectQuestion(requestId, directory))
      setPendingQuestionRequests(prev => prev.filter(r => r.id !== requestId))
      activeSessionStore.resolvePendingRequest(requestId)
      return true
    } catch (error) {
      permissionErrorHandler('question reject after retries', error)
      setPendingQuestionRequests(prev => prev.filter(r => r.id !== requestId))
      activeSessionStore.resolvePendingRequest(requestId)
      return false
    } finally {
      replyingIdsRef.current.delete(requestId)
      setIsReplying(false)
    }
  }, [])

  // 主动轮询获取 pending 请求（用于 SSE 可能丢失事件的情况）
  // 一次拉取全量数据，用 sessionFamily 过滤后直接替换本地状态
  const refreshPendingRequests = useCallback(async (sessionIds?: string | string[], directory?: string) => {
    try {
      // 规范化为 Set 用于过滤
      const familySet = new Set(sessionIds ? (Array.isArray(sessionIds) ? sessionIds : [sessionIds]) : [])

      // 只请求一次全量数据（不按 sessionId 分别请求）
      const [allPermissions, allQuestions] = await Promise.all([
        getPendingPermissions(undefined, directory).catch(() => []),
        getPendingQuestions(undefined, directory).catch(() => []),
      ])

      const nextPermissions =
        familySet.size > 0
          ? allPermissions.filter(p => familySet.has(p.sessionID) && !replyingIdsRef.current.has(p.id))
          : allPermissions.filter(p => !replyingIdsRef.current.has(p.id))

      // OMO background subagents can emit permission.asked over SSE before /permission
      // exposes the request for the routed instance. Keep SSE-known requests until a
      // permission.replied event removes them.
      setPendingPermissionRequests(prev => {
        const merged = new Map(nextPermissions.map(p => [p.id, p]))
        for (const request of prev) {
          if (replyingIdsRef.current.has(request.id)) continue
          if (familySet.size > 0 && !familySet.has(request.sessionID)) continue
          if (!merged.has(request.id)) merged.set(request.id, request)
        }
        return Array.from(merged.values())
      })
      setPendingQuestionRequests(
        familySet.size > 0
          ? allQuestions.filter(q => familySet.has(q.sessionID) && !replyingIdsRef.current.has(q.id))
          : allQuestions.filter(q => !replyingIdsRef.current.has(q.id)),
      )
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
