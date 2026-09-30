// ============================================
// Message API Functions
// 基于 @opencode/client（OpenCode V2）
// ============================================
//
// 阶段 2a（读侧）已完成：
//   ✅ getSessionMessages —— 游标分页拉取历史消息
//   ✅ extractUserMessageContent —— 纯函数，改吃 UI 模型
//   ⛔ sendMessage / sendMessageAsync —— 发消息链路属**阶段 2b**，保持显式报错
//
// ── V2 消息端点（照 v2.0.19 源码 + openapi 核实）────────────────────────────
//
//   路径：`GET /api/session/{sessionID}/message`
//         ⚠️ **不是** `GET /api/message`。SDK 入口是**顶层** `client.message.list()`，
//            不是 `client.session.message.list()`（后者只有 `get` 单条）。
//   响应：`{ data: Session.Message.Info[], cursor: { previous, next } }`
//   参数：`limit`（1..200，默认 50）、`order`（asc|desc，默认 desc）、
//         `cursor`（不透明）、`type`（按类型过滤）
//
// ── 🔴 游标语义：方向是「相对于本次排序」，不是绝对时间方向 ──────────────────
//
// 源码依据（tag v2.0.19）：
//   packages/server/src/handlers/message.ts —— 游标是 base64url 的
//     `{ id, order, direction }`，`previous` 锚定**本页第一条**、`next` 锚定**本页最后一条**；
//   packages/core/src/session/store.ts `messages()` ——
//     `order = direction === 'previous' ? 反转(requestedOrder) : requestedOrder`
//     即 previous 会**把 SQL 排序翻过来**再取，最后把结果 reverse 回原排序。
//
// 推论（`order=desc`，即"新→旧"，也是服务端默认）：
//   - 首页 = 最新的 N 条，数组顺序是 新 → 旧；
//   - 跟着 **`cursor.next`** → 拿到**更旧**的一页（继续往时间上游走）；
//   - 跟着 **`cursor.previous`** → 拿到**更新**的一页。
//
// ⚠️ 因此「滚动到顶部加载更早的历史」用的是 **`cursor.next`**，不是 `previous`。
//    （迁移文档 §5.5 写的是「滚动到顶部时用 `cursor.previous` 向前加载」——
//      那句话在 `order=asc` 下才成立；本阶段实测修正见
//      docs/opencode-v2-migration.md §5.5 与阶段 2a 报告。）
//
// ── 三条硬约束 ────────────────────────────────────────────────────────────
//
// 1. `cursor` 与 `order` **互斥**：同时传 → 400 `InvalidCursorError`
//    （游标自己编码了 order，服务端不允许再传）。
//    → 本模块因此**不暴露 order 参数**：一律用服务端默认 desc 起手，
//      再把结果重排成"旧→新"交给上层。这样所有游标都必然是 desc 语义，不会有歧义。
//
// 2. **游标不代表"还有没有更多"**：只要本页非空，`previous`/`next` 都会返回游标，
//    哪怕那个方向已经没有数据（跟过去只会拿到空数组）。
//    → 判断"还有更多"用 **`limit + 1` 溢出法**：多要一条，多出来就说明还有。
//      ⚠️ 多要的那条**必须保留**，不能丢弃 —— 因为 `cursor.next` 锚定在本页
//      **最后一条**上，丢掉它就等于让下一页跳过它，会**永久丢消息**。
//
// 3. `limit` 服务端是 `NumberFromString` 且**限定 1..200**
//    （`packages/protocol/src/groups/message.ts` 的 `SessionMessagesQuery`）。
//    超过 200 会 400。本模块统一做钳制。
// ============================================

import { getSDKClient } from './sdk'
import { resolveSessionTarget } from '../utils/sessionKey'
import type { JsonValue } from '@opencode/client'
import type { MessagePage, SessionMessageFilterType, SessionMessageInfo } from '../types/api/message'
import type { Message as UIMessage, TextPart } from '../types/message'
import type { Attachment, RevertedMessage } from './types'

/** 服务端默认页大小（`DefaultMessagesLimit`，packages/server/src/handlers/message.ts:8） */
export const DEFAULT_MESSAGES_LIMIT = 50

/** 服务端允许的 `limit` 上限（`SessionMessagesQuery` 的 `isLessThanOrEqualTo(200)`） */
export const MAX_MESSAGES_LIMIT = 200

export interface GetSessionMessagesOptions {
  /**
   * 每页条数。会被钳制到 **1..200**；省略时用服务端默认 50。
   *
   * ⚠️ 实际请求 `limit + 1`（溢出探测，见文件头注释 2），
   *    且**多出来的那一条会一并返回**（不能丢，否则丢消息）。
   */
  limit?: number
  /**
   * 上一页响应里 `cursor.next`（更旧）或 `cursor.previous`（更新）的原样回传。
   * 省略 = 取最新一页。
   */
  cursor?: string
  /** 按消息类型过滤（在分页之前生效）。翻页时必须原样带上，否则页边界会错位 */
  type?: SessionMessageFilterType
}

