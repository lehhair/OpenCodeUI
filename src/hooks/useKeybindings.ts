// ============================================
// useKeybindings - 快捷键系统 React Hook
// ============================================

import { useEffect, useCallback, useSyncExternalStore } from 'react'
import { 
  keybindingStore, 
  matchesKeybinding,
  type KeybindingAction, 
  type KeybindingConfig 
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
    () => keybindingStore.getAll()
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
  
  const isKeyUsed = useCallback((keyStr: string, excludeAction?: KeybindingAction) => {
    return keybindingStore.isKeyUsed(keyStr, excludeAction)
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
      const isInput = target.tagName === 'INPUT' || 
                      target.tagName === 'TEXTAREA' || 
                      target.isContentEditable
      
      // 遍历所有配置的快捷键
      const keybindings = keybindingStore.getAll()
      
      for (const kb of keybindings) {
        if (matchesKeybinding(e, kb.currentKey)) {
          const handler = handlers[kb.action]
          
          // 某些快捷键在输入框中也应该生效
          const allowInInput = ['cancelMessage', 'sendMessage'].includes(kb.action)
          
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
