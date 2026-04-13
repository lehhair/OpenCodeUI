// ============================================
// MentionMenu Component
// 文件/文件夹/Agent 选择菜单
// ============================================

import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
  useImperativeHandle,
  forwardRef,
  useMemo,
} from 'react'
import { useTranslation } from 'react-i18next'
import { searchFiles, listDirectory, type ApiAgent } from '../../api/client'
import { fileErrorHandler } from '../../utils'
import type { MentionType, MentionItem } from './types'
import { getFileName, toAbsolutePath, normalizePath } from './utils'

// ============================================
// Types
// ============================================

interface MentionMenuProps {
  isOpen: boolean
  query: string // 从 InputBox 传入的搜索词（@ 之后的文本）
  agents: ApiAgent[]
  rootPath?: string
  excludeValues?: Set<string> // 需要排除的项（已选择的）
  onSelect: (item: MentionItem) => void
  onNavigate?: (folderPath: string) => void // 点击文件夹时导航（移动端用）
  onClose: () => void
}

// 暴露给父组件的方法
export interface MentionMenuHandle {
  moveUp: () => void
  moveDown: () => void
  selectCurrent: () => void
  enterFolder: () => void
  goBack: () => void
  getSelectedItem: () => MentionItem | null
  setRestoreFolder: (name: string) => void
}

// ============================================
// MentionMenu Component
// ============================================