/**
 * 拉取会话消息（一页）。
 *
 * 返回的 `messages` **一律按时间升序（旧 → 新）**排列，方便直接喂给
 * `messageStore`（store 内部就是按升序存的）。
 *
 * @param sessionId 会话 id（支持多服务器前缀，见 resolveSessionTarget）
 * @param options   分页参数，见 GetSessionMessagesOptions
 * @param _directory ⚠️ **故意不用**：这是 session 作用域端点，
 *       目录由 session 行本身决定，传了也会被服务端忽略（阶段 1 实测结论 3）。
 *       保留形参只是为了让调用点参数顺序不变。
 * @param serverId  指定服务器（缺省用活动服务器）
 */
export async function getSessionMessages(
  sessionId: string,
  options: GetSessionMessagesOptions = {},
  _directory?: string,
  serverId?: string,
): Promise<MessagePage> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)

  const limit = clampLimit(options.limit)
  // 溢出探测：多要一条来判断"还有更多"。到顶（200）时无法再多要，退化为"满页即视为还有"。
  const canProbe = limit < MAX_MESSAGES_LIMIT
  const requestLimit = canProbe ? limit + 1 : limit

  const page = await sdk.message.list({
    sessionID: target.sessionId,
    limit: requestLimit,
    // ⚠️ 有 cursor 时**绝对不能**再传 order（服务端会 400）。
    //    没 cursor 时也刻意不传：服务端默认就是 desc（新→旧）。
    ...(options.cursor ? { cursor: options.cursor } : {}),
    ...(options.type ? { type: options.type } : {}),
  })

  const data = page.data as SessionMessageInfo[]
  const hasMore = canProbe ? data.length > limit : data.length >= limit

  return {
    // 服务端给的是 desc（新→旧）；重排成旧→新，与 messageStore 的存储顺序一致。
    // toReversed() 在旧浏览器不可用，这里用 slice().reverse()。
    messages: data.slice().reverse(),
    cursor: {
      previous: page.cursor?.previous ?? null,
      next: page.cursor?.next ?? null,
    },
    hasMore,
  }
}

/** 把 limit 钳制到服务端接受的 1..200 */
function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_MESSAGES_LIMIT
  return Math.min(MAX_MESSAGES_LIMIT, Math.max(1, Math.trunc(limit)))
}

// ============================================
// Message Content Extraction
// ============================================

/**
 * 从 UI 模型的消息里提取用户内容（文本 + 附件），用于 undo/redo 的历史栈。
 *
 * ✅ 纯函数。阶段 2a 只把入参类型从「V1 API 消息」换成「UI 模型消息」——
 *    实现逻辑不变，因为转换层（messageConversion.ts）已经把 V2 的
 *    `User.text` / `User.files` / `User.agents` 摊平成了 UI 的 text/file/agent parts。
 */
export function extractUserMessageContent(message: Pick<UIMessage, 'parts'>): RevertedMessage {
  const { parts } = message

  // 用户可见文本：排除 synthetic（系统注入的上下文，不算用户输入）
  const text = parts
    .filter((p): p is TextPart => p.type === 'text' && !p.synthetic)
    .map(p => p.text)
    .join('\n')

  const attachments: Attachment[] = []

  for (const part of parts) {
    if (part.type === 'file') {
      const isFolder = part.mime === 'application/x-directory'
      const sourcePath = part.source && 'path' in part.source ? part.source.path : undefined
      attachments.push({
        id: part.id || crypto.randomUUID(),
        type: isFolder ? 'folder' : 'file',
        displayName: part.filename || sourcePath || 'file',
        url: part.url,
        mime: part.mime,
        relativePath: sourcePath,
        textRange: part.source?.text
          ? {
              value: part.source.text.value,
              start: part.source.text.start,
              end: part.source.text.end,
            }
          : undefined,
      })
    } else if (part.type === 'agent') {
      attachments.push({
        id: part.id || crypto.randomUUID(),
        type: 'agent',
        displayName: part.name,
        agentName: part.name,
        textRange: part.source
          ? {
              value: part.source.value,
              start: part.source.start,
              end: part.source.end,
            }
          : undefined,
      })
    }
  }

  return { text, attachments }
}

