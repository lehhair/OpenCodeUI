import { memo, useCallback, useState, useRef, type ReactNode, type WheelEvent as ReactWheelEvent } from 'react'
import { CloseIcon } from './Icons'
import { getMaterialIconUrl } from '../utils/materialIcons'

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

  const handleDragEnd = useCallback(() => {
    if (draggedId && dragOverId && draggedId !== dragOverId) {
      onReorder(draggedId, dragOverId)
    }
    setDraggedId(null)
    setDragOverId(null)
  }, [draggedId, dragOverId, onReorder])

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
                draggable
                onDragStart={event => {
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData('text/plain', item.id)
                  setDraggedId(item.id)
                  setDragOverId(null)
                }}
                onDragOver={event => {
                  event.preventDefault()
                  if (draggedId && draggedId !== item.id) {
                    setDragOverId(item.id)
                  }
                }}
                onDrop={event => {
                  event.preventDefault()
                  if (draggedId && draggedId !== item.id) {
                    setDragOverId(item.id)
                  }
                }}
                onDragEnd={handleDragEnd}
                className={
                  isActive
                    ? `tab-active relative z-10 flex h-full ${tabWidthClassName} shrink-0 items-center gap-1 bg-bg-100 text-text-100`
                    : `relative flex h-full ${tabWidthClassName} shrink-0 items-center gap-1 overflow-hidden bg-transparent text-text-400 mx-px hover:bg-bg-100/60 hover:text-text-200 ${isDragOver ? 'bg-accent-main-100/8' : ''}`
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
                  onDragStart={event => event.stopPropagation()}
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
