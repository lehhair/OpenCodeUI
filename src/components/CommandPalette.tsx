/**
 * CommandPalette - VS Code 风格的命令面板
 * 纯键盘操作的核心入口
 */

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { SearchIcon } from './Icons'
import { formatKeybinding, parseKeybinding } from '../store/keybindingStore'
import { useDelayedRender } from '../hooks/useDelayedRender'

// ============================================
// Types
// ============================================

export interface CommandItem {
  id: string
  label: string
  description?: string
  shortcut?: string // 快捷键显示文本
  category?: string
  icon?: React.ReactNode
  action: () => void
  when?: () => boolean // 条件可见
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
    <kbd
      className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 
                    text-[length:var(--fs-xs)] font-mono font-medium leading-none
                    bg-bg-100 text-text-300 border border-border-200 rounded
                    shadow-[0_1px_0_0_var(--border-200)]"
    >
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
  const { t } = useTranslation(['components', 'common'])
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [isVisible, setIsVisible] = useState(false)
  const shouldRender = useDelayedRender(isOpen, 150)

  // Animation mount/unmount
  useEffect(() => {
    let frameId: number | null = null

    if (isOpen) {
      frameId = requestAnimationFrame(() => {
        setQuery('')
        setSelectedIndex(0)
      })
    }

    return () => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId)
      }
    }
  }, [isOpen])

  useEffect(() => {
    let frameId: number | null = null

    if (shouldRender && isOpen) {
      frameId = requestAnimationFrame(() => {
        setIsVisible(true)
        inputRef.current?.focus()
      })
    } else {
      frameId = requestAnimationFrame(() => {
        setIsVisible(false)
      })
    }

    return () => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId)
      }
    }
  }, [shouldRender, isOpen])

  // Filter commands
  const filteredCommands = useMemo(() => {
    const visible = commands.filter(cmd => !cmd.when || cmd.when())

    if (!query.trim()) return visible

    const q = query.toLowerCase()
    return visible
      .filter(
        cmd =>
          cmd.label.toLowerCase().includes(q) ||
          cmd.description?.toLowerCase().includes(q) ||
          cmd.category?.toLowerCase().includes(q) ||
          cmd.id.toLowerCase().includes(q),
      )
      .sort((a, b) => {
        // 精确前缀匹配优先
        const aStart = a.label.toLowerCase().startsWith(q) ? 0 : 1
        const bStart = b.label.toLowerCase().startsWith(q) ? 0 : 1
        return aStart - bStart
      })
  }, [commands, query])

  const activeIndex = filteredCommands.length === 0 ? 0 : Math.min(selectedIndex, filteredCommands.length - 1)

  // Execute command
  const executeCommand = useCallback(
    (cmd: CommandItem) => {
      onClose()
      // 延迟执行，让面板关闭动画先完成
      requestAnimationFrame(() => cmd.action())
    },
    [onClose],
  )

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex(prev => (prev < filteredCommands.length - 1 ? prev + 1 : 0))
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex(prev => (prev > 0 ? prev - 1 : filteredCommands.length - 1))
          break
        case 'Enter':
          e.preventDefault()
          if (filteredCommands[activeIndex]) {
            executeCommand(filteredCommands[activeIndex])
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
  }, [isOpen, filteredCommands, activeIndex, executeCommand, onClose])

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return
    const el = listRef.current.querySelector(`[data-index="${activeIndex}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  if (!shouldRender) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center px-3 pt-[15vh]"
      style={{
        backgroundColor: isVisible ? 'hsl(var(--always-black) / 0.2)' : 'hsl(var(--always-black) / 0)',
        transition: 'background-color 150ms ease-out',
      }}
      onPointerDown={(e: React.PointerEvent) => {
        // 触摸设备不走背景关闭
        if (e.pointerType === 'touch') return
        if (e.target === e.currentTarget) {
          ;(e.currentTarget as HTMLElement).dataset.backdropDown = '1'
        }
      }}
      onClick={e => {
        if (e.target === e.currentTarget && (e.currentTarget as HTMLElement).dataset.backdropDown === '1') {
          onClose()
        }
        delete (e.currentTarget as HTMLElement).dataset.backdropDown
      }}
    >
      <div
        className="w-full max-w-[min(760px,calc(100vw-24px))] sm:max-w-[min(720px,calc(100vw-32px))] lg:max-w-[760px] glass-alt border border-border-200/60 rounded-lg shadow-lg overflow-hidden flex flex-col"
        style={{
          maxHeight: '60vh',
          opacity: isVisible ? 1 : 0,
          transform: isVisible ? 'scale(1) translateY(0)' : 'scale(0.98) translateY(-8px)',
          transition: 'all 150ms ease-out',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Search Input */}
        <div className="relative flex items-center gap-3 px-4">
          <SearchIcon size={16} className="text-text-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => {
              setQuery(e.target.value)
              setSelectedIndex(0)
            }}
            placeholder={t('commandPalette.placeholder')}
            className="flex-1 py-3.5 text-[length:var(--fs-base)] bg-transparent text-text-100 placeholder:text-text-400 
                       outline-none border-none"
            autoComplete="off"
            spellCheck={false}
          />
          {query && (
            <button
              onClick={() => {
                setQuery('')
                setSelectedIndex(0)
              }}
              className="text-text-400 hover:text-text-200 text-[length:var(--fs-sm)]"
            >
              {t('common:clear')}
            </button>
          )}
          <div className="pointer-events-none absolute inset-x-3 bottom-0 h-px bg-border-200/30" />
        </div>

        {/* Command List */}
        <div ref={listRef} className="overflow-y-auto custom-scrollbar flex-1 p-1">
          {filteredCommands.length === 0 ? (
            <div className="px-4 py-8 text-center text-text-400 text-[length:var(--fs-base)]">{t('commandPalette.noCommandsFound')}</div>
          ) : (
            filteredCommands.map((cmd, index) => (
              <button
                key={cmd.id}
                data-index={index}
                onClick={() => executeCommand(cmd)}
                onMouseEnter={() => setSelectedIndex(index)}
                className={`
                  w-full flex items-center justify-between rounded-md px-2 py-2 text-left
                  transition-colors duration-100
                  ${index === activeIndex ? 'bg-bg-200/60 text-text-100' : 'text-text-300 hover:bg-bg-200/50 hover:text-text-100'}
                `}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  {cmd.icon && <span className="text-text-400 shrink-0">{cmd.icon}</span>}
                  <div className="min-w-0">
                    <div className="text-[length:var(--fs-base)] truncate">{cmd.label}</div>
                    {cmd.description && <div className="text-[length:var(--fs-sm)] text-text-400 truncate">{cmd.description}</div>}
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
        <div className="relative flex items-center gap-4 px-4 py-2 text-[length:var(--fs-xs)] text-text-400">
          <div className="pointer-events-none absolute inset-x-3 top-0 h-px bg-border-200/30" />
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> {t('common:navigate')}
          </span>
          <span className="flex items-center gap-1">
            <Kbd>↵</Kbd> {t('common:run')}
          </span>
          <span className="flex items-center gap-1">
            <Kbd>Esc</Kbd> {t('common:close')}
          </span>
        </div>
      </div>
    </div>,
    document.body,
  )
}
