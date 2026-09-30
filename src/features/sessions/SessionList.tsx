import { useRef, useEffect, useCallback, useState, useMemo, useSyncExternalStore, type PointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { SearchIcon, PencilIcon, TrashIcon, ComposeIcon, PinIcon } from '../../components/Icons'
import { getSelectionRoundClass } from './selectionRound'
import { formatRelativeTime } from '../../utils/dateUtils'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { useInputCapabilities } from '../../hooks/useInputCapabilities'
import { useSessionActiveEntry } from '../../store/activeSessionStore'
import { notificationStore, useHasUnreadCompletedNotification } from '../../store/notificationStore'
import { SessionChildrenSlot } from '../chat/sidebar/SessionChildrenSlot'
import type { ApiSession } from '../../api'
import { startInternalDrag } from '../../lib/internalDragCore'
import { makeSessionKey, splitSessionKey } from '../../utils/sessionKey'
import { pinnedSessionsStore, type PinnedSessionEntry } from '../../store/pinnedSessionsStore'
import { serverStore } from '../../store/serverStore'

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
  /** 数据所属服务器（多服务器模式；缺省用活动服务器） */
  serverId?: string
  onSelectChildSession?: (session: ApiSession) => void
  pinnedDividerAfterIds?: Set<string>
  /** 拉不到的置顶（灰色展示，可取消） */
  unavailablePinnedEntries?: PinnedSessionEntry[]
  /** SidePanel 排好的可用置顶数量（flat 列表里用来定位插入点） */
  availablePinnedCount?: number
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
  serverId,
  onSelectChildSession,
  pinnedDividerAfterIds,
  unavailablePinnedEntries = [],
  availablePinnedCount = 0,
  isEditMode = false,
  selectedSessionIds,
  onToggleSessionSelection,
}: SessionListProps) {
  const { t } = useTranslation(['commands', 'common', 'chat'])
  const { preferTouchUi } = useInputCapabilities()
  const listRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const hasUnavailablePinned = unavailablePinnedEntries.length > 0
  // SidePanel 把可用置顶排在 sessions[0..availablePinnedCount)；不可用接在这段后面
  const lastAvailablePinnedIndex = availablePinnedCount > 0 ? availablePinnedCount - 1 : -1

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
                name="session-search"
                value={search}
                onChange={e => onSearchChange(e.target.value)}
                placeholder={t('sessions.searchChats')}
                aria-label={t('sessions.searchChats')}
                autoComplete="off"
                className="w-full bg-bg-200/40 hover:bg-bg-200/80 focus:bg-bg-000 border border-transparent focus:border-border-200 rounded-lg py-2 pl-9 pr-3 text-[length:var(--fs-sm)] text-text-100 placeholder:text-text-400/70 focus:outline-none focus:shadow-sm transition-all duration-200"
              />
            </div>
            <button
              type="button"
              onClick={onNewChat}
              title={t('sessions.newChat')}
              aria-label={t('sessions.newChat')}
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
        {isLoading && sessions.length === 0 && !hasUnavailablePinned ? (
          <div className="flex items-center justify-center py-8">
            <LoadingSpinner />
          </div>
        ) : sessions.length === 0 && !hasUnavailablePinned ? (
          <div className="flex flex-col items-center justify-center py-12 text-text-400 opacity-60">
            <p className="text-[length:var(--fs-sm)]">
              {search ? t('common:noMatchesFound') : t('sessions.noChatsYet')}
            </p>
          </div>
        ) : showGroups ? (
          // Grouped View
          <>
            {hasUnavailablePinned && (
              <div className={`${isEditMode ? 'space-y-0' : 'space-y-0.5'} mt-1`}>
                {unavailablePinnedEntries.map(entry => (
                  <UnavailablePinnedSessionItem key={entry.sessionId} entry={entry} density={density} />
                ))}
                {sessions.length > 0 && <div className="mx-3 my-1.5 h-px bg-border-200/45" />}
              </div>
            )}
            {SESSION_GROUP_ORDER.map(group => {
              const groupSessions = groupedSessions[group]
              if (groupSessions.length === 0) return null
              return (
                <div key={group}>
                  <h3 className="px-3 mb-1.5 mt-2 text-[length:var(--fs-xxs)] font-bold text-text-400/60 uppercase tracking-widest select-none">
                    {t(`sessions.groups.${group}`)}
                  </h3>
                  <div className={isEditMode ? 'space-y-0' : 'space-y-0.5'}>
                    {groupSessions.map((session, index) => {
                      const isChecked = selectedSessionIds?.has(session.id) ?? false
                      const prevChecked =
                        isEditMode && index > 0 && (selectedSessionIds?.has(groupSessions[index - 1].id) ?? false)
                      const nextChecked =
                        isEditMode &&
                        index < groupSessions.length - 1 &&
                        (selectedSessionIds?.has(groupSessions[index + 1].id) ?? false)
                      return (
                        <div key={session.id}>
                          <SessionListItem
                            session={session}
                            isSelected={!!selectedId && session.id === splitSessionKey(selectedId).sessionId}
                            onSelect={() => onSelect(session)}
                            onDelete={() => setDeleteConfirm({ isOpen: true, sessionId: session.id })}
                            onRename={newTitle => onRename(session.id, newTitle)}
                            preferTouchUi={preferTouchUi}
                            density={density}
                            showStats={showStats}
                            showDirectory={showDirectory}
                            isEditMode={isEditMode}
                            isChecked={isChecked}
                            checkedPrev={prevChecked}
                            checkedNext={nextChecked}
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
                                serverId={serverId}
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
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </>
        ) : (
          // Flat View：可用置顶前缀 → 不可用置顶 → 分隔线 → 其余
          <div className={`${isEditMode ? 'space-y-0' : 'space-y-0.5'} mt-1`}>
            {lastAvailablePinnedIndex < 0 && hasUnavailablePinned && (
              <>
                {unavailablePinnedEntries.map(entry => (
                  <UnavailablePinnedSessionItem key={entry.sessionId} entry={entry} density={density} />
                ))}
                {sessions.length > 0 && <div className="mx-3 my-1.5 h-px bg-border-200/45" />}
              </>
            )}
            {sessions.map((session, index) => {
              const inlineChildren = inlineChildSessions?.get(session.id)
              const shouldFetchAll = expandedChildSessionIds?.has(session.id)
              const hasChildren = shouldFetchAll || (inlineChildren && inlineChildren.length > 0)
              const showPinnedDivider = pinnedDividerAfterIds?.has(session.id)
              const showUnavailableAfter = hasUnavailablePinned && index === lastAvailablePinnedIndex
              const isChecked = selectedSessionIds?.has(session.id) ?? false
              const prevChecked = isEditMode && index > 0 && (selectedSessionIds?.has(sessions[index - 1].id) ?? false)
              const nextChecked =
                isEditMode &&
                index < sessions.length - 1 &&
                (selectedSessionIds?.has(sessions[index + 1].id) ?? false) &&
                !showPinnedDivider
              return (
                <div key={session.id}>
                  <SessionListItem
                    session={session}
                    isSelected={!!selectedId && session.id === splitSessionKey(selectedId).sessionId}
                    onSelect={() => onSelect(session)}
                    onDelete={() => setDeleteConfirm({ isOpen: true, sessionId: session.id })}
                    onRename={newTitle => onRename(session.id, newTitle)}
                    preferTouchUi={preferTouchUi}
                    density={density}
                    showStats={showStats}
                    showDirectory={showDirectory}
                    isEditMode={isEditMode}
                    isChecked={isChecked}
                    checkedPrev={prevChecked}
                    checkedNext={nextChecked}
                    onToggleCheck={
                      onToggleSessionSelection ? options => onToggleSessionSelection(session.id, options) : undefined
                    }
                  />
                  {hasChildren && onSelectChildSession && (
                    <SessionChildrenSlot
                      parentSession={session}
                      serverId={serverId}
                      selectedSessionId={selectedId}
                      fetchAll={shouldFetchAll}
                      children={inlineChildren}
                      onSelect={onSelectChildSession}
                      isEditMode={isEditMode}
                      selectedSessionIds={selectedSessionIds}
                      onToggleSessionSelection={onToggleSessionSelection}
                    />
                  )}
                  {showUnavailableAfter &&
                    unavailablePinnedEntries.map(entry => (
                      <UnavailablePinnedSessionItem key={entry.sessionId} entry={entry} density={density} />
                    ))}
                  {showPinnedDivider && <div className="mx-3 my-1.5 h-px bg-border-200/45" />}
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
  /** 活跃标记查询用复合 key（serverId::sessionId，多服务器模式传入；缺省用 session.id） */
  activeSessionKey?: string
  // ---- 编辑模式 ----
  isEditMode?: boolean
  isChecked?: boolean
  /** 上一项也选中时，去掉上圆角，拼成连续选中块 */
  checkedPrev?: boolean
  /** 下一项也选中时，去掉下圆角 */
  checkedNext?: boolean
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
  activeSessionKey,
  isEditMode = false,
  isChecked = false,
  checkedPrev = false,
  checkedNext = false,
  onToggleCheck,
}: SessionListItemProps) {
  const { t } = useTranslation(['commands', 'common', 'chat'])
  const [isEditing, setIsEditing] = useState(false)
  const [editTitle, setEditTitle] = useState(session.title || '')
  const [showActions, setShowActions] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const touchMoved = useRef(false)

  // 活跃状态标记（activeSessionStore / notificationStore 的 key 是复合 serverId::sessionId；
  // 单服务器模式 session.id 是原始 id，需用活动服务器合成复合 key 查询）
  const activeQueryKey = activeSessionKey ?? makeSessionKey(serverStore.getActiveServerId(), session.id)
  const activeEntry = useSessionActiveEntry(activeQueryKey)
  const activeStatus = activeEntry
    ? activeEntry.pendingAction?.type === 'permission'
      ? { dot: 'bg-warning-100', label: t('chat:activeSession.awaitingPermission'), pulse: false }
      : activeEntry.pendingAction?.type === 'question'
        ? { dot: 'bg-info-100', label: t('chat:activeSession.awaitingAnswer'), pulse: false }
        : activeEntry.status.type === 'retry'
          ? { dot: 'bg-warning-100', label: t('chat:activeSession.retrying'), pulse: false }
          : { dot: 'bg-success-100', label: t('chat:activeSession.working'), pulse: true }
    : null
  const hasUnreadCompletedNotification = useHasUnreadCompletedNotification(activeQueryKey)
  const itemRef = useRef<HTMLDivElement>(null)
  const isCompact = density === 'compact'
  const isMinimal = density === 'minimal'
  const hasSummaryStats = Boolean(
    showStats &&
    session.summary &&
    (session.summary.additions > 0 || session.summary.deletions > 0 || session.summary.files > 0),
  )
  const itemPaddingClass = isCompact ? 'pl-[6px] pr-3 py-2' : 'px-3 py-2.5'
  const pinnedEntries = useSyncExternalStore(
    pinnedSessionsStore.subscribe,
    pinnedSessionsStore.getSnapshot,
    pinnedSessionsStore.getSnapshot,
  )
  const isPinned = useMemo(
    () => pinnedEntries.some(entry => entry.sessionId === session.id),
    [pinnedEntries, session.id],
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

  const handlePin = (e: React.MouseEvent) => {
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).blur()
    if (isPinned) {
      pinnedSessionsStore.unpin(session.id)
    } else {
      pinnedSessionsStore.pin({
        sessionId: session.id,
        directory: session.directory || '',
        title: session.title || t('sessions.untitledChat'),
      })
    }
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

  const handleClick = (e?: React.MouseEvent) => {
    if (isEditMode) {
      onToggleCheck?.({ shiftKey: e?.shiftKey })
      return
    }
    // 如果操作按钮已显示，点击空白区域收起它，不触发 select
    if (showActions) {
      setShowActions(false)
      return
    }
    notificationStore.markSessionNotificationsRead(activeQueryKey, 'completed')
    onSelect()
  }

  // 管理模式：阻止浏览器原生文字选区（尤其是 Shift 点选时）
  const handleSelectionMouseDown = (e: React.MouseEvent) => {
    if (!isEditMode) return
    e.preventDefault()
    window.getSelection()?.removeAllRanges()
  }

  // 拖拽会话到主信息流进行分屏 / 替换会话
  const handleSessionPointerDown = (e: PointerEvent<HTMLElement>) => {
    if (isEditMode || isEditing) {
      return
    }
    startInternalDrag(e, {
      kind: 'session',
      sessionId: session.id,
      serverId: activeSessionKey ? splitSessionKey(activeSessionKey).serverId : undefined,
      directory: session.directory,
    })
  }

  const isDraggable = !isEditMode && !isEditing
  const selectionAttrs = isEditMode
    ? {
        'data-selection-kind': 'session' as const,
        'data-selection-id': session.id,
        'aria-selected': isChecked,
      }
    : {}

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
        {...selectionAttrs}
        onClick={handleClick}
        onMouseDown={handleSelectionMouseDown}
        onTouchStart={!isEditMode ? handleTouchStart : undefined}
        onTouchMove={!isEditMode ? handleTouchMove : undefined}
        onTouchEnd={!isEditMode ? handleTouchEnd : undefined}
        className={`group relative flex items-center gap-2 px-2 py-1.5 cursor-default transition-colors duration-150 select-none ${getSelectionRoundClass(
          isEditMode && isChecked,
          checkedPrev,
          checkedNext,
          'md',
        )} ${
          isEditMode
            ? isChecked
              ? 'bg-bg-200/80 text-text-100'
              : 'text-text-300 hover:bg-bg-200/40 hover:text-text-200'
            : isSelected
              ? 'bg-bg-200/80 text-text-100'
              : 'text-text-300 hover:bg-bg-200/40 hover:text-text-200'
        } ${showActions && !isEditMode ? 'bg-bg-200/40' : ''}`}
      >
        <span className="relative shrink-0 flex items-center justify-center size-5" title={statusIndicatorTitle}>
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

        <button
          type="button"
          onPointerDown={isDraggable ? handleSessionPointerDown : undefined}
          onMouseDown={handleSelectionMouseDown}
          onClick={e => {
            e.stopPropagation()
            handleClick(e)
          }}
          className="peer flex min-w-0 flex-1 items-center gap-1.5 bg-transparent border-none p-0 text-left select-none"
        >
          <div
            className={`flex min-w-0 flex-1 items-center gap-1.5 transition-[padding] duration-200 ${
              showActions ? 'pr-20' : 'pr-0 group-hover:pr-20'
            }`}
          >
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

                {session.time?.updated && <span className="shrink-0">{formatRelativeTime(session.time.updated)}</span>}
              </div>
            )}
          </div>
        </button>

        {/* 操作按钮 — 管理模式下隐藏，避免和点选冲突 */}
        {!isEditMode && (
          <div
            className={`absolute right-2 z-10 shrink-0 flex items-center gap-0.5 transition-opacity duration-150 ${
              actionsVisible
                ? 'opacity-100 pointer-events-auto'
                : 'opacity-0 group-hover:opacity-100 peer-focus-visible:opacity-100 focus-within:opacity-100 pointer-events-none group-hover:pointer-events-auto peer-focus-visible:pointer-events-auto focus-within:pointer-events-auto'
            }`}
          >
            <button
              type="button"
              onClick={handlePin}
              className={`p-1 rounded transition-colors focus-visible:ring-1 focus-visible:ring-border-200 focus-visible:ring-inset ${
                isPinned
                  ? 'text-accent-main-100 hover:text-accent-main-200'
                  : 'text-text-500 hover:text-text-200 hover:bg-bg-300'
              }`}
              title={isPinned ? t('sessions.unpin') : t('sessions.pin')}
              aria-label={isPinned ? t('sessions.unpin') : t('sessions.pin')}
            >
              <PinIcon className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={handleStartEdit}
              className="p-1 rounded hover:bg-bg-300 text-text-500 hover:text-text-200 transition-colors focus-visible:ring-1 focus-visible:ring-border-200 focus-visible:ring-inset"
              title={t('sessions.rename')}
              aria-label={t('sessions.rename')}
            >
              <PencilIcon className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={handleDelete}
              className="p-1 rounded hover:bg-danger-bg text-text-500 hover:text-danger-100 transition-colors focus-visible:ring-1 focus-visible:ring-danger-100/40 focus-visible:ring-inset"
              title={t('common:delete')}
              aria-label={t('common:delete')}
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
      {...selectionAttrs}
      onClick={handleClick}
      onMouseDown={handleSelectionMouseDown}
      onTouchStart={!isEditMode ? handleTouchStart : undefined}
      onTouchMove={!isEditMode ? handleTouchMove : undefined}
      onTouchEnd={!isEditMode ? handleTouchEnd : undefined}
      className={`group relative flex items-start ${itemPaddingClass} cursor-default transition-all duration-200 border border-transparent select-none ${getSelectionRoundClass(
        isEditMode && isChecked,
        checkedPrev,
        checkedNext,
        'lg',
      )} ${
        isEditMode
          ? isChecked
            ? 'bg-bg-200/80'
            : 'hover:bg-bg-200/50'
          : isSelected
            ? 'bg-bg-000 shadow-sm ring-1 ring-border-200/50'
            : 'hover:bg-bg-200/50'
      } ${showActions && !isEditMode ? 'bg-bg-200/50' : ''}`}
    >
      <button
        type="button"
        onPointerDown={isDraggable ? handleSessionPointerDown : undefined}
        onMouseDown={handleSelectionMouseDown}
        onClick={e => {
          e.stopPropagation()
          handleClick(e)
        }}
        className="peer flex min-w-0 flex-1 items-start bg-transparent border-none p-0 text-left select-none"
      >
        <div
          className={`flex-1 min-w-0 transition-[padding] duration-200 ${showActions ? 'pr-[88px]' : 'pr-1 group-hover:pr-[88px]'}`}
        >
          <p
            className={`${isCompact ? 'text-[length:var(--fs-md)]' : 'text-[length:var(--fs-base)]'} truncate font-medium ${
              (isEditMode ? isChecked : isSelected) ? 'text-text-100' : 'text-text-200 group-hover:text-text-100'
            }`}
            title={session.title || t('sessions.untitledChat')}
          >
            {session.title || t('sessions.untitledChat')}
          </p>

          <div
            className={`flex items-center ${isCompact ? 'mt-1' : 'mt-1.5'} h-4 text-[length:var(--fs-xxs)] text-text-400 gap-1 overflow-hidden`}
          >
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
            {session.time?.updated && (
              <span className="shrink-0 opacity-60">{formatRelativeTime(session.time.updated)}</span>
            )}
            {showStats && session.summary && (
              <>
                <span className="opacity-30">·</span>
                <span className="flex items-center gap-1.5 font-mono shrink-0">
                  {session.summary.additions > 0 && (
                    <span className="text-success-100">+{session.summary.additions}</span>
                  )}
                  {session.summary.deletions > 0 && (
                    <span className="text-danger-100">-{session.summary.deletions}</span>
                  )}
                  {session.summary.files > 0 && <span>{session.summary.files}f</span>}
                </span>
              </>
            )}
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
      </button>

      {/* Actions: hover on desktop, long-press on mobile — 管理模式下隐藏 */}
      {!isEditMode && (
        <div
          className={`absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5 transition-all duration-200 z-10 ${
            actionsVisible
              ? 'opacity-100 pointer-events-auto'
              : 'opacity-0 group-hover:opacity-100 peer-focus-visible:opacity-100 focus-within:opacity-100 pointer-events-none group-hover:pointer-events-auto peer-focus-visible:pointer-events-auto focus-within:pointer-events-auto'
          }`}
        >
          <button
            type="button"
            onClick={handlePin}
            className={`p-1.5 rounded-md transition-colors focus-visible:ring-1 focus-visible:ring-border-200 focus-visible:ring-inset ${
              isPinned
                ? 'text-accent-main-100 hover:text-accent-main-200'
                : 'text-text-400 hover:text-text-100 hover:bg-bg-300'
            }`}
            title={isPinned ? t('sessions.unpin') : t('sessions.pin')}
            aria-label={isPinned ? t('sessions.unpin') : t('sessions.pin')}
          >
            <PinIcon className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleStartEdit}
            className="p-1.5 rounded-md hover:bg-bg-300 active:bg-bg-300 text-text-400 hover:text-text-100 transition-colors focus-visible:ring-1 focus-visible:ring-border-200 focus-visible:ring-inset"
            title={t('sessions.rename')}
            aria-label={t('sessions.rename')}
          >
            <PencilIcon className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleDelete}
            className="p-1.5 rounded-md hover:bg-danger-bg active:bg-danger-bg text-text-400 hover:text-danger-100 active:text-danger-100 transition-colors focus-visible:ring-1 focus-visible:ring-danger-100/40 focus-visible:ring-inset"
            title={t('common:delete')}
            aria-label={t('common:delete')}
          >
            <TrashIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}

// ============================================
// Unavailable pinned (gray title, unpin only)
// ============================================

function UnavailablePinnedSessionItem({
  entry,
  density = 'default',
}: {
  entry: PinnedSessionEntry
  density?: 'default' | 'compact' | 'minimal'
}) {
  const { t } = useTranslation(['commands'])
  const title = entry.title || entry.sessionId.slice(0, 12) + '...'
  const isCompact = density === 'compact'
  const padding = isCompact ? 'pl-[6px] pr-3 py-2' : 'px-3 py-2.5'

  return (
    <div className={`group relative flex items-start ${padding} border border-transparent`}>
      <div className="flex-1 min-w-0 mr-1 group-hover:mr-8 transition-[margin] duration-200">
        <p
          className={`${isCompact ? 'text-[length:var(--fs-md)]' : 'text-[length:var(--fs-base)]'} truncate font-medium text-text-500`}
          title={title}
        >
          {title}
        </p>
        <div
          className={`flex items-center ${isCompact ? 'mt-1' : 'mt-1.5'} h-4 text-[length:var(--fs-xxs)] text-text-500`}
        >
          <span>{t('sessions.unavailable')}</span>
        </div>
      </div>
      <button
        type="button"
        onClick={e => {
          e.stopPropagation()
          pinnedSessionsStore.unpin(entry.sessionId)
        }}
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-accent-main-100 hover:text-accent-main-200 opacity-0 group-hover:opacity-100 transition-colors"
        title={t('sessions.unpin')}
        aria-label={t('sessions.unpin')}
      >
        <PinIcon className="w-3.5 h-3.5" />
      </button>
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
