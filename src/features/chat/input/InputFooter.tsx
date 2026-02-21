import { memo, useState, useRef, useEffect } from 'react'
import { CheckIcon, ClockIcon, CircleIcon, CloseIcon } from '../../../components/Icons'
import { useTodos, useTodoStats, useCurrentTask, todoStore } from '../../../store'
import { getSessionTodos } from '../../../api/session'
import type { TodoItem } from '../../../types/api/event'

// ============================================
// InputFooter - disclaimer + todo progress
// ============================================
//
// 无 todos → 纯 disclaimer (点击 new chat)
// 有 todos → 左侧 todo 进度(点击弹 popover)，中间分隔点，右侧 new chat
//

interface InputFooterProps {
  sessionId?: string | null
  onNewChat?: () => void
}

export const InputFooter = memo(function InputFooter({ sessionId, onNewChat }: InputFooterProps) {
  const todos = useTodos(sessionId ?? null)
  const stats = useTodoStats(sessionId ?? null)
  const currentTask = useCurrentTask(sessionId ?? null)
  const [popoverOpen, setPopoverOpen] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)
  const loadedRef = useRef<string | null>(null)

  // 加载 session 时拉取初始 todos
  useEffect(() => {
    if (!sessionId || loadedRef.current === sessionId) return
    loadedRef.current = sessionId

    getSessionTodos(sessionId).then(apiTodos => {
      if (apiTodos.length > 0) {
        todoStore.setTodos(sessionId, apiTodos)
      }
    }).catch(() => {})
  }, [sessionId])

  // 点击外部关闭 popover
  useEffect(() => {
    if (!popoverOpen) return
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setPopoverOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [popoverOpen])

  const hasTodos = stats.total > 0
  const isAllDone = stats.completed === stats.total
  const progress = stats.total > 0 ? stats.completed / stats.total : 0

  // 无 todos：原版 disclaimer
  if (!hasTodos) {
    return (
      <div className="flex justify-center pt-2 text-text-500">
        <button
          onClick={onNewChat}
          className="text-[11px] hover:text-text-300 transition-colors text-center"
        >
          AI can make mistakes. Please double-check responses.
        </button>
      </div>
    )
  }

  // 有 todos：左侧进度 + 右侧 new chat
  const taskLabel = currentTask
    ? currentTask.content
    : isAllDone
      ? 'All tasks done'
      : `${stats.total - stats.completed} remaining`

  return (
    <div className="flex items-center justify-center gap-2 pt-1 md:pt-2 text-[11px] text-text-500 relative" ref={popoverRef}>
      {/* 左侧：todo 进度 */}
      <button
        onClick={() => setPopoverOpen(!popoverOpen)}
        className={`flex items-center gap-1.5 hover:text-text-300 transition-colors ${
          popoverOpen ? 'text-text-300' : ''
        }`}
      >
        <MiniProgress size={12} progress={progress} done={isAllDone} />
        <span className="tabular-nums">{stats.completed}/{stats.total}</span>
        <span className="text-text-500/50">·</span>
        <span className="truncate max-w-[200px]">{taskLabel}</span>
      </button>

      {/* 分隔 */}
      <span className="text-text-500/30">·</span>

      {/* 右侧：new chat */}
      <button
        onClick={onNewChat}
        className="hover:text-text-300 transition-colors shrink-0"
      >
        New Chat
      </button>

      {/* Popover */}
      {popoverOpen && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-80 bg-bg-100 border border-border-200/50 rounded-2xl shadow-2xl shadow-black/20 overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-150 z-50">
          {/* 顶部区域：大进度环 + 统计 */}
          <div className="px-4 pt-4 pb-3 bg-gradient-to-b from-bg-200/50 to-transparent">
            <div className="flex items-center gap-4">
              {/* 大进度环 */}
              <div className="relative">
                <svg width={48} height={48} className="-rotate-90">
                  <circle cx={24} cy={24} r={20} fill="none" stroke="currentColor" strokeWidth="3" className="text-border-200/40" />
                  <circle cx={24} cy={24} r={20} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"
                    strokeDasharray={2 * Math.PI * 20} strokeDashoffset={2 * Math.PI * 20 * (1 - progress)}
                    className={`transition-all duration-700 ease-out ${isAllDone ? 'text-accent-secondary-100' : 'text-accent-main-100'}`}
                  />
                </svg>
                <span className={`absolute inset-0 flex items-center justify-center text-sm font-semibold ${
                  isAllDone ? 'text-accent-secondary-100' : 'text-text-200'
                }`}>
                  {isAllDone ? <CheckIcon size={20} strokeWidth={2.5} /> : `${Math.round(progress * 100)}%`}
                </span>
              </div>
              
              {/* 统计文字 */}
              <div className="flex-1">
                <div className="text-sm font-medium text-text-100">
                  {isAllDone ? 'All Done' : `${stats.completed} of ${stats.total} tasks`}
                </div>
                <div className="text-xs text-text-500 mt-0.5">
                  {isAllDone 
                    ? 'Great work!' 
                    : stats.inProgress > 0 
                      ? `${stats.inProgress} in progress` 
                      : `${stats.total - stats.completed} remaining`
                  }
                </div>
              </div>
            </div>
          </div>

          {/* 分隔线 */}
          <div className="h-px bg-border-200/40 mx-3" />

          {/* Todo 列表 */}
          <div className="max-h-56 overflow-y-auto custom-scrollbar p-2">
            {todos.map((todo) => (
              <TodoRow key={todo.id} todo={todo} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
})

// ============================================
// MiniProgress - 极小进度圆环 (12px)
// ============================================

function MiniProgress({ size, progress, done }: { size: number; progress: number; done: boolean }) {
  const r = (size - 2) / 2
  const c = 2 * Math.PI * r
  const offset = c * (1 - progress)

  return (
    <svg width={size} height={size} className="-rotate-90 shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-500/30" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={offset}
        className={`transition-all duration-500 ${done ? 'text-accent-secondary-100' : 'text-accent-main-100'}`}
      />
    </svg>
  )
}

// ============================================
// TodoRow
// ============================================

const TodoRow = memo(function TodoRow({ todo }: { todo: TodoItem }) {
  const isCompleted = todo.status === 'completed'
  const isInProgress = todo.status === 'in_progress'
  const isCancelled = todo.status === 'cancelled'

  return (
    <div className={`flex items-start gap-2 px-3 py-1.5 text-xs ${
      isCompleted ? 'text-text-500' : isInProgress ? 'text-text-100' : 'text-text-300'
    }`}>
      <span className="shrink-0 mt-[1px]">
        {isCompleted && <CheckIcon size={13} className="text-accent-secondary-100" strokeWidth={2.5} />}
        {isInProgress && <ClockIcon size={13} className="text-accent-main-100" />}
        {isCancelled && <CloseIcon size={13} className="text-text-500" />}
        {todo.status === 'pending' && <CircleIcon size={13} className="text-text-500" />}
      </span>
      <span className={`flex-1 leading-relaxed ${isCompleted ? 'line-through' : ''}`}>
        {todo.content}
      </span>
      {todo.priority === 'high' && !isCompleted && (
        <span className="text-[10px] text-warning-100 bg-warning-100/10 px-1 rounded shrink-0 mt-[1px]">!</span>
      )}
    </div>
  )
})
