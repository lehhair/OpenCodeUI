// ============================================
// SlashCommandMenu Component
// 斜杠命令选择菜单
// ============================================

import { useState, useEffect, useLayoutEffect, useRef, useImperativeHandle, forwardRef } from 'react'
import { getRemoteCommands, type Command } from '../../api/command'
import { Kbd } from '../../components/ui'

// ============================================
// Types
// ============================================

interface SlashCommandMenuProps {
  isOpen: boolean
  query: string           // "/" 之后的文本
  rootPath?: string       // 用于 API 调用
  /** 内置命令列表，由外部（InputBox → App）传入，与远端命令合并展示 */
  builtinCommands?: Command[]
  onSelect: (command: Command) => void
  onClose: () => void
}

// 暴露给父组件的方法
export interface SlashCommandMenuHandle {
  moveUp: () => void
  moveDown: () => void
  selectCurrent: () => void
  getSelectedCommand: () => Command | null
}

// ============================================
// SlashCommandMenu Component
// ============================================

export const SlashCommandMenu = forwardRef<SlashCommandMenuHandle, SlashCommandMenuProps>(
  function SlashCommandMenu({ isOpen, query, rootPath, builtinCommands = [], onSelect, onClose }, ref) {
    const [remoteCommands, setRemoteCommands] = useState<Command[]>([])
    const [filteredCommands, setFilteredCommands] = useState<Command[]>([])
    const [selectedIndex, setSelectedIndex] = useState(0)
    const [loading, setLoading] = useState(false)

    const menuRef = useRef<HTMLDivElement>(null)
    const listRef = useRef<HTMLDivElement>(null)
    const [dynamicMaxHeight, setDynamicMaxHeight] = useState<number | undefined>(undefined)

    // 动态计算菜单最大高度，防止在小屏幕上被 header 遮挡
    useLayoutEffect(() => {
      if (!isOpen || !menuRef.current) {
        setDynamicMaxHeight(undefined)
        return
      }
      const calculate = () => {
        const el = menuRef.current
        if (!el) return
        const parent = el.offsetParent as HTMLElement | null
        if (!parent) return
        const parentRect = parent.getBoundingClientRect()
        const available = parentRect.top - 56 - 16 - 8
        if (available > 0 && available < 360) {
          setDynamicMaxHeight(available)
        } else {
          setDynamicMaxHeight(undefined)
        }
      }
      calculate()
      window.addEventListener('resize', calculate)
      window.visualViewport?.addEventListener('resize', calculate)
      return () => {
        window.removeEventListener('resize', calculate)
        window.visualViewport?.removeEventListener('resize', calculate)
      }
    }, [isOpen])

    // 拉取远端命令，失败时静默降级（内置命令仍然可用）
    useEffect(() => {
      if (!isOpen) return

      setLoading(true)
      getRemoteCommands(rootPath)
        .then(cmds => setRemoteCommands(cmds))
        .catch(() => setRemoteCommands([]))
        .finally(() => setLoading(false))
    }, [isOpen, rootPath])

    // 合并远端 + 内置（去重，远端优先），再按 query 过滤
    useEffect(() => {
      if (!isOpen) {
        setFilteredCommands([])
        return
      }

      const remoteNames = new Set(remoteCommands.map(c => c.name))
      const merged = [
        ...remoteCommands,
        ...builtinCommands.filter(c => !remoteNames.has(c.name)),
      ]

      const lowerQuery = query.toLowerCase()
      const filtered = merged.filter(cmd =>
        cmd.name.toLowerCase().includes(lowerQuery) ||
        cmd.description?.toLowerCase().includes(lowerQuery),
      )
      setFilteredCommands(filtered)
      setSelectedIndex(0)
    }, [isOpen, query, remoteCommands, builtinCommands])

    // 滚动选中项到可见区域
    useEffect(() => {
      if (!listRef.current) return
      const selectedEl = listRef.current.children[selectedIndex] as HTMLElement
      if (selectedEl) {
        selectedEl.scrollIntoView({ block: 'nearest' })
      }
    }, [selectedIndex])

    // 暴露方法给父组件
    useImperativeHandle(ref, () => ({
      moveUp: () => {
        setSelectedIndex(prev => Math.max(prev - 1, 0))
      },
      moveDown: () => {
        setSelectedIndex(prev => Math.min(prev + 1, filteredCommands.length - 1))
      },
      selectCurrent: () => {
        const selected = filteredCommands[selectedIndex]
        if (selected) {
          onSelect(selected)
        }
      },
      getSelectedCommand: () => filteredCommands[selectedIndex] || null,
    }), [filteredCommands, selectedIndex, onSelect])

    // 点击外部关闭
    useEffect(() => {
      const handleClickOutside = (e: PointerEvent) => {
        if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
          onClose()
        }
      }
      if (isOpen) {
        document.addEventListener('pointerdown', handleClickOutside)
        return () => document.removeEventListener('pointerdown', handleClickOutside)
      }
    }, [isOpen, onClose])

    if (!isOpen) return null

    return (
      <div
        ref={menuRef}
        data-dropdown-open
        className="absolute z-50 w-full md:max-w-[360px] flex flex-col bg-bg-000 border border-border-300 rounded-lg shadow-lg overflow-hidden"
        style={{
          bottom: '100%',
          left: 0,
          marginBottom: '8px',
          maxHeight: dynamicMaxHeight ? `${dynamicMaxHeight}px` : 'min(320px, calc(100dvh - 10rem))',
        }}
      >
        {/* Header */}
        <div className="px-3 py-2 border-b border-border-200 flex items-center gap-2 text-xs text-text-400">
          <span>Commands</span>
          {query && <span className="text-text-300">/ {query}</span>}
        </div>

        {/* Items List */}
        <div ref={listRef} className="flex-1 overflow-y-auto custom-scrollbar">
          {loading && (
            <div className="px-3 py-4 text-center text-sm text-text-400">
              Loading...
            </div>
          )}

          {!loading && filteredCommands.length === 0 && (
            <div className="px-3 py-4 text-center text-sm text-text-400">
              {query ? 'No matching commands' : 'No commands available'}
            </div>
          )}

          {filteredCommands.map((cmd, index) => (
            <button
              key={cmd.name}
              title={cmd.description}
              className={`w-full px-3 py-2.5 md:py-2 flex items-center gap-3 text-left transition-colors ${
                index === selectedIndex
                  ? 'bg-accent-main-100/10'
                  : 'hover:bg-bg-100 active:bg-bg-100'
              }`}
              onClick={() => onSelect(cmd)}
              onPointerEnter={() => setSelectedIndex(index)}
            >
              <span className="text-accent-main-100 font-mono text-sm flex-shrink-0">
                /{cmd.name}
              </span>
              {cmd.description && (
                <span className="flex-1 min-w-0 text-xs text-text-400 truncate">
                  {cmd.description}
                </span>
              )}
              {cmd.keybind && (
                <span className="text-xs text-text-500 font-mono flex-shrink-0">
                  {cmd.keybind}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Footer Hints - 只在桌面端显示 */}
        <div className="hidden md:flex px-3 py-1.5 border-t border-border-200 text-[11px] text-text-400 items-center gap-4">
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd><Kbd>↓</Kbd> select
          </span>
          <span className="flex items-center gap-1">
            <Kbd>Tab</Kbd> complete
          </span>
          <span className="flex items-center gap-1">
            <Kbd>↵</Kbd> run
          </span>
          <span className="flex items-center gap-1">
            <Kbd>Esc</Kbd> close
          </span>
        </div>
      </div>
    )
  }
)
