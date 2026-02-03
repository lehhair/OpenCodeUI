// ============================================
// Keybinding Store - 快捷键配置管理
// ============================================

/**
 * 快捷键动作 ID
 */
export type KeybindingAction =
  // General
  | 'openSettings'
  | 'openProject'
  | 'commandPalette'
  | 'toggleSidebar'
  | 'toggleRightPanel'
  | 'focusInput'
  // Session
  | 'newSession'
  | 'archiveSession'
  | 'previousSession'
  | 'nextSession'
  // Terminal
  | 'toggleTerminal'
  | 'newTerminal'
  // Model
  | 'selectModel'
  | 'toggleAgent'
  // Message
  | 'sendMessage'
  | 'cancelMessage'
  | 'copyLastResponse'

/**
 * 快捷键配置
 */
export interface KeybindingConfig {
  action: KeybindingAction
  label: string
  description: string
  defaultKey: string      // 默认快捷键
  currentKey: string      // 当前快捷键（用户可修改）
  category: 'general' | 'session' | 'terminal' | 'model' | 'message'
}

/**
 * 解析后的快捷键
 */
export interface ParsedKeybinding {
  key: string           // 主键 (小写)
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean         // Command/Win
}

type Listener = () => void

const STORAGE_KEY = 'opencode-keybindings'

/**
 * 默认快捷键配置
 */
const DEFAULT_KEYBINDINGS: KeybindingConfig[] = [
  // General
  { action: 'openSettings', label: 'Open Settings', description: 'Open settings dialog', defaultKey: 'Ctrl+,', currentKey: 'Ctrl+,', category: 'general' },
  { action: 'openProject', label: 'Open Project', description: 'Open project selector', defaultKey: 'Ctrl+O', currentKey: 'Ctrl+O', category: 'general' },
  { action: 'commandPalette', label: 'Command Palette', description: 'Open command palette', defaultKey: 'Ctrl+Shift+P', currentKey: 'Ctrl+Shift+P', category: 'general' },
  { action: 'toggleSidebar', label: 'Toggle Sidebar', description: 'Show/hide sidebar', defaultKey: 'Ctrl+B', currentKey: 'Ctrl+B', category: 'general' },
  { action: 'toggleRightPanel', label: 'Toggle Right Panel', description: 'Show/hide right panel', defaultKey: 'Ctrl+\\', currentKey: 'Ctrl+\\', category: 'general' },
  { action: 'focusInput', label: 'Focus Input', description: 'Focus message input', defaultKey: 'Ctrl+L', currentKey: 'Ctrl+L', category: 'general' },
  
  // Session
  { action: 'newSession', label: 'New Session', description: 'Create new chat session', defaultKey: 'Ctrl+Shift+N', currentKey: 'Ctrl+Shift+N', category: 'session' },
  { action: 'archiveSession', label: 'Archive Session', description: 'Archive current session', defaultKey: 'Ctrl+Shift+Backspace', currentKey: 'Ctrl+Shift+Backspace', category: 'session' },
  { action: 'previousSession', label: 'Previous Session', description: 'Switch to previous session', defaultKey: 'Alt+ArrowUp', currentKey: 'Alt+ArrowUp', category: 'session' },
  { action: 'nextSession', label: 'Next Session', description: 'Switch to next session', defaultKey: 'Alt+ArrowDown', currentKey: 'Alt+ArrowDown', category: 'session' },
  
  // Terminal
  { action: 'toggleTerminal', label: 'Toggle Terminal', description: 'Show/hide terminal panel', defaultKey: 'Ctrl+`', currentKey: 'Ctrl+`', category: 'terminal' },
  { action: 'newTerminal', label: 'New Terminal', description: 'Open new terminal tab', defaultKey: 'Ctrl+Alt+T', currentKey: 'Ctrl+Alt+T', category: 'terminal' },
  
  // Model
  { action: 'selectModel', label: 'Select Model', description: 'Open model selector', defaultKey: "Ctrl+'", currentKey: "Ctrl+'", category: 'model' },
  { action: 'toggleAgent', label: 'Toggle Agent', description: 'Switch agent mode', defaultKey: 'Ctrl+.', currentKey: 'Ctrl+.', category: 'model' },
  
  // Message
  { action: 'sendMessage', label: 'Send Message', description: 'Send current message', defaultKey: 'Enter', currentKey: 'Enter', category: 'message' },
  { action: 'cancelMessage', label: 'Cancel Message', description: 'Cancel current response', defaultKey: 'Escape', currentKey: 'Escape', category: 'message' },
  { action: 'copyLastResponse', label: 'Copy Response', description: 'Copy last AI response', defaultKey: 'Ctrl+Shift+C', currentKey: 'Ctrl+Shift+C', category: 'message' },
]

/**
 * 解析快捷键字符串
 * 格式: "Ctrl+Shift+K" -> { key: 'k', ctrl: true, shift: true, alt: false, meta: false }
 */
export function parseKeybinding(keyStr: string): ParsedKeybinding {
  const parts = keyStr.split('+')
  const result: ParsedKeybinding = {
    key: '',
    ctrl: false,
    alt: false,
    shift: false,
    meta: false,
  }
  
  for (const part of parts) {
    const lower = part.toLowerCase()
    if (lower === 'ctrl' || lower === 'control') {
      result.ctrl = true
    } else if (lower === 'alt') {
      result.alt = true
    } else if (lower === 'shift') {
      result.shift = true
    } else if (lower === 'meta' || lower === 'cmd' || lower === 'command' || lower === 'win') {
      result.meta = true
    } else {
      // 主键
      result.key = lower
    }
  }
  
  return result
}

/**
 * 格式化快捷键为显示字符串
 */
