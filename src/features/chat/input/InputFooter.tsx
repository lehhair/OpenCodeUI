import { memo, useState, useRef, useEffect, useLayoutEffect, useSyncExternalStore } from 'react'
import type { RefObject } from 'react'
import { CheckIcon, ClockIcon, CircleIcon, CloseIcon, FastForwardIcon } from '../../../components/Icons'
import { CircularProgress } from '../../../components/CircularProgress'
import { useTodos, useTodoStats, useCurrentTask, todoStore } from '../../../store'
import { getSessionTodos } from '../../../api/session'
import { autoApproveStore, type FullAutoMode } from '../../../store/autoApproveStore'
import type { TodoItem } from '../../../types/api/event'

// ============================================
// Full Auto 状态 hook
// ============================================

function useFullAutoMode(): FullAutoMode {
  return useSyncExternalStore(
    cb => autoApproveStore.onFullAutoChange(cb),
    () => autoApproveStore.fullAutoMode,
  )
}

// ============================================
// InputFooter - disclaimer + todo progress + full auto toggle
// ============================================

interface InputFooterProps {
  sessionId?: string | null
  onNewChat?: () => void
  inputContainerRef?: RefObject<HTMLDivElement | null>
}

export const InputFooter = memo(function InputFooter({ sessionId, onNewChat, inputContainerRef }: InputFooterProps) {
  const todos = useTodos(sessionId ?? null)
  const stats = useTodoStats(sessionId ?? null)
  const currentTask = useCurrentTask(sessionId ?? null)
  const [popoverOpen, setPopoverOpen] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)
  const loadedRef = useRef<string | null>(null)
  const fullAutoMode = useFullAutoMode()

  // 加载 session 时拉取初始 todos
  useEffect(() => {
    if (!sessionId || loadedRef.current === sessionId) return
    loadedRef.current = sessionId

    getSessionTodos(sessionId)
      .then(apiTodos => {
        if (apiTodos.length > 0) {
          todoStore.setTodos(sessionId, apiTodos)
        }
      })
      .catch(() => {})
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

  const taskLabel = currentTask
    ? currentTask.content
    : isAllDone
      ? 'All tasks done'
      : `${stats.total - stats.completed} remaining`

  return (
    <div
      className="relative flex h-full w-full items-center justify-center gap-2 text-[11px] leading-none text-text-500"
      ref={popoverRef}
    >
      {/* Full Auto 三态切换: off → session → global → off */}
      <button
        onClick={() => {
          if (fullAutoMode === 'off') {
            autoApproveStore.setFullAutoMode('session')
          } else if (fullAutoMode === 'session') {
            autoApproveStore.setFullAutoMode('global')
          } else {
            autoApproveStore.setFullAutoMode('off')
          }
        }}
        className="shrink-0 flex items-center justify-center hover:text-text-300 transition-colors"
        title={
          fullAutoMode === 'off'
            ? 'Auto-approve: off'
            : fullAutoMode === 'session'
              ? 'Auto-approve: this session · click for all sessions'
              : 'Auto-approve: all sessions · click to disable'
        }
      >
        <FastForwardIcon
          size={11}
          className={`transition-colors ${
            fullAutoMode === 'global'
              ? 'text-danger-100 drop-shadow-[0_0_4px_var(--color-danger-100)]'
              : fullAutoMode === 'session'
                ? 'text-warning-100 drop-shadow-[0_0_4px_var(--color-warning-100)]'
                : ''
          }`}
        />
      </button>

      <span className="text-text-500/30 shrink-0">·</span>

      {/* disclaimer / todos */}
      {!hasTodos ? (
        <button onClick={onNewChat} className="hover:text-text-300 transition-colors">
          Please verify AI responses.
        </button>
      ) : (
        <>
          <button
            onClick={() => setPopoverOpen(!popoverOpen)}
            className={`flex items-center gap-1.5 min-w-0 hover:text-text-300 transition-colors ${
              popoverOpen ? 'text-text-300' : ''
            }`}
          >
            <MiniProgress size={11} progress={progress} done={isAllDone} />
            <span className="tabular-nums shrink-0">
              {stats.completed}/{stats.total}
            </span>
            <span className="text-text-500/50 shrink-0">·</span>
            <span className="truncate max-w-[120px] sm:max-w-[200px]">{taskLabel}</span>
          </button>

          <span className="text-text-500/30 shrink-0">·</span>

          <button onClick={onNewChat} className="hover:text-text-300 transition-colors shrink-0">
            New Chat
          </button>
        </>
      )}

      {/* Todo Popover */}
      {popoverOpen && hasTodos && (
        <PopoverPanel inputContainerRef={inputContainerRef}>
          {/* 顶部区域：大进度环 + 统计 */}
          <div className="px-4 pt-4 pb-3 bg-gradient-to-b from-bg-200/50 to-transparent">
            <div className="flex items-center gap-4">
              <div className="relative">
                <CircularProgress
                  progress={progress}
                  size={48}
                  strokeWidth={3}
                  trackClassName="text-border-200/40"
                  progressClassName={`transition-all duration-700 ease-out ${isAllDone ? 'text-accent-secondary-100' : 'text-accent-main-100'}`}
                />
                <span
                  className={`absolute inset-0 flex items-center justify-center text-sm font-semibold ${
                    isAllDone ? 'text-accent-secondary-100' : 'text-text-200'
                  }`}
                >
                  {isAllDone ? <CheckIcon size={20} strokeWidth={2.5} /> : `${Math.round(progress * 100)}%`}
                </span>
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium text-text-100">
                  {isAllDone ? 'All Done' : `${stats.completed} of ${stats.total} tasks`}
                </div>
                <div className="text-xs text-text-500 mt-0.5">
                  {isAllDone
                    ? 'Great work!'
                    : stats.inProgress > 0
                      ? `${stats.inProgress} in progress`
                      : `${stats.total - stats.completed} remaining`}
                </div>
              </div>
            </div>
          </div>

          <div className="h-px bg-border-200/40 mx-3" />

          <div className="max-h-56 overflow-y-auto custom-scrollbar p-2">
            {todos.map(todo => (
              <TodoRow key={todo.id} todo={todo} />
            ))}
          </div>
        </PopoverPanel>
      )}
    </div>
  )
})

// ============================================
// PopoverPanel - 宽度对齐输入框的弹出面板
// ============================================

function PopoverPanel({
  inputContainerRef,
  children,
}: {
  inputContainerRef?: RefObject<HTMLDivElement | null>
  children: React.ReactNode
}) {
  const [style, setStyle] = useState<React.CSSProperties>({})
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const container = inputContainerRef?.current
    const footer = ref.current?.parentElement // popoverRef div
    if (!container || !footer) return

    const update = () => {
      const cRect = container.getBoundingClientRect()
      const fRect = footer.getBoundingClientRect()
      setStyle({
        width: cRect.width,
        left: cRect.left - fRect.left,
      })
    }
    update()

    const observer = new ResizeObserver(update)
    observer.observe(container)
    return () => observer.disconnect()
  }, [inputContainerRef])

  return (
    <div
      ref={ref}
      style={style}
      className="absolute bottom-full bg-bg-100 border border-border-200/50 rounded-2xl shadow-2xl shadow-black/20 overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-150 z-50"
    >
      {children}
    </div>
  )
}

