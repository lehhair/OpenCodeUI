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
  /** 约束菜单在此容器的边界内（宽度 ≤ 容器 65%，不溢出左右） */
  constrainToRef?: React.RefObject<HTMLElement | null>
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
  constrainToRef,
  className = '',
  children,
}: DropdownMenuProps) {
  const [shouldRender, setShouldRender] = useState(isOpen)
  const [isVisible, setIsVisible] = useState(false)
  const [posStyle, setPosStyle] = useState<React.CSSProperties>({})
  const [sizeStyle, setSizeStyle] = useState<React.CSSProperties>({})

  // 根据 trigger 位置计算 dropdown 定位
  const calcStyles = () => {
    if (!triggerRef.current) return { pos: {}, size: {} }
    const rect = triggerRef.current.getBoundingClientRect()
    const gap = 8
    const pos: React.CSSProperties = {}
    const size: React.CSSProperties = {}

    // --- 垂直定位 ---
    if (position === 'top') {
      pos.bottom = window.innerHeight - rect.top + gap
    } else {
      pos.top = rect.bottom + gap
    }

    // --- 水平定位 + 宽度 ---
    // constrainToRef 优先级最高
    if (constrainToRef?.current) {
      const cRect = constrainToRef.current.getBoundingClientRect()
      // 按钮中点相对容器位置，决定对齐方向
      const btnCenter = (rect.left + rect.right) / 2
      const containerCenter = (cRect.left + cRect.right) / 2

      if (btnCenter > containerCenter) {
        // 按钮偏右 → 右对齐，maxWidth = 按钮右边缘到容器左边缘
        pos.right = window.innerWidth - rect.right
        size.maxWidth = rect.right - cRect.left
        size.transformOrigin = position === 'top' ? 'bottom right' : 'top right'
      } else {
        // 按钮偏左 → 左对齐，maxWidth = 容器右边缘到按钮左边缘
        pos.left = rect.left
        size.maxWidth = cRect.right - rect.left
        size.transformOrigin = position === 'top' ? 'bottom left' : 'top left'
      }
    } else if (mobileFullWidth && window.innerWidth < 640) {
      // 移动端全宽（无 constrainToRef 时的 fallback）
      pos.left = 12
      pos.right = 12
      size.transformOrigin = position === 'top' ? 'bottom' : 'top'
    } else {
      // 普通模式
      if (align === 'right') {
        pos.right = window.innerWidth - rect.right
      } else {
        pos.left = rect.left
      }
      size.width = width || 'auto'
      size.minWidth = minWidth
      size.maxWidth = maxWidth
      size.transformOrigin = position === 'top' ? 'bottom' : 'top'
    }

    return { pos, size }
  }

  // Handle animation lifecycle
  useEffect(() => {
    if (isOpen) {
      const { pos, size } = calcStyles()
      posRef.current = pos
      setPosStyle(pos)
      setSizeStyle(size)
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

  // 打开期间持续跟踪位置
  const posRef = useRef<React.CSSProperties>({})
  useEffect(() => {
    if (!shouldRender) return

    let rafId: number
    const tick = () => {
      const { pos, size } = calcStyles()

      const prev = posRef.current
      if (prev.top !== pos.top || prev.bottom !== pos.bottom
        || prev.left !== pos.left || prev.right !== pos.right) {
        posRef.current = pos
        setPosStyle(pos)
        setSizeStyle(size)
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)

    return () => cancelAnimationFrame(rafId)
  }, [shouldRender, triggerRef, position, align, mobileFullWidth, constrainToRef])

  if (!shouldRender) return null

  return createPortal(
    <div
      className={`
        fixed z-[100]
        p-1 bg-bg-000 border border-border-200/50 backdrop-blur-xl rounded-xl shadow-xl
        transition-all duration-200 cubic-bezier(0.34, 1.15, 0.64, 1)
        ${isVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}
        ${className}
      `}
      style={{ ...posStyle, ...sizeStyle }}
    >
      {children}
    </div>,
    document.body
  )
}
