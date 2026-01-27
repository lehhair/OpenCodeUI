import { useState, useRef, useEffect } from 'react'
import { ComposeIcon, CogIcon, MoreHorizontalIcon, TeachIcon, SidebarIcon, MaximizeIcon, MinimizeIcon, SunIcon, MoonIcon, SystemIcon, ShareIcon } from '../../components/Icons'
import { DropdownMenu, MenuItem, IconButton } from '../../components/ui'
import { ModelSelector } from './ModelSelector'
import { SettingsDialog } from '../settings/SettingsDialog'
import { ShareDialog } from './ShareDialog'
import { useMessageStore } from '../../store'
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
  const { shareUrl } = useMessageStore()
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false)
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false)
  const [shareDialogOpen, setShareDialogOpen] = useState(false)
  const settingsTriggerRef = useRef<HTMLButtonElement>(null)
  const settingsMenuRef = useRef<HTMLDivElement>(null)

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
    <div className="h-14 flex justify-between items-center px-4 z-20 pointer-events-none">
      <div className="flex items-center gap-2 pointer-events-auto">
        {/* Sidebar Toggle */}
        <IconButton
          aria-label="Toggle sidebar"
          onClick={onToggleSidebar}
          className="hover:bg-bg-200/50 text-text-400 hover:text-text-100"
        >
          <SidebarIcon size={18} />
        </IconButton>

        {/* Model Selector */}
        <ModelSelector
          models={models}
          selectedModelKey={selectedModelKey}
          onSelect={onModelChange}
          isLoading={modelsLoading}
        />
      </div>

      <div className="flex items-center gap-2 pointer-events-auto">
        {/* Wide Mode Toggle */}
        {onToggleWideMode && (
          <IconButton
            aria-label={isWideMode ? "Standard width" : "Wide mode"}
            onClick={onToggleWideMode}
            className="hover:bg-bg-200/50 hidden sm:flex text-text-400 hover:text-text-100"
          >
            {isWideMode ? <MinimizeIcon size={18} /> : <MaximizeIcon size={18} />}
          </IconButton>
        )}

        {/* New Chat Button */}
        <IconButton
          aria-label="New chat"
          onClick={onNewChat}
          className="hover:bg-bg-200/50 text-text-400 hover:text-text-100"
        >
          <ComposeIcon size={18} />
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
    </div>
  )
}
