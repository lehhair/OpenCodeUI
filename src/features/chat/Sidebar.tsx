import { useState, useCallback, useEffect, useRef, memo } from 'react'
import { SidePanel } from './sidebar/SidePanel'
import { ProjectDialog } from './ProjectDialog'
import { useDirectory } from '../../hooks'
import { 
  CloseIcon, 
  SidebarIcon, 
  ComposeIcon,
  SearchIcon,
  CogIcon
} from '../../components/Icons'
import { type ApiSession } from '../../api'

const COLLAPSED_WIDTH = 60
const MIN_WIDTH = 240
const MAX_WIDTH = 480
const DEFAULT_WIDTH = 280

interface SidebarProps {
  isOpen: boolean // Desktop: Expanded / Mobile: Visible
  selectedSessionId: string | null
  onSelectSession: (session: ApiSession) => void
  onNewSession: () => void
  onClose: () => void // Mobile close / Desktop collapse
  onToggle: () => void
}

export const Sidebar = memo(function Sidebar({
  isOpen,
  selectedSessionId,
  onSelectSession,
  onNewSession,
  onClose,
  onToggle,
}: SidebarProps) {
  const [isProjectDialogOpen, setIsProjectDialogOpen] = useState(false)
  const { addDirectory, pathInfo } = useDirectory()
  const [isMobile, setIsMobile] = useState(false)
  
  // Width state
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
  }, [addDirectory])

  // 检测移动端
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  // Resize logic
  useEffect(() => {
    if (!isResizing) return

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
  }, [isResizing, width])

  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  // Mobile Backdrop Click
  const handleBackdropClick = useCallback(() => {
    if (isMobile && isOpen) {
      onClose()
    }
  }, [isMobile, isOpen, onClose])

  // Desktop: Determine effective width (Collapsed vs Expanded)
  const desktopWidth = isOpen ? width : COLLAPSED_WIDTH

  // Common Toggle Button
  const ToggleButton = () => (
    <button
      onClick={onToggle}
      className={`
        w-10 h-10 flex items-center justify-center rounded-lg transition-colors shrink-0
        text-text-400 hover:text-text-100 hover:bg-bg-200/50
        ${!isOpen && !isMobile ? 'mx-auto' : ''} 
      `}
      title={isOpen ? "Collapse" : "Expand"}
    >
      <SidebarIcon size={20} />
    </button>
  )

  // 渲染内容
  const renderContent = () => (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header Area (h-14 to match Main Header) */}
      <div className={`
        h-14 flex items-center px-3 shrink-0
        ${!isOpen && !isMobile ? 'justify-center' : 'justify-between'}
      `}>
        {/* Toggle Button (Left aligned or Centered) */}
        <div className="flex items-center gap-2 overflow-hidden">
          <ToggleButton />
          
          {(isOpen || isMobile) && (
            <span className="font-semibold text-text-100 truncate ml-1 opacity-100 transition-opacity duration-200 select-none">
              OpenCode
            </span>
          )}
        </div>

        {/* Mobile Close Button (Right) */}
        {isMobile && (
          <button
            onClick={onClose}
            className="p-2 -mr-2 text-text-400 hover:text-text-100"
          >
            <CloseIcon size={18} />
          </button>
        )}
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
        <SidePanel
          onNewSession={() => { onNewSession(); if(isMobile) onClose(); }}
          onSelectSession={(s) => { onSelectSession(s); if(isMobile) onClose(); }}
          selectedSessionId={selectedSessionId}
          onAddProject={() => setIsProjectDialogOpen(true)}
          isMobile={isMobile}
          isCollapsed={!isOpen && !isMobile}
        />
      </div>

      {/* Bottom User/Settings Area */}
      <div className={`
        p-3 mt-auto shrink-0 flex items-center gap-3
        ${!isOpen && !isMobile ? 'justify-center flex-col pb-6' : ''}
        border-t border-border-200/30
      `}>
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-accent-secondary-100 to-accent-main-100 shrink-0" />
        
        {(isOpen || isMobile) && (
          <div className="flex-1 min-w-0 flex items-center justify-between">
            <div className="text-sm font-medium text-text-200 truncate">User</div>
            <button className="text-text-400 hover:text-text-100 p-1.5 rounded-md hover:bg-bg-200/50">
              <CogIcon size={18} />
            </button>
          </div>
        )}
        
        {/* Collapsed mode settings icon */}
        {(!isOpen && !isMobile) && (
           <button className="text-text-400 hover:text-text-100 p-2 rounded-md hover:bg-bg-200/50">
              <CogIcon size={20} />
            </button>
        )}
      </div>
    </div>
  )

  // Mobile Layout
  if (isMobile) {
    return (
      <>
        {isOpen && (
          <div 
            className="fixed inset-0 bg-black/40 z-40 transition-opacity duration-300"
            onClick={handleBackdropClick}
          />
        )}
        <div 
          className={`
            fixed inset-y-0 left-0 z-50 w-[85%] max-w-[320px] bg-bg-100 shadow-2xl 
            transform transition-transform duration-300 ease-[cubic-bezier(0.25,1,0.5,1)]
            ${isOpen ? 'translate-x-0' : '-translate-x-full'}
          `}
        >
          {renderContent()}
        </div>

        <ProjectDialog
          isOpen={isProjectDialogOpen}
          onClose={() => setIsProjectDialogOpen(false)}
          onSelect={handleAddProject}
          initialPath={pathInfo?.home}
        />
      </>
    )
  }

  // Desktop Layout
  return (
    <>
      <div 
        ref={sidebarRef}
        style={{ width: desktopWidth }}
        className={`
          relative h-full bg-bg-100 z-30 shrink-0
          transition-[width] duration-300 ease-[cubic-bezier(0.25,1,0.5,1)]
          border-r border-border-200/50
        `}
      >
        {renderContent()}

        {/* Resizer - Only when open */}
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

      <ProjectDialog
        isOpen={isProjectDialogOpen}
        onClose={() => setIsProjectDialogOpen(false)}
        onSelect={handleAddProject}
        initialPath={pathInfo?.home}
      />
    </>
  )
})
