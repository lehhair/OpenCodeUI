import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Dialog } from '../../components/ui/Dialog'
import { Button } from '../../components/ui/Button'
import { 
  SunIcon, MoonIcon, SystemIcon, MaximizeIcon, MinimizeIcon, 
  PathAutoIcon, PathUnixIcon, PathWindowsIcon,
  GlobeIcon, PlusIcon, TrashIcon, CheckIcon, WifiIcon, WifiOffIcon, SpinnerIcon, KeyIcon,
  SettingsIcon, KeyboardIcon, CloseIcon, BellIcon, BoltIcon, CompactIcon, PlugIcon, StopIcon, EyeIcon, ThinkingIcon
} from '../../components/Icons'
import { usePathMode, useServerStore, useIsMobile, useNotification, useRouter } from '../../hooks'
import { autoApproveStore, messageStore, notificationStore } from '../../store'
import { serviceStore, useServiceStore } from '../../store/serviceStore'
import { themeStore, type ReasoningDisplayMode } from '../../store/themeStore'
import { isTauri } from '../../utils/tauri'
import { KeybindingsSection } from './KeybindingsSection'
import type { ThemeMode } from '../../hooks'
import type { PathMode } from '../../utils/directoryUtils'
import type { ServerConfig, ServerHealth } from '../../store/serverStore'

// ============================================
// Types
// ============================================

type SettingsTab = 'appearance' | 'chat' | 'notifications' | 'service' | 'servers' | 'keybindings'

interface SettingsDialogProps {
  isOpen: boolean
  onClose: () => void
  themeMode: ThemeMode
  onThemeChange: (mode: ThemeMode, event?: React.MouseEvent) => void
  isWideMode?: boolean
  onToggleWideMode?: () => void
  initialTab?: SettingsTab | 'general'
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
      <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-[hsl(var(--always-white))] rounded-full shadow-sm transition-transform duration-200 
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
  className?: string
}

