import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { RetryIcon, ChevronDownIcon } from '../../../components/Icons'
import { useDisclosureScrollLock } from '../../../hooks'
import type { SessionMessageAssistant, SessionMessageCompaction } from '@opencode/client/promise'
import { useUiDisclosureState } from '../../../utils/uiDisclosureState'
import { unwrapErrorMessage } from '../../../utils/errorMessage'
import { chevronClass, MessageExpandPanel, useMessageExpandRender } from '../messageExpand'

// ============================================
// Retry Part View - 显示重试状态
// ============================================

/**
 * v2 的重试信息挂在**助手消息**上（`message.retry`），不是独立 part：
 * `{ attempt, at, error: { type, message, status?, response? } }`
 */
export type RetryInfo = NonNullable<SessionMessageAssistant['retry']>

interface RetryPartViewProps {
  retry: RetryInfo
  /** 展开状态 key（同一消息多次重试时区分） */
  stateKey?: string
}

/** 429/5xx 这类瞬时错误视为可重试（v2 错误里没有 isRetryable 字段） */
function isRetryableStatus(error: RetryInfo['error']): boolean {
  return error.status == null || error.status === 429 || error.status >= 500
}

export const RetryPartView = memo(function RetryPartView({ retry, stateKey }: RetryPartViewProps) {
  const { t } = useTranslation('message')
  const [expanded, setExpanded] = useUiDisclosureState(stateKey ?? 'message:retry', false)
  const shouldRenderBody = useMessageExpandRender(expanded)
  const { rootRef, headerRef, withScrollLock } = useDisclosureScrollLock()
  const { attempt, error, at } = retry

  const timeStr = new Date(at).toLocaleTimeString()
  const isRetryable = isRetryableStatus(error)

  return (
    <div ref={rootRef} className="px-3 py-2 rounded-md bg-warning-100/10 border border-warning-100/20">
      <button
        type="button"
        ref={headerRef}
        onClick={() => withScrollLock(() => setExpanded(!expanded))}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 bg-transparent border-none p-0 text-left"
      >
        <RetryIcon className="w-4 h-4 text-warning-100 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-[length:var(--fs-base)] text-warning-100">{t('system.retryAttempt', { attempt })}</span>
          <span className="text-[length:var(--fs-sm)] text-text-500 ml-2">{timeStr}</span>
        </div>
        {isRetryable && (
          <span className="text-[length:var(--fs-xxs)] text-warning-100/70 bg-warning-100/10 px-1.5 py-0.5 rounded">
            {t('system.retryable')}
          </span>
        )}
        <ChevronDownIcon className={chevronClass(expanded)} />
      </button>

      <MessageExpandPanel open={expanded} variant="fade" innerClassName="overflow-hidden">
        {shouldRenderBody && (
          <div className="mt-2 pt-2 border-t border-warning-100/20">
            <p className="text-[length:var(--fs-sm)] text-text-300 font-mono whitespace-pre-wrap break-words overflow-x-hidden">
              {unwrapErrorMessage(error.message)}
            </p>
            {error.status != null && (
              <p className="text-[length:var(--fs-xxs)] text-text-500 mt-1">
                {t('system.statusCode', { code: error.status })}
              </p>
            )}
          </div>
        )}
      </MessageExpandPanel>
    </div>
  )
})

// ============================================
// Compaction Message View - 显示上下文压缩
// ============================================
//
// v2 的压缩是**独立消息**（`{ type:'compaction', status, summary, ... }`），
// 不是挂在用户消息上的 part。

interface CompactionPartViewProps {
  /** 原生压缩消息（`status` / `summary` / `tokens` …）；当前 UI 只画分隔线 */
  message: SessionMessageCompaction
}

export const CompactionPartView = memo(function CompactionPartView({ message }: CompactionPartViewProps) {
  const { t } = useTranslation('message')
  void message

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-[length:var(--fs-sm)] text-text-500">
      <span className="flex-1 h-px bg-border-200/70" />
      <span className="shrink-0 text-[length:var(--fs-xs)] leading-none text-text-400">
        {t('system.contextCompacted')}
      </span>
      <span className="flex-1 h-px bg-border-200/70" />
    </div>
  )
})
