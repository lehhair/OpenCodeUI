import { useState, useCallback, useEffect, useRef, memo } from 'react'
import { SidePanel } from './sidebar/SidePanel'
import { ProjectDialog } from './ProjectDialog'
import { useDirectory } from '../../hooks'
import { type ApiSession } from '../../api'
import type { ThemeMode } from '../../hooks'

const MIN_WIDTH = 240
const MAX_WIDTH = 480
const DEFAULT_WIDTH = 288  // 18rem = 288px
const RAIL_WIDTH = 49      // 3.05rem ≈ 49px

interface SidebarProps {
  isOpen: boolean
  selectedSessionId: string | null
  onSelectSession: (session: ApiSession) => void
  onNewSession: () => void
  onOpen: () => void
  onClose: () => void
  contextLimit?: number
  onOpenSettings?: () => void
  themeMode?: ThemeMode
  onThemeChange?: (mode: ThemeMode, event?: React.MouseEvent) => void
  isWideMode?: boolean
  onToggleWideMode?: () => void
  projectDialogOpen?: boolean
  onProjectDialogClose?: () => void
}

export const Sidebar = memo(function Sidebar({
  isOpen,
  selectedSessionId,
  onSelectSession,
  onNewSession,
  onOpen,
  onClose,
  contextLimit,
  onOpenSettings,
  themeMode,
  onThemeChange,
  isWideMode,
  onToggleWideMode,
  projectDialogOpen,
  onProjectDialogClose,
}: SidebarProps) {
  const [isProjectDialogOpen, setIsProjectDialogOpen] = useState(false)
  const { addDirectory, pathInfo } = useDirectory()
  const [isMobile, setIsMobile] = useState(false)

  // 外部触发打开 ProjectDialog（快捷键 / CommandPalette）
  useEffect(() => {
    if (projectDialogOpen) {
      setIsProjectDialogOpen(true)
    }
  }, [projectDialogOpen])
  
  // Resizable state
  const [width, setWidth] = useState(() => {
    try {
      const saved = localStorage.getItem('sidebar-width')
      return saved ? Math.min(Math.max(parseInt(saved), MIN_WIDTH), MAX_WIDTH) : DEFAULT_WIDTH
    } catch {
      return DEFAULT_WIDTH
    }
  })
  const [isResizing, setIsResizing] = useState(false)
  const sidebarRef = useRef<HTMLDivElement>(null)

  const handleAddProject = useCallback((path: string) => {
    addDirectory(path)
    if (!isMobile) {
      onOpen()
    }
  }, [addDirectory, isMobile, onOpen])

  const openProjectDialog = useCallback(() => {
    setIsProjectDialogOpen(true)
  }, [])

  const closeProjectDialog = useCallback(() => {
    setIsProjectDialogOpen(false)
    onProjectDialogClose?.()
  }, [onProjectDialogClose])

  // 检测移动端 (md breakpoint = 768px)
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  // Resize logic (desktop only)
  useEffect(() => {
    if (!isResizing || isMobile) return

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.min(Math.max(e.clientX, MIN_WIDTH), MAX_WIDTH)
      setWidth(newWidth)
    }

    const handleMouseUp = () => {
      setIsResizing(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      localStorage.setItem('sidebar-width', width.toString())
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing, width, isMobile])
  
  // Save width
  useEffect(() => {
    if (!isResizing && !isMobile) {
      localStorage.setItem('sidebar-width', width.toString())
    }
  }, [width, isResizing, isMobile])

  const startResizing = useCallback((e: React.MouseEvent) => {
    if (isMobile) return
    e.preventDefault()
    setIsResizing(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [isMobile])

  // 移动端遮罩点击关闭
  const handleBackdropClick = useCallback(() => {
    if (isMobile && isOpen) {
      onClose()
    }
  }, [isMobile, isOpen, onClose])

  const handleToggle = useCallback(() => {
    if (isOpen) {
      onClose()
    } else {
      onOpen()
    }
  }, [isOpen, onClose, onOpen])

  // 选择 session 后在移动端关闭侧边栏
  const handleSelectSession = useCallback((session: ApiSession) => {
    onSelectSession(session)
    if (isMobile) {
      onClose()
    }
  }, [onSelectSession, isMobile, onClose])

  // ============================================
  // 移动端：Sidebar 完全不占位，作为 overlay 显示
  // 支持触摸滑动关闭
  // ============================================
  
  // 滑动关闭手势状态
  const touchStartX = useRef(0)
  const touchDeltaX = useRef(0)
  const [swipeX, setSwipeX] = useState(0)
  const isSwiping = useRef(false)

  const handleSidebarTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
    touchDeltaX.current = 0
    isSwiping.current = false
  }, [])

  const handleSidebarTouchMove = useCallback((e: React.TouchEvent) => {
    const deltaX = e.touches[0].clientX - touchStartX.current
    // 只有向左滑时才触发
    if (deltaX < -10) {
      isSwiping.current = true
      touchDeltaX.current = deltaX
      setSwipeX(deltaX)
    }
  }, [])

  const handleSidebarTouchEnd = useCallback(() => {
    if (isSwiping.current && touchDeltaX.current < -80) {
      // 滑动超过 80px，关闭侧边栏
      onClose()
    }
    isSwiping.current = false
    touchDeltaX.current = 0
    setSwipeX(0)
  }, [onClose])

  if (isMobile) {
    return (
      <>
        {/* Mobile Backdrop */}
        <div 
          className={`
            fixed inset-0 bg-black/40 z-30
            transition-opacity duration-300
            ${isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}
          `}
          onClick={handleBackdropClick}
        />

        {/* Mobile Sidebar Overlay */}
        <div 
          onTouchStart={handleSidebarTouchStart}
          onTouchMove={handleSidebarTouchMove}
          onTouchEnd={handleSidebarTouchEnd}
          className={`
            fixed inset-y-0 left-0 z-40 
            flex flex-col bg-bg-100 shadow-xl pt-[var(--safe-area-inset-top)]
            ${isSwiping.current ? '' : 'transition-transform duration-300 ease-out'}
            ${isOpen ? 'translate-x-0' : '-translate-x-full'}
          `}
          style={{ 
            width: `${DEFAULT_WIDTH}px`,
            transform: isOpen 
              ? `translateX(${Math.min(0, swipeX)}px)` 
              : `translateX(-100%)`,
          }}
        >
          {/* 和桌面端展开时一样的内容 */}
          <SidePanel
            onNewSession={onNewSession}
            onSelectSession={handleSelectSession}
            onCloseMobile={onClose}
            selectedSessionId={selectedSessionId}
            onAddProject={openProjectDialog}
            isMobile={true}
            isExpanded={true}  // 移动端展开时始终是 expanded 状态
            onToggleSidebar={onClose}  // 移动端 toggle 就是关闭
            contextLimit={contextLimit}
            onOpenSettings={onOpenSettings}
            themeMode={themeMode}
            onThemeChange={onThemeChange}
            isWideMode={isWideMode}
            onToggleWideMode={onToggleWideMode}
          />
        </div>

        {/* Project Dialog */}
        <ProjectDialog
          isOpen={isProjectDialogOpen}
          onClose={closeProjectDialog}
          onSelect={handleAddProject}
          initialPath={pathInfo?.home}
        />
      </>
    )
  }

  // ============================================
  // 桌面端：Sidebar 始终在原位置，可展开/收起为 rail
  // ============================================
  return (
    <>
      <div 
        ref={sidebarRef}
        style={{ width: isOpen ? `${width}px` : `${RAIL_WIDTH}px` }}
        className={`
          relative flex flex-col h-full bg-bg-100 overflow-hidden shrink-0 pt-[var(--safe-area-inset-top)]
          border-r border-border-200/50
          ${isResizing ? 'transition-none' : 'transition-[width] duration-300 ease-out'}
        `}
      >
        <SidePanel
          onNewSession={onNewSession}
          onSelectSession={onSelectSession}
          onCloseMobile={onClose}
          selectedSessionId={selectedSessionId}
          onAddProject={openProjectDialog}
          isMobile={false}
          isExpanded={isOpen}
          onToggleSidebar={handleToggle}
          contextLimit={contextLimit}
          onOpenSettings={onOpenSettings}
          themeMode={themeMode}
          onThemeChange={onThemeChange}
          isWideMode={isWideMode}
          onToggleWideMode={onToggleWideMode}
        />

        {/* Resizer Handle (Desktop only, when expanded) */}
        {isOpen && (
          <div
            className={`
              absolute top-0 right-0 w-1 h-full cursor-col-resize z-50
              hover:bg-accent-main-100/50 transition-colors
              ${isResizing ? 'bg-accent-main-100' : 'bg-transparent'}
            `}
            onMouseDown={startResizing}
          />
        )}
      </div>

      {/* Project Dialog */}
      <ProjectDialog
        isOpen={isProjectDialogOpen}
        onClose={closeProjectDialog}
        onSelect={handleAddProject}
        initialPath={pathInfo?.home}
      />
    </>
  )
})
