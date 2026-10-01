// ============================================
// 文件下载工具函数
// v2 的 file.read 返回原始字节，因此下载直接用 bytes
// 浏览器环境使用 <a download>，Tauri 环境使用原生保存对话框
// ============================================

import type { FileContent } from '../api/types'
import { getMimeFromPath } from '../features/chat/input/inputUtils'
import { isTauri } from './tauri'

/**
 * 触发浏览器下载（仅浏览器环境）
 */
function triggerBrowserDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  // 延迟清理，确保下载已启动
  setTimeout(() => {
    URL.revokeObjectURL(url)
    document.body.removeChild(a)
  }, 100)
}

/**
 * Tauri 原生保存文件
 * 弹出系统保存对话框，用户选择路径后写入文件
 */
async function tauriSaveFile(data: Uint8Array, fileName: string): Promise<void> {
  const [{ save }, { writeFile }] = await Promise.all([
    import('@tauri-apps/plugin-dialog'),
    import('@tauri-apps/plugin-fs'),
  ])

  // 从文件名提取扩展名，用于对话框过滤
  const ext = fileName.split('.').pop()?.toLowerCase()
  const filters = ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : []

  const filePath = await save({
    defaultPath: fileName,
    filters,
  })

  if (!filePath) return // 用户取消

  await writeFile(filePath, data)
}

/**
 * 从 FileContent 下载文件
 *
 * v2 的 `file.read` 返回原始字节，没有 base64 encoding，也没有 mimeType，
 * 因此直接用 `content.bytes`；MIME 按路径推断。
 * - Tauri 环境：弹出原生保存对话框
 * - 浏览器环境：使用 <a download> 触发下载
 */
export function downloadFileContent(content: FileContent, fileName: string): void {
  const mimeType = content.isBinary
    ? getMimeFromPath(content.path) || 'application/octet-stream'
    : `${getMimeFromPath(content.path) || 'text/plain'};charset=utf-8`

  saveData(content.bytes, fileName, mimeType)
}

/**
 * 通用保存：接受原始数据 + 文件名 + MIME 类型
 * - Tauri 环境：弹出原生保存对话框 + fs 写入
 * - 浏览器环境：Blob + <a download>
 */
export function saveData(data: Uint8Array, fileName: string, mimeType = 'application/octet-stream'): void {
  if (isTauri()) {
    tauriSaveFile(data, fileName).catch(err => {
      console.warn('[downloadUtils] Tauri save failed:', err)
    })
  } else {
    const blob = new Blob([data.buffer as ArrayBuffer], { type: mimeType })
    triggerBrowserDownload(blob, fileName)
  }
}
