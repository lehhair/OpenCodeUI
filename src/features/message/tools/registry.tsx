import type { ReactNode } from 'react'
import type { ToolConfig, ToolRegistry, ExtractedToolData, DiagnosticInfo, ToolViewPart } from './types'
import { BashRenderer, QuestionRenderer } from './renderers'
import {
  FileReadIcon,
  FileWriteIcon,
  TerminalIcon,
  SearchIcon,
  GlobeIcon,
  BrainIcon,
  QuestionIcon,
  TaskIcon,
  WrenchIcon,
} from './icons'
import { detectLanguage } from '../../../utils/languageUtils'
import {
  currentToolError,
  currentToolFailed,
  currentToolFiles,
  currentToolInput,
  currentToolMetadata,
  currentToolOutput,
} from '../../../types/api/toolState'

// ============================================
// Tool Matchers (复用的匹配函数)
// ============================================

const includes =
  (...keywords: string[]) =>
  (name: string) => {
    const lower = name.toLowerCase()
    return keywords.some(k => lower.includes(k))
  }

const exact =
  (...names: string[]) =>
  (name: string) => {
    const lower = name.toLowerCase()
    return names.some(n => lower === n)
  }

type JsonObject = Record<string, unknown>

function isJsonObject(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

interface MetadataFileEntry {
  filePath?: string
  file?: string
  diff?: string
  patch?: string
  before?: string
  after?: string
  additions?: number
  deletions?: number
}

interface MetadataDiagnosticEntry {
  severity?: number
  message?: string
  range?: {
    start?: {
      line?: number
      character?: number
    }
  }
}

// ============================================
// Default Data Extractor
// ============================================

export function defaultExtractData(part: ToolViewPart): ExtractedToolData {
  const { state } = part
  const input = currentToolInput(part)
  const metadata = currentToolMetadata(part)

  const result: ExtractedToolData = {}

  // Input
  if (state.status === 'streaming') {
    // v2 的流式 input 是**未完成的 JSON 字符串**：原样展示（旧的 ToolState.raw）
    if (typeof state.input === 'string' && state.input.trim()) {
      result.input = state.input
      result.inputLang = 'json'
    }
  } else if (Object.keys(input).length > 0) {
    result.input = JSON.stringify(input, null, 2)
    result.inputLang = 'json'
  }

  // FilePath
  if (typeof metadata.filepath === 'string') {
    result.filePath = metadata.filepath
  }
  if (!result.filePath && input.filePath) {
    result.filePath = String(input.filePath)
  }

  // Exit code
  if (typeof metadata.exit === 'number') {
    result.exitCode = metadata.exit
  }

  // Diff / Files (from metadata)
  if (Array.isArray(metadata.files) && metadata.files.length > 0) {
    result.files = (metadata.files as MetadataFileEntry[]).map(file => ({
      filePath: file.filePath || file.file || 'unknown',
      diff: file.diff,
      patch: file.patch,
      before: file.before,
      after: file.after,
      additions: file.additions,
      deletions: file.deletions,
    }))
  } else if (typeof metadata.diff === 'string') {
    // 优先使用 unified diff
    result.diff = metadata.diff
    // 从 filediff 获取统计
    if (isJsonObject(metadata.filediff)) {
      const fd = metadata.filediff
      if (fd.additions !== undefined || fd.deletions !== undefined) {
        result.diffStats = {
          additions: typeof fd.additions === 'number' ? fd.additions : 0,
          deletions: typeof fd.deletions === 'number' ? fd.deletions : 0,
        }
      }
    }
  } else if (isJsonObject(metadata.filediff)) {
    const fd = metadata.filediff
    // 上游 v1.4.0+ metadata.filediff 用 patch 格式
    if (typeof fd.patch === 'string') {
      result.diff = fd.patch
    } else if (fd.before !== undefined && fd.after !== undefined) {
      result.diff = { before: String(fd.before), after: String(fd.after) }
    }
    if (fd.additions !== undefined || fd.deletions !== undefined) {
      result.diffStats = {
        additions: typeof fd.additions === 'number' ? fd.additions : 0,
        deletions: typeof fd.deletions === 'number' ? fd.deletions : 0,
      }
    }
  }

  // 提取 diagnostics
  if (isJsonObject(metadata.diagnostics)) {
    const diagMap = metadata.diagnostics
    const diagnostics: DiagnosticInfo[] = []

    for (const [file, items] of Object.entries(diagMap)) {
      if (!Array.isArray(items)) continue
      for (const item of items as MetadataDiagnosticEntry[]) {
        if (!item || typeof item !== 'object') continue
        // severity: 1=error, 2=warning, 3=info, 4=hint
        const severityMap: Record<number, DiagnosticInfo['severity']> = {
          1: 'error',
          2: 'warning',
          3: 'info',
          4: 'hint',
        }
        diagnostics.push({
          file: file.split(/[/\\]/).pop() || file,
          severity: typeof item.severity === 'number' ? (severityMap[item.severity] ?? 'info') : 'info',
          message: item.message || '',
          line: item.range?.start?.line ?? 0,
          column: item.range?.start?.character ?? 0,
        })
      }
    }

    // 只保留 error 和 warning
    const filtered = diagnostics.filter(d => d.severity === 'error' || d.severity === 'warning')
    if (filtered.length > 0) {
      result.diagnostics = filtered
    }
  }

  // Output language from filePath
  if (result.filePath) {
    result.outputLang = detectLanguage(result.filePath)
  }

  // Error：v2 是结构化对象，取 message（不是 JSON 串）
  if (state.status === 'error') {
    result.error = currentToolError(part)
  }

  // 失败判定：status 可以是 completed 但进程已经失败（shell 非零退出 / 超时）
  result.failed = currentToolFailed(part)

  // 文件类产出：官方按 media 渲染，这里交给渲染层以附件形式展示
  if (state.status === 'completed' || state.status === 'error') {
    const files = currentToolFiles(part)
    if (files.length > 0) {
      result.toolFiles = files.map(file => ({
        uri: file.uri,
        mime: file.mime,
        name: file.name,
      }))
    }
  }

  // Output：running → metadata.output；completed/error → content 文本片段
  const output = currentToolOutput(part)
  if (!result.files && !result.diff && output) {
    result.output = output

    // 推断语言
    if (!result.outputLang) {
      const trimmed = result.output.trim()
      if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        result.outputLang = 'json'
      }
    }
  }

  return result
}

