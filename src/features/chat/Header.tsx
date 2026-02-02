import { useState, useRef, useEffect, useMemo } from 'react'
import { CogIcon, MoreHorizontalIcon, TeachIcon, SidebarIcon, MaximizeIcon, MinimizeIcon, SunIcon, MoonIcon, SystemIcon, ShareIcon, PanelRightIcon, PanelBottomIcon, ChevronDownIcon } from '../../components/Icons'
import { DropdownMenu, MenuItem, IconButton } from '../../components/ui'
import { ModelSelector } from './ModelSelector'
import { SettingsDialog } from '../settings/SettingsDialog'
import { ShareDialog } from './ShareDialog'
import { useMessageStore } from '../../store'
import { useLayoutStore, layoutStore } from '../../store/layoutStore'
import { useSessionStats, formatTokens, formatCost } from '../../hooks'
import { useSessionContext } from '../../contexts/SessionContext'
import { updateSession } from '../../api'
import { uiErrorHandler } from '../../utils'
import type { ThemeMode, SessionStats } from '../../hooks'
import type { ModelInfo } from '../../api'

interface HeaderProps {
  models: ModelInfo[]
  modelsLoading: boolean
  selectedModelKey: string | null
  onModelChange: (modelKey: string, model: ModelInfo) => void
  onToggleSidebar: () => void
  themeMode: ThemeMode
  onThemeChange: (mode: ThemeMode, event?: React.MouseEvent) => void
  isWideMode?: boolean
  onToggleWideMode?: () => void
}

