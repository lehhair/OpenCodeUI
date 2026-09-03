import { memo, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { SendIcon, ClockIcon, CloseIcon, PencilIcon, GripVerticalIcon } from '../../../components/Icons'
import { usePresence } from '../../../hooks'
import type { QueuedFollowupDraft } from '../../../store/followupQueueStore'
import { useReorderableList } from './useReorderableList'

// ============================================
// QueuedMessagesBar — 输入框上方的排队消息预览条
// 宽度与输入框一致，每条消息独立一行，文本溢出截断 + hover 展示全文
// 支持拖拽排序（桌面 grip pointer / 手机整行长按）
// ============================================

interface QueuedMessagesBarProps {
  items: QueuedFollowupDraft[]
  failedId?: string
  sendingId?: string
  onRemove: (id: string) => void
  onCancelFailed: (id: string) => void
  onSendNow: (id: string) => void
  onRevert: (id: string) => void
  onReorder: (draggedId: string, targetId: string) => void
}

/** 多行文本压缩为单行，供 title tooltip 使用 */
function tooltipText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

const QueuedMessageRow = memo(function QueuedMessageRow({
  item,
  isFailed,
  isSending,
  canDrag,
  isDragged,
  onRemove,
  onCancelFailed,
  onSendNow,
  onRevert,
  onDragStart,
  onTouchDragStart,
  registerRef,
}: {
  item: QueuedFollowupDraft
  isFailed: boolean
  isSending: boolean
  canDrag: boolean
  isDragged: boolean
  onRemove: (id: string) => void
  onCancelFailed: (id: string) => void
  onSendNow: (id: string) => void
  onRevert: (id: string) => void
  onDragStart: (e: React.PointerEvent) => void
  onTouchDragStart: (e: React.TouchEvent) => void
  registerRef: (el: HTMLDivElement | null) => void
}) {
  const { t } = useTranslation('chat')
  const { shouldRender, ref: presenceRef } = usePresence<HTMLDivElement>(true, {
    from: { opacity: 0, transform: 'translateY(-4px)' },
    to: { opacity: 1, transform: 'translateY(0)' },
    duration: 0.2,
  })

  const setRowRef = useCallback(
    (el: HTMLDivElement | null) => {
      presenceRef.current = el
      registerRef(el)
    },
    [presenceRef, registerRef],
  )

  const handleRemove = useCallback(() => onRemove(item.id), [item.id, onRemove])
  const handleCancelFailed = useCallback(() => onCancelFailed(item.id), [item.id, onCancelFailed])
  const handleSendNow = useCallback(() => onSendNow(item.id), [item.id, onSendNow])
  const handleRevert = useCallback(() => onRevert(item.id), [item.id, onRevert])
  const fullText = tooltipText(item.text)

  if (!shouldRender) return null

  return (
    <div
      ref={setRowRef}
      data-state={isFailed ? 'failed' : isSending ? 'sending' : 'pending'}
      onTouchStart={canDrag ? onTouchDragStart : undefined}
      className={`
        flex items-center gap-2 w-full px-3 py-1.5 text-[length:var(--fs-sm)]
        transition-colors select-none
        ${isDragged
          ? 'z-10 relative shadow-lg shadow-black/20 ring-1 ring-inset ring-accent-main-100/30 bg-bg-100'
          : ''
        }
        ${isFailed
          ? 'bg-danger-100/8 text-danger-100'
          : isSending
            ? 'bg-accent-main-100/8 text-text-200'
            : isDragged
              ? 'text-text-200'
              : 'hover:bg-bg-000/30 text-text-200'
        }
      `}
    >
      {/* 拖拽把手 — 仅可排序时显示；桌面 pointer 拖，手机走整行长按 */}
      {canDrag && (
        <span
          data-drag-handle
          onPointerDown={onDragStart}
          className="shrink-0 flex items-center justify-center -ml-1 p-0.5 cursor-grab active:cursor-grabbing text-text-500 opacity-50 hover:opacity-100 touch-none"
          title={t('queuedMessages.reorder')}
          aria-label={t('queuedMessages.reorder')}
        >
          <GripVerticalIcon size={14} />
        </span>
      )}

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

      {/* 编辑/撤回按钮（排队中和失败均可编辑，发送中不可） */}
      {!isSending && (
        <button
          type="button"
          onClick={handleRevert}
          className="shrink-0 p-1 rounded hover:bg-accent-main-100/15 text-text-400 hover:text-accent-main-100 transition-colors"
          aria-label={t('queuedMessages.revert')}
        >
          <PencilIcon size={14} />
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
  onRevert,
  onReorder,
}: QueuedMessagesBarProps) {
  const ids = useMemo(() => items.map(item => item.id), [items])
  const itemById = useMemo(() => {
    const map = new Map<string, QueuedFollowupDraft>()
    for (const item of items) map.set(item.id, item)
    return map
  }, [items])

  const canDragId = useCallback(
    (id: string) => {
      if (items.length < 2) return false
      if (sendingId && id === sendingId) return false
      return true
    },
    [items.length, sendingId],
  )

  const {
    draggedId,
    displayOrder,
    handlePointerStart,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    registerRef,
  } = useReorderableList({
    ids,
    canDrag: canDragId,
    onCommit: onReorder,
  })

  if (items.length === 0) return null

  return (
    <div
      className="flex flex-col gap-px w-full glass border border-border-200/60 rounded-lg shadow-lg overflow-hidden"
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {displayOrder.map(id => {
        const item = itemById.get(id)
        if (!item) return null
        return (
          <QueuedMessageRow
            key={item.id}
            item={item}
            isFailed={item.id === failedId}
            isSending={item.id === sendingId}
            canDrag={canDragId(item.id)}
            isDragged={item.id === draggedId}
            onRemove={onRemove}
            onCancelFailed={onCancelFailed}
            onSendNow={onSendNow}
            onRevert={onRevert}
            onDragStart={e => handlePointerStart(item.id, e)}
            onTouchDragStart={e => handleTouchStart(item.id, e)}
            registerRef={el => registerRef(item.id, el)}
          />
        )
      })}
    </div>
  )
})
