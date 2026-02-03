import { useCallback, useMemo, useState, useEffect } from 'react'
import { SessionList } from '../../sessions'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import { 
  SidebarIcon, 
  FolderIcon, 
  GlobeIcon, 
  PlusIcon, 
  TrashIcon, 
  SearchIcon,
  ChevronDownIcon,
  CogIcon,
  TerminalIcon
} from '../../../components/Icons'
import { useDirectory, useSessionStats, formatTokens, formatCost } from '../../../hooks'
import { useSessionContext } from '../../../contexts/SessionContext'
import { useMessageStore } from '../../../store'
import { updateSession, subscribeToConnectionState, type ApiSession, type ConnectionInfo } from '../../../api'
import { uiErrorHandler } from '../../../utils'
import type { SessionStats } from '../../../hooks'

// Claude.ai 设计模式：
// - 按钮结构统一，不因 expanded/collapsed 改变 DOM
// - 按钮内容使用 -translate-x-2 让图标在收起时居中
// - 文字用 opacity 过渡，不改变布局
// - 收起宽度 49px，展开宽度 288px

interface SidePanelProps {
  onNewSession: () => void
  onSelectSession: (session: ApiSession) => void
  onCloseMobile?: () => void
  selectedSessionId: string | null
  onAddProject: () => void
  isMobile?: boolean
  isExpanded?: boolean
  onToggleSidebar: () => void
  contextLimit?: number
  onOpenSettings?: () => void
}

interface ProjectItem {
  id: string
  worktree: string
  name: string
}

