import { memo, useState, useRef, useEffect, useLayoutEffect, useSyncExternalStore, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
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

const TODO_SWAP_DURATION_MS = 260

// ============================================
// InputFooter - disclaimer + todo progress + full auto toggle
// ============================================

interface InputFooterProps {
  sessionId?: string | null
  onNewChat?: () => void
  inputContainerRef?: RefObject<HTMLDivElement | null>
}

export const InputFooter = memo(function InputFooter({ sessionId, onNewChat, inputContainerRef }: InputFooterProps) {
  const { t } = useTranslation(['chat', 'common'])
  const todos = useTodos(sessionId ?? null)
  const stats = useTodoStats(sessionId ?? null)
  const currentTask = useCurrentTask(sessionId ?? null)
  const [panelState, setPanelState] = useState<'closed' | 'opening' | 'open' | 'closing'>('closed')
  const popoverRef = useRef<HTMLDivElement>(null)
  const loadedRef = useRef<string | null>(null)
  const closeTimerRef = useRef<number | null>(null)
  const openingFrameRef = useRef<number | null>(null)
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

  const clearPanelTimers = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }

    if (openingFrameRef.current !== null) {
      cancelAnimationFrame(openingFrameRef.current)
      openingFrameRef.current = null
    }
  }, [])

  const hasTodos = stats.total > 0
  const isAllDone = stats.total > 0 && stats.completed === stats.total
  const progress = stats.total > 0 ? stats.completed / stats.total : 0
  const panelOpen = panelState === 'opening' || panelState === 'open'

  const taskLabel = currentTask
    ? currentTask.content
    : isAllDone
      ? t('inputFooter.allTasksDone')
      : t('inputFooter.remaining', { count: stats.total - stats.completed })

  const openPanel = useCallback(() => {
    if (!hasTodos) return

    clearPanelTimers()

    const inputContainer = inputContainerRef?.current
    const activeElement = document.activeElement
    if (inputContainer) {
      inputContainer.setAttribute('data-todo-swap', 'hidden')
      if (activeElement instanceof HTMLElement && inputContainer.contains(activeElement)) {
        activeElement.blur()
      }
    }

    setPanelState(current => {
      if (current === 'open' || current === 'opening') return current
      return 'opening'
    })
  }, [clearPanelTimers, hasTodos, inputContainerRef])

  const closePanel = useCallback(() => {
    clearPanelTimers()
    inputContainerRef?.current?.removeAttribute('data-todo-swap')

    setPanelState(current => {
      if (current === 'closed' || current === 'closing') return current
      return 'closing'
    })
  }, [clearPanelTimers, inputContainerRef])

  const togglePanel = useCallback(() => {
    if (panelOpen) {
      closePanel()
      return
    }

    openPanel()
  }, [closePanel, openPanel, panelOpen])

  // 点击外部关闭 panel
  useEffect(() => {
    if (panelState === 'closed') return

    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (popoverRef.current?.contains(target)) return
      if (inputContainerRef?.current?.contains(target)) return
      closePanel()
    }

    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [closePanel, inputContainerRef, panelState])

  useEffect(() => {
    if (panelState !== 'opening') return

    openingFrameRef.current = requestAnimationFrame(() => {
      openingFrameRef.current = null
      setPanelState(current => (current === 'opening' ? 'open' : current))
    })

    return () => {
      if (openingFrameRef.current !== null) {
        cancelAnimationFrame(openingFrameRef.current)
        openingFrameRef.current = null
      }
    }
  }, [panelState])

  useEffect(() => {
    if (panelState !== 'closing') return

    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null
      setPanelState(current => (current === 'closing' ? 'closed' : current))
    }, TODO_SWAP_DURATION_MS)

    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current)
        closeTimerRef.current = null
      }
    }
  }, [panelState])

  useEffect(() => {
    if (!hasTodos && panelState !== 'closed') {
      const timer = window.setTimeout(() => {
        closePanel()
      }, 0)

      return () => {
        window.clearTimeout(timer)
      }
    }
  }, [closePanel, hasTodos, panelState])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      closePanel()
    }, 0)

    return () => {
      window.clearTimeout(timer)
    }
  }, [closePanel, sessionId])

  useEffect(() => {
    const inputContainer = inputContainerRef?.current

    return () => {
      clearPanelTimers()
      inputContainer?.removeAttribute('data-todo-swap')
    }
  }, [clearPanelTimers, inputContainerRef])

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
            ? t('inputFooter.autoApproveOff')
            : fullAutoMode === 'session'
              ? t('inputFooter.autoApproveSession')
              : t('inputFooter.autoApproveGlobal')
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
          {t('inputFooter.pleaseVerify')}
        </button>
      ) : (
        <>
          <button
            onClick={togglePanel}
            className={`flex items-center gap-1.5 min-w-0 hover:text-text-300 transition-colors ${
              panelOpen ? 'text-text-300' : ''
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
            {t('sidebar.newChat')}
          </button>
        </>
      )}

      {/* Todo Swap Panel */}
      {panelState !== 'closed' && (
        <TodoSwapPanel inputContainerRef={inputContainerRef} open={panelState === 'open'}>
          <div className="px-5 pt-4 pb-3">
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
                  {isAllDone
                    ? t('inputFooter.allDone')
                    : t('inputFooter.tasksCount', { done: stats.completed, total: stats.total })}
                </div>
                <div className="mt-0.5 text-xs text-text-500">
                  {isAllDone
                    ? t('inputFooter.greatWork')
                    : stats.inProgress > 0
                      ? t('inputFooter.inProgress', { count: stats.inProgress })
                      : t('inputFooter.remaining', { count: stats.total - stats.completed })}
                </div>
              </div>
            </div>
          </div>

          <div className="mx-4 h-px bg-border-200/40" />

          <div className="max-h-64 overflow-y-auto custom-scrollbar px-3 py-2">
            {todos.map(todo => (
              <TodoRow key={todo.id} todo={todo} />
            ))}
          </div>
        </TodoSwapPanel>
      )}
    </div>
  )
})

// ============================================
// TodoSwapPanel - 对齐输入框的独立 todo 卡片
// ============================================

function TodoSwapPanel({
  inputContainerRef,
  open,
  children,
}: {
  inputContainerRef?: RefObject<HTMLDivElement | null>
  open: boolean
  children: React.ReactNode
}) {
  const [style, setStyle] = useState<React.CSSProperties>({})
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const container = inputContainerRef?.current
    const footer = ref.current?.parentElement
    if (!container || !footer) return

    const update = () => {
      const cRect = container.getBoundingClientRect()
      const fRect = footer.getBoundingClientRect()
      setStyle({
        width: cRect.width,
        left: cRect.left - fRect.left,
        bottom: fRect.bottom - cRect.bottom,
      })
    }
    update()

    const observer = new ResizeObserver(update)
    observer.observe(container)
    observer.observe(footer)
    window.addEventListener('resize', update)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [inputContainerRef])

  return (
    <div
      ref={ref}
      style={style}
      data-state={open ? 'open' : 'closed'}
      className="todo-swap-panel absolute glass-alt border border-border-200/60 rounded-2xl shadow-lg overflow-hidden z-50"
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
      className={`flex items-center gap-2 px-2 py-1.5 text-xs ${
        isCompleted ? 'text-text-500' : isInProgress ? 'text-text-100' : 'text-text-300'
      }`}
    >
      <span className="flex h-[13px] w-[13px] shrink-0 items-center justify-center">
        {isCompleted && <CheckIcon size={13} className="text-accent-secondary-100" strokeWidth={2.5} />}
        {isInProgress && <ClockIcon size={13} className="text-accent-main-100" />}
        {isCancelled && <CloseIcon size={13} className="text-text-500" />}
        {todo.status === 'pending' && <CircleIcon size={13} className="text-text-500" />}
      </span>
      <span className={`flex-1 ${isCompleted ? 'line-through' : ''}`}>{todo.content}</span>
      {todo.priority === 'high' && !isCompleted && (
        <span className="shrink-0 rounded bg-warning-100/10 px-1 text-[10px] text-warning-100">!</span>
      )}
    </div>
  )
})