// ============================================
// MiniProgress - 极小进度圆环
// ============================================

function MiniProgress({ size, progress, done }: { size: number; progress: number; done: boolean }) {
  return (
    <CircularProgress
      progress={progress}
      size={size}
      strokeWidth={1.5}
      trackClassName="text-text-500/30"
      progressClassName={done ? 'text-accent-secondary-100' : 'text-accent-main-100'}
      className="shrink-0 block"
    />
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
    <div
      className={`flex items-center gap-2 px-3 py-1.5 text-xs ${
        isCompleted ? 'text-text-500' : isInProgress ? 'text-text-100' : 'text-text-300'
      }`}
    >
      <span className="shrink-0 flex items-center justify-center w-[13px] h-[13px]">
        {isCompleted && <CheckIcon size={13} className="text-accent-secondary-100" strokeWidth={2.5} />}
        {isInProgress && <ClockIcon size={13} className="text-accent-main-100" />}
        {isCancelled && <CloseIcon size={13} className="text-text-500" />}
        {todo.status === 'pending' && <CircleIcon size={13} className="text-text-500" />}
      </span>
      <span className={`flex-1 ${isCompleted ? 'line-through' : ''}`}>{todo.content}</span>
      {todo.priority === 'high' && !isCompleted && (
        <span className="text-[10px] text-warning-100 bg-warning-100/10 px-1 rounded shrink-0">!</span>
      )}
    </div>
  )
})
