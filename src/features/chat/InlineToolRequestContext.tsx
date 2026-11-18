/**
 * InlineToolRequestContext
 *
 * 把待处理的权限请求和表单请求注入到消息流里，
 * 让工具视图可以在对应位置直接渲染内嵌交互。
 * 对于 task 类型的 tool，还支持匹配子 session 内部的请求。
 *
 * ## v2 变化
 *
 *   - 权限请求不再有 `tool: { messageID, callID }`，改为
 *     `source: { type: 'tool', messageID, id }`，其中 `id` 就是工具调用 id。
 *   - v1 的「提问（question）」换成「表单（form）」。FormInfo 上没有类型化的
 *     工具来源字段，只能在 `metadata` 里约定（见 FORM_TOOL_ID_KEYS）；
 *     匹配不到时回退到 session 归属匹配。
 */

import { createContext, useContext } from 'react'
import type { ApiPermissionRequest, ApiFormInfo, PermissionReply, FormAnswer } from '../../api'
import type { SessionMessageInfo } from '../../types/api/message'
import { childSessionStore } from '../../store'
import { makeSessionKey, splitSessionKey } from '../../utils/sessionKey'
import { resolveTaskChildSessionRef } from '../../utils/taskChildBinding'

/**
 * task 工具匹配子 session 请求时的定位信息。
 * sessionKey 取自工具 metadata，可能是原始 id；serverId 是 pane 绑定的服务器（权威值），
 * 绝不能从「全局活动服务器」猜测——多服务器 / WSL 场景下两者不同，孙 session 会永远匹配不上。
 */
export interface TaskChildSessionRef {
  sessionKey: string
  serverId: string
}

export interface InlineToolRequestContextValue {
  /** 当前 pane 绑定的服务器，供 task 工具解析子 session 的服务器作用域 key */
  serverId: string
  /** 当前 pending 的权限请求 */
  pendingPermissions: ApiPermissionRequest[]
  /** 当前 pending 的表单请求（v2 的 form 取代了 v1 的 question） */
  pendingQuestions: ApiFormInfo[]
  /** 回复权限 */
  onPermissionReply: (requestId: string, reply: PermissionReply) => void
  /** 提交表单答案 */
  onFormReply: (form: ApiFormInfo, answer: FormAnswer) => void
  /** 取消表单 */
  onFormCancel: (form: ApiFormInfo) => void
  /** 是否正在发送回复 */
  isReplying: boolean
}

const defaultValue: InlineToolRequestContextValue = {
  // 没有 Provider 就没有 pane 绑定，空串表示「无权威服务器」，不做任何猜测
  serverId: '',
  pendingPermissions: [],
  pendingQuestions: [],
  onPermissionReply: () => {},
  onFormReply: () => {},
  onFormCancel: () => {},
  isReplying: false,
}

export const InlineToolRequestContext = createContext<InlineToolRequestContextValue>(defaultValue)

export function useInlineToolRequests() {
  return useContext(InlineToolRequestContext)
}

/**
 * 从表单 metadata 里取工具调用 id。
 *
 * v2 的 FormInfo 没有类型化的来源字段，但 question 工具会把来源放在
 * `metadata.tool = { messageID, id }`
 *（packages/core/src/tool/plugin/question.ts:78-81）；
 * 其余渠道按几个常见扁平键名探测；取不到就返回 undefined，由调用方回退到
 * session 归属匹配。
 */
const FORM_TOOL_ID_KEYS = ['callID', 'toolCallID', 'toolCallId', 'toolID', 'toolId', 'id'] as const

function formToolCallId(form: ApiFormInfo): string | undefined {
  const metadata = form.metadata as Record<string, unknown> | undefined
  if (!metadata) return undefined
  // question 工具的来源对象（v2 服务端实际写入的形状）
  const tool = metadata.tool as Record<string, unknown> | undefined
  if (tool && typeof tool.id === 'string' && tool.id) return tool.id
  for (const key of FORM_TOOL_ID_KEYS) {
    const value = metadata[key]
    if (typeof value === 'string' && value) return value
  }
  return undefined
}

/**
 * 构造「sessionID 是否属于 child 子树」的判定器。
 *
 * 复合 key 以调用方传入的权威 serverId 合成：对原始 id 做 splitSessionKey 会回退到
 * 全局活动服务器，pane 绑定其他服务器时（多服务器 / WSL）孙 session 永远匹配不上。
 * 消息 metadata 里的 sessionId 是原始 id，pending 请求的 sessionID 可能是复合 key（SSE）
 * 或原始 id（轮询）：统一按原始 id 比较，isChildOf 需要复合 key（childSessionStore 存复合）。
 */
