// ============================================
// Message Conversion — v2 → UI 视图模型
//
// UI 渲染层建立在 `{ info, parts }` 上；OpenCode v2 的消息自带内容
// （`type` + `content`），因此这里只做转发到 v2Projection 的工作，
// 让所有调用点继续拿到既有的 UI 模型。
//
// 注意：v2 的消息**不携带 sessionID**，所以投影必须显式传入所在会话。
// ============================================

import type { SessionMessage } from '../types/api'
import type { Message, MessageInfo, Part, UserMessageInfo } from '../types/message'
import { isUserMessage } from '../types/message'
import { toMessageInfo, toUIMessage as projectMessage } from './v2Projection'

/**
 * v2 消息 → UI Message
 *
 * @param apiMessage v2 消息
 * @param sessionId  所在会话（v2 消息不带 sessionID）
 */
export function toUIMessage(apiMessage: SessionMessage, sessionId: string): Message {
  return projectMessage(apiMessage, sessionId)
}

/**
 * v2 消息 → UI MessageInfo
 */
export function toUIMessageInfo(apiMessage: SessionMessage, sessionId: string): MessageInfo {
  return toMessageInfo(apiMessage, sessionId)
}

/**
 * v2 助手内容片段 → UI Part。
 *
 * v2 没有独立的 part 实体，内容片段需要 messageID 才能投影，
 * 因此该函数仅在已知 id 时使用；常规路径请用 toUIMessage。
 */
export function toUIPart(apiPart: Part): Part {
  return apiPart
}

export function isUserUIMessage(message: Message): message is Message & { info: UserMessageInfo } {
  return isUserMessage(message.info)
}
