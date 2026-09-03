import { useState, useCallback, useRef, useEffect, memo } from 'react'
import { useTranslation } from 'react-i18next'
import { CircularProgress } from '../../../components/CircularProgress'
import { useSessionStats, formatTokens, formatCost } from '../../../hooks'
import { useMessageStore } from '../../../store'
import { ContextDetailsDialog } from '../sidebar/ContextDetailsDialog'
import { IconButton, DropdownMenu } from '../../../components/ui'

interface ContextUsageButtonProps {
  contextLimit?: number
  disabled?: boolean
}

export const ContextUsageButton = memo(function ContextUsageButton({
  contextLimit = 200000,
  disabled = false,
}: ContextUsageButtonProps) {
  const { t } = useTranslation('chat')
  const { messages } = useMessageStore()
  const stats = useSessionStats(contextLimit)
  const hasMessages = messages.length > 0
  const [menuOpen, setMenuOpen] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const percent = Math.min(Math.max(stats.contextPercent, 0), 100)
  const progressColor =
    percent === 0
      ? 'text-text-500'
      : percent >= 90
        ? 'text-danger-100'
        : percent >= 70
          ? 'text-warning-100'
          : 'text-accent-main-100'

  const statsBarColor =
    stats.contextPercent >= 90 ? 'bg-danger-100' : stats.contextPercent >= 70 ? 'bg-warning-100' : 'bg-accent-main-100'

  const toggleMenu = useCallback(() => {
    if (disabled) return
    setMenuOpen(open => !open)
  }, [disabled])

  const openDetailsDialog = useCallback(() => {
    setMenuOpen(false)
    setDialogOpen(true)
  }, [])

  useEffect(() => {
    if (!menuOpen) return

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setMenuOpen(false)
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [menuOpen])

  const title = `Context: ${formatTokens(hasMessages ? stats.contextUsed : 0)} / ${formatTokens(stats.contextLimit)} · ${Math.round(percent)}%`

  return (
    <>
      <IconButton
        ref={triggerRef}
        aria-label={t('sidebar.contextUsage')}
        aria-expanded={menuOpen}
        disabled={disabled}
        onClick={toggleMenu}
        className={`relative shrink-0 transition-colors ${
          menuOpen ? 'text-text-100 bg-bg-200/60' : 'text-text-400 hover:text-text-100'
        }`}
        title={title}
      >
        <span className="relative inline-flex" style={{ width: 18, height: 18 }}>
          <CircularProgress
            progress={percent / 100}
            size={18}
            strokeWidth={2.5}
            trackClassName="text-text-100/15"
            progressClassName={progressColor}
          />
        </span>
      </IconButton>

      <DropdownMenu
        triggerRef={triggerRef}
        isOpen={menuOpen}
        position="top"
        align="right"
        minWidth={300}
      >
        <div ref={menuRef} className="p-3 glass-alt border border-border-200/60 rounded-lg shadow-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[length:var(--fs-sm)] font-medium text-text-200">{t('sidebar.contextUsage')}</span>
            <div className="flex items-center gap-2">
              <span className="text-[length:var(--fs-sm)] font-mono text-text-400">{Math.round(stats.contextPercent)}%</span>
              <button
                type="button"
                onClick={openDetailsDialog}
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
              className={`absolute inset-0 ${statsBarColor} transition-transform duration-500 ease-out origin-left`}
              style={{ transform: `scaleX(${Math.min(100, stats.contextPercent) / 100})` }}
            />
          </div>
          <div className="flex justify-between text-[length:var(--fs-xxs)] text-text-400 font-mono">
            <span>
              {formatTokens(hasMessages ? stats.contextUsed : 0)} / {formatTokens(stats.contextLimit)}
            </span>
            <span>{formatCost(stats.totalCost)}</span>
          </div>
        </div>
      </DropdownMenu>

      <ContextDetailsDialog isOpen={dialogOpen} onClose={() => setDialogOpen(false)} contextLimit={stats.contextLimit} />
    </>
  )
})