function childSessionMatcher(child: TaskChildSessionRef): (sid: string) => boolean {
  const childScoped = child.sessionKey.includes('::')
    ? child.sessionKey
    : makeSessionKey(child.serverId, child.sessionKey)
  const { serverId: childServerId, sessionId: childRawId } = splitSessionKey(childScoped)
  return (sid: string) => {
    const { sessionId: raw } = splitSessionKey(sid)
    if (raw === childRawId) return true
    const scoped = sid.includes('::') ? sid : makeSessionKey(childServerId, raw)
    return childSessionStore.isChildOf(scoped, childScoped)
  }
}

/**
 * 根据 callID 查找关联的权限请求。
 *
 * v2 用 `source.id` 关联工具调用；对 task tool 额外传入 child，
 * 匹配子 session（及其子孙）内部发出的权限请求。
 */
export function findPermissionRequestForTool(
  pendingPermissions: ApiPermissionRequest[],
  callID: string,
  child?: TaskChildSessionRef,
): ApiPermissionRequest | undefined {
  // 先按工具调用 id 精确匹配（v2 的 source.id 即 callID）
  const direct = pendingPermissions.find(p => p.source?.type === 'tool' && p.source.id === callID)
  if (direct) return direct

  // 对 task tool，按子 session 归属匹配
  if (child) {
    const isMatch = childSessionMatcher(child)
    return pendingPermissions.find(p => isMatch(p.sessionID))
  }

  return undefined
}

/**
 * 根据 callID 查找关联的表单请求。
 * 对于 task tool，额外传入 child（子 session key + pane 绑定的权威服务器）。
 */
export function findQuestionRequestForTool(
  pendingQuestions: ApiFormInfo[],
  callID: string,
  child?: TaskChildSessionRef,
): ApiFormInfo | undefined {
  const direct = pendingQuestions.find(form => formToolCallId(form) === callID)
  if (direct) return direct

  if (child) {
    const isMatch = childSessionMatcher(child)
    return pendingQuestions.find(form => isMatch(form.sessionID))
  }

  return undefined
}

/**
 * 把 pending 请求分成「有工具卡片认领」和「无人认领」两组。
 *
 * inlineToolRequests 开启时卡片只渲染能匹配上的请求；无人认领的（典型：
 * 刷新后运行中的子代理权限——progress 不落库导致 metadata.sessionID 丢失，
 * 或 OMO 后台子代理本就没有可见卡片）必须退回会话级弹窗，
 * 否则请求彻底不可见、会话假死。官方同款语义：权限 dock 按 sessionID
 * 子树收集，与工具卡片无关（app/session/requests/session-request-tree.ts）。
 *
 * rootSessionKey 提供时，未认领组只保留当前 session family 的请求——
 * 别的会话的 pending 不该弹在这个 pane 上。
 */
const EMPTY_UNCLAIMED = {
  permissions: [] as ApiPermissionRequest[],
  questions: [] as ApiFormInfo[],
}

export function partitionUnclaimedRequests(
  messages: SessionMessageInfo[],
  pendingPermissions: ApiPermissionRequest[],
  pendingQuestions: ApiFormInfo[],
  serverId: string,
  rootSessionKey?: string,
): { permissions: ApiPermissionRequest[]; questions: ApiFormInfo[] } {
  // 没有待处理请求时不必扫全部消息与工具内容（流式每帧都会走到这里）
  if (pendingPermissions.length === 0 && pendingQuestions.length === 0) return EMPTY_UNCLAIMED

  const claimedPermissions = new Set<string>()
  const claimedQuestions = new Set<string>()

  for (const message of messages) {
    if (message.type !== 'assistant') continue
    for (const content of message.content) {
      if (content.type !== 'tool') continue
      const child = resolveTaskChildSessionRef(content, serverId)
      const isChildMatch = child ? childSessionMatcher(child) : undefined
      for (const request of pendingPermissions) {
        if (claimedPermissions.has(request.id)) continue
        if (request.source?.type === 'tool' && request.source.id === content.id) {
          claimedPermissions.add(request.id)
        } else if (isChildMatch?.(request.sessionID)) {
          claimedPermissions.add(request.id)
        }
      }
      for (const form of pendingQuestions) {
        if (claimedQuestions.has(form.id)) continue
        if (formToolCallId(form) === content.id) {
          claimedQuestions.add(form.id)
        } else if (isChildMatch?.(form.sessionID)) {
          claimedQuestions.add(form.id)
        }
      }
    }
  }

  // family 过滤：复合/原始 id 统一按原始 id 比
  const inFamily = (() => {
    if (!rootSessionKey) return () => false
    const familyRaw = new Set(
      childSessionStore.getSessionAndDescendants(rootSessionKey).map(key => splitSessionKey(key).sessionId),
    )
    return (sid: string) => familyRaw.has(splitSessionKey(sid).sessionId)
  })()

  return {
    permissions: pendingPermissions.filter(p => !claimedPermissions.has(p.id) && inFamily(p.sessionID)),
    questions: pendingQuestions.filter(q => !claimedQuestions.has(q.id) && inFamily(q.sessionID)),
  }
}
