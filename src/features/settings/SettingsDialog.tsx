import { useState, useEffect } from 'react'
import { Dialog } from '../../components/ui/Dialog'
import { Button } from '../../components/ui/Button'
import { 
  SunIcon, MoonIcon, SystemIcon, MaximizeIcon, MinimizeIcon, 
  PathAutoIcon, PathUnixIcon, PathWindowsIcon,
  GlobeIcon, PlusIcon, TrashIcon, CheckIcon, WifiIcon, WifiOffIcon, SpinnerIcon
} from '../../components/Icons'
import { usePathMode, useServerStore } from '../../hooks'
import { autoApproveStore } from '../../store'
import { KeybindingsSection } from './KeybindingsSection'
import type { ThemeMode } from '../../hooks'
import type { PathMode } from '../../utils/directoryUtils'
import type { ServerConfig, ServerHealth } from '../../store/serverStore'

// ============================================
// Settings Dialog Props
// ============================================

interface SettingsDialogProps {
  isOpen: boolean
  onClose: () => void
  themeMode: ThemeMode
  onThemeChange: (mode: ThemeMode, event?: React.MouseEvent) => void
  isWideMode?: boolean
  onToggleWideMode?: () => void
}

// ============================================
// Server Item Component
// ============================================

interface ServerItemProps {
  server: ServerConfig
  health: ServerHealth | null
  isActive: boolean
  onSelect: () => void
  onDelete: () => void
  onCheckHealth: () => void
}

function ServerItem({ server, health, isActive, onSelect, onDelete, onCheckHealth }: ServerItemProps) {
  const [showActions, setShowActions] = useState(false)
  
  const healthIcon = () => {
    if (!health || health.status === 'checking') {
      return <SpinnerIcon size={12} className="animate-spin text-text-400" />
    }
    if (health.status === 'online') {
      return <WifiIcon size={12} className="text-green-500" />
    }
    return <WifiOffIcon size={12} className="text-red-400" />
  }
  
  return (
    <div 
      className={`
        flex items-center gap-3 p-3 rounded-xl border transition-all cursor-pointer group
        ${isActive 
          ? 'border-accent-main-100 bg-accent-main-100/5' 
          : 'border-border-200/50 bg-bg-000 hover:border-border-300'
        }
      `}
      onClick={onSelect}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      <div className={`p-2 rounded-lg transition-colors ${isActive ? 'bg-accent-main-100/20 text-accent-main-100' : 'bg-bg-100 text-text-300'}`}>
        <GlobeIcon size={16} />
      </div>
      
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text-100 truncate">{server.name}</span>
          {isActive && <CheckIcon size={14} className="text-accent-main-100 shrink-0" />}
        </div>
        <div className="text-xs text-text-400 truncate font-mono">{server.url}</div>
      </div>
      
      <div className="flex items-center gap-2">
        {/* Health indicator */}
        <button 
          className="p-1.5 rounded-md hover:bg-bg-200 transition-colors"
          onClick={(e) => { e.stopPropagation(); onCheckHealth() }}
          title={health?.status === 'online' ? `Online (${health.latency}ms)` : health?.error || 'Check health'}
        >
          {healthIcon()}
        </button>
        
        {/* Actions (show on hover) */}
        {showActions && !server.isDefault && (
          <button 
            className="p-1.5 rounded-md hover:bg-danger-100/20 text-text-400 hover:text-danger-100 transition-colors"
            onClick={(e) => { e.stopPropagation(); onDelete() }}
            title="Remove server"
          >
            <TrashIcon size={14} />
          </button>
        )}
      </div>
    </div>
  )
}

// ============================================
// Add Server Form
// ============================================

interface AddServerFormProps {
  onAdd: (name: string, url: string) => void
  onCancel: () => void
}

function AddServerForm({ onAdd, onCancel }: AddServerFormProps) {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    
    // Validate
    if (!name.trim()) {
      setError('Name is required')
      return
    }
    if (!url.trim()) {
      setError('URL is required')
      return
    }
    
    // Basic URL validation
    try {
      new URL(url)
    } catch {
      setError('Invalid URL format')
      return
    }
    
    onAdd(name.trim(), url.trim())
  }
  
  return (
    <form onSubmit={handleSubmit} className="p-3 rounded-xl border border-border-200 bg-bg-050 space-y-3">
      <div>
        <label className="block text-xs font-medium text-text-300 mb-1">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => { setName(e.target.value); setError('') }}
          placeholder="My Server"
          className="w-full px-3 py-2 text-sm bg-bg-000 border border-border-200 rounded-lg focus:outline-none focus:border-accent-main-100 text-text-100 placeholder:text-text-400"
          autoFocus
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-text-300 mb-1">URL</label>
        <input
          type="text"
          value={url}
          onChange={(e) => { setUrl(e.target.value); setError('') }}
          placeholder="http://192.168.1.100:4096"
          className="w-full px-3 py-2 text-sm bg-bg-000 border border-border-200 rounded-lg focus:outline-none focus:border-accent-main-100 text-text-100 placeholder:text-text-400 font-mono"
        />
      </div>
      {error && <p className="text-xs text-danger-100">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm">
          Add Server
        </Button>
      </div>
    </form>
  )
}