export function Header({
  models,
  modelsLoading,
  selectedModelKey,
  onModelChange,
  onToggleSidebar,
  themeMode,
  onThemeChange,
  isWideMode,
  onToggleWideMode,
}: HeaderProps) {
  const { shareUrl, messages, sessionId } = useMessageStore()
  const { rightPanelOpen, bottomPanelOpen } = useLayoutStore()
  const { sessions, refresh } = useSessionContext()
  
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false)
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false)
  const [shareDialogOpen, setShareDialogOpen] = useState(false)
  
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const titleInputRef = useRef<HTMLInputElement>(null)
  
  const settingsTriggerRef = useRef<HTMLButtonElement>(null)
  const settingsMenuRef = useRef<HTMLDivElement>(null)

  // Session Data
  const currentSession = useMemo(() => 
    sessions.find(s => s.id === sessionId), 
    [sessions, sessionId]
  )
  const sessionTitle = currentSession?.title || 'New Chat'

  const selectedModel = useMemo(() => {
    if (!selectedModelKey) return null
    return models.find(m => `${m.providerId}:${m.id}` === selectedModelKey) || null
  }, [models, selectedModelKey])

  const stats = useSessionStats(selectedModel?.contextLimit || 200000)
  const hasMessages = messages.length > 0

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

  // Close menu on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        settingsMenuRef.current &&
        !settingsMenuRef.current.contains(e.target as Node) &&
        !settingsTriggerRef.current?.contains(e.target as Node)
      ) {
        setSettingsMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div className="h-14 flex justify-between items-center px-4 z-20 bg-bg-100 transition-colors duration-200 relative">
      
      {/* Left: Sidebar, Model (z-20) */}
      <div className="flex items-center gap-2 min-w-0 shrink-1 z-20">
        <IconButton
          aria-label="Toggle sidebar"
          onClick={onToggleSidebar}
          className="md:hidden hover:bg-bg-200/50 text-text-400 hover:text-text-100"
        >
          <SidebarIcon size={18} />
        </IconButton>

        <div className="w-px h-4 bg-border-200/50 mx-1 shrink-0 md:hidden" />

        <ModelSelector
          models={models}
          selectedModelKey={selectedModelKey}
          onSelect={onModelChange}
          isLoading={modelsLoading}
        />
      </div>

      {/* Center: Session Title (Clean) (z-20) */}
      <div className="absolute left-1/2 -translate-x-1/2 hidden md:flex z-20">
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
              className="px-3 py-1.5 text-sm font-medium text-text-100 bg-transparent border-none outline-none w-[200px] lg:w-[300px] h-full text-center"
            />
          ) : (
            <button 
              onClick={handleStartEdit}
              className="px-3 py-1.5 text-sm font-medium text-text-200 hover:text-text-100 transition-colors truncate max-w-[300px] cursor-text select-none text-center"
              title="Click to rename"
            >
              {sessionTitle}
            </button>
          )}

          {!isEditingTitle && (
            <>
              <div className="w-[1.5px] h-3 bg-border-200/50 mx-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
              <button 
                className="p-1 text-text-400 hover:text-text-100 transition-colors rounded-md hover:bg-bg-300/50 opacity-0 group-hover:opacity-100 shrink-0"
                title="Share session"
                onClick={() => setShareDialogOpen(true)}
              >
                <ChevronDownIcon size={12} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Right: Stats, Settings, Panels (z-20) */}
      <div className="flex items-center gap-1 pointer-events-auto shrink-0 z-20">
        
        {/* Stats Badge (Pill) */}
        {hasMessages && (
          <div className="hidden lg:flex mr-2">
            <StatsBadge stats={stats} />
          </div>
        )}

        <div className="w-px h-4 bg-border-200/50 mx-1 hidden sm:block" />

        {/* Settings Button */}
        <div className="relative">
          <IconButton
            ref={settingsTriggerRef}
            aria-label="Menu"
            onClick={() => setSettingsMenuOpen(!settingsMenuOpen)}
            className="hover:bg-bg-200/50 text-text-400 hover:text-text-100"
          >
            <MoreHorizontalIcon size={18} />
          </IconButton>

          <DropdownMenu
            triggerRef={settingsTriggerRef}
            isOpen={settingsMenuOpen}
            position="bottom"
            align="right"
            width={200}
          >
            <div ref={settingsMenuRef} className="py-1">
              {/* Theme Selector */}
              <div className="px-2 pt-2 pb-1">
                <div className="text-[10px] font-bold text-text-400 uppercase tracking-wider px-2 mb-1.5">Appearance</div>
                <div className="flex bg-bg-100/50 p-1 rounded-lg border border-border-200/50 relative isolate">
                  <div
                    className="absolute top-1 bottom-1 left-1 w-[calc((100%-8px)/3)] bg-bg-000 rounded-md shadow-md ring-1 ring-border-200/50 transition-transform duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] -z-10"
                    style={{
                      transform: themeMode === 'system' ? 'translateX(0%)' : themeMode === 'light' ? 'translateX(100%)' : 'translateX(200%)'
                    }}
                  />
                  {(['system', 'light', 'dark'] as const).map((m) => (
                    <button
                      key={m}
                      onClick={(e) => onThemeChange(m, e)}
                      className={`flex-1 flex items-center justify-center py-1.5 rounded-md text-xs font-medium transition-colors duration-300 ${
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
              
              <div className="my-1 border-t border-border-200/50" />
              
              {onToggleWideMode && (
                <MenuItem
                  icon={isWideMode ? <MinimizeIcon size={16} /> : <MaximizeIcon size={16} />}
                  label={isWideMode ? "Standard Width" : "Wide Mode"}
                  onClick={() => { onToggleWideMode(); setSettingsMenuOpen(false); }}
                />
              )}

              <MenuItem
                icon={<ShareIcon />}
                label={shareUrl ? "Share Settings" : "Share Chat"}
                onClick={() => { setSettingsMenuOpen(false); setShareDialogOpen(true); }}
              />

              <MenuItem
                icon={<CogIcon />}
                label="Settings"
                onClick={() => { setSettingsMenuOpen(false); setSettingsDialogOpen(true); }}
              />
              <MenuItem
                icon={<TeachIcon />}
                label="Help & Feedback"
                onClick={() => { setSettingsMenuOpen(false); }}
              />
            </div>
          </DropdownMenu>
        </div>

        {/* Panel Toggles Group */}
        <div className="flex items-center gap-0.5 ml-1">
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

      <SettingsDialog
        isOpen={settingsDialogOpen}
        onClose={() => setSettingsDialogOpen(false)}
        themeMode={themeMode}
        onThemeChange={onThemeChange}
        isWideMode={isWideMode}
        onToggleWideMode={onToggleWideMode}
      />

      <ShareDialog isOpen={shareDialogOpen} onClose={() => setShareDialogOpen(false)} />

      {/* Smooth gradient - z-10 */}
      <div className="absolute top-full left-0 right-0 h-8 bg-gradient-to-b from-bg-100 to-transparent pointer-events-none z-10" />
    </div>
  )
}

// ============================================
// Stats Badge Component (Bordered Pill)
// ============================================

function StatsBadge({ stats }: { stats: SessionStats }) {
  const [showTooltip, setShowTooltip] = useState(false)
  
  const getColor = (percent: number) => {
    if (percent >= 90) return 'bg-danger-100'
    if (percent >= 70) return 'bg-warning-100'
    return 'bg-accent-main-100'
  }
  
  const color = getColor(stats.contextPercent)
  
  return (
    <div 
      className="relative flex items-center group/stats"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      onClick={(e) => e.stopPropagation()} 
    >
      <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-border-200/50 hover:bg-bg-200/50 transition-colors cursor-default">
        <div className={`w-1.5 h-1.5 rounded-full ${color} opacity-80`} />
        <span className="text-[10px] font-mono text-text-400 group-hover/stats:text-text-200 transition-colors">
          {Math.round(stats.contextPercent)}%
        </span>
      </div>

      {/* Detailed Tooltip - High Z-index */}
      {showTooltip && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-3 z-[100] cursor-default">
          <div className="bg-bg-100 border border-border-200 rounded-lg shadow-xl px-3 py-2 min-w-[180px]">
            <div className="text-[10px] font-bold text-text-400 uppercase tracking-wider mb-2">
              Session Stats
            </div>
            <div className="space-y-1.5 text-xs text-text-200">
              <div className="flex justify-between">
                <span className="text-text-400">Context</span>
                <span className="font-mono">{formatTokens(stats.contextUsed)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-400">Limit</span>
                <span className="font-mono">{formatTokens(stats.contextLimit)}</span>
              </div>
              <div className="w-full h-1 bg-bg-300 rounded-full overflow-hidden my-1">
                <div 
                  className={`h-full ${color}`} 
                  style={{ width: `${Math.min(100, stats.contextPercent)}%` }}
                />
              </div>
              <div className="border-t border-border-200/50 my-1.5" />
              <div className="flex justify-between">
                <span className="text-text-400">Cost</span>
                <span className="font-mono">{formatCost(stats.totalCost)}</span>
              </div>
            </div>
            <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-bg-100 border-l border-t border-border-200 rotate-45" />
          </div>
        </div>
      )}
    </div>
  )
}
