import { useCallback, useMemo, useState, useEffect } from 'react'
import { SessionList } from '../../sessions'
import { ProjectSelector } from '../../sessions/ProjectSelector'
import { useDirectory } from '../../../hooks'
import { useSessionContext } from '../../../contexts/SessionContext'
import { updateSession, subscribeToConnectionState, type ApiSession, type ConnectionInfo } from '../../../api'
import { uiErrorHandler } from '../../../utils'
import { ComposeIcon } from '../../../components/Icons'

interface SidePanelProps {
  onNewSession: () => void
  onSelectSession: (session: ApiSession) => void
  onCloseMobile?: () => void
  selectedSessionId: string | null
  onAddProject: () => void
  isMobile?: boolean
  isCollapsed?: boolean
}

export function SidePanel({
  onNewSession,
  onSelectSession,
  onCloseMobile,
  selectedSessionId,
  onAddProject,
  isMobile = false,
  isCollapsed = false,
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

  // 构建项目列表数据
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

  // ==========================================
  // Render: Collapsed Mode (Icon Only)
  // ==========================================
  if (isCollapsed) {
    return (
      <div className="flex flex-col items-center h-full py-2 gap-4">
        <button
          onClick={onNewSession}
          className="w-10 h-10 flex items-center justify-center rounded-xl bg-bg-200/50 hover:bg-bg-200 hover:text-accent-main-100 text-text-400 transition-colors"
          title="New Chat"
        >
          <ComposeIcon size={20} />
        </button>
        
        {/* Placeholder icons for other features if needed */}
        <div className="w-8 h-px bg-border-200/50" />
        
        <div className="flex flex-col gap-3">
           {/* Just show simple indicators or nothing for now */}
           {/* Maybe show recent sessions as dots? No, just keep it clean */}
        </div>
      </div>
    )
  }

  // ==========================================
  // Render: Full Mode
  // ==========================================
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Top Section: Project Selector Header - 移动端隐藏（Sidebar 已有 header） */}
      {!isMobile && (
        <div className="h-14 flex items-center px-3 z-20 relative shrink-0">
          <div className="w-full relative z-20">
            <ProjectSelector
              currentProject={currentProject as any}
              projects={projects as any}
              isLoading={false}
              onSelectProject={handleSelectProject}
              onAddProject={onAddProject}
              onRemoveProject={handleRemoveProject}
            />
          </div>
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-hidden pt-2">
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