export function SidePanel({
  onNewSession,
  onSelectSession,
  onCloseMobile,
  selectedSessionId,
  onAddProject,
  isMobile = false,
  isExpanded = true,
  onToggleSidebar,
  contextLimit = 200000,
  onOpenSettings,
}: SidePanelProps) {
  const { currentDirectory, savedDirectories, setCurrentDirectory, removeDirectory } = useDirectory()
  const [connectionState, setConnectionState] = useState<ConnectionInfo | null>(null)
  const [projectDeleteConfirm, setProjectDeleteConfirm] = useState<{ isOpen: boolean; projectId: string | null }>({
    isOpen: false,
    projectId: null
  })
  const [recentsExpanded, setRecentsExpanded] = useState(true)
  const [projectsExpanded, setProjectsExpanded] = useState(false)
  
  const showLabels = isExpanded || isMobile
  
  // Session stats
  const { messages } = useMessageStore()
  const stats = useSessionStats(contextLimit)
  const hasMessages = messages.length > 0
  
  useEffect(() => {
    return subscribeToConnectionState(setConnectionState)
  }, [])
  
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

  const projects = useMemo<ProjectItem[]>(() => {
    const list: ProjectItem[] = [{
      id: 'global',
      worktree: 'All projects',
      name: 'Global',
    }]
    savedDirectories.forEach(d => {
      list.push({
        id: d.path,
        worktree: d.path,
        name: d.name,
      })
    })
    return list
  }, [savedDirectories])

  const currentProject = useMemo<ProjectItem>(() => {
    if (!currentDirectory) return projects[0]
    return projects.find(p => p.id === currentDirectory) || {
      id: currentDirectory,
      worktree: currentDirectory,
      name: currentDirectory.split(/[/\\]/).pop() || currentDirectory,
    }
  }, [currentDirectory, projects])

  const handleSelectProject = useCallback((projectId: string) => {
    if (projectId === 'global') {
      setCurrentDirectory(undefined)
    } else {
      setCurrentDirectory(projectId)
    }
    setProjectsExpanded(false)
    if (isMobile && onCloseMobile) {
      onCloseMobile()
    }
  }, [setCurrentDirectory, isMobile, onCloseMobile])

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

  useEffect(() => {
    if (!isExpanded) {
      setProjectsExpanded(false)
    }
  }, [isExpanded])

  // 统一的结构，通过 CSS 控制显示/隐藏
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ===== Header ===== */}
      <div className="h-14 shrink-0 flex items-center">
        {/* Logo 区域 - 展开时显示 */}
        <div 
          className="overflow-hidden transition-all duration-300 ease-out"
          style={{ 
            width: showLabels ? 'auto' : 0,
            paddingLeft: showLabels ? 16 : 0,
            opacity: showLabels ? 1 : 0,
          }}
        >
          <a href="/" className="flex items-center whitespace-nowrap">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 68 16" className="h-4 text-text-100" fill="currentColor">
              <path d="M7.98 15.73C6.50667 15.73 5.17667 15.4367 3.99 14.85C2.81 14.2567 1.88 13.4167 1.2 12.33C0.526669 11.2367 0.190002 9.96334 0.190002 8.51001C0.190002 7.01001 0.526669 5.67334 1.2 4.50001C1.87334 3.32668 2.8 2.41668 3.98 1.77001C5.16667 1.11668 6.49334 0.790009 7.96 0.790009C8.88667 0.790009 9.81667 0.896676 10.75 1.11001C11.69 1.32334 12.5033 1.64001 13.19 2.06001V5.36001H12.29C12.05 4.22668 11.5867 3.36334 10.9 2.77001C10.2133 2.17668 9.24 1.88001 7.98 1.88001C6.85334 1.88001 5.91334 2.15334 5.16 2.70001C4.40667 3.24001 3.84667 3.98334 3.48 4.93001C3.12 5.87001 2.94 6.94668 2.94 8.16001C2.94 9.37334 3.14667 10.4733 3.56 11.46C3.97334 12.44 4.57667 13.2167 5.37 13.79C6.16334 14.3567 7.11 14.64 8.21 14.64C8.97667 14.64 9.63667 14.4733 10.19 14.14C10.75 13.8 11.2167 13.3533 11.59 12.8C11.97 12.2467 12.3367 11.5667 12.69 10.76H13.63L12.99 14.43C12.35 14.8567 11.5733 15.18 10.66 15.4C9.75334 15.62 8.86 15.73 7.98 15.73Z"/>
            </svg>
          </a>
        </div>
        
        {/* Toggle Button - 桌面端和移动端都显示 */}
        <div 
          className="flex-1 flex items-center transition-all duration-300 ease-out"
          style={{ justifyContent: showLabels ? 'flex-end' : 'center', paddingRight: showLabels ? 8 : 0 }}
        >
          <button
            onClick={onToggleSidebar}
            aria-label={isExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
            className="h-8 w-8 flex items-center justify-center rounded-lg text-text-400 hover:text-text-100 hover:bg-bg-200 active:scale-[0.98] transition-all duration-200"
          >
            <SidebarIcon size={18} />
          </button>
        </div>
      </div>

      {/* ===== Navigation - 图标位置固定 ===== */}
      <div className="flex flex-col gap-0.5 mx-2">
        {/* New Chat - 图标始终在 padding-left: 6px 位置，收起时刚好居中 */}
        <button
          onClick={onNewSession}
          className="h-8 flex items-center rounded-lg text-text-300 hover:text-text-100 hover:bg-bg-200 active:scale-[0.98] transition-all duration-300 group overflow-hidden"
          style={{ 
            width: showLabels ? '100%' : 32,
            paddingLeft: 6,
            paddingRight: 6,
          }}
          title="New chat"
        >
          <span className="size-5 flex items-center justify-center shrink-0">
            <PlusIcon size={16} />
          </span>
          <span 
            className="ml-2 text-sm whitespace-nowrap transition-opacity duration-300"
            style={{ opacity: showLabels ? 1 : 0 }}
          >
            New chat
          </span>
          <span 
            className="ml-auto text-[10px] text-text-500 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap"
            style={{ opacity: showLabels ? undefined : 0 }}
          >
            Ctrl+Shift+O
          </span>
        </button>

        {/* Project Selector - 只在展开时显示 */}
        {showLabels && (
          <button
            onClick={() => setProjectsExpanded(!projectsExpanded)}
            className={`h-8 flex items-center rounded-lg active:scale-[0.98] transition-all duration-300 overflow-hidden ${
              projectsExpanded ? 'bg-bg-200 text-text-100' : 'text-text-300 hover:text-text-100 hover:bg-bg-200'
            }`}
            style={{ paddingLeft: 6, paddingRight: 6 }}
            title={currentProject?.name || 'Global'}
          >
            <span className="size-5 flex items-center justify-center shrink-0">
              {currentProject?.id === 'global' 
                ? <GlobeIcon size={16} className="text-accent-main-100" /> 
                : <FolderIcon size={16} />
              }
            </span>
            <span className="ml-2 text-sm truncate">
              {currentProject?.name || 'Global'}
            </span>
            <ChevronDownIcon 
              size={14} 
              className={`ml-auto text-text-400 transition-transform duration-200 shrink-0 ${projectsExpanded ? '' : '-rotate-90'}`}
            />
          </button>
        )}
        
        {/* Projects Dropdown */}
        <div 
          className="overflow-hidden transition-all duration-300 ease-out"
          style={{
            maxHeight: (showLabels && projectsExpanded) ? 300 : 0,
            opacity: (showLabels && projectsExpanded) ? 1 : 0,
            marginTop: (showLabels && projectsExpanded) ? 4 : 0,
          }}
        >
          <div className="rounded-lg border border-border-200/50 bg-bg-100/80 overflow-hidden">
            <div className="max-h-48 overflow-y-auto custom-scrollbar py-1">
              {projects.map((project) => {
                const isGlobal = project.id === 'global'
                const isActive = currentProject?.id === project.id
                return (
                  <button
                    key={project.id}
                    onClick={() => handleSelectProject(project.id)}
                    className={`group w-full flex items-center gap-2 px-2 py-1.5 transition-colors ${
                      isActive ? 'bg-bg-200/60 text-text-100' : 'text-text-300 hover:text-text-100 hover:bg-bg-200/50'
                    }`}
                    title={project.worktree}
                  >
                    <span className="w-5 h-5 flex items-center justify-center">
                      {isGlobal 
                        ? <GlobeIcon size={14} className="text-accent-main-100" /> 
                        : <FolderIcon size={14} />
                      }
                    </span>
                    <span className="flex-1 text-xs text-left truncate">{project.name}</span>
                    {!isGlobal && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setProjectDeleteConfirm({ isOpen: true, projectId: project.id })
                        }}
                        className="p-1 rounded text-text-400 hover:text-danger-100 hover:bg-danger-100/10 opacity-0 group-hover:opacity-100 transition-all"
                        title="Remove"
                      >
                        <TrashIcon size={12} />
                      </button>
                    )}
                  </button>
                )
              })}
            </div>
            <div className="border-t border-border-200/50 p-1">
              <button
                onClick={onAddProject}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-text-400 hover:text-text-100 hover:bg-bg-200/50 transition-colors"
              >
                <PlusIcon size={14} />
                Add project...
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ===== Main Content ===== */}
      <div 
        className="flex-1 flex flex-col min-h-0 overflow-hidden transition-all duration-300 ease-out"
        style={{
          opacity: showLabels ? 1 : 0,
          visibility: showLabels ? 'visible' : 'hidden',
        }}
      >
        {/* Search */}
        <div className="px-3 py-2 mt-2">
          <div className="relative group">
            <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-400 w-3.5 h-3.5 group-focus-within:text-accent-main-100 transition-colors" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search chats..."
              className="w-full bg-bg-200/40 hover:bg-bg-200/60 focus:bg-bg-000 border border-transparent focus:border-border-200 rounded-lg py-1.5 pl-8 pr-8 text-xs text-text-100 placeholder:text-text-400/70 focus:outline-none transition-all"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-400 hover:text-text-100 text-sm"
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </div>
        </div>

        {/* Recents */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <button
            onClick={() => setRecentsExpanded(!recentsExpanded)}
            className="flex items-center justify-between px-4 py-1.5 group cursor-pointer"
          >
            <span className="text-[10px] font-semibold text-text-500 uppercase tracking-wider">
              Recents
            </span>
            <span className="text-text-400 opacity-0 group-hover:opacity-75 transition-opacity text-[10px]">
              {recentsExpanded ? 'Hide' : 'Show'}
            </span>
          </button>
          
          {recentsExpanded && (
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
                showHeader={false}
                grouped={false}
                density="compact"
                showStats
              />
            </div>
          )}
        </div>
      </div>

      {/* Spacer for collapsed */}
      {!showLabels && <div className="flex-1" />}
      
      {/* ===== Footer ===== */}
      <SidebarFooter
        showLabels={showLabels}
        connectionState={connectionState?.state || 'disconnected'}
        stats={stats}
        hasMessages={hasMessages}
        onOpenSettings={onOpenSettings}
      />

      {/* Confirm Dialog */}
      <ConfirmDialog
        isOpen={projectDeleteConfirm.isOpen}
        onClose={() => setProjectDeleteConfirm({ isOpen: false, projectId: null })}
        onConfirm={() => {
          if (projectDeleteConfirm.projectId) {
            handleRemoveProject(projectDeleteConfirm.projectId)
          }
          setProjectDeleteConfirm({ isOpen: false, projectId: null })
        }}
        title="Remove Project"
        description="Remove this project folder from the list? Files won't be deleted."
        confirmText="Remove"
        variant="danger"
      />
    </div>
  )
}

