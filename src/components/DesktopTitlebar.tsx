import { useEffect, useMemo } from 'react'
import { DESKTOP_TITLEBAR_CONTROLS_Z_INDEX, DESKTOP_TITLEBAR_HEIGHT, DESKTOP_TITLEBAR_Z_INDEX } from '../constants'
import { useTheme } from '../hooks/useTheme'
import { getDesktopPlatform, usesCustomDesktopTitlebar } from '../utils/tauri'

export function DesktopTitlebar() {
  const { mode, resolvedTheme } = useTheme()
  const platform = useMemo(() => getDesktopPlatform(), [])
  const isDesktopChrome = useMemo(() => usesCustomDesktopTitlebar(), [])

  useEffect(() => {
    if (!isDesktopChrome) return

    let cancelled = false
    const theme = mode === 'system' ? null : resolvedTheme

    void import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
      if (cancelled) return
      try {
        await getCurrentWindow().setTheme(theme)
      } catch {
        // ignore - native theme sync is best effort only
      }
    })

    return () => {
      cancelled = true
    }
  }, [isDesktopChrome, mode, resolvedTheme])

  if (!isDesktopChrome) return null

  return (
    <header
      className="desktop-titlebar relative grid shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center bg-bg-100"
      style={{ height: DESKTOP_TITLEBAR_HEIGHT, zIndex: DESKTOP_TITLEBAR_Z_INDEX }}
    >
      {platform === 'macos' ? (
        <div className="h-full w-[76px] shrink-0" />
      ) : (
        <div data-tauri-drag-region className="flex h-full min-w-0 items-center px-3 shrink-0">
          <span className="truncate text-[12px] font-medium tracking-[0.01em] text-text-300">OpenCode</span>
        </div>
      )}

      <div data-tauri-drag-region className="flex min-w-0 h-full items-center px-3">
        {platform === 'macos' ? (
          <span className="truncate text-[12px] font-medium tracking-[0.01em] text-text-300">OpenCode</span>
        ) : null}
      </div>

      {platform === 'windows' ? (
        <div
          data-tauri-decorum-tb
          className="desktop-titlebar-controls flex h-full min-w-[138px] shrink-0 items-stretch justify-end"
          style={{ zIndex: DESKTOP_TITLEBAR_CONTROLS_Z_INDEX }}
        />
      ) : (
        <div data-tauri-drag-region className="h-full w-3 shrink-0" />
      )}
    </header>
  )
}
