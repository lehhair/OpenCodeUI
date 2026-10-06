// ============================================
// QueueBubbles — 下轮队列（delivery='queue'）的聊天气泡视图
//
// 气泡样式参照 PiUI ChatArea 的 QueuedUserMessageQueue（虚线边框表示尚未投递）：
//   rounded-2xl border border-dashed border-border-200 bg-bg-300/60 px-4 py-2.5
// 位置对齐 PiUI：融在消息流尾部（ChatArea 虚拟行之后、重试提示之前），
// 由 ChatArea 包在 w-full maxWidthClass mx-auto paddingClass 里。
//
// 只列 queue 组（官方 queue.ts:80-84 同款过滤）：steer（插队）条目的回声
// 由 projectQueueEchoes 留在转写末尾展示，不在此重复；
// queue 条目的回转写回声则由同一投影隐藏——气泡是它唯一的展示位。
//
// 悬浮操作行对齐用户消息 action bar：复制 / 插队 / 撤回编辑 / 删除。
// ============================================

import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUpIcon, CloseIcon, PencilIcon, TrashIcon } from '../../components/Icons'
import { CopyButton } from '../../components/ui'
import { queuedPromptText, type QueuedUserPrompt } from '../../store/inboxStore'

interface QueueBubblesProps {
  /** 下轮队列条目（delivery='queue'，等当前回合结束后由服务端投递） */
  items: QueuedUserPrompt[]
  /** 插队：改为注入当前回合（官方 queue.steer 的 inbox.update 同款） */
  onSteer?: (item: QueuedUserPrompt) => void
  /** 撤回编辑：从队列移除并把文本回填输入框 */
  onEdit?: (item: QueuedUserPrompt) => void
  /** 从队列删除 */
  onRemove?: (item: QueuedUserPrompt) => void
  /** 正在编辑的条目 id：该条目高亮且「撤回编辑」变为「取消编辑」 */
  editingId?: string
}

const ACTION_BTN_CLASS =
  'p-1.5 rounded-md text-text-400 hover:text-text-200 hover:bg-bg-200/50 transition-colors'

export const QueueBubbles = memo(function QueueBubbles({ items, onSteer, onEdit, onRemove, editingId }: QueueBubblesProps) {
  const { t } = useTranslation('chat')
  if (items.length === 0) return null

  const label = t('queue.queuedLabel', { count: items.length })
  return (
    <section data-message-queue="queued" aria-label={label} className="w-full pt-3 pb-2">
      <div className="flex items-center gap-3 pb-3 text-[length:var(--fs-sm)] text-text-500" role="status">
        <span className="h-px flex-1 bg-border-200" aria-hidden="true" />
        <span className="shrink-0">{label}</span>
        <span className="h-px flex-1 bg-border-200" aria-hidden="true" />
      </div>
      <div className="flex flex-col items-end gap-2">
        {items.map(item => {
          const text = queuedPromptText(item)
          const isEditing = item.id === editingId
          return (
            <div key={item.id} className="group/msg flex flex-col items-end gap-1 max-w-[85%]">
              {/* 气泡：虚线边框表示尚未投递；编辑中的条目 accent 高亮 */}
              <div
                className={`whitespace-pre-wrap break-words rounded-2xl border border-dashed px-4 py-2.5 text-[length:var(--fs-base)] leading-relaxed text-text-200 ${
                  isEditing ? 'border-accent-main-100 bg-accent-main-100/10' : 'border-border-200 bg-bg-300/60'
                }`}
              >
                {text}
              </div>
              {/* 操作行：气泡下方（对齐用户消息 action bar） */}
              {(onSteer || onEdit || onRemove) && (
                <div className="flex items-center gap-0.5 px-1 opacity-0 group-hover/msg:opacity-100 group-focus-within/msg:opacity-100 transition-opacity">
                  <CopyButton text={text} position="static" />
                  {onRemove && (
                    <button
                      type="button"
                      onClick={() => onRemove(item)}
                      title={t('queue.cancelTitle')}
                      aria-label={t('queue.cancelTitle')}
                      className={ACTION_BTN_CLASS}
                    >
                      <TrashIcon size={14} />
                    </button>
                  )}
                  {onSteer && (
                    <button
                      type="button"
                      onClick={() => onSteer(item)}
                      title={t('queue.moveToSteering')}
                      aria-label={t('queue.moveToSteering')}
                      className={ACTION_BTN_CLASS}
                    >
                      <ArrowUpIcon size={14} />
                    </button>
                  )}
                  {onEdit && (
                    <button
                      type="button"
                      onClick={() => onEdit(item)}
                      title={isEditing ? t('queue.editCancel') : t('queue.edit')}
                      aria-label={isEditing ? t('queue.editCancel') : t('queue.edit')}
                      className={ACTION_BTN_CLASS}
                    >
                      {isEditing ? <CloseIcon size={14} /> : <PencilIcon size={14} />}
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
})
