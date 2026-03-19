import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  type TouchEvent as ReactTouchEvent,
} from 'react'

interface UseVerticalSplitResizeOptions {
  containerRef: RefObject<HTMLElement | null>
  primaryRef: RefObject<HTMLElement | null>
  cssVariableName: `--${string}`
  minPrimaryHeight: number
  minSecondaryHeight: number
  defaultPrimaryHeightRatio?: number
}

interface UseVerticalSplitResizeResult {
  splitHeight: number | null
  isResizing: boolean
  resetSplitHeight: () => void
  handleResizeStart: (event: ReactMouseEvent) => void
  handleTouchResizeStart: (event: ReactTouchEvent) => void
}

export function useVerticalSplitResize({
  containerRef,
  primaryRef,
  cssVariableName,
  minPrimaryHeight,
  minSecondaryHeight,
  defaultPrimaryHeightRatio = 0.4,
}: UseVerticalSplitResizeOptions): UseVerticalSplitResizeResult {
  const [splitHeight, setSplitHeight] = useState<number | null>(null)
  const [isResizing, setIsResizing] = useState(false)
  const rafRef = useRef<number>(0)
  const currentHeightRef = useRef<number | null>(null)

  useLayoutEffect(() => {
    if (!isResizing && primaryRef.current && splitHeight !== null) {
      primaryRef.current.style.setProperty(cssVariableName, `${splitHeight}px`)
      currentHeightRef.current = splitHeight
    }
  }, [cssVariableName, isResizing, primaryRef, splitHeight])

  useEffect(() => {
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
      }
    }
  }, [])

  const resetSplitHeight = useCallback(() => {
    setSplitHeight(null)
    currentHeightRef.current = null
  }, [])

  const applyHeight = useCallback(
    (containerHeight: number, startHeight: number, startY: number, currentY: number) => {
      const primaryEl = primaryRef.current
      if (!primaryEl) return

      const deltaY = currentY - startY
      const nextHeight = startHeight + deltaY
      const maxHeight = containerHeight - minSecondaryHeight
      const clampedHeight = Math.min(Math.max(nextHeight, minPrimaryHeight), maxHeight)

      primaryEl.style.setProperty(cssVariableName, `${clampedHeight}px`)
      currentHeightRef.current = clampedHeight
    },
    [cssVariableName, minPrimaryHeight, minSecondaryHeight, primaryRef],
  )

  const finishResize = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
    }

    setIsResizing(false)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''

    if (currentHeightRef.current !== null) {
      setSplitHeight(currentHeightRef.current)
    }
  }, [])

  const handleResizeStart = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault()

      const container = containerRef.current
      if (!container || !primaryRef.current) return

      setIsResizing(true)

      const containerRect = container.getBoundingClientRect()
      const startY = event.clientY
      const startHeight = currentHeightRef.current ?? containerRect.height * defaultPrimaryHeightRatio

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (rafRef.current) {
          cancelAnimationFrame(rafRef.current)
        }

        rafRef.current = requestAnimationFrame(() => {
          applyHeight(containerRect.height, startHeight, startY, moveEvent.clientY)
        })
      }

      const handleMouseUp = () => {
        finishResize()
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }

      document.body.style.cursor = 'row-resize'
      document.body.style.userSelect = 'none'
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    },
    [applyHeight, containerRef, defaultPrimaryHeightRatio, finishResize, primaryRef],
  )

  const handleTouchResizeStart = useCallback(
    (event: ReactTouchEvent) => {
      const container = containerRef.current
      if (!container || !primaryRef.current) return

      setIsResizing(true)

      const containerRect = container.getBoundingClientRect()
      const startY = event.touches[0].clientY
      const startHeight = currentHeightRef.current ?? containerRect.height * defaultPrimaryHeightRatio

      const handleTouchMove = (moveEvent: TouchEvent) => {
        moveEvent.preventDefault()
        if (rafRef.current) {
          cancelAnimationFrame(rafRef.current)
        }

        rafRef.current = requestAnimationFrame(() => {
          applyHeight(containerRect.height, startHeight, startY, moveEvent.touches[0].clientY)
        })
      }

      const handleTouchEnd = () => {
        finishResize()
        document.removeEventListener('touchmove', handleTouchMove)
        document.removeEventListener('touchend', handleTouchEnd)
      }

      document.addEventListener('touchmove', handleTouchMove, { passive: false })
      document.addEventListener('touchend', handleTouchEnd)
    },
    [applyHeight, containerRef, defaultPrimaryHeightRatio, finishResize, primaryRef],
  )

  return {
    splitHeight,
    isResizing,
    resetSplitHeight,
    handleResizeStart,
    handleTouchResizeStart,
  }
}