// ============================================
// Tool-Specific Data Extractors
// ============================================

function bashExtractData(part: ToolViewPart): ExtractedToolData {
  const base = defaultExtractData(part)
  const input = currentToolInput(part)
  const metadata = currentToolMetadata(part)

  if (input.command) {
    base.input = String(input.command)
    base.inputLang = 'bash'
  }

  const cwd = input.workdir ?? input.cwd ?? metadata.workdir ?? metadata.cwd
  if (typeof cwd === 'string' && cwd.trim()) {
    base.cwd = cwd.trim()
  }

  return base
}

function readExtractData(part: ToolViewPart): ExtractedToolData {
  const base = defaultExtractData(part)

  if (base.output) {
    const str = String(base.output)
    const match = str.match(/<file[^>]*>([\s\S]*?)<\/file>/i)
    base.output = match ? match[1] : str
  }

  return base
}

function writeExtractData(part: ToolViewPart): ExtractedToolData {
  const base = defaultExtractData(part)
  const input = currentToolInput(part)

  // 从 input.content 构造 diff（和 editExtractData 一致）
  // 状态控制由渲染层（OutputBlock）统一处理，extractData 只做数据转换
  if (!base.files && !base.diff && typeof input.content === 'string') {
    base.diff = {
      before: '',
      after: input.content,
    }
  }

  return base
}

function editExtractData(part: ToolViewPart): ExtractedToolData {
  const base = defaultExtractData(part)
  const input = currentToolInput(part)

  // 如果 metadata 没有 diff，从 input 构造
  if (!base.files && !base.diff && input.oldString && input.newString) {
    base.diff = {
      before: String(input.oldString),
      after: String(input.newString),
    }
  }

  return base
}

// ============================================
// Tool Registry
// 按优先级排列，第一个匹配的配置生效
// ============================================

export const toolRegistry: ToolRegistry = [
  // Bash / Terminal
  {
    match: (name: string) => includes('bash', 'cmd', 'terminal', 'shell')(name) || exact('sh')(name),
    icon: <TerminalIcon />,
    extractData: bashExtractData,
    renderer: BashRenderer,
  },

  // Task / Subagent（v2 工具名 subagent；task 为旧名兼容）
  {
    match: exact('task', 'subagent'),
    icon: <TaskIcon />,
  },

  // Read file
  {
    match: includes('read', 'cat'),
    icon: <FileReadIcon />,
    extractData: readExtractData,
  },

  // List directory（官方 session-ui 有独立 ListRenderer；先精确命中图标，
  // 内容渲染待对齐）
  {
    match: exact('list'),
    icon: <FileReadIcon />,
  },

  // Skill 调用（官方 session-ui 有独立 SkillRenderer；先精确命中图标）
  {
    match: exact('skill'),
    icon: <BrainIcon />,
  },

  // Write file
  {
    match: includes('write', 'save'),
    icon: <FileWriteIcon />,
    extractData: writeExtractData,
  },

  // Edit file
  {
    match: includes('edit', 'replace', 'patch'),
    icon: <FileWriteIcon />,
    extractData: editExtractData,
  },

  // Search
  {
    match: includes('search', 'find', 'grep', 'glob'),
    icon: <SearchIcon />,
  },

  // Web / Network
  {
    match: includes('web', 'fetch', 'http', 'browse', 'network', 'exa'),
    icon: <GlobeIcon />,
  },

  // Think / Reasoning
  {
    match: includes('think', 'reason', 'plan'),
    icon: <BrainIcon />,
  },

  // Question
  {
    match: includes('question', 'ask'),
    icon: <QuestionIcon />,
    renderer: QuestionRenderer,
  },
]

// ============================================
// Registry Helpers
// ============================================

/**
 * 获取工具配置
 */
export function getToolConfig(toolName: string): ToolConfig | undefined {
  return toolRegistry.find(config => config.match(toolName))
}

/**
 * 获取工具图标
 */
export function getToolIcon(toolName: string): ReactNode {
  const config = getToolConfig(toolName)
  return config?.icon ?? <WrenchIcon />
}

/**
 * 提取工具数据
 */
export function extractToolData(part: ToolViewPart): ExtractedToolData {
  const config = getToolConfig(part.name)
  if (config?.extractData) {
    return config.extractData(part)
  }
  return defaultExtractData(part)
}
