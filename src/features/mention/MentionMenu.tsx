// ============================================
// MentionMenu Component
// 文件/文件夹/Agent 选择菜单
// ============================================

import { useState, useEffect, useLayoutEffect, useRef, useCallback, useImperativeHandle, forwardRef } from 'react'
import { searchFiles, listDirectory, type ApiAgent } from '../../api/client'
import { fileErrorHandler } from '../../utils'
import type { MentionType, MentionItem } from './types'
import { getFileName, toAbsolutePath, normalizePath } from './utils'

// ============================================
// Types
// ============================================

interface MentionMenuProps {
  isOpen: boolean
  query: string          // 从 InputBox 传入的搜索词（@ 之后的文本）
  agents: ApiAgent[]
  rootPath?: string
  excludeValues?: Set<string> // 需要排除的项（已选择的）
  onSelect: (item: MentionItem) => void
  onNavigate?: (folderPath: string) => void  // 点击文件夹时导航（移动端用）
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

export const MentionMenu = forwardRef<MentionMenuHandle, MentionMenuProps>(function MentionMenu({
  isOpen,
  query,
  agents,
  rootPath = '',
  excludeValues,
  onSelect,
  onNavigate,
  onClose,
}, ref) {
  const [items, setItems] = useState<MentionItem[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  const [currentPath, setCurrentPath] = useState('.')
  
  const menuRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const searchAbortRef = useRef<AbortController | null>(null)
  // 记住返回上级时应该定位到哪个文件夹
  const restoreFolderRef = useRef<string | null>(null)
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
      // 菜单的父容器（输入框）的位置
      const parent = el.offsetParent as HTMLElement | null
      if (!parent) return
      const parentRect = parent.getBoundingClientRect()
      // 菜单从父容器顶部向上弹出，可用空间 = 父容器顶部 - header高度(56px) - 安全间距(16px) - marginBottom(8px)
      const available = parentRect.top - 56 - 16 - 8
      if (available > 0 && available < 320) {
        setDynamicMaxHeight(available)
      } else {
        setDynamicMaxHeight(undefined)
      }
    }
    calculate()
    // 监听 resize（键盘弹出/收起时触发）
    window.addEventListener('resize', calculate)
    // 也监听 visualViewport 的变化（移动端键盘弹出更可靠）
    window.visualViewport?.addEventListener('resize', calculate)
    return () => {
      window.removeEventListener('resize', calculate)
      window.visualViewport?.removeEventListener('resize', calculate)
    }
  }, [isOpen])

  // 初始化
  useEffect(() => {
    if (isOpen) {
      // 如果有待恢复的文件夹，不重置 selectedIndex（等 loadDirectory 恢复）
      if (!restoreFolderRef.current) {
        setSelectedIndex(0)
      }
      // 根据 query 解析目录路径
      const pathMatch = query.match(/^(.+\/)/)
      if (pathMatch) {
        setCurrentPath(pathMatch[1].replace(/\/$/, '') || '.')
      } else {
        setCurrentPath('.')
      }
    } else {
      setItems([])
      setCurrentPath('.')
    }
  }, [isOpen, query])

