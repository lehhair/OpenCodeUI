import { useState, useEffect, useCallback, useRef } from 'react'
import { Dialog } from '../../components/ui/Dialog'
import { Button } from '../../components/ui/Button'
import { 
  SunIcon, MoonIcon, SystemIcon, MaximizeIcon, MinimizeIcon, 
  PathAutoIcon, PathUnixIcon, PathWindowsIcon,
  GlobeIcon, PlusIcon, TrashIcon, CheckIcon, WifiIcon, WifiOffIcon, SpinnerIcon, KeyIcon,
  SettingsIcon, KeyboardIcon, CloseIcon, BellIcon, BoltIcon, CompactIcon, PlugIcon, StopIcon
} from '../../components/Icons'
import { usePathMode, useServerStore, useIsMobile, useNotification, useRouter } from '../../hooks'
import { autoApproveStore, messageStore, notificationStore } from '../../store'
import { serviceStore, useServiceStore } from '../../store/serviceStore'
import { themeStore } from '../../store/themeStore'
import { isTauri } from '../../utils/tauri'
import { KeybindingsSection } from './KeybindingsSection'
import type { ThemeMode } from '../../hooks'
import type { PathMode } from '../../utils/directoryUtils'
import type { ServerConfig, ServerHealth } from '../../store/serverStore'

// ============================================
// Types
// ============================================

type SettingsTab = 'appearance' | 'general' | 'servers' | 'keybindings'

interface SettingsDialogProps {
  isOpen: boolean
  onClose: () => void
  themeMode: ThemeMode
  onThemeChange: (mode: ThemeMode, event?: React.MouseEvent) => void
  isWideMode?: boolean
  onToggleWideMode?: () => void
  initialTab?: SettingsTab
  // Theme preset
  presetId?: string
  onPresetChange?: (presetId: string, event?: React.MouseEvent) => void
  availablePresets?: { id: string; name: string; description: string }[]
  // Custom CSS
  customCSS?: string
  onCustomCSSChange?: (css: string) => void
}

// ============================================
// Shared UI Components
// ============================================

