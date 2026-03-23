import { memo, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDownIcon, RetryIcon } from '../../components/Icons'
import { useDelayedRender } from '../../hooks/useDelayedRender'

export interface RetryStatusInlineData {
  sessionID: string
  attempt: number
  message: string
  /** Absolute unix timestamp (ms) for the next retry */
  next: number
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return '0s'
  if (ms >= 10_000) return `${Math.ceil(ms / 1000)}s`
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`
  return '< 1s'
}

export const RetryStatusInline = memo(function RetryStatusInline({ status }: { status: RetryStatusInlineData }) {
  const { t } = useTranslation('chat')
  const [now, setNow] = useState(() => Date.now())
  const [expanded, setExpanded] = useState(false)
  const shouldRenderBody = useDelayedRender(expanded)

  const remainingMs = useMemo(() => {
    if (!Number.isFinite(status.next)) return null
    return status.next - now
  }, [status.next, now])

  const nextLabel = remainingMs !== null && remainingMs > 0 ? formatRemaining(remainingMs) : null
  const hasMessage = Boolean(status.message?.trim())

  // Tick the countdown timer while visible
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <div
      className="my-2 px-3 py-2 rounded-lg border border-warning-100/20 bg-warning-100/10"
      role="status"
      aria-live="polite"
    >
      <div
        className={`flex items-center gap-2 min-w-0 ${hasMessage ? 'cursor-pointer' : ''}`}
        onClick={() => hasMessage && setExpanded(prev => !prev)}
      >
        <RetryIcon className="w-4 h-4 text-warning-100 flex-shrink-0" />
        <span className="text-sm text-warning-100 flex-1 min-w-0 truncate">
          {t('retryStatus.retrying', { attempt: status.attempt })}
          {nextLabel && (
            <span className="text-xs text-text-400 ml-2 tabular-nums">
              {t('retryStatus.nextIn', { label: nextLabel })}
            </span>
          )}
        </span>
        {hasMessage && (
          <ChevronDownIcon
            className={`w-4 h-4 text-text-400 transition-transform duration-300 ${expanded ? '' : '-rotate-90'}`}
          />
        )}
      </div>

      {hasMessage && (
        <div
          className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${
            expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
          }`}
        >
          <div className="overflow-hidden">
            {shouldRenderBody && (
              <div className="mt-2 pt-2 border-t border-warning-100/20">
                <p className="text-xs text-text-300 font-mono whitespace-pre-wrap break-words overflow-x-hidden">
                  {status.message}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
})
