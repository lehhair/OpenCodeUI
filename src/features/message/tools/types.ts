import type { ReactNode, ComponentType } from 'react'
import type { AssistantTool } from '../../../types/api/message'

// ============================================
// Tool Registry Types
// ============================================

/**
 * 渲染层消费的工具内容。
 *
 * 直接取自 v2 原生助手 content（`{ type:'tool', id, name, state, time }`），
 * 只额外补一个 `messageID`：原生 content 元素没有所属消息字段，
 * 而展开状态 key、stateKey、fullscreen id 都需要它来保证全局唯一。
 *
 * `state` 是原生判别联合（streaming | running | completed | error），
 * 不再有 v1 那层「宽松 ToolState」。`type` / `time` 保留是为了让本类型
 * 与原生 `AssistantTool` 保持结构一致（toolState 的读取 helper 直接吃它）。
 */
export type ToolViewPart = AssistantTool & {
  messageID: string
}

/** 单条工具调用的渲染上下文（来自所属助手消息） */
export interface ToolViewContext {
  /** 所属助手消息 id */
  messageID: string
  /** 消息创建时间（毫秒），作为工具开始时间的兜底 */
  created?: number
  /** 消息完成时间（毫秒）；未完成（流式中）时为 undefined */
  completed?: number
}

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
  /** 工具是否算失败：status 为 error，或 completed 但进程失败（shell 非零退出/超时） */
  failed?: boolean

  // 文件类产出（v2 的 ToolContent file 项；旧层直接丢掉了）
  toolFiles?: ToolFileAttachment[]

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

/** v2 `ToolContent` 的 file 项 */
export interface ToolFileAttachment {
  uri: string
  mime: string
  name?: string | null
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
  part: ToolViewPart
  data: ExtractedToolData
  /** 所属助手消息信息（状态文案 / 计时用） */
  context?: ToolViewContext
  /** 子组件全屏状态变化时回调，用于阻止父级自动收起 */
  onFullscreenChange?: (isFullscreen: boolean) => void
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
   * 用于从 v2 工具内容提取 input/output 等数据
   * 如果不提供，使用默认提取逻辑
   */
  extractData?: (part: ToolViewPart) => Partial<ExtractedToolData>
}

/**
 * 工具注册表
 */
export type ToolRegistry = ToolConfig[]
