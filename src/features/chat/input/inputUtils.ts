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

/** 读取文件为 data URL */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => resolve(e.target?.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
