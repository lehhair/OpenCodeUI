// ============================================
// File & Symbol API Types
// 基于 OpenAPI 规范
// ============================================

/**
 * 文件节点类型
 */
export type FileNodeType = 'file' | 'directory'

/**
 * 文件节点 - 匹配 OpenAPI FileNode schema
 */
export interface FileNode {
  name: string
  path: string       // 相对路径
  absolute: string   // 绝对路径
  type: FileNodeType
  ignored: boolean
  // UI 扩展字段
  size?: number
  modified?: number
}

/**
 * 文件 patch hunk
 */
export interface PatchHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: string[]
}

/**
 * 文件 patch
 */
export interface FilePatch {
  oldFileName: string
  newFileName: string
  oldHeader?: string
  newHeader?: string
  hunks: PatchHunk[]
  index?: string
}

/**
 * 文件内容 - 匹配 OpenAPI FileContent schema
 */
export interface FileContent {
  type: 'text'
  content: string
  diff?: string
  patch?: FilePatch
  encoding?: 'base64'
  mimeType?: string
}

/**
 * 文件状态 - 匹配 OpenAPI File schema
 */
export interface FileStatusItem {
  path: string
  added: number
  removed: number
  status: 'added' | 'deleted' | 'modified'
}

/**
 * 文件差异
 */
export interface FileDiff {
  file: string
  before: string
  after: string
  additions: number
  deletions: number
}

/**
 * 文件状态 (旧版兼容)
 */
export interface FileStatus {
  path: string
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'copied'
  staged: boolean
}

/**
 * 符号位置范围
 */
export interface SymbolRange {
  start: { line: number; character: number }
  end: { line: number; character: number }
}

/**
 * 符号位置
 */
export interface SymbolLocation {
  uri: string
  range: SymbolRange
}

/**
 * 符号信息
 */
export interface Symbol {
  name: string
  kind: number
  location: SymbolLocation
  containerName?: string
}
