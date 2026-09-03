import { useCallback, useEffect, useRef, useState } from 'react'

// Copied from FolderRecentList for queue-bar scope (extract to shared later).

interface ReorderState {
  draggedId: string
  currentOrder: string[]
}

interface UseReorderableListOptions {
  ids: string[]
  canDrag: (id: string) => boolean
  onCommit: (draggedId: string, targetId: string) => void
  onDragActivated?: () => void
  onDragFinished?: () => void
}

export function useReorderableList({ ids, canDrag, onCommit, onDragActivated, onDragFinished }: UseReorderableListOptions) {
  const refs = useRef<Map<string, HTMLDivElement>>(new Map())
  const [dragState, setDragState] = useState<ReorderState | null>(null)
  const dragStartY = useRef(0)
  const dragActive = useRef(false)
  const latestOrderRef = useRef<string[]>([])
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const touchMovedRef = useRef(false)
  const touchStartYRef = useRef(0)
  const touchDragIdRef = useRef<string | null>(null)

  const displayOrder = dragState?.currentOrder ?? ids
  const draggedId = dragState?.draggedId ?? null

  const calcNewOrder = useCallback((dragId: string, pointerY: number, baseOrder: string[]) => {
    const items: { id: string; centerY: number }[] = []

    for (const id of baseOrder) {
      if (id === dragId) continue
      const element = refs.current.get(id)
      if (!element) continue
      const rect = element.getBoundingClientRect()
      items.push({ id, centerY: rect.top + rect.height / 2 })
    }

    let insertIndex = items.length
    for (let i = 0; i < items.length; i++) {
      if (pointerY < items[i].centerY) {
        insertIndex = i
        break
      }
    }

    const withoutDragged = items.map(item => item.id)
    withoutDragged.splice(insertIndex, 0, dragId)
    return withoutDragged
  }, [])

  const finishDrag = useCallback(
    (draggedId: string, originalOrder: string[]) => {
      const finalOrder = latestOrderRef.current
      const originalIdx = originalOrder.indexOf(draggedId)
      const newIdx = finalOrder.indexOf(draggedId)

      if (originalIdx !== -1 && newIdx !== -1 && originalIdx !== newIdx) {
        const targetId = originalOrder[newIdx]
        if (targetId) onCommit(draggedId, targetId)
      }

      setDragState(null)
      dragActive.current = false
      latestOrderRef.current = []
      onDragFinished?.()
    },
    [onCommit, onDragFinished],
  )

  const handlePointerStart = useCallback(
    (id: string, event: React.PointerEvent) => {
      if (!canDrag(id)) return

      event.preventDefault()
      event.stopPropagation()
      dragStartY.current = event.clientY
      dragActive.current = false

      const currentOrder = [...ids]

      const onMove = (moveEvent: PointerEvent) => {
        const dy = Math.abs(moveEvent.clientY - dragStartY.current)

        if (!dragActive.current) {
          if (dy < 4) return
          dragActive.current = true
          onDragActivated?.()
          document.body.style.cursor = 'grabbing'
          document.body.style.userSelect = 'none'
          setDragState({ draggedId: id, currentOrder })
        }

        const newOrder = calcNewOrder(id, moveEvent.clientY, currentOrder)
        latestOrderRef.current = newOrder
        setDragState(prev => (prev ? { ...prev, currentOrder: newOrder } : null))
      }

      const onUp = () => {
        document.removeEventListener('pointermove', onMove)
        document.removeEventListener('pointerup', onUp)
        document.removeEventListener('pointercancel', onUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''

        if (dragActive.current) finishDrag(id, currentOrder)

        dragActive.current = false
      }

      document.addEventListener('pointermove', onMove)
      document.addEventListener('pointerup', onUp)
      document.addEventListener('pointercancel', onUp)
    },
    [calcNewOrder, canDrag, finishDrag, ids, onDragActivated],
  )

  const handleTouchStart = useCallback(
    (id: string, event: React.TouchEvent) => {
      if (!canDrag(id)) return

      touchMovedRef.current = false
      touchStartYRef.current = event.touches[0].clientY
      touchDragIdRef.current = null

      longPressTimer.current = setTimeout(() => {
        if (!touchMovedRef.current) {
          touchDragIdRef.current = id
          dragActive.current = true
          onDragActivated?.()
          const currentOrder = [...ids]
          latestOrderRef.current = currentOrder
          setDragState({ draggedId: id, currentOrder })
        }
      }, 400)
    },
    [canDrag, ids, onDragActivated],
  )

  const handleTouchMove = useCallback(
    (event: React.TouchEvent) => {
      const dy = Math.abs(event.touches[0].clientY - touchStartYRef.current)
      if (dy > 8) touchMovedRef.current = true

      if (longPressTimer.current && touchMovedRef.current && !touchDragIdRef.current) {
        clearTimeout(longPressTimer.current)
        longPressTimer.current = null
      }

      if (!touchDragIdRef.current) return

      event.stopPropagation()
      const touchY = event.touches[0].clientY
      const currentOrder = [...ids]
      const newOrder = calcNewOrder(touchDragIdRef.current, touchY, currentOrder)
      latestOrderRef.current = newOrder
      setDragState(prev => (prev ? { ...prev, currentOrder: newOrder } : null))
    },
    [calcNewOrder, ids],
  )

  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }

    const dragId = touchDragIdRef.current
    if (dragId) {
      finishDrag(dragId, [...ids])
    }

    touchDragIdRef.current = null
  }, [finishDrag, ids])

  useEffect(() => {
    return () => {
      if (longPressTimer.current) clearTimeout(longPressTimer.current)
    }
  }, [])

  return {
    draggedId,
    isDragging: !!dragState,
    displayOrder,
    handlePointerStart,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    registerRef: (id: string, element: HTMLDivElement | null) => {
      if (element) refs.current.set(id, element)
      else refs.current.delete(id)
    },
  }
}
