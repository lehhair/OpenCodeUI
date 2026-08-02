import { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { SendIcon, ClockIcon, CloseIcon } from '../../../components/Icons'
import { usePresence } from '../../../hooks'
import type { QueuedFollowupDraft } from '../../../store/followupQueueStore'

// ============================================
// QueuedMessagesBar — 输入框上方的排队消息预览条
// 宽度与输入框一致，每条消息独立一行，文本溢出截断 + hover 展示全文
// ============================================

interface QueuedMessagesBarProps {
  items: QueuedFollowupDraft[]
  failedId?: string
  sendingId?: string
  onRemove: (id: string) => void
  onCancelFailed: (id: string) => void
  onSendNow: (id: string) => void
}

/** 多行文本压缩为单行，供 title tooltip 使用 */
function tooltipText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

const QueuedMessageRow = memo(function QueuedMessageRow({
  item,
  isFailed,
  isSending,
  onRemove,
  onCancelFailed,
  onSendNow,
}: {
  item: QueuedFollowupDraft
  isFailed: boolean
  isSending: boolean
  onRemove: (id: string) => void
  onCancelFailed: (id: string) => void
  onSendNow: (id: string) => void
}) {
  const { t } = useTranslation('chat')
  const { shouldRender, ref } = usePresence<HTMLDivElement>(true, {
    from: { opacity: 0, transform: 'translateY(-4px)' },
    to: { opacity: 1, transform: 'translateY(0)' },
    duration: 0.2,
  })

  const handleRemove = useCallback(() => onRemove(item.id), [item.id, onRemove])
  const handleCancelFailed = useCallback(() => onCancelFailed(item.id), [item.id, onCancelFailed])
  const handleSendNow = useCallback(() => onSendNow(item.id), [item.id, onSendNow])
  const fullText = tooltipText(item.text)

  if (!shouldRender) return null

  return (
    <div
      ref={ref}
      data-state={isFailed ? 'failed' : isSending ? 'sending' : 'pending'}
      className={`
        flex items-center gap-2 w-full px-3 py-1.5 text-[length:var(--fs-sm)]
        transition-colors
        ${isFailed
          ? 'bg-danger-100/8 text-danger-100'
          : isSending
            ? 'bg-accent-main-100/8 text-text-200'
            : 'hover:bg-bg-000/30 text-text-200'
        }
      `}
    >
      {/* 状态图标 */}
      <span className="shrink-0">
        {isSending ? (
          <span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-accent-main-100/30 border-t-accent-main-100 animate-spin" />
        ) : (
          <ClockIcon size={14} />
        )}
      </span>

      {/* 消息文本 — 溢出截断，hover 展示全文 */}
      <span
        className="flex-1 min-w-0 truncate"
        title={fullText}
      >
        {fullText}
      </span>

      {/* 附件标记 */}
      {item.attachments.length > 0 && (
        <span className="shrink-0 text-text-400 text-[length:var(--fs-xs)]">
          📎{item.attachments.length}
        </span>
      )}

      {/* agent 标记 */}
      {item.agent && (
        <span className="shrink-0 text-text-400 text-[length:var(--fs-xs)] bg-bg-300/50 rounded px-1">
          {item.agent}
        </span>
      )}

      {/* 失败标记 */}
      {isFailed && (
        <span className="shrink-0 text-danger-100 font-medium text-[length:var(--fs-xs)]">
          {t('queuedMessages.failed')}
        </span>
      )}

      {/* 立即发送按钮（仅排队中显示） */}
      {!isFailed && !isSending && (
        <button
          type="button"
          onClick={handleSendNow}
          className="shrink-0 p-1 rounded hover:bg-accent-main-100/15 text-text-400 hover:text-accent-main-100 transition-colors"
          aria-label={t('queuedMessages.sendNow')}
        >
          <SendIcon size={14} />
        </button>
      )}

      {/* 删除/放弃按钮 */}
      <button
        type="button"
        onClick={isFailed ? handleCancelFailed : handleRemove}
        className="shrink-0 p-1 rounded hover:bg-bg-300/50 transition-colors opacity-60 hover:opacity-100 -mr-1"
        aria-label={isFailed ? t('queuedMessages.cancelFailed') : t('queuedMessages.remove')}
      >
        <CloseIcon size={14} />
      </button>
    </div>
  )
})

export const QueuedMessagesBar = memo(function QueuedMessagesBar({
  items,
  failedId,
  sendingId,
  onRemove,
  onCancelFailed,
  onSendNow,
}: QueuedMessagesBarProps) {
  if (items.length === 0) return null

  return (
    <div className="flex flex-col gap-px w-full glass border border-border-200/60 rounded-lg shadow-lg overflow-hidden">
      {items.map(item => (
        <QueuedMessageRow
          key={item.id}
          item={item}
          isFailed={item.id === failedId}
          isSending={item.id === sendingId}
          onRemove={onRemove}
          onCancelFailed={onCancelFailed}
          onSendNow={onSendNow}
        />
      ))}
    </div>
  )
})
