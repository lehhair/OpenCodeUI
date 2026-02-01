import { memo, useState, useCallback, useRef } from 'react'
import { useLayoutStore, layoutStore, type RightPanelView } from '../store/layoutStore'
import { CloseIcon, GitCommitIcon, FolderIcon } from './Icons'
import { SessionChangesPanel } from './SessionChangesPanel'
import { FileExplorer } from './FileExplorer'
import { useMessageStore } from '../store'
import { useDirectory } from '../hooks'

const MIN_WIDTH = 300
const MAX_WIDTH = 800

export const RightPanel = memo(function RightPanel() {
  const { rightPanelOpen, rightPanelView, rightPanelWidth, previewFile } = useLayoutStore()
  const { sessionId } = useMessageStore()
  const { currentDirectory } = useDirectory()
  
  const [isResizing, setIsResizing] = useState(false)
  const resizingRef = useRef(false)

  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
    resizingRef.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    
    const startX = e.clientX
    const startWidth = rightPanelWidth
    
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = startX - moveEvent.clientX
      const newWidth = Math.min(Math.max(startWidth + deltaX, MIN_WIDTH), MAX_WIDTH)
      layoutStore.setRightPanelWidth(newWidth)
    }
    
    const handleMouseUp = () => {
      setIsResizing(false)
      resizingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
    
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [rightPanelWidth])

  return (
    <div 
      style={{ width: rightPanelOpen ? rightPanelWidth : 0 }}
      className={`
        relative h-full flex flex-col bg-bg-50/50 backdrop-blur-xl
        overflow-hidden
        ${isResizing ? 'transition-none' : 'transition-[width] duration-300 ease-[cubic-bezier(0.25,1,0.5,1)]'}
        ${rightPanelOpen ? 'border-l border-border-200/50' : ''}
      `}
    >
      {/* Content Container */}
      <div className="absolute top-0 right-0 bottom-0 flex flex-col" style={{ width: rightPanelWidth }}>
        
        {/* Resize Handle */}
        <div
          className={`
            absolute top-0 left-0 bottom-0 w-1 cursor-col-resize z-50
            hover:bg-accent-main-100/50 transition-colors
            ${isResizing ? 'bg-accent-main-100' : 'bg-transparent'}
          `}
          onMouseDown={startResizing}
        />

        {/* Header with View Tabs */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border-200/50 shrink-0 h-10">
          <div className="flex items-center gap-1">
            <ViewTab 
              id="changes" 
              active={rightPanelView === 'changes'} 
              icon={<GitCommitIcon size={14} />} 
              label="Changes" 
            />
            <ViewTab 
              id="files" 
              active={rightPanelView === 'files'} 
              icon={<FolderIcon size={14} />} 
              label="Files" 
            />
          </div>
          
          <button
            onClick={() => layoutStore.closeRightPanel()}
            className="p-1 text-text-400 hover:text-text-100 hover:bg-bg-200 rounded-md transition-colors"
          >
            <CloseIcon size={16} />
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-hidden relative">
          {/* Files View */}
          {rightPanelView === 'files' && (
            <FileExplorer 
              directory={currentDirectory}
              previewFile={previewFile}
            />
          )}
          
          {/* Changes View */}
          {rightPanelView === 'changes' && sessionId && (
            <SessionChangesPanel sessionId={sessionId} />
          )}
          
          {rightPanelView === 'changes' && !sessionId && (
            <div className="flex items-center justify-center h-full text-text-400 text-xs">
              No active session
            </div>
          )}
        </div>
      </div>
    </div>
  )
})

// ============================================
// View Tab Button
// ============================================

interface ViewTabProps {
  id: RightPanelView
  active: boolean
  icon: React.ReactNode
  label: string
}

function ViewTab({ id, active, icon, label }: ViewTabProps) {
  return (
    <button
      onClick={() => layoutStore.setRightPanelView(id)}
      className={`
        flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-medium transition-all
        border border-transparent
        ${active 
          ? 'bg-bg-000 text-text-100 shadow-sm border-border-200/50' 
          : 'text-text-400 hover:text-text-200 hover:bg-bg-200/50'
        }
      `}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}
