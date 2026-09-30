/**
 * 滚动手势检测 — 移植自 oc 的 message-gesture.ts
 *
 * oc 的 onScroll handler 被 hasScrollGesture() gate：
 * 只有用户真实的 wheel/touch/pointer 事件才 markScrollGesture，
 * 程序触发的 scroll 事件不会误判为用户滚动。
 */

export const normalizeWheelDelta = (input: { deltaY: number; deltaMode: number; rootHeight: number }) => {
  if (input.deltaMode === 1) return input.deltaY * 40
  if (input.deltaMode === 2) return input.deltaY * input.rootHeight
  return input.deltaY
}

const shouldMarkBoundary = (delta: number, scrollTop: number, scrollHeight: number, clientHeight: number) => {
  const max = scrollHeight - clientHeight
  if (max <= 1) return true
  if (!delta) return false
  if (delta < 0) return scrollTop + delta <= 0
  return delta > max - scrollTop
}

export const markBoundaryGesture = (input: {
  root: HTMLDivElement
  target: EventTarget | null
  delta: number
  onMarkScrollGesture: (target?: EventTarget | null) => void
}) => {
  const nested = (input.target instanceof Element ? input.target : undefined)?.closest('[data-scrollable]')
  if (!nested || nested === input.root) {
    input.onMarkScrollGesture(input.root)
    return
  }
  if (
    nested instanceof HTMLElement &&
    shouldMarkBoundary(input.delta, nested.scrollTop, nested.scrollHeight, nested.clientHeight)
  ) {
    input.onMarkScrollGesture(input.root)
  }
}
