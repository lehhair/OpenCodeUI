// ============================================
// usePermissionHandler - 权限与表单处理（OpenCode v2）
// ============================================

import { useState, useCallback, useRef } from 'react'
import {
  replyPermission,
  replyForm,
  cancelForm,
  getPendingPermissions,
  getPendingForms,
  type ApiPermissionRequest,
  type ApiFormInfo,
  type PermissionReply,
  type FormAnswer,
} from '../api'
import { activeSessionStore } from '../store'
import { makeSessionKey } from '../utils/sessionKey'
import { permissionErrorHandler } from '../utils'

export interface UsePermissionHandlerResult {
  // State
  pendingPermissionRequests: ApiPermissionRequest[]
  /** v2 的待处理表单（取代 v1 的 question；命名保留以减少调用点改动） */
  pendingQuestionRequests: ApiFormInfo[]
  // Setters (for SSE events)
  setPendingPermissionRequests: React.Dispatch<React.SetStateAction<ApiPermissionRequest[]>>
  setPendingQuestionRequests: React.Dispatch<React.SetStateAction<ApiFormInfo[]>>
  // Handlers
  handlePermissionReply: (
    requestId: string,
    reply: PermissionReply,
    directory?: string,
    sessionId?: string,
  ) => Promise<boolean>
  /** 提交表单答案（v2：键值对象） */
  handleFormReply: (form: ApiFormInfo, answer: FormAnswer) => Promise<boolean>
  /** 取消表单 */
  handleFormCancel: (form: ApiFormInfo, message?: string) => Promise<boolean>
  // Refresh (fallback sync for pending requests) - 支持单个或多个 session IDs
  refreshPendingRequests: (sessionIds?: string | string[], directory?: string) => Promise<void>
  // Reset
  resetPendingRequests: () => void
  // Loading state
  isReplying: boolean
}

const MAX_RETRIES = 3
const RETRY_DELAY = 500

async function isPermissionStillPending(
  requestId: string,
  directory?: string,
  sessionId?: string,
  serverId?: string,
): Promise<boolean | undefined> {
  try {
    const pending = await getPendingPermissions(sessionId, directory, serverId)
    return pending.some(request => request.id === requestId)
  } catch {
    return undefined
  }
}

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

