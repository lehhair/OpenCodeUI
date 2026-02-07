import { useCallback, useMemo, useState, useEffect, useRef } from 'react'
import { SessionList } from '../../sessions'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import { ShareDialog } from '../ShareDialog'
import { 
  SidebarIcon, 
  FolderIcon, 
  GlobeIcon, 
  PlusIcon, 
  TrashIcon, 
  SearchIcon,
  ChevronDownIcon,
  CogIcon,
  SunIcon,
  MoonIcon,
  SystemIcon,
  MaximizeIcon,
  MinimizeIcon,
  ShareIcon,
} from '../../../components/Icons'
import { useDirectory, useSessionStats, formatTokens, formatCost } from '../../../hooks'
import type { ThemeMode } from '../../../hooks'
import { useSessionContext } from '../../../contexts/SessionContext'
import { useMessageStore } from '../../../store'
import { updateSession, subscribeToConnectionState, type ApiSession, type ConnectionInfo } from '../../../api'
import { uiErrorHandler } from '../../../utils'
import type { SessionStats } from '../../../hooks'

// 获取路径的父目录部分（用于显示项目位置）
function getParentPath(fullPath: string): string {
  // 处理 Windows 和 Unix 路径
  const sep = fullPath.includes('\\') ? '\\' : '/'
  const parts = fullPath.split(sep)
  // 移除最后一个部分（文件夹名本身）
  parts.pop()
  if (parts.length === 0) return sep
  // Windows: 保留盘符，Unix: 保留开头的 /
  const parent = parts.join(sep)
  return parent || sep
}

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
  themeMode?: ThemeMode
  onThemeChange?: (mode: ThemeMode, event?: React.MouseEvent) => void
  isWideMode?: boolean
  onToggleWideMode?: () => void
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
  themeMode,
  onThemeChange,
  isWideMode,
  onToggleWideMode,
}: SidePanelProps) {
  const { currentDirectory, savedDirectories, setCurrentDirectory, removeDirectory, recentProjects } = useDirectory()
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
    // 按最近使用时间排序，最近使用的排最前
    const sorted = [...savedDirectories].sort((a, b) => {
      const aTime = recentProjects[a.path] || a.addedAt
      const bTime = recentProjects[b.path] || b.addedAt
      return bTime - aTime
    })
    sorted.forEach(d => {
      list.push({
        id: d.path,
        worktree: d.path,
        name: d.name,
      })
    })
    return list
  }, [savedDirectories, recentProjects])

  const currentProject = useMemo<ProjectItem>(() => {
    if (!currentDirectory) return projects[0]
    const found = projects.find(p => p.id === currentDirectory)
    if (found) return found
    
    // 未保存的目录，从路径提取名称并解码
    const rawName = currentDirectory.split(/[/\\]/).pop() || currentDirectory
    let decodedName = rawName
    try {
      decodedName = decodeURIComponent(rawName)
    } catch {
      // 解码失败就用原值
    }
    return {
      id: currentDirectory,
      worktree: currentDirectory,
      name: decodedName,
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
                  <div
                    key={project.id}
                    onClick={() => handleSelectProject(project.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        handleSelectProject(project.id)
                      }
                    }}
                    className={`group w-full flex items-center gap-2 px-2 py-1.5 transition-colors cursor-pointer ${
                      isActive ? 'bg-bg-200/60 text-text-100' : 'text-text-300 hover:text-text-100 hover:bg-bg-200/50'
                    }`}
                    title={project.worktree}
                  >
                    <span className="w-5 h-5 flex items-center justify-center shrink-0">
                      {isGlobal 
                        ? <GlobeIcon size={14} className="text-accent-main-100" /> 
                        : <FolderIcon size={14} />
                      }
                    </span>
                    <div className="flex-1 min-w-0 text-left">
                      <div className="text-xs truncate">{project.name}</div>
                      {!isGlobal && project.worktree && (
                        <div className="text-[10px] text-text-400 truncate font-mono opacity-70">
                          {getParentPath(project.worktree)}
                        </div>
                      )}
                    </div>
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
                  </div>
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
        themeMode={themeMode}
        onThemeChange={onThemeChange}
        isWideMode={isWideMode}
        onToggleWideMode={onToggleWideMode}
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

import { createPortal } from 'react-dom'

interface SidebarFooterProps {
  showLabels: boolean
  connectionState: string
  stats: SessionStats
  hasMessages: boolean
  onOpenSettings?: () => void
  themeMode?: ThemeMode
  onThemeChange?: (mode: ThemeMode, event?: React.MouseEvent) => void
  isWideMode?: boolean
  onToggleWideMode?: () => void
}

// 状态指示器 - 圆环 + 右下角状态点
function StatusIndicator({ 
  percent, 
  connectionState,
  size = 24 
}: { 
  percent: number
  connectionState: string
  size?: number 
}) {
  const strokeWidth = 3 // 加粗
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const clampedPercent = Math.min(Math.max(percent, 0), 100)
  const offset = circumference - (clampedPercent / 100) * circumference
  
  // 进度颜色
  const progressColor = clampedPercent === 0 ? 'text-text-500' :
                        clampedPercent >= 90 ? 'text-danger-100' :
                        clampedPercent >= 70 ? 'text-warning-100' : 
                        'text-accent-main-100'
  
  // 连接状态颜色
  const statusColor = connectionState === 'connected' ? 'bg-success-100' :
                      connectionState === 'connecting' ? 'bg-warning-100 animate-pulse' :
                      connectionState === 'error' ? 'bg-danger-100' :
                      'bg-text-500'

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg 
        className="-rotate-90" 
        width={size} 
        height={size} 
        viewBox={`0 0 ${size} ${size}`}
      >
        {/* 背景轨道 - 确保和进度条一样粗 */}
        <circle
          className="text-bg-300"
          strokeWidth={strokeWidth}
          stroke="currentColor"
          fill="transparent"
          r={radius}
          cx={size / 2}
          cy={size / 2}
        />
        {/* 进度弧 */}
        <circle
          className={`${progressColor} transition-all duration-500 ease-out`}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          stroke="currentColor"
          fill="transparent"
          r={radius}
          cx={size / 2}
          cy={size / 2}
        />
      </svg>
      
      {/* 右下角状态点 - 带背景边框以突出显示 */}
      <div 
        className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-bg-200 ${statusColor}`}
      />
    </div>
  )
}

function SidebarFooter({ 
  showLabels, 
  connectionState, 
  stats, 
  hasMessages,
  onOpenSettings,
  themeMode = 'system',
  onThemeChange,
  isWideMode,
  onToggleWideMode,
}: SidebarFooterProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0, width: 260, fromBottom: false })
  const [shareDialogOpen, setShareDialogOpen] = useState(false)
  const [isVisible, setIsVisible] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const closeTimeoutIdRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  
  // 菜单中连接状态显示用
  const statusColorClass = {
    connected: 'bg-success-100',
    connecting: 'bg-warning-100 animate-pulse',
    disconnected: 'bg-text-500',
    error: 'bg-danger-100',
  }[connectionState] || 'bg-text-500'

  const statsColor = stats.contextPercent >= 90 ? 'bg-danger-100' :
                     stats.contextPercent >= 70 ? 'bg-warning-100' : 
                     'bg-accent-main-100'

  // 打开菜单
  const openMenu = useCallback(() => {
    if (!buttonRef.current || !containerRef.current) return
    
    const buttonRect = buttonRef.current.getBoundingClientRect()
    const containerRect = containerRef.current.getBoundingClientRect()
    const menuWidth = showLabels ? containerRect.width : 260
    
    if (showLabels) {
      // 展开模式：菜单底部在容器上方，留点间隙
      setMenuPos({
        top: containerRect.top - 8,
        left: containerRect.left,
        width: menuWidth,
        fromBottom: true,
      })
    } else {
      // 收起模式：菜单在按钮右侧，底部对齐按钮底部
      setMenuPos({
        top: buttonRect.bottom, // 用作 bottom 计算的参考点
        left: buttonRect.right + 16, // 间距增加到 16px
        width: 260,
        fromBottom: true, // 也用 bottom 定位
      })
    }
    
    setIsOpen(true)
    requestAnimationFrame(() => setIsVisible(true))
  }, [showLabels])

  // 关闭菜单
  const closeMenu = useCallback(() => {
    setIsVisible(false)
    // 使用 ref 追踪 timeout 以便清理
    const closeTimeoutId = setTimeout(() => setIsOpen(false), 150)
    // 保存到 ref 以便清理
    closeTimeoutIdRef.current = closeTimeoutId
  }, [])

  // 切换菜单
  const toggleMenu = useCallback(() => {
    if (isOpen) closeMenu()
    else openMenu()
  }, [isOpen, openMenu, closeMenu])

  // 点击外部关闭
  useEffect(() => {
    if (!isOpen) return
    
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (buttonRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      closeMenu()
    }
    
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen, closeMenu])

  // ESC 关闭
  useEffect(() => {
    if (!isOpen) return
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu()
    }
    document.addEventListener('keydown', handleEsc)
    return () => document.removeEventListener('keydown', handleEsc)
  }, [isOpen, closeMenu])
  
  // 侧边栏状态变化时关闭
  useEffect(() => {
    if (isOpen) closeMenu()
  }, [showLabels]) // eslint-disable-line react-hooks/exhaustive-deps

  // 清理 closeTimeout 防止内存泄漏
  useEffect(() => {
    return () => {
      if (closeTimeoutIdRef.current) {
        clearTimeout(closeTimeoutIdRef.current)
        closeTimeoutIdRef.current = null
      }
    }
  }, [])

  // 浮动菜单
  const floatingMenu = isOpen ? createPortal(
    <div 
      ref={menuRef}
      className={`
        fixed z-[9999] rounded-xl border border-border-200/60 bg-bg-100 shadow-2xl overflow-hidden
        transition-all duration-150 ease-out
        ${isVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}
      `}
      style={{
        bottom: window.innerHeight - menuPos.top,
        left: menuPos.left, 
        width: menuPos.width,
        transformOrigin: showLabels ? 'bottom left' : 'bottom left',
      }}
    >
      {/* Context Stats */}
      <div className="p-3 border-b border-border-200/30">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-text-200">Context Usage</span>
          <span className="text-xs font-mono text-text-400">{Math.round(stats.contextPercent)}%</span>
        </div>
        <div className="w-full h-1.5 bg-bg-300 rounded-full overflow-hidden relative mb-2">
          <div 
            className={`absolute inset-0 ${statsColor} transition-transform duration-500 ease-out origin-left`} 
            style={{ transform: `scaleX(${Math.min(100, stats.contextPercent) / 100})` }}
          />
        </div>
        <div className="flex justify-between text-[10px] text-text-400 font-mono">
          <span>{formatTokens(stats.contextUsed)} / {formatTokens(stats.contextLimit)}</span>
          <span>{formatCost(stats.totalCost)}</span>
        </div>
      </div>

      {/* Theme Selector */}
      <div className="p-2 border-b border-border-200/30">
        <div className="text-[10px] font-bold text-text-400 uppercase tracking-wider px-1 mb-1.5">Appearance</div>
        <div className="flex bg-bg-200/50 p-1 rounded-lg border border-border-200/30 relative isolate">
          <div
            className="absolute top-1 bottom-1 left-1 w-[calc((100%-8px)/3)] bg-bg-000 rounded-md shadow-sm ring-1 ring-border-200/50 transition-transform duration-300 ease-out -z-10"
            style={{
              transform: themeMode === 'system' ? 'translateX(0%)' : themeMode === 'light' ? 'translateX(100%)' : 'translateX(200%)'
            }}
          />
          {(['system', 'light', 'dark'] as const).map((m) => (
            <button
              key={m}
              onClick={(e) => onThemeChange?.(m, e)}
              className={`flex-1 flex items-center justify-center py-1.5 rounded-md text-xs font-medium transition-colors duration-200 ${
                themeMode === m ? 'text-text-100' : 'text-text-400 hover:text-text-200'
              }`}
            >
              {m === 'system' && <SystemIcon size={14} />}
              {m === 'light' && <SunIcon size={14} />}
              {m === 'dark' && <MoonIcon size={14} />}
            </button>
          ))}
        </div>
      </div>
      
      {/* Menu Items */}
      <div className="py-1">
        {onToggleWideMode && (
          <button
            onClick={() => { onToggleWideMode(); closeMenu(); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-text-300 hover:text-text-100 hover:bg-bg-200/50 transition-colors text-left"
          >
            {isWideMode ? <MinimizeIcon size={14} /> : <MaximizeIcon size={14} />}
            <span>{isWideMode ? 'Standard Width' : 'Wide Mode'}</span>
          </button>
        )}

        <button
          onClick={() => { closeMenu(); setShareDialogOpen(true); }}
          className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-text-300 hover:text-text-100 hover:bg-bg-200/50 transition-colors text-left"
        >
          <ShareIcon size={14} />
          <span>Share Chat</span>
        </button>

        <button
          onClick={() => { closeMenu(); onOpenSettings?.(); }}
          className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-text-300 hover:text-text-100 hover:bg-bg-200/50 transition-colors text-left"
        >
          <CogIcon size={14} />
          <span>Settings</span>
        </button>
      </div>

      {/* Connection Status */}
      <div className="flex items-center gap-2 px-3 py-2 text-[10px] text-text-400 cursor-default border-t border-border-200/30 bg-bg-200/20">
        <div className={`w-1.5 h-1.5 rounded-full ${statusColorClass}`} />
        <span className="capitalize">{connectionState}</span>
      </div>
    </div>,
    document.body
  ) : null

  return (
    <div className="shrink-0 border-t border-border-200/30">
      <div ref={containerRef} className="flex flex-col gap-0.5 mx-2 py-2">
        {/* 触发按钮 */}
        <button
          ref={buttonRef}
          onClick={toggleMenu}
          className={`
            h-8 flex items-center rounded-lg transition-all duration-300 group overflow-hidden
            ${isOpen 
              ? 'bg-bg-200 text-text-100' 
              : 'text-text-300 hover:text-text-100 hover:bg-bg-200'
            }
          `}
          style={{ 
            width: showLabels ? '100%' : 32,
            paddingLeft: showLabels ? 6 : 4, // 收起时为了对齐中心线(16px)，24px圆环需要4px padding (4+12=16)
            paddingRight: showLabels ? 8 : 4,
          }}
          title={`Context: ${Math.round(stats.contextPercent)}%`}
        >
          {/* 状态指示器 */}
          <StatusIndicator 
            percent={stats.contextPercent} 
            connectionState={connectionState}
            size={24} 
          />
          
          {/* 展开时显示详细信息 */}
          <span 
            className="ml-2 flex-1 flex items-center justify-between min-w-0 transition-opacity duration-300"
            style={{ opacity: showLabels ? 1 : 0 }}
          >
            <span className="text-xs font-mono text-text-300 truncate">
              {hasMessages ? formatTokens(stats.contextUsed) : '0'} / {formatTokens(stats.contextLimit)}
            </span>
            <span className={`text-xs font-medium ml-2 ${
              stats.contextPercent >= 90 ? 'text-danger-100' :
              stats.contextPercent >= 70 ? 'text-warning-100' : 
              'text-text-400'
            }`}>
              {Math.round(stats.contextPercent)}%
            </span>
          </span>
        </button>
      </div>
      
      {floatingMenu}
      <ShareDialog isOpen={shareDialogOpen} onClose={() => setShareDialogOpen(false)} />
    </div>
  )
}
