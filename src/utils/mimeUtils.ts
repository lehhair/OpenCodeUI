// ============================================
// MIME 类型工具 - 统一处理文件类型分类与预览能力判断
// ============================================

/**
 * 可直接作为预览渲染的媒体主类型（mimeType 的 "/" 前部分）
 * image/* / audio/* / video/* 天然覆盖所有子类型
 */
const PREVIEWABLE_MEDIA = new Set(['image', 'audio', 'video'])

/**
 * application/* 中可预览的子类型白名单
 * 需要单独处理，因为 application 大类本身不可预览
 */
const PREVIEWABLE_APP_SUBTYPES = new Set(['pdf'])

/** 预览分类 */
export type PreviewCategory = 'image' | 'audio' | 'video' | 'pdf'

/**
 * 从 mimeType 提取预览分类
 * 利用 MIME 本身的 major/minor 结构做映射，无需逐个硬编码
 *
 * @returns 预览分类，null 表示不支持预览
 */
export function getPreviewCategory(mimeType?: string): PreviewCategory | null {
  if (!mimeType) return null
  const slash = mimeType.indexOf('/')
  if (slash === -1) return null

  const major = mimeType.slice(0, slash)
  const minor = mimeType.slice(slash + 1)

  if (PREVIEWABLE_MEDIA.has(major)) return major as PreviewCategory
  if (major === 'application' && PREVIEWABLE_APP_SUBTYPES.has(minor)) return minor as PreviewCategory
  return null
}

/**
 * 判断一个 FileContent 是否为二进制内容
 */
export function isBinaryContent(encoding?: string): boolean {
  return encoding === 'base64'
}

/**
 * 文本编码但可渲染预览的 MIME 类型
 * 这类文件同时支持「渲染预览」和「源码查看」两种模式
 */
const TEXTUAL_MEDIA_TYPES = new Set(['image/svg+xml'])

/**
 * 判断是否为文本型可渲染媒体
 * 区别于二进制媒体：这类文件以文本形式存储，但可以渲染出可视化效果
 */
export function isTextualMedia(mimeType?: string): boolean {
  return !!mimeType && TEXTUAL_MEDIA_TYPES.has(mimeType)
}

/**
 * 构建 base64 data URL
 */
export function buildDataUrl(mimeType: string, base64Content: string): string {
  return `data:${mimeType};base64,${base64Content}`
}

/**
 * 从文本内容构建 data URL（用于 SVG 等文本型媒体）
 */
export function buildTextDataUrl(mimeType: string, text: string): string {
  return `data:${mimeType};charset=utf-8,${encodeURIComponent(text)}`
}

/**
 * 从原始字节构建 base64 data URL。
 *
 * v2 的 `file.read` 返回 `Uint8Array`（不再是 base64 字符串），
 * 图片/音视频预览需要由此自行编码。
 */
export function buildBytesDataUrl(mimeType: string, bytes: Uint8Array): string {
  // 分块避免 String.fromCharCode 的参数数量上限
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return `data:${mimeType};base64,${btoa(binary)}`
}

/**
 * 将 base64 编码的内容解码为 UTF-8 文本
 * 用于 SVG 等虽以 base64 传输但本质是文本的文件
 */
export function decodeBase64Text(base64: string): string {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new TextDecoder('utf-8').decode(bytes)
}

/**
 * 格式化 mimeType 用于显示
 * e.g. "image/png" -> "PNG Image"
 */
export function formatMimeType(mimeType: string): string {
  const slash = mimeType.indexOf('/')
  if (slash === -1) return mimeType.toUpperCase()

  const major = mimeType.slice(0, slash)
  const minor = mimeType.slice(slash + 1).replace(/[+;].*$/, '') // 去掉参数如 svg+xml

  const majorLabels: Record<string, string> = {
    image: 'Image',
    audio: 'Audio',
    video: 'Video',
    application: 'File',
    text: 'Text',
    font: 'Font',
  }

  const label = majorLabels[major] || 'File'
  return `${minor.toUpperCase()} ${label}`
}
