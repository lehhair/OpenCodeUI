// ============================================
// Session API Functions
// 基于 OpenAPI: /session 相关接口
// ============================================

import { get, post, patch, del } from './http'
import { formatPathForApi } from '../utils/directoryUtils'
import type { ApiSession, SessionListParams } from './types'

// ============================================
// Session CRUD
// ============================================

/**
 * GET /session - 获取 session 列表
 * directory 会根据 pathMode 自动转换格式
 */
export async function getSessions(params: SessionListParams = {}): Promise<ApiSession[]> {
  const { directory, roots, start, search, limit } = params
  return get<ApiSession[]>('/session', { 
    directory: formatPathForApi(directory), 
    roots, 
    start, 
    search, 
    limit 
  })
}

/**
 * GET /session/{sessionID} - 获取单个 session
 */
export async function getSession(sessionId: string, directory?: string): Promise<ApiSession> {
  return get<ApiSession>(`/session/${sessionId}`, { directory: formatPathForApi(directory) })
}

/**
 * POST /session - 创建 session
 */
export async function createSession(params: {
  directory?: string
  title?: string
  parentID?: string
} = {}): Promise<ApiSession> {
  const { directory, title, parentID } = params
  return post<ApiSession>('/session', { directory: formatPathForApi(directory) }, { title, parentID })
}

/**
 * PATCH /session/{sessionID} - 更新 session
 */
export async function updateSession(
  sessionId: string,
  params: { title?: string; time?: { archived?: number } },
  directory?: string
): Promise<ApiSession> {
  return patch<ApiSession>(`/session/${sessionId}`, { directory: formatPathForApi(directory) }, params)
}

/**
 * DELETE /session/{sessionID} - 删除 session
 */
export async function deleteSession(sessionId: string, directory?: string): Promise<boolean> {
  return del<boolean>(`/session/${sessionId}`, { directory: formatPathForApi(directory) })
}

// ============================================
// Session Actions
// ============================================

/**
 * POST /session/{sessionID}/abort - 中止 session
 */
export async function abortSession(sessionId: string, directory?: string): Promise<boolean> {
  return post<boolean>(`/session/${sessionId}/abort`, { directory: formatPathForApi(directory) })
}

/**
 * POST /session/{sessionID}/revert - 回退消息
 */
export async function revertMessage(
  sessionId: string,
  messageId: string,
  partId?: string,
  directory?: string
): Promise<ApiSession> {
  const body: { messageID: string; partID?: string } = { messageID: messageId }
  if (partId) {
    body.partID = partId
  }
  return post<ApiSession>(`/session/${sessionId}/revert`, { directory: formatPathForApi(directory) }, body)
}

/**
 * POST /session/{sessionID}/unrevert - 恢复已回退的消息
 */
export async function unrevertSession(sessionId: string, directory?: string): Promise<ApiSession> {
  return post<ApiSession>(`/session/${sessionId}/unrevert`, { directory: formatPathForApi(directory) })
}

/**
 * POST /session/{sessionID}/share - 分享 session
 */
export async function shareSession(sessionId: string, directory?: string): Promise<ApiSession> {
  return post<ApiSession>(`/session/${sessionId}/share`, { directory: formatPathForApi(directory) })
}

/**
 * DELETE /session/{sessionID}/share - 取消分享 session
 */
export async function unshareSession(sessionId: string, directory?: string): Promise<ApiSession> {
  return del<ApiSession>(`/session/${sessionId}/share`, { directory: formatPathForApi(directory) })
}

/**
 * POST /session/{sessionID}/fork - Fork session
 */
export async function forkSession(
  sessionId: string,
  messageId?: string,
  directory?: string
): Promise<ApiSession> {
  return post<ApiSession>(`/session/${sessionId}/fork`, { directory: formatPathForApi(directory) }, { messageID: messageId })
}

/**
 * POST /session/{sessionID}/summarize - 总结 session
 */
export async function summarizeSession(
  sessionId: string,
  params: { providerID: string; modelID: string; auto?: boolean },
  directory?: string
): Promise<boolean> {
  return post<boolean>(`/session/${sessionId}/summarize`, { directory: formatPathForApi(directory) }, params)
}

/**
 * GET /session/{sessionID}/children - 获取子 session
 */
export async function getSessionChildren(sessionId: string, directory?: string): Promise<ApiSession[]> {
  return get<ApiSession[]>(`/session/${sessionId}/children`, { directory: formatPathForApi(directory) })
}

/**
 * GET /session/{sessionID}/todo - 获取 session 的 todo 列表
 */
export interface ApiTodo {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  priority: 'high' | 'medium' | 'low'
}

export async function getSessionTodos(sessionId: string, directory?: string): Promise<ApiTodo[]> {
  return get<ApiTodo[]>(`/session/${sessionId}/todo`, { directory: formatPathForApi(directory) })
}
