import { memo, useCallback, useEffect, useMemo } from 'react'
import {
  DESKTOP_MACOS_TRAFFIC_LIGHTS_WIDTH,
  DESKTOP_TITLEBAR_CONTROLS_Z_INDEX,
  DESKTOP_TITLEBAR_HEIGHT,
  DESKTOP_TITLEBAR_Z_INDEX,
} from '../constants'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  FolderOpenIcon,
  SettingsIcon,
  AppWindowIcon,
} from './Icons'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../hooks/useTheme'
import { getDesktopPlatform, isTauri, usesCustomDesktopTitlebar } from '../utils/tauri'
import { useUpdateStore, hasUpdateAvailable } from '../store/updateStore'

/* 标题栏图标按钮通用样式 — w-8 (32px) × h-full，和控制按钮等高对齐 */
const TB_BTN =
  'inline-flex h-full w-8 items-center justify-center text-text-300 transition-colors hover:bg-bg-200/70 hover:text-text-100'

const WindowsControlsHost = memo(function WindowsControlsHost() {
  return (
    <div
      data-tauri-decorum-tb
      className="desktop-titlebar-controls flex h-full min-w-[138px] shrink-0 items-stretch justify-end"
      style={{ zIndex: DESKTOP_TITLEBAR_CONTROLS_Z_INDEX }}
    />
  )
})

export function DesktopTitlebar() {
  const { t } = useTranslation('components')
  const { mode, resolvedTheme } = useTheme()
  const updateState = useUpdateStore()
  const hasUpdate = hasUpdateAvailable(updateState)
  const platform = useMemo(() => getDesktopPlatform(), [])
  const isDesktopChrome = useMemo(() => usesCustomDesktopTitlebar(), [])

  /* ---- 原生主题同步 ---- */
  useEffect(() => {
    if (!isDesktopChrome) return
    // 让 overlay 侧边栏知道标题栏高度
    document.documentElement.style.setProperty('--desktop-titlebar-height', `${DESKTOP_TITLEBAR_HEIGHT}px`)
    return () => {
      document.documentElement.style.removeProperty('--desktop-titlebar-height')
    }
  }, [isDesktopChrome])

  useEffect(() => {
    if (!isDesktopChrome) return

    let cancelled = false
    const theme = mode === 'system' ? null : resolvedTheme

    void import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
      if (cancelled) return
      try {
        await getCurrentWindow().setTheme(theme)
      } catch {
        // best effort
      }
    })

    return () => {
      cancelled = true
    }
  }, [isDesktopChrome, mode, resolvedTheme])

  /* ---- 导航 ---- */
  const handleBack = useCallback(() => {
    window.history.back()
  }, [])

  const handleForward = useCallback(() => {
    window.history.forward()
  }, [])

  /* ---- 功能操作 ---- */
  const handleOpenProject = useCallback(() => {
    window.dispatchEvent(new CustomEvent('titlebar:open-project'))
  }, [])

  const handleOpenSettings = useCallback(() => {
    window.dispatchEvent(new CustomEvent('titlebar:open-settings'))
  }, [])

  const handleNewWindow = useCallback(() => {
    if (!isTauri()) return
    void import('@tauri-apps/api/core').then(({ invoke }) => {
      invoke('open_new_window', { directory: null }).catch(() => {
        // 静默
      })
    })
  }, [])

  if (!isDesktopChrome) return null

  return (
    <header
      className="desktop-titlebar relative grid shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center bg-bg-100"
      style={{ height: DESKTOP_TITLEBAR_HEIGHT, zIndex: DESKTOP_TITLEBAR_Z_INDEX }}
    >
      {/* ---- 左侧：平台占位 + 导航 + 分隔 + 功能按钮 ---- */}
      <div className="flex h-full shrink-0 items-stretch">
        {platform === 'macos' ? (
          <div className="h-full shrink-0" style={{ width: DESKTOP_MACOS_TRAFFIC_LIGHTS_WIDTH }} />
        ) : (
          <div className="h-full shrink-0 w-1" />
        )}

        {/* 后退 / 前进 */}
        <button
          type="button"
          onClick={handleBack}
          className={TB_BTN}
          title={t('desktopTitlebar.goBack')}
          aria-label={t('desktopTitlebar.goBack')}
        >
          <ChevronLeftIcon size={14} />
        </button>
        <button
          type="button"
          onClick={handleForward}
          className={TB_BTN}
          title={t('desktopTitlebar.goForward')}
          aria-label={t('desktopTitlebar.goForward')}
        >
          <ChevronRightIcon size={14} />
        </button>

        {/* 打开项目 */}
        <button
          type="button"
          onClick={handleOpenProject}
          className={TB_BTN}
          title={t('desktopTitlebar.openProject')}
          aria-label={t('desktopTitlebar.openProject')}
        >
          <FolderOpenIcon size={14} />
        </button>

        {/* 设置 */}
        <button
          type="button"
          onClick={handleOpenSettings}
          className={
            hasUpdate
              ? 'inline-flex h-full w-8 items-center justify-center text-accent-main-100 transition-colors hover:bg-accent-main-100/10'
              : TB_BTN
          }
          title={hasUpdate ? t('desktopTitlebar.settingsUpdate') : t('desktopTitlebar.openSettings')}
          aria-label={hasUpdate ? t('desktopTitlebar.settingsUpdate') : t('desktopTitlebar.openSettings')}
        >
          <SettingsIcon size={14} />
        </button>

        {/* 新建窗口 */}
        <button
          type="button"
          onClick={handleNewWindow}
          className={TB_BTN}
          title={t('desktopTitlebar.newWindow')}
          aria-label={t('desktopTitlebar.newWindow')}
        >
          <AppWindowIcon size={14} />
        </button>
      </div>

      {/* ---- 中间：拖拽区 ---- */}
      <div data-tauri-drag-region className="h-full min-w-0" />

      {/* ---- 右侧：Windows 控制按钮 / macOS 留白 ---- */}
      {platform === 'windows' ? (
        <WindowsControlsHost />
      ) : (
        <div data-tauri-drag-region className="h-full w-3 shrink-0" />
      )}
    </header>
  )
}
