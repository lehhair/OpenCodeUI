import {
  memo,
  useCallback,
  useEffect,
  useState,
  useRef,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import { CloseIcon } from './Icons'
import { getMaterialIconUrl } from '../utils/materialIcons'
import {
  getInternalDragSnapshot,
  startInternalDrag,
  subscribeInternalDrag,
  subscribeInternalDrop,
} from '../lib/internalDragCore'
import { useDragEdgeAutoScroll } from '../hooks/useDragEdgeAutoScroll'

export interface PreviewTabsBarItem {
  id: string
  title: string
  closeTitle: string
  iconPath?: string
  label: ReactNode
}

interface PreviewTabsBarProps {
  items: PreviewTabsBarItem[]
  activeId: string | null
  closeAllTitle: string
  onActivate: (id: string) => void
  onClose: (id: string) => void
  onCloseAll: () => void
  onReorder: (draggedId: string, targetId: string) => void
  rightActions?: ReactNode
  tabWidthClassName?: string
}

export const PreviewTabsBar = memo(function PreviewTabsBar({
  items,
  activeId,
  closeAllTitle,
  onActivate,
  onClose,
  onCloseAll,
  onReorder,
  rightActions,
  tabWidthClassName = 'w-40 max-w-40',
}: PreviewTabsBarProps) {
  const tabsScrollRef = useRef<HTMLDivElement>(null)
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  useDragEdgeAutoScroll(tabsScrollRef, {
    payloadKind: 'preview-tab',
  })

  useEffect(() => {
    return subscribeInternalDrag(() => {
      const active = getInternalDragSnapshot().active
      if (!active || active.payload.kind !== 'preview-tab') {
        setDraggedId(null)
        setDragOverId(null)
        return
      }

      setDraggedId(active.payload.id)
      const target = document
        .elementFromPoint(active.current.x, active.current.y)
        ?.closest<HTMLElement>('[data-preview-tab-id]')
      const targetId = target?.dataset.previewTabId
      setDragOverId(targetId && targetId !== active.payload.id ? targetId : null)
    })
  }, [])

  useEffect(() => {
    return subscribeInternalDrop(event => {
      if (event.payload.kind !== 'preview-tab') return
      const target = document
        .elementFromPoint(event.point.x, event.point.y)
        ?.closest<HTMLElement>('[data-preview-tab-id]')
      const targetId = target?.dataset.previewTabId
      if (targetId && targetId !== event.payload.id) {
        onReorder(event.payload.id, targetId)
      }
      setDraggedId(null)
      setDragOverId(null)
    })
  }, [onReorder])

  const handleTabsWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    const container = tabsScrollRef.current
    if (!container || container.scrollWidth <= container.clientWidth) return

    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
    if (delta === 0) return

    event.preventDefault()
    container.scrollLeft += delta
  }, [])

  return (
    <div className="relative flex items-center justify-between shrink-0 bg-bg-200/60 h-[30px]">
      <div
        ref={tabsScrollRef}
        onWheel={handleTabsWheel}
        className="min-w-0 flex-1 h-full overflow-x-auto overflow-y-hidden no-scrollbar"
      >
        <div className="flex min-w-max items-center h-full gap-0">
          {items.map(item => {
            const isActive = item.id === activeId
            const isDragOver = dragOverId === item.id && draggedId !== item.id

            return (
              <div
                key={item.id}
                data-preview-tab-id={item.id}
                onPointerDown={event => {
                  const target = event.target as HTMLElement
                  if (target.closest('button')) return
                  startInternalDrag(event, { kind: 'preview-tab', id: item.id })
                }}
                onMouseDown={event => {
                  if (event.button !== 1) return
                  event.preventDefault()
                  event.stopPropagation()
                  onClose(item.id)
                }}
                className={
                  isActive
                    ? `tab-active relative z-10 mx-px flex h-full ${tabWidthClassName} shrink-0 select-none items-center gap-1 bg-bg-100 text-text-100`
                    : `relative mx-px flex h-[24px] ${tabWidthClassName} shrink-0 select-none items-center gap-1 overflow-hidden rounded-md border-x-[5px] border-transparent bg-transparent text-text-400 hover:bg-bg-200/50 hover:text-text-100 transition-colors ${isDragOver ? 'bg-accent-main-100/8' : ''}`
                }
                title={item.title}
              >
                <button
                  type="button"
                  onClick={() => onActivate(item.id)}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 overflow-hidden pl-2.5 pr-1 text-left"
                >
                  {item.iconPath && (
                    <img
                      src={getMaterialIconUrl(item.iconPath, 'file')}
                      alt=""
                      width={13}
                      height={13}
                      draggable={false}
                      className="shrink-0"
                      onError={e => {
                        e.currentTarget.style.visibility = 'hidden'
                      }}
                    />
                  )}
                  {item.label}
                </button>
                <button
                  type="button"
                  onClick={event => {
                    event.stopPropagation()
                    onClose(item.id)
                  }}
                  className="mr-1.5 shrink-0 rounded p-1 text-text-500 hover:bg-bg-300 hover:text-text-100 transition-colors"
                  title={item.closeTitle}
                >
                  <CloseIcon size={10} />
                </button>
              </div>
            )
          })}
        </div>
      </div>

      <div className="flex items-center gap-0.5 shrink-0 px-1.5 h-full">
        {rightActions}
        <button
          onClick={onCloseAll}
          className="p-1 text-text-400 hover:text-text-100 hover:bg-bg-300/50 rounded transition-colors shrink-0"
          title={closeAllTitle}
        >
          <CloseIcon size={12} />
        </button>
      </div>
    </div>
  )
})
