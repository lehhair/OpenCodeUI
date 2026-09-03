import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { ShareDialog } from '../ShareDialog'
import {
  CogIcon,
  SunIcon,
  MoonIcon,
  SystemIcon,
  MaximizeIcon,
  MinimizeIcon,
  ShareIcon,
} from '../../../components/Icons'
import { useTheme } from '../../../hooks'

export interface SidebarFooterProps {
  showLabels: boolean
  connectionState: string
  onOpenSettings?: () => void
}

export function SidebarFooter({ showLabels, connectionState, onOpenSettings }: SidebarFooterProps) {
  const { t } = useTranslation(['chat', 'common'])
  const { mode: themeMode, setThemeWithAnimation: onThemeChange, isWideMode, toggleWideMode } = useTheme()
  const [isOpen, setIsOpen] = useState(false)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0, width: 260, fromBottom: false })
  const [shareDialogOpen, setShareDialogOpen] = useState(false)
  const [isVisible, setIsVisible] = useState(false)
  const prevShowLabelsRef = useRef(showLabels)
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const closeTimeoutIdRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const statusColorClass =
    {
      connected: 'bg-success-100',
      connecting: 'bg-warning-100 animate-pulse',
      disconnected: 'bg-text-500',
      error: 'bg-danger-100',
    }[connectionState] || 'bg-text-500'

  const openMenu = useCallback(() => {
    if (!buttonRef.current || !containerRef.current) return

    const buttonRect = buttonRef.current.getBoundingClientRect()
    const containerRect = containerRef.current.getBoundingClientRect()
    const menuWidth = showLabels ? containerRect.width : 260

    if (showLabels) {
      setMenuPos({
        top: containerRect.top - 8,
        left: containerRect.left,
        width: menuWidth,
        fromBottom: true,
      })
    } else {
      setMenuPos({
        top: buttonRect.bottom,
        left: buttonRect.right + 16,
        width: 260,
        fromBottom: true,
      })
    }

    setIsOpen(true)
    requestAnimationFrame(() => setIsVisible(true))
  }, [showLabels])

  const closeMenu = useCallback(() => {
    setIsVisible(false)
    const closeTimeoutId = setTimeout(() => setIsOpen(false), 150)
    closeTimeoutIdRef.current = closeTimeoutId
  }, [])

  const toggleMenu = useCallback(() => {
    if (isOpen) closeMenu()
    else openMenu()
  }, [isOpen, openMenu, closeMenu])

  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (buttonRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      closeMenu()
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen, closeMenu])

  useEffect(() => {
    if (!isOpen) return
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu()
    }
    document.addEventListener('keydown', handleEsc)
    return () => document.removeEventListener('keydown', handleEsc)
  }, [isOpen, closeMenu])

  useEffect(() => {
    const showLabelsChanged = prevShowLabelsRef.current !== showLabels
    prevShowLabelsRef.current = showLabels

    let frameId: number | null = null

    if (showLabelsChanged && isOpen) {
      frameId = requestAnimationFrame(() => closeMenu())
    }

    return () => {
      if (frameId !== null) cancelAnimationFrame(frameId)
    }
  }, [showLabels, isOpen, closeMenu])

  useEffect(() => {
    return () => {
      if (closeTimeoutIdRef.current) {
        clearTimeout(closeTimeoutIdRef.current)
        closeTimeoutIdRef.current = null
      }
    }
  }, [])

  const floatingMenu = isOpen
    ? createPortal(
        <div
          ref={menuRef}
          className={`
        fixed z-[9999] rounded-lg border border-border-200/60 glass-alt shadow-lg overflow-hidden
        transition-all duration-150 ease-out
        ${isVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}
      `}
          style={{
            bottom: window.innerHeight - menuPos.top,
            left: menuPos.left,
            width: menuPos.width,
            transformOrigin: 'bottom left',
          }}
        >
          <div className="relative p-2">
            <div className="text-[length:var(--fs-xxs)] font-bold text-text-400 uppercase tracking-wider px-1 mb-1.5">
              {t('sidebar.appearance')}
            </div>
            <div className="flex bg-bg-200/50 p-1 rounded-md border border-border-200/30 relative isolate">
              <div
                className="absolute top-1 bottom-1 left-1 w-[calc((100%-8px)/3)] bg-bg-000 rounded-sm shadow-sm ring-1 ring-border-200/50 transition-transform duration-300 ease-out -z-10"
                style={{
                  transform:
                    themeMode === 'system'
                      ? 'translateX(0%)'
                      : themeMode === 'light'
                        ? 'translateX(100%)'
                        : 'translateX(200%)',
                }}
              />
              {(['system', 'light', 'dark'] as const).map(m => (
                <button
                  key={m}
                  onClick={e => onThemeChange(m, e)}
                  className={`flex-1 flex items-center justify-center py-1.5 rounded-sm text-[length:var(--fs-sm)] font-medium transition-colors duration-200 ${
                    themeMode === m ? 'text-text-100' : 'text-text-400 hover:text-text-200'
                  }`}
                >
                  {m === 'system' && <SystemIcon size={14} />}
                  {m === 'light' && <SunIcon size={14} />}
                  {m === 'dark' && <MoonIcon size={14} />}
                </button>
              ))}
            </div>
            <div className="pointer-events-none absolute inset-x-3 bottom-0 h-px bg-border-200/30" />
          </div>

          <div className="p-1">
            {toggleWideMode && (
              <button
                onClick={() => {
                  toggleWideMode()
                  closeMenu()
                }}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[length:var(--fs-sm)] text-text-300 hover:text-text-100 hover:bg-bg-200/50 transition-colors text-left"
              >
                {isWideMode ? <MinimizeIcon size={14} /> : <MaximizeIcon size={14} />}
                <span>{isWideMode ? t('sidebar.standardWidth') : t('sidebar.wideMode')}</span>
              </button>
            )}

            <button
              onClick={() => {
                closeMenu()
                setShareDialogOpen(true)
              }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[length:var(--fs-sm)] text-text-300 hover:text-text-100 hover:bg-bg-200/50 transition-colors text-left"
            >
              <ShareIcon size={14} />
              <span>{t('sidebar.shareChat')}</span>
            </button>

            <button
              onClick={() => {
                closeMenu()
                onOpenSettings?.()
              }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[length:var(--fs-sm)] text-text-300 hover:text-text-100 hover:bg-bg-200/50 transition-colors text-left"
            >
              <span className="relative shrink-0">
                <CogIcon size={14} />
                <span
                  className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-bg-200 ${statusColorClass}`}
                />
              </span>
              <span className="flex-1">{t('sidebar.settings')}</span>
              <span className="text-[length:var(--fs-xxs)] text-text-400 capitalize">{connectionState}</span>
            </button>
          </div>
        </div>,
        document.body,
      )
    : null

  return (
    <div className="shrink-0 pb-[var(--safe-area-inset-bottom)]">
      <div ref={containerRef} className="flex flex-col gap-0.5 mx-2 py-2">
        <button
          ref={buttonRef}
          onClick={toggleMenu}
          className={`
            h-8 flex items-center rounded-lg transition-all duration-300 group overflow-hidden
            ${isOpen ? 'bg-bg-200 text-text-100' : 'text-text-300 hover:text-text-100 hover:bg-bg-200'}
          `}
          style={{
            width: showLabels ? '100%' : 32,
            paddingLeft: showLabels ? 6 : 4,
            paddingRight: showLabels ? 8 : 4,
          }}
          title={t('sidebar.settings')}
        >
          <span className="relative shrink-0 size-6 flex items-center justify-center">
            <CogIcon size={18} />
            <span
              className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-bg-200 ${statusColorClass}`}
            />
          </span>

          <span
            className="ml-2 flex-1 text-left text-[length:var(--fs-sm)] truncate transition-opacity duration-300"
            style={{ opacity: showLabels ? 1 : 0 }}
          >
            {t('sidebar.settings')}
          </span>
        </button>
      </div>

      {floatingMenu}
      <ShareDialog isOpen={shareDialogOpen} onClose={() => setShareDialogOpen(false)} />
    </div>
  )
}