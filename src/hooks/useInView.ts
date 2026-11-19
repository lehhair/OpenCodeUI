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

export type NearViewportOptions = {
  rootMargin?: string
  enabled?: boolean
  /** 进入范围一次后保持 true：代码高亮这类只做一次、不能来回卸载的工作 */
  triggerOnce?: boolean
}

export function useNearViewport(
  rootMarginOrOptions: string | NearViewportOptions = '1000px 0px',
  enabledOption = true,
) {
  const options: NearViewportOptions =
    typeof rootMarginOrOptions === 'string'
      ? { rootMargin: rootMarginOrOptions, enabled: enabledOption }
      : rootMarginOrOptions
  const rootMargin = options.rootMargin ?? '1000px 0px'
  const enabled = options.enabled ?? true
  const triggerOnce = options.triggerOnce ?? false

  const [near, setNear] = useState(false)
  const [element, setElement] = useState<Element | null>(null)
  const triggeredRef = useRef(false)
  const supported = typeof IntersectionObserver !== 'undefined'

  const ref = useCallback(
    (node: Element | null) => {
      if (enabled) setElement(node)
    },
    [enabled],
  )

  useEffect(() => {
    if (!enabled || !element || !supported) return
    if (triggerOnce && triggeredRef.current) return

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
    const listener: NearListener = value => {
      if (value && triggerOnce) {
        // 一次性的观察：命中后立刻摘掉，别让它跟着来回触发
        triggeredRef.current = true
        current.observer.unobserve(element)
        current.listeners.delete(element)
        setNear(true)
        return
      }
      setNear(value)
    }
    current.listeners.set(element, listener)
    current.observer.observe(element)

    return () => {
      current.listeners.delete(element)
      current.observer.unobserve(element)
      if (current.listeners.size === 0) {
        current.observer.disconnect()
        sharedNearObservers.delete(key)
      }
    }
  }, [element, enabled, rootMargin, supported, triggerOnce])

  // 关闭门控或没有 IntersectionObserver 的环境（测试 / 老浏览器）都当「在视口内」
  return { ref, near: !enabled || !supported || near }
}
