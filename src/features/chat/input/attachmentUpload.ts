// ============================================
// 附件上传编排（Issue #182）
//
// 把「浏览器 / 桌面端拖入的任意文件」变成服务端上的路径附件：
//   文件 → api/file.uploadAttachment → `{tmp}/uploads/<uuid>/<name>`
//        → Attachment{ url: file://..., relativePath: 绝对路径 }
//
// 这里只负责编排与错误分类，UI 状态（上传中 / 失败 / 重试）由输入框维护。
// 注意 `files[].uri` 只让**服务端**读到字节，模型能否看到取决于服务端嗅探
// 出的 mime；非文本/图片的附件靠 api/message 注入的路径文本被模型用工具
// 访问（见 buildAttachmentReferences）。
// ============================================

import { createUploadId, probeServerPath, uploadAttachment, uploadLocalFile } from '../../../api/file'
import { getMimeFromPath, routeAttachment } from './inputUtils'
import { toFileUrl } from '../../mention'
import type { FileCapabilities } from '../../../api'
import type { Attachment } from '../../attachment'

export type UploadFailureReason = 'network' | 'unauthorized' | 'server' | 'unknown'

export interface UploadFailure {
  reason: UploadFailureReason
  /** 原始错误摘要，用于日志与通知正文 */
  message: string
}

export interface UploadOutcome {
  attachment?: Attachment
  failure?: UploadFailure
}

export interface UploadOptions {
  serverId?: string
  directory?: string
  /** 服务端 20MB 附件上限之外的文件只作路径引用（不进 prompt.files[]） */
  pathOnly: boolean
  /** 上传进度（0~1）：浏览器侧会走 XHR 才能真实上报（见 api/file.uploadAttachment） */
  onProgress?: (fraction: number) => void
}

/** 从错误对象里抽出可读摘要（fetch 失败在浏览器里往往只有 "Failed to fetch"） */
function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Unknown error'
}

/** 把上传失败归类，供客户端选择文案 */
export function classifyUploadFailure(error: unknown): UploadFailure {
  const message = errorMessage(error)
  const normalized = message.toLowerCase()

  if (/\b(401|403)\b|unauthor|forbidden/.test(normalized)) {
    return { reason: 'unauthorized', message }
  }
  if (/\b5\d\d\b|internal|bad gateway|unavailable/.test(normalized)) {
    return { reason: 'server', message }
  }
  if (/failed to fetch|networkerror|network request failed|load failed|timeout|timed out|aborted/.test(normalized)) {
    return { reason: 'network', message }
  }
  return { reason: 'unknown', message }
}

/** 构造路径型附件（displayName 用用户看到的原始文件名，不是服务端清洗过的） */
export function buildPathAttachment(input: {
  id: string
  path: string
  filename: string
  mime: string
  size: number
  pathOnly: boolean
}): Attachment {
  return {
    id: input.id,
    type: 'file',
    displayName: input.filename,
    url: toFileUrl(input.path),
    mime: input.mime,
    relativePath: input.path,
    size: input.size,
    ...(input.pathOnly ? { pathOnly: true } : {}),
  }
}

export type NativeFileDecision =
  /** 原生媒体：读本机字节内联成 data URL（浏览器/桌面都走这条） */
  | { kind: 'inline' }
  /**
   * 服务端同机：交给原有的 `@` 引用，**不上传**（需求二）。
   * `pathOnly` 为 true 时只给路径（二进制 / 超 20MB），不进 `files[]`。
   */
  | { kind: 'mention'; pathOnly: boolean }
  /** 服务端在远端：必须上传 */
  | { kind: 'upload'; pathOnly: boolean }
  /** 超过上传上限 */
  | { kind: 'reject' }

/**
 * 桌面端拖入的**本机文件**该走哪条路。
 *
 * 桌面端拿得到真实路径（`getDroppedPathsInfo`），所以与服务端同机时可以不
 * 上传：原生媒体内联，其余沿用原有的 `@` 引用（服务端自己读得到那个路径）。
 * 服务端在远端时本机路径对它没有意义，只能上传。
 */
export function decideNativeFileRoute(input: {
  mime: string
  size: number
  caps: FileCapabilities
  serverIsLocal: boolean
  nativePath: string
}): NativeFileDecision {
  const route = routeAttachment(input)

  switch (route.kind) {
    case 'inline':
      return { kind: 'inline' }
    case 'reference':
      return { kind: 'mention', pathOnly: route.pathOnly }
    case 'reject':
      return { kind: 'reject' }
    default:
      return { kind: 'upload', pathOnly: route.pathOnly }
  }
}

