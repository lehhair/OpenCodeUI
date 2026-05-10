import type { ReactNode, ComponentType } from 'react'
import type { ToolPart } from '../../../types/message'

// ============================================
// Tool Registry Types
// ============================================

/**
 * 提取后的标准化工具数据
 */
export interface ExtractedToolData {
  // Input
  input?: string
  inputLang?: string

  // Output
  output?: string
  outputLang?: string

  // Error
  error?: string

  // Diff (文件编辑)
  diff?: { before: string; after: string } | string
  diffStats?: { additions: number; deletions: number }
  files?: FileDiff[]

  // Meta
  filePath?: string
  cwd?: string
  exitCode?: number

  // LSP 诊断
  diagnostics?: DiagnosticInfo[]
}

export interface DiagnosticInfo {
  file: string
  severity: 'error' | 'warning' | 'info' | 'hint'
  message: string
  line: number
  column: number
}

export interface FileDiff {
  filePath: string
  diff?: string
  patch?: string
  before?: string
  after?: string
  additions?: number
  deletions?: number
}

/**
 * 工具渲染器 Props
 */
export interface ToolRendererProps {
  part: ToolPart
  data: ExtractedToolData
}

/**
 * 工具配置
 */
export interface ToolConfig {
  /** 匹配函数：判断工具名是否匹配此配置 */
  match: (toolName: string) => boolean

  /** 图标组件 */
  icon: ReactNode

  /**
   * 自定义渲染器（可选）
   * 如果不提供，使用默认的 Input/Output 渲染
   */
  renderer?: ComponentType<ToolRendererProps>

  /**
   * 数据提取器（可选）
   * 用于从 ToolPart 提取 input/output 等数据
   * 如果不提供，使用默认提取逻辑
   */
  extractData?: (part: ToolPart) => Partial<ExtractedToolData>
}

/**
 * 工具注册表
 */
export type ToolRegistry = ToolConfig[]
