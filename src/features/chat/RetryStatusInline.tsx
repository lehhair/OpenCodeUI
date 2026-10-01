import { memo, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDownIcon, RetryIcon } from '../../components/Icons'
import { useNow } from '../../hooks/useNow'
import { chevronClass, MessageExpandPanel, useMessageExpandRender } from '../message/messageExpand'

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
  const now = useNow(250)
  const [expanded, setExpanded] = useState(false)
  const shouldRenderBody = useMessageExpandRender(expanded)

  /**
   * 距下次重试的剩余毫秒。
   *
   * **单位假设**：v2 的 `SessionStatus.retry.next` 按「绝对时间戳（ms）」使用，
   * 因此这里算 `next - now`。客户端类型只写了 `next: number`，没有任何注释
   * 说明单位，我用真实服务端验证不了——所以加了一道上限保护：
   * 若结果超过 10 分钟，说明大概率不是时间戳（例如服务端给的是「延迟毫秒数」），
   * 此时宁可不显示倒计时，也不显示一个荒谬的数字（比如 "1758000000.0s"）。
   */
  const MAX_SANE_REMAINING_MS = 10 * 60 * 1000

  const remainingMs = useMemo(() => {
    if (!Number.isFinite(status.next)) return null
    const diff = status.next - now
    if (diff > MAX_SANE_REMAINING_MS) return null
    return diff
  }, [status.next, now])

  const nextLabel = remainingMs !== null && remainingMs > 0 ? formatRemaining(remainingMs) : null
  const hasMessage = Boolean(status.message?.trim())

  return (
    <div className="my-2 px-3 py-2 rounded-lg border border-warning-100/20 bg-warning-100/10">
      {hasMessage ? (
        <button
          type="button"
          className="flex w-full items-center gap-2 min-w-0 text-left cursor-pointer"
          onClick={() => setExpanded(prev => !prev)}
        >
          <RetryIcon className="w-4 h-4 text-warning-100 flex-shrink-0" />
          <span className="text-[length:var(--fs-base)] text-warning-100 flex-1 min-w-0 truncate">
            {t('retryStatus.retrying', { attempt: status.attempt })}
            {nextLabel && (
              <span className="text-[length:var(--fs-sm)] text-text-400 ml-2 tabular-nums">
                {t('retryStatus.nextIn', { label: nextLabel })}
              </span>
            )}
          </span>
          <ChevronDownIcon className={chevronClass(expanded)} />
        </button>
      ) : (
        <div className="flex items-center gap-2 min-w-0">
          <RetryIcon className="w-4 h-4 text-warning-100 flex-shrink-0" />
          <span className="text-[length:var(--fs-base)] text-warning-100 flex-1 min-w-0 truncate">
            {t('retryStatus.retrying', { attempt: status.attempt })}
            {nextLabel && (
              <span className="text-[length:var(--fs-sm)] text-text-400 ml-2 tabular-nums">
                {t('retryStatus.nextIn', { label: nextLabel })}
              </span>
            )}
          </span>
        </div>
      )}

      {hasMessage && (
        <MessageExpandPanel open={expanded} variant="fade" innerClassName="overflow-hidden">
          {shouldRenderBody && (
            <div className="mt-2 pt-2 border-t border-warning-100/20">
              <p className="text-[length:var(--fs-sm)] text-text-300 font-mono whitespace-pre-wrap break-words overflow-x-hidden">
                {status.message}
              </p>
            </div>
          )}
        </MessageExpandPanel>
      )}
    </div>
  )
})
