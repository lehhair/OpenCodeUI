import { useState, useRef, useEffect, useCallback } from 'react'
import type { CollapsedDialogInfo } from '../InputBox'

// ============================================
// useMobileCollapse
// 移动端输入框滚动收起/展开（胶囊模式）的全部状态与逻辑
// ============================================

interface UseMobileCollapseOptions {
  /** 是否启用移动端输入交互（只代表交互，不代表 UI） */
  enabled: boolean
  /** 文本内容是否非空 */
  hasContent: boolean
  /** 是否处于页面底部 */
  isAtBottom: boolean
  /** textarea 的 ref */
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  /** 输入框容器的 ref（用于判断焦点去向） */
  inputContainerRef: React.RefObject<HTMLDivElement | null>
  /** 内容包裹层 ref（用于 ResizeObserver 采样展开态高度） */
  contentWrapRef: React.RefObject<HTMLDivElement | null>
  /** Footer 区域 ref（移动端点击不应触发收起） */
  footerRef: React.RefObject<HTMLDivElement | null>
  /** 注册输入框容器用于动画 */
  registerInputBox?: (element: HTMLElement | null) => void
  /** 收起态的 permission/question 对话框 */
  collapsedPermission?: CollapsedDialogInfo
  collapsedQuestion?: CollapsedDialogInfo
}

interface UseMobileCollapseReturn {
  /** 是否处于收起（胶囊）状态 */
  isCollapsed: boolean
  /** 展开态时采样到的内容区高度（用于收起时撑占位） */
  expandedHeight: number
  /** 点击胶囊展开 */
  handleExpandInput: () => void
  /** textarea onFocus */
  handleFocus: () => void
  /** textarea onBlur */
  handleBlur: (e: React.FocusEvent) => void
  /** 输入框容器 onPointerDown（移动端触摸兜底） */
  handleContainerPointerDown: (e: React.PointerEvent) => void
}

