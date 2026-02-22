import { useState, useEffect } from 'react'

export function AnimatedPresence({ show, children, className }: { show: boolean; children: React.ReactNode; className?: string }) {
  const [shouldRender, setShouldRender] = useState(show)
  const [isVisible, setIsVisible] = useState(false)
  
  useEffect(() => {
    if (show) {
      setShouldRender(true)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setIsVisible(true))
      })
    } else {
      setIsVisible(false)
      const timer = setTimeout(() => setShouldRender(false), 200)
      return () => clearTimeout(timer)
    }
  }, [show])
  
  if (!shouldRender) return null
  
  return (
    <div className={className} style={{
      transition: 'opacity 200ms ease-out, transform 200ms cubic-bezier(0.34, 1.15, 0.64, 1)',
      opacity: isVisible ? 1 : 0,
      transform: isVisible ? 'scale(1)' : 'scale(0.9)',
    }}>
      {children}
    </div>
  )
}

/**
 * ExpandableSection - 平滑高度展开动画
 * 使用 CSS Grid 技巧实现从 0 到实际高度的平滑过渡
 * 同时处理 margin 过渡，避免隐藏时占用空间
 */
export function ExpandableSection({ 
  show, 
  children,
  className = '',
}: { 
  show: boolean
  children: React.ReactNode
  className?: string
}) {
  return (
    <div 
      className={`grid transition-[grid-template-rows,opacity,margin] duration-300 ease-out ${
        show ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0 !m-0'
      } ${className}`}
    >
      <div className="overflow-hidden">
        {children}
      </div>
    </div>
  )
}
