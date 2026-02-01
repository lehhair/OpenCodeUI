import { memo, useState, useCallback, useRef } from 'react'
import { useLayoutStore, layoutStore, type RightPanelTab } from '../store/layoutStore'
import { CloseIcon, GitCommitIcon, TerminalIcon, EyeIcon } from './Icons'
import { SessionChangesPanel } from './SessionChangesPanel'
import { useMessageStore } from '../store'

const MIN_WIDTH = 300
const MAX_WIDTH = 800

export const RightPanel = memo(function RightPanel() {
  const { rightPanelOpen, activeTab, rightPanelWidth } = useLayoutStore()
  const { sessionId } = useMessageStore()
  
  const [isResizing, setIsResizing] = useState(false)
  const resizingRef = useRef(false) // Ref to track resizing state without re-renders in effect

  // Better approach: store resizing logic in a separate effect that binds/unbinds listeners
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
        border-l border-border-200/50
        overflow-hidden
        ${isResizing ? 'transition-none' : 'transition-[width] duration-300 ease-[cubic-bezier(0.25,1,0.5,1)]'}
        ${!rightPanelOpen ? 'border-none' : ''}
      `}
    >
      {/* Content Container - Fixed width during transition to avoid content squashing */}
      <div className="absolute top-0 right-0 bottom-0 flex flex-col border-l border-border-100" style={{ width: rightPanelWidth }}>
        
        {/* Resize Handle */}
        <div
          className={`
            absolute top-0 left-0 bottom-0 w-1 cursor-col-resize z-50
            hover:bg-accent-main-100/50 transition-colors
            ${isResizing ? 'bg-accent-main-100' : 'bg-transparent'}
          `}
          onMouseDown={startResizing}
        />

        {/* Header / Tabs */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border-100 bg-bg-100/50 shrink-0 h-10">
          <div className="flex items-center gap-1">
            <TabButton 
              id="changes" 
              active={activeTab === 'changes'} 
              icon={<GitCommitIcon size={14} />} 
              label="Changes" 
            />
            <TabButton 
              id="terminal" 
              active={activeTab === 'terminal'} 
              icon={<TerminalIcon size={14} />} 
              label="Terminal" 
            />
            <TabButton 
              id="preview" 
              active={activeTab === 'preview'} 
              icon={<EyeIcon size={14} />} 
              label="Preview" 
            />
          </div>
          
          <button
            onClick={() => layoutStore.closeRightPanel()}
            className="p-1 text-text-400 hover:text-text-100 hover:bg-bg-200 rounded-md transition-colors"
          >
            <CloseIcon size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden relative bg-bg-000/50">
          {activeTab === 'changes' && sessionId && (
            <SessionChangesPanel sessionId={sessionId} />
          )}
          
          {activeTab === 'terminal' && (
            <div className="flex flex-col items-center justify-center h-full text-text-400 text-sm gap-2">
              <TerminalIcon size={32} className="opacity-20" />
              <span>Terminal coming soon</span>
            </div>
          )}
          
          {activeTab === 'preview' && (
            <div className="flex flex-col items-center justify-center h-full text-text-400 text-sm gap-2">
              <EyeIcon size={32} className="opacity-20" />
              <span>Preview coming soon</span>
            </div>
          )}
          
          {activeTab === 'changes' && !sessionId && (
            <div className="flex items-center justify-center h-full text-text-400 text-xs">
              No active session
            </div>
          )}
        </div>
      </div>
    </div>
  )
})

interface TabButtonProps {
  id: RightPanelTab
  active: boolean
  icon: React.ReactNode
  label: string
}

function TabButton({ id, active, icon, label }: TabButtonProps) {
  return (
    <button
      onClick={() => layoutStore.toggleRightPanel(id)}
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
