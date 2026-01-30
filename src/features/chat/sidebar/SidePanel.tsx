import { useCallback, useMemo, useState, useEffect } from 'react'
import { SessionList } from '../../sessions'
import { ProjectSelector } from '../../sessions/ProjectSelector'
import { useDirectory } from '../../../hooks'
import { useSessionContext } from '../../../contexts/SessionContext'
import { updateSession, subscribeToConnectionState, type ApiSession, type ConnectionInfo } from '../../../api'
import { uiErrorHandler } from '../../../utils'

interface SidePanelProps {
  onNewSession: () => void
  onSelectSession: (session: ApiSession) => void
  onCloseMobile?: () => void
  selectedSessionId: string | null
  onAddProject: () => void
}

export function SidePanel({
  onNewSession,
  onSelectSession,
  onCloseMobile,
  selectedSessionId,
  onAddProject,
}: SidePanelProps) {
  const { currentDirectory, savedDirectories, setCurrentDirectory, removeDirectory } = useDirectory()
  const [connectionState, setConnectionState] = useState<ConnectionInfo | null>(null)
  
  // 监听 SSE 连接状态
  useEffect(() => {
    return subscribeToConnectionState(setConnectionState)
  }, [])
  
  // 使用 SessionContext
  const {
    sessions,
    isLoading,
    isLoadingMore,
    hasMore,
    search,
    setSearch,
    loadMore,
    deleteSession,
    refresh,
  } = useSessionContext()

  // 构建项目列表数据供 Selector 使用
  // 这里我们需要把 Global 和 Saved Directories 统一格式
  const projects = useMemo(() => {
    const list = []
    // Global
    list.push({
      id: 'global',
      worktree: 'All projects',
      name: 'Global',
      icon: { color: 'blue' }
    })
    // Saved
    savedDirectories.forEach(d => {
      list.push({
        id: d.path, // 使用 path 作为 ID
        worktree: d.path,
        name: d.name,
        icon: { color: 'indigo' } // 默认颜色
      })
    })
    return list
  }, [savedDirectories])

  const currentProject = useMemo(() => {
    if (!currentDirectory) return projects[0]
    return projects.find(p => p.id === currentDirectory) || {
      id: currentDirectory,
      worktree: currentDirectory,
      name: currentDirectory.split(/[/\\]/).pop() || currentDirectory,
      icon: { color: 'gray' }
    }
  }, [currentDirectory, projects])

  const handleSelectProject = useCallback((projectId: string) => {
    if (projectId === 'global') {
      setCurrentDirectory(undefined)
    } else {
      setCurrentDirectory(projectId)
    }
  }, [setCurrentDirectory])

  const handleRemoveProject = useCallback((projectId: string) => {
    removeDirectory(projectId)
  }, [removeDirectory])

  const handleSelect = useCallback((session: ApiSession) => {
    onSelectSession(session)
    if (window.innerWidth < 768 && onCloseMobile) {
      onCloseMobile()
    }
  }, [onSelectSession, onCloseMobile])

  const handleRename = useCallback(async (sessionId: string, newTitle: string) => {
    try {
      await updateSession(sessionId, { title: newTitle }, currentDirectory)
      refresh()
    } catch (e) {
      uiErrorHandler('rename session', e)
    }
  }, [currentDirectory, refresh])

  return (
    <div className="flex flex-col h-full overflow-hidden border-r border-border-200/30">
      {/* Top Section: Project & New Chat */}
      <div className="flex flex-col gap-2 p-3 flex-shrink-0">
        {/* Project Switcher */}
        <div className="relative z-20">
          <ProjectSelector
            currentProject={currentProject as any}
            projects={projects as any}
            isLoading={false}
            onSelectProject={handleSelectProject}
            onAddProject={onAddProject}
            onRemoveProject={handleRemoveProject}
          />
        </div>

        {/* New Chat Button */}
        <button
          onClick={onNewSession}
          className="relative group w-full flex items-center justify-between px-3 py-2 bg-bg-200/40 hover:bg-bg-200/80 text-text-200 rounded-lg transition-all duration-200"
        >
          <div className="flex items-center gap-2.5">
            <PlusIcon className="w-4 h-4 text-text-400 group-hover:text-text-100 transition-colors" />
            <span className="text-sm font-medium">New Chat</span>
          </div>
          <span className="text-[10px] font-mono text-text-400 opacity-0 group-hover:opacity-100 transition-opacity translate-x-2 group-hover:translate-x-0 bg-bg-000/50 px-1.5 py-0.5 rounded">
            Ctrl+N
          </span>
        </button>
      </div>

      {/* Divider - Subtle fade */}
      <div className="h-px bg-gradient-to-r from-transparent via-border-200/50 to-transparent mx-4 mb-2 flex-shrink-0" />

      {/* List */}
      <div className="flex-1 overflow-hidden">
        <SessionList
          sessions={sessions}
          selectedId={selectedSessionId}
          isLoading={isLoading}
          isLoadingMore={isLoadingMore}
          hasMore={hasMore}
          search={search}
          onSearchChange={setSearch}
          onSelect={handleSelect}
          onDelete={deleteSession}
          onRename={handleRename}
          onLoadMore={loadMore}
          onNewChat={onNewSession}
        />
      </div>
      
      {/* Bottom Bar: Connection & Settings */}
      <div className="px-4 py-3 border-t border-border-200/30 flex items-center justify-between text-xs text-text-400">
        <div className="flex items-center gap-2">
          <ConnectionIndicator state={connectionState?.state || 'disconnected'} />
          <span className="opacity-70">{connectionState?.state === 'connected' ? 'Online' : 'Offline'}</span>
        </div>
        {/* Settings button could go here */}
      </div>
    </div>
  )
}

// ============================================
// Connection Status Indicator
// ============================================

function ConnectionIndicator({ state }: { state: string }) {
  const colorClass = {
    connected: 'bg-success-100',
    connecting: 'bg-warning-100 animate-pulse',
    disconnected: 'bg-text-500',
    error: 'bg-danger-100',
  }[state] || 'bg-text-500'
  
  const title = {
    connected: 'Connected',
    connecting: 'Connecting...',
    disconnected: 'Disconnected',
    error: 'Connection error',
  }[state] || 'Unknown'

  return (
    <div className="flex items-center gap-1.5" title={title}>
      <div className={`w-1.5 h-1.5 rounded-full ${colorClass}`} />
    </div>
  )
}

// ============================================
// Icons
// ============================================

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}
