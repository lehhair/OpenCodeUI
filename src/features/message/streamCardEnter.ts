import { useCallback, useLayoutEffect, useRef } from 'react'
import { animate } from 'motion/mini'
import { prefersReducedMotion } from '../../utils/motion'
import { shouldPlayEntryGrow } from '../../utils/entryGrow'

/**
 * 流式工具卡的入场。
 *
 * 和参考实现同类：列表项入场只做**透明度淡入**（Compose `animateItem()` 的
 * enterTransition 也是 fadeIn），高度一挂载就是最终值，不逐帧改行高。
 *
 * 为什么不插值高度：卡片的高度变化会驱动虚拟行重测量，和贴底、上方补偿互相
 * 抢帧；200ms 的布局动画足以让跟随掉队。高度交给布局，动画只做透明度。
 *
 * 只对「流式中新到的卡」生效：
 * - 历史消息挂载、滚动复用（同 id 见过）不播
 * - 超过入场上限（3s）的旧工具不播
 * - prefers-reduced-motion 直接显示
 */
const CARD_ENTER_DURATION_MS = 200
/** 记录已入场的 id，防止虚拟列表卸载后重挂再播一遍 */
const CARD_ENTER_SEEN_LIMIT = 512

const enteredCards = new Set<string>()

function rememberEntered(id: string): void {
  enteredCards.delete(id)
  enteredCards.add(id)
  while (enteredCards.size > CARD_ENTER_SEEN_LIMIT) {
    const oldest = enteredCards.values().next().value
    if (oldest == null) break
    enteredCards.delete(oldest)
  }
}

export type CardEnterOptions = {
  id: string
  /** 工具创建时间（毫秒） */
  created: number
  /** 父消息仍在流式，且这张卡不是被组级动画带出来的 */
  enabled: boolean
  now?: number
  reducedMotion?: boolean
}

/** 纯判断：这张卡这次挂载该不该播入场 */
export function shouldPlayCardEnter({
  id,
  created,
  enabled,
  now = Date.now(),
  reducedMotion = false,
}: CardEnterOptions): boolean {
  if (!enabled || reducedMotion) return false
  if (enteredCards.has(id)) return false
  return shouldPlayEntryGrow(created, now)
}

/** 记录一个卡片/组已经入场过（也用于测试） */
export function markCardEntered(id: string): void {
  rememberEntered(id)
}

/** 仅供测试 */
export function resetCardEnterForTests(): void {
  enteredCards.clear()
}

export type CardEnterHandle = {
  ref: (node: HTMLElement | null) => void
  /** 挂载时决定的入场结果，父组件用它让子卡片跳过自己的动画 */
  willAnimate: boolean
}

export function useCardEnter(options: CardEnterOptions): CardEnterHandle {
  const elementRef = useRef<HTMLElement | null>(null)
  // 渲染期只算一次：父组件需要在本轮渲染里就知道要不要让子卡片跳过
  const willAnimateRef = useRef<boolean | null>(null)
  if (willAnimateRef.current === null) {
    willAnimateRef.current = shouldPlayCardEnter({ ...options, reducedMotion: prefersReducedMotion() })
  }
  const willAnimate = willAnimateRef.current === true

  useLayoutEffect(() => {
    const el = elementRef.current
    if (!el) return

    if (!willAnimate) {
      // 不播也要记账：之后滚回来重挂时不能再播
      if (options.enabled) rememberEntered(options.id)
      return
    }
    rememberEntered(options.id)

    // 只在透明度上做文章：不动 height、不动 transform，行高一次到位
    el.style.opacity = '0'

    const clear = () => {
      el.style.opacity = ''
    }

    const controls = animate(el, { opacity: 1 }, { duration: CARD_ENTER_DURATION_MS / 1000, ease: 'easeOut' })
    controls.then(clear)

    return () => {
      controls.stop()
      clear()
    }
    // 只在挂载时播一次；后续 props 变化不重播
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const ref = useCallback((node: HTMLElement | null) => {
    elementRef.current = node
  }, [])

  return { ref, willAnimate }
}