// ============================================
// Sidebar Footer Component
// ============================================

interface SidebarFooterProps {
  showLabels: boolean
  connectionState: string
  stats: SessionStats
  hasMessages: boolean
  onOpenSettings?: () => void
}

function SidebarFooter({ 
  showLabels, 
  connectionState, 
  stats, 
  hasMessages,
  onOpenSettings 
}: SidebarFooterProps) {
  const [showTooltip, setShowTooltip] = useState(false)
  
  // Connection Status Color
  const statusColor = {
    connected: 'bg-success-100',
    connecting: 'bg-warning-100 animate-pulse',
    disconnected: 'bg-text-500',
    error: 'bg-danger-100',
  }[connectionState] || 'bg-text-500'

  const statsColor = stats.contextPercent >= 90 ? 'bg-danger-100' :
                     stats.contextPercent >= 70 ? 'bg-warning-100' : 
                     'bg-accent-main-100'

  // ========== 收起状态 (Rail Mode) ==========
  if (!showLabels) {
    return (
      <div className="shrink-0 border-t border-border-200/30 p-2 flex flex-col items-center gap-1">
        <div 
          className="relative w-8 h-8 flex items-center justify-center rounded-lg hover:bg-bg-200/50 transition-colors cursor-pointer group"
          onMouseEnter={() => setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
          onClick={onOpenSettings}
        >
          {/* Terminal Icon */}
          <TerminalIcon size={18} className="text-text-300 group-hover:text-text-100 transition-colors" />
          
          {/* Connection Status Dot (Top Right) */}
          <div className={`absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full border border-bg-100 ${statusColor}`} />
          
          {/* Hover Tooltip */}
          {showTooltip && (
             <div className="absolute left-full ml-3 bottom-0 z-[100] bg-bg-100 border border-border-200 p-2 rounded-lg shadow-xl whitespace-nowrap">
                <div className="text-xs font-medium text-text-200">Local Environment</div>
                {hasMessages && (
                  <div className="text-[10px] text-text-400 font-mono mt-1">
                    Context: {Math.round(stats.contextPercent)}%
                  </div>
                )}
             </div>
          )}
        </div>

        {/* Micro Progress Bar (Always Visible) */}
        {hasMessages && (
          <div className="w-6 h-1 bg-bg-300 rounded-full overflow-hidden" title={`${Math.round(stats.contextPercent)}% Used`}>
            <div 
              className={`h-full ${statsColor} transition-all duration-300`} 
              style={{ width: `${Math.min(100, stats.contextPercent)}%` }}
            />
          </div>
        )}
      </div>
    )
  }

  // ========== 展开状态 (Dashboard Mode) ==========
  return (
    <div className="shrink-0 border-t border-border-200/30 bg-bg-100/50">
      <div className="px-4 py-3 space-y-3">
        
        {/* Top Row: Identity & Actions */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 overflow-hidden">
            <div className="w-8 h-8 rounded-lg bg-bg-200/50 flex items-center justify-center shrink-0">
               <TerminalIcon size={16} className="text-text-300" />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-medium text-text-100 truncate">Local Env</span>
              <div className="flex items-center gap-1.5">
                <div className={`w-1.5 h-1.5 rounded-full ${statusColor}`} />
                <span className="text-[10px] text-text-400 truncate capitalize">{connectionState}</span>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-1 shrink-0">
             {/* Settings Button */}
             <button 
               onClick={onOpenSettings}
               className="p-1.5 text-text-400 hover:text-text-100 hover:bg-bg-200 rounded-md transition-colors"
               title="Settings"
             >
               <CogIcon size={16} />
             </button>
          </div>
        </div>

        {/* Stats Section (Always Visible if messages exist) */}
        {hasMessages && (
          <div className="bg-bg-200/30 rounded-lg p-2.5 border border-border-200/30">
            <div className="flex justify-between items-end mb-1.5">
              <span className="text-[10px] font-bold text-text-400 uppercase tracking-wider">Context Usage</span>
              <span className={`text-xs font-mono font-medium ${
                 stats.contextPercent > 90 ? 'text-danger-100' : 'text-text-200'
              }`}>
                {Math.round(stats.contextPercent)}%
              </span>
            </div>
            
            <div className="w-full h-2 bg-bg-300/50 rounded-full overflow-hidden mb-2">
              <div 
                className={`h-full ${statsColor} transition-all duration-500`} 
                style={{ width: `${Math.min(100, stats.contextPercent)}%` }}
              />
            </div>
            
            <div className="flex justify-between text-[10px] text-text-400 font-mono">
              <span>{formatTokens(stats.contextUsed)} / {formatTokens(stats.contextLimit)}</span>
              {stats.totalCost > 0 && (
                <span>{formatCost(stats.totalCost)}</span>
              )}
            </div>
          </div>
        )}
        
      </div>
    </div>
  )
}
