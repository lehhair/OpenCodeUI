/**
 * useAutoScroll — input-event-driven scroll-follow state machine
 *
 * 核心原则：userScrolled 只由**直接的用户输入**设置（wheel 向上、touch、滚动条
 * 拖拽、键盘向上、selection 起、disclosure 展开、scroll-to-message）。
 * 绝不由 scroll 事件单独设置。这意味着 layout clamp、virtualizer 调整、
 * viewport resize 等任何「无用户手势」的滚动都不会破坏跟随 —— 它们不匹配
 * 任何输入信号。
 *
 * 恢复（清掉 userScrolled）在三种情况下发生：
 *   (a) forceScrollToBottom（命令式「回到底部」按钮）
 *   (b) 显式向下输入时 scrollTop 已在 bottomThreshold 内 —— 立即恢复
 *   (c) 显式向下输入时 scrollTop 还没到底 —— 打开 500ms 恢复窗口，
 *       窗口内的 scroll 事件若发现已回到底部，就完成恢复。
 *       解决 iOS momentum / 触屏「拖到底松手时差几 px」的边界。
 *
 * 关键：scroll 事件本身**不会**清 userScrolled，除非在显式向下输入打开的
 * 恢复窗口内 —— 这样小幅 wheel-up 后紧随的 scroll 事件即使发现 atBottom=true
 * 也不会把刚表达的停止意图清掉（没有窗口）。
 *
 * handleScroll 唯一职责：用户在跟随时若发生 drift（scrollTop 离开底部），
 * 排一个 rAF 调 pinToBottom 写回去。
 *
 * 不再需要 markAuto/isAuto token —— 用户输入在事件源头捕获，
 * 而不是从 scroll 事件里事后推断。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { OS_DRAG_START, OS_DRAG_END } from '../../../lib/overlayScrollbar'

const SCROLL_UP_KEYS = new Set(['PageUp', 'Home', 'ArrowUp'])
const SCROLL_DOWN_KEYS = new Set(['PageDown', 'End', 'ArrowDown'])

/** tryRecover 没立即成功时打开的恢复窗口时长 —— 给 momentum / 连续 scroll 一个机会完成恢复 */
const RECOVERY_WINDOW_MS = 500

/** 这些元素上的 wheel / 键盘滚动不影响跟随状态（用户在编辑） */
const EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable="true"], [contenteditable=""]'

/**
 * 输入事件 handlers 工厂 + 统一 attach/detach。
 * 把监听器配置从 useEffect 主体里抽出来，让 useAutoScroll 主流程更清晰。
 * handlers 闭包捕获 ctx 里的 ref 和回调 —— 这些值由 useAutoScroll 提供。
 */
interface InputHandlerContext {
  el: HTMLElement
  stopFollow: () => void
  tryRecover: () => void
  markRecoverGesture: () => void
  touchStartYRef: React.MutableRefObject<number>
  touchMaxDownRef: React.MutableRefObject<number>
  lastSelEmptyRef: React.MutableRefObject<boolean>
  isStreamingRef: React.MutableRefObject<boolean>
}

