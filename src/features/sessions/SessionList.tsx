import { useRef, useEffect, useCallback, useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { SearchIcon, PencilIcon, TrashIcon, ComposeIcon } from '../../components/Icons'
import { formatRelativeTime } from '../../utils/dateUtils'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { useIsMobile } from '../../hooks'
import { useSessionActiveEntry } from '../../store/activeSessionStore'
import { notificationStore, useHasUnreadCompletedNotification } from '../../store/notificationStore'
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
  /** Global 模式下显示每个 session 的目录名 */
  showDirectory?: boolean
}

// 时间分组类型
type TimeGroup = 'Today' | 'Yesterday' | 'Previous 7 Days' | 'Previous 30 Days' | 'Older'

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
}: SessionListProps) {
  const { t } = useTranslation(['commands', 'common', 'chat'])
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
      Today: [],
      Yesterday: [],
      'Previous 7 Days': [],
      'Previous 30 Days': [],
      Older: [],
    }

    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const yesterday = today - 86400000
    const weekAgo = today - 86400000 * 7
    const monthAgo = today - 86400000 * 30

    sessions.forEach(session => {
      const updated = session.time.updated ?? session.time.created
      if (updated >= today) {
        groups['Today'].push(session)
      } else if (updated >= yesterday) {
        groups['Yesterday'].push(session)
      } else if (updated >= weekAgo) {
        groups['Previous 7 Days'].push(session)
      } else if (updated >= monthAgo) {
        groups['Previous 30 Days'].push(session)
      } else {
        groups['Older'].push(session)
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
                className="w-full bg-bg-200/40 hover:bg-bg-200/80 focus:bg-bg-000 border border-transparent focus:border-border-200 rounded-lg py-2 pl-9 pr-3 text-xs text-text-100 placeholder:text-text-400/70 focus:outline-none focus:shadow-sm transition-all duration-200"
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
            <p className="text-xs">{search ? t('common:noMatchesFound') : t('sessions.noChatsYet')}</p>
          </div>
        ) : showGroups ? (
          // Grouped View
          Object.entries(groupedSessions).map(([group, groupSessions]) => {
            if (groupSessions.length === 0) return null
            return (
              <div key={group}>
                <h3 className="px-3 mb-1.5 mt-2 text-[10px] font-bold text-text-400/60 uppercase tracking-widest select-none">
                  {group}
                </h3>
                <div className="space-y-0.5">
                  {groupSessions.map(session => (
                    <SessionListItem
                      key={session.id}
                      session={session}
                      isSelected={session.id === selectedId}
                      onSelect={() => onSelect(session)}
                      onDelete={() => setDeleteConfirm({ isOpen: true, sessionId: session.id })}
                      onRename={newTitle => onRename(session.id, newTitle)}
                      density={density}
                      showStats={showStats}
                      showDirectory={showDirectory}
                    />
                  ))}
                </div>
              </div>
            )
          })
        ) : (
          // Flat View (Search)
          <div className="space-y-0.5 mt-1">
            {sessions.map(session => (
              <SessionListItem
                key={session.id}
                session={session}
                isSelected={session.id === selectedId}
                onSelect={() => onSelect(session)}
                onDelete={() => setDeleteConfirm({ isOpen: true, sessionId: session.id })}
                onRename={newTitle => onRename(session.id, newTitle)}
                density={density}
                showStats={showStats}
                showDirectory={showDirectory}
              />
            ))}
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
  density?: 'default' | 'compact' | 'minimal'
  showStats?: boolean
  showDirectory?: boolean
}

export function SessionListItem({
  session,
  isSelected,
  onSelect,
  onDelete,
  onRename,
  density = 'default',
  showStats = true,
  showDirectory = false,
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
  const isMobile = useIsMobile()
  const isCompact = density === 'compact'
  const isMinimal = density === 'minimal'

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
    touchMoved.current = false
    longPressTimer.current = setTimeout(() => {
      if (!touchMoved.current) {
        setShowActions(true)
      }
    }, 500)
  }, [])

  const handleTouchMove = useCallback(() => {
    touchMoved.current = true
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }, [])

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
    // 如果操作按钮已显示，点击空白区域收起它，不触发 select
    if (showActions) {
      setShowActions(false)
      return
    }
    notificationStore.markSessionNotificationsRead(session.id, 'completed')
    onSelect()
  }

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
            isMinimal ? 'py-0.5 text-[12px] leading-normal' : 'py-1.5 text-sm leading-relaxed'
          }`}
        />
      </div>
    )
  }

  // 移动端操作按钮是否可见：长按触发的 showActions 状态
  // 桌面端：hover 触发
  const actionsVisible = isMobile ? showActions : false

  // ============================================
  // Minimal 模式 —— 文件夹视图下的紧凑单行
  // 标题 + 时间 + 活跃状态圆点
  // ============================================
  if (isMinimal) {
    return (
      <div
        ref={itemRef}
        onClick={handleClick}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className={`group relative flex items-center gap-1.5 px-2 py-1.5 rounded-md cursor-pointer transition-colors duration-150 select-none ${
          isSelected ? 'bg-bg-200/80 text-text-100' : 'text-text-300 hover:bg-bg-200/40 hover:text-text-200'
        } ${showActions ? 'bg-bg-200/40' : ''}`}
      >
        {/* 活跃状态圆点 / 已完成未读圆点 */}
        {activeStatus ? (
          <span className="relative shrink-0 flex items-center justify-center w-3 h-3" title={activeStatus.label}>
            <span className={`absolute w-1.5 h-1.5 rounded-full ${activeStatus.dot}`} />
            {activeStatus.pulse && (
              <span className={`absolute w-1.5 h-1.5 rounded-full ${activeStatus.dot} animate-ping opacity-50`} />
            )}
          </span>
        ) : hasUnreadCompletedNotification ? (
          <span
            className="relative shrink-0 flex items-center justify-center w-3 h-3"
            title={t('chat:notification.completed')}
          >
            <span className="absolute w-1.5 h-1.5 rounded-full bg-accent-main-100" />
          </span>
        ) : null}

        <div
          className={`flex min-w-0 flex-1 items-center gap-1.5 transition-[padding] duration-200 ${
            showActions ? 'pr-[60px]' : 'pr-0 group-hover:pr-[60px]'
          }`}
        >
          {/* 标题 */}
          <span className="min-w-0 flex-1 truncate text-[12px]" title={session.title || t('sessions.untitledChat')}>
            {session.title || t('sessions.untitledChat')}
          </span>

          {/* 时间 — 操作按钮出现时隐藏，并为按钮预留空间 */}
          {session.time?.updated && (
            <span
              className={`shrink-0 text-[10px] text-text-500 transition-opacity duration-150 ${
                actionsVisible ? 'opacity-0' : 'opacity-100 group-hover:opacity-0'
              }`}
            >
              {formatRelativeTime(session.time.updated)}
            </span>
          )}
        </div>

        {/* 操作按钮 */}
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
      </div>
    )
  }

  // ============================================
  // Default / Compact 模式
  // ============================================
  return (
    <div
      ref={itemRef}
      onClick={handleClick}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className={`group relative flex items-start ${isCompact ? 'px-3 py-2' : 'px-3 py-2.5'} rounded-lg cursor-pointer transition-all duration-200 border border-transparent select-none ${
        isSelected ? 'bg-bg-000 shadow-sm ring-1 ring-border-200/50' : 'hover:bg-bg-200/50'
      } ${showActions ? 'bg-bg-200/50' : ''}`}
    >
      <div
        className={`flex-1 min-w-0 transition-[padding] duration-200 ${showActions ? 'pr-[60px]' : 'pr-1 group-hover:pr-[60px]'}`}
      >
        {/* Row 1: Title */}
        <p
          className={`${isCompact ? 'text-[13px]' : 'text-sm'} truncate font-medium ${isSelected ? 'text-text-100' : 'text-text-200 group-hover:text-text-100'}`}
          title={session.title || t('sessions.untitledChat')}
        >
          {session.title || t('sessions.untitledChat')}
        </p>

        {/* Row 2: Meta line — 始终存在，保持高度一致 */}
        <div
          className={`flex items-center ${isCompact ? 'mt-1' : 'mt-1.5'} h-4 text-[10px] text-text-400 gap-1 overflow-hidden`}
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

      {/* Actions: hover on desktop, long-press on mobile */}
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
