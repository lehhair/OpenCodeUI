import { useSyncExternalStore } from 'react'

/**
 * 响应式内容区域最大高度
 *
 * 根据视口高度按比例计算，clamp 在 [min, max] 之间。
 * 全局共享一个 resize listener，多个组件调用不会重复监听。
 */

let currentHeight = typeof window !== 'undefined' ? window.innerHeight : 800
const listeners = new Set<() => void>()

if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => {
    currentHeight = window.innerHeight
    listeners.forEach(fn => fn())
  })
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function getSnapshot() {
  return currentHeight
}

function getServerSnapshot() {
  return 800
}

/**
 * @param ratio  视口高度占比，默认 0.3
 * @param min    最小值 px，默认 120
 * @param max    最大值 px，默认 300
 */
export function useResponsiveMaxHeight(ratio = 0.3, min = 120, max = 300): number {
  const vh = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  return Math.max(min, Math.min(max, Math.floor(vh * ratio)))
}

/**
 * 不订阅窗口变化的版本：给「估算占位高度」这类一次性计算用，
 * 避免几十上百张卡片各自挂一个 useSyncExternalStore。
 */
export function getResponsiveMaxHeight(ratio = 0.3, min = 120, max = 300): number {
  return Math.max(min, Math.min(max, Math.floor(currentHeight * ratio)))
}
