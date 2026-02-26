import { useState } from 'react'
import { ChevronDownIcon, CheckIcon, ClockIcon, CloseIcon, CircleIcon } from '../../../../components/Icons'
import type { ToolPart } from '../../../../types/message'
import type { ToolRendererProps } from '../types'
import { useDelayedRender } from '../../../../hooks'

// ============================================
// Types
// ============================================

interface TodoItem {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  priority: 'high' | 'medium' | 'low'
}

// ============================================
// Todo Renderer
// ============================================

export function TodoRenderer({ part }: ToolRendererProps) {
  const todos = extractTodos(part)
  
  if (todos.length === 0) {
    return null
  }
  
  return <TodoList todos={todos} />
}

// ============================================
// TodoList Component
// ============================================

function TodoList({ todos }: { todos: TodoItem[] }) {
  const [collapsed, setCollapsed] = useState(false)
  const shouldRenderBody = useDelayedRender(!collapsed)
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
      
      {/* List */}
      <div className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
        collapsed ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]'
      }`}>
        <div className="overflow-hidden">
          {shouldRenderBody && (
            <div className="divide-y divide-border-200/30">
              {todos.map(todo => (
                <div 
                  key={todo.id}
                  className={`flex items-center gap-2 px-3 py-2 ${
                    todo.status === 'completed' ? 'text-text-500' : 'text-text-200'
                  }`}
                >
                  <span className="shrink-0 flex items-center">{getTodoIcon(todo.status)}</span>
                  <span className={todo.status === 'completed' ? 'line-through' : ''}>
                    {todo.content}
                  </span>
                  {todo.priority === 'high' && todo.status !== 'completed' && (
                    <span className="text-[10px] text-warning-100 bg-warning-100/10 px-1 rounded ml-auto shrink-0">!</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
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
      return <CheckIcon size={size} className={cls} strokeWidth={2.5} />
    case 'in_progress':
      return <ClockIcon size={size} className={cls} />
    case 'cancelled':
      return <CloseIcon size={size} className={cls} />
    default:
      return <CircleIcon size={size} className={cls} />
  }
}

/**
 * 检查是否有 todos 可渲染
 */
export function hasTodos(part: ToolPart): boolean {
  return extractTodos(part).length > 0
}
