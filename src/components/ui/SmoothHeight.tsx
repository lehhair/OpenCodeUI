import { useEffect, useRef } from 'react'
import { animate } from 'motion/mini'

/**
 * SmoothHeight - 内容高度变化时平滑过渡
 *
 * 始终渲染同一 DOM 结构（普通 div），不因 isActive 切换重建子树。
 * isActive=true 时：ResizeObserver + 命令式 animate() 驱动容器生长
 * isActive=false 时：零开销（无 ResizeObserver、无动画、无 motion 组件）
 */
export function SmoothHeight({
  isActive,
  children,
  className,
}: {
  isActive: boolean
  children: React.ReactNode
  className?: string
}) {
  const outerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const animRef = useRef<ReturnType<typeof animate> | null>(null)

  useEffect(() => {
    const outer = outerRef.current
    const inner = innerRef.current
    if (!outer || !inner || !isActive) {
      // 非活跃：清除动画，恢复 auto
      animRef.current?.stop()
      animRef.current = null
      if (outer) {
        outer.style.height = ''
        outer.style.clipPath = ''
      }
      return
    }

    // 锁定 outer 为当前内容高度 — 之后内容增长不会自动撑开 outer，
    // 必须由 animate() 驱动 outer 增长，从而产生平滑的高度过渡效果
    outer.style.height = `${inner.scrollHeight}px`
    // 只裁切垂直方向，水平方向留出空间让 icon 光晕等视觉效果溢出
    // 不能用 overflow: hidden（会同时裁切水平），用 clip-path 实现单方向裁切
    outer.style.clipPath = 'inset(0 -100% 0 -100%)'

    const update = () => {
      const target = inner.scrollHeight
      const current = outer.offsetHeight
      if (Math.abs(target - current) < 1) return

      animRef.current?.stop()
      animRef.current = animate(
        outer,
        { height: `${target}px` },
        {
          duration: 0.12,
          ease: 'easeOut',
        },
      )
    }

    const ro = new ResizeObserver(update)
    ro.observe(inner)

    return () => {
      ro.disconnect()
      animRef.current?.stop()
      animRef.current = null
    }
  }, [isActive])

  return (
    <div ref={outerRef} className={className}>
      <div ref={innerRef}>{children}</div>
    </div>
  )
}