// ============================================
// Main Settings Dialog
// ============================================

export function SettingsDialog({
  isOpen,
  onClose,
  themeMode,
  onThemeChange,
  isWideMode,
  onToggleWideMode,
}: SettingsDialogProps) {
  const { pathMode, setPathMode, effectiveStyle, detectedStyle, isAutoMode } = usePathMode()
  const [autoApproveEnabled, setAutoApproveEnabled] = useState(autoApproveStore.enabled)
  const [isAddingServer, setIsAddingServer] = useState(false)
  
  // Server store
  const { 
    servers, 
    activeServer, 
    addServer, 
    removeServer, 
    setActiveServer, 
    checkHealth, 
    checkAllHealth,
    getHealth 
  } = useServerStore()
  
  // Check health on mount
  useEffect(() => {
    if (isOpen) {
      checkAllHealth()
    }
  }, [isOpen, checkAllHealth])

  const handlePathModeChange = (mode: PathMode) => {
    setPathMode(mode)
  }

  const handleAutoApproveToggle = () => {
    const newValue = !autoApproveEnabled
    setAutoApproveEnabled(newValue)
    autoApproveStore.setEnabled(newValue)
    if (!newValue) {
      // 关闭时清空所有规则
      autoApproveStore.clearAllRules()
    }
  }
  
  const handleAddServer = (name: string, url: string) => {
    addServer({ name, url })
    setIsAddingServer(false)
  }
  
  const handleServerChange = (serverId: string) => {
    if (activeServer?.id !== serverId) {
      setActiveServer(serverId)
      // Notify user that they need to reload for the change to take effect
      // For now we just switch - SSE will reconnect automatically
    }
  }

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Settings"
      width={500}
    >
      <div className="space-y-6">
        {/* Appearance Section */}
        <div>
          <h3 className="text-xs font-semibold text-text-400 mb-3 uppercase tracking-wider">Appearance</h3>
          <div className="bg-bg-100/50 p-1 rounded-xl flex border border-border-200/50 relative isolate">
            {/* Sliding Background */}
            <div
              className="absolute top-1 bottom-1 left-1 w-[calc((100%-8px)/3)] bg-bg-000 rounded-lg shadow-md ring-1 ring-border-200/50 transition-transform duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] -z-10"
              style={{
                transform: themeMode === 'system' ? 'translateX(0%)' : themeMode === 'light' ? 'translateX(100%)' : 'translateX(200%)'
              }}
            />

            <button
              onClick={(e) => onThemeChange('system', e)}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-colors duration-300 ${
                themeMode === 'system'
                  ? 'text-text-100'
                  : 'text-text-400 hover:text-text-200'
              }`}
            >
              <SystemIcon />
              <span>Auto</span>
            </button>
            <button
              onClick={(e) => onThemeChange('light', e)}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-colors duration-300 ${
                themeMode === 'light'
                  ? 'text-text-100'
                  : 'text-text-400 hover:text-text-200'
              }`}
            >
              <SunIcon />
              <span>Light</span>
            </button>
            <button
              onClick={(e) => onThemeChange('dark', e)}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-colors duration-300 ${
                themeMode === 'dark'
                  ? 'text-text-100'
                  : 'text-text-400 hover:text-text-200'
              }`}
            >
              <MoonIcon />
              <span>Dark</span>
            </button>
          </div>
        </div>

        {/* Servers Section */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-text-400 uppercase tracking-wider">Servers</h3>
            {!isAddingServer && (
              <button
                onClick={() => setIsAddingServer(true)}
                className="flex items-center gap-1 text-xs text-accent-main-100 hover:text-accent-main-200 transition-colors"
              >
                <PlusIcon size={12} />
                <span>Add</span>
              </button>
            )}
          </div>
          
          <div className="space-y-2">
            {servers.map(server => (
              <ServerItem
                key={server.id}
                server={server}
                health={getHealth(server.id)}
                isActive={activeServer?.id === server.id}
                onSelect={() => handleServerChange(server.id)}
                onDelete={() => removeServer(server.id)}
                onCheckHealth={() => checkHealth(server.id)}
              />
            ))}
            
            {isAddingServer && (
              <AddServerForm
                onAdd={handleAddServer}
                onCancel={() => setIsAddingServer(false)}
              />
            )}
          </div>
          
          {activeServer && activeServer.id !== 'local' && (
            <p className="mt-2 text-xs text-text-400">
              Connected to: <span className="font-mono text-text-300">{activeServer.url}</span>
            </p>
          )}
        </div>

        {/* Path Mode Section */}
        <div>
          <h3 className="text-xs font-semibold text-text-400 mb-3 uppercase tracking-wider">Path Style</h3>
          <div className="bg-bg-100/50 p-1 rounded-xl flex border border-border-200/50 relative isolate">
            {/* Sliding Background */}
            <div
              className="absolute top-1 bottom-1 left-1 w-[calc((100%-8px)/3)] bg-bg-000 rounded-lg shadow-md ring-1 ring-border-200/50 transition-transform duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] -z-10"
              style={{
                transform: pathMode === 'auto' ? 'translateX(0%)' : pathMode === 'unix' ? 'translateX(100%)' : 'translateX(200%)'
              }}
            />

            <button
              onClick={() => handlePathModeChange('auto')}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-colors duration-300 ${
                pathMode === 'auto'
                  ? 'text-text-100'
                  : 'text-text-400 hover:text-text-200'
              }`}
            >
              <PathAutoIcon />
              <span>Auto</span>
            </button>
            <button
              onClick={() => handlePathModeChange('unix')}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-colors duration-300 ${
                pathMode === 'unix'
                  ? 'text-text-100'
                  : 'text-text-400 hover:text-text-200'
              }`}
            >
              <PathUnixIcon />
              <span>Unix /</span>
            </button>
            <button
              onClick={() => handlePathModeChange('windows')}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-colors duration-300 ${
                pathMode === 'windows'
                  ? 'text-text-100'
                  : 'text-text-400 hover:text-text-200'
              }`}
            >
              <PathWindowsIcon />
              <span>Win \</span>
            </button>
          </div>
          {/* Status indicator */}
          <div className="mt-2 px-1 flex items-center justify-between text-xs text-text-400">
            <span>
              Using: <span className="font-mono text-text-300">{effectiveStyle === 'windows' ? '\\' : '/'}</span>
            </span>
            {isAutoMode && (
              <span>
                Detected: <span className="font-mono text-text-300">{detectedStyle === 'windows' ? 'Windows' : 'Unix'}</span>
              </span>
            )}
          </div>
        </div>

        {/* Keybindings Section */}
        <KeybindingsSection />

        {/* Layout Section */}
        {onToggleWideMode && (
          <div>
            <h3 className="text-xs font-semibold text-text-400 mb-3 uppercase tracking-wider">Layout</h3>
            <div 
              className="flex items-center justify-between p-3 rounded-xl border border-border-200/50 bg-bg-000 hover:border-border-300 transition-all cursor-pointer group"
              onClick={onToggleWideMode}
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-bg-100 text-text-300 group-hover:text-text-100 transition-colors">
                   {isWideMode ? <MinimizeIcon /> : <MaximizeIcon />}
                </div>
                <div>
                  <div className="text-sm font-medium text-text-100">Wide Mode</div>
                  <div className="text-xs text-text-400">Expand chat to full width</div>
                </div>
              </div>
              <div className={`w-11 h-6 rounded-full p-1 transition-colors duration-200 ease-in-out ${isWideMode ? 'bg-accent-main-100' : 'bg-bg-200'}`}>
                <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform duration-200 ease-in-out ${isWideMode ? 'translate-x-5' : 'translate-x-0'}`} />
              </div>
            </div>
          </div>
        )}

        {/* Experimental Section */}
        <div>
          <h3 className="text-xs font-semibold text-text-400 mb-3 uppercase tracking-wider">Experimental</h3>
          <div 
            className="flex items-center justify-between p-3 rounded-xl border border-border-200/50 bg-bg-000 hover:border-border-300 transition-all cursor-pointer group"
            onClick={handleAutoApproveToggle}
          >
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-bg-100 text-text-300 group-hover:text-text-100 transition-colors">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  <path d="m9 12 2 2 4-4" />
                </svg>
              </div>
              <div>
                <div className="text-sm font-medium text-text-100">Auto-Approve</div>
                <div className="text-xs text-text-400">
                  "Always" uses local rules, sends "once" to server. Refresh to reset.
                </div>
              </div>
            </div>
            <div className={`w-11 h-6 rounded-full p-1 transition-colors duration-200 ease-in-out ${autoApproveEnabled ? 'bg-accent-main-100' : 'bg-bg-200'}`}>
              <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform duration-200 ease-in-out ${autoApproveEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
            </div>
          </div>
        </div>
        
        <div className="pt-6 border-t border-border-100/50 text-center">
           <p className="text-xs text-text-400">Claude Chat UI • v0.1.0</p>
        </div>
      </div>
    </Dialog>
  )
}
