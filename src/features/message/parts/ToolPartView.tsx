import { memo, useState } from 'react'
import { ChevronDownIcon, ChevronRightIcon } from '../../../components/Icons'
import type { ToolPart } from '../../../types/message'
import { useDelayedRender } from '../../../hooks'
import { 
  getToolIcon, 
  extractToolData, 
  getToolConfig,
  DefaultRenderer,
  TodoRenderer,
  TaskRenderer,
  hasTodos,
} from '../tools'

// ============================================
// ToolPartView - 单个工具调用
// ============================================

interface ToolPartViewProps {
  part: ToolPart
  isFirst?: boolean
  isLast?: boolean
}

export const ToolPartView = memo(function ToolPartView({ part, isFirst = false, isLast = false }: ToolPartViewProps) {
  const [expanded, setExpanded] = useState(() => {
    return part.state.status === 'running' || part.state.status === 'pending'
  })
  const shouldRenderBody = useDelayedRender(expanded)
  
  const { state, tool: toolName } = part
  const title = state.title || ''
  
  const duration = state.time?.start && state.time?.end 
    ? state.time.end - state.time.start 
    : undefined

  const isActive = state.status === 'running' || state.status === 'pending'
  const isError = state.status === 'error'

  return (
    <div className={`group min-w-0 ${isFirst ? '' : 'mt-0.5'} ${isLast ? '' : ''}`}>
      <button
        className="flex items-center gap-2 w-full h-9 text-left px-0 hover:bg-bg-200/30 rounded-md transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className={`relative flex items-center justify-center transition-colors duration-200 shrink-0 ${
          isActive ? 'text-accent-main-100' : ''
        } ${
          isError ? 'text-danger-100' : ''
        } ${
          state.status === 'completed' ? 'text-text-400 group-hover:text-text-300' : ''
        }`}>
          {isActive && (
            <span className="absolute inset-0 rounded-full bg-accent-main-100/20 animate-ping" style={{ animationDuration: '1.5s' }} />
          )}
          {getToolIcon(toolName)}
        </div>

        <div className="flex items-center gap-2 overflow-hidden flex-1 min-w-0">
          <span className={`font-medium text-[13px] leading-tight transition-colors duration-300 shrink-0 ${
            isActive ? 'text-accent-main-100' :
            isError ? 'text-danger-100' :
            'text-text-200 group-hover:text-text-100'
          }`}>
            {formatToolName(toolName)}
          </span>

          {title && (
            <span className="text-xs text-text-400 truncate opacity-70">
              {title}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 ml-auto shrink-0">
          {duration !== undefined && state.status === 'completed' && (
            <span className="text-[10px] text-text-500 tabular-nums transition-opacity duration-300">
              {formatDuration(duration)}
            </span>
          )}
          <span className={`text-[10px] font-medium transition-all duration-300 ${
            isActive ? 'opacity-100 text-accent-main-100' : 'opacity-0 w-0 overflow-hidden'
          }`}>
            Running
          </span>
          <span className={`text-[10px] font-medium transition-all duration-300 ${
            isError ? 'opacity-100 text-danger-100' : 'opacity-0 w-0 overflow-hidden'
          }`}>
            Failed
          </span>
          <span className="text-text-500">
            {expanded ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
          </span>
        </div>
      </button>

      <div className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
        expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
      }`}>
        <div className="overflow-hidden">
          {shouldRenderBody && (
            <div className="px-0 pb-2 pt-1">
              <ToolBody part={part} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
})

// ============================================
// ToolBody - 根据工具类型选择渲染器
// ============================================

function ToolBody({ part }: { part: ToolPart }) {
  const { tool } = part
  const lowerTool = tool.toLowerCase()
  const data = extractToolData(part)
  
  if (lowerTool === 'task') {
    return <TaskRenderer part={part} data={data} />
  }
  
  if (lowerTool.includes('todo') && hasTodos(part)) {
    return <TodoRenderer part={part} data={data} />
  }
  
  const config = getToolConfig(tool)
  if (config?.renderer) {
    const CustomRenderer = config.renderer
    return <CustomRenderer part={part} data={data} />
  }
  
  return <DefaultRenderer part={part} data={data} />
}

// ============================================
// Helpers
// ============================================

function formatToolName(name: string): string {
  return name
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}
