import { useCallback, useState, useEffect, useRef } from 'react'

export function useInView(options: IntersectionObserverInit & { triggerOnce?: boolean } = {}) {
  const [inView, setInView] = useState(false)
  const [hasTriggered, setHasTriggered] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { root = null, rootMargin, threshold, triggerOnce } = options

  useEffect(() => {
    // triggerOnce 已触发过，不再观察
    if (triggerOnce && hasTriggered) return

    const element = ref.current
    if (!element) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true)
          if (triggerOnce) {
            setHasTriggered(true)
            observer.unobserve(element)
          }
        } else {
          if (!triggerOnce) {
            setInView(false)
          }
        }
      },
      { root, rootMargin, threshold },
    )

    observer.observe(element)

    return () => {
      observer.disconnect()
    }
  }, [root, rootMargin, threshold, triggerOnce, hasTriggered])

  // triggerOnce 模式下，一旦触发过就永远返回 true
  return { ref, inView: (triggerOnce && hasTriggered) || inView }
}

/**
 * 视口附近的挂载门控。
 *
 * 与 useInView 的区别：ref 是回调，能和别的 ref 组合；`near` 会随着元素离开
 * rootMargin 变回 false，用来在长列表里挂载/卸载重内容（工具输出、代码块）。
 *
 * 同一个滚动容器 + rootMargin 共用一个 IntersectionObserver：
 * 一屏几十张工具卡各建一个 observer 在展开时是笔实打实的开销。
 */
type NearListener = (near: boolean) => void

interface SharedNearObserver {
  observer: IntersectionObserver
  listeners: Map<Element, NearListener>
}

const sharedNearObservers = new Map<string, SharedNearObserver>()
const scrollRootIds = new WeakMap<Element, number>()
let nextScrollRootId = 1

function observerKey(root: Element | null, rootMargin: string): string {
  if (!root) return `viewport|${rootMargin}`
  let id = scrollRootIds.get(root)
  if (id === undefined) {
    id = nextScrollRootId++
    scrollRootIds.set(root, id)
  }
  return `root:${id}|${rootMargin}`
}

export function useNearViewport(rootMargin = '1000px 0px', enabled = true) {
  const [near, setNear] = useState(false)
  const [element, setElement] = useState<Element | null>(null)
  const supported = typeof IntersectionObserver !== 'undefined'

  const ref = useCallback(
    (node: Element | null) => {
      if (enabled) setElement(node)
    },
    [enabled],
  )

  useEffect(() => {
    if (!enabled || !element || !supported) return

    // 聊天区是内部滚动容器：root 取视口时，rootMargin 只会扩大视口，
    // 祖先滚动容器的裁切不受影响，1000px 提前量等于没写。
    // 用最近的消息滚动容器做 root，rootMargin 才真的生效。
    const scrollRoot = element.closest('[data-chat-scroll-root]')
    const key = observerKey(scrollRoot, rootMargin)

    let shared = sharedNearObservers.get(key)
    if (!shared) {
      const listeners = new Map<Element, NearListener>()
      const observer = new IntersectionObserver(
        entries => {
          for (const entry of entries) listeners.get(entry.target)?.(entry.isIntersecting)
        },
        { root: scrollRoot, rootMargin },
      )
      shared = { observer, listeners }
      sharedNearObservers.set(key, shared)
    }

    const current = shared
    current.listeners.set(element, setNear)
    current.observer.observe(element)

    return () => {
      current.listeners.delete(element)
      current.observer.unobserve(element)
      if (current.listeners.size === 0) {
        current.observer.disconnect()
        sharedNearObservers.delete(key)
      }
    }
  }, [element, enabled, rootMargin, supported])

  // 关闭门控或没有 IntersectionObserver 的环境（测试 / 老浏览器）都当「在视口内」
  return { ref, near: !enabled || !supported || near }
}
