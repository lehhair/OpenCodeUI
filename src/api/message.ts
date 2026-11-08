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
import type { JsonValue } from '@opencode/client/promise'
import { resolveSessionTarget } from '../utils/sessionKey'
import { absolutePathToFileUrl, fileBaseName } from '../utils/pathUtils'
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
/**
 * 单条消息回读（官方 data.ts:677-683 同款）。
 *
 * model.selected 事件先合成一行 model-switched 乐观消息，随后用
 * message.get 把服务端的 durable 行拉回替换（补全字段/对账）。
 */
export async function getSessionMessage(
  sessionId: string,
  messageId: string,
  serverId?: string,
): Promise<SessionMessage | undefined> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  const result = await sdk.session.message.get({ sessionID: target.sessionId, messageID: messageId })
  return result
}

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

/**
 * 按游标翻一页历史（官方 message.loadMore 的数据通道，data.ts:1684-1709）。
 *
 * v2 的 `message.list` 响应带 `cursor.next`：传回即可拿到更老的一页，
 * 不需要像「递增 limit 从头重拉」那样重复传输已加载的消息。
 * 返回的 messages 同样是正序（旧→新）；nextCursor 为 null 表示没有更早的历史。
 */
export async function getSessionMessagesPage(
  sessionId: string,
  options?: { limit?: number; cursor?: string },
  serverId?: string,
): Promise<{ messages: SessionMessage[]; nextCursor: string | null }> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  const result = await sdk.message.list({
    sessionID: target.sessionId,
    limit: options?.limit,
    // 游标自带 order/direction（服务端 cursor JSON 内含）——同传 order
    // 会吃 InvalidCursorError(400)，官方 data.ts loadMore 同款：
    // 首页 limit+order，翻页只带 limit+cursor
    ...(options?.cursor ? { cursor: options.cursor } : { order: 'desc' as const }),
  })
  return {
    messages: [...result.data].reverse(),
    nextCursor: result.cursor.next ?? null,
  }
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
  const seenPaths = new Set<string>()

  for (const file of message.files ?? []) {
    const source = file.source
    const uri = source?.type === 'uri' ? source.uri : ''
    // inline 附件（图片/pdf 等原生媒体）的字节在 data 里，回填成 data URL
    // 才能再次发送；之前 url 为空，回退/重发时附件会静默丢失。
    const inlineUrl = uri ? '' : file.data ? `data:${file.mime};base64,${file.data}` : ''
    const url = uri || inlineUrl
    const displayName = file.name || uri || file.mime || 'attachment'
    if (url) seenPaths.add(url)
    attachments.push({
      id: crypto.randomUUID(),
      type: file.mime === 'application/x-directory' ? 'folder' : 'file',
      displayName,
      url,
      mime: file.mime,
      relativePath: uri || displayName,
      // @ 提及的文件回填 mention 区间：再次发送时仍走 files[] + mention，
      // 不会被当成普通路径附件重复注入一条 Attached file 文本（官方 promptFromMessage 同款）。
      ...(file.mention
        ? {
            textRange: {
              value: file.mention.text,
              start: file.mention.start,
              end: file.mention.end,
            },
          }
        : {}),
    })
  }

  // 只作路径引用的附件（二进制 / 超 20MB / 拖入的本机文件）不在 message.files 里，
  // 只能从 metadata.attachments 还原——否则回填后模型拿不到这个文件。
  for (const reference of readPromptAttachments(message.metadata)) {
    const url = absolutePathToFileUrl(reference.path)
    if (seenPaths.has(url)) continue
    seenPaths.add(url)

    attachments.push({
      id: crypto.randomUUID(),
      type: reference.mime === 'application/x-directory' ? 'folder' : 'file',
      displayName: reference.name,
      url,
      mime: reference.mime,
      relativePath: reference.path,
      pathOnly: true,
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

  // 回填用户原始输入（不含我们追加的路径引用行）：再次发送时由
  // applyAttachmentReferences 依据附件重新生成，不会丢也不会重复。
  const metadata = message.metadata as Record<string, unknown> | undefined
  const displayText = metadata?.['displayText']
  const text = typeof displayText === 'string' ? displayText : message.text ?? ''

  return { text, attachments }
}

// ============================================
// 发送消息
// ============================================

/**
 * 附件 → prompt 的 files/agents/skills 部件（buildPromptInput 的组装段，
 * 队列编辑确认（editedPromptInput）与正常发送共用）。
 */
export function buildPromptParts(
  attachments: Attachment[],
  text?: string,
): {
  files: Array<{ uri: string; name?: string; mention?: { start: number; end: number; text: string } }>
  agents: Array<{ name: string; mention?: { start: number; end: number; text: string } }>
  skills: Array<{ id: string; mention?: { start: number; end: number; text: string } }>
} {
  const files: Array<{ uri: string; name?: string; mention?: { start: number; end: number; text: string } }> = []
  const agents: Array<{ name: string; mention?: { start: number; end: number; text: string } }> = []
  const skills: Array<{ id: string; mention?: { start: number; end: number; text: string } }> = []

  /**
   * 解析 mention 区间。
   *
   * textarea 的 textRange 是插入时记下的静态偏移，用户在提及前面改过字就会过期。
   * 位置仍然对得上时沿用原区间（能区分重复出现的同名提及）；对不上就按
   * 当前文本重新定位。官方编辑器的区间是实时维护的，这里用等价的后处理兜住。
   */
  const mention = (attachment: Attachment) => {
    const range = attachment.textRange
    if (!range) return undefined
    if (!text) return { start: range.start, end: range.end, text: range.value }
    if (text.slice(range.start, range.end) === range.value) {
      return { start: range.start, end: range.end, text: range.value }
    }
    const index = text.indexOf(range.value)
    if (index < 0) return undefined
    return { start: index, end: index + range.value.length, text: range.value }
  }

  for (const attachment of attachments) {
    if (attachment.type === 'agent') {
      agents.push({
        name: attachment.agentName || attachment.displayName,
        ...(mention(attachment) ? { mention: mention(attachment) } : {}),
      })
      continue
    }

    if (attachment.type === 'skill') {
      // skill 提及（官方 request.ts:68-72）：目前输入端尚未提供 skill 附件入口，
      // 载荷先对齐官方形状，入口落地后即通
      const id = attachment.skillId || attachment.displayName
      if (id) skills.push({ id, ...(mention(attachment) ? { mention: mention(attachment) } : {}) })
      continue
    }

    // 超过服务端 20MB 附件上限的文件只走路径引用（见 buildAttachmentReferences），
    // 放进 files[] 会让整条 prompt 以 AttachmentError 失败。
    if (attachment.pathOnly) continue

    const uri = attachment.url || ''
    if (!uri) {
      console.warn('Skipping attachment with empty URL:', attachment)
      continue
    }
    files.push({
      uri,
      name: attachment.displayName,
      ...(mention(attachment) ? { mention: mention(attachment) } : {}),
    })
  }

  return { files, agents, skills }
}

// ============================================
// 路径引用（Issue #182）
//
// 服务端 materialize 附件时只做两件事：按 uri 读字节、嗅探 mime。
// 转到 LLM 时**只有 text/plain 与 image/pdf 会进上下文**，其余 mime
// （zip / docx / 二进制 → application/octet-stream）被整段丢弃——模型
// 连路径都看不到。官方因此在 prompt 文本里补一行路径引用
// （packages/app/src/composer/request.ts:173-182、comment-note.ts:52-54）：
//
//     Attached file: `<绝对路径>`
//
// 同时把 `{name, mime, path}` 写进 `metadata.attachments` 供 UI 还原。
// 本项目照抄这一形状（queue.ts 的 queuedPromptAttachments 已经在按它读）。
// ============================================

/**
 * 路径引用（写进 `metadata.attachments`，形状对齐官方 request.ts:189 的 attachments）。
 *
 * 交叉一个 `JsonValue` 索引签名，才能直接放进 `metadata: Record<string, JsonValue>`。
 */
export type PromptAttachmentReference = {
  name: string
  mime: string
  path: string
} & { [key: string]: JsonValue }

const ATTACHMENT_REFERENCE_PREFIX = 'Attached file: '
const ATTACHMENT_REFERENCE_LINE = /^Attached file: `(.+)`$/gm

/** 路径比较用归一化：分隔符与首尾空白 */
function normalizeReferencePath(path: string): string {
  return path.replace(/\\/g, '/').trim()
}

/** `file://` URL → 绝对路径（反向于 features/mention 的 toFileUrl） */
export function fileUrlToAbsolutePath(url: string): string | undefined {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'file:') return undefined
    const decoded = decodeURIComponent(parsed.pathname)
    // Windows 盘符：/C:/dir/file → C:/dir/file
    return /^\/[A-Za-z]:\//.test(decoded) ? decoded.slice(1) : decoded
  } catch {
    return undefined
  }
}

