// ============================================
// SlashCommandMenu Component
// 斜杠命令选择菜单
// ============================================

import { useState, useEffect, useLayoutEffect, useRef, useImperativeHandle, forwardRef } from 'react'
import { getCommands, type Command } from '../../api/command'
import { TerminalIcon } from '../../components/Icons'

// ============================================
// Types
// ============================================

interface SlashCommandMenuProps {
  isOpen: boolean
  query: string           // "/" 之后的文本
  rootPath?: string       // 用于 API 调用
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
  function SlashCommandMenu({ isOpen, query, rootPath, onSelect, onClose }, ref) {
    const [commands, setCommands] = useState<Command[]>([])
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
        if (available > 0 && available < 280) {
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

    // 加载命令列表
    useEffect(() => {
      if (!isOpen) return

      setLoading(true)
      getCommands(rootPath)
        .then(cmds => {
          setCommands(cmds)
          setLoading(false)
        })
        .catch(err => {
          console.error('Failed to load commands:', err)
          setCommands([])
          setLoading(false)
        })
    }, [isOpen, rootPath])

    // 根据 query 过滤命令
    useEffect(() => {
      if (!isOpen) {
        setFilteredCommands([])
        return
      }

      const lowerQuery = query.toLowerCase()
      const filtered = commands.filter(cmd => 
        cmd.name.toLowerCase().includes(lowerQuery) ||
        cmd.description?.toLowerCase().includes(lowerQuery)
      )
      setFilteredCommands(filtered)
      setSelectedIndex(0)
    }, [isOpen, query, commands])

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
        className="absolute z-50 w-full max-w-[320px] flex flex-col bg-bg-000 border border-border-300 rounded-lg shadow-lg overflow-hidden"
        style={{
          bottom: '100%',
          left: 0,
          marginBottom: '8px',
          maxHeight: dynamicMaxHeight ? `${dynamicMaxHeight}px` : 'min(280px, calc(100dvh - 10rem))',
        }}
      >
        {/* Header */}
        <div className="px-3 py-2 border-b border-border-200 flex items-center gap-2 text-xs text-text-400">
          <TerminalIcon size={14} />
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
              className={`w-full px-3 py-2.5 md:py-2 flex items-start gap-3 text-left transition-colors ${
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
              <div className="flex-1 min-w-0">
                {cmd.description && (
                  <div className="text-xs text-text-400 truncate">
                    {cmd.description}
                  </div>
                )}
              </div>
              {cmd.keybind && (
                <span className="text-xs text-text-500 font-mono flex-shrink-0">
                  {cmd.keybind}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Footer Hints - 只在桌面端显示 */}
        <div className="hidden md:flex px-3 py-1.5 border-t border-border-200 text-xs text-text-500 gap-3">
          <span>↑↓ select</span>
          <span>↵ run</span>
          <span>esc cancel</span>
        </div>
      </div>
    )
  }
)
