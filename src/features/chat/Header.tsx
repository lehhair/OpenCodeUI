import { useState, useRef, useEffect, useMemo } from 'react'
import { ComposeIcon, CogIcon, MoreHorizontalIcon, TeachIcon, SidebarIcon, MaximizeIcon, MinimizeIcon, SunIcon, MoonIcon, SystemIcon, ShareIcon, PanelRightIcon, PanelBottomIcon, ChevronDownIcon } from '../../components/Icons'
import { DropdownMenu, MenuItem, IconButton } from '../../components/ui'
import { ModelSelector } from './ModelSelector'
import { SettingsDialog } from '../settings/SettingsDialog'
import { ShareDialog } from './ShareDialog'
import { useMessageStore } from '../../store'
import { useLayoutStore, layoutStore } from '../../store/layoutStore'
import { useSessionStats, formatTokens, formatCost, useSessions } from '../../hooks'
import type { ThemeMode } from '../../hooks'
import type { ModelInfo } from '../../api'

interface HeaderProps {
  models: ModelInfo[]
  modelsLoading: boolean
  selectedModelKey: string | null  // providerId:modelId 格式
  onModelChange: (modelKey: string, model: ModelInfo) => void
  onNewChat: () => void
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
  onNewChat,
  onToggleSidebar,
  themeMode,
  onThemeChange,
  isWideMode,
  onToggleWideMode,
}: HeaderProps) {
  const { shareUrl, messages, sessionId } = useMessageStore()
  const { rightPanelOpen, bottomPanelOpen } = useLayoutStore()
  const { sessions } = useSessions()
  
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false)
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false)
  const [shareDialogOpen, setShareDialogOpen] = useState(false)
  
  const settingsTriggerRef = useRef<HTMLButtonElement>(null)
  const settingsMenuRef = useRef<HTMLDivElement>(null)

  // 获取当前 Session 标题
  const currentSession = useMemo(() => 
    sessions.find(s => s.id === sessionId), 
    [sessions, sessionId]
  )
  const sessionTitle = currentSession?.title || 'New Chat'

  // 获取当前选中的模型
  const selectedModel = useMemo(() => {
    if (!selectedModelKey) return null
    return models.find(m => `${m.providerId}:${m.id}` === selectedModelKey) || null
  }, [models, selectedModelKey])

  // 计算 session 统计
  const stats = useSessionStats(selectedModel?.contextLimit || 200000)
  
  // 是否有消息（用于控制显示）
  const hasMessages = messages.length > 0

  // Close settings menu when clicking outside
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
    <div className="h-14 flex justify-between items-center px-4 z-20 backdrop-blur-md bg-bg-100/80 transition-colors duration-200 relative">
      <div className="flex items-center gap-2 min-w-0 shrink-1">
        {/* Sidebar Toggle */}
        <IconButton
          aria-label="Toggle sidebar"
          onClick={onToggleSidebar}
          className="hover:bg-bg-200/50 text-text-400 hover:text-text-100"
        >
          <SidebarIcon size={18} />
        </IconButton>

        {/* New Chat */}
        <IconButton
          aria-label="New chat"
          onClick={onNewChat}
          className="hover:bg-bg-200/50 text-text-400 hover:text-text-100"
        >
          <ComposeIcon size={18} />
        </IconButton>

        <div className="w-px h-4 bg-border-200/50 mx-1 shrink-0" />

        {/* Session Title Split Button */}
        <div className="flex items-center group bg-transparent hover:bg-bg-200/50 rounded-lg transition-colors duration-300 ease-[cubic-bezier(0.165,0.85,0.45,1)] p-0.5 border border-transparent hover:border-border-200/50 min-w-0 shrink">
          <button 
            className="px-3 py-1.5 text-sm font-medium text-text-200 hover:text-text-100 transition-colors truncate max-w-[120px] sm:max-w-[200px] text-left cursor-default select-none"
            title={sessionTitle}
          >
            {sessionTitle}
          </button>
          <div className="w-[1.5px] h-3 bg-border-200/50 mx-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
          <button 
            className="p-1 text-text-400 hover:text-text-100 transition-colors rounded-md hover:bg-bg-300/50 opacity-0 group-hover:opacity-100 shrink-0"
            title="Session options"
          >
            <ChevronDownIcon size={12} />
          </button>
        </div>
      </div>

      {/* Center: Model Selector */}
      <div className="hidden md:flex absolute left-1/2 -translate-x-1/2">
        <ModelSelector
          models={models}
          selectedModelKey={selectedModelKey}
          onSelect={onModelChange}
          isLoading={modelsLoading}
        />
      </div>

      <div className="flex items-center gap-2 pointer-events-auto shrink-0">
        {/* Stats */}
        {hasMessages && (
          <div className="hidden lg:flex mr-2">
            <ContextIndicator stats={stats} />
          </div>
        )}

        {/* Wide Mode Toggle */}
        {onToggleWideMode && (
          <IconButton
            aria-label={isWideMode ? "Standard width" : "Wide mode"}
            onClick={onToggleWideMode}
            className="hover:bg-bg-200/50 text-text-400 hover:text-text-100"
          >
            {isWideMode ? <MinimizeIcon size={18} /> : <MaximizeIcon size={18} />}
          </IconButton>
        )}

        {/* Right Panel Toggle */}
        <IconButton
          aria-label={rightPanelOpen ? "Close panel" : "Open panel"}
          onClick={() => layoutStore.toggleRightPanel()}
          className={`
            transition-colors
            ${rightPanelOpen
              ? 'text-accent-main-100 bg-bg-200/50' 
              : 'text-text-400 hover:text-text-100 hover:bg-bg-200/50'
            }
          `}
        >
          <PanelRightIcon size={18} />
        </IconButton>

        {/* Bottom Panel Toggle */}
        <IconButton
          aria-label={bottomPanelOpen ? "Close bottom panel" : "Open bottom panel"}
          onClick={() => layoutStore.toggleBottomPanel()}
          className={`
            transition-colors
            ${bottomPanelOpen
              ? 'text-accent-main-100 bg-bg-200/50' 
              : 'text-text-400 hover:text-text-100 hover:bg-bg-200/50'
            }
          `}
        >
          <PanelBottomIcon size={18} />
        </IconButton>

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

          {/* Settings Menu */}
          <DropdownMenu
            triggerRef={settingsTriggerRef}
            isOpen={settingsMenuOpen}
            position="bottom"
            align="right"
            width={200}
          >
            <div ref={settingsMenuRef} className="py-1">
              <div className="px-2 pt-2 pb-1">
                <div className="text-[10px] font-bold text-text-400 uppercase tracking-wider px-2 mb-1.5">Appearance</div>
                <div className="flex bg-bg-100/50 p-1 rounded-lg border border-border-200/50 relative isolate">
                  {/* Sliding Background */}
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
                        themeMode === m
                          ? 'text-text-100'
                          : 'text-text-400 hover:text-text-200'
                      }`}
                      title={m.charAt(0).toUpperCase() + m.slice(1)}
                    >
                      {m === 'system' && <SystemIcon size={14} />}
                      {m === 'light' && <SunIcon size={14} />}
                      {m === 'dark' && <MoonIcon size={14} />}
                    </button>
                  ))}
                </div>
              </div>
              <div className="my-1 border-t border-border-200/50" />
              
              <MenuItem
                icon={<ShareIcon />}
                label={shareUrl ? "Share Settings" : "Share Chat"}
                onClick={() => {
                  setSettingsMenuOpen(false)
                  setShareDialogOpen(true)
                }}
              />

              <MenuItem
                icon={<CogIcon />}
                label="Settings"
                onClick={() => {
                  setSettingsMenuOpen(false)
                  setSettingsDialogOpen(true)
                }}
              />
              <MenuItem
                icon={<TeachIcon />}
                label="Help & Feedback"
                onClick={() => {
                  setSettingsMenuOpen(false)
                  // TODO: Open help
                }}
              />
            </div>
          </DropdownMenu>
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

      <ShareDialog 
        isOpen={shareDialogOpen} 
        onClose={() => setShareDialogOpen(false)} 
      />

      {/* Smooth gradient transition to content */}
      <div className="absolute top-full left-0 right-0 h-8 bg-gradient-to-b from-bg-100/80 to-transparent pointer-events-none z-10" />
    </div>
  )
}

// ============================================
// Context Indicator Component
// ============================================

import type { SessionStats } from '../../hooks'

interface ContextIndicatorProps {
  stats: SessionStats
}

function ContextIndicator({ stats }: ContextIndicatorProps) {
  const [showTooltip, setShowTooltip] = useState(false)
  
  // 根据使用率确定颜色
  const getProgressColor = (percent: number) => {
    if (percent >= 90) return 'bg-danger-100'
    if (percent >= 70) return 'bg-warning-100'
    return 'bg-accent-main-100'
  }
  
  const progressColor = getProgressColor(stats.contextPercent)
  
  return (
    <div 
      className="relative flex items-center gap-3 px-3 py-1.5 rounded-lg bg-bg-200/30 hover:bg-bg-200/50 transition-colors cursor-default"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {/* Context Progress */}
      <div className="flex items-center gap-2">
        <div className="w-20 h-1.5 bg-bg-300/50 rounded-full overflow-hidden">
          <div 
            className={`h-full rounded-full transition-all duration-300 ${progressColor}`}
            style={{ width: `${Math.max(1, stats.contextPercent)}%` }}
          />
        </div>
        <span className="text-[11px] font-mono text-text-400 tabular-nums">
          {formatTokens(stats.contextUsed)}
        </span>
      </div>
      
      {/* Cost */}
      {stats.totalCost > 0 && (
        <>
          <div className="w-px h-3 bg-border-200/50" />
          <span className="text-[11px] font-mono text-text-400 tabular-nums">
            {formatCost(stats.totalCost)}
          </span>
        </>
      )}
      
      {/* Tooltip */}
      {showTooltip && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 z-50">
          <div className="bg-bg-100 border border-border-200 rounded-lg shadow-lg px-3 py-2 min-w-[180px]">
            <div className="text-[10px] font-bold text-text-400 uppercase tracking-wider mb-2">
              Session Stats
            </div>
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-text-400">Context</span>
                <span className="font-mono text-text-200">
                  {formatTokens(stats.contextUsed)} / {formatTokens(stats.contextLimit)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-400">Input tokens</span>
                <span className="font-mono text-text-200">{formatTokens(stats.inputTokens)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-400">Output tokens</span>
                <span className="font-mono text-text-200">{formatTokens(stats.outputTokens)}</span>
              </div>
              {stats.reasoningTokens > 0 && (
                <div className="flex justify-between">
                  <span className="text-text-400">Reasoning</span>
                  <span className="font-mono text-text-200">{formatTokens(stats.reasoningTokens)}</span>
                </div>
              )}
              {stats.cacheRead > 0 && (
                <div className="flex justify-between">
                  <span className="text-text-400">Cache read</span>
                  <span className="font-mono text-success-100">{formatTokens(stats.cacheRead)}</span>
                </div>
              )}
              {stats.totalCost > 0 && (
                <>
                  <div className="border-t border-border-200/50 my-1.5" />
                  <div className="flex justify-between">
                    <span className="text-text-400">Total cost</span>
                    <span className="font-mono text-text-200">{formatCost(stats.totalCost)}</span>
                  </div>
                </>
              )}
            </div>
            {/* Arrow */}
            <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-bg-100 border-l border-t border-border-200 rotate-45" />
          </div>
        </div>
      )}
    </div>
  )
}
