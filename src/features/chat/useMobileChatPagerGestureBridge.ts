import { useEffect, type RefObject } from 'react'

const AXIS_LOCK_PX = 8
const HORIZONTAL_RATIO = 1.2

function findMobilePager(el: HTMLElement | null): HTMLElement | null {
  return el?.closest('.mobile-chat-pager') ?? null
}

function isNestedHorizontalScroller(target: EventTarget | null, scrollRoot: HTMLElement): boolean {
  if (!(target instanceof Element)) return false
  let node: Element | null = target
  while (node && node !== scrollRoot) {
    if (!(node instanceof HTMLElement)) {
      node = node.parentElement
      continue
    }
    const style = getComputedStyle(node)
    const ox = style.overflowX
    if ((ox === 'auto' || ox === 'scroll' || ox === 'overlay') && node.scrollWidth > node.clientWidth + 1) {
      return true
    }
    node = node.parentElement
  }
  return false
}

/**
 * When the chat scroll root sits inside the mobile snap pager, vertical
 * overflow-y scrolling competes with horizontal pager swipes. Browsers often
 * assign the whole gesture to the inner scroller. This bridge detects
 * horizontal-dominant touches and drives pager.scrollLeft directly.
 */
export function useMobileChatPagerGestureBridge(
  scrollRootRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  scrollRootEl: HTMLElement | null,
): void {
  useEffect(() => {
    if (!enabled) return

    const root = scrollRootRef.current ?? scrollRootEl
    if (!root) return

    const pager = findMobilePager(root)
    if (!pager) return

    let startX = 0
    let startY = 0
    let startScrollLeft = 0
    let axis: 'pending' | 'vertical' | 'horizontal' = 'pending'
    let active = false

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      active = true
      axis = 'pending'
      startX = e.touches[0].clientX
      startY = e.touches[0].clientY
      startScrollLeft = pager.scrollLeft
    }

    const onTouchMove = (e: TouchEvent) => {
      if (!active || e.touches.length !== 1) return

      const x = e.touches[0].clientX
      const y = e.touches[0].clientY
      const dx = x - startX
      const dy = y - startY

      if (axis === 'pending') {
        if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return
        if (Math.abs(dx) >= Math.abs(dy) * HORIZONTAL_RATIO) {
          if (isNestedHorizontalScroller(e.target, root)) {
            axis = 'vertical'
            return
          }
          axis = 'horizontal'
        } else {
          axis = 'vertical'
          return
        }
      }

      if (axis !== 'horizontal') return

      e.preventDefault()
      pager.scrollLeft = startScrollLeft - dx
    }

    const onTouchEnd = () => {
      active = false
      axis = 'pending'
    }

    root.addEventListener('touchstart', onTouchStart, { passive: true })
    root.addEventListener('touchmove', onTouchMove, { passive: false })
    root.addEventListener('touchend', onTouchEnd)
    root.addEventListener('touchcancel', onTouchEnd)

    return () => {
      root.removeEventListener('touchstart', onTouchStart)
      root.removeEventListener('touchmove', onTouchMove)
      root.removeEventListener('touchend', onTouchEnd)
      root.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [enabled, scrollRootRef, scrollRootEl])
}