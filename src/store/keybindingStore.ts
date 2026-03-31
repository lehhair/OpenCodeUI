// ============================================
// Keybinding Store - 快捷键配置管理
// ============================================

import { syncableSetItem, onSyncRemoteChange } from '../utils/syncableStorage'

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
  // Permission
  | 'toggleFullAuto'

/**
 * 快捷键配置
 */
export interface KeybindingConfig {
  action: KeybindingAction
  label: string
  description: string
  defaultKey: string // 默认快捷键
  currentKey: string // 当前快捷键（用户可修改）
  category: 'general' | 'session' | 'terminal' | 'model' | 'message' | 'permission'
}

/**
 * 解析后的快捷键
 */
export interface ParsedKeybinding {
  key: string // 主键 (小写)
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean // Command/Win
}

type Listener = () => void

const STORAGE_KEY = 'opencode-keybindings'

/**
 * 默认快捷键配置
 *
 * 注意：浏览器保留了某些快捷键无法被覆盖，如：
 * - Ctrl+L (地址栏), Ctrl+O (打开文件), Ctrl+N (新窗口)
 * - Ctrl+W (关闭标签), Ctrl+T (新标签), Ctrl+Tab (切换标签)
 *
 * 因此我们使用 Alt 组合键或 Ctrl+Shift 组合键来避免冲突
 */
const DEFAULT_KEYBINDINGS: KeybindingConfig[] = [
  // General - 使用 Alt 组合避免浏览器冲突
  {
    action: 'openSettings',
    label: 'Open Settings',
    description: 'Open settings dialog',
    defaultKey: 'Alt+,',
    currentKey: 'Alt+,',
    category: 'general',
  },
  {
    action: 'openProject',
    label: 'Open Project',
    description: 'Open project selector',
    defaultKey: 'Alt+O',
    currentKey: 'Alt+O',
    category: 'general',
  },
  {
    action: 'commandPalette',
    label: 'Command Palette',
    description: 'Open command palette',
    defaultKey: 'Ctrl+Shift+P',
    currentKey: 'Ctrl+Shift+P',
    category: 'general',
  },
  {
    action: 'toggleSidebar',
    label: 'Toggle Sidebar',
    description: 'Show/hide sidebar',
    defaultKey: 'Alt+B',
    currentKey: 'Alt+B',
    category: 'general',
  },
  {
    action: 'toggleRightPanel',
    label: 'Toggle Right Panel',
    description: 'Show/hide right panel',
    defaultKey: 'Alt+\\',
    currentKey: 'Alt+\\',
    category: 'general',
  },
  {
    action: 'focusInput',
    label: 'Focus Input',
    description: 'Focus message input',
    defaultKey: 'Alt+I',
    currentKey: 'Alt+I',
    category: 'general',
  },

  // Session
  {
    action: 'newSession',
    label: 'New Session',
    description: 'Create new chat session',
    defaultKey: 'Alt+N',
    currentKey: 'Alt+N',
    category: 'session',
  },
  {
    action: 'archiveSession',
    label: 'Archive Session',
    description: 'Archive current session',
    defaultKey: 'Alt+Backspace',
    currentKey: 'Alt+Backspace',
    category: 'session',
  },
  {
    action: 'previousSession',
    label: 'Previous Session',
    description: 'Switch to previous session',
    defaultKey: 'Alt+ArrowUp',
    currentKey: 'Alt+ArrowUp',
    category: 'session',
  },
  {
    action: 'nextSession',
    label: 'Next Session',
    description: 'Switch to next session',
    defaultKey: 'Alt+ArrowDown',
    currentKey: 'Alt+ArrowDown',
    category: 'session',
  },

  // Terminal
  {
    action: 'toggleTerminal',
    label: 'Toggle Terminal',
    description: 'Show/hide terminal panel',
    defaultKey: 'Alt+`',
    currentKey: 'Alt+`',
    category: 'terminal',
  },
  {
    action: 'newTerminal',
    label: 'New Terminal',
    description: 'Open new terminal tab',
    defaultKey: 'Alt+T',
    currentKey: 'Alt+T',
    category: 'terminal',
  },

  // Model
  {
    action: 'selectModel',
    label: 'Select Model',
    description: 'Open model selector',
    defaultKey: 'Alt+M',
    currentKey: 'Alt+M',
    category: 'model',
  },
  {
    action: 'toggleAgent',
    label: 'Toggle Agent',
    description: 'Switch agent mode',
    defaultKey: 'Alt+.',
    currentKey: 'Alt+.',
    category: 'model',
  },

  // Message
  {
    action: 'sendMessage',
    label: 'Send Message',
    description: 'Send current message',
    defaultKey: 'Ctrl+Enter',
    currentKey: 'Ctrl+Enter',
    category: 'message',
  },
  {
    action: 'cancelMessage',
    label: 'Cancel Message',
    description: 'Cancel current response',
    defaultKey: 'Escape',
    currentKey: 'Escape',
    category: 'message',
  },
  {
    action: 'copyLastResponse',
    label: 'Copy Response',
    description: 'Copy last AI response',
    defaultKey: 'Alt+C',
    currentKey: 'Alt+C',
    category: 'message',
  },

  // Permission
  {
    action: 'toggleFullAuto',
    label: 'Act Without Asking',
    description: 'Toggle auto-approve all actions',
    defaultKey: 'Alt+Y',
    currentKey: 'Alt+Y',
    category: 'permission',
  },
]

