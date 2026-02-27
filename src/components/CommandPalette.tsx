/**
 * CommandPalette - VS Code 风格的命令面板
 * 纯键盘操作的核心入口
 */

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { SearchIcon } from './Icons'
import { formatKeybinding, parseKeybinding } from '../store/keybindingStore'

// ============================================
// Types
// ============================================

export interface CommandItem {
  id: string
  label: string
  description?: string
  shortcut?: string        // 快捷键显示文本
  category?: string
  icon?: React.ReactNode
  action: () => void
  when?: () => boolean     // 条件可见
}

interface CommandPaletteProps {
  isOpen: boolean
  onClose: () => void
  commands: CommandItem[]
}

// ============================================
// Kbd Component - 单个按键显示
// ============================================

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 
                    text-[11px] font-mono font-medium leading-none
                    bg-bg-100 text-text-300 border border-border-200 rounded
                    shadow-[0_1px_0_0_var(--border-200)]">
      {children}
    </kbd>
  )
}

function ShortcutDisplay({ shortcut }: { shortcut: string }) {
  const parsed = parseKeybinding(shortcut)
  const formatted = formatKeybinding(parsed)
  const parts = formatted.split(' + ')
  
  return (
    <div className="flex items-center gap-0.5">
      {parts.map((part, i) => (
        <Kbd key={i}>{part}</Kbd>
      ))}
    </div>
  )
}

// ============================================
// CommandPalette Component
// ============================================

export function CommandPalette({ isOpen, onClose, commands }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [shouldRender, setShouldRender] = useState(false)
  const [isVisible, setIsVisible] = useState(false)

  // Animation mount/unmount
  useEffect(() => {
    if (isOpen) {
      setShouldRender(true)
      setQuery('')
      setSelectedIndex(0)
    } else {
      setIsVisible(false)
      const timer = setTimeout(() => setShouldRender(false), 150)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  useEffect(() => {
    if (shouldRender && isOpen) {
      const timer = setTimeout(() => {
        setIsVisible(true)
        inputRef.current?.focus()
      }, 10)
      return () => clearTimeout(timer)
    }
  }, [shouldRender, isOpen])

  // Filter commands
  const filteredCommands = useMemo(() => {
    const visible = commands.filter(cmd => !cmd.when || cmd.when())
    
    if (!query.trim()) return visible
    
    const q = query.toLowerCase()
    return visible.filter(cmd =>
      cmd.label.toLowerCase().includes(q) ||
      (cmd.description?.toLowerCase().includes(q)) ||
      (cmd.category?.toLowerCase().includes(q)) ||
      cmd.id.toLowerCase().includes(q)
    ).sort((a, b) => {
      // 精确前缀匹配优先
      const aStart = a.label.toLowerCase().startsWith(q) ? 0 : 1
      const bStart = b.label.toLowerCase().startsWith(q) ? 0 : 1
      return aStart - bStart
    })
  }, [commands, query])

  // Reset selection when filter changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  // Execute command
  const executeCommand = useCallback((cmd: CommandItem) => {
    onClose()
    // 延迟执行，让面板关闭动画先完成
    requestAnimationFrame(() => cmd.action())
  }, [onClose])

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex(prev => 
            prev < filteredCommands.length - 1 ? prev + 1 : 0
          )
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex(prev => 
            prev > 0 ? prev - 1 : filteredCommands.length - 1
          )
          break
        case 'Enter':
          e.preventDefault()
          if (filteredCommands[selectedIndex]) {
            executeCommand(filteredCommands[selectedIndex])
          }
          break
        case 'Escape':
          e.preventDefault()
          e.stopPropagation()
          onClose()
          break
      }
    }

    document.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => document.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [isOpen, filteredCommands, selectedIndex, executeCommand, onClose])

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return
    const el = listRef.current.querySelector(`[data-index="${selectedIndex}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  if (!shouldRender) return null

  return createPortal(
      <div 
        className="fixed inset-0 z-[200] flex items-start justify-center pt-[15vh]"
        style={{
          backgroundColor: isVisible ? 'hsl(var(--always-black) / 0.5)' : 'hsl(var(--always-black) / 0)',
          transition: 'background-color 150ms ease-out',
        }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div 
        className="w-full max-w-[560px] bg-bg-000 border border-border-200 rounded-xl shadow-2xl overflow-hidden flex flex-col"
        style={{
          maxHeight: '60vh',
          opacity: isVisible ? 1 : 0,
          transform: isVisible ? 'scale(1) translateY(0)' : 'scale(0.98) translateY(-8px)',
          transition: 'all 150ms ease-out',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input */}
        <div className="flex items-center gap-3 px-4 border-b border-border-200/50">
          <SearchIcon size={16} className="text-text-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command..."
            className="flex-1 py-3.5 text-sm bg-transparent text-text-100 placeholder:text-text-400 
                       outline-none border-none"
            autoComplete="off"
            spellCheck={false}
          />
          {query && (
            <button 
              onClick={() => setQuery('')}
              className="text-text-400 hover:text-text-200 text-xs"
            >
              Clear
            </button>
          )}
        </div>

        {/* Command List */}
        <div ref={listRef} className="overflow-y-auto custom-scrollbar flex-1 py-1">
          {filteredCommands.length === 0 ? (
            <div className="px-4 py-8 text-center text-text-400 text-sm">
              No commands found
            </div>
          ) : (
            filteredCommands.map((cmd, index) => (
              <button
                key={cmd.id}
                data-index={index}
                onClick={() => executeCommand(cmd)}
                onMouseEnter={() => setSelectedIndex(index)}
                className={`
                  w-full flex items-center justify-between px-4 py-2.5 text-left
                  transition-colors duration-75
                  ${index === selectedIndex 
                    ? 'bg-accent-main-100/10 text-text-100' 
                    : 'text-text-200 hover:bg-bg-100/50'
                  }
                `}
              >
                <div className="flex items-center gap-3 min-w-0">
                  {cmd.icon && (
                    <span className="text-text-400 shrink-0">{cmd.icon}</span>
                  )}
                  <div className="min-w-0">
                    <div className="text-sm truncate">{cmd.label}</div>
                    {cmd.description && (
                      <div className="text-xs text-text-400 truncate">{cmd.description}</div>
                    )}
                  </div>
                </div>
                {cmd.shortcut && (
                  <div className="shrink-0 ml-4">
                    <ShortcutDisplay shortcut={cmd.shortcut} />
                  </div>
                )}
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-border-200/30 flex items-center gap-4 text-[11px] text-text-400">
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd><Kbd>↓</Kbd> navigate
          </span>
          <span className="flex items-center gap-1">
            <Kbd>↵</Kbd> run
          </span>
          <span className="flex items-center gap-1">
            <Kbd>Esc</Kbd> close
          </span>
        </div>
      </div>
    </div>,
    document.body
  )
}
