import { memo, useState, useCallback, useRef, useLayoutEffect, useEffect } from 'react'
import { useIsMobile } from '../../hooks'

// 统一的动画配置 (与 Sidebar 保持一致)
const ANIMATION_EASE = 'ease-[cubic-bezier(0.25,1,0.5,1)]'
const ANIMATION_DURATION = 'duration-300'

interface ResizablePanelProps {
  position: 'right' | 'bottom'
  isOpen: boolean
  size: number // width for right, height for bottom
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
  size,
  minSize = 300,
  maxSize = 800,
  onSizeChange,
  onClose,
  children,
  className = '',
}: ResizablePanelProps) {
  const isMobile = useIsMobile()
  const [isResizing, setIsResizing] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number>(0)
  const currentSizeRef = useRef(size)
  // 保存事件处理函数引用，以便在组件卸载时清理
  const mouseHandlersRef = useRef<{
    move: ((e: MouseEvent) => void) | null
    up: (() => void) | null
  }>({ move: null, up: null })
  const touchHandlersRef = useRef<{
    move: ((e: TouchEvent) => void) | null
    end: (() => void) | null
  }>({ move: null, end: null })

  // 同步 size 到 ref 和 CSS 变量
  useLayoutEffect(() => {
    if (isMobile || !panelRef.current) return
    
    // 不要在 resize 过程中响应 size prop 变化（虽然通常 resize 时 prop 不会变）
    // 也不要响应 isResizing 的变化（防止 resize 结束时用旧 prop 覆盖新 DOM）
    if (isResizing) return

    const cssVar = position === 'right' ? '--panel-width' : '--panel-height'
    panelRef.current.style.setProperty(cssVar, `${size}px`)
    currentSizeRef.current = size
  }, [size, isMobile, position]) // 移除 isResizing 依赖

  // Desktop Resize 逻辑
  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    
    const panel = panelRef.current
    const content = contentRef.current
    if (!panel || !content) return
    
    setIsResizing(true)
    const cursor = position === 'right' ? 'col-resize' : 'row-resize'
    document.body.style.cursor = cursor
    document.body.style.userSelect = 'none'
    
    // 性能优化：Resize 时隐藏内容或暂停重绘 (可选，目前使用 display:none 在 contentRef 上)
    // 之前我们是 display:none content，这样虽然性能好但体验一般（内容消失）
    // Sidebar 是实时渲染的。为了"跟 Sidebar 一样"，我们可以尝试不隐藏内容，
    // 但如果内容太重（Terminal），可能会卡。
    // 这里我们保留 "resize-start" 事件，让子组件自己决定是否隐藏
    window.dispatchEvent(new CustomEvent('panel-resize-start'))
    
    // 暂时保持 display: none 以确保流畅度，如果需要实时预览可以去掉
    // content.style.display = 'none'
    
    const startX = e.clientX
    const startY = e.clientY
    const startSize = currentSizeRef.current
    
    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      
      rafRef.current = requestAnimationFrame(() => {
        let delta = 0
        if (position === 'right') {
          // 右侧面板，往左拖动是增加宽度
          delta = startX - moveEvent.clientX
        } else {
          // 底部面板，往上拖动是增加高度
          delta = startY - moveEvent.clientY
        }
        
        const newSize = Math.min(Math.max(startSize + delta, minSize), maxSize)
        const cssVar = position === 'right' ? '--panel-width' : '--panel-height'
        panel.style.setProperty(cssVar, `${newSize}px`)
        currentSizeRef.current = newSize
      })
    }
    
    const handleMouseUp = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      
      if (content) {
        // content.style.display = ''
        window.dispatchEvent(new CustomEvent('panel-resize-end'))
      }
      
      setIsResizing(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      // 清空 ref
      mouseHandlersRef.current = { move: null, up: null }
      
      onSizeChange(currentSizeRef.current)
    }
    
    // 保存到 ref 以便清理
    mouseHandlersRef.current = { move: handleMouseMove, up: handleMouseUp }
    
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [position, minSize, maxSize, onSizeChange])

  // Mobile Touch Resize (仅 BottomPanel)
  const handleTouchResizeStart = useCallback((e: React.TouchEvent) => {
    if (position !== 'bottom') return
    const panel = panelRef.current
    if (!panel) return
    
    setIsResizing(true)
    const startY = e.touches[0].clientY
    const startHeight = panel.getBoundingClientRect().height
    
    const handleTouchMove = (moveEvent: TouchEvent) => {
       // moveEvent.preventDefault() // 视情况开启
       const touchY = moveEvent.touches[0].clientY
       const deltaY = startY - touchY
       const newHeight = Math.min(Math.max(startHeight + deltaY, 200), window.innerHeight * 0.9)
       
       panel.style.height = `${newHeight}px`
       currentSizeRef.current = newHeight
    }
    
    const handleTouchEnd = () => {
       setIsResizing(false)
       window.dispatchEvent(new CustomEvent('panel-resize-end'))
       document.removeEventListener('touchmove', handleTouchMove)
       document.removeEventListener('touchend', handleTouchEnd)
       // 清空 ref
       touchHandlersRef.current = { move: null, end: null }
       onSizeChange(currentSizeRef.current)
    }

    // 保存到 ref 以便清理
    touchHandlersRef.current = { move: handleTouchMove, end: handleTouchEnd }

    document.addEventListener('touchmove', handleTouchMove, { passive: false })
    document.addEventListener('touchend', handleTouchEnd)
  }, [position, onSizeChange])

  // 组件卸载时清理可能残留的事件监听器
  useEffect(() => {
    return () => {
      // 清理 mouse handlers
      const { move: mouseMove, up: mouseUp } = mouseHandlersRef.current
      if (mouseMove) document.removeEventListener('mousemove', mouseMove)
      if (mouseUp) document.removeEventListener('mouseup', mouseUp)
      
      // 清理 touch handlers
      const { move: touchMove, end: touchEnd } = touchHandlersRef.current
      if (touchMove) document.removeEventListener('touchmove', touchMove)
      if (touchEnd) document.removeEventListener('touchend', touchEnd)
      
      // 清理 raf
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      
      // 恢复 body 样式
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [])

  // ============================================
  // Styles
  // ============================================

  // 通用容器样式
  const containerClass = `
    flex flex-col bg-bg-100 overflow-hidden
    ${className}
  `

  // Mobile Styles
  if (isMobile) {
    // Transform 状态
    const transformClass = position === 'right'
      ? (isOpen ? 'translate-x-0' : 'translate-x-full')
      : (isOpen ? 'translate-y-0' : 'translate-y-full')
      
    const mobileBaseClass = position === 'right'
      ? 'fixed inset-0 z-[100] w-full shadow-2xl'
      : 'fixed bottom-0 left-0 right-0 z-[100] h-[40vh] shadow-2xl rounded-t-xl border-t border-border-200'

    return (
      <>
        {/* Mobile Backdrop */}
        <div 
          className={`
            fixed inset-0 bg-black/50 z-[99] 
            transition-opacity ${ANIMATION_DURATION} ease-out
            ${isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}
          `}
          onClick={onClose}
        />

        <div
          ref={panelRef}
          className={`
            ${containerClass} ${mobileBaseClass}
            transition-transform ${ANIMATION_DURATION} ${ANIMATION_EASE}
            ${transformClass}
          `}
        >
          {/* Mobile Handle (Bottom only) */}
          {position === 'bottom' && (
            <div 
              className="w-full flex items-center justify-center pt-2 pb-1 cursor-ns-resize touch-none bg-bg-100 shrink-0"
              onTouchStart={handleTouchResizeStart}
            >
               <div className="w-10 h-1 rounded-full bg-border-300 opacity-50" />
            </div>
          )}
          
          <div ref={contentRef} className="flex-1 flex flex-col min-h-0 w-full h-full relative">
            {children}
          </div>
        </div>
      </>
    )
  }

  // Desktop Styles
  const cssVar = position === 'right' ? '--panel-width' : '--panel-height'
  const sizeStyle = { [cssVar]: `${size}px` } as React.CSSProperties
  
  // Transition
  // Right: width change
  // Bottom: height change
  const transitionProp = position === 'right' ? 'transition-[width]' : 'transition-[height]'
  const transitionClass = isResizing ? 'transition-none' : `${transitionProp} ${ANIMATION_DURATION} ${ANIMATION_EASE}`
  
  // Layout
  // Right: relative h-full
  // Bottom: relative w-full
  const desktopLayoutClass = position === 'right'
    ? `relative h-full ${isOpen ? 'border-l border-border-200/50' : ''}`
    : `relative w-full ${isOpen ? 'border-t border-border-200/50' : ''}` // Bottom panel needs top border when open

  // Size control
  // Right: width: var(--panel-width) or 0
  // Bottom: height: var(--panel-height) or 0
  const activeSizeStyle = {
    ...sizeStyle,
    [position === 'right' ? 'width' : 'height']: isOpen ? `var(${cssVar})` : 0
  }

  return (
    <div
      ref={panelRef}
      style={activeSizeStyle}
      className={`${containerClass} ${desktopLayoutClass} ${transitionClass}`}
    >
      {/* Desktop Resize Handle */}
      {position === 'right' ? (
        <div
          className={`
            absolute top-0 left-0 bottom-0 w-1 cursor-col-resize z-50
            hover:bg-accent-main-100/50 transition-colors
            ${isResizing ? 'bg-accent-main-100' : 'bg-transparent'}
          `}
          onMouseDown={startResizing}
        />
      ) : (
        <div
          className={`
            absolute top-0 left-0 right-0 h-1 cursor-row-resize z-50
            hover:bg-accent-main-100/50 transition-colors -translate-y-1/2
            ${isResizing ? 'bg-accent-main-100' : 'bg-transparent'}
          `}
          onMouseDown={startResizing}
        />
      )}

      {/* Resize Overlay */}
      {isResizing && (
        <div className="absolute inset-0 z-40 bg-transparent pointer-events-auto" />
      )}

      {/* Content */}
      <div 
        ref={contentRef} 
        className={`
          absolute inset-0 flex flex-col min-h-0
          ${position === 'right' ? 'w-[var(--panel-width)]' : 'h-[var(--panel-height)]'}
        `}
      >
        {children}
      </div>
    </div>
  )
})
