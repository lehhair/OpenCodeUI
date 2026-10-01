// ============================================
// Tauri 平台检测 & 工具
// ============================================

/**
 * 检测当前是否运行在 Tauri 环境中
 * 通过检查 window.__TAURI_INTERNALS__ 来判断
 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export function isTauriMobile(): boolean {
  if (!isTauri() || typeof navigator === 'undefined') return false
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
}

export type DesktopPlatform = 'windows' | 'macos' | 'linux' | 'other'

export function getDesktopPlatform(): DesktopPlatform {
  if (!isTauri() || isTauriMobile() || typeof navigator === 'undefined') return 'other'

  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes('windows')) return 'windows'
  if (ua.includes('mac os') || ua.includes('macintosh')) return 'macos'
  if (ua.includes('linux')) return 'linux'
  return 'other'
}

export function usesCustomDesktopTitlebar(): boolean {
  const platform = getDesktopPlatform()
  return platform === 'windows' || platform === 'macos'
}

/** 文件扩展名 → MIME 类型映射 */
export function extToMime(ext: string): string {
  const map: Record<string, string> = {
    // image
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
    // pdf
    pdf: 'application/pdf',
    // audio
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    flac: 'audio/flac',
    aac: 'audio/aac',
    m4a: 'audio/mp4',
    // video
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    avi: 'video/x-msvideo',
    mkv: 'video/x-matroska',
    // text / code
    // v2 的 file.read 不再返回 mimeType，HTML 预览等场景完全依赖这里的推断，
    // 因此脚本/样式/文本类型必须齐全（否则会退化成 application/octet-stream）
    js: 'text/javascript',
    mjs: 'text/javascript',
    cjs: 'text/javascript',
    jsx: 'text/javascript',
    ts: 'text/javascript',
    tsx: 'text/javascript',
    css: 'text/css',
    html: 'text/html',
    htm: 'text/html',
    xhtml: 'application/xhtml+xml',
    json: 'application/json',
    jsonc: 'application/json',
    xml: 'application/xml',
    txt: 'text/plain',
    md: 'text/markdown',
    markdown: 'text/markdown',
    csv: 'text/csv',
    yaml: 'text/yaml',
    yml: 'text/yaml',
    // fonts
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    otf: 'font/otf',
  }
  return map[ext] || 'application/octet-stream'
}