// ============================================
// Send Message（阶段 2b 实现）
// ============================================
//
// ── V2 的两条发消息链路（照 v2.0.19 源码核实，不是推测）────────────────────
//
//   源码：`packages/protocol/dist/groups/session.js:278`
//     POST /api/session/:sessionID/prompt
//       payload: { id?, ...PromptInput.Prompt.fields, metadata?, delivery?, resume? }
//       success: { data: Session.Inbox.User }
//       description 原文：*"Durably admit one session input and schedule agent-loop
//       execution unless resume is false."*
//     → **prompt 本身就是非阻塞的**（"admit + schedule"），返回的是「已入队」记录。
//
//   `PromptInput.Prompt`（`@opencode/schema/dist/prompt-input.js`）**只有 4 个字段**：
//       { text: string, files?: FileAttachment[], agents?: AgentAttachment[], skills?: SkillAttachment[] }
//     ⚠️ **没有 `model`**！V2 的模型是**会话级**的（`POST /api/session/{id}/model`
//        + `session.model.selected` 事件），不再逐条消息指定。
//        本模块因此把调用方给的模型写进 `metadata.model`
//        （**与官方 TUI 完全一致**：阶段 2a 实测 TUI 写的就是 `metadata.model`，
//        且用的是 V1 命名 `modelID`），这样历史渲染能显示正确的模型；
//        ⚠️ 模型**切换**不经本模块：UI 的模型下拉走本地选择
//        （`useModelSelection` → `serverStorage`），发送时只把所选模型记进
//        `metadata.model`。V2 SDK 虽提供 `session.switchModel`（`POST /api/session/{id}/model`），
//        但本项目**有意不调用**（YAGNI：逐条消息带模型已满足需求，且切会话模型会改服务端状态）。
//
//   ⚠️ `POST /api/session/{id}/background` **不是** prompt_async 的替代品：
//      它是 *"Move active foreground backgroundable tools into background observation"*，
//      与「异步发消息」无关。
//
// ── 两条链路的语义分工 ────────────────────────────────────────────────────
//
//   `sendMessageAsync` —— 只投递，不等这轮跑完。UI 的常规发送路径用它，
//                        回复靠 SSE 流式推回来。
//   `sendMessage`      —— 投递 + **等这轮跑完**。用
//                        `POST /api/experimental/session/{id}/wait`
//                        （源码 description：*"Wait for a session agent loop to become idle"*）。
// ============================================

/**
 * 把 UI 附件摊成 V2 的 `files` / `agents` 参数
 *
 * ⚠️ V2 的 `FileAttachment` 只要 **`uri`**（不是 V1 的 base64 `data`）：
 *    `{ uri, name?, description?, mention? }`
 *    UI 的 `Attachment.url` 已经是 `file://…` 或 `data:…` 的完整 URI，
 *    直接透传即可（阶段 2a 的反向转换也是这么拼的）。
 *
 * `folder` 用 `file://` 目录 URI；`agent` 归到 `agents` 而不是 `files`。
 */
function toPromptAttachments(attachments: Attachment[]): {
  files: Array<{ uri: string; name?: string; mention?: { start: number; end: number; text: string } }>
  agents: Array<{ name: string; mention?: { start: number; end: number; text: string } }>
} {
  const files: Array<{ uri: string; name?: string; mention?: { start: number; end: number; text: string } }> = []
  const agents: Array<{ name: string; mention?: { start: number; end: number; text: string } }> = []

  for (const attachment of attachments) {
    const mention = attachment.textRange
      ? {
          start: attachment.textRange.start,
          end: attachment.textRange.end,
          text: attachment.textRange.value,
        }
      : undefined

    if (attachment.type === 'agent') {
      if (!attachment.agentName) continue
      agents.push({ name: attachment.agentName, mention })
      continue
    }

    // text / command 不是文件附件（command 走 session.command 端点），跳过
    if (attachment.type !== 'file' && attachment.type !== 'folder') continue

    const uri = attachment.url ?? (attachment.relativePath ? `file://${attachment.relativePath}` : undefined)
    if (!uri) continue

    files.push({ uri, name: attachment.displayName || attachment.relativePath, mention })
  }

  return { files, agents }
}

/**
 * 构造 V2 的 prompt 入参（纯函数，便于单测）
 *
 * 导出仅为测试：**唯一** 的 prompt 参数构造入口，
 * 读侧 `messageConversion` 消费的就是同一套字段。
 */
export function buildPromptParams(
  sessionId: string,
  params: import('./types').SendMessageParams,
): {
  sessionID: string
  text: string
  files?: Array<{ uri: string; name?: string; mention?: { start: number; end: number; text: string } }>
  agents?: Array<{ name: string; mention?: { start: number; end: number; text: string } }>
  metadata?: { [key: string]: JsonValue }
} {
  const { files, agents } = toPromptAttachments(params.attachments)

  // `metadata` 不是契约字段（schema 是 Record<string, JsonValue>），
  // 但官方 TUI 会把 agent / model 写进去供历史渲染 → 我们保持一致。
  const metadata: { [key: string]: JsonValue } = {}
  if (params.agent) metadata.agent = params.agent
  if (params.model) {
    metadata.model = {
      providerID: params.model.providerID,
      // ⚠️ 这里刻意用 V1 命名 `modelID`：官方 TUI 写的就是这个名字，
      //    阶段 2a 的转换层也同时兼容 `modelID` 与 `id`。
      modelID: params.model.modelID,
      variant: params.variant ?? null,
    }
  }

  return {
    sessionID: sessionId,
    text: params.text,
    ...(files.length > 0 ? { files } : {}),
    ...(agents.length > 0 ? { agents } : {}),
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  }
}

