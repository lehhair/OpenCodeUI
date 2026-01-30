// ============================================
// Permission & Question API Functions
// 基于 OpenAPI: /permission, /question 相关接口
// ============================================

import { get, post } from './http'
import { formatPathForApi } from '../utils/directoryUtils'
import type {
  ApiPermissionRequest,
  PermissionReply,
  ApiQuestionRequest,
  QuestionAnswer,
} from './types'

// ============================================
// Permission API
// ============================================

/**
 * GET /permission - 获取待处理的权限请求列表
 * directory 会根据 pathMode 自动转换格式
 */
export async function getPendingPermissions(
  sessionId?: string,
  directory?: string
): Promise<ApiPermissionRequest[]> {
  const permissions = await get<ApiPermissionRequest[]>('/permission', { 
    directory: formatPathForApi(directory) 
  })
  return sessionId 
    ? permissions.filter((p: ApiPermissionRequest) => p.sessionID === sessionId) 
    : permissions
}

/**
 * POST /permission/{requestID}/reply - 回复权限请求
 */
export async function replyPermission(
  requestId: string,
  reply: PermissionReply,
  message?: string,
  directory?: string
): Promise<boolean> {
  return post<boolean>(`/permission/${requestId}/reply`, { 
    directory: formatPathForApi(directory) 
  }, { reply, message })
}

// ============================================
// Question API
// ============================================

/**
 * GET /question - 获取待处理的问题请求列表
 * directory 会根据 pathMode 自动转换格式
 */
export async function getPendingQuestions(
  sessionId?: string,
  directory?: string
): Promise<ApiQuestionRequest[]> {
  const questions = await get<ApiQuestionRequest[]>('/question', { 
    directory: formatPathForApi(directory) 
  })
  return sessionId 
    ? questions.filter((q: ApiQuestionRequest) => q.sessionID === sessionId) 
    : questions
}

/**
 * POST /question/{requestID}/reply - 回复问题请求
 */
export async function replyQuestion(
  requestId: string,
  answers: QuestionAnswer[],
  directory?: string
): Promise<boolean> {
  return post<boolean>(`/question/${requestId}/reply`, { 
    directory: formatPathForApi(directory) 
  }, { answers })
}

/**
 * POST /question/{requestID}/reject - 拒绝问题请求
 */
export async function rejectQuestion(
  requestId: string,
  directory?: string
): Promise<boolean> {
  return post<boolean>(`/question/${requestId}/reject`, { 
    directory: formatPathForApi(directory) 
  })
}
