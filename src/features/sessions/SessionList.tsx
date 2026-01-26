import { useRef, useEffect, useCallback, useState, useMemo } from 'react'
import { SearchIcon, PencilIcon, TrashIcon } from '../../components/Icons'
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
}: SessionListProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

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
      'Today': [],
      'Yesterday': [],
      'Previous 7 Days': [],
      'Previous 30 Days': [],
      'Older': []
    }

    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const yesterday = today - 86400000
    const weekAgo = today - 86400000 * 7
    const monthAgo = today - 86400000 * 30

    sessions.forEach(session => {
      const updated = session.time.updated
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

  // 只有非搜索状态才显示分组
  const showGroups = !search

  return (
    <div className="flex flex-col h-full">
      {/* Search Bar - Minimalist */}
      <div className="px-3 pb-2 flex-shrink-0">
        <div className="relative group">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-text-400 w-3.5 h-3.5 group-focus-within:text-accent-main-100 transition-colors" />
          <input
            ref={searchInputRef}
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search chats..."
            className="w-full bg-bg-200/40 hover:bg-bg-200/80 focus:bg-bg-000 border border-transparent focus:border-border-200 rounded-lg py-2 pl-9 pr-3 text-xs text-text-100 placeholder:text-text-400/70 focus:outline-none focus:shadow-sm transition-all duration-200"
          />
        </div>
      </div>

      {/* Session List */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto custom-scrollbar px-2 pb-4 space-y-4"
      >
        {isLoading && sessions.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <LoadingSpinner />
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-text-400 opacity-60">
            <p className="text-xs">
              {search ? 'No matches found' : 'No chats yet'}
            </p>
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
                    <SessionItem
                      key={session.id}
                      session={session}
                      isSelected={session.id === selectedId}
                      onSelect={() => onSelect(session)}
                      onDelete={() => onDelete(session.id)}
                      onRename={(newTitle) => onRename(session.id, newTitle)}
                    />
                  ))}
                </div>
              </div>
            )
          })
        ) : (
          // Flat View (Search)
          <div className="space-y-0.5 mt-1">
            {sessions.map((session) => (
              <SessionItem
                key={session.id}
                session={session}
                isSelected={session.id === selectedId}
                onSelect={() => onSelect(session)}
                onDelete={() => onDelete(session.id)}
                onRename={(newTitle) => onRename(session.id, newTitle)}
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
    </div>
  )
}

// ============================================
// Session Item
// ============================================

interface SessionItemProps {
  session: ApiSession
  isSelected: boolean
  onSelect: () => void
  onDelete: () => void
  onRename: (newTitle: string) => void
}

function SessionItem({ session, isSelected, onSelect, onDelete, onRename }: SessionItemProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editTitle, setEditTitle] = useState(session.title || '')
  const inputRef = useRef<HTMLInputElement>(null)

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (confirm('Delete this chat?')) {
      onDelete()
    }
  }

  const handleStartEdit = (e: React.MouseEvent) => {
    e.stopPropagation()
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

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  if (isEditing) {
    return (
      <div className="px-3 py-2">
        <input
          ref={inputRef}
          type="text"
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          onBlur={handleSaveEdit}
          onKeyDown={handleKeyDown}
          onClick={(e) => e.stopPropagation()}
          className="w-full bg-bg-000 border border-accent-main-100/50 rounded px-2 py-0.5 text-sm text-text-100 focus:outline-none focus:ring-1 focus:ring-accent-main-100/30 leading-relaxed"
        />
      </div>
    )
  }

  return (
    <div
      onClick={onSelect}
      className={`group relative flex items-center px-3 py-2 rounded-lg cursor-pointer transition-all duration-200 border border-transparent ${
        isSelected
          ? 'bg-bg-000 shadow-sm text-text-100 font-medium ring-1 ring-border-200/50' 
          : 'text-text-400 hover:bg-bg-200/50 hover:text-text-200'
      }`}
    >
      <div className="flex-1 min-w-0 pr-6">
        <p className="text-sm truncate leading-relaxed">
          {session.title || 'Untitled Chat'}
        </p>
      </div>
      
      {/* Actions (Rename/Delete) - only show on hover */}
      <div className={`absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5 transition-opacity ${
        isSelected ? 'opacity-0 group-hover:opacity-100' : 'opacity-0 group-hover:opacity-100'
      }`}>
        <button
          onClick={handleStartEdit}
          className="p-1 rounded-md hover:bg-bg-200 text-text-400 hover:text-text-100"
          title="Rename"
        >
          <PencilIcon className="w-3 h-3" />
        </button>
        <button
          onClick={handleDelete}
          className="p-1 rounded-md hover:bg-bg-200 text-text-400 hover:text-danger-100"
          title="Delete"
        >
          <TrashIcon className="w-3 h-3" />
        </button>
      </div>
    </div>
  )
}

// ============================================
// Loading Spinner
// ============================================

function LoadingSpinner({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const sizeClass = size === 'sm' ? 'w-3 h-3' : 'w-5 h-5'
  return (
    <svg
      className={`animate-spin text-text-400 ${sizeClass}`}
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="2"
        strokeOpacity="0.25"
      />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}
