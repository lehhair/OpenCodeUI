import { useEffect, useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { CloseIcon } from '../Icons'

interface DialogProps {
  isOpen: boolean
  onClose: () => void
  title?: React.ReactNode
  children: React.ReactNode
  width?: string | number
  className?: string
  showCloseButton?: boolean
  /** 跳过默认的 header 和 content 包裹，children 直接作为面板内容 */
  rawContent?: boolean
}

export function Dialog({
  isOpen,
  onClose,
  title,
  children,
  width = 400,
  className = '',
  showCloseButton = true,
  rawContent = false,
}: DialogProps) {
  // Animation state
  const [shouldRender, setShouldRender] = useState(false)
  const [isVisible, setIsVisible] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)

  // 拖拽条区域 ref —— 下滑关闭只从这个区域开始
  const dragHandleRef = useRef<HTMLDivElement>(null)

  // 触摸下滑关闭手势（只从拖拽条开始）
  const touchStartY = useRef<number | null>(null)
  const touchStartX = useRef<number | null>(null)
  const dragOffsetY = useRef(0)
  const [dragY, setDragY] = useState(0)
  const isDragging = useRef(false)

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    // 只有从拖拽条区域开始的触摸才能触发下滑关闭
    const handle = dragHandleRef.current
    if (!handle || !handle.contains(e.target as Node)) return

    touchStartY.current = e.touches[0].clientY
    touchStartX.current = e.touches[0].clientX
    dragOffsetY.current = 0
    isDragging.current = false
  }, [])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (touchStartY.current === null || touchStartX.current === null) return
    
    const deltaY = e.touches[0].clientY - touchStartY.current
    const deltaX = Math.abs(e.touches[0].clientX - touchStartX.current)
    
    // 只在向下拖且垂直方向为主时触发
    if (deltaY > 10 && deltaY > deltaX) {
      isDragging.current = true
      dragOffsetY.current = deltaY
      setDragY(deltaY)
    }
  }, [])

  const handleTouchEnd = useCallback(() => {
    if (isDragging.current && dragOffsetY.current > 100) {
      // 下滑超过 100px，关闭
      onClose()
    }
    touchStartY.current = null
    touchStartX.current = null
    dragOffsetY.current = 0
    isDragging.current = false
    setDragY(0)
  }, [onClose])

  // 防止背景误触：
  // 1. 只有 pointerdown 和 click 都发生在背景上才关闭
  // 2. 触摸设备上不通过背景关闭（避免滚动/滑动时误触）
  const mouseDownOnBackdrop = useRef(false)
  const handleBackdropPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'touch') return // 触摸设备不走背景关闭
    mouseDownOnBackdrop.current = e.target === e.currentTarget
  }, [])
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget && mouseDownOnBackdrop.current) {
      onClose()
    }
    mouseDownOnBackdrop.current = false
  }, [onClose])

  // Focus trap
  const handleFocusTrap = useCallback((e: KeyboardEvent) => {
    if (e.key !== 'Tab' || !dialogRef.current) return
    
    const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
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

  // Mount/Unmount logic
  useEffect(() => {
    if (isOpen) {
      setShouldRender(true)
    } else {
      setIsVisible(false)
      const timer = setTimeout(() => setShouldRender(false), 200)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  // Visibility logic
  useEffect(() => {
    if (shouldRender && isOpen) {
      // Small delay to ensure DOM is ready and transition triggers
      const timer = setTimeout(() => setIsVisible(true), 10)
      return () => clearTimeout(timer)
    }
  }, [shouldRender, isOpen])

  useEffect(() => {
    if (!isOpen) return
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      handleFocusTrap(e)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose, handleFocusTrap])

  if (!shouldRender) return null

  return createPortal(
    <div 
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-0 transition-all duration-200 ease-out"
      style={{
        backgroundColor: isVisible ? 'hsl(var(--always-black) / 0.4)' : 'hsl(var(--always-black) / 0)',
        backdropFilter: isVisible ? 'blur(2px)' : 'blur(0px)',
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
          relative bg-bg-000 border border-border-200 rounded-xl shadow-2xl 
          flex flex-col overflow-hidden
          ${isDragging.current ? '' : 'transition-all duration-200 ease-out'}
          ${className}
        `}
        style={{ 
          width: typeof width === 'number' ? `${width}px` : width, 
          maxWidth: '100%',
          opacity: isVisible ? (dragY > 0 ? Math.max(0.3, 1 - dragY / 300) : 1) : 0,
          transform: isVisible 
            ? `scale(1) translateY(${dragY}px)` 
            : 'scale(0.95) translateY(8px)',
        }}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
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
                <div className="text-lg font-semibold text-text-100">{title}</div>
                {showCloseButton && (
                  <button 
                    onClick={onClose}
                    className="p-2 text-text-400 hover:text-text-200 hover:bg-bg-100 rounded-md transition-colors"
                  >
                    <CloseIcon size={18} />
                  </button>
                )}
              </div>
            )}
            
            {/* Content */}
            <div className="p-5 overflow-y-auto custom-scrollbar max-h-[80vh]">
              {children}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  )
}