/**
 * 从消息 metadata 里读路径引用。
 *
 * 这些附件不进 `files[]`（二进制 / 超 20MB / 拖入的本机文件），模型看到的是
 * prompt 文本里的 `Attached file:` 行；用户消息气泡靠这份数据还原胶囊。
 * 之前只有 revert 回填在读它，气泡完全没渲染。
 */
export function readPromptAttachments(metadata: unknown): PromptAttachmentReference[] {
  const record = metadata as Record<string, unknown> | undefined
  const raw = record?.['attachments']
  if (!Array.isArray(raw)) return []

  const result: PromptAttachmentReference[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const { name, mime, path } = item as { name?: unknown; mime?: unknown; path?: unknown }
    if (typeof path !== 'string' || !path) continue
    result.push({
      name: typeof name === 'string' && name ? name : fileBaseName(path),
      mime: typeof mime === 'string' && mime ? mime : 'text/plain',
      path,
    })
  }
  return result
}

/**
 * 路径型附件：`file://` 引用。
 *
 * pathOnly 附件不会进 `prompt.files[]`，文本是模型看到它的唯一途径。
 * 官方对 path 部件**无条件**补一行绝对路径，即使正文里已经有 `@path`
 *（`@` 是相对路径，模型不一定知道绝对位置）。
 *
 * 非 pathOnly 的附件走 `files[]`，路径已经随 attachment 交给服务端，
 * 不再补行（官方 FileAttachmentPart 同款）。
 */
