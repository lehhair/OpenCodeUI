import { useState, useRef, useEffect, useMemo } from 'react'
import { PanelRightIcon, PanelBottomIcon, ChevronDownIcon, SidebarIcon } from '../../components/Icons'
import { IconButton } from '../../components/ui'
import { ShareDialog } from './ShareDialog'
import { useMessageStore } from '../../store'
import { useLayoutStore, layoutStore } from '../../store/layoutStore'
import { useSessionContext } from '../../contexts/SessionContext'
import { updateSession } from '../../api'
import { uiErrorHandler } from '../../utils'

interface HeaderProps {
  onOpenSidebar?: () => void
}

export function Header({
  onOpenSidebar,
}: HeaderProps) {
  const { sessionId } = useMessageStore()
  const { rightPanelOpen, bottomPanelOpen } = useLayoutStore()
  const { sessions, refresh } = useSessionContext()
  
  const [shareDialogOpen, setShareDialogOpen] = useState(false)
  
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const titleInputRef = useRef<HTMLInputElement>(null)

  // Session Data
  const currentSession = useMemo(() => 
    sessions.find(s => s.id === sessionId), 
    [sessions, sessionId]
  )
  const sessionTitle = currentSession?.title || 'New Chat'

  // 同步 document.title - 有 session 标题时显示 "标题 - OpenCode"，否则只显示 "OpenCode"
  useEffect(() => {
    if (currentSession?.title) {
      document.title = `${currentSession.title} - OpenCode`
    } else {
      document.title = 'OpenCode'
    }
    return () => { document.title = 'OpenCode' }
  }, [currentSession?.title])

  // Editing Logic
  useEffect(() => {
    setIsEditingTitle(false)
  }, [sessionId])

  useEffect(() => {
    if (isEditingTitle && titleInputRef.current) {
      titleInputRef.current.focus()
      titleInputRef.current.select()
    }
  }, [isEditingTitle])

  const handleStartEdit = () => {
    if (!sessionId) return
    setEditTitle(sessionTitle)
    setIsEditingTitle(true)
  }

  const handleRename = async () => {
    if (!sessionId || !editTitle.trim() || editTitle === sessionTitle) {
      setIsEditingTitle(false)
      return
    }
    try {
      await updateSession(sessionId, { title: editTitle.trim() }, currentSession?.directory)
      refresh()
    } catch (e) {
      uiErrorHandler('rename session', e)
    } finally {
      setIsEditingTitle(false)
    }
  }

  return (
    <div className="h-12 md:h-14 flex justify-between items-center px-3 md:px-4 z-20 bg-bg-100 transition-colors duration-200 relative">
      
      {/* Left: Mobile Menu */}
      <div className="flex items-center gap-2 min-w-0 shrink-1 z-20">
        {/* Mobile Sidebar Toggle - 只在移动端显示 */}
        {onOpenSidebar && (
          <IconButton
            aria-label="Open sidebar"
            onClick={onOpenSidebar}
            className="md:hidden hover:bg-bg-200/50 text-text-400 hover:text-text-100 -ml-2"
          >
            <SidebarIcon size={18} />
          </IconButton>
        )}
      </div>

      {/* Center: Session Title (Clean) (z-20) */}
      <div className="absolute left-1/2 -translate-x-1/2 flex z-20 max-w-[calc(100%-116px)] md:max-w-none">
        <div className={`flex items-center group ${isEditingTitle ? 'bg-bg-200/50 ring-1 ring-accent-main-100' : 'bg-transparent hover:bg-bg-200/50 border border-transparent hover:border-border-200/50'} rounded-lg transition-all duration-200 p-0.5 min-w-0 shrink`}>
          
          {isEditingTitle ? (
            <input
              ref={titleInputRef}
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onBlur={handleRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRename()
                if (e.key === 'Escape') setIsEditingTitle(false)
              }}
              className="px-2 md:px-3 py-1.5 text-xs md:text-sm font-medium text-text-100 bg-transparent border-none outline-none w-[140px] md:w-[200px] lg:w-[300px] h-full text-center"
            />
          ) : (
            <button 
              onClick={handleStartEdit}
              className="px-2 md:px-3 py-1.5 text-xs md:text-sm font-medium text-text-200 hover:text-text-100 transition-colors truncate max-w-[180px] md:max-w-[300px] cursor-text select-none text-center"
              title="Click to rename"
            >
              {sessionTitle}
            </button>
          )}

          {!isEditingTitle && (
            <>
              <div className="hidden md:block w-[1.5px] h-3 bg-border-200/50 mx-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
              <button 
                className="hidden md:block p-1 text-text-400 hover:text-text-100 transition-colors rounded-md hover:bg-bg-300/50 opacity-0 group-hover:opacity-100 shrink-0"
                title="Share session"
                onClick={() => setShareDialogOpen(true)}
              >
                <ChevronDownIcon size={12} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Right: Panel Toggles (z-20) */}
      <div className="flex items-center gap-1 pointer-events-auto shrink-0 z-20">
        {/* Panel Toggles Group */}
        <div className="flex items-center gap-0.5">
          <IconButton
            aria-label={bottomPanelOpen ? "Close bottom panel" : "Open bottom panel"}
            onClick={() => layoutStore.toggleBottomPanel()}
            className={`transition-colors ${bottomPanelOpen ? 'text-accent-main-100 bg-bg-200/50' : 'text-text-400 hover:text-text-100 hover:bg-bg-200/50'}`}
          >
            <PanelBottomIcon size={18} />
          </IconButton>

          <IconButton
            aria-label={rightPanelOpen ? "Close panel" : "Open panel"}
            onClick={() => layoutStore.toggleRightPanel()}
            className={`transition-colors ${rightPanelOpen ? 'text-accent-main-100 bg-bg-200/50' : 'text-text-400 hover:text-text-100 hover:bg-bg-200/50'}`}
          >
            <PanelRightIcon size={18} />
          </IconButton>
        </div>
      </div>

      <ShareDialog isOpen={shareDialogOpen} onClose={() => setShareDialogOpen(false)} />

      {/* Smooth gradient - z-10 */}
      <div className="absolute top-full left-0 right-0 h-4 md:h-8 bg-gradient-to-b from-bg-100 to-transparent pointer-events-none z-10" />
    </div>
  )
}
