// ============================================
// Queue API — 队列编辑与重排的底层机制
//
// 逐行移植官方 packages/app/src/session/composer/queue.ts 的两个机制：
//   1. rewrite：inbox API 没有重排端点，官方用「后缀重写」保序——
//      从第一个变化点开始，后缀条目按原 payload 重新 admit（新 id），
//      再 cancel 旧后缀。编辑确认与拖拽重排共用。
//   2. editedPromptInput：编辑确认时把「原条目中仍被引用的文件/agent/
//      skill 提及」与「编辑后的新请求」合并，保留 metadata 与
//      model 可见文本后缀（review notes）。
// ============================================

import { getSDKClient } from './sdk'
import { resolveSessionTarget } from '../utils/sessionKey'
import { cancelInboxItem } from './session'
import { createMessageId } from '../utils/identifier'
import type { QueuedUserPrompt } from '../store/inboxStore'
import type { Attachment } from './types'
import type { PromptMention, JsonValue } from '@opencode/client/promise'
import { queuedPromptText } from '../store/inboxStore'

/**
 * 队列保序重写（官方 queue.ts 的 rewrite 同款）。
 *
 * @param inboxIDs 期望的最终顺序（id 列表）；与原顺序相同则什么都不做
 */
export async function rewriteQueueOrder(sessionId: string, inboxIDs: string[], serverId?: string): Promise<void> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  const pending = await sdk.session.inbox.list({ sessionID: target.sessionId })
  // 队列里有非 user 的控制条目（compaction/move）时禁止重排（官方同款）
  if (pending.some(item => item.delivery === 'queue' && item.type !== 'user')) {
    throw new Error('Queued control items block reordering')
  }
  const current = pending.filter(
    (item): item is QueuedUserPrompt => item.type === 'user' && item.delivery === 'queue',
  )
  const ordered = inboxIDs.flatMap(id => current.filter(item => item.id === id))
  if (ordered.length !== current.length) {
    throw new Error('Queued prompts changed before reordering')
  }
  const changed = ordered.findIndex((item, index) => item.id !== current[index]?.id)
  if (changed < 0) return

  // 只重写变化的后缀：按原 payload 重新 admit（resume:false，与官方一致）
  for (const item of ordered.slice(changed)) {
    await sdk.session.prompt({
      sessionID: target.sessionId,
      text: item.payload.text,
      files: item.payload.files?.map(file => ({
        uri: `data:${file.mime};base64,${file.data}`,
        name: file.name,
        description: file.description,
        mention: file.mention,
      })),
      agents: item.payload.agents,
      skills: item.payload.skills,
      metadata: item.payload.metadata,
      delivery: 'queue',
      resume: false,
    })
  }
  for (const item of current.slice(changed)) {
    await cancelInboxItem(sessionId, item.id, serverId)
  }
}

/** 队列条目的 composer 附件（官方 queuedPromptAttachments 同款） */
export function queuedPromptAttachments(item: QueuedUserPrompt): Attachment[] {
  const inlineFiles = (item.payload.files ?? []).filter(
    file => !file.mention && file.source.type === 'inline',
  )
  const metadata = item.payload.metadata as Record<string, unknown> | undefined
  const pathRefs = Array.isArray(metadata?.attachments)
    ? (metadata.attachments as Array<{ name: string; mime: string; path: string }>)
    : []
  return [
    ...inlineFiles.map(file => ({
      id: crypto.randomUUID(),
      type: 'file' as const,
      displayName: file.name ?? 'attachment',
      url: `data:${file.mime};base64,${file.data}`,
      mime: file.mime,
    })),
    ...pathRefs.map(file => ({
      id: crypto.randomUUID(),
      type: 'file' as const,
      displayName: file.name,
      mime: file.mime,
      relativePath: file.path,
    })),
  ]
}

interface EditedPromptInput {
  sessionID: string
  id: string
  text: string
  delivery: 'queue' | 'steer'
  files?: Array<{ uri: string; name?: string; description?: string; mention?: PromptMention }>
  agents?: Array<{ name: string; mention?: PromptMention }>
  skills?: Array<{ id: string; mention?: PromptMention }>
  metadata?: Record<string, JsonValue>
  resume?: boolean
}

/**
 * 编辑确认的请求载荷（官方 editedPromptInput 同款）：
 * - 原 payload 中**非 composer 附件**（带 mention 的文件）全部保留，
 *   mention 区间按编辑后文本重新定位
 * - 原 agents/skills 仅当其 mention 文本仍出现在编辑后文本中时保留
 * - 编辑器的 files/agents/skills 追加在后
 * - metadata 保留原样，displayText/attachments 换成编辑后的
 * - model 可见文本的后缀（review notes）接回 text 尾部
 */
