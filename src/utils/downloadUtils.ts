// ============================================
// 文件下载工具函数
// 支持文本文件和二进制文件（base64）的下载
// 浏览器环境使用 <a download>，Tauri 环境使用原生保存对话框
// ============================================

import type { FileContent } from '../api/types'
import { isBinaryContent } from './mimeUtils'
import { isTauri } from './tauri'

/**
 * 将 base64 字符串转为 Uint8Array
 */
function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

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
  const filters = ext
    ? [{ name: ext.toUpperCase(), extensions: [ext] }]
    : []

  const filePath = await save({
    defaultPath: fileName,
    filters,
  })

  if (!filePath) return // 用户取消

  await writeFile(filePath, data)
}

/**
 * 从 FileContent 下载文件
 * - 二进制文件：从 base64 解码后下载
 * - 文本文件：直接以 UTF-8 编码下载
 * - Tauri 环境：弹出原生保存对话框
 * - 浏览器环境：使用 <a download> 触发下载
 */
export function downloadFileContent(content: FileContent, fileName: string): void {
  // 统一转为 Uint8Array
  const data = isBinaryContent(content.encoding)
    ? base64ToBytes(content.content)
    : new TextEncoder().encode(content.content)

  const mimeType = isBinaryContent(content.encoding)
    ? (content.mimeType || 'application/octet-stream')
    : `${content.mimeType || 'text/plain'};charset=utf-8`

  saveData(data, fileName, mimeType)
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


