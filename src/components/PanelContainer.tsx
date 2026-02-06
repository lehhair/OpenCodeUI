// ============================================
// PanelContainer - 统一的面板容器组件
// 支持 tabs、右键菜单移动、拖拽排序
// ============================================

import { memo, useState, useCallback, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { 
  CloseIcon, 
  ChevronDownIcon,
  ChevronRightIcon,
  TerminalIcon,
  FolderIcon,
  GitCommitIcon,
  PlugIcon,
  TeachIcon,
  GitWorktreeIcon,
} from './Icons'
import { 
  layoutStore, 
  useLayoutStore, 
  type PanelTab, 
  type PanelPosition,
  type PanelTabType,
} from '../store/layoutStore'

// ============================================
// Types
// ============================================

interface PanelContainerProps {
  position: PanelPosition
  children: (activeTab: PanelTab | null) => React.ReactNode
  onNewTerminal?: () => void  // 仅 bottom 面板需要
  onCloseTerminal?: (ptyId: string) => void  // Terminal 关闭回调
}

// Tab 图标映射
const TAB_ICONS: Record<PanelTabType, React.ReactNode> = {
  terminal: <TerminalIcon size={12} />,
  files: <FolderIcon size={12} />,
  changes: <GitCommitIcon size={12} />,
  mcp: <PlugIcon size={12} />,
  skill: <TeachIcon size={12} />,
  worktree: <GitWorktreeIcon size={12} />,
}

// Tab 显示名称
function getTabLabel(tab: PanelTab): string {
  if (tab.type === 'terminal') {
    return tab.title ?? 'Terminal'
  }
  switch (tab.type) {
    case 'files': return 'Files'
    case 'changes': return 'Changes'
    case 'mcp': return 'MCP'
    case 'skill': return 'Skills'
    case 'worktree': return 'Worktrees'
    default: return 'Tab'
  }
}

// ============================================
// PanelContainer Component
// ============================================

export const PanelContainer = memo(function PanelContainer({
  position,
  children,
  onNewTerminal,
  onCloseTerminal,
}: PanelContainerProps) {
  const layout = useLayoutStore()
  
  const isOpen = position === 'bottom' ? layout.bottomPanelOpen : layout.rightPanelOpen
  const tabs = layout.panelTabs.filter(t => t.position === position)
  const activeTabId = layout.activeTabId[position]
  const activeTab = tabs.find(t => t.id === activeTabId) ?? tabs[0] ?? null
  
  // 拖拽排序状态
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  
  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; tabId: string } | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  
  // Tabs 容器 ref（用于水平滚动）
  const tabsContainerRef = useRef<HTMLDivElement>(null)
  
  // Add 菜单状态
  const [addMenuPos, setAddMenuPos] = useState<{ x: number; y: number; align: 'left' | 'right' } | null>(null)
  const addMenuRef = useRef<HTMLDivElement>(null)
  const addButtonRef = useRef<HTMLButtonElement>(null)
  
  // 处理横向滚动
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (tabsContainerRef.current) {
      tabsContainerRef.current.scrollLeft += e.deltaY
    }
  }, [])

  // 点击外部关闭 add 菜单
  useEffect(() => {
    if (!addMenuPos) return
    
    const handleClickOutside = (e: MouseEvent) => {
      if (
        addMenuRef.current && !addMenuRef.current.contains(e.target as Node) &&
        addButtonRef.current && !addButtonRef.current.contains(e.target as Node)
      ) {
        setAddMenuPos(null)
      }
    }
    
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [addMenuPos])

  // 点击外部关闭右键菜单
  useEffect(() => {
    if (!contextMenu) return
    
    const handleClickOutside = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null)
      }
    }
    
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [contextMenu])

  // 折叠面板
  const handleCollapse = useCallback(() => {
    if (position === 'bottom') {
      layoutStore.closeBottomPanel()
    } else {
      layoutStore.closeRightPanel()
    }
  }, [position])

  // 选择 tab
  const handleSelectTab = useCallback((tabId: string) => {
    layoutStore.setActiveTab(position, tabId)
  }, [position])

  // 关闭 tab
  const handleCloseTab = useCallback((tabId: string, tab: PanelTab, e: React.MouseEvent) => {
    e.stopPropagation()
    // Terminal 需要先清理 PTY session
    if (tab.type === 'terminal' && onCloseTerminal) {
      onCloseTerminal(tabId)
    }
    layoutStore.removeTab(tabId)
  }, [onCloseTerminal])

  // 右键菜单
  const handleContextMenu = useCallback((e: React.MouseEvent, tabId: string) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, tabId })
  }, [])

  // 移动到另一个面板
  const handleMoveToOtherPanel = useCallback(() => {
    if (!contextMenu) return
    const targetPosition: PanelPosition = position === 'bottom' ? 'right' : 'bottom'
    layoutStore.moveTab(contextMenu.tabId, targetPosition)
    setContextMenu(null)
  }, [contextMenu, position])

  // 拖拽处理
  const handleDragStart = useCallback((tabId: string) => {
    setDraggedId(tabId)
  }, [])

  const handleDragOver = useCallback((tabId: string) => {
    if (draggedId && draggedId !== tabId) {
      setDragOverId(tabId)
    }
  }, [draggedId])

  const handleDragEnd = useCallback(() => {
    if (draggedId && dragOverId) {
      layoutStore.reorderTabs(position, draggedId, dragOverId)
    }
    setDraggedId(null)
    setDragOverId(null)
  }, [draggedId, dragOverId, position])

  if (!isOpen) {
    return null
  }

  const otherPanelName = position === 'bottom' ? 'Right Panel' : 'Bottom Panel'

  return (
    <>
      {/* Header with Tabs */}
      <div className="flex items-center justify-between px-3 z-20 bg-bg-100 h-14 relative shrink-0">
        {/* Tabs Container - 水平滚动 */}
        <div 
          ref={tabsContainerRef} 
          onWheel={handleWheel}
          className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto scrollbar-none"
        >
          {tabs.map((tab) => (
            <PanelTabButton
              key={tab.id}
              tab={tab}
              isActive={tab.id === activeTabId}
              isDragging={draggedId === tab.id}
              isDragOver={dragOverId === tab.id}
              onClick={() => handleSelectTab(tab.id)}
              onClose={(e) => handleCloseTab(tab.id, tab, e)}
              onContextMenu={(e) => handleContextMenu(e, tab.id)}
              onDragStart={() => handleDragStart(tab.id)}
              onDragOver={() => handleDragOver(tab.id)}
              onDragEnd={handleDragEnd}
            />
          ))}
          
          {/* New Tab Button */}
          {onNewTerminal && (
            <button
              ref={addButtonRef}
              onClick={() => {
                if (addMenuPos) {
                  setAddMenuPos(null)
                } else if (addButtonRef.current) {
                  const rect = addButtonRef.current.getBoundingClientRect()
                  const viewportWidth = window.innerWidth
                  // 如果右侧空间不足（预留 160px），则靠右对齐
                  const align = (rect.left + 160 > viewportWidth) ? 'right' : 'left'
                  
                  setAddMenuPos({ 
                    x: align === 'left' ? rect.left : rect.right, 
                    y: rect.bottom + 4,
                    align
                  })
                }
              }}
              className={`
                p-2 ml-1 rounded-md transition-colors shrink-0
                ${addMenuPos 
                  ? 'bg-bg-200 text-text-100' 
                  : 'text-text-400 hover:text-text-100 hover:bg-bg-200/50'
                }
              `}
              title="Add Tab"
            >
              <span className="text-lg leading-none">+</span>
            </button>
          )}
        </div>
        
        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0 ml-2 border-l border-border-200/30 pl-2">
          <button
            onClick={handleCollapse}
            className="p-2 text-text-400 hover:text-text-100 hover:bg-bg-200/50 rounded-md transition-colors"
            title="Hide Panel"
          >
            {position === 'bottom' ? <ChevronDownIcon size={16} /> : <ChevronRightIcon size={16} />}
          </button>
        </div>

        {/* Smooth gradient transition to content - REMOVED */}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 relative overflow-hidden">
        {children(activeTab)}
      </div>

      {/* Context Menu - Portal */}
      {contextMenu && createPortal(
        <div
          ref={contextMenuRef}
          className="fixed z-[9999] bg-bg-100 border border-border-200 rounded-lg shadow-xl py-1 min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={handleMoveToOtherPanel}
            className="w-full px-3 py-1.5 text-left text-xs text-text-200 hover:bg-bg-200 hover:text-text-100 transition-colors"
          >
            Move to {otherPanelName}
          </button>
        </div>,
        document.body
      )}

      {/* Add Menu - Portal */}
      {addMenuPos && createPortal(
        <div
          ref={addMenuRef}
          className="fixed z-[9999] bg-bg-100 border border-border-200 rounded-lg shadow-xl py-1 min-w-[140px]"
          style={{ 
            top: addMenuPos.y,
            left: addMenuPos.align === 'left' ? addMenuPos.x : undefined,
            right: addMenuPos.align === 'right' ? (window.innerWidth - addMenuPos.x) : undefined,
          }}
        >
          <button
            onClick={() => {
              onNewTerminal?.()
              setAddMenuPos(null)
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-text-200 hover:bg-bg-200 hover:text-text-100 transition-colors"
          >
            <span className="opacity-60 shrink-0">
              <TerminalIcon size={12} />
            </span>
            Terminal
          </button>
          <button
            onClick={() => {
              layoutStore.addFilesTab(position)
              setAddMenuPos(null)
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-text-200 hover:bg-bg-200 hover:text-text-100 transition-colors"
          >
            <span className="opacity-60 shrink-0">
              <FolderIcon size={12} />
            </span>
            Files
          </button>
          <button
            onClick={() => {
              layoutStore.addChangesTab(position)
              setAddMenuPos(null)
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-text-200 hover:bg-bg-200 hover:text-text-100 transition-colors"
          >
            <span className="opacity-60 shrink-0">
              <GitCommitIcon size={12} />
            </span>
            Changes
          </button>
          <button
            onClick={() => {
              layoutStore.addMcpTab(position)
              setAddMenuPos(null)
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-text-200 hover:bg-bg-200 hover:text-text-100 transition-colors"
          >
            <span className="opacity-60 shrink-0">
              <PlugIcon size={12} />
            </span>
            MCP Servers
          </button>
          <button
            onClick={() => {
              layoutStore.addSkillTab(position)
              setAddMenuPos(null)
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-text-200 hover:bg-bg-200 hover:text-text-100 transition-colors"
          >
            <span className="opacity-60 shrink-0">
              <TeachIcon size={12} />
            </span>
            Skills
          </button>
          <button
            onClick={() => {
              layoutStore.addWorktreeTab(position)
              setAddMenuPos(null)
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-text-200 hover:bg-bg-200 hover:text-text-100 transition-colors"
          >
            <span className="opacity-60 shrink-0">
              <GitWorktreeIcon size={12} />
            </span>
            Worktrees
          </button>
        </div>,
        document.body
      )}
    </>
  )
})

// ============================================
// PanelTabButton Component
// ============================================

interface PanelTabButtonProps {
  tab: PanelTab
  isActive: boolean
  isDragging: boolean
  isDragOver: boolean
  onClick: () => void
  onClose?: (e: React.MouseEvent) => void
  onContextMenu: (e: React.MouseEvent) => void
  onDragStart: () => void
  onDragOver: () => void
  onDragEnd: () => void
}

const PanelTabButton = memo(function PanelTabButton({
  tab,
  isActive,
  isDragging,
  isDragOver,
  onClick,
  onClose,
  onContextMenu,
  onDragStart,
  onDragOver,
  onDragEnd,
}: PanelTabButtonProps) {
  // Terminal 状态颜色
  const statusColor = tab.type === 'terminal' && tab.status ? {
    connecting: 'bg-warning-100',
    connected: 'bg-success-100',
    disconnected: 'bg-text-500',
    exited: 'bg-danger-100',
  }[tab.status] : null

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', tab.id)
    onDragStart()
  }

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragOver={(e) => {
        e.preventDefault()
        onDragOver()
      }}
      onDragEnd={onDragEnd}
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={`
        group flex items-center gap-1.5 px-2 py-1 rounded-md text-xs shrink-0
        border border-transparent cursor-pointer select-none
        transition-all duration-150 ease-out
        ${isActive 
          ? 'bg-bg-000 text-text-100 shadow-sm border-border-200/50' 
          : 'text-text-300 hover:text-text-200 hover:bg-bg-200/50'
        }
        ${isDragging ? 'opacity-40 scale-95' : ''}
        ${isDragOver ? 'border-accent-main-100 bg-accent-main-100/10' : ''}
      `}
    >
      {/* Status indicator for terminals */}
      {statusColor && (
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusColor}`} />
      )}
      
      {/* Icon */}
      <span className="opacity-60 shrink-0">
        {TAB_ICONS[tab.type]}
      </span>
      
      {/* Label */}
      <span className="truncate max-w-[100px]">{getTabLabel(tab)}</span>
      
      {/* Close Button (only for closeable tabs like terminal) */}
      {onClose && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onClose(e)
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onDragStart={(e) => e.stopPropagation()}
          draggable={false}
          className={`
            p-1 -mr-0.5 rounded shrink-0
            transition-all duration-150 ease-out
            hover:bg-danger-100/20 text-text-400 hover:text-danger-100
            ${isActive ? '' : 'opacity-0 group-hover:opacity-100'}
          `}
          title="Close"
        >
          <CloseIcon size={12} />
        </button>
      )}
    </div>
  )
})
