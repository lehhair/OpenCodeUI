/**
 * CommandPalette - VS Code 风格的命令面板
 * 纯键盘操作的核心入口
 */

import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { SearchIcon, FileIcon, MessageSquareIcon } from './Icons'
import { searchFiles } from '../api'
import { formatKeybinding, parseKeybinding } from '../store/keybindingStore'
import { useDelayedRender } from '../hooks/useDelayedRender'
import { scrollItemIntoView } from '../utils/scrollUtils'

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
  /** 混合搜索（官方 shell/commands/palette.ts 同款）：非空查询时附带文件/会话条目 */
  directory?: string
  sessions?: Array<{ id: string; title: string; directory?: string }>
  onOpenSession?: (session: { id: string; directory?: string }) => void
  onOpenFile?: (path: string) => void
}

/** 文件/会话条目的统一形状（内部） */
interface MixedEntry {
  kind: 'file' | 'session'
  id: string
  title: string
  description?: string
  directory?: string
}

/** 官方 ENTRY_LIMIT 同款：每类最多 5 条 */
const MIXED_ENTRY_LIMIT = 5
const FILE_SEARCH_DEBOUNCE_MS = 200

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

export function CommandPalette({ isOpen, onClose, commands, directory, sessions, onOpenSession, onOpenFile }: CommandPaletteProps) {
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

  // ---- 混合搜索（官方 palette.ts 同款）：非空查询时附带文件/会话 ----

  // 文件：防抖搜索（file.find），上限 5
  const [fileEntries, setFileEntries] = useState<MixedEntry[]>([])
  useEffect(() => {
    const q = query.trim()
    if (!q || !onOpenFile) {
      setFileEntries([])
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      searchFiles(q, { directory, limit: MIXED_ENTRY_LIMIT })
        .then(paths => {
          if (cancelled) return
          setFileEntries(paths.slice(0, MIXED_ENTRY_LIMIT).map(path => ({ kind: 'file' as const, id: `file:${path}`, title: path })))
        })
        .catch(() => {
          if (!cancelled) setFileEntries([])
        })
    }, FILE_SEARCH_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, directory, onOpenFile])

  // 会话：按标题/id 过滤，上限 5
  const sessionEntries = useMemo<MixedEntry[]>(() => {
    const q = query.trim().toLowerCase()
    if (!q || !onOpenSession || !sessions?.length) return []
    return sessions
      .filter(session => session.title.toLowerCase().includes(q) || session.id.toLowerCase().includes(q))
      .slice(0, MIXED_ENTRY_LIMIT)
      .map(session => ({ kind: 'session' as const, id: `session:${session.id}`, title: session.title, description: session.id, directory: session.directory }))
  }, [query, sessions, onOpenSession])

  // 展平的混合列表：命令 → 文件 → 会话（键盘导航走这个顺序）
  const mixedEntries = useMemo(() => [...fileEntries, ...sessionEntries], [fileEntries, sessionEntries])
  const flatCount = filteredCommands.length + mixedEntries.length

  const activeIndex = flatCount === 0 ? 0 : Math.min(selectedIndex, flatCount - 1)

  // Execute command
  const executeCommand = useCallback(
    (cmd: CommandItem) => {
      onClose()
      // 延迟执行，让面板关闭动画先完成
      requestAnimationFrame(() => cmd.action())
    },
    [onClose],
  )

  // 文件/会话条目执行
  const executeMixed = useCallback(
    (entry: MixedEntry) => {
      onClose()
      requestAnimationFrame(() => {
        if (entry.kind === 'file') onOpenFile?.(entry.id.slice('file:'.length))
        else onOpenSession?.({ id: entry.id.slice('session:'.length), directory: entry.directory })
      })
    },
    [onClose, onOpenFile, onOpenSession],
  )

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex(prev => (prev < flatCount - 1 ? prev + 1 : 0))
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex(prev => (prev > 0 ? prev - 1 : flatCount - 1))
          break
        case 'Enter':
          e.preventDefault()
          if (activeIndex < filteredCommands.length) {
            if (filteredCommands[activeIndex]) executeCommand(filteredCommands[activeIndex])
          } else {
            const entry = mixedEntries[activeIndex - filteredCommands.length]
            if (entry) executeMixed(entry)
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
  }, [isOpen, filteredCommands, mixedEntries, flatCount, activeIndex, executeCommand, executeMixed, onClose])

  // Scroll selected item into view
  useLayoutEffect(() => {
    if (!listRef.current) return
    const el = listRef.current.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
    if (el) {
      scrollItemIntoView(listRef.current, el)
    }
  }, [activeIndex])

  if (!shouldRender) return null

  return createPortal(
    <div
      className="command-palette-safe-top fixed inset-0 z-[300] flex items-start justify-center px-3"
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
          {flatCount === 0 ? (
            <div className="px-4 py-8 text-center text-text-400 text-[length:var(--fs-base)]">{t('commandPalette.noCommandsFound')}</div>
          ) : (
            <>
              {filteredCommands.map((cmd, index) => (
                <button
                  key={cmd.id}
                  data-index={index}
                  onClick={() => executeCommand(cmd)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={`
                    w-full flex items-center justify-between rounded-md px-2 py-2 text-left
                    transition-colors duration-100
                    ${index === activeIndex ? 'bg-accent-main-100/10 text-text-100' : 'text-text-300 hover:bg-bg-200/50 hover:text-text-100'}
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
              ))}

              {/* 混合搜索条目（官方 palette 同款：命令之后按组列出文件/会话） */}
              {mixedEntries.length > 0 && (
                <>
                  {fileEntries.length > 0 && (
                    <div className="px-2 pt-2 pb-1 text-[length:var(--fs-xs)] font-medium text-text-500">
                      {t('commandPalette.files')}
                    </div>
                  )}
                  {fileEntries.map(entry => {
                    const index = filteredCommands.length + mixedEntries.indexOf(entry)
                    return (
                      <button
                        key={entry.id}
                        data-index={index}
                        onClick={() => executeMixed(entry)}
                        onMouseEnter={() => setSelectedIndex(index)}
                        className={`
                          w-full flex items-center gap-2.5 rounded-md px-2 py-2 text-left
                          transition-colors duration-100
                          ${index === activeIndex ? 'bg-accent-main-100/10 text-text-100' : 'text-text-300 hover:bg-bg-200/50 hover:text-text-100'}
                        `}
                      >
                        <span className="text-text-400 shrink-0"><FileIcon size={14} /></span>
                        <span className="text-[length:var(--fs-base)] truncate font-mono">{entry.title}</span>
                      </button>
                    )
                  })}
                  {sessionEntries.length > 0 && (
                    <div className="px-2 pt-2 pb-1 text-[length:var(--fs-xs)] font-medium text-text-500">
                      {t('commandPalette.sessions')}
                    </div>
                  )}
                  {sessionEntries.map(entry => {
                    const index = filteredCommands.length + mixedEntries.indexOf(entry)
                    return (
                      <button
                        key={entry.id}
                        data-index={index}
                        onClick={() => executeMixed(entry)}
                        onMouseEnter={() => setSelectedIndex(index)}
                        className={`
                          w-full flex items-center gap-2.5 rounded-md px-2 py-2 text-left
                          transition-colors duration-100
                          ${index === activeIndex ? 'bg-accent-main-100/10 text-text-100' : 'text-text-300 hover:bg-bg-200/50 hover:text-text-100'}
                        `}
                      >
                        <span className="text-text-400 shrink-0"><MessageSquareIcon size={14} /></span>
                        <span className="min-w-0 flex-1 text-[length:var(--fs-base)] truncate">{entry.title}</span>
                      </button>
                    )
                  })}
                </>
              )}
            </>
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
