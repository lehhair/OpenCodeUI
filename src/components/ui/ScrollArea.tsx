import { forwardRef, type HTMLAttributes, type ReactNode } from 'react'

interface ScrollAreaProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  /** 最大高度，超出时显示滚动条 */
  maxHeight?: string | number
}

/**
 * ScrollArea — 可滚动区域
 *
 * 原生滚动条已由全局 overlay scrollbar 系统接管，
 * 这个组件只是一个带 overflow-y:auto 的 div 包装器。
 */
export const ScrollArea = forwardRef<HTMLDivElement, ScrollAreaProps>(
  ({ children, maxHeight, className = '', style, ...props }, ref) => {
    return (
      <div
        ref={ref}
        data-scrollable
        className={`overflow-y-auto overflow-x-hidden ${className}`}
        style={{
          maxHeight: typeof maxHeight === 'number' ? `${maxHeight}px` : maxHeight,
          ...style,
        }}
        {...props}
      >
        {children}
      </div>
    )
  },
)

ScrollArea.displayName = 'ScrollArea'
