// ============================================
// usePermissionHandler - 权限请求 + Form 表单处理
// ============================================
//
// ── 阶段 3a 的改造（V1 question → V2 Form）────────────────────────────────
//
// V1：`pendingQuestionRequests: ApiQuestionRequest[]`（一组选择题）+ 3 个 API
// V2：`pendingForms: FormInfo[]`（表单）+ 2 个 API（reply / cancel）
//
//   | V1 | V2 |
//   |---|---|
//   | `getPendingQuestions(sessionId, directory)` | `listPendingForms(directory)`（location 级，**没有 sessionId 过滤参数**） |
//   | `replyQuestion(requestId, answers[], directory)` | `replyForm(sessionId, formId, answer)` |
//   | `rejectQuestion(requestId, directory)` | `cancelForm(sessionId, formId)` |
//
// ⚠️ 关键差异：V2 的 form 端点**是 session 作用域的**（reply/cancel 都要 sessionID），
//    而**列表**端点只有 location 级（`GET /api/form`）或 session 级（`GET .../form`）。
//    所以「回复」必须从 `FormInfo.sessionID` 里取会话 id —— 这个字段 V2 一定给。
// ============================================

import { useState, useCallback, useRef } from 'react'
import {
  replyPermission,
  getPendingPermissions,
  listPendingForms,
  replyForm,
  cancelForm,
  type ApiPermissionRequest,
  type FormAnswer,
  type FormInfo,
  type PermissionReply,
} from '../api'
import { activeSessionStore } from '../store'
import { makeSessionKey } from '../utils/sessionKey'
import { permissionErrorHandler } from '../utils'

export interface UsePermissionHandlerResult {
  // State
  pendingPermissionRequests: ApiPermissionRequest[]
  /** V2 的待处理表单（取代 V1 的 pendingQuestionRequests） */
  pendingForms: FormInfo[]
  // Setters (for SSE events)
  setPendingPermissionRequests: React.Dispatch<React.SetStateAction<ApiPermissionRequest[]>>
  setPendingForms: React.Dispatch<React.SetStateAction<FormInfo[]>>
  // Handlers
  handlePermissionReply: (
    requestId: string,
    reply: PermissionReply,
    directory?: string,
    sessionId?: string,
  ) => Promise<boolean>
  /**
   * 回复表单
   * @param formId   表单 id（`frm_…`）
   * @param answer   字段 key → 值（类型必须与字段类型匹配，服务端会校验）
   * @param sessionId 表单所属会话（V2 的回复端点是 session 作用域的）
   */
  handleFormReply: (formId: string, answer: FormAnswer, sessionId: string, directory?: string) => Promise<boolean>
  /** 取消（跳过）表单 */
  handleFormCancel: (formId: string, sessionId: string, directory?: string) => Promise<boolean>
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
  _sessionId?: string,
  serverId?: string,
): Promise<boolean | undefined> {
  try {
    // ⚠️ V2 的列表端点没有 sessionId 过滤参数，只能拉全量后本地比对
    const pending = await getPendingPermissions(undefined, directory, serverId)
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
  const [pendingForms, setPendingForms] = useState<FormInfo[]>([])
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
        // ⚠️ V2 的回复必须带 sessionID；缺失时 replyPermission 会显式抛错
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

  const handleFormReply = useCallback(
    async (formId: string, answer: FormAnswer, sessionId: string, directory?: string): Promise<boolean> => {
      if (replyingIdsRef.current.has(formId)) {
        console.warn(`[Form] Already replying to ${formId}`)
        return false
      }

      replyingIdsRef.current.add(formId)
      setIsReplying(true)

      try {
        await withRetry(() => replyForm(sessionId, formId, answer, directory, serverId))
        setPendingForms(prev => prev.filter(f => f.id !== formId))
        activeSessionStore.resolvePendingRequest(formId)
        return true
      } catch (error) {
        permissionErrorHandler('form reply after retries', error)
        // ⚠️ 与 V1 的 question 不同：**失败时不要乐观移除**。
        //    表单可能是被服务端校验拒绝（answer 类型不对），此时它**仍然 pending**，
        //    移除会让用户再也看不到它、对话卡死。让 SSE / 刷新来决定它是否消失。
        return false
      } finally {
        replyingIdsRef.current.delete(formId)
        setIsReplying(false)
      }
    },
    [serverId],
  )

  const handleFormCancel = useCallback(
    async (formId: string, sessionId: string, directory?: string): Promise<boolean> => {
      if (replyingIdsRef.current.has(formId)) {
        return false
      }

      replyingIdsRef.current.add(formId)
      setIsReplying(true)

      try {
        await withRetry(() => cancelForm(sessionId, formId, directory, serverId))
        setPendingForms(prev => prev.filter(f => f.id !== formId))
        activeSessionStore.resolvePendingRequest(formId)
        return true
      } catch (error) {
        permissionErrorHandler('form cancel after retries', error)
        // 同 handleFormReply：失败不乐观移除
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
  const refreshPendingRequests = useCallback(
    async (sessionIds?: string | string[], directory?: string) => {
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
        const [allPermissions, allForms] = await Promise.all([
          getPendingPermissions(undefined, directory, serverId).catch(() => []),
          listPendingForms(directory, serverId).catch(() => []),
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
        setPendingForms(prev => {
          const nextForms =
            familySet.size > 0
              ? allForms.filter(f => matchesFamily(f.sessionID) && !replyingIdsRef.current.has(f.id))
              : allForms.filter(f => !replyingIdsRef.current.has(f.id))
          const merged = new Map(nextForms.map(f => [f.id, f]))
          for (const f of prev) {
            if (replyingIdsRef.current.has(f.id)) continue
            if (!merged.has(f.id)) merged.set(f.id, f)
          }
          return Array.from(merged.values())
        })
      } catch (error) {
        permissionErrorHandler('refresh pending requests', error)
      }
    },
    [serverId],
  )

  const resetPendingRequests = useCallback(() => {
    setPendingPermissionRequests([])
    setPendingForms([])
    replyingIdsRef.current.clear()
  }, [])

  return {
    pendingPermissionRequests,
    pendingForms,
    setPendingPermissionRequests,
    setPendingForms,
    handlePermissionReply,
    handleFormReply,
    handleFormCancel,
    refreshPendingRequests,
    resetPendingRequests,
    isReplying,
  }
}
