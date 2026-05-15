// ============================================
// useKeybindings - 快捷键系统 React Hook
// ============================================

import { useEffect, useCallback, useSyncExternalStore } from 'react'
import {
  keybindingStore,
  matchesKeybinding,
  type KeybindingAction,
  type KeybindingConfig,
} from '../store/keybindingStore'

/**
 * 快捷键动作处理器
 */
export type KeybindingHandlers = Partial<Record<KeybindingAction, () => void>>

/**
 * 订阅快捷键配置的 Hook
 */
export function useKeybindingStore() {
  const keybindings = useSyncExternalStore(
    keybindingStore.subscribe.bind(keybindingStore),
    () => keybindingStore.getAll(),
    () => keybindingStore.getAll(),
  )

  const setKeybinding = useCallback((action: KeybindingAction, newKey: string) => {
    return keybindingStore.setKeybinding(action, newKey)
  }, [])

  const resetKeybinding = useCallback((action: KeybindingAction) => {
    return keybindingStore.resetKeybinding(action)
  }, [])

  const resetAll = useCallback(() => {
    keybindingStore.resetAll()
  }, [])

  const getKey = useCallback((action: KeybindingAction) => {
    return keybindingStore.getKey(action)
  }, [])

  const isKeyUsed = useCallback((keyStr: string, excludeAction?: KeybindingAction, scope?: KeybindingConfig['scope']) => {
    return keybindingStore.isKeyUsed(keyStr, excludeAction, scope)
  }, [])

  const getByCategory = useCallback((category: KeybindingConfig['category']) => {
    return keybindingStore.getByCategory(category)
  }, [])

  return {
    keybindings,
    setKeybinding,
    resetKeybinding,
    resetAll,
    getKey,
    isKeyUsed,
    getByCategory,
  }
}

/**
 * 全局快捷键监听 Hook
 *
 * @param handlers - 快捷键动作处理器映射
 * @param enabled - 是否启用监听 (默认 true)
 */
export function useGlobalKeybindings(handlers: KeybindingHandlers, enabled = true) {
  useEffect(() => {
    if (!enabled) return

    const handleKeyDown = (e: KeyboardEvent) => {
      // 忽略在输入框中的快捷键 (除了特定的如 Escape)
      const target = e.target as HTMLElement
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
      if (target.closest('.xterm')) return

      // 检查是否有模态框/对话框/下拉菜单打开
      // 如果有，只允许特定的快捷键通过
      const hasOpenDialog =
        document.querySelector('[role="dialog"]') !== null ||
        document.querySelector('[data-modal]') !== null ||
        document.querySelector('.fixed.inset-0') !== null
      const hasOpenDropdown = document.querySelector('[data-dropdown-open]') !== null

      // 遍历所有配置的快捷键
      const keybindings = keybindingStore.getAll()

      for (const kb of keybindings) {
        if (kb.scope !== 'global') continue

        if (matchesKeybinding(e, kb.currentKey)) {
          const handler = handlers[kb.action]

          // 某些快捷键在输入框中也应该生效
          // 带修饰键的快捷键（Alt+X, Ctrl+Shift+X）不会和文本输入冲突，放行
          const hasModifier = e.altKey || e.ctrlKey || e.metaKey
          const allowInInput = ['cancelMessage', 'sendMessage'].includes(kb.action) || hasModifier

          // 当有模态框打开时，这些快捷键应该让模态框自己处理
          const blockWhenDialogOpen = ['cancelMessage', 'sendMessage'].includes(kb.action)

          // 当有下拉菜单打开时，Escape 应该让下拉菜单自己处理
          const blockWhenDropdownOpen = kb.action === 'cancelMessage'

          // 如果有模态框打开且是需要阻止的快捷键，跳过
          if (hasOpenDialog && blockWhenDialogOpen) {
            continue
          }

          // 如果有下拉菜单打开且是 Escape，跳过让下拉菜单处理
          if (hasOpenDropdown && blockWhenDropdownOpen) {
            continue
          }

          if (handler && (!isInput || allowInInput)) {
            e.preventDefault()
            e.stopPropagation()
            handler()
            return
          }
        }
      }
    }

    // 使用 capture 阶段以便在其他处理器之前捕获
    document.addEventListener('keydown', handleKeyDown, { capture: true })

    return () => {
      document.removeEventListener('keydown', handleKeyDown, { capture: true })
    }
  }, [handlers, enabled])
}

/**
 * 获取快捷键显示文本的 Hook
 */
export function useKeybindingLabel(action: KeybindingAction): string {
  const { keybindings } = useKeybindingStore()
  const kb = keybindings.find(k => k.action === action)
  return kb?.currentKey ?? ''
}