export function formatKeybinding(parsed: ParsedKeybinding): string {
  const parts: string[] = []
  if (parsed.ctrl) parts.push('Ctrl')
  if (parsed.alt) parts.push('Alt')
  if (parsed.shift) parts.push('Shift')
  if (parsed.meta) parts.push('Meta')
  
  // 格式化主键
  let keyDisplay = parsed.key
  if (keyDisplay === 'arrowup') keyDisplay = '↑'
  else if (keyDisplay === 'arrowdown') keyDisplay = '↓'
  else if (keyDisplay === 'arrowleft') keyDisplay = '←'
  else if (keyDisplay === 'arrowright') keyDisplay = '→'
  else if (keyDisplay === 'backspace') keyDisplay = 'Backspace'
  else if (keyDisplay === 'escape') keyDisplay = 'Esc'
  else if (keyDisplay === 'enter') keyDisplay = 'Enter'
  else if (keyDisplay === ' ') keyDisplay = 'Space'
  else if (keyDisplay.length === 1) keyDisplay = keyDisplay.toUpperCase()
  
  parts.push(keyDisplay)
  return parts.join('+')
}

/**
 * 从 KeyboardEvent 生成快捷键字符串
 */
export function keyEventToString(e: KeyboardEvent): string {
  const parsed: ParsedKeybinding = {
    key: e.key.toLowerCase(),
    ctrl: e.ctrlKey,
    alt: e.altKey,
    shift: e.shiftKey,
    meta: e.metaKey,
  }
  return formatKeybinding(parsed)
}

/**
 * 检查 KeyboardEvent 是否匹配快捷键
 */
export function matchesKeybinding(e: KeyboardEvent, keyStr: string): boolean {
  const parsed = parseKeybinding(keyStr)
  
  return (
    e.key.toLowerCase() === parsed.key &&
    e.ctrlKey === parsed.ctrl &&
    e.altKey === parsed.alt &&
    e.shiftKey === parsed.shift &&
    e.metaKey === parsed.meta
  )
}

/**
 * Keybinding Store
 */
class KeybindingStore {
  private keybindings: KeybindingConfig[] = []
  private listeners: Set<Listener> = new Set()
  
  // 快照缓存 (用于 useSyncExternalStore)
  private _snapshot: KeybindingConfig[] = []
  
  constructor() {
    this.loadFromStorage()
    this.updateSnapshot()
  }
  
  // ============================================
  // Storage
  // ============================================
  
  private loadFromStorage(): void {
    // 先加载默认配置
    this.keybindings = DEFAULT_KEYBINDINGS.map(kb => ({ ...kb }))
    
    // 然后应用用户自定义
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const customKeys: Record<string, string> = JSON.parse(stored)
        for (const kb of this.keybindings) {
          if (customKeys[kb.action]) {
            kb.currentKey = customKeys[kb.action]
          }
        }
      }
    } catch {
      // ignore
    }
  }
  
  private saveToStorage(): void {
    try {
      // 只保存与默认不同的配置
      const customKeys: Record<string, string> = {}
      for (const kb of this.keybindings) {
        if (kb.currentKey !== kb.defaultKey) {
          customKeys[kb.action] = kb.currentKey
        }
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(customKeys))
    } catch {
      // ignore
    }
  }
  
  // ============================================
  // Subscription
  // ============================================
  
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  
  private notify(): void {
    this.updateSnapshot()
    this.listeners.forEach(l => l())
  }
  
  private updateSnapshot(): void {
    this._snapshot = this.keybindings.map(kb => ({ ...kb }))
  }
  
  // ============================================
  // Getters
  // ============================================
  
  /**
   * 获取所有快捷键配置 (返回缓存快照)
   */
  getAll(): KeybindingConfig[] {
    return this._snapshot
  }
  
  /**
   * 按分类获取快捷键
   */
  getByCategory(category: KeybindingConfig['category']): KeybindingConfig[] {
    return this.keybindings.filter(kb => kb.category === category)
  }
  
  /**
   * 获取某个动作的快捷键
   */
  getKeybinding(action: KeybindingAction): KeybindingConfig | undefined {
    return this.keybindings.find(kb => kb.action === action)
  }
  
  /**
   * 获取某个动作的当前快捷键字符串
   */
  getKey(action: KeybindingAction): string {
    return this.getKeybinding(action)?.currentKey ?? ''
  }
  
  /**
   * 根据快捷键查找动作
   */
  findActionByKey(keyStr: string): KeybindingAction | null {
    const kb = this.keybindings.find(k => k.currentKey === keyStr)
    return kb?.action ?? null
  }
  
  /**
   * 检查快捷键是否已被使用
   */
  isKeyUsed(keyStr: string, excludeAction?: KeybindingAction): boolean {
    return this.keybindings.some(
      kb => kb.currentKey === keyStr && kb.action !== excludeAction
    )
  }
  
  // ============================================
  // Mutations
  // ============================================
  
  /**
   * 设置快捷键
   */
  setKeybinding(action: KeybindingAction, newKey: string): boolean {
    const kb = this.keybindings.find(k => k.action === action)
    if (!kb) return false
    
    kb.currentKey = newKey
    this.saveToStorage()
    this.notify()
    return true
  }
  
  /**
   * 重置单个快捷键为默认值
   */
  resetKeybinding(action: KeybindingAction): boolean {
    const kb = this.keybindings.find(k => k.action === action)
    if (!kb) return false
    
    kb.currentKey = kb.defaultKey
    this.saveToStorage()
    this.notify()
    return true
  }
  
  /**
   * 重置所有快捷键为默认值
   */
  resetAll(): void {
    for (const kb of this.keybindings) {
      kb.currentKey = kb.defaultKey
    }
    this.saveToStorage()
    this.notify()
  }
}

// 单例导出
export const keybindingStore = new KeybindingStore()
