import { useEffect, useState, useRef } from 'react'
import { createPortal } from 'react-dom'

type DropdownPosition = 'top' | 'bottom'
type DropdownAlign = 'left' | 'right'

interface DropdownMenuProps {
  triggerRef: React.RefObject<HTMLElement | null>
  isOpen: boolean
  position?: DropdownPosition
  align?: DropdownAlign
  width?: number | string
  minWidth?: number | string
  maxWidth?: number | string
  /** 移动端（<640px）全宽展开，左右留 gap 间距 */
  mobileFullWidth?: boolean
  className?: string
  children: React.ReactNode
}

/**
 * Dropdown menu that renders via portal to avoid overflow clipping
 * Supports animation and auto-width
 */
export function DropdownMenu({
  triggerRef,
  isOpen,
  position = 'bottom',
  align = 'left',
  width,
  minWidth = '200px',
  maxWidth = 'min(320px, 90vw)',
  mobileFullWidth = false,
  className = '',
  children,
}: DropdownMenuProps) {
  const [shouldRender, setShouldRender] = useState(isOpen)
  const [isVisible, setIsVisible] = useState(false)
  const [style, setStyle] = useState<React.CSSProperties>({})

  // 根据 trigger 位置计算 dropdown 定位
  const calcStyle = () => {
    if (!triggerRef.current) return {}
    const rect = triggerRef.current.getBoundingClientRect()
    const gap = 8
    const isMobile = mobileFullWidth && window.innerWidth < 640
    const s: React.CSSProperties = {}

    if (position === 'top') {
      s.bottom = window.innerHeight - rect.top + gap
    } else {
      s.top = rect.bottom + gap
    }

    if (isMobile) {
      s.left = 12
      s.right = 12
    } else if (align === 'right') {
      s.right = window.innerWidth - rect.right
    } else {
      s.left = rect.left
    }
    return s
  }

  // Handle animation lifecycle — 打开时同步算好初始位置再渲染
  useEffect(() => {
    if (isOpen) {
      styleRef.current = calcStyle()
      setStyle(styleRef.current)
      setShouldRender(true)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setIsVisible(true))
      })
    } else {
      setIsVisible(false)
      const timer = setTimeout(() => setShouldRender(false), 200)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  // 打开期间持续跟踪位置（键盘弹起/收起、窗口 resize 等）
  const styleRef = useRef<React.CSSProperties>({})
  useEffect(() => {
    if (!shouldRender) return

    let rafId: number
    const tick = () => {
      const newStyle = calcStyle()

      const prev = styleRef.current
      if (prev.top !== newStyle.top || prev.bottom !== newStyle.bottom
        || prev.left !== newStyle.left || prev.right !== newStyle.right) {
        styleRef.current = newStyle
        setStyle(newStyle)
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)

    return () => cancelAnimationFrame(rafId)
  }, [shouldRender, triggerRef, position, align, mobileFullWidth])

  if (!shouldRender) return null

  // 移动端全宽模式下，宽度由外层 left/right 决定
  const isMobileMode = mobileFullWidth && typeof window !== 'undefined' && window.innerWidth < 640
  
  return createPortal(
    <div
      className="fixed z-[100]"
      style={style}
    >
      <div
        className={`
          p-1 bg-bg-000 border border-border-200/50 backdrop-blur-xl rounded-xl shadow-xl
          transition-all duration-200 cubic-bezier(0.34, 1.15, 0.64, 1)
          ${isVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}
          ${className}
        `}
        style={{ 
          width: isMobileMode ? 'auto' : (width || 'auto'),
          minWidth: isMobileMode ? undefined : minWidth,
          maxWidth: isMobileMode ? undefined : maxWidth,
          transformOrigin: position === 'top' ? 'bottom' : 'top'
        }}
      >
        {children}
      </div>
    </div>,
    document.body
  )
}
