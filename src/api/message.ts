// ============================================
// Message API — OpenCode v2 原生
//
// ## v1 → v2 关键差异
//
//   - 读取消息：v1 `session.messages()` → v2 `message.list()`
//     返回 `{ data, cursor }`，元素是**自带内容的完整消息**
//     （不再有独立的 parts 数组）。
//   - 发送消息：v1 `session.prompt({ parts: [...] })` 且另有 promptAsync；
//     v2 `session.prompt({ sessionID, text, files?, agents?, skills? })`
//     —— **入参是 text + 附件数组**，不是 parts 联合；
//     且 prompt 本身就是入队语义（等价于 v1 的 promptAsync），
//     响应是入队项（SessionInboxUser），不是助手回复。
//     助手输出通过事件流到达。
// ============================================

import { getSDKClient } from './sdk'
import { resolveSessionTarget } from '../utils/sessionKey'
import type { SessionMessage } from './types'
import type { Attachment, RevertedMessage, SendMessageParams } from './types'

// ============================================
// 消息查询
// ============================================

/**
 * 获取会话消息列表。
 *
 * v2 返回 `{ data, cursor }`；这里返回 `data`，调用点保持不变。
 */
export async function getSessionMessages(
  sessionId: string,
  limit?: number,
  _directory?: string,
  serverId?: string,
): Promise<SessionMessage[]> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  const result = await sdk.message.list({ sessionID: target.sessionId, limit })
  return result.data
}

// ============================================
// 用户消息内容提取
// ============================================

/**
 * 从 v2 用户消息中提取纯文本与附件。
 *
 * v2 的用户消息自带 `text` 与 `files` / `agents` / `skills` 数组，
 * 不再需要遍历 parts。
 */
export function extractUserMessageContent(message: {
  text?: string
  files?: Array<{ uri: string; name?: string; description?: string }>
  agents?: Array<{ name: string }>
  skills?: Array<{ id: string }>
}): RevertedMessage {
  const attachments: Attachment[] = []

  for (const file of message.files ?? []) {
    attachments.push({
      id: crypto.randomUUID(),
      type: 'file',
      displayName: file.name || file.uri,
      url: file.uri,
      relativePath: file.uri,
    })
  }

  for (const agent of message.agents ?? []) {
    attachments.push({
      id: crypto.randomUUID(),
      type: 'agent',
      displayName: agent.name,
      agentName: agent.name,
    })
  }

  return { text: message.text ?? '', attachments }
}

// ============================================
// 发送消息
// ============================================

/**
 * 构建 v2 的 prompt 入参。
 *
 * v2 的形状是 `{ text, files?, agents?, skills? }`：
 *   - 文本走 `text`
 *   - 文件附件走 `files[].uri`（不再是 file part 的 url + mime）
 *   - agent 提及走 `agents[].name`
 */
function buildPromptInput(
  params: SendMessageParams,
  sessionID: string,
): {
  sessionID: string
  text: string
  files?: Array<{ uri: string; name?: string; description?: string }>
  agents?: Array<{ name: string }>
} {
  const files: Array<{ uri: string; name?: string; description?: string }> = []
  const agents: Array<{ name: string }> = []

  for (const attachment of params.attachments) {
    if (attachment.type === 'agent') {
      agents.push({ name: attachment.agentName || attachment.displayName })
      continue
    }

    const uri = attachment.url || ''
    if (!uri) {
      console.warn('Skipping attachment with empty URL:', attachment)
      continue
    }
    files.push({
      uri,
      name: attachment.displayName,
      description: attachment.relativePath,
    })
  }

  return {
    sessionID,
    text: params.text,
    ...(files.length > 0 ? { files } : {}),
    ...(agents.length > 0 ? { agents } : {}),
  }
}

/**
 * 发送消息（入队）。
 *
 * v2 的 prompt 是入队语义：立即返回入队项，助手输出经事件流到达。
 * 因此 v1 的 sendMessage / sendMessageAsync 在 v2 合并为同一个调用。
 */
export async function sendMessage(params: SendMessageParams, serverId?: string): Promise<void> {
  const target = resolveSessionTarget(params.sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  await sdk.session.prompt(buildPromptInput(params, target.sessionId))
}

/**
 * 异步发送消息 —— v2 中与 sendMessage 等价（prompt 本身即入队）。
 * 保留导出以兼容旧调用点。
 */
export const sendMessageAsync = sendMessage
