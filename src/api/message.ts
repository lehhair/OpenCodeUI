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
import type { SessionMessage, UserMessage } from './types'
import type { Attachment, RevertedMessage, SendMessageParams } from './types'

// ============================================
// 消息查询
// ============================================

/**
 * 获取会话消息列表。
 *
 * v2 的 `message.list` 默认 **新的在前**（倒序分页，cursor 往历史深处翻），
 * 而本应用的 messageStore / 渲染层一律按时间正序（旧→新）组织。
 * 官方做法相同：`order: "desc"` 拉回来后 `toReversed()`
 *（packages/client/src/solid/data.ts:1625-1630）。
 * 因此这里统一在出口反转，所有调用点拿到的都是正序。
 */
export async function getSessionMessages(
  sessionId: string,
  limit?: number,
  _directory?: string,
  serverId?: string,
): Promise<SessionMessage[]> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  const result = await sdk.message.list({ sessionID: target.sessionId, limit, order: 'desc' })
  return [...result.data].reverse()
}

// ============================================
// 用户消息内容提取
// ============================================

/**
 * 从 v2 用户消息中提取纯文本与附件。
 *
 * v2 的用户消息自带 `text` 与 `files` / `agents` / `skills` 数组，
 * 不再需要遍历 parts。
 *
 * 注意入参与出参的文件形状不同：
 *   - prompt **入参** 的 files 是 `{ uri, name?, description? }`
 *   - 消息**记录**里的 files 是 `PromptFileAttachment`
 *     （`{ data, mime, source, name?, description? }`，没有 uri）
 * 这里处理的是消息记录，因此路径要从 `source` 取。
 */
export function extractUserMessageContent(message: UserMessage): RevertedMessage {
  const attachments: Attachment[] = []

  for (const file of message.files ?? []) {
    const source = file.source
    const uri = source?.type === 'uri' ? source.uri : ''
    const displayName = file.name || uri || file.mime || 'attachment'
    attachments.push({
      id: crypto.randomUUID(),
      type: 'file',
      displayName,
      // inline 附件没有可回填的路径，只在有 uri 时带上
      url: uri,
      relativePath: uri || displayName,
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
  id?: string
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
    // 客户端铸造的 id：服务端原样采用，乐观行与 durable 行同 id 对账
    ...(params.id ? { id: params.id } : {}),
    text: params.text,
    // 投递方式：busy 时 'queue' 排队（服务端排空后自动投递）或 'steer'
    // 插队注入当前回合；idle 时不传走服务端默认（steer）
    //（官方 packages/core/src/session/prompt.ts:50 默认 steer）
    ...(params.delivery ? { delivery: params.delivery } : {}),
    ...(files.length > 0 ? { files } : {}),
    ...(agents.length > 0 ? { agents } : {}),
  }
}

/**
 * 发送消息（入队）。
 *
 * v2 的 prompt 是入队语义：立即返回入队项，助手输出经事件流到达。
 * 因此 v1 的 sendMessage / sendMessageAsync 在 v2 合并为同一个调用。
 *
 * **模型 / agent 必须在发送前单独切换**：v2 的 `SessionPromptInput` 里
 * 根本没有 model / agent / variant 字段（与 v1 的 per-prompt model 不同），
 * 它们只能通过 `session.switchModel` / `session.switchAgent` 生效。
 * 之前这里把 params 里的 model/agent 直接丢掉 → 会话中途切换模型/agent
 * 完全不起作用（新建会话不受影响，因为 create 已带上这两个字段）。
 */
export async function sendMessage(params: SendMessageParams, serverId?: string): Promise<void> {
  const target = resolveSessionTarget(params.sessionId, serverId)
  const sdk = getSDKClient(target.serverId)

  if (params.model) {
    await sdk.session.switchModel({
      sessionID: target.sessionId,
      // 注意字段名不同：prompt 侧叫 modelID，switch 侧叫 id
      model: {
        id: params.model.modelID,
        providerID: params.model.providerID,
        ...(params.variant ? { variant: params.variant } : {}),
      },
    })
  }

  if (params.agent) {
    await sdk.session.switchAgent({ sessionID: target.sessionId, agent: params.agent })
  }

  await sdk.session.prompt(buildPromptInput(params, target.sessionId))
}

/**
 * 异步发送消息 —— v2 中与 sendMessage 等价（prompt 本身即入队）。
 * 保留导出以兼容旧调用点。
 */
export const sendMessageAsync = sendMessage
