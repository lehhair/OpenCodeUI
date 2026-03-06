/**
 * KeybindingsSection - 快捷键设置
 * 简洁平铺列表，无 emoji，搜索即过滤
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useKeybindingStore } from '../../hooks/useKeybindings'
import { keyEventToString, formatKeybinding, parseKeybinding } from '../../store/keybindingStore'
import { UndoIcon, SearchIcon } from '../../components/Icons'
import type { KeybindingConfig, KeybindingAction } from '../../store/keybindingStore'

// ============================================
// Kbd - 按键胶囊
// ============================================

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5
                    text-[11px] font-mono font-medium leading-none
                    bg-bg-100 text-text-300 border border-border-200 rounded
                    shadow-[0_1px_0_0_var(--border-200)]">
      {children}
    </kbd>
  )
}

function ShortcutDisplay({ shortcut, className }: { shortcut: string; className?: string }) {
  const parsed = parseKeybinding(shortcut)
  const formatted = formatKeybinding(parsed)
  const parts = formatted.split(' + ')
  return (
    <span className={`inline-flex items-center gap-0.5 ${className || ''}`}>
      {parts.map((p, i) => <Kbd key={i}>{p}</Kbd>)}
    </span>
  )
}

// ============================================
// KeybindingRow - 单行编辑
// ============================================

interface KeybindingRowProps {
  config: KeybindingConfig
  onEdit: (action: KeybindingAction, newKey: string) => void
  onReset: (action: KeybindingAction) => void
  isKeyUsed: (key: string, exclude?: KeybindingAction) => boolean
}

function KeybindingRow({ config, onEdit, onReset, isKeyUsed }: KeybindingRowProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [tempKey, setTempKey] = useState('')
  const [error, setError] = useState('')
  const captureRef = useRef<HTMLDivElement>(null)
  const isModified = config.currentKey !== config.defaultKey

  useEffect(() => {
    if (isEditing) captureRef.current?.focus()
  }, [isEditing])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return

    const newKey = keyEventToString(e)
    setTempKey(newKey)
    setError(isKeyUsed(newKey, config.action) ? 'Already in use' : '')
  }, [isKeyUsed, config.action])

  const confirm = useCallback(() => {
    if (tempKey && !error) onEdit(config.action, tempKey)
    setIsEditing(false)
    setTempKey('')
    setError('')
  }, [tempKey, error, onEdit, config.action])

  const cancel = useCallback(() => {
    setIsEditing(false)
    setTempKey('')
    setError('')
  }, [])

  useEffect(() => {
    if (!isEditing) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); cancel(); return }
      if (e.key === 'Enter' && tempKey && !error) { e.preventDefault(); confirm(); return }
      handleKeyDown(e)
    }
    document.addEventListener('keydown', handler, { capture: true })
    return () => document.removeEventListener('keydown', handler, { capture: true })
  }, [isEditing, tempKey, error, handleKeyDown, confirm, cancel])

  return (
    <div className={`
      flex items-center h-9 px-3 rounded-md transition-colors group
      ${isEditing 
        ? 'bg-accent-main-100/5 ring-1 ring-accent-main-100/20' 
        : 'hover:bg-bg-100/60'}
    `}>
      {/* Label */}
      <span className="flex-1 text-[13px] text-text-200 truncate">{config.label}</span>

      {/* Reset */}
      {isModified && !isEditing && (
        <button
          onClick={() => onReset(config.action)}
          className="p-1 mr-1 rounded text-text-400 hover:text-text-100 hover:bg-bg-200 
                     opacity-0 group-hover:opacity-100 transition-opacity"
          title="Reset to default"
        >
          <UndoIcon size={12} />
        </button>
      )}

      {/* Key */}
      {isEditing ? (
        <div className="flex items-center gap-2">
          <div
            ref={captureRef}
            tabIndex={0}
            className={`
              min-w-[120px] h-7 flex items-center justify-center px-3 
              text-xs font-mono rounded border-2 outline-none
              ${error
                ? 'border-danger-100/60 bg-danger-100/5 text-danger-100'
                : 'border-accent-main-100/60 bg-accent-main-100/5 text-accent-main-100'}
            `}
          >
            {tempKey || <span className="text-text-400">...</span>}
          </div>
          {error && <span className="text-[11px] text-danger-100">{error}</span>}
        </div>
      ) : (
        <button
          onClick={() => { setIsEditing(true); setTempKey(''); setError('') }}
          className={`
            h-7 flex items-center gap-0.5 px-1 rounded transition-colors
            ${isModified
              ? 'hover:bg-accent-main-100/10'
              : 'hover:bg-bg-200/60'}
          `}
        >
          <ShortcutDisplay 
            shortcut={config.currentKey}
            className={isModified ? '[&_kbd]:border-accent-main-100/40 [&_kbd]:text-accent-main-100' : ''}
          />
        </button>
      )}
    </div>
  )
}