function Toggle({ enabled, onChange }: { enabled: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={(e) => { e.stopPropagation(); onChange() }}
      className={`relative w-11 h-6 rounded-full transition-colors duration-200 
        ${enabled ? 'bg-accent-main-100' : 'bg-bg-300'}`}
    >
      <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform duration-200 
        ${enabled ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  )
}

interface SegmentedControlProps<T extends string> {
  value: T
  options: { value: T; label: string; icon?: React.ReactNode }[]
  onChange: (value: T, event?: React.MouseEvent) => void
}

function SegmentedControl<T extends string>({ value, options, onChange }: SegmentedControlProps<T>) {
  const activeIndex = options.findIndex(o => o.value === value)
  
  return (
    <div 
      className="bg-bg-100/50 p-0.5 rounded-lg flex border border-border-200/50 relative isolate"
      role="tablist"
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault()
          const dir = e.key === 'ArrowRight' ? 1 : -1
          const next = (activeIndex + dir + options.length) % options.length
          onChange(options[next].value)
        }
      }}
    >
      <div
        className="absolute top-0.5 bottom-0.5 left-0.5 bg-bg-000 rounded-md shadow-sm ring-1 ring-border-200/50 transition-transform duration-300 ease-out -z-10"
        style={{
          width: `calc((100% - 4px) / ${options.length})`,
          transform: `translateX(${activeIndex * 100}%)`
        }}
      />
      {options.map(opt => (
        <button
          key={opt.value}
          role="tab"
          aria-selected={opt.value === value}
          tabIndex={opt.value === value ? 0 : -1}
          onClick={(e) => onChange(opt.value, e)}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-[13px] font-medium transition-colors duration-200
            ${opt.value === value ? 'text-text-100' : 'text-text-400 hover:text-text-200'}`}
        >
          {opt.icon}
          <span className="truncate">{opt.label}</span>
        </button>
      ))}
    </div>
  )
}

interface SettingRowProps {
  label: string
  description?: string
  icon?: React.ReactNode
  children: React.ReactNode
  onClick?: () => void
}

function SettingRow({ label, description, icon, children, onClick }: SettingRowProps) {
  return (
    <div 
      className={`flex items-center justify-between py-3 px-3 -mx-3 rounded-lg transition-colors
        ${onClick ? 'cursor-pointer hover:bg-bg-100/50' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {icon && <span className="text-text-400 shrink-0">{icon}</span>}
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-text-100">{label}</div>
          {description && <div className="text-[11px] text-text-400 mt-0.5">{description}</div>}
        </div>
      </div>
      <div className="shrink-0 ml-3">{children}</div>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-medium text-text-400 uppercase tracking-wider mb-2 mt-1">{children}</div>
}

function Divider() {
  return <div className="border-t border-border-100/50 my-2" />
}

// ============================================
// Font Size Slider
// ============================================

function FontSizeSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const min = 12
  const max = 24
  const pct = ((value - min) / (max - min)) * 100
  
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <span className="text-[11px] text-text-400 shrink-0">A</span>
        <div className="relative flex-1 h-6 flex items-center">
          <input
            type="range"
            min={min}
            max={max}
            step={1}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            className="w-full h-1.5 rounded-full appearance-none cursor-pointer
              [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 
              [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent-main-100 
              [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white
              [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:relative [&::-webkit-slider-thumb]:z-10
              [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full 
              [&::-moz-range-thumb]:bg-accent-main-100 [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white
              [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:shadow-md"
            style={{
              background: `linear-gradient(to right, hsl(var(--accent-main-100)) 0%, hsl(var(--accent-main-100)) ${pct}%, hsl(var(--bg-300)) ${pct}%, hsl(var(--bg-300)) 100%)`
            }}
          />
        </div>
        <span className="text-[15px] text-text-400 shrink-0 font-semibold">A</span>
      </div>
      <div className="flex items-center justify-between px-1">
        <span className="text-[11px] text-text-400">{min}px</span>
        <span className="text-[12px] font-medium text-text-200 bg-bg-200/60 px-2 py-0.5 rounded">{value}px</span>
        <span className="text-[11px] text-text-400">{max}px</span>
      </div>
    </div>
  )
}

// ============================================
// Theme Preset Card
// ============================================

const PRESET_PREVIEW_COLORS: Record<string, { bg: string; accent: string; text: string }> = {
  eucalyptus: { bg: '#f0f3f0', accent: '#4d9e82', text: '#1e2e28' },
  claude: { bg: '#f3f0eb', accent: '#e87c2a', text: '#2d2a26' },
  breeze: { bg: '#f3f5f7', accent: '#2ba5a5', text: '#212d36' },
  custom: { bg: '#f0f0f0', accent: '#888888', text: '#333333' },
}

function PresetCard({ id, name, description, isActive, onClick }: {
  id: string; name: string; description: string; isActive: boolean
  onClick: (e: React.MouseEvent) => void
}) {
  const colors = PRESET_PREVIEW_COLORS[id] || PRESET_PREVIEW_COLORS.custom
  return (
    <button
      onClick={onClick}
      className={`flex items-start gap-3 p-3 rounded-lg border transition-all text-left w-full
        ${isActive
          ? 'border-accent-main-100/60 bg-accent-main-100/5 ring-1 ring-accent-main-100/20'
          : 'border-border-200/50 hover:border-border-300 hover:bg-bg-100/50'
        }`}
    >
      <div
        className="shrink-0 w-8 h-8 rounded-md border border-border-200/30 overflow-hidden relative mt-0.5"
        style={{ backgroundColor: colors.bg }}
      >
        <div className="absolute bottom-0 left-0 right-0 h-2" style={{ backgroundColor: colors.accent }} />
        <div className="absolute top-1.5 left-1.5 w-3 h-0.5 rounded-full" style={{ backgroundColor: colors.text, opacity: 0.6 }} />
        <div className="absolute top-3 left-1.5 w-2 h-0.5 rounded-full" style={{ backgroundColor: colors.text, opacity: 0.3 }} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] font-medium text-text-100">{name}</span>
          {isActive && <CheckIcon size={12} className="text-accent-main-100 shrink-0" />}
        </div>
        <div className="text-[11px] text-text-400 mt-0.5">{description}</div>
      </div>
    </button>
  )
}

// ============================================
// Custom CSS Editor
// ============================================

function CustomCSSEditor({ value, onChange }: { value: string; onChange: (css: string) => void }) {
  const [localValue, setLocalValue] = useState(value)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  
  useEffect(() => { setLocalValue(value) }, [value])
  
  const handleChange = (newVal: string) => {
    setLocalValue(newVal)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => onChange(newVal), 400)
  }
  
  const placeholder = `/* Override CSS variables to create your theme */
:root:root {
  /* Backgrounds */
  --bg-000: 220 20% 98%;
  --bg-100: 220 15% 95%;

  /* Text */
  --text-100: 220 15% 15%;

  /* Accent */
  --accent-main-100: 260 70% 55%;
}`

  return (
    <div className="space-y-2">
      <div className="text-[11px] text-text-400">
        Custom CSS applied globally. Use <code className="text-[10px] px-1 py-0.5 bg-bg-200 rounded font-mono">:root:root</code> to override theme variables.
      </div>
      <textarea
        value={localValue}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        className="w-full h-48 px-3 py-2 text-[12px] font-mono bg-bg-200/50 border border-border-200 rounded-lg 
          focus:outline-none focus:border-accent-main-100/50 text-text-100 placeholder:text-text-500 
          resize-y custom-scrollbar leading-relaxed"
      />
      {localValue.trim() && (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => { setLocalValue(''); onChange('') }}>
            Clear
          </Button>
        </div>
      )}
    </div>
  )
}

// ============================================
// Tab: Appearance
// ============================================

function AppearanceSettings({ themeMode, onThemeChange, isWideMode, onToggleWideMode, presetId, onPresetChange, availablePresets, customCSS, onCustomCSSChange }: {
  themeMode: ThemeMode
  onThemeChange: (mode: ThemeMode, event?: React.MouseEvent) => void
  isWideMode?: boolean
  onToggleWideMode?: () => void
  presetId?: string
  onPresetChange?: (presetId: string, event?: React.MouseEvent) => void
  availablePresets?: { id: string; name: string; description: string }[]
  customCSS?: string
  onCustomCSSChange?: (css: string) => void
}) {
  const [fontSize, setFontSize] = useState(themeStore.fontSize)

  return (
    <div>
      {/* Theme Preset */}
      {availablePresets && availablePresets.length > 0 && (
        <>
          <SectionLabel>Theme</SectionLabel>
          <div className="space-y-1.5 mb-3">
            {availablePresets.map(p => (
              <PresetCard
                key={p.id}
                id={p.id}
                name={p.name}
                description={p.description}
                isActive={presetId === p.id}
                onClick={(e) => onPresetChange?.(p.id, e)}
              />
            ))}
          </div>
          
          {presetId === 'custom' && onCustomCSSChange && (
            <CustomCSSEditor value={customCSS || ''} onChange={onCustomCSSChange} />
          )}
        </>
      )}

      {/* Color Mode */}
      <SectionLabel>Color Mode</SectionLabel>
      <SegmentedControl
        value={themeMode}
        options={[
          { value: 'system', label: 'Auto', icon: <SystemIcon size={14} /> },
          { value: 'light', label: 'Light', icon: <SunIcon size={14} /> },
          { value: 'dark', label: 'Dark', icon: <MoonIcon size={14} /> },
        ]}
        onChange={(v, e) => onThemeChange(v, e)}
      />
      
      <Divider />

      {/* Font Size */}
      <SectionLabel>Font Size</SectionLabel>
      <FontSizeSlider
        value={fontSize}
        onChange={(v) => { setFontSize(v); themeStore.setFontSize(v) }}
      />
      
      <Divider />

      {/* Layout */}
      <SectionLabel>Layout</SectionLabel>
      {onToggleWideMode && (
        <SettingRow 
          label="Wide Mode" 
          description="Expand chat to full width"
          icon={isWideMode ? <MinimizeIcon size={14} /> : <MaximizeIcon size={14} />}
          onClick={onToggleWideMode}
        >
          <Toggle enabled={!!isWideMode} onChange={onToggleWideMode} />
        </SettingRow>
      )}
    </div>
  )
}

// ============================================
// Tab: General
// ============================================

function GeneralSettings() {
  const { pathMode, setPathMode, effectiveStyle, detectedStyle, isAutoMode } = usePathMode()
  const [autoApprove, setAutoApprove] = useState(autoApproveStore.enabled)
  const { enabled: notificationsEnabled, setEnabled: setNotificationsEnabled, supported: notificationsSupported, permission: notificationPermission, sendNotification } = useNotification()
  const [collapseUserMessages, setCollapseUserMessages] = useState(themeStore.collapseUserMessages)
  const [toastEnabled, setToastEnabledState] = useState(notificationStore.toastEnabled)
  const isMobile = useIsMobile()
  const { autoStart: autoStartService, binaryPath, envVars, running: serviceRunning, startedByUs, starting: serviceStarting } = useServiceStore()
  const { activeServer } = useServerStore()
  const isTauriDesktop = isTauri() && !isMobile

  // 本地编辑状态（debounce 保存）
  const [localBinaryPath, setLocalBinaryPath] = useState(binaryPath)
  const pathDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 启动失败的错误信息
  const [serviceError, setServiceError] = useState('')

  // 同步外部变化
  useEffect(() => { setLocalBinaryPath(binaryPath) }, [binaryPath])

  // 打开设置页时自动检测一次服务状态
  useEffect(() => {
    if (!isTauriDesktop) return
    handleCheckService()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTauriDesktop])

  const handleAutoApprove = () => {
    const v = !autoApprove
    setAutoApprove(v)
    autoApproveStore.setEnabled(v)
    if (!v) autoApproveStore.clearAllRules()
  }

  const handleCollapseToggle = () => {
    const v = !collapseUserMessages
    setCollapseUserMessages(v)
    themeStore.setCollapseUserMessages(v)
  }

  const handleTestNotification = () => {
    sendNotification('OpenCode', 'This is a test notification')
  }

  const handleToastToggle = () => {
    const v = !toastEnabled
    setToastEnabledState(v)
    notificationStore.setToastEnabled(v)
  }

  const handleAutoStartToggle = () => {
    serviceStore.setAutoStart(!autoStartService)
  }

  const handleBinaryPathChange = (v: string) => {
    setLocalBinaryPath(v)
    if (pathDebounceRef.current) clearTimeout(pathDebounceRef.current)
    pathDebounceRef.current = setTimeout(() => serviceStore.setBinaryPath(v), 400)
  }

  const getServerUrl = () => activeServer?.url || 'http://127.0.0.1:4096'

  const handleStartService = async () => {
    setServiceError('')
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      serviceStore.setStarting(true)
      const weStarted = await invoke<boolean>('start_opencode_service', {
        url: getServerUrl(),
        binaryPath: serviceStore.effectiveBinaryPath,
        envVars: serviceStore.envVarsRecord,
      })
      serviceStore.setStartedByUs(weStarted)
      serviceStore.setRunning(true)
    } catch (e) {
      const msg = String(e)
      console.error('[Service] Start failed:', msg)
      setServiceError(msg)
    } finally {
      serviceStore.setStarting(false)
    }
  }

  const handleStopService = async () => {
    setServiceError('')
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('stop_opencode_service')
      serviceStore.setStartedByUs(false)
      serviceStore.setRunning(false)
    } catch (e) {
      console.error('[Service] Stop failed:', e)
    }
  }

  const handleCheckService = async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const running = await invoke<boolean>('check_opencode_service', { url: getServerUrl() })
      serviceStore.setRunning(running)
      if (running) {
        const byUs = await invoke<boolean>('get_service_started_by_us')
        serviceStore.setStartedByUs(byUs)
      } else {
        serviceStore.setStartedByUs(false)
      }
    } catch (e) {
      console.error('[Service] Check failed:', e)
    }
  }

  return (
    <div>
      {/* Path Style */}
      <SectionLabel>Path Style</SectionLabel>
      <SegmentedControl
        value={pathMode}
        options={[
          { value: 'auto', label: 'Auto', icon: <PathAutoIcon size={14} /> },
          { value: 'unix', label: 'Unix /', icon: <PathUnixIcon size={14} /> },
          { value: 'windows', label: 'Win \\', icon: <PathWindowsIcon size={14} /> },
        ]}
        onChange={(v) => setPathMode(v as PathMode)}
      />
      {isAutoMode && (
        <div className="text-[11px] text-text-400 mt-1.5 px-1">
          Using <span className="font-mono text-text-300">{effectiveStyle === 'windows' ? '\\' : '/'}</span>
          {detectedStyle && <>, detected <span className="font-mono text-text-300">{detectedStyle === 'windows' ? 'Windows' : 'Unix'}</span></>}
        </div>
      )}

      <Divider />
      
      {/* Behavior */}
      <SectionLabel>Behavior</SectionLabel>
      <SettingRow
        label="Auto-Approve"
        description="Use local rules for always, send once to server"
        icon={<BoltIcon size={14} />}
        onClick={handleAutoApprove}
      >
        <Toggle enabled={autoApprove} onChange={handleAutoApprove} />
      </SettingRow>
      {notificationsSupported && (
        <SettingRow
          label="Notifications"
          description={notificationPermission === 'denied' ? 'Blocked by browser' : 'Notify when AI completes a response'}
          icon={<BellIcon size={14} />}
          onClick={() => notificationPermission !== 'denied' && setNotificationsEnabled(!notificationsEnabled)}
        >
          <Toggle 
            enabled={notificationsEnabled && notificationPermission !== 'denied'} 
            onChange={() => notificationPermission !== 'denied' && setNotificationsEnabled(!notificationsEnabled)} 
          />
        </SettingRow>
      )}
      <SettingRow
        label="Toast Notifications"
        description="Show in-app toast popups for background session events"
        icon={<BellIcon size={14} />}
        onClick={handleToastToggle}
      >
        <Toggle enabled={toastEnabled} onChange={handleToastToggle} />
      </SettingRow>
      {notificationsSupported && (
        <SettingRow
          label="Test Notification"
          description={notificationsEnabled ? 'Send a sample notification' : 'Enable notifications to test'}
          icon={<BellIcon size={14} />}
        >
          <Button
            size="sm"
            variant="ghost"
            onClick={handleTestNotification}
            disabled={!notificationsEnabled || notificationPermission === 'denied'}
          >
            Send
          </Button>
        </SettingRow>
      )}
      <SettingRow
        label="Collapse Long Messages"
        description="Auto-collapse lengthy user messages"
        icon={<CompactIcon size={14} />}
        onClick={handleCollapseToggle}
      >
        <Toggle enabled={collapseUserMessages} onChange={handleCollapseToggle} />
      </SettingRow>

      {/* Service Management - Tauri desktop only */}
      {isTauriDesktop && (
        <>
          <Divider />
          <SectionLabel>Service</SectionLabel>

          {/* Binary path */}
          <div className="mb-3">
            <div className="text-[11px] font-medium text-text-300 mb-1">Binary Path</div>
            <input
              type="text"
              value={localBinaryPath}
              onChange={(e) => handleBinaryPathChange(e.target.value)}
              placeholder="opencode (default, uses PATH)"
              className="w-full h-8 px-3 text-[13px] font-mono bg-bg-200/50 border border-border-200 rounded-md 
                focus:outline-none focus:border-accent-main-100/50 text-text-100 placeholder:text-text-400"
            />
            <div className="text-[11px] text-text-400 mt-1">
              Leave empty to use <code className="text-[10px] px-1 py-0.5 bg-bg-200 rounded font-mono">opencode</code> from PATH. Or enter full path, e.g. <code className="text-[10px] px-1 py-0.5 bg-bg-200 rounded font-mono">/usr/local/bin/opencode</code>
            </div>
          </div>

          {/* Auto start toggle */}
          <SettingRow
            label="Auto-start Service"
            description="Run opencode serve automatically when app launches"
            icon={<PlugIcon size={14} />}
            onClick={handleAutoStartToggle}
          >
            <Toggle enabled={autoStartService} onChange={handleAutoStartToggle} />
          </SettingRow>

          {/* Status + controls */}
          <SettingRow
            label="Service Status"
            description={
              serviceStarting ? 'Starting opencode serve...' :
              serviceRunning
                ? startedByUs ? 'Running (started by app)' : 'Running (external)'
                : 'Not running'
            }
            icon={
              serviceStarting
                ? <SpinnerIcon size={14} className="animate-spin text-text-400" />
                : serviceRunning
                  ? <WifiIcon size={14} className="text-green-500" />
                  : <WifiOffIcon size={14} className="text-text-400" />
            }
          >
            <div className="flex items-center gap-2">
              {!serviceStarting && !serviceRunning && (
                <Button size="sm" variant="ghost" onClick={handleStartService}>
                  Start
                </Button>
              )}
              {!serviceStarting && serviceRunning && startedByUs && (
                <Button size="sm" variant="ghost" onClick={handleStopService}>
                  <StopIcon size={12} className="mr-1" />
                  Stop
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={handleCheckService} disabled={serviceStarting}>
                Refresh
              </Button>
            </div>
          </SettingRow>

          {/* Environment Variables */}
          <div className="mt-3">
            <div className="flex items-center justify-between mb-1">
              <div className="text-[11px] font-medium text-text-300">Environment Variables</div>
              <button
                className="text-[11px] text-accent-main-100 hover:text-accent-main-100/80 transition-colors"
                onClick={() => serviceStore.setEnvVars([...envVars, { key: '', value: '' }])}
              >
                + Add
              </button>
            </div>
            <div className="text-[11px] text-text-400 mb-2">
              Passed to the opencode serve process (e.g. HTTPS_PROXY, API keys)
            </div>
            {envVars.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {envVars.map((env, idx) => (
                  <div key={idx} className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={env.key}
                      onChange={(e) => {
                        const updated = [...envVars]
                        updated[idx] = { ...updated[idx], key: e.target.value }
                        serviceStore.setEnvVars(updated)
                      }}
                      placeholder="KEY"
                      className="w-[120px] shrink-0 h-7 px-2 text-[11px] font-mono bg-bg-200/50 border border-border-200 rounded 
                        focus:outline-none focus:border-accent-main-100/50 text-text-100 placeholder:text-text-500 uppercase"
                    />
                    <span className="text-text-500 text-[11px] shrink-0">=</span>
                    <input
                      type="text"
                      value={env.value}
                      onChange={(e) => {
                        const updated = [...envVars]
                        updated[idx] = { ...updated[idx], value: e.target.value }
                        serviceStore.setEnvVars(updated)
                      }}
                      placeholder="value"
                      className="flex-1 min-w-0 h-7 px-2 text-[11px] font-mono bg-bg-200/50 border border-border-200 rounded 
                        focus:outline-none focus:border-accent-main-100/50 text-text-100 placeholder:text-text-500"
                    />
                    <button
                      className="shrink-0 w-7 h-7 flex items-center justify-center text-text-400 hover:text-danger-100 
                        hover:bg-danger-100/10 rounded transition-colors"
                      onClick={() => {
                        const updated = envVars.filter((_, i) => i !== idx)
                        serviceStore.setEnvVars(updated)
                      }}
                      title="Remove"
                    >
                      <TrashIcon size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Error message */}
          {serviceError && (
            <div className="text-[11px] text-danger-100 bg-danger-100/10 border border-danger-100/20 rounded-md px-2.5 py-2 mt-1 leading-relaxed break-all">
              {serviceError}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ============================================
// Tab: Servers
// ============================================

function ServerItem({ server, health, isActive, onSelect, onDelete, onCheckHealth }: {
  server: ServerConfig
  health: ServerHealth | null
  isActive: boolean
  onSelect: () => void
  onDelete: () => void
  onCheckHealth: () => void
}) {
  const statusIcon = () => {
    if (!health || health.status === 'checking') return <SpinnerIcon size={12} className="animate-spin text-text-400" />
    if (health.status === 'online') return <WifiIcon size={12} className="text-green-500" />
    if (health.status === 'unauthorized') return <KeyIcon size={12} className="text-yellow-500" />
    return <WifiOffIcon size={12} className="text-red-400" />
  }
  
  const statusTitle = () => {
    if (!health) return 'Check health'
    switch (health.status) {
      case 'checking': return 'Checking...'
      case 'online': return `Online (${health.latency}ms)${health.version ? ` v${health.version}` : ''}`
      case 'unauthorized': return 'Invalid credentials'
      case 'offline': return health.error || 'Offline'
      case 'error': return health.error || 'Error'
      default: return 'Unknown'
    }
  }
  
  return (
    <div 
      className={`flex items-center gap-3 p-2.5 rounded-lg border transition-colors cursor-pointer group
        ${isActive 
          ? 'border-accent-main-100/40 bg-accent-main-100/5' 
          : 'border-border-200/40 hover:border-border-300'}`}
      onClick={onSelect}
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect() }}}
    >
      <GlobeIcon size={14} className={isActive ? 'text-accent-main-100' : 'text-text-400'} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] font-medium text-text-100 truncate">{server.name}</span>
          {isActive && <CheckIcon size={12} className="text-accent-main-100 shrink-0" />}
        </div>
        <div className="text-[11px] text-text-400 truncate font-mono flex items-center gap-1">
          {server.url}
          {server.auth?.password && <KeyIcon size={10} className="shrink-0 text-text-400" />}
        </div>
      </div>
      <button 
        className="p-2 rounded hover:bg-bg-200 transition-colors"
        onClick={(e) => { e.stopPropagation(); onCheckHealth() }}
        title={statusTitle()}
      >
        {statusIcon()}
      </button>
      {!server.isDefault && (
        <button 
          className="p-2 rounded text-text-400 hover:text-danger-100 hover:bg-danger-100/10 
                     md:opacity-0 md:group-hover:opacity-100 transition-all"
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          title="Remove"
        >
          <TrashIcon size={12} />
        </button>
      )}
    </div>
  )
}

function AddServerForm({ onAdd, onCancel }: { 
  onAdd: (name: string, url: string, username?: string, password?: string) => void
  onCancel: () => void 
}) {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showAuth, setShowAuth] = useState(false)
  const [error, setError] = useState('')
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) { setError('Name required'); return }
    if (!url.trim()) { setError('URL required'); return }
    try { new URL(url) } catch { setError('Invalid URL'); return }
    
    onAdd(
      name.trim(), 
      url.trim(), 
      password.trim() ? (username.trim() || 'opencode') : undefined,
      password.trim() || undefined
    )
  }

  const isCrossOrigin = (() => {
    if (!url.trim()) return false
    try {
      const serverUrl = new URL(url)
      return serverUrl.origin !== window.location.origin
    } catch { return false }
  })()

  const inputCls = "w-full h-8 px-3 text-[13px] bg-bg-000 border border-border-200 rounded-md focus:outline-none focus:border-accent-main-100/50 text-text-100 placeholder:text-text-400"
  
  return (
    <form onSubmit={handleSubmit} className="p-3 rounded-lg border border-border-200 bg-bg-050 space-y-2.5">
      <div>
        <label className="block text-[11px] font-medium text-text-300 mb-1">Name</label>
        <input type="text" value={name} onChange={e => { setName(e.target.value); setError('') }}
          placeholder="My Server" className={inputCls} autoFocus />
      </div>
      <div>
        <label className="block text-[11px] font-medium text-text-300 mb-1">URL</label>
        <input type="text" value={url} onChange={e => { setUrl(e.target.value); setError('') }}
          placeholder="http://192.168.1.100:4096" className={`${inputCls} font-mono`} />
      </div>
      
      <button type="button" onClick={() => setShowAuth(!showAuth)}
        className="flex items-center gap-1.5 text-[11px] text-accent-main-100 hover:text-accent-main-200 transition-colors">
        <KeyIcon size={10} />
        {showAuth ? 'Hide authentication' : 'Add authentication'}
      </button>
      
      {showAuth && (
        <>
          <div>
            <label className="block text-[11px] font-medium text-text-300 mb-1">Username</label>
            <input type="text" value={username} onChange={e => { setUsername(e.target.value); setError('') }}
              placeholder="opencode (default)" className={inputCls} />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-text-300 mb-1">Password</label>
            <input type="password" value={password} onChange={e => { setPassword(e.target.value); setError('') }}
              placeholder="OPENCODE_SERVER_PASSWORD" className={inputCls} />
          </div>
          
          {isCrossOrigin && password.trim() && (
            <div className="text-[11px] text-yellow-600 dark:text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 rounded-md px-2.5 py-2 leading-relaxed">
              Cross-origin + password may not work due to a backend CORS limitation 
              (<a href="https://github.com/anomalyco/opencode/issues/10047" target="_blank" rel="noopener" 
                className="underline hover:no-underline">#10047</a>). 
              Consider deploying the UI on the same origin or starting the server without a password.
            </div>
          )}
          
          <div className="text-[11px] text-text-400 leading-relaxed">
            Credentials are stored in localStorage. For same-origin setups, the browser can handle auth natively without entering credentials here.
          </div>
        </>
      )}
      
      {error && <p className="text-[11px] text-danger-100">{error}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button type="submit" size="sm">Add</Button>
      </div>
    </form>
  )
}

function ServersSettings() {
  const [addingServer, setAddingServer] = useState(false)
  const { servers, activeServer, addServer, removeServer, setActiveServer, checkHealth, checkAllHealth, getHealth } = useServerStore()
  const { navigateHome, sessionId: routeSessionId } = useRouter()
  
  useEffect(() => { checkAllHealth() }, [checkAllHealth])

  // 切换服务器：设置 active + 清理当前 session + 导航回首页
  const handleSelectServer = useCallback((id: string) => {
    if (activeServer?.id === id) return // 没变，不做事
    
    // 清理当前 session 的 store 状态
    if (routeSessionId) {
      messageStore.clearSession(routeSessionId)
    }
    
    setActiveServer(id) // 内部触发 serverChangeListeners → reconnectSSE()
    navigateHome()
  }, [activeServer?.id, routeSessionId, setActiveServer, navigateHome])

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <SectionLabel>Connections</SectionLabel>
        <div className="flex items-center gap-2">
          {!addingServer && (
            <button onClick={() => setAddingServer(true)}
              className="flex items-center gap-1 text-[11px] text-accent-main-100 hover:text-accent-main-200">
              <PlusIcon size={10} /> Add
            </button>
          )}
        </div>
      </div>
      <div className="space-y-1.5">
        {servers.map(s => (
          <ServerItem key={s.id} server={s} health={getHealth(s.id)} isActive={activeServer?.id === s.id}
            onSelect={() => handleSelectServer(s.id)} onDelete={() => removeServer(s.id)} onCheckHealth={() => checkHealth(s.id)} />
        ))}
        {addingServer && (
          <AddServerForm
            onAdd={(n, u, user, pass) => { 
              const auth = pass ? { username: user || 'opencode', password: pass } : undefined
              const s = addServer({ name: n, url: u, auth })
              setAddingServer(false)
              checkHealth(s.id)
            }}
            onCancel={() => setAddingServer(false)}
          />
        )}
      </div>
      {servers.length === 0 && !addingServer && (
        <div className="text-[13px] text-text-400 text-center py-8">
          No servers configured
        </div>
      )}
    </div>
  )
}

// ============================================
// Nav Tabs
// ============================================

const TABS: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
  { id: 'appearance', label: 'Appearance', icon: <SunIcon size={15} /> },
  { id: 'general', label: 'General', icon: <SettingsIcon size={15} /> },
  { id: 'servers', label: 'Servers', icon: <GlobeIcon size={15} /> },
  { id: 'keybindings', label: 'Shortcuts', icon: <KeyboardIcon size={15} /> },
]

// ============================================
// Tab Content Router
// ============================================

function TabContent({ tab, themeMode, onThemeChange, isWideMode, onToggleWideMode, presetId, onPresetChange, availablePresets, customCSS, onCustomCSSChange }: {
  tab: SettingsTab
  themeMode: ThemeMode
  onThemeChange: (mode: ThemeMode, event?: React.MouseEvent) => void
  isWideMode?: boolean
  onToggleWideMode?: () => void
  presetId?: string
  onPresetChange?: (presetId: string, event?: React.MouseEvent) => void
  availablePresets?: { id: string; name: string; description: string }[]
  customCSS?: string
  onCustomCSSChange?: (css: string) => void
}) {
  switch (tab) {
    case 'appearance':
      return (
        <AppearanceSettings
          themeMode={themeMode}
          onThemeChange={onThemeChange}
          isWideMode={isWideMode}
          onToggleWideMode={onToggleWideMode}
          presetId={presetId}
          onPresetChange={onPresetChange}
          availablePresets={availablePresets}
          customCSS={customCSS}
          onCustomCSSChange={onCustomCSSChange}
        />
      )
    case 'general':
      return <GeneralSettings />
    case 'servers':
      return <ServersSettings />
    case 'keybindings':
      return <KeybindingsSection />
    default:
      return null
  }
}

// ============================================
// Main Settings Dialog
// ============================================

export function SettingsDialog({
  isOpen, onClose, themeMode, onThemeChange, isWideMode, onToggleWideMode, initialTab = 'appearance',
  presetId, onPresetChange, availablePresets, customCSS, onCustomCSSChange,
}: SettingsDialogProps) {
  const [tab, setTab] = useState<SettingsTab>(initialTab)
  const isMobile = useIsMobile()
  
  useEffect(() => { if (isOpen) setTab(initialTab) }, [isOpen, initialTab])

  const handleTabKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const dir = e.key === 'ArrowDown' ? 1 : -1
      const ids = TABS.map(t => t.id)
      const next = (ids.indexOf(tab) + dir + ids.length) % ids.length
      setTab(ids[next])
    }
  }, [tab])

  const contentProps = {
    themeMode, onThemeChange, isWideMode, onToggleWideMode,
    presetId, onPresetChange, availablePresets, customCSS, onCustomCSSChange,
  }

  // 移动端：顶部 tab 切换 + 全屏内容
  if (isMobile) {
    return (
      <Dialog isOpen={isOpen} onClose={onClose} title="" width="100%" showCloseButton={false}>
        <div className="flex flex-col -m-5" style={{ height: '80vh' }}>
          {/* Top: Title + Close */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border-100/50 shrink-0">
            <div className="text-sm font-semibold text-text-100">Settings</div>
            <button
              onClick={onClose}
              className="p-2 text-text-400 hover:text-text-200 hover:bg-bg-100 rounded-md transition-colors -mr-1"
            >
              <CloseIcon size={18} />
            </button>
          </div>

          {/* Tab Bar - 横向滚动 */}
          <div className="flex items-center gap-1 px-3 py-2 border-b border-border-100/50 shrink-0 overflow-x-auto scrollbar-none">
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors whitespace-nowrap shrink-0
                  ${t.id === tab
                    ? 'bg-bg-100 text-text-100'
                    : 'text-text-400 active:bg-bg-100/50'}`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 min-h-0 py-4 px-4 overflow-y-auto custom-scrollbar">
            <TabContent tab={tab} {...contentProps} />
          </div>
        </div>
      </Dialog>
    )
  }

  // 桌面端：左侧导航 + 右侧内容
  return (
    <Dialog isOpen={isOpen} onClose={onClose} title="" width={680} showCloseButton={false}>
      <div className="flex h-[520px] -m-5">
        {/* Left Nav */}
        <nav className="w-[180px] shrink-0 border-r border-border-100/50 py-3 px-2 flex flex-col" onKeyDown={handleTabKeyDown}>
          <div className="text-sm font-semibold text-text-100 px-3 mb-4">Settings</div>
          <div className="space-y-0.5">
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                tabIndex={t.id === tab ? 0 : -1}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors
                  ${t.id === tab
                    ? 'bg-bg-100 text-text-100'
                    : 'text-text-400 hover:text-text-200 hover:bg-bg-100/50'}`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>
          
          <div className="mt-auto pt-3 px-3 text-[10px] text-text-400">v0.1.0</div>
        </nav>

        {/* Right Content */}
        <div className="flex-1 min-w-0 py-4 px-5 overflow-y-auto custom-scrollbar">
          <TabContent tab={tab} {...contentProps} />
        </div>
      </div>
    </Dialog>
  )
}
