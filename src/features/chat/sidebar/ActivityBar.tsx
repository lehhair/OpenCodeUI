import { useState, useCallback, useRef, useEffect } from 'react'
import { useDirectory } from '../../../hooks'
import { getInitials } from '../../../utils'

interface ActivityBarProps {
  onAddClick: () => void
}

export function ActivityBar({ onAddClick }: ActivityBarProps) {
  const {
    currentDirectory,
    setCurrentDirectory,
    savedDirectories,
    removeDirectory,
  } = useDirectory()
  
  const [contextMenu, setContextMenu] = useState<{ path: string; x: number; y: number } | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)

  // 关闭右键菜单
  const closeContextMenu = useCallback(() => {
    setContextMenu(null)
  }, [])

  // 点击外部关闭右键菜单
  useEffect(() => {
    if (!contextMenu) return
    
    const handleClick = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        closeContextMenu()
      }
    }
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeContextMenu()
    }
    
    document.addEventListener('click', handleClick)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('click', handleClick)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [contextMenu, closeContextMenu])

  const handleContextMenu = useCallback((e: React.MouseEvent, path: string) => {
    e.preventDefault()
    setContextMenu({ path, x: e.clientX, y: e.clientY })
  }, [])

  const handleRemove = useCallback((path: string) => {
    removeDirectory(path)
    closeContextMenu()
  }, [removeDirectory, closeContextMenu])

  return (
    <div className="w-[60px] h-full flex flex-col items-center py-4 gap-3 select-none z-10">
      {/* Global Context */}
      <ContextItem
        active={currentDirectory === undefined}
        onClick={() => setCurrentDirectory(undefined)}
        label="G"
        name="Global"
        path="All projects"
        color="bg-accent-main-100"
      />

      <div className="w-6 border-t border-border-200/50 my-1" />

      {/* Saved Projects */}
      <div className="flex-1 w-full flex flex-col gap-3 items-center overflow-y-auto custom-scrollbar px-1">
        {savedDirectories.map((dir) => (
          <ContextItem
            key={dir.path}
            active={currentDirectory === dir.path}
            onClick={() => setCurrentDirectory(dir.path)}
            label={getInitials(dir.name)}
            name={dir.name}
            path={dir.path}
            onContextMenu={(e) => handleContextMenu(e, dir.path)}
          />
        ))}
        
        {/* Add Project Button */}
        <button
          onClick={onAddClick}
          className="w-10 h-10 flex items-center justify-center rounded-xl border border-dashed border-border-300 text-text-400 hover:text-accent-main-100 hover:border-accent-main-100 hover:bg-accent-main-100/10 transition-all duration-200 group relative"
          title="Add project folder"
        >
          <PlusIcon />
          <Tooltip text="Add Project" position="right" />
        </button>
      </div>
      
      {/* Context Menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed z-50 bg-bg-000 border border-border-200 rounded-lg shadow-lg py-1 min-w-[140px] animate-in fade-in zoom-in-95 duration-100"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={() => handleRemove(contextMenu.path)}
            className="w-full px-3 py-1.5 text-left text-sm text-danger-100 hover:bg-bg-200 flex items-center gap-2"
          >
            <TrashIcon />
            Remove Project
          </button>
        </div>
      )}
    </div>
  )
}

// ============================================
// Context Item with Tooltip
// ============================================

interface ContextItemProps {
  active: boolean
  onClick: () => void
  label: string
  name: string
  path: string
  onContextMenu?: (e: React.MouseEvent) => void
  color?: string
}

function ContextItem({
  active,
  onClick,
  label,
  name,
  path,
  onContextMenu,
  color = 'bg-bg-300'
}: ContextItemProps) {
  const [showTooltip, setShowTooltip] = useState(false)
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleMouseEnter = () => {
    hoverTimeoutRef.current = setTimeout(() => setShowTooltip(true), 400)
  }

  const handleMouseLeave = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current)
      hoverTimeoutRef.current = null
    }
    setShowTooltip(false)
  }

  return (
    <div 
      className="relative group w-full flex justify-center"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Active Indicator */}
      {active && (
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-3 bg-accent-main-100 rounded-r-full" />
      )}
      
      <button
        onClick={onClick}
        onContextMenu={onContextMenu}
        className={`
          w-10 h-10 flex items-center justify-center rounded-xl transition-all duration-300 text-sm font-bold shadow-sm
          ${active 
            ? `${color} text-white shadow-md scale-105` 
            : 'bg-bg-200/50 text-text-400 hover:bg-bg-300 hover:text-text-100 hover:scale-105'
          }
        `}
      >
        {label}
      </button>
      
      {/* Detailed Tooltip */}
      {showTooltip && (
        <div className="absolute left-full ml-3 top-1/2 -translate-y-1/2 z-50 pointer-events-none">
          <div className="bg-bg-000 border border-border-200 rounded-lg shadow-lg px-3 py-2 min-w-[160px] max-w-[280px] animate-in fade-in slide-in-from-left-1 duration-150">
            <div className="text-sm font-medium text-text-100 truncate">{name}</div>
            <div className="text-xs text-text-400 font-mono truncate mt-0.5">{path}</div>
            {onContextMenu && (
              <div className="text-[10px] text-text-500 mt-1.5 pt-1.5 border-t border-border-200/50">
                Right-click to remove
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================
// Simple Tooltip
// ============================================

function Tooltip({ text, position = 'right' }: { text: string; position?: 'right' | 'bottom' }) {
  const positionClasses = position === 'right' 
    ? 'left-full ml-3 top-1/2 -translate-y-1/2' 
    : 'top-full mt-2 left-1/2 -translate-x-1/2'

  return (
    <div className={`absolute ${positionClasses} z-50 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity`}>
      <div className="bg-bg-000 border border-border-200 rounded-md shadow-lg px-2 py-1 whitespace-nowrap">
        <span className="text-xs text-text-200">{text}</span>
      </div>
    </div>
  )
}

// ============================================
// Icons
// ============================================

function PlusIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
    </svg>
  )
}
