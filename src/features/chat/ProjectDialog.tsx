import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderIcon, ArrowUpIcon, SpinnerIcon, PlusIcon } from '../../components/Icons'
import { listDirectory, getPath } from '../../api'
import { fileErrorHandler } from '../../utils'
import { Dialog } from '../../components/ui/Dialog'

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
// Constants
// ============================================

// 始终使用正斜杠显示
const PATH_SEP = '/'

// ============================================
// Utils
// ============================================

function normalizePath(p: string): string {
  if (!p) return ''
  // 只转换反斜杠为正斜杠，保留尾斜杠（不能用 normalizeToForwardSlash，它会删尾斜杠）
  return p.replace(/\\/g, '/')
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

// ============================================
// Component
// ============================================

export function ProjectDialog({ isOpen, onClose, onSelect, initialPath = '' }: ProjectDialogProps) {
  const { t } = useTranslation(['chat', 'common'])
  // State
  const [inputValue, setInputValue] = useState('')
  const [items, setItems] = useState<FileItem[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Refs
  const loadedPathRef = useRef<string>('')
  const inputRef = useRef<HTMLInputElement>(null)
  const pendingSelectionRef = useRef<string | null>(null)
  const requestIdRef = useRef(0)

  // Computed
  const currentDir = useMemo(() => getDirectoryPath(inputValue), [inputValue])
  const filterText = useMemo(() => getFilterText(inputValue), [inputValue])

  const filteredItems = useMemo(() => {
    if (!filterText) return items
    const lower = filterText.toLowerCase()
    return items.filter(item => item.name.toLowerCase().startsWith(lower))
  }, [items, filterText])

  // ==========================================
  // Initialize
  // ==========================================

  useEffect(() => {
    if (!isOpen) return

    let cancelled = false

    const timer = window.setTimeout(() => {
      loadedPathRef.current = ''
      setItems([])

      const initPath = async () => {
        let path = initialPath
        if (!path) {
          try {
            const p = await getPath()
            path = p.home
          } catch {
            /* ignore */
          }
        }

        if (cancelled) return

        path = normalizePath(path)
        if (!path.endsWith(PATH_SEP)) path += PATH_SEP
        setInputValue(path)
        setSelectedIndex(0)
        pendingSelectionRef.current = null
        setTimeout(() => inputRef.current?.focus(), 50)
      }

      void initPath()
    }, 0)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [isOpen, initialPath])

  // ==========================================
  // Load Directory
  // ==========================================

  useEffect(() => {
    if (!isOpen || !currentDir) return
    // 目录变化时始终重新加载
    if (currentDir === loadedPathRef.current) return

    let cancelled = false
    const requestId = ++requestIdRef.current
    const timer = window.setTimeout(() => {
      setIsLoading(true)
      setError(null)

      listDirectory(currentDir)
        .then(nodes => {
          if (cancelled || requestId !== requestIdRef.current) return

          const fileItems = nodes
            .filter(n => n.type === 'directory' && !n.name.startsWith('.'))
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(n => ({
              name: n.name,
              path: normalizePath(n.absolute),
              type: n.type,
            }))

          setItems(fileItems)
          loadedPathRef.current = currentDir

          if (pendingSelectionRef.current) {
            const idx = fileItems.findIndex(item => item.name === pendingSelectionRef.current)
            setSelectedIndex(idx !== -1 ? idx : 0)
            pendingSelectionRef.current = null
          } else {
            setSelectedIndex(0)
          }
        })
        .catch(err => {
          if (cancelled || requestId !== requestIdRef.current) return
          fileErrorHandler('list directory', err)
          setError(err.message)
          setItems([])
          loadedPathRef.current = ''
        })
        .finally(() => {
          if (!cancelled && requestId === requestIdRef.current) {
            setIsLoading(false)
          }
        })
    }, 0)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [isOpen, currentDir])

  // ==========================================
  // Scroll to Selection
  // ==========================================

  useEffect(() => {
    const el = document.getElementById(`project-item-${selectedIndex}`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex, filteredItems])

  // ==========================================
  // Handlers
  // ==========================================

  const handleGoBack = useCallback(() => {
    let current = inputValue
    if (!current.endsWith(PATH_SEP)) {
      current = getDirectoryPath(current)
    } else {
      current = current.slice(0, -1)
    }

    const parent = getDirectoryPath(current)
    if (parent && parent !== current + PATH_SEP) {
      const folderName = current.split(PATH_SEP).pop()
      if (folderName) pendingSelectionRef.current = folderName
      setInputValue(parent)
    }
  }, [inputValue])

  const handleItemClick = useCallback((item: FileItem) => {
    setInputValue(item.path + PATH_SEP)
    inputRef.current?.focus()
  }, [])

  const handleSelectFolder = useCallback(
    (folderPath: string) => {
      onSelect(folderPath)
      onClose()
    },
    [onSelect, onClose],
  )

  const handleConfirmCurrent = useCallback(() => {
    // 去掉尾斜杠，但保留根路径（/ 或 C:/）
    let path = inputValue
    if (path.endsWith(PATH_SEP) && path !== PATH_SEP && !/^[a-zA-Z]:\/$/.test(path)) {
      path = path.slice(0, -1)
    }
    // 只阻止空路径和 "."
    if (!path || path === '.') return
    onSelect(path)
    onClose()
  }, [inputValue, onSelect, onClose])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
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
        case 'ArrowLeft': {
          const inputEl = e.currentTarget as HTMLInputElement
          const isAtStart = inputEl.selectionStart === 0 && inputEl.selectionEnd === 0
          if (isAtStart || inputValue.endsWith(PATH_SEP)) {
            e.preventDefault()
            handleGoBack()
          }
          break
        }
        case 'Enter':
          e.preventDefault()
          if (filteredItems.length > 0) {
            const selectedPath = filteredItems[selectedIndex].path
            if (selectedPath) {
              onSelect(selectedPath)
              onClose()
            }
          } else {
            // 去掉尾斜杠，但保留根路径（/ 或 C:/）
            let path = inputValue
            if (path.endsWith(PATH_SEP) && path !== PATH_SEP && !/^[a-zA-Z]:\/$/.test(path)) {
              path = path.slice(0, -1)
            }
            if (path && path !== '.') {
              onSelect(path)
              onClose()
            }
          }
          break
        case 'Escape':
          e.preventDefault()
          onClose()
          break
      }
    },
    [filteredItems, selectedIndex, inputValue, handleGoBack, onSelect, onClose],
  )

  // ==========================================
  // Render
  // ==========================================

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      rawContent
      width={560}
      showCloseButton={false}
      allowTouchBackdropClose
      className="h-[460px]"
    >
      {/* Header */}
      <div className="p-4 pb-2 shrink-0">
        <div className="relative bg-bg-000/40 rounded-lg border border-border-200/60 focus-within:border-accent-main-100/50 transition-colors flex items-center px-3 py-2.5">
          <FolderIcon className="text-text-400 w-4 h-4 shrink-0 mr-2.5" />
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={e => {
              setInputValue(e.target.value)
              setSelectedIndex(0)
            }}
            onKeyDown={handleKeyDown}
            placeholder={t('projectDialog.typePath')}
            className="flex-1 bg-transparent border-none outline-none text-[length:var(--fs-base)] text-text-100 placeholder:text-text-400 font-mono"
            autoComplete="off"
            spellCheck={false}
          />
          {isLoading && <SpinnerIcon className="animate-spin text-text-400 w-4 h-4" size={16} />}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-2 py-1 custom-scrollbar">
        {error ? (
          <div className="flex items-center justify-center h-full text-danger-100 text-[length:var(--fs-sm)] px-4 text-center">
            {error}
          </div>
        ) : (
          <div className="space-y-0.5">
            {/* Go Up */}
            {inputValue.split(PATH_SEP).filter(Boolean).length > 0 && (
              <ListItem
                id="project-item-up"
                icon={<ArrowUpIcon className="w-3.5 h-3.5" />}
                label={t('projectDialog.parent')}
                isSelected={selectedIndex === -1}
                onClick={() => {
                  handleGoBack()
                  inputRef.current?.focus()
                }}
                onMouseEnter={() => setSelectedIndex(-1)}
              />
            )}

            {/* Empty State */}
            {filteredItems.length === 0 && !isLoading && (
              <div className="flex flex-col items-center justify-center h-28 text-text-400/60 text-[length:var(--fs-sm)] gap-2">
                <FolderIcon className="w-6 h-6 opacity-30" />
                <span>{filterText ? t('projectDialog.noMatchingFolders') : t('common:emptyFolder')}</span>
              </div>
            )}

            {/* Items */}
            {filteredItems.map((item, index) => (
              <ListItem
                key={item.name}
                id={`project-item-${index}`}
                icon={<FolderIcon className="w-3.5 h-3.5" />}
                label={item.name}
                isSelected={index === selectedIndex}
                onClick={() => handleItemClick(item)}
                onMouseEnter={() => setSelectedIndex(index)}
                action={
                  index === selectedIndex && (
                    <button
                      onClick={e => {
                        e.stopPropagation()
                        handleSelectFolder(item.path)
                      }}
                      className="flex items-center gap-1 text-[length:var(--fs-xxs)] bg-accent-main-100 hover:bg-accent-main-200 px-2 py-0.5 rounded text-oncolor-100 font-medium transition-colors"
                    >
                      <PlusIcon className="w-2.5 h-2.5" />
                      {t('common:add')}
                    </button>
                  )
                }
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="relative p-3 flex items-center gap-3 shrink-0">
        <div className="pointer-events-none absolute inset-x-3 top-0 h-px bg-border-200/30" />
        <div className="text-[length:var(--fs-xxs)] text-text-400 flex-1 min-w-0 font-mono whitespace-normal break-all leading-4">
          {inputValue}
        </div>
        <button
          onClick={handleConfirmCurrent}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-000/40 hover:bg-accent-main-100/10 border border-border-200/60 hover:border-accent-main-100/30 text-text-200 hover:text-accent-main-100 rounded-md transition-colors text-[length:var(--fs-sm)] font-medium shrink-0 whitespace-nowrap"
        >
          <PlusIcon className="w-3 h-3" />
          {t('projectDialog.addCurrent')}
        </button>
      </div>
    </Dialog>
  )
}

// ============================================
// ListItem Component
// ============================================

interface ListItemProps {
  id: string
  icon: React.ReactNode
  label: string
  isSelected: boolean
  onClick: () => void
  onMouseEnter: () => void
  action?: React.ReactNode
}

function ListItem({ id, icon, label, isSelected, onClick, onMouseEnter, action }: ListItemProps) {
  return (
    <div
      id={id}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className={`
        flex items-center justify-between px-3 py-2 rounded-md cursor-pointer transition-all duration-150
        ${
          isSelected
            ? 'bg-bg-200/60 text-text-100'
            : 'text-text-300 hover:bg-bg-200/50 hover:text-text-100'
        }
      `}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <span className={isSelected ? 'text-accent-main-100' : 'text-text-400'}>{icon}</span>
        <span className="text-[length:var(--fs-base)] truncate">{label}</span>
      </div>
      {action}
    </div>
  )
}