// ============================================
// Main
// ============================================

const CATEGORY_ORDER: KeybindingConfig['category'][] = ['general', 'session', 'terminal', 'model', 'message', 'permission']

const CATEGORY_LABELS: Record<KeybindingConfig['category'], string> = {
  general: 'General',
  session: 'Session',
  terminal: 'Terminal',
  model: 'Model',
  message: 'Message',
  permission: 'Permission',
}

export function KeybindingsSection() {
  const { keybindings, setKeybinding, resetKeybinding, resetAll, isKeyUsed } = useKeybindingStore()
  const [search, setSearch] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  // 搜索直接过滤，不需要 toggle
  const filtered = useMemo(() => {
    if (!search.trim()) return keybindings
    const q = search.toLowerCase()
    return keybindings.filter(kb =>
      kb.label.toLowerCase().includes(q) ||
      kb.description.toLowerCase().includes(q) ||
      kb.currentKey.toLowerCase().includes(q)
    )
  }, [keybindings, search])

  const grouped = useMemo(() =>
    CATEGORY_ORDER
      .map(cat => ({ category: cat, items: filtered.filter(kb => kb.category === cat) }))
      .filter(g => g.items.length > 0),
    [filtered]
  )

  const hasModifications = keybindings.some(kb => kb.currentKey !== kb.defaultKey)

  // 自动聚焦搜索
  useEffect(() => { searchRef.current?.focus() }, [])

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-text-400 uppercase tracking-wider">Keyboard Shortcuts</span>
        {hasModifications && (
          <button
            onClick={resetAll}
            className="text-[11px] text-text-400 hover:text-danger-100 px-2 py-0.5 rounded hover:bg-danger-100/10 transition-colors"
          >
            Reset all
          </button>
        )}
      </div>

      {/* Search */}
      <div className="relative mb-3">
        <SearchIcon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-400 pointer-events-none" />
        <input
          ref={searchRef}
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Filter..."
          className="w-full h-8 pl-8 pr-3 text-[13px] bg-bg-050 border border-border-200 rounded-lg
                     text-text-100 placeholder:text-text-400 
                     focus:outline-none focus:border-accent-main-100/50 transition-colors"
        />
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto -mx-1 custom-scrollbar">
        {grouped.length === 0 ? (
          <div className="py-8 text-center text-sm text-text-400">No matches</div>
        ) : (
          grouped.map(({ category, items }) => (
            <div key={category} className="mb-3">
              <div className="px-3 py-1 text-[11px] font-medium text-text-400 uppercase tracking-wider">
                {CATEGORY_LABELS[category]}
              </div>
              {items.map(item => (
                <KeybindingRow
                  key={item.action}
                  config={item}
                  onEdit={setKeybinding}
                  onReset={resetKeybinding}
                  isKeyUsed={isKeyUsed}
                />
              ))}
            </div>
          ))
        )}
      </div>

      {/* Help */}
      <div className="pt-3 mt-2 border-t border-border-100/50 text-[11px] text-text-400">
        Click a shortcut to rebind. <kbd className="px-1 py-0.5 bg-bg-100 rounded font-mono text-text-300">Enter</kbd> confirm, <kbd className="px-1 py-0.5 bg-bg-100 rounded font-mono text-text-300">Esc</kbd> cancel.
      </div>
    </div>
  )
}