/**
 * 规范化按键名称 - 处理各种别名和大小写
 */
function normalizeKeyName(key: string): string {
  const keyLower = key.toLowerCase()

  // 特殊键别名映射
  const aliases: Record<string, string> = {
    esc: 'escape',
    return: 'enter',
    space: ' ',
    spacebar: ' ',
    up: 'arrowup',
    down: 'arrowdown',
    left: 'arrowleft',
    right: 'arrowright',
    del: 'delete',
    ins: 'insert',
    pgup: 'pageup',
    pgdn: 'pagedown',
    pgdown: 'pagedown',
    backquote: '`',
    backtick: '`',
    comma: ',',
    period: '.',
    dot: '.',
    slash: '/',
    backslash: '\\',
    minus: '-',
    dash: '-',
    equal: '=',
    equals: '=',
    plus: '+',
    semicolon: ';',
    quote: "'",
    singlequote: "'",
    doublequote: '"',
    bracketleft: '[',
    bracketright: ']',
  }

  return aliases[keyLower] || keyLower
}

/**
 * 解析快捷键字符串
 * 格式: "Ctrl+Shift+K" -> { key: 'k', ctrl: true, shift: true, alt: false, meta: false }
 * 支持多种格式: "Ctrl+K", "ctrl+k", "Control+K" 等
 */
export function parseKeybinding(keyStr: string): ParsedKeybinding {
  // 处理 "+" 作为主键的特殊情况 (e.g., "Ctrl++")
  const parts: string[] = []
  let remaining = keyStr

  // 匹配修饰键
  const modifiers = ['ctrl', 'control', 'alt', 'shift', 'meta', 'cmd', 'command', 'win']

  while (remaining.includes('+')) {
    const plusIndex = remaining.indexOf('+')
    const part = remaining.substring(0, plusIndex)

    if (part.length > 0) {
      parts.push(part)
      remaining = remaining.substring(plusIndex + 1)
    } else {
      // 空字符串意味着 "+" 在开头或连续 "++"
      // 检查是否 "+" 是主键
      if (remaining.length === 1 || !modifiers.includes(remaining.substring(1).split('+')[0].toLowerCase())) {
        parts.push('+')
        remaining = remaining.substring(1)
        break
      }
      remaining = remaining.substring(1)
    }
  }

  if (remaining.length > 0) {
    parts.push(remaining)
  }

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
    } else if (lower === 'alt' || lower === 'option') {
      result.alt = true
    } else if (lower === 'shift') {
      result.shift = true
    } else if (lower === 'meta' || lower === 'cmd' || lower === 'command' || lower === 'win' || lower === 'super') {
      result.meta = true
    } else {
      // 主键 - 规范化
      result.key = normalizeKeyName(part)
    }
  }

  return result
}

/**
 * 将 ParsedKeybinding 规范化为标准字符串格式 (用于比较)
 * 顺序: Ctrl+Alt+Shift+Meta+Key
 */
export function normalizeKeybindingString(keyStr: string): string {
  const parsed = parseKeybinding(keyStr)
  return keybindingToNormalizedString(parsed)
}

/**
 * 将 ParsedKeybinding 转换为规范化字符串
 */
function keybindingToNormalizedString(parsed: ParsedKeybinding): string {
  const parts: string[] = []
  if (parsed.ctrl) parts.push('ctrl')
  if (parsed.alt) parts.push('alt')
  if (parsed.shift) parts.push('shift')
  if (parsed.meta) parts.push('meta')
  parts.push(parsed.key)
  return parts.join('+')
}

/**
 * 格式化快捷键为显示字符串 (用户友好的格式)
 */
