// ============================================
// File & Symbol API Types
// 基于 OpenAPI 规范
// ============================================

/**
 * 文件节点类型
 */
export type FileNodeType = 'file' | 'directory'

/**
 * 文件节点
 */
export interface FileNode {
  name: string
  type: FileNodeType
  size?: number
  modified?: number
}

/**
 * 文件内容
 */
export interface FileContent {
  path: string
  content: string
  language?: string
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
 * 文件状态
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
