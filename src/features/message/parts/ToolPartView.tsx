import { memo, useState } from 'react'
import { ChevronDownIcon } from '../../../components/Icons'
import { ContentBlock } from '../../../components'
import { getToolIcon } from '../../../utils/toolUtils'
import { detectLanguage } from '../../../utils/languageUtils'
import type { ToolPart } from '../../../types/message'

interface ToolPartViewProps {
  part: ToolPart
  isFirst?: boolean
  isLast?: boolean
}

// ============================================
// Helpers
// ============================================

function formatToolName(name: string): string {
  // Convert snake_case or kebab-case to Title Case
  return name
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export const ToolPartView = memo(function ToolPartView({ part, isFirst = false, isLast = false }: ToolPartViewProps) {
  const [expanded, setExpanded] = useState(() => {
    return part.state.status === 'running' || part.state.status === 'pending'
  })
  
  const { state, tool: toolName } = part
  const title = state.title || ''
  
  const duration = state.time?.start && state.time?.end 
    ? state.time.end - state.time.start 
    : undefined

  // Header height assumption: py-2 + line-height ~ 36px
  const headerHeightClass = "h-9" 
  
  // Status Color Logic
  const isActive = state.status === 'running' || state.status === 'pending'
  
  const getStatusClasses = () => {
    if (isActive) return 'text-accent-main-100'
    if (state.status === 'error') return 'text-danger-100'
    if (state.status === 'completed') return 'text-text-200 group-hover/header:text-text-100'
    return 'text-text-200 group-hover/header:text-text-100'
  }
  
  const statusClass = getStatusClasses()

  return (
    <div className="group relative flex">
      {/* Timeline Column */}
      <div className="w-6 shrink-0 relative flex flex-col items-center">
        {/* Line Up - 6px long */}
        {!isFirst && (
          <div className="absolute top-0 h-1.5 w-px bg-border-300/30" />
        )}
        
        {/* Line Down - start at 30px (18 + 12) */}
        {!isLast && (
          <div className="absolute top-[30px] bottom-0 w-px bg-border-300/30" />
        )}
        
        {/* Main Tool Icon Node - Center at 18px */}
        <div className="absolute top-[18px] -translate-y-1/2 z-10">
          <div className={`
            flex items-center justify-center transition-colors duration-200
            ${isActive ? 'text-accent-main-100 animate-pulse-slow' : ''}
            ${state.status === 'error' ? 'text-danger-100' : ''}
            ${state.status === 'completed' ? 'text-text-400 group-hover:text-text-300' : ''} 
          `}>
            {getToolIcon(toolName)}
          </div>
        </div>
      </div>

      {/* Content Column */}
      <div className="flex-1 min-w-0 pb-1">
        {/* Header */}
        <button
          className={`flex items-center gap-3 w-full text-left px-2 hover:bg-bg-200/50 rounded-lg transition-colors group/header ${headerHeightClass}`}
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex items-center gap-2 overflow-hidden flex-1">
            <span className={`font-medium text-sm transition-colors ${statusClass}`}>
              {formatToolName(toolName)}
            </span>
            
            {title && (
              <span className="text-xs text-text-400 truncate font-mono opacity-80 max-w-[60%]">
                {title}
              </span>
            )}
          </div>
            
          <div className="flex items-center gap-3 ml-auto shrink-0">
            {duration !== undefined && state.status === 'completed' && (
              <span className="text-[10px] font-mono text-text-500 tabular-nums opacity-60">
                {formatDuration(duration)}
              </span>
            )}
            {isActive && (
              <span className="text-[10px] font-medium text-accent-main-100 animate-pulse-slow">
                Running...
              </span>
            )}
            {state.status === 'error' && (
              <span className="text-[10px] font-medium text-danger-100">
                Failed
              </span>
            )}
            <span className={`text-text-500 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}>
              <ChevronDownIcon size={12} />
            </span>
          </div>
        </button>

        {/* Body */}
        <div className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
          expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}>
          <div className="overflow-hidden">
            <div className="py-2 px-2">
              <ToolBody part={part} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
})

// ============================================
// Tool Body
// ============================================

function ToolBody({ part }: ToolPartViewProps) {
  const { tool, state } = part
  const lowerTool = tool.toLowerCase()
  
  // Todo 特殊渲染
  if (lowerTool.includes('todo')) {
    const todos = extractTodos(part)
    if (todos.length > 0) {
      return <TodoList todos={todos} />
    }
  }
  
  // 通用渲染
  const data = extractData(part)
  const isActive = state.status === 'running' || state.status === 'pending'
  const hasInput = !!data.input
  const hasError = !!data.error
  const hasOutput = !!(data.files || data.diff || data.output || data.exitCode !== undefined)
  
  // 是否显示 Input block（有 input 或正在等待 input）
  const showInput = hasInput || isActive
  // 是否显示 Output block（有 input 后才显示）
  const showOutput = hasInput && (hasOutput || hasError || isActive)
  
  return (
    <div className="flex flex-col gap-3">
      {/* Input - loading 状态在 ContentBlock 内部处理 */}
      {showInput && (
        <ContentBlock 
          label="Input"
          content={data.input || ''}
          language={data.inputLang}
          isLoading={isActive && !hasInput}
          loadingText=""
          // 如果 Input 内容过长，默认折叠
          defaultCollapsed={(data.input?.length || 0) > 1000}
        />
      )}
      
      {/* Output - loading/error 在 ContentBlock 内部处理 */}
      {showOutput && (
        hasError ? (
          <ContentBlock 
            label="Error"
            content={data.error || ''}
            variant="error"
          />
        ) : hasOutput ? (
          data.files ? (
            <div className="space-y-3">
              {data.files.map((file, idx) => (
                <ContentBlock 
                  key={idx}
                  label={formatToolName(tool) + ' Result'}
                  filePath={file.filePath}
                  // 优先用 diff 字符串，其次用 before/after 对象
                  diff={file.diff || (file.before !== undefined && file.after !== undefined ? { before: file.before, after: file.after } : undefined)}
                  language={detectLanguage(file.filePath)}
                />
              ))}
            </div>
          ) : data.diff ? (
            <ContentBlock 
              label="Output"
              filePath={data.filePath}
              diff={data.diff}
              language={data.outputLang}
            />
          ) : (
            <ContentBlock 
              label="Output"
              content={data.output}
              language={data.outputLang}
              filePath={data.filePath}
              stats={data.exitCode !== undefined ? { exit: data.exitCode } : undefined}
            />
          )
        ) : (
          <ContentBlock 
            label="Output"
            isLoading={isActive}
            loadingText="Running..."
          />
        )
      )}
    </div>
  )
}

// ============================================
// TodoList
// ============================================

interface TodoItem {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  priority: 'high' | 'medium' | 'low'
}

function TodoList({ todos }: { todos: TodoItem[] }) {
  const [collapsed, setCollapsed] = useState(false)
  const completed = todos.filter(t => t.status === 'completed').length
  const total = todos.length
  
  return (
    <div className="border border-border-200/50 rounded-lg overflow-hidden bg-bg-100 text-xs">
      {/* Header */}
      <div 
        className="flex items-center justify-between px-3 py-1.5 bg-bg-200/50 hover:bg-bg-200 cursor-pointer select-none transition-colors"
        onClick={() => setCollapsed(!collapsed)}
      >
        <div className="flex items-center gap-2">
          <span className={`text-text-400 transition-transform duration-200 ${collapsed ? '' : 'rotate-180'}`}>
            <ChevronDownIcon />
          </span>
          <span className="text-text-300 font-medium font-mono">Tasks</span>
        </div>
        <span className="text-text-500 tabular-nums font-mono">{completed}/{total}</span>
      </div>
      
      {/* List - 使用 grid 实现平滑展开动画 */}
      <div className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
        collapsed ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]'
      }`}>
        <div className="overflow-hidden">
          <div className="divide-y divide-border-200/30">
            {todos.map(todo => (
              <div 
                key={todo.id}
                className={`flex items-start gap-2 px-3 py-2 ${
                  todo.status === 'completed' ? 'text-text-500' : 'text-text-200'
                }`}
              >
                <span className="shrink-0 mt-0.5">{getTodoIcon(todo.status)}</span>
                <span className={todo.status === 'completed' ? 'line-through' : ''}>
                  {todo.content}
                </span>
                {todo.priority === 'high' && todo.status !== 'completed' && (
                  <span className="text-[10px] text-warning-100 bg-warning-100/10 px-1 rounded ml-auto shrink-0">!</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function getTodoIcon(status: TodoItem['status']) {
  const size = 14
  const cls = {
    completed: 'text-accent-secondary-100',
    in_progress: 'text-accent-main-100',
    cancelled: 'text-text-500',
    pending: 'text-text-500',
  }[status]
  
  switch (status) {
    case 'completed':
      return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={cls}><path d="M20 6L9 17l-5-5"/></svg>
    case 'in_progress':
      return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={cls}><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
    case 'cancelled':
      return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={cls}><path d="M18 6L6 18M6 6l12 12"/></svg>
    default:
      return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={cls}><circle cx="12" cy="12" r="10"/></svg>
  }
}

// ============================================
// Helpers
// ============================================

function extractTodos(part: ToolPart): TodoItem[] {
  const { state } = part
  const metadata = state.metadata as Record<string, unknown> | undefined
  const inputObj = state.input as Record<string, unknown> | undefined
  return (metadata?.todos as TodoItem[]) || (inputObj?.todos as TodoItem[]) || []
}

interface FileDiff {
  filePath: string
  diff?: string
  before?: string
  after?: string
  additions?: number
  deletions?: number
}

interface ExtractedData {
  input?: string
  inputLang?: string
  output?: string
  outputLang?: string
  error?: string
  diff?: { before: string; after: string } | string
  files?: FileDiff[]
  filePath?: string
  exitCode?: number
}

function extractData(part: ToolPart): ExtractedData {
  const { state, tool } = part
  const inputObj = state.input as Record<string, unknown> | undefined
  const metadata = state.metadata
  const lowerTool = tool.toLowerCase()
  
  const result: ExtractedData = {}
  
  // Input
  if (inputObj && Object.keys(inputObj).length > 0) {
    if (lowerTool === 'bash' && inputObj.command) {
      result.input = String(inputObj.command)
      result.inputLang = 'bash'
    } else {
      result.input = JSON.stringify(inputObj, null, 2)
      result.inputLang = 'json'
    }
  }
  
  // Error
  if (state.error) {
    if (typeof state.error === 'string') {
      result.error = state.error
    } else if (typeof state.error === 'object' && 'data' in state.error) {
      result.error = String(state.error.data) || state.error.name
    }
  }
  
  // FilePath
  if (metadata && typeof metadata.filepath === 'string') {
    result.filePath = metadata.filepath
  }
  if (!result.filePath && inputObj?.filePath) {
    result.filePath = String(inputObj.filePath)
  }
  
  // Exit code
  if (metadata && typeof metadata.exit === 'number') {
    result.exitCode = metadata.exit
  }
  
  // Diff / Files (from metadata)
  if (metadata) {
    // 优先 1: metadata.files (结构化多文件 diff)
    if (Array.isArray(metadata.files) && metadata.files.length > 0) {
      result.files = metadata.files.map((f: any) => ({
        filePath: f.filePath || f.file || 'unknown',
        diff: f.diff,
        before: f.before,
        after: f.after,
        additions: f.additions,
        deletions: f.deletions,
      }))
    }
    // 优先 2: unified diff 字符串
    else if (typeof metadata.diff === 'string') {
      result.diff = metadata.diff
    } 
    // 优先 3: legacy filediff 对象
    else if (metadata.filediff) {
      const fd = metadata.filediff as { before: string; after: string }
      result.diff = { before: fd.before, after: fd.after }
    }
  }
  
  // Output language
  if (result.filePath) {
    result.outputLang = detectLanguage(result.filePath)
  }
  
  // Output (不是 diff 时)
  // 注意：如果有了 files 或 diff，通常就不需要显示纯文本 output 了
  if (!result.files && !result.diff) {
    // 增强 Edit 工具的展示：如果 metadata 中没有 diff，尝试从 input 中构造
    if ((lowerTool === 'edit' || lowerTool === 'replace') && inputObj?.oldString && inputObj?.newString) {
      result.diff = {
        before: String(inputObj.oldString),
        after: String(inputObj.newString)
      }
    } 
    else if (state.output) {
      if (tool === 'read') {
        const str = String(state.output)
        const match = str.match(/<file[^>]*>([\s\S]*?)<\/file>/i)
        result.output = match ? match[1] : str
      } else if (tool === 'write' && inputObj?.content) {
        result.output = String(inputObj.content)
      } else {
        result.output = typeof state.output === 'string' 
          ? state.output 
          : JSON.stringify(state.output, null, 2)
      }
      
      // 推断语言
      if (!result.outputLang && result.output) {
        const trimmed = result.output.trim()
        if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
            (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
          result.outputLang = 'json'
        }
      }
    }
  }
  
  return result
}