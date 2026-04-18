import { useRef, useEffect, useCallback, useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { SearchIcon, PencilIcon, TrashIcon, ComposeIcon, CheckIcon } from '../../components/Icons'
import { formatRelativeTime } from '../../utils/dateUtils'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { useInputCapabilities } from '../../hooks/useInputCapabilities'
import { useSessionActiveEntry } from '../../store/activeSessionStore'
import { notificationStore, useHasUnreadCompletedNotification } from '../../store/notificationStore'
import { SessionChildrenSlot } from '../chat/sidebar/SessionChildrenSlot'
import type { ApiSession } from '../../api'

interface SessionListProps {
  sessions: ApiSession[]
  selectedId: string | null
  isLoading: boolean
  isLoadingMore: boolean
  hasMore: boolean
  search: string
  onSearchChange: (search: string) => void
  onSelect: (session: ApiSession) => void
  onDelete: (sessionId: string) => void
  onRename: (sessionId: string, newTitle: string) => void
  onLoadMore: () => void
  onNewChat: () => void
  showHeader?: boolean
  grouped?: boolean
  density?: 'default' | 'compact' | 'minimal'
  showStats?: boolean
  showDirectory?: boolean
  /** 拉 /children 全量展示的父 session ID */
  expandedChildSessionIds?: Set<string>
  /** 按父 ID 分组的直接挂出来的子 session */
  inlineChildSessions?: Map<string, ApiSession[]>
  onSelectChildSession?: (session: ApiSession) => void
  // ---- 编辑模式 ----
  isEditMode?: boolean
  selectedSessionIds?: Set<string>
  onToggleSessionSelection?: (sessionId: string, options?: { shiftKey?: boolean }) => void
}

// 时间分组类型
type TimeGroup = 'today' | 'yesterday' | 'previous7Days' | 'previous30Days' | 'older'

const SESSION_GROUP_ORDER: TimeGroup[] = ['today', 'yesterday', 'previous7Days', 'previous30Days', 'older']

export function SessionList({
  sessions,
  selectedId,
  isLoading,
  isLoadingMore,
  hasMore,
  search,
  onSearchChange,
  onSelect,
  onDelete,
  onRename,
  onLoadMore,
  onNewChat,
  showHeader = true,
  grouped = true,
  density = 'default',
  showStats = true,
  showDirectory = false,
  expandedChildSessionIds,
  inlineChildSessions,
  onSelectChildSession,
  isEditMode = false,
  selectedSessionIds,
  onToggleSessionSelection,
}: SessionListProps) {
  const { t } = useTranslation(['commands', 'common', 'chat'])
  const { preferTouchUi } = useInputCapabilities()
  const listRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; sessionId: string | null }>({
    isOpen: false,
    sessionId: null,
  })

  // 滚动加载
  const handleScroll = useCallback(() => {
    const el = listRef.current
    if (!el || isLoadingMore || !hasMore) return

    const { scrollTop, scrollHeight, clientHeight } = el
    if (scrollHeight - scrollTop - clientHeight < 100) {
      onLoadMore()
    }
  }, [isLoadingMore, hasMore, onLoadMore])

  useEffect(() => {
    const el = listRef.current
    if (!el) return
    el.addEventListener('scroll', handleScroll)
    return () => el.removeEventListener('scroll', handleScroll)
  }, [handleScroll])

  // 分组逻辑
  const groupedSessions = useMemo(() => {
    const groups: Record<TimeGroup, ApiSession[]> = {
      today: [],
      yesterday: [],
      previous7Days: [],
      previous30Days: [],
      older: [],
    }

    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const yesterday = today - 86400000
    const weekAgo = today - 86400000 * 7
    const monthAgo = today - 86400000 * 30

    sessions.forEach(session => {
      const updated = session.time.updated ?? session.time.created
      if (updated >= today) {
        groups.today.push(session)
      } else if (updated >= yesterday) {
        groups.yesterday.push(session)
      } else if (updated >= weekAgo) {
        groups.previous7Days.push(session)
      } else if (updated >= monthAgo) {
        groups.previous30Days.push(session)
      } else {
        groups.older.push(session)
      }
    })

    return groups
  }, [sessions])

  const isCompact = density === 'compact'

  // 只有非搜索状态才显示分组
  const showGroups = !search && grouped

  return (
    <div className="flex flex-col h-full">
      {/* Search Bar + New Chat */}
      {showHeader && (
        <div className="px-3 pb-2 flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="relative group flex-1">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-text-400 w-3.5 h-3.5 group-focus-within:text-accent-main-100 transition-colors" />
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={e => onSearchChange(e.target.value)}
                placeholder={t('sessions.searchChats')}
                className="w-full bg-bg-200/40 hover:bg-bg-200/80 focus:bg-bg-000 border border-transparent focus:border-border-200 rounded-lg py-2 pl-9 pr-3 text-[length:var(--fs-sm)] text-text-100 placeholder:text-text-400/70 focus:outline-none focus:shadow-sm transition-all duration-200"
              />
            </div>
            <button
              onClick={onNewChat}
              title={t('sessions.newChat')}
              className="p-2 rounded-lg bg-bg-200/40 hover:bg-bg-200/80 text-text-400 hover:text-text-100 transition-all duration-200"
            >
              <ComposeIcon size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Session List */}
      <div
        ref={listRef}
        className={`flex-1 overflow-y-auto custom-scrollbar px-2 ${isCompact ? 'pb-3 space-y-2' : 'pb-4 space-y-4'}`}
      >
        {isLoading && sessions.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <LoadingSpinner />
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-text-400 opacity-60">
            <p className="text-[length:var(--fs-sm)]">
              {search ? t('common:noMatchesFound') : t('sessions.noChatsYet')}
            </p>
          </div>
        ) : showGroups ? (
          // Grouped View
          SESSION_GROUP_ORDER.map(group => {
            const groupSessions = groupedSessions[group]
            if (groupSessions.length === 0) return null
            return (
              <div key={group}>
                <h3 className="px-3 mb-1.5 mt-2 text-[length:var(--fs-xxs)] font-bold text-text-400/60 uppercase tracking-widest select-none">
                  {t(`sessions.groups.${group}`)}
                </h3>
                <div className="space-y-0.5">
                  {groupSessions.map(session => (
                    <div key={session.id}>
                      <SessionListItem
                        session={session}
                        isSelected={session.id === selectedId}
                        onSelect={() => onSelect(session)}
                        onDelete={() => setDeleteConfirm({ isOpen: true, sessionId: session.id })}
                        onRename={newTitle => onRename(session.id, newTitle)}
                        preferTouchUi={preferTouchUi}
                        density={density}
                        showStats={showStats}
                        showDirectory={showDirectory}
                        isEditMode={isEditMode}
                        isChecked={selectedSessionIds?.has(session.id)}
                        onToggleCheck={
                          onToggleSessionSelection
                            ? options => onToggleSessionSelection(session.id, options)
                            : undefined
                        }
                      />
                      {onSelectChildSession &&
                        (expandedChildSessionIds?.has(session.id) || inlineChildSessions?.has(session.id)) && (
                          <SessionChildrenSlot
                            parentSession={session}
                            selectedSessionId={selectedId}
                            fetchAll={expandedChildSessionIds?.has(session.id)}
                            children={inlineChildSessions?.get(session.id)}
                            onSelect={onSelectChildSession}
                            isEditMode={isEditMode}
                            selectedSessionIds={selectedSessionIds}
                            onToggleSessionSelection={onToggleSessionSelection}
                          />
                        )}
                    </div>
                  ))}
                </div>
              </div>
            )
          })
        ) : (
          // Flat View
          <div className="space-y-0.5 mt-1">
            {sessions.map(session => {
              const inlineChildren = inlineChildSessions?.get(session.id)
              const shouldFetchAll = expandedChildSessionIds?.has(session.id)
              const hasChildren = shouldFetchAll || (inlineChildren && inlineChildren.length > 0)
              return (
                <div key={session.id}>
                  <SessionListItem
                    session={session}
                    isSelected={session.id === selectedId}
                    onSelect={() => onSelect(session)}
                    onDelete={() => setDeleteConfirm({ isOpen: true, sessionId: session.id })}
                    onRename={newTitle => onRename(session.id, newTitle)}
                    preferTouchUi={preferTouchUi}
                    density={density}
                    showStats={showStats}
                    showDirectory={showDirectory}
                    isEditMode={isEditMode}
                    isChecked={selectedSessionIds?.has(session.id)}
                    onToggleCheck={
                      onToggleSessionSelection ? options => onToggleSessionSelection(session.id, options) : undefined
                    }
                  />
                  {hasChildren && onSelectChildSession && (
                    <SessionChildrenSlot
                      parentSession={session}
                      selectedSessionId={selectedId}
                      fetchAll={shouldFetchAll}
                      children={inlineChildren}
                      onSelect={onSelectChildSession}
                      isEditMode={isEditMode}
                      selectedSessionIds={selectedSessionIds}
                      onToggleSessionSelection={onToggleSessionSelection}
                    />
                  )}
                </div>
              )
            })}
          </div>
        )}

        {isLoadingMore && (
          <div className="flex items-center justify-center py-2">
            <LoadingSpinner size="sm" />
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={deleteConfirm.isOpen}
        onClose={() => setDeleteConfirm({ isOpen: false, sessionId: null })}
        onConfirm={() => {
          if (deleteConfirm.sessionId) {
            onDelete(deleteConfirm.sessionId)
          }
          setDeleteConfirm({ isOpen: false, sessionId: null })
        }}
        title={t('chat:sidebar.deleteChat')}
        description={t('chat:sidebar.deleteChatConfirm')}
        confirmText={t('common:delete')}
        variant="danger"
      />
    </div>
  )
}

// ============================================
// Session Item
// ============================================

export interface SessionListItemProps {
  session: ApiSession
  isSelected: boolean
  onSelect: () => void
  onDelete: () => void
  onRename: (newTitle: string) => void
  preferTouchUi: boolean
  density?: 'default' | 'compact' | 'minimal'
  showStats?: boolean
  showDirectory?: boolean
  // ---- 编辑模式 ----
  isEditMode?: boolean
  isChecked?: boolean
  onToggleCheck?: (options?: { shiftKey?: boolean }) => void
}

export function SessionListItem({
  session,
  isSelected,
  onSelect,
  onDelete,
  onRename,
  preferTouchUi,
  density = 'default',
  showStats = true,
  showDirectory = false,
  isEditMode = false,
  isChecked = false,
  onToggleCheck,
}: SessionListItemProps) {
  const { t } = useTranslation(['commands', 'common', 'chat'])
  const [isEditing, setIsEditing] = useState(false)
  const [editTitle, setEditTitle] = useState(session.title || '')
  const [showActions, setShowActions] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const touchMoved = useRef(false)

  // 活跃状态标记
  const activeEntry = useSessionActiveEntry(session.id)
  const activeStatus = activeEntry
    ? activeEntry.pendingAction?.type === 'permission'
      ? { dot: 'bg-warning-100', label: t('chat:activeSession.awaitingPermission'), pulse: false }
      : activeEntry.pendingAction?.type === 'question'
        ? { dot: 'bg-info-100', label: t('chat:activeSession.awaitingAnswer'), pulse: false }
        : activeEntry.status.type === 'retry'
          ? { dot: 'bg-warning-100', label: t('chat:activeSession.retrying'), pulse: false }
          : { dot: 'bg-success-100', label: t('chat:activeSession.working'), pulse: true }
    : null
  const hasUnreadCompletedNotification = useHasUnreadCompletedNotification(session.id)
  const itemRef = useRef<HTMLDivElement>(null)
  const isCompact = density === 'compact'
  const isMinimal = density === 'minimal'
  const hasSummaryStats = Boolean(
    showStats &&
    session.summary &&
    (session.summary.additions > 0 || session.summary.deletions > 0 || session.summary.files > 0),
  )

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowActions(false)
    onDelete()
  }

  const handleStartEdit = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowActions(false)
    setEditTitle(session.title || '')
    setIsEditing(true)
  }

  const handleSaveEdit = () => {
    const trimmed = editTitle.trim()
    if (trimmed && trimmed !== session.title) {
      onRename(trimmed)
    }
    setIsEditing(false)
  }

  const handleCancelEdit = () => {
    setEditTitle(session.title || '')
    setIsEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveEdit()
    } else if (e.key === 'Escape') {
      handleCancelEdit()
    }
  }

  // 长按触摸手势：显示操作按钮
  const handleTouchStart = useCallback(() => {
    if (!preferTouchUi) return
    touchMoved.current = false
    longPressTimer.current = setTimeout(() => {
      if (!touchMoved.current) {
        setShowActions(true)
      }
    }, 500)
  }, [preferTouchUi])

  const handleTouchMove = useCallback(() => {
    if (!preferTouchUi) return
    touchMoved.current = true
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }, [preferTouchUi])

  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }, [])

  // 点击外部收起操作按钮
  useEffect(() => {
    if (!showActions) return
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (itemRef.current && !itemRef.current.contains(e.target as Node)) {
        setShowActions(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('touchstart', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('touchstart', handleClickOutside)
    }
  }, [showActions])

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  // 清理定时器
  useEffect(() => {
    return () => {
      if (longPressTimer.current) clearTimeout(longPressTimer.current)
    }
  }, [])

  const handleClick = () => {
    if (isEditMode) return
    // 如果操作按钮已显示，点击空白区域收起它，不触发 select
    if (showActions) {
      setShowActions(false)
      return
    }
    notificationStore.markSessionNotificationsRead(session.id, 'completed')
    onSelect()
  }

  const handleCheckClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onToggleCheck?.({ shiftKey: e.shiftKey })
  }

  const handleCheckMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  // 拖拽会话到主信息流进行分屏 / 替换会话
  const handleDragStart = (e: React.DragEvent) => {
    if (isEditMode || isEditing) {
      e.preventDefault()
      return
    }
    e.dataTransfer.setData('text/x-session-id', session.id)
    if (session.directory) {
      e.dataTransfer.setData('text/x-session-directory', session.directory)
    }
    e.dataTransfer.effectAllowed = 'move'
  }

  const isDraggable = !isEditMode && !isEditing

  if (isEditing) {
    return (
      <div className={isMinimal ? 'px-2 py-0.5' : 'px-3 py-2'}>
        <input
          ref={inputRef}
          type="text"
          value={editTitle}
          onChange={e => setEditTitle(e.target.value)}
          onBlur={handleSaveEdit}
          onKeyDown={handleKeyDown}
          onClick={e => e.stopPropagation()}
          className={`w-full bg-bg-000 border border-accent-main-100/50 rounded px-2 text-text-100 focus:outline-none focus:ring-1 focus:ring-accent-main-100/30 ${
            isMinimal
              ? 'py-0.5 text-[length:var(--fs-sm)] leading-normal'
              : 'py-1.5 text-[length:var(--fs-base)] leading-relaxed'
          }`}
        />
      </div>
    )
  }

  // 触控优先设备：长按触发动作按钮
  // 鼠标/悬停设备：沿用 hover 触发
  const actionsVisible = preferTouchUi ? showActions : false

  // ============================================
  // Minimal 模式 —— 文件夹视图下的紧凑单行
  // 标题 + 时间 + 活跃状态圆点
  // ============================================
  if (isMinimal) {
    const statusIndicatorTitle =
      activeStatus?.label || (hasUnreadCompletedNotification ? t('chat:notification.completed') : undefined)

    return (
      <div
        ref={itemRef}
        draggable={isDraggable}
        onDragStart={handleDragStart}
        onClick={handleClick}
        onTouchStart={isEditMode ? undefined : handleTouchStart}
        onTouchMove={isEditMode ? undefined : handleTouchMove}
        onTouchEnd={isEditMode ? undefined : handleTouchEnd}
        className={`group relative flex items-center gap-1.5 px-2 py-1.5 rounded-md cursor-default transition-colors duration-150 select-none ${
          isSelected && !isEditMode
            ? 'bg-bg-200/80 text-text-100'
            : isEditMode && isChecked
              ? 'text-text-100'
              : 'text-text-300 hover:bg-bg-200/40 hover:text-text-200'
        } ${showActions && !isEditMode ? 'bg-bg-200/40' : ''}`}
      >
        {/* 选中左侧色条 */}
        {isEditMode && isChecked && (
          <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-accent-main-100" />
        )}
        {/* 编辑模式：checkbox；普通模式：活跃状态圆点 */}
        {isEditMode ? (
          <button
            type="button"
            aria-pressed={isChecked}
            data-compact
            data-selection-kind="session"
            data-selection-id={session.id}
            onMouseDown={handleCheckMouseDown}
            onClick={handleCheckClick}
            className={`shrink-0 flex items-center justify-center w-3.5 h-3.5 rounded-full cursor-pointer transition-colors ${
              isChecked ? 'bg-accent-main-100' : 'border border-text-500/50 hover:border-text-400'
            }`}
          >
            {isChecked && <CheckIcon size={9} className="text-white" />}
          </button>
        ) : (
          <span className="relative shrink-0 flex items-center justify-center w-3 h-3" title={statusIndicatorTitle}>
            {activeStatus ? (
              <>
                <span className={`absolute w-1.5 h-1.5 rounded-full ${activeStatus.dot}`} />
                {activeStatus.pulse && (
                  <span className={`absolute w-1.5 h-1.5 rounded-full ${activeStatus.dot} animate-ping opacity-50`} />
                )}
              </>
            ) : hasUnreadCompletedNotification ? (
              <span className="absolute w-1.5 h-1.5 rounded-full bg-accent-main-100" />
            ) : null}
          </span>
        )}

        <div
          className={`flex min-w-0 flex-1 items-center gap-1.5 transition-[padding] duration-200 ${
            showActions ? 'pr-12' : 'pr-0 group-hover:pr-12'
          }`}
        >
          {/* 标题 */}
          <span
            className="min-w-0 flex-1 truncate text-[length:var(--fs-sm)]"
            title={session.title || t('sessions.untitledChat')}
          >
            {session.title || t('sessions.untitledChat')}
          </span>

          {((hasSummaryStats && session.summary) || session.time?.updated) && (
            <div
              className={`${actionsVisible ? 'hidden' : 'flex group-hover:hidden'} shrink-0 items-center gap-1.5 text-[length:var(--fs-xxs)] text-text-500`}
            >
              {hasSummaryStats && session.summary && (
                <span className="flex shrink-0 items-center gap-1 font-mono">
                  {session.summary.additions > 0 && (
                    <span className="text-success-100">+{session.summary.additions}</span>
                  )}
                  {session.summary.deletions > 0 && (
                    <span className="text-danger-100">-{session.summary.deletions}</span>
                  )}
                  {session.summary.files > 0 && <span>{session.summary.files}f</span>}
                </span>
              )}

              {/* 时间 — 操作按钮出现时隐藏，并为按钮预留空间 */}
              {session.time?.updated && <span className="shrink-0">{formatRelativeTime(session.time.updated)}</span>}
            </div>
          )}
        </div>

        {/* 操作按钮 — 编辑模式下隐藏 */}
        {!isEditMode && (
          <div
            className={`absolute right-2 z-10 shrink-0 flex items-center gap-0.5 transition-opacity duration-150 ${
              actionsVisible
                ? 'opacity-100 pointer-events-auto'
                : 'opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto'
            }`}
          >
            <button
              onClick={handleStartEdit}
              className="p-1 rounded hover:bg-bg-300 text-text-500 hover:text-text-200 transition-colors focus:outline-none"
              title={t('sessions.rename')}
            >
              <PencilIcon className="w-3 h-3" />
            </button>
            <button
              onClick={handleDelete}
              className="p-1 rounded hover:bg-danger-bg text-text-500 hover:text-danger-100 transition-colors focus:outline-none"
              title={t('common:delete')}
            >
              <TrashIcon className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>
    )
  }

  // ============================================
  // Default / Compact 模式
  // ============================================
  return (
    <div
      ref={itemRef}
      draggable={isDraggable}
      onDragStart={handleDragStart}
      onClick={handleClick}
      onTouchStart={isEditMode ? undefined : handleTouchStart}
      onTouchMove={isEditMode ? undefined : handleTouchMove}
      onTouchEnd={isEditMode ? undefined : handleTouchEnd}
      className={`group relative flex items-start ${isCompact ? 'px-3 py-2' : 'px-3 py-2.5'} rounded-lg cursor-default transition-all duration-200 border border-transparent select-none ${
        isSelected && !isEditMode ? 'bg-bg-000 shadow-sm ring-1 ring-border-200/50' : 'hover:bg-bg-200/50'
      } ${showActions && !isEditMode ? 'bg-bg-200/50' : ''}`}
    >
      {/* 选中左侧色条 */}
      {isEditMode && isChecked && (
        <span className="absolute left-0 top-2 bottom-2 w-[2px] rounded-full bg-accent-main-100" />
      )}
      {/* 编辑模式 checkbox */}
      {isEditMode && (
        <button
          type="button"
          aria-pressed={isChecked}
          data-compact
          data-selection-kind="session"
          data-selection-id={session.id}
          onMouseDown={handleCheckMouseDown}
          onClick={handleCheckClick}
          className={`shrink-0 flex items-center justify-center w-4 h-4 mt-0.5 mr-2 rounded-full cursor-pointer transition-colors ${
            isChecked ? 'bg-accent-main-100' : 'border border-text-500/50 hover:border-text-400'
          }`}
        >
          {isChecked && <CheckIcon size={11} className="text-white" />}
        </button>
      )}
      <div
        className={`flex-1 min-w-0 transition-[padding] duration-200 ${!isEditMode && showActions ? 'pr-[60px]' : !isEditMode ? 'pr-1 group-hover:pr-[60px]' : 'pr-1'}`}
      >
        {/* Row 1: Title */}
        <p
          className={`${isCompact ? 'text-[length:var(--fs-md)]' : 'text-[length:var(--fs-base)]'} truncate font-medium ${isSelected ? 'text-text-100' : 'text-text-200 group-hover:text-text-100'}`}
          title={session.title || t('sessions.untitledChat')}
        >
          {session.title || t('sessions.untitledChat')}
        </p>

        {/* Row 2: Meta line — 始终存在，保持高度一致 */}
        <div
          className={`flex items-center ${isCompact ? 'mt-1' : 'mt-1.5'} h-4 text-[length:var(--fs-xxs)] text-text-400 gap-1 overflow-hidden`}
        >
          {/* 活跃状态标记 / 已完成未读圆点 */}
          {activeStatus ? (
            <>
              <span className="relative shrink-0 flex items-center justify-center w-3 h-3">
                <span className={`absolute w-1.5 h-1.5 rounded-full ${activeStatus.dot}`} />
                {activeStatus.pulse && (
                  <span className={`absolute w-1.5 h-1.5 rounded-full ${activeStatus.dot} animate-ping opacity-50`} />
                )}
              </span>
              <span className="opacity-30 shrink-0">·</span>
            </>
          ) : hasUnreadCompletedNotification ? (
            <>
              <span
                className="relative shrink-0 flex items-center justify-center w-3 h-3"
                title={t('chat:notification.completed')}
              >
                <span className="absolute w-1.5 h-1.5 rounded-full bg-accent-main-100" />
              </span>
              <span className="opacity-30 shrink-0">·</span>
            </>
          ) : null}
          {/* 时间 */}
          {session.time?.updated && (
            <span className="shrink-0 opacity-60">{formatRelativeTime(session.time.updated)}</span>
          )}
          {/* Stats */}
          {showStats && session.summary && (
            <>
              <span className="opacity-30">·</span>
              <span className="flex items-center gap-1.5 font-mono shrink-0">
                {session.summary.additions > 0 && (
                  <span className="text-success-100">+{session.summary.additions}</span>
                )}
                {session.summary.deletions > 0 && <span className="text-danger-100">-{session.summary.deletions}</span>}
                {session.summary.files > 0 && <span>{session.summary.files}f</span>}
              </span>
            </>
          )}
          {/* Directory (Global mode) */}
          {showDirectory && session.directory && (
            <>
              <span className="opacity-30 shrink-0">·</span>
              <span className="truncate opacity-50" title={session.directory}>
                {session.directory.replace(/\\/g, '/').split('/').filter(Boolean).pop()}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Actions: hover on desktop, long-press on mobile — 编辑模式下隐藏 */}
      {!isEditMode && (
        <div
          className={`absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5 transition-all duration-200 z-10 ${
            actionsVisible
              ? 'opacity-100 pointer-events-auto'
              : 'opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto'
          }`}
        >
          <button
            onClick={handleStartEdit}
            className="p-1.5 rounded-md hover:bg-bg-300 active:bg-bg-300 text-text-400 hover:text-text-100 transition-colors focus:outline-none"
            title={t('sessions.rename')}
          >
            <PencilIcon className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleDelete}
            className="p-1.5 rounded-md hover:bg-danger-bg active:bg-danger-bg text-text-400 hover:text-danger-100 active:text-danger-100 transition-colors focus:outline-none"
            title={t('common:delete')}
          >
            <TrashIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}

// ============================================
// Loading Spinner
// ============================================

import { SpinnerIcon } from '../../components/Icons'

function LoadingSpinner({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const sizeClass = size === 'sm' ? 'w-3 h-3' : 'w-5 h-5'
  return <SpinnerIcon className={`animate-spin text-text-400 ${sizeClass}`} size={size === 'sm' ? 12 : 20} />
}