export function useMobileCollapse({
  enabled,
  hasContent,
  isAtBottom,
  textareaRef,
  inputContainerRef,
  contentWrapRef,
  footerRef,
  registerInputBox,
  collapsedPermission,
  collapsedQuestion,
}: UseMobileCollapseOptions): UseMobileCollapseReturn {
  // 判断节点是否在输入区域内部（inputContainer / contentWrap / footer）
  const isInsideInputArea = useCallback(
    (node: Node | null): boolean => {
      if (!node) return false
      return !!(
        inputContainerRef.current?.contains(node) ||
        contentWrapRef.current?.contains(node) ||
        footerRef.current?.contains(node)
      )
    },
    [inputContainerRef, contentWrapRef, footerRef],
  )

  // isFocused: textarea 是否聚焦中（或用户正在与输入框容器交互中）
  const [isFocused, setIsFocused] = useState(false)

  // ---- 清空文本缓冲 ----
  // 移动端输入法“全选 → 删除”时：选择/删除瞬间系统 UI 可能抢走焦点
  // （blur → isFocused=false），文本清空（hasContent=false）后输入框会
  // 立即收成胶囊——而用户还开着输入法在编辑，收起后的输入区是
  // pointer-events-none 的透明层，表现为“无法点击、无法输入”。
  // 从非空变空后缓冲 4s 不收起；期间焦点回来（继续输入）就恢复正常。
  const [justCleared, setJustCleared] = useState(false)
  const justClearedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevHasContentRef = useRef(hasContent)
  useEffect(() => {
    const previous = prevHasContentRef.current
    prevHasContentRef.current = hasContent
    if (!previous || hasContent) return
    if (justClearedTimerRef.current) clearTimeout(justClearedTimerRef.current)
    setJustCleared(true)
    justClearedTimerRef.current = setTimeout(() => {
      justClearedTimerRef.current = null
      setJustCleared(false)
    }, 4_000)
  }, [hasContent])
  useEffect(
    () => () => {
      if (justClearedTimerRef.current) clearTimeout(justClearedTimerRef.current)
    },
    [],
  )

  // 直接计算是否收起（纯派生值）
  // isAtBottom 语义是「用户未主动离底」（ChatArea 用 !userScrolled），不是几何 dist。
  // 流式贴底跟随期间 dist 会抖，但 userScrolled 仍为 false → 不收起，Footer 不闪。
  const hasPendingDialogs = !!collapsedPermission || !!collapsedQuestion
  const isCollapsed = enabled && !isAtBottom && !hasContent && !isFocused && !hasPendingDialogs && !justCleared

  // 展开态内容区高度（用于收起时占位，防 isAtBottom 反馈循环）
  const [expandedHeight, setExpandedHeight] = useState(0)

  // ---- 点击胶囊展开 ----
  const handleExpandInput = useCallback(() => {
    setIsFocused(true)
    requestAnimationFrame(() => {
      textareaRef.current?.focus()
    })
  }, [textareaRef])

  // ---- 容器交互标记 ----
  // pointerdown 在容器内（但 textarea 之外）按下时置 true，
  // 用于 blur 延迟回调中判断用户是否正在与容器内按钮交互（如 model/agent 选择器）。
  // 移动端触摸 button 时 relatedTarget 和 activeElement 都不可靠，需要此标记兜底。
  // 注意：必须排除 textarea 自身的触摸，否则"在 textarea 上滑动触发滚动"时
  // 也会被标记为容器交互，导致 blur 后输入框无法收起。
  const containerInteractingRef = useRef(false)
  const containerInteractingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleContainerPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // textarea 本身的触摸不算"容器按钮交互"
      if (e.target === textareaRef.current) return
      containerInteractingRef.current = true
      if (containerInteractingTimerRef.current) clearTimeout(containerInteractingTimerRef.current)
      // 300ms 后自动清除，确保不会永久阻止收起
      containerInteractingTimerRef.current = setTimeout(() => {
        containerInteractingRef.current = false
      }, 300)
    },
    [textareaRef],
  )

  // ---- textarea focus/blur 追踪 ----
  const handleFocus = useCallback(() => setIsFocused(true), [])

  // blur 处理：三层防线
  // 1. relatedTarget 检查 —— 焦点移到容器内元素
  // 2. 延迟后 activeElement 检查 —— 焦点异步移入（如 portal 搜索框）
  // 3. containerInteractingRef 检查 —— 移动端触摸兜底
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleBlur = useCallback(
    (e: React.FocusEvent) => {
      // 焦点移到输入区域内部，不收起
      if (isInsideInputArea(e.relatedTarget as Node | null)) return

      blurTimerRef.current = setTimeout(() => {
        if (isInsideInputArea(document.activeElement)) return
        if (containerInteractingRef.current) return
        setIsFocused(false)
      }, 150)
    },
    [isInsideInputArea],
  )

  // focus 时清掉 pending 的 blur timer
  useEffect(() => {
    if (isFocused && blurTimerRef.current) {
      clearTimeout(blurTimerRef.current)
      blurTimerRef.current = null
    }
  }, [isFocused])

  // ---- isFocused 逃逸阀 ----
  // 场景：用户点了容器内按钮（如 agent selector），handleBlur 正确阻止了收起，
  // 但此后 textarea 不再聚焦，isFocused 卡在 true。
  // 需要监听 document pointerdown：如果点击/触摸发生在容器外部 → 清除 isFocused。
  // 同时，滚动事件也应该能清除（用户在 chat 区域滑动 = 离开输入区域）。
  useEffect(() => {
    if (!isFocused || !enabled) return

    const handleOutsidePointerDown = (e: PointerEvent) => {
      if (isInsideInputArea(e.target as Node)) return

      // 光标仍在输入框内时，不清除（移动端滚动/触摸可能不会触发 blur）
      if (document.activeElement === textareaRef.current) return
      if (isInsideInputArea(document.activeElement)) return

      setIsFocused(false)
    }

    // 使用 capture 确保在任何 stopPropagation 之前捕获
    document.addEventListener('pointerdown', handleOutsidePointerDown, { capture: true })
    return () => {
      document.removeEventListener('pointerdown', handleOutsidePointerDown, { capture: true })
    }
  }, [isFocused, enabled, isInsideInputArea, textareaRef])

  // ---- 持续追踪展开态内容区高度 ----
  useEffect(() => {
    const el = contentWrapRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        // 只在展开态时采样，收起态的高度不更新
        if (!isCollapsed) {
          setExpandedHeight(entry.contentRect.height)
        }
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [isCollapsed, contentWrapRef])

  // ---- 注册输入框容器用于动画 ----
  useEffect(() => {
    if (registerInputBox) {
      registerInputBox(isCollapsed ? null : inputContainerRef.current)
      return () => registerInputBox(null)
    }
  }, [registerInputBox, isCollapsed, inputContainerRef])

  return {
    isCollapsed,
    expandedHeight,
    handleExpandInput,
    handleFocus,
    handleBlur,
    handleContainerPointerDown,
  }
}
