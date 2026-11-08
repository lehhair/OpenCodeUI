import { extToMime } from '../../../utils/tauri'
import type { FileCapabilities } from '../../../api'

// ============================================
// 文本样式常量
// ============================================

export const TEXT_STYLE: React.CSSProperties = {
  fontFamily: 'var(--font-ui-sans)',
  fontSize: 'var(--fs-base)',
  fontWeight: 400,
  lineHeight: '1.43',
  letterSpacing: 'normal',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  overflowWrap: 'break-word',
}

// ============================================
// detectSlashTrigger - 检测斜杠命令触发
// 只在文本最开头触发
// ============================================

export function detectSlashTrigger(text: string, cursorPos: number): { query: string; startIndex: number } | null {
  // 斜杠命令只能在文本最开头
  if (!text.startsWith('/')) return null

  // 提取 / 之后到光标的文本作为 query
  const query = text.slice(1, cursorPos)

  // 如果 query 中包含空格或换行，说明命令已经输入完毕
  if (query.includes(' ') || query.includes('\n')) {
    return null
  }

  return { query, startIndex: 0 }
}

// ============================================
// File helpers
// ============================================

/** 检查文件 MIME 类型是否被当前模型能力支持 */
export function isFileSupported(mime: string, caps: FileCapabilities): boolean {
  if (mime.startsWith('image/')) return caps.image
  if (mime === 'application/pdf') return caps.pdf
  if (mime.startsWith('audio/')) return caps.audio
  if (mime.startsWith('video/')) return caps.video
  return false
}

export function ensureFileMime(file: File): File {
  if (file.type) return file

  const ext = file.name.split('.').pop()?.toLowerCase() || ''
  const mime = extToMime(ext)
  if (!mime || mime === 'application/octet-stream') return file

  return new File([file], file.name, {
    type: mime,
    lastModified: file.lastModified,
  })
}

export function getMimeFromPath(path: string): string {
  const fileName = path.split(/[/\\]/).pop() || path
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  return extToMime(ext)
}

/**
 * 模型能直接消费的 mime。
 *
 * 服务端 `to-llm-message` 只把 `text/plain`、图片、PDF、目录转进上下文，
 * 其余（可执行文件、压缩包、二进制）整段丢弃。这类文件进 `files[]`
 * 既占内存又可能撞服务端 20MB 读取上限，不如直接走路径引用。
 *
 * 注意：服务端对 `file://` 文件会按内容 `Mime.detect`，所以源码/配置等
 * 文本类型最终都会变成 `text/plain`。客户端按扩展名先把它们划进可读，
 * 二进制类直接排除。
 */
export function isModelReadableMime(mime: string): boolean {
  if (!mime) return false
  if (mime.startsWith('text/')) return true
  if (mime.startsWith('image/')) return true
  if (mime === 'application/pdf') return true
  if (mime === 'application/x-directory') return true
  // 结构化文本：服务端嗅探后就是 text/plain
  if (mime === 'application/json') return true
  if (mime === 'application/xml' || mime === 'application/xhtml+xml') return true
  return false
}

export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  const chunkSize = 0x8000
  let binary = ''

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }

  return `data:${mime};base64,${btoa(binary)}`
}

/** 读取文件为 data URL */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => resolve(e.target?.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// ============================================
// 附件分发（Issue #182：任意文件上传）
//
// `prompt.files[].uri` 只是「让服务端去读这个文件」的通道，**不是**
// 「让模型看到这个文件」的通道：
//   - data URL / file:// 都会在服务端被整份读入内存；
//   - 超过 20MB 直接 AttachmentError（整条 prompt 失败）；
//   - 嗅探出的 mime 不在 text/image/pdf 白名单时，转 LLM 阶段会被丢弃，
//     模型只能靠 prompt 文本里的路径去用工具读（见 api/message 的路径引用注入）。
// 这三条决定了下面的分发规则与体积阈值。
// ============================================

/**
 * 服务端读 `files[].uri` 的硬上限：20MB。
 *
 * 与 core `SessionPrompt` 的 `MAX_ATTACHMENT_BYTES` 等值，超出会让**整条
 * prompt 失败**，所以内联与引用都必须卡在这个阈值内。
 */
export const MAX_INLINE_BYTES = 20 * 1024 * 1024

/**
 * 单次上传体积上限。
 *
 * 超过上限的文件连上传都不做（避免把服务端临时目录写满）；产品需要更大
 * 文件时调这里，并同时考虑客户端内存（fetch 方案会把整份文件读进内存）。
 */
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024

export type AttachmentRoute =
  /** 原生媒体且未超限：data URL 内联 */
  | { kind: 'inline' }
  /**
   * 服务端与客户端同机、且拿得到原生路径：**不走上传**，沿用本机引用方式
   * （当前实现：交给 `@` 引用，服务端自己读得到那个路径）。
   */
  | { kind: 'reference'; path: string; pathOnly: boolean }
  /** 上传到服务端临时目录，返回的绝对路径作为附件 */
  | { kind: 'upload'; pathOnly: boolean }
  /** 超过上传上限，拒绝 */
  | { kind: 'reject'; reason: 'too-large' }

/**
 * 决定一个文件的附件形态（纯函数，便于单测）。
 *
 * `pathOnly` 表示「只把路径写进 prompt 文本、不进 `prompt.files[]`」——
 * 体积超过服务端 20MB 硬上限时唯一还能让模型拿到文件的方式。
 */
export function routeAttachment(input: {
  mime: string
  size: number
  caps: FileCapabilities
  /** 服务端是否与客户端同机（决定本机路径能否直引） */
  serverIsLocal: boolean
  /** 本机原生路径，仅桌面端可能拿到 */
  nativePath?: string
}): AttachmentRoute {
  if (isFileSupported(input.mime, input.caps) && input.size <= MAX_INLINE_BYTES) {
    return { kind: 'inline' }
  }

  // 模型读不了的类型（可执行文件、压缩包、二进制）或超过服务端读取上限：
  // 只给路径，不进 files[]。文件引用本来就没必要把整份内容塞进上下文。
  const pathOnly = !isModelReadableMime(input.mime) || input.size > MAX_INLINE_BYTES

  if (input.nativePath && input.serverIsLocal) {
    return { kind: 'reference', path: input.nativePath, pathOnly }
  }

  if (input.size > MAX_UPLOAD_BYTES) {
    return { kind: 'reject', reason: 'too-large' }
  }

  return { kind: 'upload', pathOnly }
}
