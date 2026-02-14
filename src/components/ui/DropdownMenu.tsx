import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

type DropdownPosition = 'top' | 'bottom'
type DropdownAlign = 'left' | 'right'

interface DropdownMenuProps {
  triggerRef: React.RefObject<HTMLElement | null>
  isOpen: boolean
  position?: DropdownPosition
  align?: DropdownAlign
  width?: number | string
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
  className = '',
  children,
}: DropdownMenuProps) {
  const [shouldRender, setShouldRender] = useState(isOpen)
  const [isVisible, setIsVisible] = useState(false)
  const [style, setStyle] = useState<React.CSSProperties>({})

  // Handle animation lifecycle
  useEffect(() => {
    if (isOpen) {
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

  // Calculate position
  useEffect(() => {
    if (shouldRender && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      const gap = 8
      const newStyle: React.CSSProperties = {}

      if (position === 'top') {
        newStyle.bottom = window.innerHeight - rect.top + gap
      } else {
        newStyle.top = rect.bottom + gap
      }

      if (align === 'right') {
        newStyle.right = window.innerWidth - rect.right
      } else {
        newStyle.left = rect.left
      }

      setStyle(newStyle)
    }
  }, [shouldRender, triggerRef, position, align])

  if (!shouldRender) return null

  return createPortal(
    <div
      className="fixed z-[100]"
      style={style}
      onMouseDown={(e) => {
        // 只在虚拟键盘已打开时才阻止焦点转移
        const vp = window.visualViewport
        const keyboardOpen = vp ? (window.innerHeight - vp.height) > 100 : false
        if (keyboardOpen) {
          e.preventDefault()
        }
      }}
    >
      <div
        className={`
          p-1 bg-bg-000 border border-border-200/50 backdrop-blur-xl rounded-xl shadow-xl
          transition-all duration-200 cubic-bezier(0.34, 1.15, 0.64, 1)
          ${isVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}
          ${className}
        `}
        style={{ 
          width: width || 'auto',
          minWidth: '200px',
          maxWidth: 'min(320px, 90vw)',
          transformOrigin: position === 'top' ? 'bottom' : 'top'
        }}
      >
        {children}
      </div>
    </div>,
    document.body
  )
}
