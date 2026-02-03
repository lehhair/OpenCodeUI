// ============================================
// KeybindingsSection - 快捷键设置组件
// ============================================

import { useState, useEffect, useRef } from 'react'
import { useKeybindingStore } from '../../hooks/useKeybindings'
import { keyEventToString, formatKeybinding, parseKeybinding } from '../../store/keybindingStore'
import { UndoIcon } from '../../components/Icons'
import type { KeybindingConfig, KeybindingAction } from '../../store/keybindingStore'

interface KeybindingItemProps {
  config: KeybindingConfig
  onEdit: (action: KeybindingAction, newKey: string) => void
  onReset: (action: KeybindingAction) => void
  isKeyUsed: (key: string, exclude?: KeybindingAction) => boolean
}

function KeybindingItem({ config, onEdit, onReset, isKeyUsed }: KeybindingItemProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [tempKey, setTempKey] = useState('')
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLDivElement>(null)
  
  const isModified = config.currentKey !== config.defaultKey
  
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isEditing])
  
  const handleKeyDown = (e: KeyboardEvent) => {
    e.preventDefault()
    e.stopPropagation()
    
    // 忽略单独的修饰键
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
      return
    }
    
    const newKey = keyEventToString(e)
    setTempKey(newKey)
    
    // 检查冲突
    if (isKeyUsed(newKey, config.action)) {
      setError('Key already in use')
    } else {
      setError('')
    }
  }
  
  const startEditing = () => {
    setIsEditing(true)
    setTempKey('')
    setError('')
  }
  
  const confirmEdit = () => {
    if (tempKey && !error) {
      onEdit(config.action, tempKey)
    }
    setIsEditing(false)
    setTempKey('')
    setError('')
  }
  
  const cancelEdit = () => {
    setIsEditing(false)
    setTempKey('')
    setError('')
  }
  
  useEffect(() => {
    if (!isEditing) return
    
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        cancelEdit()
        return
      }
      if (e.key === 'Enter' && tempKey && !error) {
        confirmEdit()
        return
      }
      handleKeyDown(e)
    }
    
    document.addEventListener('keydown', handleGlobalKeyDown)
    return () => document.removeEventListener('keydown', handleGlobalKeyDown)
  }, [isEditing, tempKey, error])
  
  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-bg-100/50 transition-colors group">
      <div className="flex-1 min-w-0">
        <div className="text-sm text-text-100">{config.label}</div>
        <div className="text-xs text-text-400 truncate">{config.description}</div>
      </div>
      
      <div className="flex items-center gap-2">
        {/* Reset button */}
        {isModified && !isEditing && (
          <button
            onClick={() => onReset(config.action)}
            className="p-1 rounded text-text-400 hover:text-text-100 hover:bg-bg-200 opacity-0 group-hover:opacity-100 transition-all"
            title="Reset to default"
          >
            <UndoIcon size={14} />
          </button>
        )}
        
        {/* Key display / editor */}
        {isEditing ? (
          <div 
            ref={inputRef}
            tabIndex={0}
            className={`min-w-[120px] px-3 py-1.5 text-sm font-mono rounded-lg border-2 text-center cursor-text
              ${error 
                ? 'border-danger-100 bg-danger-100/10 text-danger-100' 
                : 'border-accent-main-100 bg-accent-main-100/10 text-accent-main-100'
              }`}
          >
            {tempKey || 'Press keys...'}
          </div>
        ) : (
          <button
            onClick={startEditing}
            className={`min-w-[100px] px-3 py-1.5 text-sm font-mono rounded-lg border transition-colors text-center
              ${isModified 
                ? 'border-accent-main-100/50 bg-accent-main-100/5 text-accent-main-100' 
                : 'border-border-200 bg-bg-100 text-text-200 hover:border-border-300'
              }`}
          >
            {formatKeybinding(parseKeybinding(config.currentKey))}
          </button>
        )}
      </div>
    </div>
  )
}

const CATEGORY_LABELS: Record<KeybindingConfig['category'], string> = {
  general: 'General',
  session: 'Session',
  terminal: 'Terminal',
  model: 'Model',
  message: 'Message',
}

const CATEGORY_ORDER: KeybindingConfig['category'][] = ['general', 'session', 'terminal', 'model', 'message']

export function KeybindingsSection() {
  const { keybindings, setKeybinding, resetKeybinding, resetAll, isKeyUsed } = useKeybindingStore()
  
  // Group by category
  const grouped = CATEGORY_ORDER.map(cat => ({
    category: cat,
    label: CATEGORY_LABELS[cat],
    items: keybindings.filter(kb => kb.category === cat),
  })).filter(g => g.items.length > 0)
  
  const hasModifications = keybindings.some(kb => kb.currentKey !== kb.defaultKey)
  
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-text-400 uppercase tracking-wider">Keyboard Shortcuts</h3>
        {hasModifications && (
          <button
            onClick={resetAll}
            className="text-xs text-text-400 hover:text-text-100 transition-colors"
          >
            Reset All
          </button>
        )}
      </div>
      
      <div className="space-y-4 max-h-[300px] overflow-y-auto custom-scrollbar pr-1">
        {grouped.map(group => (
          <div key={group.category}>
            <div className="text-xs font-medium text-text-300 mb-1 px-3">{group.label}</div>
            <div className="space-y-0.5">
              {group.items.map(item => (
                <KeybindingItem
                  key={item.action}
                  config={item}
                  onEdit={setKeybinding}
                  onReset={resetKeybinding}
                  isKeyUsed={isKeyUsed}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      
      <p className="mt-3 text-xs text-text-400 px-1">
        Click a shortcut to edit. Press Enter to confirm or Escape to cancel.
      </p>
    </div>
  )
}