function SettingRow({ label, description, icon, children, onClick, className }: SettingRowProps) {
  return (
    <div 
      className={`flex items-center justify-between py-2.5 px-2.5 rounded-lg border border-transparent transition-colors
        ${onClick ? 'cursor-pointer hover:bg-bg-100/55 hover:border-border-200/45' : ''}
        ${className || ''}`}
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

function SettingsCard({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string
  description?: string
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={`rounded-xl border border-border-200/55 bg-bg-050/55 p-3.5 ${className || ''}`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-text-100">{title}</div>
          {description && <div className="text-[11px] text-text-400 mt-0.5 leading-relaxed">{description}</div>}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
      {children}
    </section>
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
  
  const template = `/* ====== One Dark Inspired Theme Template ====== */
/* Palette inspired by Atom One Dark / One Dark Pro (MIT). */
/* Use HSL token values: H S% L% (without hsl()). */

/* Optional font imports (must stay at top if enabled) */
/* @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap'); */

/* ====== Fonts ====== */
:root:root {
  --font-ui-sans: 'Inter', 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  --font-mono: 'JetBrains Mono', 'Cascadia Code', 'SF Mono', Menlo, Consolas, monospace;
}

/* ====== Light (default + manual light) ====== */
:root:root,
:root:root[data-mode='light'] {
  /* Background */
  --bg-000: 220 30% 99%;
  --bg-100: 220 25% 96%;
  --bg-200: 220 20% 92%;
  --bg-300: 220 16% 88%;
  --bg-400: 220 14% 82%;

  /* Text */
  --text-000: 0 0% 100%;
  --text-100: 220 16% 17%;
  --text-200: 220 12% 35%;
  --text-300: 220 10% 50%;
  --text-400: 220 8% 62%;
  --text-500: 220 7% 72%;
  --text-600: 220 10% 84%;

  /* Accent */
  --accent-brand: 286 50% 52%;
  --accent-main-000: 207 70% 46%;
  --accent-main-100: 207 78% 54%;
  --accent-main-200: 207 86% 62%;
  --accent-secondary-100: 187 50% 43%;

  /* Semantic */
  --success-100: 95 36% 42%;
  --success-200: 95 30% 34%;
  --success-bg: 95 45% 93%;
  --warning-100: 37 84% 46%;
  --warning-200: 37 76% 39%;
  --warning-bg: 37 90% 92%;
  --danger-000: 355 58% 42%;
  --danger-100: 355 68% 54%;
  --danger-200: 355 74% 63%;
  --danger-bg: 355 80% 94%;
  --danger-900: 355 54% 91%;
  --info-100: 221 74% 50%;
  --info-200: 221 78% 60%;
  --info-bg: 221 85% 94%;

  /* Border */
  --border-100: 220 16% 84%;
  --border-200: 220 13% 79%;
  --border-300: 220 12% 70%;

  /* Special */
  --always-black: 0 0% 0%;
  --always-white: 0 0% 100%;
  --oncolor-100: 0 0% 100%;
}

/* ====== Dark (manual dark) ====== */
:root:root[data-mode='dark'] {
  /* Background */
  --bg-000: 220 13% 21%;
  --bg-100: 220 14% 18%;
  --bg-200: 220 15% 15%;
  --bg-300: 220 16% 12%;
  --bg-400: 220 18% 9%;

  /* Text */
  --text-000: 0 0% 100%;
  --text-100: 220 14% 90%;
  --text-200: 220 12% 72%;
  --text-300: 220 10% 58%;
  --text-400: 220 9% 46%;
  --text-500: 220 8% 36%;
  --text-600: 220 10% 26%;

  /* Accent */
  --accent-brand: 286 56% 67%;
  --accent-main-000: 207 70% 58%;
  --accent-main-100: 207 82% 66%;
  --accent-main-200: 207 90% 74%;
  --accent-secondary-100: 187 47% 55%;

  /* Semantic */
  --success-100: 95 38% 62%;
  --success-200: 95 33% 52%;
  --success-bg: 95 25% 18%;
  --warning-100: 37 87% 63%;
  --warning-200: 37 76% 54%;
  --warning-bg: 37 30% 18%;
  --danger-000: 355 63% 60%;
  --danger-100: 355 74% 66%;
  --danger-200: 355 80% 74%;
  --danger-bg: 355 28% 18%;
  --danger-900: 355 24% 26%;
  --info-100: 221 83% 65%;
  --info-200: 221 88% 74%;
  --info-bg: 221 30% 18%;

  /* Border */
  --border-100: 220 12% 28%;
  --border-200: 220 12% 34%;
  --border-300: 220 12% 42%;

  /* Special */
  --always-black: 0 0% 0%;
  --always-white: 0 0% 100%;
  --oncolor-100: 0 0% 100%;
}

/* ====== Auto (system dark when data-mode is not set) ====== */
@media (prefers-color-scheme: dark) {
  :root:root:not([data-mode]) {
    --bg-000: 220 13% 21%;
    --bg-100: 220 14% 18%;
    --bg-200: 220 15% 15%;
    --bg-300: 220 16% 12%;
    --bg-400: 220 18% 9%;

    --text-000: 0 0% 100%;
    --text-100: 220 14% 90%;
    --text-200: 220 12% 72%;
    --text-300: 220 10% 58%;
    --text-400: 220 9% 46%;
    --text-500: 220 8% 36%;
    --text-600: 220 10% 26%;

    --accent-brand: 286 56% 67%;
    --accent-main-000: 207 70% 58%;
    --accent-main-100: 207 82% 66%;
    --accent-main-200: 207 90% 74%;
    --accent-secondary-100: 187 47% 55%;

    --success-100: 95 38% 62%;
    --success-200: 95 33% 52%;
    --success-bg: 95 25% 18%;
    --warning-100: 37 87% 63%;
    --warning-200: 37 76% 54%;
    --warning-bg: 37 30% 18%;
    --danger-000: 355 63% 60%;
    --danger-100: 355 74% 66%;
    --danger-200: 355 80% 74%;
    --danger-bg: 355 28% 18%;
    --danger-900: 355 24% 26%;
    --info-100: 221 83% 65%;
    --info-200: 221 88% 74%;
    --info-bg: 221 30% 18%;

    --border-100: 220 12% 28%;
    --border-200: 220 12% 34%;
    --border-300: 220 12% 42%;

    --always-black: 0 0% 0%;
    --always-white: 0 0% 100%;
    --oncolor-100: 0 0% 100%;
  }
}`

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[11px] text-text-400">
          Override fonts, colors, and styles. Use <code className="text-[10px] px-1 py-0.5 bg-bg-200 rounded font-mono">:root:root</code> for higher specificity.
        </div>
        {!localValue.trim() && (
          <button
            onClick={() => handleChange(template)}
            className="text-[10px] text-accent-main-100 hover:text-accent-main-200 transition-colors px-1.5 py-0.5 rounded hover:bg-bg-200/50 shrink-0"
          >
            Load Template
          </button>
        )}
      </div>
      <textarea
        value={localValue}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={template}
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

  return (
    <div className="space-y-4">
      {availablePresets && availablePresets.length > 0 && (
        <SettingsCard
          title="Theme Presets"
          description="Choose a base visual style for the app"
        >
          <div className="grid gap-2 sm:grid-cols-2">
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
        </SettingsCard>
      )}

      {onCustomCSSChange && (
        <SettingsCard
          title="Custom CSS"
          description="Override fonts, colors, and any CSS variables. Works with all themes."
        >
          <CustomCSSEditor value={customCSS || ''} onChange={onCustomCSSChange} />
        </SettingsCard>
      )}

      <SettingsCard
        title="Display"
        description="Control color mode and layout"
      >
        <div className="space-y-4">
          <div>
            <div className="text-[11px] font-medium text-text-400 uppercase tracking-wider mb-1.5">Color Mode</div>
            <SegmentedControl
              value={themeMode}
              options={[
                { value: 'system', label: 'Auto', icon: <SystemIcon size={14} /> },
                { value: 'light', label: 'Light', icon: <SunIcon size={14} /> },
                { value: 'dark', label: 'Dark', icon: <MoonIcon size={14} /> },
              ]}
              onChange={(v, e) => onThemeChange(v, e)}
            />
          </div>

          {onToggleWideMode && (
            <div className="pt-3 border-t border-border-100/55">
              <SettingRow 
                label="Wide Mode" 
                description="Expand chat area for long outputs"
                icon={isWideMode ? <MinimizeIcon size={14} /> : <MaximizeIcon size={14} />}
                onClick={onToggleWideMode}
              >
                <Toggle enabled={!!isWideMode} onChange={onToggleWideMode} />
              </SettingRow>
            </div>
           )}
        </div>
      </SettingsCard>
    </div>
  )
}

// ============================================
// Tab: General
// ============================================

function GeneralSettings({ mode }: { mode: 'chat' | 'notifications' | 'service' }) {
  const { pathMode, setPathMode, effectiveStyle, detectedStyle, isAutoMode } = usePathMode()
  const [autoApprove, setAutoApprove] = useState(autoApproveStore.enabled)
  const { enabled: notificationsEnabled, setEnabled: setNotificationsEnabled, supported: notificationsSupported, permission: notificationPermission, sendNotification } = useNotification()
  const [collapseUserMessages, setCollapseUserMessages] = useState(themeStore.collapseUserMessages)
  const [stepFinishDisplay, setStepFinishDisplay] = useState(themeStore.stepFinishDisplay)
  const [reasoningDisplayMode, setReasoningDisplayMode] = useState(themeStore.reasoningDisplayMode)
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

  const handleReasoningDisplayModeChange = (mode: ReasoningDisplayMode) => {
    setReasoningDisplayMode(mode)
    themeStore.setReasoningDisplayMode(mode)
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
    <div className="space-y-4">
      {mode === 'chat' && (
        <>
          <div className="grid gap-4 xl:grid-cols-2">
            <SettingsCard
              title="Paths & Formatting"
              description="How file paths are displayed in messages and tools"
            >
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
                <div className="text-[11px] text-text-400 mt-2 px-1">
                  Using <span className="font-mono text-text-300">{effectiveStyle === 'windows' ? '\\' : '/'}</span>
                  {detectedStyle && <>, detected <span className="font-mono text-text-300">{detectedStyle === 'windows' ? 'Windows' : 'Unix'}</span></>}
                </div>
              )}
            </SettingsCard>

            <SettingsCard
              title="Agent Behavior"
              description="Execution defaults for tool actions"
            >
              <SettingRow
                label="Auto-Approve"
                description="Use local rules for always, send once to server"
                icon={<BoltIcon size={14} />}
                onClick={handleAutoApprove}
              >
                <Toggle enabled={autoApprove} onChange={handleAutoApprove} />
              </SettingRow>
            </SettingsCard>
          </div>

          <SettingsCard
            title="Conversation Experience"
            description="Message density, reasoning style, and step summary fields"
          >
            <div className="space-y-3">
              <div className="grid gap-2 lg:grid-cols-2">
                <SettingRow
                  label="Collapse Long Messages"
                  description="Auto-collapse lengthy user messages"
                  icon={<CompactIcon size={14} />}
                  onClick={handleCollapseToggle}
                  className="bg-bg-100/35 border-border-200/45"
                >
                  <Toggle enabled={collapseUserMessages} onChange={handleCollapseToggle} />
                </SettingRow>

                <div className="rounded-lg border border-border-200/45 bg-bg-100/35 px-2.5 py-2.5">
                  <div className="flex items-start gap-3">
                    <span className="text-text-400 mt-0.5 shrink-0"><ThinkingIcon size={14} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium text-text-100">Thinking Display</div>
                      <div className="text-[11px] text-text-400 mt-0.5 mb-2">Choose capsule or low-noise italic style</div>
                      <SegmentedControl
                        value={reasoningDisplayMode}
                        options={[
                          { value: 'capsule', label: 'Capsule' },
                          { value: 'italic', label: 'Italic' },
                        ]}
                        onChange={(v) => handleReasoningDisplayModeChange(v as ReasoningDisplayMode)}
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-3 border-t border-border-100/55">
                <div className="text-[11px] font-medium text-text-400 uppercase tracking-wider mb-2">Step Finish Info</div>
                <div className="grid gap-2 md:grid-cols-2">
                  {([
                    { key: 'tokens', label: 'Tokens', desc: 'Show token usage' },
                    { key: 'cache', label: 'Cache', desc: 'Show cache hit info' },
                    { key: 'cost', label: 'Cost', desc: 'Show API cost' },
                    { key: 'duration', label: 'Duration', desc: 'Show message response time' },
                    { key: 'turnDuration', label: 'Total Duration', desc: 'Show full turn elapsed time' },
                  ] as const).map(({ key, label, desc }) => (
                    <SettingRow
                      key={key}
                      label={label}
                      description={desc}
                      icon={<EyeIcon size={14} />}
                      className="bg-bg-100/35 border-border-200/45"
                      onClick={() => {
                        const next = { [key]: !stepFinishDisplay[key] }
                        setStepFinishDisplay(prev => ({ ...prev, ...next }))
                        themeStore.setStepFinishDisplay(next)
                      }}
                    >
                      <Toggle
                        enabled={stepFinishDisplay[key]}
                        onChange={() => {
                          const next = { [key]: !stepFinishDisplay[key] }
                          setStepFinishDisplay(prev => ({ ...prev, ...next }))
                          themeStore.setStepFinishDisplay(next)
                        }}
                      />
                    </SettingRow>
                  ))}
                </div>
              </div>
            </div>
          </SettingsCard>
        </>
      )}

      {mode === 'notifications' && (
        <div className="grid gap-4 xl:grid-cols-2">
          <SettingsCard
            title="System Notifications"
            description="Browser-level notifications when responses complete"
          >
            {notificationsSupported ? (
              <div className="space-y-1.5">
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
              </div>
            ) : (
              <div className="text-[12px] text-text-400 leading-relaxed">
                System notifications are not available in this environment
              </div>
            )}
          </SettingsCard>

          <SettingsCard
            title="In-App Alerts"
            description="Toast notifications for background session events"
          >
            <SettingRow
              label="Toast Notifications"
              description="Show in-app toast popups"
              icon={<BellIcon size={14} />}
              onClick={handleToastToggle}
            >
              <Toggle enabled={toastEnabled} onChange={handleToastToggle} />
            </SettingRow>
          </SettingsCard>
        </div>
      )}

      {mode === 'service' && (
        isTauriDesktop ? (
          <SettingsCard
            title="Local Service"
            description="Manage embedded opencode serve startup, status, and environment"
          >
            <div className="space-y-3">
              <div>
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

              <div className="grid gap-2 md:grid-cols-2">
                <SettingRow
                  label="Auto-start Service"
                  description="Run opencode serve automatically when app launches"
                  icon={<PlugIcon size={14} />}
                  onClick={handleAutoStartToggle}
                  className="bg-bg-100/35 border-border-200/45"
                >
                  <Toggle enabled={autoStartService} onChange={handleAutoStartToggle} />
                </SettingRow>

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
                        ? <WifiIcon size={14} className="text-success-100" />
                        : <WifiOffIcon size={14} className="text-text-400" />
                  }
                  className="bg-bg-100/35 border-border-200/45"
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
              </div>

              <div>
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
                            focus:outline-none focus:border-accent-main-100/50 text-text-100 placeholder:text-text-500"
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

              {serviceError && (
                <div className="text-[11px] text-danger-100 bg-danger-100/10 border border-danger-100/20 rounded-md px-2.5 py-2 leading-relaxed break-all">
                  {serviceError}
                </div>
              )}
            </div>
          </SettingsCard>
        ) : (
          <SettingsCard
            title="Local Service"
            description="This section is available on desktop app only"
          >
            <div className="text-[12px] text-text-400 leading-relaxed">
              OpenCode web mode connects to external servers and does not manage a local background service
            </div>
          </SettingsCard>
        )
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
    if (health.status === 'online') return <WifiIcon size={12} className="text-success-100" />
    if (health.status === 'unauthorized') return <KeyIcon size={12} className="text-warning-100" />
    return <WifiOffIcon size={12} className="text-danger-100" />
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
          {isActive && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium text-accent-main-100 bg-accent-main-100/10 shrink-0">
              Current
            </span>
          )}
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
            <div className="text-[11px] text-warning-100 bg-warning-bg border border-warning-100/20 rounded-md px-2.5 py-2 leading-relaxed">
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
  const orderedServers = useMemo(() => {
    if (!activeServer) return servers
    const active = servers.find(s => s.id === activeServer.id)
    if (!active) return servers
    return [active, ...servers.filter(s => s.id !== active.id)]
  }, [servers, activeServer?.id])
  
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
    <div className="space-y-4">
      <SettingsCard
        title="Connections"
        description="Manage backend endpoints and choose which server this session uses"
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={checkAllHealth}
              className="text-[11px] px-2 py-1 rounded-md border border-border-200/60 text-text-300 hover:text-text-100 hover:border-border-300/70 hover:bg-bg-100/60 transition-colors"
            >
              Refresh
            </button>
            {!addingServer && (
              <button
                onClick={() => setAddingServer(true)}
                className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-accent-main-100/40 text-accent-main-100 hover:text-accent-main-200 hover:border-accent-main-100/60 hover:bg-accent-main-100/5 transition-colors"
              >
                <PlusIcon size={10} /> Add
              </button>
            )}
          </div>
        }
      >
        <div className="space-y-1.5">
          {orderedServers.map(s => (
            <ServerItem
              key={s.id}
              server={s}
              health={getHealth(s.id)}
              isActive={activeServer?.id === s.id}
              onSelect={() => handleSelectServer(s.id)}
              onDelete={() => removeServer(s.id)}
              onCheckHealth={() => checkHealth(s.id)}
            />
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

          {servers.length === 0 && !addingServer && (
            <div className="text-[13px] text-text-400 text-center py-8">
              No servers configured
            </div>
          )}
        </div>
      </SettingsCard>
    </div>
  )
}

// ============================================
// Nav Tabs
// ============================================

const TABS: { id: SettingsTab; label: string; description: string; icon: React.ReactNode }[] = [
  {
    id: 'servers',
    label: 'Servers',
    description: 'Backend connections and fast active endpoint switching',
    icon: <GlobeIcon size={15} />,
  },
  {
    id: 'chat',
    label: 'Chat',
    description: 'Reasoning style, path display, and conversation behavior',
    icon: <SettingsIcon size={15} />,
  },
  {
    id: 'appearance',
    label: 'Appearance',
    description: 'Theme, color mode, and layout preferences',
    icon: <SunIcon size={15} />,
  },
  {
    id: 'notifications',
    label: 'Notifications',
    description: 'Desktop and in-app alerts',
    icon: <BellIcon size={15} />,
  },
  {
    id: 'service',
    label: 'Service',
    description: 'Local opencode service management',
    icon: <PlugIcon size={15} />,
  },
  {
    id: 'keybindings',
    label: 'Shortcuts',
    description: 'Customize keyboard shortcuts for faster workflows',
    icon: <KeyboardIcon size={15} />,
  },
]

const TAB_GROUPS: { label: string; tabs: SettingsTab[] }[] = [
  { label: 'Core', tabs: ['servers', 'chat', 'appearance', 'notifications'] },
  { label: 'Advanced', tabs: ['service', 'keybindings'] },
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
    case 'chat':
      return <GeneralSettings mode="chat" />
    case 'notifications':
      return <GeneralSettings mode="notifications" />
    case 'service':
      return <GeneralSettings mode="service" />
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
  isOpen, onClose, themeMode, onThemeChange, isWideMode, onToggleWideMode, initialTab = 'servers',
  presetId, onPresetChange, availablePresets, customCSS, onCustomCSSChange,
}: SettingsDialogProps) {
  const isMobile = useIsMobile()
  const isTauriDesktop = isTauri() && !isMobile
  const normalizeTab = useCallback((next: SettingsDialogProps['initialTab']): SettingsTab => {
    if (!next || next === 'general') return 'chat'
    return next
  }, [])
  const [tab, setTab] = useState<SettingsTab>(normalizeTab(initialTab))

  const visibleTabs = isTauriDesktop ? TABS : TABS.filter(t => t.id !== 'service')
  const groupedTabs = TAB_GROUPS
    .map(group => ({
      ...group,
      tabs: group.tabs
        .map(id => visibleTabs.find(t => t.id === id))
        .filter((t): t is (typeof TABS)[number] => !!t),
    }))
    .filter(group => group.tabs.length > 0)

  useEffect(() => {
    if (!isOpen) return
    setTab(normalizeTab(initialTab))
  }, [isOpen, initialTab, normalizeTab])

  useEffect(() => {
    if (visibleTabs.some(t => t.id === tab)) return
    setTab(visibleTabs[0]?.id || 'appearance')
  }, [tab, visibleTabs])

  const handleTabKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const dir = e.key === 'ArrowDown' ? 1 : -1
      const ids = visibleTabs.map(t => t.id)
      if (ids.length === 0) return
      const next = (ids.indexOf(tab) + dir + ids.length) % ids.length
      setTab(ids[next])
    }
  }, [tab, visibleTabs])

  const contentProps = {
    themeMode, onThemeChange, isWideMode, onToggleWideMode,
    presetId, onPresetChange, availablePresets, customCSS, onCustomCSSChange,
  }

  const activeTabMeta = visibleTabs.find(t => t.id === tab) || visibleTabs[0] || TABS[0]

  // 移动端：顶部 tab 切换 + 全屏内容
  if (isMobile) {
    return (
      <Dialog isOpen={isOpen} onClose={onClose} title="" width="100%" showCloseButton={false}>
        <div className="flex flex-col -m-5" style={{ height: '88vh' }}>
          {/* Top: Title + Close */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border-100/50 shrink-0">
            <div>
              <div className="text-sm font-semibold text-text-100">Settings</div>
              <div className="text-[11px] text-text-400 mt-0.5">{activeTabMeta.label}</div>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-text-400 hover:text-text-200 hover:bg-bg-100 rounded-md transition-colors -mr-1"
            >
              <CloseIcon size={18} />
            </button>
          </div>

          {/* Tab Bar - 横向滚动 */}
          <div className="flex items-center gap-1 px-3 py-2 border-b border-border-100/50 shrink-0 overflow-x-auto scrollbar-none">
            {visibleTabs.map(t => (
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
    <Dialog isOpen={isOpen} onClose={onClose} title="" width="min(97vw, 1040px)" showCloseButton={false}>
      <div className="flex h-[min(86vh,760px)] -m-5">
        {/* Left Nav */}
        <nav className="w-[236px] shrink-0 border-r border-border-100/60 bg-bg-050/45 py-4 px-2.5 flex flex-col" onKeyDown={handleTabKeyDown}>
          <div className="px-3 mb-4">
            <div className="text-sm font-semibold text-text-100">Settings</div>
            <div className="text-[11px] text-text-400 mt-0.5 leading-relaxed">Customize UI, behavior, and server setup</div>
          </div>
          <div className="space-y-3">
            {groupedTabs.map(group => (
              <div key={group.label}>
                <div className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-400/90">
                  {group.label}
                </div>
                <div className="space-y-1">
                  {group.tabs.map(t => (
                    <button
                      key={t.id}
                      onClick={() => setTab(t.id)}
                      tabIndex={t.id === tab ? 0 : -1}
                      className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-colors
                        ${t.id === tab
                          ? 'bg-bg-100 text-text-100 ring-1 ring-border-200/60'
                          : 'text-text-400 hover:text-text-200 hover:bg-bg-100/50'}`}
                    >
                      {t.icon}
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          
          <div className="mt-auto pt-3 px-3 text-[10px] text-text-400">v0.1.0</div>
        </nav>

        {/* Right Content */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="shrink-0 border-b border-border-100/60 px-6 py-4 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-base font-semibold text-text-100">{activeTabMeta.label}</div>
              <div className="text-[12px] text-text-400 mt-0.5 leading-relaxed">{activeTabMeta.description}</div>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-text-400 hover:text-text-200 hover:bg-bg-100 rounded-md transition-colors -mr-1"
              aria-label="Close settings"
            >
              <CloseIcon size={18} />
            </button>
          </div>

          <div className="flex-1 min-h-0 py-5 px-6 overflow-y-auto custom-scrollbar">
            <TabContent tab={tab} {...contentProps} />
          </div>
        </div>
      </div>
    </Dialog>
  )
}
