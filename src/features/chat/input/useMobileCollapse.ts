import { useState, useCallback, useEffect } from 'react'
import type { CollapsedDialogInfo } from '../InputBox'

// ============================================
// useMobileCollapse
// 移动端输入框手动收起/展开（紧凑栏模式）的全部状态与逻辑。
// 不再自动折叠——展开态保持到用户手动收起为止。
// ============================================

interface UseMobileCollapseOptions {
  /** 是否启用移动端输入交互（只代表交互，不代表 UI） */
  enabled: boolean
  /** textarea 的 ref */
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  /** 注册输入框容器用于动画 */
  registerInputBox?: (element: HTMLElement | null) => void
  /** 收起态的 permission/question 对话框 */
  collapsedPermission?: CollapsedDialogInfo
  collapsedQuestion?: CollapsedDialogInfo
}

interface UseMobileCollapseReturn {
  /** 是否处于收起（紧凑栏）状态 */
  isCollapsed: boolean
  /** 切换收起/展开 */
  toggleCollapse: () => void
  /** 点击紧凑栏展开 */
  handleExpandInput: () => void
  /** textarea onFocus */
  handleFocus: () => void
  /** textarea onBlur */
  handleBlur: (e: React.FocusEvent) => void
  /** 输入框容器 onPointerDown */
  handleContainerPointerDown: () => void
}

export function useMobileCollapse({
  enabled,
  textareaRef,
  registerInputBox,
  collapsedPermission,
  collapsedQuestion,
}: UseMobileCollapseOptions): UseMobileCollapseReturn {
  // 手动折叠状态（用户通过按钮切换）
  const [manuallyCollapsed, setManuallyCollapsed] = useState(false)

  // 有 pending dialog 时不允许折叠
  const hasPendingDialogs = !!collapsedPermission || !!collapsedQuestion
  const isCollapsed = enabled && manuallyCollapsed && !hasPendingDialogs

  // ---- 切换折叠状态 ----
  const toggleCollapse = useCallback(() => {
    if (!enabled) return
    setManuallyCollapsed(prev => !prev)
  }, [enabled])

  // ---- 点击紧凑栏展开 ----
  const handleExpandInput = useCallback(() => {
    setManuallyCollapsed(false)
    requestAnimationFrame(() => {
      textareaRef.current?.focus()
    })
  }, [textareaRef])

  // ---- textarea focus：展开 ----
  const handleFocus = useCallback(() => {
    // 收起态下聚焦 textarea 时自动展开
    setManuallyCollapsed(false)
  }, [])

  // ---- textarea blur：不再自动折叠 ----
  const handleBlur = useCallback(() => {}, [])

  // ---- 注册输入框容器用于动画 ----
  useEffect(() => {
    if (registerInputBox) {
      registerInputBox(isCollapsed ? null : textareaRef.current?.closest('[data-input-box]') ?? null)
      return () => registerInputBox(null)
    }
  }, [registerInputBox, isCollapsed, textareaRef])

  return {
    isCollapsed,
    toggleCollapse,
    handleExpandInput,
    handleFocus,
    handleBlur,
    handleContainerPointerDown: () => {},
  }
}