/**
 * 能否把本机路径直接交给服务端引用。
 *
 * 「URL 是不是 localhost」不足以回答这个问题（本机也可以用局域网地址连自己，
 * 容器也会把端口映射到回环），所以除了应用自己拉起的服务（必然同机）之外，
 * 一律直接问服务端：这个路径你读得到吗（`probeServerPath`）。
 */
export async function canReferenceLocalPath(input: {
  path: string
  /** 应用自己拉起的服务（`local` 条目）：必然同机，免探测 */
  pinnedLocal: boolean
  directory?: string
  serverId?: string
  /** 便于单测注入 */
  probe?: (path: string, directory?: string, serverId?: string) => Promise<boolean>
}): Promise<boolean> {
  if (input.pinnedLocal) return true

  try {
    return await (input.probe ?? probeServerPath)(input.path, input.directory, input.serverId)
  } catch {
    return false
  }
}

async function uploadAndBuild(
  payload: File | Uint8Array,
  filename: string,
  mime: string,
  fallbackSize: number,
  options: UploadOptions,
): Promise<UploadOutcome> {
  try {
    const { path, size } = await uploadAttachment(payload, filename, options.directory, options.serverId, {
      onProgress: options.onProgress,
    })
    return {
      attachment: buildPathAttachment({
        id: createUploadId(),
        path,
        filename,
        mime,
        size: size || fallbackSize,
        pathOnly: options.pathOnly,
      }),
    }
  } catch (error) {
    return { failure: classifyUploadFailure(error) }
  }
}

/**
 * 上传 `File`（浏览器拖入 / 粘贴 / 文件选择）。
 *
 * 永不抛错：失败通过 `failure` 返回，调用方负责可见提示与重试。
 */
export async function uploadFileAsAttachment(file: File, options: UploadOptions): Promise<UploadOutcome> {
  const mime = file.type || getMimeFromPath(file.name) || 'application/octet-stream'
  return uploadAndBuild(file, file.name, mime, file.size, options)
}

/**
 * 上传**本机文件**（桌面端拖入 / 选择器）。
 *
 * Tauri 下由 Rust 流式发送并把进度推回来（见 api/file.uploadLocalFile），
 * 所以这里不会把整份文件读进渲染进程。
 */
export async function uploadPathAsAttachment(
  sourcePath: string,
  filename: string,
  mime: string,
  options: UploadOptions,
): Promise<UploadOutcome> {
  try {
    const { path, size } = await uploadLocalFile(sourcePath, filename, options.directory, options.serverId, {
      onProgress: options.onProgress,
    })

    return {
      attachment: buildPathAttachment({
        id: createUploadId(),
        path,
        filename,
        mime: mime || 'application/octet-stream',
        size,
        pathOnly: options.pathOnly,
      }),
    }
  } catch (error) {
    return { failure: classifyUploadFailure(error) }
  }
}

/**
 * 把一次拖入拆成「真文件」和「文件夹」。
 *
 * 为什么要按 entry 判断而不能看 dataTransfer.files：浏览器把拖入的文件夹也塞进
 * files，表现为一个 size 0、type 空的 File —— 直接上传会得到一个空附件，请求还
 * 常被浏览器安全策略挡掉（net::ERR_ACCESS_DENIED）。所以文件夹必须靠
 * webkitGetAsEntry().isDirectory 认出来，也不能用"大小为 0"来猜（空文件是合法的）。
 *
 * fallbackFiles 只在**根本没有 items 可用**时兜底（老环境 / 合成事件）。注意不能在
 * "拣完只剩文件夹"时回退到它 —— 那会把文件夹重新捞回来，正是要拦的东西。
 */
export interface DroppedItemLike {
  kind: string
  webkitGetAsEntry?: () => { isDirectory: boolean; name: string } | null
  getAsFile?: () => File | null
}

export function splitDroppedItems(
  items: DroppedItemLike[],
  fallbackFiles: File[] = [],
): { files: File[]; folderNames: string[] } {
  if (items.length === 0) return { files: fallbackFiles, folderNames: [] }

  const files: File[] = []
  const folderNames: string[] = []
  for (const item of items) {
    if (item.kind !== 'file') continue
    const entry = item.webkitGetAsEntry?.()
    if (entry?.isDirectory) {
      folderNames.push(entry.name)
      continue
    }
    const file = item.getAsFile?.()
    if (file) files.push(file)
  }
  return { files, folderNames }
}
