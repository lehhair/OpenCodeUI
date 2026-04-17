import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { ShareDialog } from '../ShareDialog'
import { ContextDetailsDialog } from './ContextDetailsDialog'
import {
  CogIcon,
  SunIcon,
  MoonIcon,
  SystemIcon,
  MaximizeIcon,
  MinimizeIcon,
  ShareIcon,
} from '../../../components/Icons'
import { CircularProgress } from '../../../components/CircularProgress'
import { formatTokens, formatCost, useTheme } from '../../../hooks'
import type { SessionStats } from '../../../hooks'

// 状态指示器 - 圆环 + 右下角状态点
function StatusIndicator({
  percent,
  connectionState,
  size = 24,
}: {
  percent: number
  connectionState: string
  size?: number
}) {
  const clampedPercent = Math.min(Math.max(percent, 0), 100)

  // 进度颜色
  const progressColor =
    clampedPercent === 0
      ? 'text-text-500'
      : clampedPercent >= 90
        ? 'text-danger-100'
        : clampedPercent >= 70
          ? 'text-warning-100'
          : 'text-accent-main-100'

  // 连接状态颜色
  const statusColor =
    connectionState === 'connected'
      ? 'bg-success-100'
      : connectionState === 'connecting'
        ? 'bg-warning-100 animate-pulse'
        : connectionState === 'error'
          ? 'bg-danger-100'
          : 'bg-text-500'

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <CircularProgress
        progress={clampedPercent / 100}
        size={size}
        strokeWidth={3}
        trackClassName="text-text-100/10"
        progressClassName={progressColor}
      />

      {/* 右下角状态点 - 带背景边框以突出显示 */}
      <div
        className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-bg-200 ${statusColor}`}
      />
    </div>
  )
}

export interface SidebarFooterProps {
  showLabels: boolean
  connectionState: string
  stats: SessionStats
  hasMessages: boolean
  onOpenSettings?: () => void
}

export function SidebarFooter({ showLabels, connectionState, stats, hasMessages, onOpenSettings }: SidebarFooterProps) {
  const { t } = useTranslation(['chat', 'common'])
  const { mode: themeMode, setThemeWithAnimation: onThemeChange, isWideMode, toggleWideMode } = useTheme()
  const [isOpen, setIsOpen] = useState(false)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0, width: 260, fromBottom: false })
  const [shareDialogOpen, setShareDialogOpen] = useState(false)
  const [contextDialogOpen, setContextDialogOpen] = useState(false)
  const [isVisible, setIsVisible] = useState(false)
  const prevShowLabelsRef = useRef(showLabels)
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const closeTimeoutIdRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 菜单中连接状态显示用
  const statusColorClass =
    {
      connected: 'bg-success-100',
      connecting: 'bg-warning-100 animate-pulse',
      disconnected: 'bg-text-500',
      error: 'bg-danger-100',
    }[connectionState] || 'bg-text-500'

  const statsColor =
    stats.contextPercent >= 90 ? 'bg-danger-100' : stats.contextPercent >= 70 ? 'bg-warning-100' : 'bg-accent-main-100'

  // 打开菜单
  const openMenu = useCallback(() => {
    if (!buttonRef.current || !containerRef.current) return

    const buttonRect = buttonRef.current.getBoundingClientRect()
    const containerRect = containerRef.current.getBoundingClientRect()
    const menuWidth = showLabels ? containerRect.width : 260

    if (showLabels) {
      // 展开模式：菜单底部在容器上方，留点间隙
      setMenuPos({
        top: containerRect.top - 8,
        left: containerRect.left,
        width: menuWidth,
        fromBottom: true,
      })
    } else {
      // 收起模式：菜单在按钮右侧，底部对齐按钮底部
      setMenuPos({
        top: buttonRect.bottom, // 用作 bottom 计算的参考点
        left: buttonRect.right + 16, // 间距增加到 16px
        width: 260,
        fromBottom: true, // 也用 bottom 定位
      })
    }

    setIsOpen(true)
    requestAnimationFrame(() => setIsVisible(true))
  }, [showLabels])

  // 关闭菜单
  const closeMenu = useCallback(() => {
    setIsVisible(false)
    // 使用 ref 追踪 timeout 以便清理
    const closeTimeoutId = setTimeout(() => setIsOpen(false), 150)
    // 保存到 ref 以便清理
    closeTimeoutIdRef.current = closeTimeoutId
  }, [])

  // 切换菜单
  const toggleMenu = useCallback(() => {
    if (isOpen) closeMenu()
    else openMenu()
  }, [isOpen, openMenu, closeMenu])

  // 点击外部关闭
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

  // ESC 关闭
  useEffect(() => {
    if (!isOpen) return
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu()
    }
    document.addEventListener('keydown', handleEsc)
    return () => document.removeEventListener('keydown', handleEsc)
  }, [isOpen, closeMenu])

  // 侧边栏状态变化时关闭
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

  // 清理 closeTimeout 防止内存泄漏
  useEffect(() => {
    return () => {
      if (closeTimeoutIdRef.current) {
        clearTimeout(closeTimeoutIdRef.current)
        closeTimeoutIdRef.current = null
      }
    }
  }, [])

  // 浮动菜单
  const floatingMenu = isOpen
    ? createPortal(
        <div
          ref={menuRef}
          className={`
        fixed z-[9999] rounded-xl border border-border-200/60 glass-alt shadow-lg overflow-hidden
        transition-all duration-150 ease-out
        ${isVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}
      `}
          style={{
            bottom: window.innerHeight - menuPos.top,
            left: menuPos.left,
            width: menuPos.width,
            transformOrigin: showLabels ? 'bottom left' : 'bottom left',
          }}
        >
          {/* Context Stats */}
          <div className="p-3 border-b border-border-200/30">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[length:var(--fs-sm)] font-medium text-text-200">{t('sidebar.contextUsage')}</span>
              <div className="flex items-center gap-2">
                <span className="text-[length:var(--fs-sm)] font-mono text-text-400">
                  {Math.round(stats.contextPercent)}%
                </span>
                <button
                  type="button"
                  onClick={() => {
                    closeMenu()
                    setContextDialogOpen(true)
                  }}
                  className="
                shrink-0 h-6 px-2
                rounded-md border border-border-200/60
                bg-bg-200/70 hover:bg-bg-300
                text-[length:var(--fs-xxs)] font-medium text-text-200
                transition-colors
              "
                >
                  {t('sidebar.viewDetails')}
                </button>
              </div>
            </div>
            <div className="w-full h-1.5 bg-bg-300 rounded-full overflow-hidden relative mb-2">
              <div
                className={`absolute inset-0 ${statsColor} transition-transform duration-500 ease-out origin-left`}
                style={{ transform: `scaleX(${Math.min(100, stats.contextPercent) / 100})` }}
              />
            </div>
            <div className="flex justify-between text-[length:var(--fs-xxs)] text-text-400 font-mono">
              <span>
                {formatTokens(stats.contextUsed)} / {formatTokens(stats.contextLimit)}
              </span>
              <span>{formatCost(stats.totalCost)}</span>
            </div>
          </div>

          {/* Theme Selector */}
          <div className="p-2 border-b border-border-200/30">
            <div className="text-[length:var(--fs-xxs)] font-bold text-text-400 uppercase tracking-wider px-1 mb-1.5">
              {t('sidebar.appearance')}
            </div>
            <div className="flex bg-bg-200/50 p-1 rounded-lg border border-border-200/30 relative isolate">
              <div
                className="absolute top-1 bottom-1 left-1 w-[calc((100%-8px)/3)] bg-bg-000 rounded-md shadow-sm ring-1 ring-border-200/50 transition-transform duration-300 ease-out -z-10"
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
                  className={`flex-1 flex items-center justify-center py-1.5 rounded-md text-[length:var(--fs-sm)] font-medium transition-colors duration-200 ${
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

          {/* Menu Items */}
          <div className="py-1">
            {toggleWideMode && (
              <button
                onClick={() => {
                  toggleWideMode()
                  closeMenu()
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-[length:var(--fs-sm)] text-text-300 hover:text-text-100 hover:bg-bg-200/50 transition-colors text-left"
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
              className="w-full flex items-center gap-2.5 px-3 py-2 text-[length:var(--fs-sm)] text-text-300 hover:text-text-100 hover:bg-bg-200/50 transition-colors text-left"
            >
              <ShareIcon size={14} />
              <span>{t('sidebar.shareChat')}</span>
            </button>

            <button
              onClick={() => {
                closeMenu()
                onOpenSettings?.()
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-[length:var(--fs-sm)] text-text-300 hover:text-text-100 hover:bg-bg-200/50 transition-colors text-left"
            >
              <CogIcon size={14} />
              <span>{t('sidebar.settings')}</span>
            </button>
          </div>

          {/* Connection Status */}
          <div className="flex items-center gap-2 px-3 py-2 text-[length:var(--fs-xxs)] text-text-400 cursor-default border-t border-border-200/30 bg-bg-200/20">
            <div className={`w-1.5 h-1.5 rounded-full ${statusColorClass}`} />
            <span className="capitalize">{connectionState}</span>
          </div>
        </div>,
        document.body,
      )
    : null

  return (
    <div className="shrink-0 pb-[var(--safe-area-inset-bottom)]">
      <div ref={containerRef} className="flex flex-col gap-0.5 mx-2 py-2">
        {/* 状态/设置触发按钮 */}
        <button
          ref={buttonRef}
          onClick={toggleMenu}
          className={`
            h-8 flex items-center rounded-lg transition-all duration-300 group overflow-hidden
            ${isOpen ? 'bg-bg-200 text-text-100' : 'text-text-300 hover:text-text-100 hover:bg-bg-200'}
          `}
          style={{
            width: showLabels ? '100%' : 32,
            paddingLeft: showLabels ? 6 : 4, // 收起时为了对齐中心线(16px)，24px圆环需要4px padding (4+12=16)
            paddingRight: showLabels ? 8 : 4,
          }}
          title={`Context: ${formatTokens(hasMessages ? stats.contextUsed : 0)} tokens • ${Math.round(stats.contextPercent)}% • ${formatCost(stats.totalCost)}`}
        >
          {/* 状态指示器 */}
          <StatusIndicator percent={stats.contextPercent} connectionState={connectionState} size={24} />

          {/* 展开时显示详细信息 */}
          <span
            className="ml-2 flex-1 flex items-center justify-between min-w-0 transition-opacity duration-300"
            style={{ opacity: showLabels ? 1 : 0 }}
          >
            <span className="text-[length:var(--fs-sm)] font-mono text-text-300 truncate">
              {hasMessages ? formatTokens(stats.contextUsed) : '0'} / {formatTokens(stats.contextLimit)}
            </span>
            <span
              className={`text-[length:var(--fs-sm)] font-medium ml-2 ${
                stats.contextPercent >= 90
                  ? 'text-danger-100'
                  : stats.contextPercent >= 70
                    ? 'text-warning-100'
                    : 'text-text-400'
              }`}
            >
              {Math.round(stats.contextPercent)}%
            </span>
          </span>
        </button>
      </div>

      {floatingMenu}
      <ShareDialog isOpen={shareDialogOpen} onClose={() => setShareDialogOpen(false)} />
      <ContextDetailsDialog
        isOpen={contextDialogOpen}
        onClose={() => setContextDialogOpen(false)}
        contextLimit={stats.contextLimit}
      />
    </div>
  )
}
