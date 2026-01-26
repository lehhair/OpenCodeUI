import { useState, useCallback, useEffect } from 'react'
import { SidePanel } from './sidebar/SidePanel'
import { ProjectDialog } from './ProjectDialog'
import { useDirectory } from '../../hooks'
import { type ApiSession } from '../../api'

interface SidebarProps {
  isOpen: boolean
  selectedSessionId: string | null
  onSelectSession: (session: ApiSession) => void
  onNewSession: () => void
  onClose: () => void
}

export function Sidebar({
  isOpen,
  selectedSessionId,
  onSelectSession,
  onNewSession,
  onClose,
}: SidebarProps) {
  const [isProjectDialogOpen, setIsProjectDialogOpen] = useState(false)
  const { addDirectory, pathInfo } = useDirectory()
  const [isMobile, setIsMobile] = useState(false)

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

  // 移动端遮罩点击
  const handleBackdropClick = useCallback(() => {
    if (isMobile && isOpen) {
      onClose()
    }
  }, [isMobile, isOpen, onClose])

  return (
    <>
      {/* Mobile Backdrop */}
      {isMobile && isOpen && (
        <div 
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-30 transition-opacity animate-in fade-in duration-200"
          onClick={handleBackdropClick}
        />
      )}

      <div 
        className={`
          flex flex-col h-full bg-bg-50/50 backdrop-blur-xl
          transition-all duration-300 ease-[cubic-bezier(0.25,1,0.5,1)] overflow-hidden 
          ${isMobile 
            ? `fixed inset-y-0 left-0 z-40 shadow-2xl w-[280px] ${isOpen ? 'translate-x-0' : '-translate-x-full'}`
            : `relative ${isOpen ? 'w-[280px] translate-x-0 opacity-100' : 'w-0 -translate-x-full opacity-0 pointer-events-none'}`
          }
        `}
      >
        <div className="w-[280px] h-full flex flex-col">
          <SidePanel
            onNewSession={onNewSession}
            onSelectSession={onSelectSession}
            onCloseMobile={onClose}
            selectedSessionId={selectedSessionId}
            onAddProject={() => setIsProjectDialogOpen(true)}
          />
        </div>
      </div>

      {/* Dialog */}
      <ProjectDialog
        isOpen={isProjectDialogOpen}
        onClose={() => setIsProjectDialogOpen(false)}
        onSelect={handleAddProject}
        initialPath={pathInfo?.home}
      />
    </>
  )
}