export function isPathReferenceAttachment(attachment: Attachment, text?: string): boolean {
  if (attachment.type !== 'file' && attachment.type !== 'folder') return false
  if (attachment.pathOnly) return true
  if (attachment.textRange) {
    return text !== undefined && !text.includes(attachment.textRange.value)
  }
  return Boolean(attachment.url?.startsWith('file://'))
}

/** 附件的服务端/本机绝对路径 */
export function attachmentReferencePath(attachment: Attachment): string | undefined {
  if (attachment.url?.startsWith('file://')) return fileUrlToAbsolutePath(attachment.url)
  return attachment.relativePath || undefined
}

/** 收集路径引用（去重、保序） */
export function buildAttachmentReferences(
  attachments: Attachment[],
  text?: string,
): PromptAttachmentReference[] {
  const references: PromptAttachmentReference[] = []

  for (const attachment of attachments) {
    if (!isPathReferenceAttachment(attachment, text)) continue
    const path = attachmentReferencePath(attachment)
    if (!path) continue

    references.push({
      name: attachment.displayName,
      mime: attachment.mime ?? 'text/plain',
      path,
    })
  }

  return dedupeAttachmentReferences(references)
}

/** 按归一化路径去重（保序、保留首次出现的 name/mime） */
export function dedupeAttachmentReferences(
  references: PromptAttachmentReference[],
): PromptAttachmentReference[] {
  const result: PromptAttachmentReference[] = []
  const seen = new Set<string>()

  for (const reference of references) {
    const key = normalizeReferencePath(reference.path)
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(reference)
  }

  return result
}

/** 从文本里解析已存在的路径引用（用于 revert 重发时去重） */
export function parseAttachmentReferencePaths(text: string): string[] {
  const paths: string[] = []
  ATTACHMENT_REFERENCE_LINE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = ATTACHMENT_REFERENCE_LINE.exec(text)) !== null) {
    if (match[1]) paths.push(match[1])
  }
  return paths
}

/**
 * 把路径引用追加到 prompt 文本末尾。
 *
 * 追加在**末尾**：文本中已有的 `@` mention 区间（mention.start/end）
 * 因此不受影响。已经出现过的同路径引用会被跳过（revert / 队列编辑回填
 * 会把上次追加的行带回文本）。
 */