/**
 * 把「本次发送要用的模型」同步到会话上（V2：模型是**会话级**的）
 *
 * 🔴 为什么必须同步：V2 的 `prompt` **不接受 model 参数**（见下方注释），
 *    不同步的话「界面上切换模型」不会生效 —— 服务端永远使用会话当前模型
 *    （新会话 = 服务端默认模型）。这正是「切换模型不起作用」的根因。
 *
 * ✅ 幂等：与会话当前模型一致时服务端**直接返回**（不插记录、不发事件），
 *    所以每次发送前无脑调用是安全的；只有真正变化时才会在转录里留下一条
 *    `model-switched` 记录（与官方 TUI 行为一致，UI 渲染为会话标记）。
 */
async function syncSessionModel(
  sdk: ReturnType<typeof getSDKClient>,
  sessionID: string,
  model: { providerID: string; modelID: string },
  variant: string | undefined,
): Promise<void> {
  await sdk.session.switchModel({
    sessionID,
    model: {
      // UI 命名 modelID → 契约命名 id（V2 的 Model.Ref，见 types/api/message.ts）
      id: model.modelID,
      providerID: model.providerID,
      // variant 只在有值时下发（缺省 = 模型默认 variant）
      ...(variant ? { variant } : {}),
    },
  })
}

/**
 * 异步发送消息 —— **投递后立即返回**，AI 回复通过 SSE 推送
 *
 * V2: `POST /api/session/{sessionID}/prompt`（SDK：`session.prompt`）
 *     V2 的 prompt **本身就是非阻塞的**，返回 `Session.Inbox.User`（入队记录）。
 *     不再有 V1 的 `prompt_async` 变体。
 *
 * 🔴 模型不经过 prompt：V2 的模型是**会话级**的，prompt 的请求体里没有 model 字段
 *    （实测核实，见 docs/opencode-v2-migration.md §10.4）→ 发送前先 `switchModel`。
 */
export async function sendMessageAsync(params: import('./types').SendMessageParams, serverId?: string): Promise<void> {
  const target = resolveSessionTarget(params.sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  // 🔴 先把本次要用的模型同步到会话（幂等）—— 否则 prompt 永远用会话当前模型
  await syncSessionModel(sdk, target.sessionId, params.model, params.variant)
  await sdk.session.prompt(buildPromptParams(target.sessionId, params))
}

/**
 * 发送消息并**等待这一轮跑完**
 *
 * 链路：`prompt`（非阻塞投递）→ `POST /api/experimental/session/{id}/wait`
 *      （SDK：`session.wait`，description 原文 *"Wait for a session agent loop to
 *      become idle"*）。
 *
 * ⚠️ 返回值仍是**入队记录**而不是 AI 回复：V2 的回复只在转录里（`GET .../message`
 *    或 SSE 事件流），没有「一次请求拿回复」的接口。调用方要拿回复内容请走
 *    `getSessionMessages()` 或等 `session.idle` 事件。
 */
export async function sendMessage(
  params: import('./types').SendMessageParams,
  serverId?: string,
): Promise<import('./types').SendMessageResponse> {
  const target = resolveSessionTarget(params.sessionId, serverId)
  const sdk = getSDKClient(target.serverId)

  // 🔴 同 sendMessageAsync：先同步模型再投递（幂等，见 syncSessionModel 注释）
  await syncSessionModel(sdk, target.sessionId, params.model, params.variant)
  const inbox = await sdk.session.prompt(buildPromptParams(target.sessionId, params))
  // 等这轮 agent loop 变为空闲（等价于 V1 阻塞式 POST /session/{id}/message 的语义）
  await sdk.session.wait({ sessionID: target.sessionId })

  // ⚠️ 没有「回复内容」可返回 —— 见函数注释。
  //    保留返回类型是为了不改动调用方的签名；两个字段都为空是**刻意的**。
  return {
    info: {
      id: inbox.id,
      sessionID: target.sessionId,
      role: 'assistant',
      time: { created: inbox.time?.created ?? Date.now() },
      parentID: '',
      modelID: params.model?.modelID ?? '',
      providerID: params.model?.providerID ?? '',
      mode: '',
      agent: params.agent ?? '',
      path: { cwd: '', root: '' },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      summary: false,
    },
    parts: [],
  }
}
