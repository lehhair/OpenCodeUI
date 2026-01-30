import { Dialog } from '../../components/ui/Dialog'
import { SunIcon, MoonIcon, SystemIcon, MaximizeIcon, MinimizeIcon } from '../../components/Icons'
import { usePathMode } from '../../hooks'
import type { ThemeMode } from '../../hooks'
import type { PathMode } from '../../utils/directoryUtils'

interface SettingsDialogProps {
  isOpen: boolean
  onClose: () => void
  themeMode: ThemeMode
  onThemeChange: (mode: ThemeMode, event?: React.MouseEvent) => void
  isWideMode?: boolean
  onToggleWideMode?: () => void
}

// Path mode icons
function AutoIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M4.93 19.07l1.41-1.41m11.32-11.32l1.41-1.41" />
    </svg>
  )
}

function UnixIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M7 4l10 16" strokeLinecap="round" />
    </svg>
  )
}

function WindowsIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M17 4L7 20" strokeLinecap="round" />
    </svg>
  )
}

export function SettingsDialog({
  isOpen,
  onClose,
  themeMode,
  onThemeChange,
  isWideMode,
  onToggleWideMode,
}: SettingsDialogProps) {
  const { pathMode, setPathMode, effectiveStyle, detectedStyle, isAutoMode } = usePathMode()

  const handlePathModeChange = (mode: PathMode) => {
    setPathMode(mode)
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
              <AutoIcon />
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
              <UnixIcon />
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
              <WindowsIcon />
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
        
        <div className="pt-6 border-t border-border-100/50 text-center">
           <p className="text-xs text-text-400">Claude Chat UI • v0.1.0</p>
        </div>
      </div>
    </Dialog>
  )
}