  // 滚动选中项到可见区域
  useEffect(() => {
    if (!listRef.current) return
    const selectedEl = listRef.current.children[selectedIndex] as HTMLElement
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  // 创建 MentionItem
  const createItem = useCallback((
    type: MentionType,
    name: string,
    path: string,
    _description?: string
  ): MentionItem => {
    const absolutePath = type !== 'agent' && rootPath
      ? toAbsolutePath(path, rootPath)
      : path
    
    return {
      type,
      value: absolutePath,
      displayName: name,
      relativePath: path,
    }
  }, [rootPath])

  // 加载目录内容
  const loadDirectory = useCallback((path: string, filter: string = '') => {
    setLoading(true)
    // 确保 path 不带尾斜杠
    const cleanPath = path.replace(/\/+$/, '') || '.'
    
    // 传入 rootPath 作为工作目录
    listDirectory(cleanPath, rootPath)
      .then(nodes => {
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
        const agentItems: MentionItem[] = path === '.'
          ? agents
              .filter(a => !a.hidden && a.mode === 'subagent')
              .filter(a => !lowerFilter || a.name.toLowerCase().includes(lowerFilter))
              .map(a => createItem('agent', a.name, a.name, a.description))
          : []
        
        const allItems = [...agentItems, ...folders, ...files]
          .filter(item => !excludeValues?.has(item.value))
          
        setItems(allItems)
        
        // 如果有记住的文件夹名（从子目录返回时），定位到那个文件夹
        const restoreFolder = restoreFolderRef.current
        if (restoreFolder) {
          const idx = allItems.findIndex(
            item => item.type === 'folder' && item.displayName === restoreFolder
          )
          setSelectedIndex(idx >= 0 ? idx : 0)
          restoreFolderRef.current = null
        } else {
          setSelectedIndex(0)
        }
      })
      .catch(err => {
        fileErrorHandler('list directory', err)
        setItems([])
      })
      .finally(() => setLoading(false))
  }, [agents, createItem, rootPath])

  // 搜索逻辑 - 基于 query prop
  useEffect(() => {
    if (!isOpen) return

    // 解析 query：可能是 "src/comp" 这样的路径+过滤
    // 检测是否包含目录分隔符
    const lastSlashIndex = query.lastIndexOf('/')
    
    if (lastSlashIndex >= 0) {
      // 有路径：目录部分 + 过滤部分
      const dirPath = query.slice(0, lastSlashIndex) || '.'
      const filter = query.slice(lastSlashIndex + 1)
      setCurrentPath(dirPath)
      loadDirectory(dirPath, filter)
    } else {
      // 无路径：根目录 + 过滤
      setCurrentPath('.')
      
      // 如果 query 为空，加载根目录
      if (query === '') {
        loadDirectory('.', '')
      } else {
        // 有搜索词，使用全局搜索
        searchAbortRef.current?.abort()
        searchAbortRef.current = new AbortController()
        
        setLoading(true)
        
        searchFiles(query, { limit: 20, directory: rootPath })
          .then(paths => {
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

            // Agent 也一起搜索
            const lowerQuery = query.toLowerCase()
            const agentItems = agents
              .filter(a => !a.hidden && a.mode === 'subagent')
              .filter(a => a.name.toLowerCase().includes(lowerQuery))
              .map(a => createItem('agent', a.name, a.name, a.description))
            
            const allItems = [...agentItems, ...folders, ...fileItems]
              .filter(item => !excludeValues?.has(item.value))
              
            setItems(allItems)
            setSelectedIndex(0)
          })
          .catch(err => {
            if (err.name !== 'AbortError') {
              fileErrorHandler('file search', err)
              setItems([])
            }
          })
          .finally(() => setLoading(false))
      }
    }
  }, [isOpen, query, agents, loadDirectory, createItem, rootPath])

  // 暴露方法给父组件
  useImperativeHandle(ref, () => ({
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
      if (currentPath !== '.') {
        const parts = normalizePath(currentPath).split('/')
        parts.pop()
        const parent = parts.length === 0 ? '.' : parts.join('/')
        setCurrentPath(parent)
      }
    },
    getSelectedItem: () => items[selectedIndex] || null,
    setRestoreFolder: (name: string) => {
      restoreFolderRef.current = name
    },
  }), [items, selectedIndex, currentPath, onSelect])

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
      className="absolute z-50 w-full max-w-[360px] flex flex-col bg-bg-000 border border-border-300 rounded-lg shadow-lg overflow-hidden"
      style={{
        bottom: '100%',
        left: 0,
        marginBottom: '8px',
        maxHeight: dynamicMaxHeight ? `${dynamicMaxHeight}px` : 'min(320px, calc(100dvh - 10rem))',
      }}
    >
      {/* Path Breadcrumb - 只在有路径时显示 */}
      {currentPath !== '.' && (
        <div className="px-3 py-1.5 border-b border-border-200 flex items-center gap-1 text-xs text-text-400">
          <button
            className="flex items-center gap-0.5 hover:text-text-200 active:text-text-100 transition-colors flex-shrink-0"
            onClick={() => {
              if (onNavigate) {
                // 记住当前目录名，返回后定位到它
                const pathParts = normalizePath(currentPath).split('/')
                restoreFolderRef.current = pathParts[pathParts.length - 1] || null
                const parentParts = pathParts.slice(0, -1)
                const parentPath = parentParts.length > 0 ? parentParts.join('/') + '/' : ''
                onNavigate(parentPath)
              }
            }}
            title="Go back"
          >
            <span>←</span>
          </button>
          <span>/</span>
          <span className="text-text-300 truncate">{normalizePath(currentPath)}</span>
        </div>
      )}

      {/* Items List */}
      <div ref={listRef} className="flex-1 overflow-y-auto custom-scrollbar">
        {loading && items.length === 0 && (
          <div className="px-3 py-4 text-center text-sm text-text-400">
            Loading...
          </div>
        )}
        
        {!loading && items.length === 0 && (
          <div className="px-3 py-4 text-center text-sm text-text-400">
            {query ? 'No results found' : 'Empty folder'}
          </div>
        )}
        
        {items.map((item, index) => (
          <button
            key={`${item.type}-${item.value}`}
            className={`w-full px-3 py-2.5 md:py-2 flex items-center justify-between text-left transition-colors ${
              index === selectedIndex 
                ? 'bg-accent-main-100/10' 
                : 'hover:bg-bg-100 active:bg-bg-100'
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
              <div className="text-sm text-text-100 truncate">
                <TypeBadge type={item.type} />
                <span className="ml-1.5">{item.displayName}</span>
              </div>
              {item.relativePath && item.type !== 'agent' && (
                <div className="text-xs text-text-400 truncate">{item.relativePath}</div>
              )}
            </div>
            {item.type === 'folder' && (
              <span className="text-text-400 text-xs ml-2">→</span>
            )}
          </button>
        ))}
      </div>

      {/* Footer Hints - 只在桌面端显示 */}
      <div className="hidden md:flex px-3 py-1.5 border-t border-border-200 text-xs text-text-500 gap-3">
        <span>↑↓ select</span>
        <span>↵ confirm</span>
        <span>esc cancel</span>
      </div>
    </div>
  )
})

// ============================================
// TypeBadge - 类型小标签
// ============================================

function TypeBadge({ type }: { type: MentionType }) {
  const colors = {
    agent: 'text-accent-main-100',
    file: 'text-info-100',
    folder: 'text-success-100',
  }
  
  const labels = {
    agent: 'Agent',
    file: 'File',
    folder: 'Folder',
  }
  
  return (
    <span className={`text-xs font-medium ${colors[type]}`}>
      {labels[type]}:
    </span>
  )
}
