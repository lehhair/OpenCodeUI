import { useState, useEffect, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { listDirectory, getPath } from '../../api'

// ============================================
// Types
// ============================================

interface ProjectDialogProps {
  isOpen: boolean
  onClose: () => void
  onSelect: (path: string) => void
  initialPath?: string
}

interface FileItem {
  name: string
  path: string
  type: 'file' | 'directory'
}

// ============================================
// Utils
// ============================================

const isWindows = typeof navigator !== 'undefined' && navigator.platform?.toLowerCase().includes('win')
const PATH_SEP = isWindows ? '\\' : '/'

function normalizePath(p: string): string {
  if (!p) return ''
  return isWindows ? p.replace(/\//g, '\\') : p.replace(/\\/g, '/')
}

function getDirectoryPath(path: string): string {
  const normalized = normalizePath(path)
  if (normalized.endsWith(PATH_SEP)) return normalized
  const lastSep = normalized.lastIndexOf(PATH_SEP)
  if (lastSep < 0) return '.' + PATH_SEP
  return normalized.substring(0, lastSep + 1)
}

function getFilterText(path: string): string {
  const normalized = normalizePath(path)
  if (normalized.endsWith(PATH_SEP)) return ''
  const lastSep = normalized.lastIndexOf(PATH_SEP)
  return normalized.substring(lastSep + 1)
}

function joinPath(base: string, name: string): string {
  const cleanBase = base.endsWith(PATH_SEP) ? base : base + PATH_SEP
  return cleanBase + name
}

// ============================================
// Component
// ============================================

export function ProjectDialog({ isOpen, onClose, onSelect, initialPath = '' }: ProjectDialogProps) {
  const [inputValue, setInputValue] = useState('')
  const [items, setItems] = useState<FileItem[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  // 动画状态
  const [shouldRender, setShouldRender] = useState(false)
  const [isVisible, setIsVisible] = useState(false)

  const loadedPathRef = useRef<string>('')
  const inputRef = useRef<HTMLInputElement>(null)
  const pendingSelectionRef = useRef<string | null>(null)

  // Initialize
  useEffect(() => {
    if (isOpen) {
      if (initialPath) {
        let path = normalizePath(initialPath)
        if (!path.endsWith(PATH_SEP)) path += PATH_SEP
        setInputValue(path)
      } else {
        getPath().then(p => {
          let path = normalizePath(p.home)
          if (!path.endsWith(PATH_SEP)) path += PATH_SEP
          setInputValue(path)
        }).catch(() => {})
      }
      setSelectedIndex(0)
      pendingSelectionRef.current = null
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [isOpen, initialPath])

  const currentDir = useMemo(() => getDirectoryPath(inputValue), [inputValue])
  const filterText = useMemo(() => getFilterText(inputValue), [inputValue])

  // Load directory
  useEffect(() => {
    if (!isOpen || !currentDir) return
    
    // 如果仅仅是 filter 变化，不需要重新加载 listDirectory
    // 但我们需要确保当 currentDir 变化时（进入/退出目录），重新加载
    // 这里我们简单起见，每次 currentDir 变了就加载
    // 注意：如果 items 已经包含了 currentDir 的内容，是否可以复用？
    // 现在的逻辑是：loadedPathRef.current 记录上次加载的目录
    
    if (currentDir === loadedPathRef.current && items.length > 0) {
       // 目录没变，只是 filter 变了，不需要重新 listDirectory
       // 但如果之前有 pendingSelection，可能需要处理？
       // 不，pendingSelection 只在目录变更（回退）时设置
       return
    }

    setIsLoading(true)
    setError(null)
    
    listDirectory(currentDir)
      .then(nodes => {
        const fileItems = nodes
          .filter(n => n.type === 'directory' && !n.name.startsWith('.'))
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(n => ({
            name: n.name,
            path: joinPath(currentDir, n.name),
            type: n.type
          }))
        
        setItems(fileItems)
        loadedPathRef.current = currentDir
        
        // 恢复选中位置
        if (pendingSelectionRef.current) {
          const idx = fileItems.findIndex(item => item.name === pendingSelectionRef.current)
          if (idx !== -1) {
            setSelectedIndex(idx)
          } else {
            setSelectedIndex(0)
          }
          pendingSelectionRef.current = null
        } else {
          setSelectedIndex(0)
        }
      })
      .catch(err => {
        console.error(err)
        setError(err.message)
        setItems([])
      })
      .finally(() => setIsLoading(false))
  }, [isOpen, currentDir])

  const filteredItems = useMemo(() => {
    if (!filterText) return items
    const lowerFilter = filterText.toLowerCase()
    return items.filter(item => item.name.toLowerCase().startsWith(lowerFilter))
  }, [items, filterText])

  // 滚动逻辑优化
  useEffect(() => {
    const targetId = selectedIndex === -1 ? 'project-item-up' : `project-item-${selectedIndex}`
    const el = document.getElementById(targetId)
    if (el) {
      el.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex, filteredItems])

  // Handlers
  const handleSelectFolder = (folderName: string) => {
    const fullPath = joinPath(currentDir, folderName)
    onSelect(fullPath)
    onClose()
  }

  const handleConfirmCurrent = () => {
    const path = inputValue.endsWith(PATH_SEP) ? inputValue.slice(0, -1) : inputValue
    onSelect(path)
    onClose()
  }

  const handleItemClick = (item: FileItem) => {
    setInputValue(item.path + PATH_SEP)
    inputRef.current?.focus()
  }

  const handleGoBack = () => {
    // 只有当是目录视图时才回退，或者输入框为空（可选）
    // 这里我们遵循：如果以分隔符结尾，或者是“..”点击
    let current = inputValue
    if (!current.endsWith(PATH_SEP)) {
       // 如果正在过滤，Backspace 是删除字符，不触发回退逻辑
       // 但如果是 ArrowLeft 且光标在左边，可能需要特殊处理
       // 这里 handleGoBack 主要给 ArrowLeft/.. 使用
       current = getDirectoryPath(current) // 回到当前目录视图
    } else {
       // 去掉末尾分隔符
       current = current.slice(0, -1)
    }
    
    // 获取上一级
    const parent = getDirectoryPath(current)
    if (parent && parent !== current + PATH_SEP) { // 简单防死循环
        // 记录离开的文件夹名
        const folderName = current.split(PATH_SEP).pop()
        if (folderName) pendingSelectionRef.current = folderName
        
        setInputValue(parent)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex(prev => Math.min(prev + 1, filteredItems.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex(prev => Math.max(prev - 1, 0))
        break
      case 'ArrowRight':
      case 'Tab':
        if (filteredItems.length > 0) {
          e.preventDefault()
          const selected = filteredItems[selectedIndex]
          setInputValue(selected.path + PATH_SEP)
          setSelectedIndex(0)
        }
        break
      case 'ArrowLeft':
        const inputEl = e.currentTarget as HTMLInputElement
        const isAtStart = inputEl.selectionStart === 0 && inputEl.selectionEnd === 0
        const isDirectoryView = inputValue.endsWith(PATH_SEP)

        if (isAtStart || isDirectoryView) {
           e.preventDefault()
           handleGoBack()
        }
        break
      case 'Enter':
        e.preventDefault()
        // 回车即选中（添加为项目）
        if (filteredItems.length > 0) {
          onSelect(filteredItems[selectedIndex].path)
        } else {
          const path = inputValue.endsWith(PATH_SEP) ? inputValue.slice(0, -1) : inputValue
          onSelect(path)
        }
        onClose()
        break
      case 'Escape':
        e.preventDefault()
        onClose()
        break
    }
  }

  // 动画控制 - 分两步：先渲染 DOM，再触发动画
  useEffect(() => {
    if (isOpen) {
      setShouldRender(true)
    } else {
      setIsVisible(false)
      const timer = setTimeout(() => setShouldRender(false), 200)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  // 当 DOM 渲染后再触发入场动画
  useEffect(() => {
    if (shouldRender && isOpen) {
      const timer = setTimeout(() => setIsVisible(true), 10)
      return () => clearTimeout(timer)
    }
  }, [shouldRender, isOpen])

  if (!shouldRender) return null

  return createPortal(
    <div 
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 transition-all duration-200 ease-out"
      style={{
        backgroundColor: isVisible ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0)',
        backdropFilter: isVisible ? 'blur(2px)' : 'blur(0px)',
      }}
      onMouseDown={onClose}
    >
      <div 
        className="w-[600px] max-w-full bg-bg-100/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-border-200/50 flex flex-col overflow-hidden transition-all duration-200 ease-out"
        style={{ 
          height: '500px',
          opacity: isVisible ? 1 : 0,
          transform: isVisible ? 'scale(1) translateY(0)' : 'scale(0.95) translateY(8px)',
        }}
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Header / Input Area */}
        <div className="flex-shrink-0 p-4 pb-2">
          <div className="relative group bg-bg-000 rounded-xl shadow-sm border border-border-200 focus-within:border-accent-main-100/50 focus-within:ring-2 focus-within:ring-accent-main-100/20 transition-all duration-200 flex items-center px-3 py-2.5">
            <FolderIcon className="text-text-400 w-5 h-5 flex-shrink-0 mr-3" />
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={e => {
                setInputValue(e.target.value)
                setSelectedIndex(0)
              }}
              onKeyDown={handleKeyDown}
              placeholder="Type path..."
              className="flex-1 bg-transparent border-none outline-none text-sm text-text-100 placeholder:text-text-400 font-mono leading-relaxed"
              autoComplete="off"
              spellCheck={false}
            />
            {/* Enter Hint */}
            <div className="flex items-center gap-2">
               {isLoading && <LoadingSpinner />}
               <span className="text-[10px] text-text-400 bg-bg-100 px-1.5 py-0.5 rounded border border-border-200/50">Enter</span>
            </div>
          </div>
        </div>

        {/* List Area */}
        <div className="flex-1 overflow-y-auto px-2 py-2 custom-scrollbar">
          {error ? (
            <div className="flex items-center justify-center h-full text-danger-100 text-xs px-4 text-center">
              {error}
            </div>
          ) : (
            <div className="space-y-1">
              {/* Go Up Option */}
              {inputValue.split(PATH_SEP).filter(Boolean).length > 0 && (
                <div
                  id="project-item-up"
                  onClick={() => {
                    handleGoBack()
                    inputRef.current?.focus()
                  }}
                  className={`group flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-all duration-200 ${
                    selectedIndex === -1 
                      ? 'bg-bg-000 shadow-sm ring-1 ring-border-200/50 text-text-100' 
                      : 'text-text-400 hover:bg-bg-200/50 hover:text-text-200'
                  }`}
                  onMouseEnter={() => setSelectedIndex(-1)}
                >
                  <div className={`w-5 h-5 flex items-center justify-center rounded-md transition-colors ${
                    selectedIndex === -1 ? 'bg-bg-100 text-text-100' : 'bg-transparent'
                  }`}>
                    <ArrowUpIcon className="w-4 h-4" />
                  </div>
                  <span className="text-sm font-medium">.. (Parent Directory)</span>
                </div>
              )}

              {filteredItems.length === 0 && !isLoading && (
                <div className="flex flex-col items-center justify-center h-32 text-text-400 text-xs gap-3 opacity-60">
                  <FolderIcon className="w-8 h-8 opacity-20" />
                  <span>{filterText ? 'No matching folders' : 'Empty folder'}</span>
                </div>
              )}

              {filteredItems.map((item, index) => {
                const isSelected = index === selectedIndex
                return (
                  <div
                    key={item.name}
                    id={`project-item-${index}`}
                    onClick={() => handleItemClick(item)}
                    onMouseEnter={() => setSelectedIndex(index)}
                    className={`group flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-all duration-200 border border-transparent ${
                      isSelected 
                        ? 'bg-bg-000 shadow-sm border-border-200/50 text-text-100 z-10 scale-[1.01]' 
                        : 'text-text-300 hover:bg-bg-200/50 hover:text-text-200'
                    }`}
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <FolderIcon className={`w-4 h-4 flex-shrink-0 transition-colors ${
                        isSelected ? 'text-accent-main-100' : 'text-text-400 group-hover:text-text-300'
                      }`} />
                      <span className="text-sm truncate font-medium">{item.name}</span>
                    </div>
                    
                    {isSelected && (
                      <div className="flex items-center gap-2 animate-in fade-in slide-in-from-left-2 duration-200">
                        <button 
                          onClick={(e) => {
                            e.stopPropagation()
                            handleSelectFolder(item.name)
                          }}
                          className="flex items-center gap-1.5 text-[10px] bg-accent-main-100 hover:bg-accent-main-200 px-2 py-1 rounded-md text-white font-medium transition-colors shadow-sm"
                        >
                          <PlusIcon className="w-3 h-3" />
                          Add Project
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer (Confirm Current) */}
        <div className="flex-shrink-0 p-3 bg-bg-50/80 border-t border-border-200/50 flex justify-between items-center backdrop-blur-md">
          <div className="text-[10px] text-text-400 px-1">
            <span className="opacity-70">Current: </span>
            <span className="font-mono text-text-300">{inputValue}</span>
          </div>
          <button
            onClick={handleConfirmCurrent}
            className="flex items-center gap-2 px-4 py-2 bg-bg-000 hover:bg-accent-main-100/10 border border-border-200 hover:border-accent-main-100/30 text-text-100 hover:text-accent-main-100 rounded-xl transition-all duration-200 text-xs font-medium shadow-sm hover:shadow-md active:scale-95"
          >
            <PlusIcon className="w-3.5 h-3.5" />
            Add current directory
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ============================================
// Icons
// ============================================

function FolderIcon({ className }: { className?: string }) { 
  return (
    <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
      <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
    </svg>
  ) 
}

function ArrowUpIcon({ className }: { className?: string }) { 
  return (
    <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 19V5M5 12l7-7 7 7"/>
    </svg>
  ) 
}

function LoadingSpinner() { 
  return (
    <svg className="animate-spin text-text-400" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" strokeOpacity="0.25"/>
      <path d="M12 2a10 10 0 0 1 10 10"/>
    </svg>
  ) 
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}
