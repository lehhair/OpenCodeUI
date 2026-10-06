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
// 悬浮操作行对齐用户消息 action bar：拖拽把手 / 复制 / 插队 / 撤回编辑 / 删除。
// 拖拽重排（官方 queue-panel.tsx 同款语义）：4px 距离阈值起步、垂直约束、
// 落点 = 指针越过的条目中线；松手后交给 queue.reorder（后缀重写保序）。
// ============================================

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUpIcon, CloseIcon, GripVerticalIcon, PencilIcon, TrashIcon } from '../../components/Icons'
import { CopyButton } from '../../components/ui'
import { queuedPromptText, type QueuedUserPrompt } from '../../store/inboxStore'
import { projectQueueItems, type QueueMutation } from './queueProjection'

interface QueueBubblesProps {
  /** 下轮队列条目（delivery='queue'，等当前回合结束后由服务端投递） */
  items: QueuedUserPrompt[]
  /** 插队：改为注入当前回合（官方 queue.steer 的 inbox.update 同款） */
  onSteer?: (item: QueuedUserPrompt) => void
  /** 撤回编辑：装载条目内容到输入框（官方 queue.edit 的 stash 同款） */
  onEdit?: (item: QueuedUserPrompt) => void
  /** 从队列删除 */
  onRemove?: (item: QueuedUserPrompt) => void
  /** 拖拽重排：按新顺序提交 id 列表（官方 queue.reorder 同款） */
  onReorder?: (ids: string[]) => void
  /** 正在编辑的条目 id：该条目高亮且「撤回编辑」变为「取消编辑」 */
  editingId?: string
  /** 队列 mutation 投影（编辑/重排期间显示期望形态，官方 rows() 同款） */
  mutation?: QueueMutation | null
}

const ACTION_BTN_CLASS =
  'p-1.5 rounded-md text-text-400 hover:text-text-200 hover:bg-bg-200/50 transition-colors'

/** 官方 PointerActivationConstraints.Distance({ value: 4 }) 同款：4px 内不算拖拽 */
const DRAG_THRESHOLD = 4

/**
 * 由条目矩形与指针 Y 计算拖拽目标下标（官方 arrayMove 落点同款：
 * 指针越过条目中线即进入下一槽位）。
 */
export function computeDragTargetIndex(rects: Array<{ top: number; height: number }>, pointerY: number): number {
  if (rects.length === 0) return 0
  for (let index = 0; index < rects.length; index++) {
    const rect = rects[index]
    if (pointerY < rect.top + rect.height / 2) return index
  }
  return rects.length - 1
}

/** arrayMove 等价物：把 from 处的元素移动到 to 处 */
export function arrayMoveId<T>(list: T[], from: number, to: number): T[] {
  const next = list.slice()
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

export const QueueBubbles = memo(function QueueBubbles({
  items,
  onSteer,
  onEdit,
  onRemove,
  onReorder,
  editingId,
  mutation,
}: QueueBubblesProps) {
  const { t } = useTranslation('chat')
  const listRef = useRef<HTMLDivElement>(null)
  // 拖拽会话：起点条目 + 起点 Y；过了阈值才进入拖拽（显示插入指示线）
  const dragRef = useRef<{ id: string; startY: number; active: boolean } | null>(null)
  const [dragTarget, setDragTarget] = useState<number | null>(null)

  // mutation 投影（官方 rows() 同款）：编辑/重排期间显示期望形态，
  // 服务端 admit/cancel 事件落地时不抖（数量/位置/文本都稳）
  const rows = useMemo(() => projectQueueItems(items, mutation ?? null), [items, mutation])

  const cancelDrag = useCallback(() => {
    dragRef.current = null
    setDragTarget(null)
  }, [])

  // 指针事件挂在 window 上：拖拽期间指针可以离开把手/列表
  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current
      if (!drag || !onReorder) return
      if (!drag.active) {
        if (Math.abs(event.clientY - drag.startY) < DRAG_THRESHOLD) return
        drag.active = true
      }
      const list = listRef.current
      if (!list) return
      const rects = [...list.querySelectorAll('[data-queue-item]')].map(el => {
        const rect = el.getBoundingClientRect()
        return { top: rect.top, height: rect.height }
      })
      const index = computeDragTargetIndex(rects, event.clientY)
      setDragTarget(prev => (prev === index ? prev : index))
    }
    const onUp = () => {
      const drag = dragRef.current
      if (!drag) return
      const target = dragTarget
      cancelDrag()
      if (!drag.active || target === null || !onReorder) return
      const ids = items.map(item => item.id)
      const from = ids.indexOf(drag.id)
      if (from === -1 || from === target) return
      onReorder(arrayMoveId(ids, from, target))
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    // items/dragTarget 每次渲染都是新值，事件回调里用最新闭包即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  })

  const startDrag = useCallback(
    (id: string) => (event: React.PointerEvent) => {
      if (!onReorder || event.button !== 0) return
      event.preventDefault()
      dragRef.current = { id, startY: event.clientY, active: false }
    },
    [onReorder],
  )

  if (rows.length === 0) return null

  const label = t('queue.queuedLabel', { count: rows.length })
  return (
    <section data-message-queue="queued" aria-label={label} className="w-full pt-3 pb-2">
      <div className="flex items-center gap-3 pb-3 text-[length:var(--fs-sm)] text-text-500" role="status">
        <span className="h-px flex-1 bg-border-200" aria-hidden="true" />
        <span className="shrink-0">{label}</span>
        <span className="h-px flex-1 bg-border-200" aria-hidden="true" />
      </div>
      <div ref={listRef} className="flex flex-col items-end gap-2">
        {rows.map(({ item }, index) => {
          const text = queuedPromptText(item)
          const isEditing = item.id === editingId
          const showInsertion = dragTarget !== null && dragTarget === index && dragRef.current?.active
          return (
            <div key={item.id} data-queue-item className="group/msg flex flex-col items-end gap-1 max-w-[85%]">
              {/* 插入指示线：拖拽指针越过该条目中线时显示在其上方 */}
              {showInsertion && <div className="w-full h-0.5 rounded bg-accent-main-100" aria-hidden="true" />}
              {/* 气泡：虚线边框表示尚未投递；编辑中的条目 accent 高亮 */}
              <div
                className={`whitespace-pre-wrap break-words rounded-2xl border border-dashed px-4 py-2.5 text-[length:var(--fs-base)] leading-relaxed text-text-200 ${
                  isEditing ? 'border-accent-main-100 bg-accent-main-100/10' : 'border-border-200 bg-bg-300/60'
                }`}
              >
                {text}
              </div>
              {/* 操作行：气泡下方（对齐用户消息 action bar） */}
              {(onSteer || onEdit || onRemove || onReorder) && (
                <div className="flex items-center gap-0.5 px-1 opacity-0 group-hover/msg:opacity-100 group-focus-within/msg:opacity-100 transition-opacity">
                  {onReorder && items.length > 1 && (
                    <button
                      type="button"
                      onPointerDown={startDrag(item.id)}
                      title={t('queue.dragReorder')}
                      aria-label={t('queue.dragReorder')}
                      className={`${ACTION_BTN_CLASS} cursor-grab active:cursor-grabbing touch-none`}
                    >
                      <GripVerticalIcon size={14} />
                    </button>
                  )}
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