export const MentionMenu = forwardRef<MentionMenuHandle, MentionMenuProps>(function MentionMenu(
  { isOpen, query, agents, rootPath = '', excludeValues, onSelect, onNavigate, onClose },
  ref,
) {
  const { t } = useTranslation(['commands', 'common'])
  const [items, setItems] = useState<MentionItem[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [loading, setLoading] = useState(false)

  const menuRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const requestIdRef = useRef(0)
  // 记住返回上级时应该定位到哪个文件夹
  const restoreFolderRef = useRef<string | null>(null)
  const [dynamicMaxHeight, setDynamicMaxHeight] = useState<number | undefined>(undefined)
  const currentPath = useMemo(() => {
    const lastSlashIndex = query.lastIndexOf('/')
    return lastSlashIndex >= 0 ? query.slice(0, lastSlashIndex) || '.' : '.'
  }, [query])

  // 动态计算菜单最大高度，防止在小屏幕上被 header 遮挡
  useLayoutEffect(() => {
    let frameId: number | null = null

    const calculate = () => {
      const el = menuRef.current
      if (!el) {
        setDynamicMaxHeight(undefined)
        return
      }
      // 菜单的父容器（输入框）的位置
      const parent = el.offsetParent as HTMLElement | null
      if (!parent) {
        setDynamicMaxHeight(undefined)
        return
      }
      const parentRect = parent.getBoundingClientRect()
      // 菜单从父容器顶部向上弹出，可用空间 = 父容器顶部 - header高度(56px) - 安全间距(16px) - marginBottom(8px)
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

    // 监听 resize（键盘弹出/收起时触发）
    window.addEventListener('resize', calculate)
    // 也监听 visualViewport 的变化（移动端键盘弹出更可靠）
    window.visualViewport?.addEventListener('resize', calculate)
    return () => {
      if (frameId !== null) cancelAnimationFrame(frameId)
      window.removeEventListener('resize', calculate)
      window.visualViewport?.removeEventListener('resize', calculate)
    }
  }, [isOpen])

  // 滚动选中项到可见区域
  useEffect(() => {
    if (!listRef.current) return
    const selectedEl = listRef.current.children[selectedIndex] as HTMLElement
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  // 创建 MentionItem
  const createItem = useCallback(
    (type: MentionType, name: string, path: string, _description?: string): MentionItem => {
      const absolutePath = type !== 'agent' && rootPath ? toAbsolutePath(path, rootPath) : path

      return {
        type,
        value: absolutePath,
        displayName: name,
        relativePath: path,
      }
    },
    [rootPath],
  )

  // 加载目录内容
  const loadDirectory = useCallback(
    (path: string, filter: string = '') => {
      const requestId = ++requestIdRef.current
      setLoading(true)
      // 确保 path 不带尾斜杠
      const cleanPath = path.replace(/\/+$/, '') || '.'

      // 传入 rootPath 作为工作目录
      listDirectory(cleanPath, rootPath)
        .then(nodes => {
          if (requestId !== requestIdRef.current) return

          const folders: MentionItem[] = []
          const files: MentionItem[] = []
          const lowerFilter = filter.toLowerCase()

          nodes.forEach(n => {
            // 过滤
            if (lowerFilter && !n.name.toLowerCase().includes(lowerFilter)) {
              return
            }
            const fullPath = cleanPath === '.' ? n.name : `${cleanPath}/${n.name}`
            if (n.type === 'directory') {
              folders.push(createItem('folder', n.name, fullPath))
            } else {
              files.push(createItem('file', n.name, fullPath))
            }
          })

          // Agent 列表（只在根目录且无过滤时显示，或过滤匹配时显示）
          const agentItems: MentionItem[] =
            path === '.'
              ? agents
                  .filter(a => !a.hidden && a.mode === 'subagent')
                  .filter(a => !lowerFilter || a.name.toLowerCase().includes(lowerFilter))
                  .map(a => createItem('agent', a.name, a.name, a.description))
              : []

          const allItems = [...agentItems, ...folders, ...files].filter(item => !excludeValues?.has(item.value))

          setItems(allItems)

          // 如果有记住的文件夹名（从子目录返回时），定位到那个文件夹
          const restoreFolder = restoreFolderRef.current
          if (restoreFolder) {
            const idx = allItems.findIndex(item => item.type === 'folder' && item.displayName === restoreFolder)
            setSelectedIndex(idx >= 0 ? idx : 0)
            restoreFolderRef.current = null
          } else {
            setSelectedIndex(0)
          }
        })
        .catch(err => {
          if (requestId !== requestIdRef.current) return
          fileErrorHandler('list directory', err)
          setItems([])
        })
        .finally(() => {
          if (requestId === requestIdRef.current) {
            setLoading(false)
          }
        })
    },
    [agents, createItem, rootPath, excludeValues],
  )

  // 搜索逻辑 - 基于 query prop
  useEffect(() => {
    if (!isOpen) return

    const frameId = requestAnimationFrame(() => {
      const lastSlashIndex = query.lastIndexOf('/')

      if (lastSlashIndex >= 0) {
        const dirPath = query.slice(0, lastSlashIndex) || '.'
        const filter = query.slice(lastSlashIndex + 1)
        loadDirectory(dirPath, filter)
        return
      }

      if (query === '') {
        loadDirectory('.', '')
        return
      }

      const requestId = ++requestIdRef.current
      setLoading(true)

      searchFiles(query, { limit: 20, directory: rootPath })
        .then(paths => {
          if (requestId !== requestIdRef.current) return

          const folders: MentionItem[] = []
          const fileItems: MentionItem[] = []

          paths.forEach(path => {
            const normalized = normalizePath(path)
            const name = getFileName(normalized)
            const isDir = !name.includes('.') || path.endsWith('/')

            if (isDir) {
              folders.push(createItem('folder', name, normalized))
            } else {
              fileItems.push(createItem('file', name, normalized))
            }
          })

          const lowerQuery = query.toLowerCase()
          const agentItems = agents
            .filter(a => !a.hidden && a.mode === 'subagent')
            .filter(a => a.name.toLowerCase().includes(lowerQuery))
            .map(a => createItem('agent', a.name, a.name, a.description))

          const allItems = [...agentItems, ...folders, ...fileItems].filter(item => !excludeValues?.has(item.value))

          setItems(allItems)
          setSelectedIndex(0)
        })
        .catch(err => {
          if (requestId !== requestIdRef.current) return
          fileErrorHandler('file search', err)
          setItems([])
        })
        .finally(() => {
          if (requestId === requestIdRef.current) {
            setLoading(false)
          }
        })
    })

    return () => cancelAnimationFrame(frameId)
  }, [isOpen, query, agents, loadDirectory, createItem, rootPath, excludeValues])

  // 暴露方法给父组件
  useImperativeHandle(
    ref,
    () => ({
      moveUp: () => {
        setSelectedIndex(prev => Math.max(prev - 1, 0))
      },
      moveDown: () => {
        setSelectedIndex(prev => Math.min(prev + 1, items.length - 1))
      },
      selectCurrent: () => {
        const selectedItem = items[selectedIndex]
        if (selectedItem) {
          onSelect(selectedItem)
        }
      },
      enterFolder: () => {
        const selectedItem = items[selectedIndex]
        if (selectedItem?.type === 'folder') {
          // 返回文件夹路径，让父组件更新 query
          onSelect({ ...selectedItem, _enterFolder: true } as MentionItem & { _enterFolder: boolean })
        }
      },
      goBack: () => {
        if (currentPath !== '.' && onNavigate) {
          const parts = normalizePath(currentPath).split('/')
          parts.pop()
          const parent = parts.length === 0 ? '.' : parts.join('/')
          onNavigate(parent === '.' ? '' : `${parent}/`)
        }
      },
      getSelectedItem: () => items[selectedIndex] || null,
      setRestoreFolder: (name: string) => {
        restoreFolderRef.current = name
      },
    }),
    [items, selectedIndex, currentPath, onNavigate, onSelect],
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
      className="absolute z-50 w-full md:max-w-[360px] flex flex-col glass border border-border-200/60 rounded-xl shadow-lg overflow-hidden"
      style={{
        bottom: '100%',
        left: 0,
        marginBottom: '8px',
        maxHeight: dynamicMaxHeight ? `${dynamicMaxHeight}px` : 'min(320px, calc(100dvh - 10rem))',
      }}
    >
      {/* Items List */}
      <div ref={listRef} className="flex-1 overflow-y-auto custom-scrollbar p-1.5">
        {loading && items.length === 0 && (
          <div className="px-2 py-4 text-center text-[length:var(--fs-base)] text-text-400">{t('common:loading')}</div>
        )}

        {!loading && items.length === 0 && (
          <div className="px-2 py-4 text-center text-[length:var(--fs-base)] text-text-400">
            {query ? t('common:noResults') : t('common:emptyFolder')}
          </div>
        )}

        {/* 返回上级 - 作为列表第一项 */}
        {currentPath !== '.' && (
          <button
            className="w-full px-2.5 py-2 md:py-1.5 flex items-center gap-2 text-left rounded-lg transition-colors text-text-300 hover:bg-bg-100/40 mb-0.5"
            onClick={() => {
              if (onNavigate) {
                const pathParts = normalizePath(currentPath).split('/')
                restoreFolderRef.current = pathParts[pathParts.length - 1] || null
                const parentParts = pathParts.slice(0, -1)
                const parentPath = parentParts.length > 0 ? parentParts.join('/') + '/' : ''
                onNavigate(parentPath)
              }
            }}
            title={t('mention.goBack')}
          >
            <span className="text-[length:var(--fs-base)]">←</span>
            <span className="text-[length:var(--fs-sm)] text-text-400 truncate">{normalizePath(currentPath)}</span>
          </button>
        )}

        {items.map((item, index) => (
          <button
            key={`${item.type}-${item.value}`}
            className={`w-full px-2.5 py-2 md:py-1.5 flex items-center justify-between text-left rounded-lg transition-colors ${
              index === selectedIndex ? 'bg-accent-main-100/10 text-text-100' : 'text-text-200 hover:bg-bg-100/40'
            }`}
            onClick={() => {
              // 文件夹：点击进入目录浏览，而不是选中
              if (item.type === 'folder' && onNavigate) {
                const basePath = (item.relativePath || item.displayName).replace(/\/+$/, '')
                onNavigate(basePath + '/')
              } else {
                onSelect(item)
              }
            }}
            onPointerEnter={() => setSelectedIndex(index)}
          >
            <div className="flex-1 min-w-0">
              <div className="text-[length:var(--fs-base)] truncate">
                <TypeBadge type={item.type} />
                <span className="ml-1.5">{item.displayName}</span>
              </div>
              {item.relativePath && item.type !== 'agent' && (
                <div className="text-[length:var(--fs-sm)] text-text-400 truncate ml-[calc(2ch+0.375rem)]">{item.relativePath}</div>
              )}
            </div>
            {item.type === 'folder' && <span className="text-text-400 text-[length:var(--fs-sm)] ml-2 flex-shrink-0">→</span>}
          </button>
        ))}
      </div>

      {/* Footer Hints - 只在桌面端显示 */}
      <div className="hidden md:flex px-3 py-1.5 text-[length:var(--fs-xs)] text-text-500/70 gap-3">
        <span>{t('common:upDownSelect')}</span>
        <span>{t('common:enterConfirmShort')}</span>
        <span>{t('common:escCancel')}</span>
      </div>
    </div>
  )
})

// ============================================
// TypeBadge - 类型小标签
// ============================================

function TypeBadge({ type }: { type: MentionType }) {
  const { t } = useTranslation(['commands'])
  const colors = {
    agent: 'text-accent-main-100',
    file: 'text-info-100',
    folder: 'text-success-100',
  }

  const labels = {
    agent: t('mention.agent'),
    file: t('mention.file'),
    folder: t('mention.folder'),
  }

  return <span className={`text-[length:var(--fs-sm)] font-medium ${colors[type]}`}>{labels[type]}:</span>
}