export function usePermissionHandler(serverId: string): UsePermissionHandlerResult {
  const [pendingPermissionRequests, setPendingPermissionRequests] = useState<ApiPermissionRequest[]>([])
  const [pendingQuestionRequests, setPendingQuestionRequests] = useState<ApiFormInfo[]>([])
  const [isReplying, setIsReplying] = useState(false)

  // 防止重复回复
  const replyingIdsRef = useRef<Set<string>>(new Set())

  // serverId 是本 hook 的作用域：所有发起请求的回调都必须把它列入依赖。
  // pane 的服务器绑定会变（切会话、多服务器、WSL sidecar 就绪后切回），
  // 空依赖数组会把 serverId 冻在首次渲染的值上，回复被发到旧服务器：
  // 旧服务器报错 → 请求在真实服务器上仍 pending → 弹窗消失后又冒出来，对话不前进。
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
        await withRetry(() => replyPermission(requestId, reply, undefined, directory, sessionId, serverId))
        setPendingPermissionRequests(prev =>
          prev.some(r => r.id === requestId) ? prev.filter(r => r.id !== requestId) : prev,
        )
        activeSessionStore.resolvePendingRequest(requestId)
        return true
      } catch (error) {
        const stillPending = await isPermissionStillPending(requestId, directory, sessionId, serverId)
        if (stillPending === false) {
          setPendingPermissionRequests(prev =>
            prev.some(r => r.id === requestId) ? prev.filter(r => r.id !== requestId) : prev,
          )
          activeSessionStore.resolvePendingRequest(requestId)
          return true
        }

        permissionErrorHandler('reply after retries', error)

        return false
      } finally {
        replyingIdsRef.current.delete(requestId)
        setIsReplying(false)
      }
    },
    [serverId],
  )

  /**
   * 提交表单答案。
   *
   * v2 的 `session.form.reply` 需要 sessionID（表单自带），
   * 答案形状也从位置数组变为 `{ [field.key]: FormValue }`。
   */
  const handleFormReply = useCallback(
    async (form: ApiFormInfo, answer: FormAnswer): Promise<boolean> => {
      const formId = form.id
      if (replyingIdsRef.current.has(formId)) {
        console.warn(`[Form] Already replying to ${formId}`)
        return false
      }

      replyingIdsRef.current.add(formId)
      setIsReplying(true)

      try {
        await withRetry(() => replyForm(form.sessionID, formId, answer, serverId))
        setPendingQuestionRequests(prev => prev.filter(r => r.id !== formId))
        activeSessionStore.resolvePendingRequest(formId)
        return true
      } catch (error) {
        permissionErrorHandler('form reply after retries', error)
        setPendingQuestionRequests(prev => prev.filter(r => r.id !== formId))
        activeSessionStore.resolvePendingRequest(formId)
        return false
      } finally {
        replyingIdsRef.current.delete(formId)
        setIsReplying(false)
      }
    },
    [serverId],
  )

  /** 取消表单（取代 v1 的 question.reject） */
  const handleFormCancel = useCallback(
    async (form: ApiFormInfo, message?: string): Promise<boolean> => {
      const formId = form.id
      if (replyingIdsRef.current.has(formId)) {
        return false
      }

      replyingIdsRef.current.add(formId)
      setIsReplying(true)

      try {
        await withRetry(() => cancelForm(form.sessionID, formId, message, serverId))
        setPendingQuestionRequests(prev => prev.filter(r => r.id !== formId))
        activeSessionStore.resolvePendingRequest(formId)
        return true
      } catch (error) {
        permissionErrorHandler('form cancel after retries', error)
        setPendingQuestionRequests(prev => prev.filter(r => r.id !== formId))
        activeSessionStore.resolvePendingRequest(formId)
        return false
      } finally {
        replyingIdsRef.current.delete(formId)
        setIsReplying(false)
      }
    },
    [serverId],
  )

  // 主动轮询获取 pending 请求（用于 SSE 可能丢失事件的情况）
  // 一次拉取全量数据，用 sessionFamily 过滤后直接替换本地状态
  const refreshPendingRequests = useCallback(async (sessionIds?: string | string[], directory?: string) => {
    try {
      // 规范化为 Set 用于过滤（family 是复合 key；API 返回的 sessionID 是原始 id）
      const familySet = new Set(sessionIds ? (Array.isArray(sessionIds) ? sessionIds : [sessionIds]) : [])
      // 原始 id → 复合 key（按当前 pane 的服务器），两种形式都匹配
      const matchesFamily = (rawSessionId: string) => {
        if (familySet.size === 0) return true
        if (familySet.has(rawSessionId)) return true
        return familySet.has(makeSessionKey(serverId, rawSessionId))
      }

      // 只请求一次全量数据（不按 sessionId 分别请求）
      const [allPermissions, allQuestions] = await Promise.all([
        getPendingPermissions(undefined, directory, serverId).catch(() => []),
        getPendingForms(undefined, directory, serverId).catch(() => []),
      ])

      const nextPermissions =
        familySet.size > 0
          ? allPermissions.filter(p => matchesFamily(p.sessionID) && !replyingIdsRef.current.has(p.id))
          : allPermissions.filter(p => !replyingIdsRef.current.has(p.id))

      // OMO background subagents can emit permission.asked over SSE before /permission
      // exposes the request for the routed instance. Refresh 时序下子 session 关系可能
      // 尚未注册，因此 SSE 已知请求无条件保留（family 过滤只作用于新拉取的数据）
      setPendingPermissionRequests(prev => {
        const merged = new Map(nextPermissions.map(p => [p.id, p]))
        for (const request of prev) {
          if (replyingIdsRef.current.has(request.id)) continue
          if (!merged.has(request.id)) merged.set(request.id, request)
        }
        return Array.from(merged.values())
      })
      setPendingQuestionRequests(prev => {
        const nextQuestions =
          familySet.size > 0
            ? allQuestions.filter(q => matchesFamily(q.sessionID) && !replyingIdsRef.current.has(q.id))
            : allQuestions.filter(q => !replyingIdsRef.current.has(q.id))
        const merged = new Map(nextQuestions.map(q => [q.id, q]))
        for (const q of prev) {
          if (replyingIdsRef.current.has(q.id)) continue
          if (!merged.has(q.id)) merged.set(q.id, q)
        }
        return Array.from(merged.values())
      })
    } catch (error) {
      permissionErrorHandler('refresh pending requests', error)
    }
  }, [serverId])

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
    handleFormReply,
    handleFormCancel,
    refreshPendingRequests,
    resetPendingRequests,
    isReplying,
  }
}
