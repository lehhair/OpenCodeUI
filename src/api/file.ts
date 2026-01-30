// ============================================
// File Search API Functions
// 基于 OpenAPI: /file, /find/file, /find/symbol 相关接口
// ============================================

import { get } from './http'
import { formatPathForApi } from '../utils/directoryUtils'
import type { FileNode, SymbolInfo } from './types'

/**
 * GET /find/file - 搜索文件或目录
 * @param query 搜索关键词
 * @param options.directory 工作目录（项目目录）
 * @param options.type 搜索类型：file 或 directory
 * @param options.limit 返回结果数量限制
 */
export async function searchFiles(
  query: string,
  options: {
    directory?: string
    type?: 'file' | 'directory'
    limit?: number
  } = {}
): Promise<string[]> {
  return get<string[]>('/find/file', {
    query,
    directory: formatPathForApi(options.directory),
    type: options.type,
    limit: options.limit,
  })
}

/**
 * GET /file - 列出目录内容
 * @param path 要列出的路径
 * @param directory 工作目录（项目目录）
 */
export async function listDirectory(path: string, directory?: string): Promise<FileNode[]> {
  // 智能处理：如果 path 是绝对路径，将其作为 directory 传递，path 设为空
  // Windows: C: 或 C:/ 开头
  // Unix: / 开头
  const isAbsolute = /^[a-zA-Z]:/.test(path) || path.startsWith('/')
  
  if (isAbsolute && !directory) {
    return get<FileNode[]>('/file', { directory: formatPathForApi(path), path: '' })
  } else {
    return get<FileNode[]>('/file', { path, directory: formatPathForApi(directory) })
  }
}

/**
 * GET /find/symbol - 搜索代码符号
 * @param query 搜索关键词
 * @param directory 工作目录（项目目录）
 */
export async function searchSymbols(query: string, directory?: string): Promise<SymbolInfo[]> {
  return get<SymbolInfo[]>('/find/symbol', { query, directory: formatPathForApi(directory) })
}

/**
 * 搜索目录（便捷方法）
 * @param query 搜索关键词
 * @param baseDirectory 基础目录（从哪里开始搜索）
 * @param limit 返回结果数量限制
 */
export async function searchDirectories(
  query: string,
  baseDirectory?: string,
  limit: number = 50
): Promise<string[]> {
  return searchFiles(query, {
    directory: baseDirectory,
    type: 'directory',
    limit,
  })
}