function createInputHandlers(ctx: InputHandlerContext) {
  const { el, stopFollow, tryRecover, markRecoverGesture } = ctx

  const onWheel = (e: WheelEvent) => {
    const t = e.target instanceof Element ? e.target : null
    if (!t || !el.contains(t)) return
    if (t.closest(EDITABLE_SELECTOR)) return
    const delta = normalizeWheelDelta(e, el)
    const nested = findScrollableAncestor(t, el)
    if (nested && !shouldMarkBoundaryGesture(nested, delta)) return
    if (delta < 0) {
      stopFollow()
    } else if (delta > 0) {
      // 下滚的实际恢复由 handleScroll 完成；这里仅打开用户恢复窗口。
      markRecoverGesture()
    }
  }

  const isRelevantTouch = (e: TouchEvent): boolean => {
    const t = e.target instanceof Element ? e.target : null
    if (!t || !el.contains(t)) return false
    if (t.closest(EDITABLE_SELECTOR)) return false
    return true
  }

  const onTouchStart = (e: TouchEvent) => {
    if (!isRelevantTouch(e)) return
    ctx.touchStartYRef.current = e.touches[0]?.clientY ?? 0
    ctx.touchMaxDownRef.current = 0
  }

  const onTouchMove = (e: TouchEvent) => {
    if (!isRelevantTouch(e)) return
    const y = e.touches[0]?.clientY ?? 0
    // d > 0: 手指上移 = 内容向下滚（向下滚动）
    // d < 0: 手指下移 = 内容向上滚（向上滚动）
    const d = ctx.touchStartYRef.current - y
    if (d > ctx.touchMaxDownRef.current) ctx.touchMaxDownRef.current = d
    // 向上滚动手势（手指下移超过阈值）→ 停止跟随，和桌面端 wheel-up 一致
    if (d < -10) stopFollow()
  }

  const onTouchEnd = (e: TouchEvent) => {
    if (!isRelevantTouch(e)) return
    // 只有「本次触摸是向下滚动手势且已回到底部」才恢复跟随。
    if (ctx.touchMaxDownRef.current > 10) tryRecover()
  }

  const onPointerDown = (e: PointerEvent) => {
    // touch 走 touchstart 处理；这里只处理鼠标 / 笔
    if (e.pointerType === 'touch') return
    const t = e.target instanceof Element ? e.target : null
    // 滚动条是 scroll root 自己渲染的，target === el
    if (!t || t !== el) return
    const rect = el.getBoundingClientRect()
    const sbWidth = rect.width - el.clientWidth
    if (sbWidth <= 0) return
    if (e.clientX >= rect.right - sbWidth) stopFollow()
  }

  const onPointerUp = () => {
    // 鼠标松开本身不是「向下滚动」手势，不恢复跟随。
    // 鼠标向下滚动靠 wheel(deltaY>0) 恢复；滚动条拖拽靠 OS_DRAG_END 恢复。
  }

  const onKeyDown = (e: KeyboardEvent) => {
    const t = e.target instanceof Element ? e.target : null
    if (!t || !el.contains(t)) return
    if (t.closest(EDITABLE_SELECTOR)) return
    if (SCROLL_UP_KEYS.has(e.key)) {
      stopFollow()
    } else if (SCROLL_DOWN_KEYS.has(e.key)) {
      tryRecover()
    }
  }

  const onSelectionChange = () => {
    // 非流式时 selection 不影响跟随状态 —— 用户只是在复制/引用文字，
    // 不应该导致 toBottom 按钮出现或下一条消息不贴底
    if (!ctx.isStreamingRef.current) return
    const sel = window.getSelection()
    const isEmpty = !sel || sel.toString().length === 0
    if (isEmpty === ctx.lastSelEmptyRef.current) return
    ctx.lastSelEmptyRef.current = isEmpty
    // 只有「开始选中文字」才停止跟随；清空 selection 不改变状态
    if (isEmpty) return
    // 只对 chat root 内的 selection 起反应
    const node = sel.anchorNode
    const nodeEl = node
      ? (node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement)
      : null
    if (!nodeEl || !el.contains(nodeEl)) return
    stopFollow()
  }

  // 自绘滚动条（overlayScrollbar）拖拽：原生 scrollbar 被全局隐藏，
  // 它的 thumb 在父元素上且 stopPropagation，pointerdown 检测不到。
  // 这里改监听 overlayScrollbar 广播的 dragstart/dragend。
  const onOsDragStart = () => stopFollow()
  const onOsDragEnd = () => tryRecover()

  return {
    onWheel,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onPointerDown,
    onPointerUp,
    onKeyDown,
    onSelectionChange,
    onOsDragStart,
    onOsDragEnd,
  }
}

/** 用 AbortController 统一管理所有 listener 的注册/卸载 */
function attachInputListeners(el: HTMLElement, h: ReturnType<typeof createInputHandlers>) {
  const ac = new AbortController()
  const capture = { capture: true, passive: true, signal: ac.signal }
  const bubble = { passive: true, signal: ac.signal }
  const keydownOpts = { signal: ac.signal }
  const osOpts = { signal: ac.signal }

  el.addEventListener('wheel', h.onWheel, capture)
  el.addEventListener('touchstart', h.onTouchStart, capture)
  el.addEventListener('touchmove', h.onTouchMove, capture)
  el.addEventListener('touchend', h.onTouchEnd, bubble)
  el.addEventListener('pointerdown', h.onPointerDown, capture)
  el.addEventListener('pointerup', h.onPointerUp, bubble)
  el.addEventListener('keydown', h.onKeyDown, keydownOpts)
  el.addEventListener(OS_DRAG_START, h.onOsDragStart, osOpts)
  el.addEventListener(OS_DRAG_END, h.onOsDragEnd, osOpts)
  document.addEventListener('selectionchange', h.onSelectionChange, osOpts)

  return () => ac.abort()
}

