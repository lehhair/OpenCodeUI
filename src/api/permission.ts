// ============================================
// Permission & Question API Functions
// 基于 @opencode-ai/sdk: /permission, /question 相关接口
// ============================================

import { getSDKClient, unwrap } from './sdk'
import { formatPathForApi } from '../utils/directoryUtils'
import type { ApiPermissionRequest, PermissionReply, ApiQuestionRequest, QuestionAnswer } from './types'

// ============================================
// Permission API
// ============================================

/**
 * 获取待处理的权限请求列表
 */
export async function getPendingPermissions(sessionId?: string, directory?: string): Promise<ApiPermissionRequest[]> {
  const sdk = getSDKClient()
  const permissions = unwrap(await sdk.permission.list({ directory: formatPathForApi(directory) }))
  return sessionId ? permissions.filter((p: ApiPermissionRequest) => p.sessionID === sessionId) : permissions
}

/**
 * 回复权限请求
 */
export async function replyPermission(
  requestId: string,
  reply: PermissionReply,
  message?: string,
  directory?: string,
  sessionId?: string,
): Promise<boolean> {
  const sdk = getSDKClient()

  if (sessionId) {
    unwrap(
      await sdk.permission.respond({
        sessionID: sessionId,
        permissionID: requestId,
        directory: formatPathForApi(directory),
        response: reply,
      }),
    )
    return true
  }

  unwrap(
    await sdk.permission.reply({
      requestID: requestId,
      directory: formatPathForApi(directory),
      reply,
      message,
    }),
  )
  return true
}

// ============================================
// Question API
// ============================================

/**
 * 获取待处理的问题请求列表
 */
export async function getPendingQuestions(sessionId?: string, directory?: string): Promise<ApiQuestionRequest[]> {
  const sdk = getSDKClient()
  const questions = unwrap(await sdk.question.list({ directory: formatPathForApi(directory) }))
  return sessionId ? questions.filter((q: ApiQuestionRequest) => q.sessionID === sessionId) : questions
}

/**
 * 回复问题请求
 */
export async function replyQuestion(
  requestId: string,
  answers: QuestionAnswer[],
  directory?: string,
): Promise<boolean> {
  const sdk = getSDKClient()
  unwrap(
    await sdk.question.reply({
      requestID: requestId,
      directory: formatPathForApi(directory),
      answers,
    }),
  )
  return true
}

/**
 * 拒绝问题请求
 */
export async function rejectQuestion(requestId: string, directory?: string): Promise<boolean> {
  const sdk = getSDKClient()
  unwrap(
    await sdk.question.reject({
      requestID: requestId,
      directory: formatPathForApi(directory),
    }),
  )
  return true
}
