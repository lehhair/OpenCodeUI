// ============================================
// SlashCommandMenu Component
// 斜杠命令选择菜单
// ============================================

import { useState, useEffect, useLayoutEffect, useRef, useImperativeHandle, forwardRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { getCommands, type Command } from '../../api/command'
import { TerminalIcon } from '../../components/Icons'
import { apiErrorHandler } from '../../utils'

// ============================================
// Types
// ============================================

interface SlashCommandMenuProps {
  isOpen: boolean
  query: string // "/" 之后的文本
  rootPath?: string // 用于 API 调用
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

export const SlashCommandMenu = forwardRef<SlashCommandMenuHandle, SlashCommandMenuProps>(function SlashCommandMenu(
  { isOpen, query, rootPath, onSelect, onClose },
  ref,
) {
  const { t } = useTranslation(['commands', 'common'])
  const [commands, setCommands] = useState<Command[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [loading, setLoading] = useState(false)

  const menuRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [dynamicMaxHeight, setDynamicMaxHeight] = useState<number | undefined>(undefined)
  const requestIdRef = useRef(0)
  const filteredCommands = useMemo(() => {
    if (!isOpen) return []

    const lowerQuery = query.toLowerCase()
    return commands.filter(
      cmd => cmd.name.toLowerCase().includes(lowerQuery) || cmd.description?.toLowerCase().includes(lowerQuery),
    )
  }, [commands, isOpen, query])
  const commandColumnWidth = useMemo(() => {
    const maxCommandLength = commands.reduce((max, cmd) => Math.max(max, cmd.name.length + 1), 0)
    return `${Math.min(Math.max(maxCommandLength + 1, 10), 18)}ch`
  }, [commands])
  const activeIndex = filteredCommands.length === 0 ? 0 : Math.min(selectedIndex, filteredCommands.length - 1)

  // 动态计算菜单最大高度，防止在小屏幕上被 header 遮挡
  useLayoutEffect(() => {
    let frameId: number | null = null

    const calculate = () => {
      const el = menuRef.current
      if (!el) {
        setDynamicMaxHeight(undefined)
        return
      }
      const parent = el.offsetParent as HTMLElement | null
      if (!parent) {
        setDynamicMaxHeight(undefined)
        return
      }
      const parentRect = parent.getBoundingClientRect()
      const available = parentRect.top - 56 - 16 - 8
      if (available > 0 && available < 360) {
        setDynamicMaxHeight(available)
      } else {
        setDynamicMaxHeight(undefined)
      }
    }

    if (isOpen) {
      frameId = requestAnimationFrame(calculate)
    } else {
      frameId = requestAnimationFrame(() => setDynamicMaxHeight(undefined))
    }

    window.addEventListener('resize', calculate)
    window.visualViewport?.addEventListener('resize', calculate)
    return () => {
      if (frameId !== null) cancelAnimationFrame(frameId)
      window.removeEventListener('resize', calculate)
      window.visualViewport?.removeEventListener('resize', calculate)
    }
  }, [isOpen])

  // 加载命令列表
  useEffect(() => {
    if (!isOpen) return

    const frameId = requestAnimationFrame(() => {
      const requestId = ++requestIdRef.current
      setLoading(true)

      getCommands(rootPath)
        .then(cmds => {
          if (requestId !== requestIdRef.current) return
          setCommands(cmds)
          setSelectedIndex(0)
        })
        .catch(err => {
          if (requestId !== requestIdRef.current) return
          apiErrorHandler('load commands', err)
          setCommands([])
        })
        .finally(() => {
          if (requestId === requestIdRef.current) {
            setLoading(false)
          }
        })
    })

    return () => cancelAnimationFrame(frameId)
  }, [isOpen, rootPath])

  // query 变化时重置选中项
  useEffect(() => {
    if (!isOpen) return

    const frameId = requestAnimationFrame(() => {
      setSelectedIndex(0)
    })

    return () => cancelAnimationFrame(frameId)
  }, [isOpen, query])

  // 滚动选中项到可见区域
  useEffect(() => {
    if (!listRef.current) return
    const selectedEl = listRef.current.children[activeIndex] as HTMLElement
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: 'nearest' })
    }
  }, [activeIndex])

  // 暴露方法给父组件
  useImperativeHandle(
    ref,
    () => ({
      moveUp: () => {
        setSelectedIndex(prev => Math.max(prev - 1, 0))
      },
      moveDown: () => {
        setSelectedIndex(prev => Math.min(prev + 1, filteredCommands.length - 1))
      },
      selectCurrent: () => {
        const selected = filteredCommands[activeIndex]
        if (selected) {
          onSelect(selected)
        }
      },
      getSelectedCommand: () => filteredCommands[activeIndex] || null,
    }),
    [filteredCommands, activeIndex, onSelect],
  )

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
      className="absolute z-50 w-full md:max-w-[360px] flex flex-col bg-bg-000/50 backdrop-blur-md border border-border-200/60 rounded-xl shadow-xl overflow-hidden"
      style={{
        bottom: '100%',
        left: 0,
        marginBottom: '8px',
        maxHeight: dynamicMaxHeight ? `${dynamicMaxHeight}px` : 'min(320px, calc(100dvh - 10rem))',
      }}
    >
      {/* Header */}
      <div className="px-3 py-2 border-b border-border-200 flex items-center gap-2 text-xs text-text-400">
        <TerminalIcon size={14} />
        <span>{t('slashCommand.commands')}</span>
        {query && <span className="text-text-300">/ {query}</span>}
      </div>

      {/* Items List */}
      <div ref={listRef} className="flex-1 overflow-y-auto custom-scrollbar">
        {loading && <div className="px-3 py-4 text-center text-sm text-text-400">{t('common:loading')}</div>}

        {!loading && filteredCommands.length === 0 && (
          <div className="px-3 py-4 text-center text-sm text-text-400">
            {query ? t('slashCommand.noMatchingCommands') : t('slashCommand.noCommandsAvailable')}
          </div>
        )}

        {filteredCommands.map((cmd, index) => (
          <button
            key={cmd.name}
            title={cmd.description}
            className={`w-full px-3 py-2.5 md:py-2 flex items-center gap-3 text-left transition-colors ${
              index === activeIndex ? 'bg-accent-main-100/10' : 'hover:bg-bg-100 active:bg-bg-100'
            }`}
            onClick={() => onSelect(cmd)}
            onPointerEnter={() => setSelectedIndex(index)}
          >
            <span
              className="text-accent-main-100 font-mono text-sm flex-shrink-0 truncate leading-5"
              style={{ width: commandColumnWidth }}
            >
              /{cmd.name}
            </span>
            <div className="flex-1 min-w-0">
              {cmd.description && <div className="text-xs text-text-400 truncate">{cmd.description}</div>}
            </div>
            {cmd.keybind && <span className="text-xs text-text-500 font-mono flex-shrink-0">{cmd.keybind}</span>}
          </button>
        ))}
      </div>

      {/* Footer Hints - 只在桌面端显示 */}
      <div className="hidden md:flex px-3 py-1.5 border-t border-border-200 text-xs text-text-500 gap-3">
        <span>{t('common:upDownSelect')}</span>
        <span>{t('common:enterRun')}</span>
        <span>{t('common:escCancel')}</span>
      </div>
    </div>
  )
})
