import { useRef, useLayoutEffect } from 'react'
import { animate } from 'motion/mini'
import { useDelayedRender } from './useDelayedRender'

type AnimationStyle = Record<string, string | number>

interface UsePresenceOptions {
  /** 入场初始状态 */
  from: AnimationStyle
  /** 入场目标状态（退场时反向回到 from） */
  to: AnimationStyle
  /** 动画时长（秒） */
  duration?: number
}

/**
 * usePresence — 命令式 mount/unmount 动画
 *
 * 基于 useDelayedRender 延迟卸载 + motion/mini animate() 驱动入场/退场。
 * 返回 { shouldRender, ref }:
 *   - shouldRender: 是否应该渲染 DOM（包含退场延迟期）
 *   - ref: 绑定到动画目标元素
 *
 * 用法:
 *   const { shouldRender, ref } = usePresence(isOpen, {
 *     from: { opacity: 0, transform: 'translateY(8px)' },
 *     to: { opacity: 1, transform: 'translateY(0px)' },
 *   })
 *   if (!shouldRender) return null
 *   return <div ref={ref}>...</div>
 */
export function usePresence<T extends HTMLElement = HTMLDivElement>(show: boolean, options: UsePresenceOptions) {
  const { from, to, duration = 0.15 } = options
  const ref = useRef<T>(null)
  const animRef = useRef<ReturnType<typeof animate> | null>(null)
  const hasEntered = useRef(false)

  // 延迟卸载时间 = 动画时长 + 50ms 余量
  const delayMs = Math.round(duration * 1000) + 50
  const shouldRender = useDelayedRender(show, delayMs)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return

    animRef.current?.stop()

    if (show && shouldRender) {
      // 入场：DOM 已 mount，从 from 动画到 to
      Object.assign(el.style, stringifyStyle(from))
      animRef.current = animate(el, to, { duration, ease: 'easeOut' })
      hasEntered.current = true
    } else if (!show && shouldRender && hasEntered.current) {
      // 退场：DOM 还在（延迟卸载中），从当前状态动画回 from
      animRef.current = animate(el, from, { duration, ease: 'easeOut' })
    }
  }, [show, shouldRender]) // eslint-disable-line react-hooks/exhaustive-deps

  return { shouldRender, ref }
}

/** 把数值样式转成 el.style 可赋值的字符串 */
function stringifyStyle(style: AnimationStyle): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(style)) {
    result[key] = typeof value === 'number' ? `${value}` : value
  }
  return result
}