export function applyAttachmentReferences(text: string, references: PromptAttachmentReference[]): string {
  if (references.length === 0) return text

  const existing = new Set(parseAttachmentReferencePaths(text).map(normalizeReferencePath))
  const lines = references
    .filter(reference => !existing.has(normalizeReferencePath(reference.path)))
    .map(reference => `${ATTACHMENT_REFERENCE_PREFIX}\`${reference.path}\``)

  if (lines.length === 0) return text

  const separator = text.length === 0 || text.endsWith('\n') ? '' : '\n'
  return `${text}${separator}${lines.join('\n')}`
}

/**
 * 构建 v2 的 prompt 入参（官方 composer/request.ts + submit.ts:395-411 同款）。
 *
 * v2 的形状是 `{ text, files?, agents?, skills?, metadata }`：
 *   - 文本走 `text`；`metadata.displayText` 记录用户原始输入（服务端与
 *     转写展示都优先它，官方 message-timeline.tsx:295-303）
 *   - 文件附件走 `files[].uri`；agent 提及走 `agents[].name`；两者都带
 *     `mention` 区间（@提及在文本中的对齐信息，官方 request.ts:71-86）
 *   - `metadata.agent/model` 记录发送时的选择快照——queue 条目投递时
 *     服务端按它生效（ steer 才在发送前 switch，见 sendMessage）
 */
function buildPromptInput(
  params: SendMessageParams,
  sessionID: string,
): {
  sessionID: string
  id?: string
  text: string
  files?: Array<{ uri: string; name?: string; mention?: { start: number; end: number; text: string } }>
  agents?: Array<{ name: string; mention?: { start: number; end: number; text: string } }>
  skills?: Array<{ id: string; mention?: { start: number; end: number; text: string } }>
  metadata?: Record<string, JsonValue>
} {
  const { files, agents, skills } = buildPromptParts(params.attachments, params.text)
  // 路径型附件额外把绝对路径写进文本（官方 request.ts:173-182 同款）：
  // files[].uri 只让服务端读到字节，模型能否看到取决于 mime（见文件顶部说明）。
  const attachmentReferences = buildAttachmentReferences(params.attachments, params.text)

  return {
    sessionID,
    // 客户端铸造的 id：服务端原样采用，乐观行与 durable 行同 id 对账
    ...(params.id ? { id: params.id } : {}),
    text: applyAttachmentReferences(params.text, attachmentReferences),
    // 投递方式：busy 时 'queue' 排队（服务端排空后自动投递）或 'steer'
    // 插队注入当前回合；idle 时不传走服务端默认（steer）
    //（官方 packages/core/src/session/prompt.ts:50 默认 steer）
    ...(params.delivery ? { delivery: params.delivery } : {}),
    ...(files.length > 0 ? { files } : {}),
    ...(agents.length > 0 ? { agents } : {}),
    ...(skills.length > 0 ? { skills } : {}),
    // 选择快照 + 原始输入（官方 submit.ts:401-410 同款）
    metadata: {
      displayText: params.text,
      ...(attachmentReferences.length > 0 ? { attachments: attachmentReferences } : {}),
      ...(params.agent ? { agent: params.agent } : {}),
      ...(params.model
        ? {
            model: {
              providerID: params.model.providerID,
              modelID: params.model.modelID,
              ...(params.variant ? { variant: params.variant } : {}),
            },
          }
        : {}),
    },
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

  // 模型/agent 的应用时机（官方 submit.ts:384-410）：只有 steer（含 idle 默认）
  // 才在发送前切换——那会重配**当前正在运行的回合**。queue 条目不该碰当前
  // 回合，其选择记入 metadata、投递时才生效。
  const appliesImmediately = params.delivery !== 'queue'

  if (params.model && appliesImmediately) {
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

  if (params.agent && appliesImmediately) {
    await sdk.session.switchAgent({ sessionID: target.sessionId, agent: params.agent })
  }

  await sdk.session.prompt(buildPromptInput(params, target.sessionId))
}

/**
 * 异步发送消息 —— v2 中与 sendMessage 等价（prompt 本身即入队）。
 * 保留导出以兼容旧调用点。
 */
export const sendMessageAsync = sendMessage
