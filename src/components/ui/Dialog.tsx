import { useEffect, useState, useRef, useCallback, useId } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { CloseIcon } from '../Icons'
import { useDelayedRender } from '../../hooks/useDelayedRender'

interface DialogProps {
  isOpen: boolean
  onClose: () => void
  title?: React.ReactNode
  ariaLabel?: string
  children: React.ReactNode
  width?: string | number
  className?: string
  showCloseButton?: boolean
  /** 跳过默认的 header 和 content 包裹，children 直接作为面板内容 */
  rawContent?: boolean
  /** 允许触摸设备点击遮罩关闭，默认关闭以避免误触 */
  allowTouchBackdropClose?: boolean
}

export function Dialog({
  isOpen,
  onClose,
  title,
  ariaLabel,
  children,
  width = 400,
  className = '',
  showCloseButton = true,
  rawContent = false,
  allowTouchBackdropClose = false,
}: DialogProps) {
  const { t } = useTranslation(['common'])
  // Animation state
  const [isVisible, setIsVisible] = useState(false)
  const shouldRender = useDelayedRender(isOpen, 200)
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const previousFocusedElementRef = useRef<HTMLElement | null>(null)
  const previousFocusedElementIdRef = useRef<string | null>(null)
  const restoreFocusTimerRef = useRef<number | null>(null)
  const handoffFocusTimerRef = useRef<number | null>(null)

  // 拖拽条区域 ref —— 下滑关闭只从这个区域开始
  const dragHandleRef = useRef<HTMLDivElement>(null)

  // 触摸下滑关闭手势（只从拖拽条开始）
  const touchStartY = useRef<number | null>(null)
  const touchStartX = useRef<number | null>(null)
  const dragOffsetY = useRef(0)
  const [dragY, setDragY] = useState(0)
  const isDragging = useRef(false)
  const [isDraggingActive, setIsDraggingActive] = useState(false)

  const focusFirstFocusable = useCallback((container: ParentNode) => {
    const focusable = container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )

    const target = focusable[0] ?? (container instanceof HTMLElement ? container : null)
    target?.focus()
  }, [])

  const restorePreviousFocus = useCallback(() => {
    const previousFocusedElement = previousFocusedElementRef.current
    if (previousFocusedElement && document.contains(previousFocusedElement)) {
      previousFocusedElement.focus()
      return
    }

    const previousFocusedElementId = previousFocusedElementIdRef.current
    if (!previousFocusedElementId) return

    const replacement = document.getElementById(previousFocusedElementId)
    replacement?.focus()
  }, [])

  const requestClose = useCallback(() => {
    onClose()
    if (handoffFocusTimerRef.current !== null) {
      clearTimeout(handoffFocusTimerRef.current)
    }
    handoffFocusTimerRef.current = window.setTimeout(() => {
      handoffFocusTimerRef.current = null
      const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'))
      const latestDialog = dialogs.at(-1)
      if (latestDialog && latestDialog !== dialogRef.current) {
        focusFirstFocusable(latestDialog)
      }
    }, 0)
    if (restoreFocusTimerRef.current !== null) {
      clearTimeout(restoreFocusTimerRef.current)
    }
    restoreFocusTimerRef.current = window.setTimeout(() => {
      restoreFocusTimerRef.current = null
      const activeDialog = document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]')
      if (activeDialog) {
        focusFirstFocusable(activeDialog)
        return
      }
      restorePreviousFocus()
    }, 200)
  }, [onClose, restorePreviousFocus, focusFirstFocusable])

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    // 只有从拖拽条区域开始的触摸才能触发下滑关闭
    const handle = dragHandleRef.current
    if (!handle || !handle.contains(e.target as Node)) return

    touchStartY.current = e.touches[0].clientY
    touchStartX.current = e.touches[0].clientX
    dragOffsetY.current = 0
    isDragging.current = false
    setIsDraggingActive(false)
  }, [])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (touchStartY.current === null || touchStartX.current === null) return

    const deltaY = e.touches[0].clientY - touchStartY.current
    const deltaX = Math.abs(e.touches[0].clientX - touchStartX.current)

    // 只在向下拖且垂直方向为主时触发
    if (deltaY > 10 && deltaY > deltaX) {
      isDragging.current = true
      setIsDraggingActive(true)
      dragOffsetY.current = deltaY
      setDragY(deltaY)
    }
  }, [])

  const handleTouchEnd = useCallback(() => {
    if (isDragging.current && dragOffsetY.current > 100) {
      // 下滑超过 100px，关闭
      requestClose()
    }
    touchStartY.current = null
    touchStartX.current = null
    dragOffsetY.current = 0
    isDragging.current = false
    setIsDraggingActive(false)
    setDragY(0)
  }, [requestClose])

  // 防止背景误触：
  // 1. 只有 pointerdown 和 click 都发生在背景上才关闭
  // 2. 触摸设备上不通过背景关闭（避免滚动/滑动时误触）
  const mouseDownOnBackdrop = useRef(false)
  const handleBackdropPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType === 'touch' && !allowTouchBackdropClose) return
      mouseDownOnBackdrop.current = e.target === e.currentTarget
    },
    [allowTouchBackdropClose],
  )
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget && mouseDownOnBackdrop.current) {
        requestClose()
      }
      mouseDownOnBackdrop.current = false
    },
    [requestClose],
  )

  const focusDialogContent = useCallback(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    focusFirstFocusable(dialog)
  }, [focusFirstFocusable])

  // Focus trap
  const handleFocusTrap = useCallback((e: KeyboardEvent) => {
    if (e.key !== 'Tab' || !dialogRef.current) return

    const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )
    if (focusable.length === 0) return

    const first = focusable[0]
    const last = focusable[focusable.length - 1]

    if (e.shiftKey) {
      if (document.activeElement === first || !dialogRef.current.contains(document.activeElement)) {
        e.preventDefault()
        last.focus()
      }
    } else {
      if (document.activeElement === last || !dialogRef.current.contains(document.activeElement)) {
        e.preventDefault()
        first.focus()
      }
    }
  }, [])

  useEffect(() => {
    let frameId: number | null = null

    if (shouldRender && isOpen) {
      frameId = requestAnimationFrame(() => {
        setIsVisible(true)
      })
    } else {
      frameId = requestAnimationFrame(() => {
        setIsVisible(false)
      })
    }

    return () => {
      if (frameId !== null) cancelAnimationFrame(frameId)
    }
  }, [shouldRender, isOpen])

  useEffect(() => {
    if (!isOpen) return

    if (restoreFocusTimerRef.current !== null) {
      clearTimeout(restoreFocusTimerRef.current)
      restoreFocusTimerRef.current = null
    }

    previousFocusedElementRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    previousFocusedElementIdRef.current = previousFocusedElementRef.current?.id || null

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        requestClose()
        return
      }
      handleFocusTrap(e)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, requestClose, handleFocusTrap])

  useEffect(() => {
    if (!isOpen || !isVisible) return

    focusDialogContent()
  }, [isOpen, isVisible, focusDialogContent])

  useEffect(() => {
    if (isOpen || shouldRender) return

    const timerId = window.setTimeout(() => {
      const activeDialog = document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]')
      if (activeDialog) {
        focusFirstFocusable(activeDialog)
        return
      }
      restorePreviousFocus()
    }, 0)

    return () => clearTimeout(timerId)
  }, [isOpen, shouldRender, restorePreviousFocus, focusFirstFocusable])

  useEffect(() => {
    return () => {
      if (restoreFocusTimerRef.current !== null) {
        clearTimeout(restoreFocusTimerRef.current)
      }
      if (handoffFocusTimerRef.current !== null) {
        clearTimeout(handoffFocusTimerRef.current)
      }
    }
  }, [])

  if (!shouldRender) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-0 transition-all duration-200 ease-out"
      style={{
        backgroundColor: isVisible ? 'hsl(var(--always-black) / 0.15)' : 'hsl(var(--always-black) / 0)',
      }}
      onPointerDown={handleBackdropPointerDown}
      onClick={handleBackdropClick}
    >
      {/* Dialog Panel */}
      <div
        ref={dialogRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className={`
          relative glass border border-border-200/60 rounded-xl shadow-lg 
          flex flex-col overflow-hidden
          ${isDraggingActive ? '' : 'transition-all duration-200 ease-out'}
          ${className}
        `}
        style={{
          width: typeof width === 'number' ? `${width}px` : width,
          maxWidth: '100%',
          opacity: isVisible ? (dragY > 0 ? Math.max(0.3, 1 - dragY / 300) : 1) : 0,
          transform: isVisible ? `scale(1) translateY(${dragY}px)` : 'scale(0.95) translateY(8px)',
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={!rawContent && title ? titleId : undefined}
        aria-label={rawContent ? ariaLabel || (typeof title === 'string' && title ? title : undefined) : ariaLabel}
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
      >
        {/* Drag Handle (mobile) - 触摸下滑关闭的唯一触发区域 */}
        <div
          ref={dragHandleRef}
          className="md:hidden flex justify-center pt-3 pb-2 shrink-0 cursor-grab active:cursor-grabbing"
        >
          <div className="w-10 h-1 rounded-full bg-bg-300" />
        </div>

        {rawContent ? (
          /* rawContent 模式：children 完全控制内容布局 */
          children
        ) : (
          <>
            {/* Header */}
            {(title || showCloseButton) && (
              <div className="flex items-center justify-between px-5 py-4 border-b border-border-100/50">
                <div id={title ? titleId : undefined} className="text-[length:var(--fs-heading-2)] font-semibold text-text-100">
                  {title}
                </div>
                {showCloseButton && (
                  <button
                    type="button"
                    onClick={requestClose}
                    aria-label={t('common:close')}
                    className="p-2 text-text-400 hover:text-text-200 hover:bg-bg-100 rounded-md transition-colors"
                    title={t('common:close')}
                  >
                    <CloseIcon size={18} />
                  </button>
                )}
              </div>
            )}

            {/* Content */}
            <div className="p-5 overflow-y-auto custom-scrollbar max-h-[80vh]">{children}</div>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