export function buildEditedPromptInput(params: {
  sessionId: string
  /** 编辑后的文本（composer 当前内容） */
  text: string
  /** 编辑器当前的附件（含 mention 区间） */
  attachments: Attachment[]
  /** 被编辑的原始队列条目 */
  original: QueuedUserPrompt
  delivery: 'queue' | 'steer'
  /** 编辑器组装的新请求（buildPromptInput 的 files/agents/skills 部分） */
  request: {
    files?: Array<{ uri: string; name?: string; mention?: PromptMention }>
    agents?: Array<{ name: string; mention?: PromptMention }>
    skills?: Array<{ id: string; mention?: PromptMention }>
  }
}): EditedPromptInput {
  const { original } = params
  const payload = original.payload
  const display = queuedPromptText(original)
  const notes = display && payload.text.startsWith(display) ? payload.text.slice(display.length) : ''

  const mention = (value: PromptMention | undefined): PromptMention | undefined => {
    if (!value) return undefined
    const start = params.text.indexOf(value.text)
    if (start < 0) return undefined
    return { text: value.text, start, end: start + value.text.length }
  }

  // 非 composer 附件（带 mention 或非 inline 的文件）全部保留
  const preservedFiles = (payload.files ?? [])
    .filter(file => file.mention || file.source.type !== 'inline')
    .map(file => ({
      uri: `data:${file.mime};base64,${file.data}`,
      name: file.name,
      description: file.description,
      mention: mention(file.mention),
    }))

  const requestAgents = params.request.agents ?? []
  const agents = [
    ...(payload.agents ?? []).filter(
      agent =>
        agent.mention && params.text.includes(agent.mention.text) && !requestAgents.some(entry => entry.name === agent.name),
    ),
    ...requestAgents,
  ]

  const requestSkills = params.request.skills ?? []
  const skills = [
    ...(payload.skills ?? []).filter(
      skill =>
        skill.mention && params.text.includes(skill.mention.text) && !requestSkills.some(entry => entry.id === skill.id),
    ),
    ...requestSkills,
  ]

  // 编辑器里的 path 附件（无 url 有 relativePath）回 metadata.attachments
  const pathAttachments = params.attachments
    .filter(attachment => attachment.type === 'file' && !attachment.url && attachment.relativePath)
    .map(attachment => ({
      name: attachment.displayName,
      mime: attachment.mime ?? 'text/plain',
      path: attachment.relativePath!,
    }))

  return {
    sessionID: params.sessionId,
    id: createMessageId(),
    text: params.text + notes,
    delivery: params.delivery,
    files: [...preservedFiles, ...(params.request.files ?? [])],
    agents: agents.map(agent => ({ name: agent.name, mention: mention(agent.mention) ?? agent.mention })),
    skills: skills.map(skill => ({ id: skill.id, mention: mention(skill.mention) ?? skill.mention })),
    metadata: {
      ...(payload.metadata as Record<string, unknown> | undefined),
      displayText: params.text,
      attachments: pathAttachments,
    },
    ...(params.delivery === 'queue' ? { resume: false } : {}),
  }
}

/**
 * 确认队列编辑（官方 edit mutation 同款）：
 * 先 admit 替换条目（新 id，失败不丢原条目）→ cancel 原条目 →
 * 若投递方式是 queue，用 rewrite 把替换条目放回原来的位置。
 *
 * @param queueIds 当前队列的 id 顺序（用于 rewrite 保序）
 */
export async function confirmQueueEdit(params: {
  sessionId: string
  original: QueuedUserPrompt
  edited: EditedPromptInput
  queueIds: string[]
  serverId?: string
}): Promise<string> {
  const target = resolveSessionTarget(params.sessionId, params.serverId)
  const sdk = getSDKClient(target.serverId)
  const { original, edited } = params
  const { sessionID: _omit, ...request } = edited
  void _omit
  // Admit before cancelling：替换失败绝不丢原条目（官方同款）
  const admitted = await sdk.session.prompt({ sessionID: target.sessionId, ...request })
  await cancelInboxItem(params.sessionId, original.id, params.serverId)
  if (edited.delivery === 'queue') {
    await rewriteQueueOrder(
      params.sessionId,
      params.queueIds.map(id => (id === original.id ? admitted.id : id)),
      params.serverId,
    )
  }
  // 返回替换条目的 id：队列投影用它判断 mutation 何时落地
  return admitted.id
}