export function formatKeybinding(parsed: ParsedKeybinding): string {
  const parts: string[] = []
  if (parsed.ctrl) parts.push('Ctrl')
  if (parsed.alt) parts.push('Alt')
  if (parsed.shift) parts.push('Shift')
  if (parsed.meta) parts.push('⌘')

  // 格式化主键为用户友好的显示
  let keyDisplay = parsed.key
  const keyDisplayMap: Record<string, string> = {
    arrowup: '↑',
    arrowdown: '↓',
    arrowleft: '←',
    arrowright: '→',
    backspace: '⌫',
    delete: 'Del',
    escape: 'Esc',
    enter: '↵',
    ' ': 'Space',
    tab: 'Tab',
    capslock: 'Caps',
    pageup: 'PGUP',
    pagedown: 'PGDN',
    home: 'Home',
    end: 'End',
    insert: 'Ins',
    '`': '`',
    '-': '-',
    '=': '=',
    '[': '[',
    ']': ']',
    '\\': '\\',
    ';': ';',
    "'": "'",
    ',': ',',
    '.': '.',
    '/': '/',
  }

  if (keyDisplayMap[keyDisplay]) {
    keyDisplay = keyDisplayMap[keyDisplay]
  } else if (keyDisplay.length === 1) {
    keyDisplay = keyDisplay.toUpperCase()
  } else if (keyDisplay.startsWith('f') && /^f\d{1,2}$/.test(keyDisplay)) {
    // F1-F12
    keyDisplay = keyDisplay.toUpperCase()
  }

  parts.push(keyDisplay)
  return parts.join(' + ')
}

/**
 * 格式化快捷键为紧凑字符串 (用于存储)
 */
export function formatKeybindingCompact(parsed: ParsedKeybinding): string {
  const parts: string[] = []
  if (parsed.ctrl) parts.push('Ctrl')
  if (parsed.alt) parts.push('Alt')
  if (parsed.shift) parts.push('Shift')
  if (parsed.meta) parts.push('Meta')

  // 主键首字母大写或特殊格式
  let keyStr = parsed.key
  if (keyStr === 'arrowup') keyStr = 'ArrowUp'
  else if (keyStr === 'arrowdown') keyStr = 'ArrowDown'
  else if (keyStr === 'arrowleft') keyStr = 'ArrowLeft'
  else if (keyStr === 'arrowright') keyStr = 'ArrowRight'
  else if (keyStr === 'backspace') keyStr = 'Backspace'
  else if (keyStr === 'escape') keyStr = 'Escape'
  else if (keyStr === 'enter') keyStr = 'Enter'
  else if (keyStr === ' ') keyStr = 'Space'
  else if (keyStr === 'delete') keyStr = 'Delete'
  else if (keyStr === 'tab') keyStr = 'Tab'
  else if (keyStr.length === 1) keyStr = keyStr.toUpperCase()
  else if (keyStr.startsWith('f') && /^f\d{1,2}$/.test(keyStr)) {
    keyStr = keyStr.toUpperCase()
  }

  parts.push(keyStr)
  return parts.join('+')
}

/**
 * 从 KeyboardEvent 生成快捷键字符串
 */
export function keyEventToString(e: KeyboardEvent): string {
  // 规范化 key 名称
  const key = normalizeKeyName(e.key)

  const parsed: ParsedKeybinding = {
    key,
    ctrl: e.ctrlKey,
    alt: e.altKey,
    shift: e.shiftKey,
    meta: e.metaKey,
  }
  return formatKeybindingCompact(parsed)
}

/**
 * 检查 KeyboardEvent 是否匹配快捷键
 */
export function matchesKeybinding(e: KeyboardEvent, keyStr: string): boolean {
  const parsed = parseKeybinding(keyStr)
  const eventKey = normalizeKeyName(e.key)

  return (
    eventKey === parsed.key &&
    e.ctrlKey === parsed.ctrl &&
    e.altKey === parsed.alt &&
    e.shiftKey === parsed.shift &&
    e.metaKey === parsed.meta
  )
}

/**
 * 比较两个快捷键字符串是否相同 (规范化后比较)
 */
export function keybindingsEqual(a: string, b: string): boolean {
  return normalizeKeybindingString(a) === normalizeKeybindingString(b)
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
    onSyncRemoteChange([STORAGE_KEY], () => {
      this.loadFromStorage()
      this.notify()
    })
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
      syncableSetItem(STORAGE_KEY, JSON.stringify(customKeys))
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
   * 检查快捷键是否已被使用 (使用规范化比较)
   */
  isKeyUsed(keyStr: string, excludeAction?: KeybindingAction): boolean {
    const normalizedInput = normalizeKeybindingString(keyStr)
    return this.keybindings.some(
      kb => normalizeKeybindingString(kb.currentKey) === normalizedInput && kb.action !== excludeAction,
    )
  }

  /**
   * 根据快捷键查找动作 (使用规范化比较)
   */
  findActionByKey(keyStr: string): KeybindingAction | null {
    const normalizedInput = normalizeKeybindingString(keyStr)
    const kb = this.keybindings.find(k => normalizeKeybindingString(k.currentKey) === normalizedInput)
    return kb?.action ?? null
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
