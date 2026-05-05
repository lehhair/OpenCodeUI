import { memo, useState, useCallback, useRef, useLayoutEffect, useEffect } from 'react'
import { useInputCapabilities } from '../../hooks/useInputCapabilities'

const ANIMATION_EASE = 'ease-[cubic-bezier(0.25,1,0.5,1)]'
const ANIMATION_DURATION = 'duration-300'

interface ResizablePanelProps {
  position: 'right' | 'bottom'
  isOpen: boolean
  overlay?: boolean
  size: number
  minSize?: number
  maxSize?: number
  onSizeChange: (size: number) => void
  onClose: () => void
  children: React.ReactNode
  className?: string
}

export const ResizablePanel = memo(function ResizablePanel({
  position,
  isOpen,
  overlay = false,
  size,
  minSize = 300,
  maxSize = 800,
  onSizeChange,
  onClose,
  children,
  className = '',
}: ResizablePanelProps) {
  const { preferTouchUi, hasCoarsePointer, hasTouch } = useInputCapabilities()
  const touchCapable = preferTouchUi || hasCoarsePointer || hasTouch
  const [isResizing, setIsResizing] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number>(0)
  const currentSizeRef = useRef(size)
  const isResizingRef = useRef(isResizing)
  const viewportHeight = typeof window === 'undefined' ? 800 : window.innerHeight
  const effectiveMaxSize =
    position === 'bottom' ? Math.min(maxSize, Math.floor(viewportHeight * (touchCapable ? 0.62 : 0.56))) : maxSize
  const effectiveSize = Math.min(Math.max(size, minSize), effectiveMaxSize)

  const pointerHandlersRef = useRef<{
    move: ((e: PointerEvent) => void) | null
    up: (() => void) | null
  }>({ move: null, up: null })
  const touchHandlersRef = useRef<{
    move: ((e: TouchEvent) => void) | null
    end: (() => void) | null
  }>({ move: null, end: null })

  useEffect(() => {
    isResizingRef.current = isResizing
  }, [isResizing])

  useLayoutEffect(() => {
    if (overlay || !panelRef.current) return
    if (isResizingRef.current) return

    if (position === 'right') {
      panelRef.current.style.width = isOpen ? `${effectiveSize}px` : '0px'
    } else {
      panelRef.current.style.height = isOpen ? `${effectiveSize}px` : '0px'
    }
    currentSizeRef.current = effectiveSize
  }, [effectiveSize, overlay, isOpen, position])

  const startResizing = useCallback(
    (e: React.PointerEvent) => {
      if (!e.isPrimary) return
      if (e.pointerType === 'mouse' && e.button !== 0) return
      e.preventDefault()

      const panel = panelRef.current
      const content = contentRef.current
      if (!panel || !content) return

      setIsResizing(true)
      document.body.style.cursor = position === 'right' ? 'col-resize' : 'row-resize'
      document.body.style.userSelect = 'none'

      window.dispatchEvent(new CustomEvent('panel-resize-start'))

      const startX = e.clientX
      const startY = e.clientY
      const startSize = currentSizeRef.current

      const handlePointerMove = (moveEvent: PointerEvent) => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current)

        rafRef.current = requestAnimationFrame(() => {
          const delta = position === 'right' ? startX - moveEvent.clientX : startY - moveEvent.clientY
          const nextSize = Math.min(Math.max(startSize + delta, minSize), effectiveMaxSize)

          if (position === 'right') {
            panel.style.width = `${nextSize}px`
          } else {
            panel.style.height = `${nextSize}px`
          }
          currentSizeRef.current = nextSize
        })
      }

      const handlePointerUp = () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current)

        if (content) {
          window.dispatchEvent(new CustomEvent('panel-resize-end'))
        }

        setIsResizing(false)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        document.removeEventListener('pointermove', handlePointerMove)
        document.removeEventListener('pointerup', handlePointerUp)
        document.removeEventListener('pointercancel', handlePointerUp)
        pointerHandlersRef.current = { move: null, up: null }

        onSizeChange(currentSizeRef.current)
      }

      pointerHandlersRef.current = { move: handlePointerMove, up: handlePointerUp }

      document.addEventListener('pointermove', handlePointerMove)
      document.addEventListener('pointerup', handlePointerUp)
      document.addEventListener('pointercancel', handlePointerUp)
    },
    [position, minSize, effectiveMaxSize, onSizeChange],
  )

  const handleTouchResizeStart = useCallback(
    (e: React.TouchEvent) => {
      if (position !== 'bottom') return
      const panel = panelRef.current
      if (!panel) return

      setIsResizing(true)
      const startY = e.touches[0].clientY
      const startHeight = panel.getBoundingClientRect().height

      const handleTouchMove = (moveEvent: TouchEvent) => {
        const touchY = moveEvent.touches[0].clientY
        const deltaY = startY - touchY
        const nextHeight = Math.min(Math.max(startHeight + deltaY, minSize), Math.max(minSize, effectiveMaxSize))
        panel.style.height = `${nextHeight}px`
        currentSizeRef.current = nextHeight
      }

      const handleTouchEnd = () => {
        setIsResizing(false)
        window.dispatchEvent(new CustomEvent('panel-resize-end'))
        document.removeEventListener('touchmove', handleTouchMove)
        document.removeEventListener('touchend', handleTouchEnd)
        touchHandlersRef.current = { move: null, end: null }
        onSizeChange(currentSizeRef.current)
      }

      touchHandlersRef.current = { move: handleTouchMove, end: handleTouchEnd }

      document.addEventListener('touchmove', handleTouchMove, { passive: false })
      document.addEventListener('touchend', handleTouchEnd)
    },
    [position, minSize, effectiveMaxSize, onSizeChange],
  )

  useEffect(() => {
    return () => {
      const { move: pointerMove, up: pointerUp } = pointerHandlersRef.current
      if (pointerMove) document.removeEventListener('pointermove', pointerMove)
      if (pointerUp) {
        document.removeEventListener('pointerup', pointerUp)
        document.removeEventListener('pointercancel', pointerUp)
      }

      const { move: touchMove, end: touchEnd } = touchHandlersRef.current
      if (touchMove) document.removeEventListener('touchmove', touchMove)
      if (touchEnd) document.removeEventListener('touchend', touchEnd)

      if (rafRef.current) cancelAnimationFrame(rafRef.current)

      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [])

  const containerClass = `flex flex-col bg-bg-100 overflow-hidden min-w-0 ${className}`

  if (overlay) {
    const transformClass =
      position === 'right'
        ? isOpen
          ? 'translate-x-0'
          : 'translate-x-full'
        : isOpen
          ? 'translate-y-0'
          : 'translate-y-full'

    const mobileBaseClass =
      position === 'right'
        ? 'fixed left-0 right-0 z-[100] w-full bg-bg-100'
        : 'fixed bottom-0 left-0 right-0 z-[100] h-[40vh] shadow-lg rounded-t-xl border-t border-border-200 bg-bg-100'

    const mobileInsetStyle =
      position === 'right'
        ? ({
            top: 'calc(var(--safe-area-inset-top, 0px) + var(--desktop-titlebar-height, 0px))',
            height: 'calc(100% - var(--safe-area-inset-top, 0px) - var(--desktop-titlebar-height, 0px))',
          } as React.CSSProperties)
        : ({} as React.CSSProperties)

    return (
      <>
        <div
          className={`
            fixed left-0 right-0 bg-[hsl(var(--always-black)/0.5)] z-[99]
            transition-opacity ${ANIMATION_DURATION} ease-out
            ${isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}
          `}
          style={position === 'right' ? { top: 'calc(var(--safe-area-inset-top, 0px) + var(--desktop-titlebar-height, 0px))', left: 0, right: 0, bottom: 0 } : undefined}
          onClick={onClose}
        />

        <div
          ref={panelRef}
          className={`
            ${containerClass} ${mobileBaseClass}
            transition-transform ${ANIMATION_DURATION} ${ANIMATION_EASE}
            ${transformClass}
          `}
          style={mobileInsetStyle}
        >
          {position === 'bottom' && (
            <div
              className="w-full flex items-center justify-center pt-2 pb-1 cursor-ns-resize touch-none bg-bg-100 shrink-0"
              onTouchStart={handleTouchResizeStart}
            >
              <div className="w-10 h-1 rounded-full bg-border-300 opacity-50" />
            </div>
          )}

          <div ref={contentRef} className="flex-1 flex flex-col min-h-0 min-w-0 w-full h-full relative bg-bg-100 pb-[var(--safe-area-inset-bottom)]">
            {children}
          </div>
        </div>
      </>
    )
  }

  const transitionProp = position === 'right' ? 'transition-[width]' : 'transition-[height]'
  const transitionClass = isResizing ? 'transition-none' : `${transitionProp} ${ANIMATION_DURATION} ${ANIMATION_EASE}`
  const desktopLayoutClass =
    position === 'right'
      ? `relative h-full min-w-0 ${isOpen ? 'border-l border-border-200/50' : ''}`
      : `relative w-full ${isOpen ? 'border-t border-border-200/50' : ''}`
  const activeSizeStyle =
    position === 'right' ? { width: isOpen ? `${effectiveSize}px` : 0 } : { height: isOpen ? `${effectiveSize}px` : 0 }

  return (
    <div
      ref={panelRef}
      style={activeSizeStyle}
      className={`${containerClass} ${desktopLayoutClass} ${transitionClass}`}
    >
      {position === 'right' ? (
        <div
          className={`absolute top-0 left-0 bottom-0 ${touchCapable ? 'w-4 touch-none' : 'w-1'} cursor-col-resize z-50 bg-transparent`}
          onPointerDown={startResizing}
        >
          <div
            aria-hidden="true"
            className={`absolute top-0 bottom-0 left-0 transition-colors ${touchCapable ? 'w-1 rounded-full' : 'w-full'} ${
              isResizing ? 'bg-accent-main-100' : 'bg-transparent hover:bg-accent-main-100/50'
            }`}
          />
        </div>
      ) : (
        <div
          className={`absolute top-0 left-0 right-0 ${touchCapable ? 'h-4 touch-none' : 'h-1'} cursor-row-resize z-50 bg-transparent`}
          onPointerDown={startResizing}
        >
          <div
            aria-hidden="true"
            className={`absolute top-0 left-0 right-0 transition-colors ${touchCapable ? 'h-1 rounded-full' : 'h-full'} ${
              isResizing ? 'bg-accent-main-100' : 'bg-transparent hover:bg-accent-main-100/50'
            }`}
          />
        </div>
      )}

      {isResizing && <div className="absolute inset-0 z-40 bg-transparent pointer-events-auto" />}

      <div ref={contentRef} className="absolute inset-0 flex flex-col min-h-0 min-w-0 w-full h-full pb-[var(--safe-area-inset-bottom)]">
        {children}
      </div>
    </div>
  )
})