/**
 * 从 target 向上找显式标记的嵌套滚动祖先（不含 root 自己）。
 * 嵌套块使用 data-scrollable 表达边界，避免每次 wheel 都调用 getComputedStyle。
 */
function findScrollableAncestor(target: Element, root: HTMLElement): HTMLElement | null {
  const nested = target.closest<HTMLElement>('[data-scrollable]')
  if (!nested || nested === root || !root.contains(nested)) return null
  return nested
}

function normalizeWheelDelta(event: WheelEvent, root: HTMLElement) {
  if (event.deltaMode === 1) return event.deltaY * 40
  if (event.deltaMode === 2) return event.deltaY * root.clientHeight
  return event.deltaY
}

function shouldMarkBoundaryGesture(nested: HTMLElement, delta: number) {
  const max = nested.scrollHeight - nested.clientHeight
  if (max <= 1) return true
  if (!delta) return false
  if (delta < 0) return nested.scrollTop + delta <= 0
  return delta > max - nested.scrollTop
}

export function useAutoScroll(bottomThreshold = 10) {
  const scrollElRef = useRef<HTMLElement | undefined>(undefined)
  const contentElRef = useRef<HTMLElement | undefined>(undefined)
  /** 是否正在流式输出 —— selection 只在流式时才影响跟随状态 */
  const isStreamingRef = useRef(false)
  const userScrolledRef = useRef(false)
  const [userScrolled, setUserScrolled] = useState(false)
  const lastSelEmptyRef = useRef(true)
  const recoverPinFrame = useRef<number | undefined>(undefined)
  /** 触摸手势中向下滚动的最大位移，用于 touchend 判断是否真的「向下滚到底」 */
  const touchStartYRef = useRef(0)
  const touchMaxDownRef = useRef(0)
  /** 由 ChatArea 注入的「写到底部」函数，drift 时调用以恢复贴底 */
  const pinToBottomRef = useRef<(() => void) | null>(null)
  /**
   * 恢复窗口的截止时间戳（Date.now() + RECOVERY_WINDOW_MS）。
   * 0 = 没有窗口。显式向下输入在不在线底部时打开窗口，
   * 之后 scroll 事件若发现已回到底部，就完成恢复。
   * 解决 iOS momentum / 触屏「拖到底松手时差几 px」的边界。
   */
  const recoverUntilRef = useRef(0)

  const setScrolled = useCallback((v: boolean) => {
    if (userScrolledRef.current === v) return
    userScrolledRef.current = v
    setUserScrolled(v)
    recoverUntilRef.current = 0
  }, [])

  /** 用户表达「停止跟随」：直接置 userScrolled=true，并关掉任何恢复窗口 */
  const stopFollow = useCallback(() => {
    const el = scrollElRef.current
    if (el && el.scrollHeight - el.clientHeight <= 1) {
      // 内容不足一屏，谈不上跟随
      if (userScrolledRef.current) setScrolled(false)
      return
    }
    recoverUntilRef.current = 0
    setScrolled(true)
  }, [setScrolled])

  /**
   * 用户表达「向下」意愿（wheel-down / 向下键 / touchend / pointerup）：
   * 若 scrollTop 已回到 bottomThreshold 内，立即恢复跟随；
   * 否则打开 500ms 恢复窗口 —— 让 momentum / 后续 scroll 事件完成恢复。
   */
  const tryRecover = useCallback(() => {
    if (!userScrolledRef.current) return
    const el = scrollElRef.current
    if (!el) return
    const max = el.scrollHeight - el.clientHeight
    if (max - el.scrollTop < bottomThreshold) {
      setScrolled(false)
      return
    }
    recoverUntilRef.current = Date.now() + RECOVERY_WINDOW_MS
  }, [bottomThreshold, setScrolled])

  const markRecoverGesture = useCallback(() => {
    if (!userScrolledRef.current) return
    recoverUntilRef.current = Date.now() + RECOVERY_WINDOW_MS
  }, [])

  // ── 漂移自愈：scroll 事件发现离底但 userScrolled=false 时排个 rAF 写回底 ──
  const scheduleRecoverPin = useCallback(() => {
    if (recoverPinFrame.current !== undefined) return
    recoverPinFrame.current = requestAnimationFrame(() => {
      recoverPinFrame.current = undefined
      if (userScrolledRef.current) return
      pinToBottomRef.current?.()
    })
  }, [])

  const setPinToBottom = useCallback((fn: (() => void) | null) => {
    pinToBottomRef.current = fn
  }, [])

  // ── scroll 事件：负责 drift pin 和 recovery window，永远不直接清 userScrolled（除恢复窗口内） ──
  const handleScroll = useCallback(() => {
    const el = scrollElRef.current
    if (!el) return
    const max = el.scrollHeight - el.clientHeight
    const atBottom = max <= 1 || max - el.scrollTop < bottomThreshold

    // 恢复窗口：用户表达过「向下」意愿后，给 momentum 一段时间把 scrollTop 带到底部
    if (userScrolledRef.current && recoverUntilRef.current > 0) {
      if (Date.now() > recoverUntilRef.current) {
        recoverUntilRef.current = 0
      } else if (atBottom) {
        setScrolled(false)
        return
      }
    }

    if (userScrolledRef.current) return
    if (!atBottom) scheduleRecoverPin()
  }, [bottomThreshold, scheduleRecoverPin, setScrolled])

  // ── 命令式动作 ──
  const scrollToBottom = useCallback((force: boolean) => {
    const el = scrollElRef.current
    if (!el) return
    if (force && userScrolledRef.current) setScrolled(false)
    if (!force && userScrolledRef.current) return
    const max = Math.max(0, el.scrollHeight - el.clientHeight)
    if (max - el.scrollTop >= 2) el.scrollTop = max
  }, [setScrolled])

  const pause = stopFollow

  const setScrollRef = useCallback((el: HTMLElement | null) => {
    scrollElRef.current = el ?? undefined
    if (el) el.style.overflowAnchor = 'none'
  }, [])

  const setContentRef = useCallback((el: HTMLElement | null) => {
    contentElRef.current = el ?? undefined
  }, [])

  const setStreaming = useCallback((v: boolean) => {
    isStreamingRef.current = v
  }, [])

  // ── 输入事件监听器：mount 一次，cleanup 通过 AbortController 统一 ──
  useEffect(() => {
    const el = scrollElRef.current
    if (!el) return
    const handlers = createInputHandlers({
      el,
      stopFollow,
      tryRecover,
      markRecoverGesture,
      touchStartYRef,
      touchMaxDownRef,
      lastSelEmptyRef,
      isStreamingRef,
    })
    return attachInputListeners(el, handlers)
  }, [markRecoverGesture, stopFollow, tryRecover])

  useEffect(() => () => {
    if (recoverPinFrame.current !== undefined) cancelAnimationFrame(recoverPinFrame.current)
  }, [])

  const reset = useCallback(() => setScrolled(false), [setScrolled])

  const resume = useCallback(() => {
    setScrolled(false)
    scrollToBottom(true)
  }, [scrollToBottom, setScrolled])

  const scrollToBottomCb = useCallback(() => scrollToBottom(false), [scrollToBottom])
  const forceScrollToBottom = useCallback(() => scrollToBottom(true), [scrollToBottom])

  return useMemo(() => ({
    setScrollRef,
    setContentRef,
    setPinToBottom,
    setStreaming,
    handleScroll,
    pause,
    reset,
    resume,
    scrollToBottom: scrollToBottomCb,
    forceScrollToBottom,
    userScrolledRef,
    userScrolled,
  }), [
    setScrollRef, setContentRef, setPinToBottom, setStreaming, handleScroll, pause,
    reset, resume, scrollToBottomCb, forceScrollToBottom, userScrolled,
  ])
}
