// ============================================
// SessionChangesPanel - 会话变更查看器
// 布局：上方文件列表 + 下方 Diff 预览（类似 FileExplorer）
// 支持拖拽调整高度，CSS 变量 + requestAnimationFrame 优化
// ============================================

import { memo, useState, useEffect, useCallback, useRef, useLayoutEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { CloseIcon, RetryIcon, ChevronRightIcon } from './Icons'
import { getMaterialIconUrl } from '../utils/materialIcons'
import { DiffViewer, type ViewMode } from './DiffViewer'
import { getSessionDiff } from '../api/session'
import type { FileDiff } from '../api/types'
import { detectLanguage } from '../utils/languageUtils'
import { sessionErrorHandler } from '../utils'

// 常量
const MIN_LIST_HEIGHT = 80
const MIN_PREVIEW_HEIGHT = 120

function reconcileDiffPreviewState(diffs: FileDiff[], openFiles: string[], activeFile: string | null) {
  const availableFiles = new Set(diffs.map(diff => diff.file))
  const nextOpenFiles = openFiles.filter(file => availableFiles.has(file))

  if (nextOpenFiles.length === 0 && diffs.length > 0) {
    nextOpenFiles.push(diffs[0].file)
  }

  const nextActiveFile = activeFile && nextOpenFiles.includes(activeFile) ? activeFile : (nextOpenFiles[0] ?? null)

  return { nextOpenFiles, nextActiveFile }
}

interface SessionChangesPanelProps {
  panelTabId: string
  sessionId: string
  isResizing?: boolean
}

export const SessionChangesPanel = memo(function SessionChangesPanel({
  panelTabId,
  sessionId,
  isResizing: isPanelResizing = false,
}: SessionChangesPanelProps) {
  const { t } = useTranslation(['components', 'common'])
  const containerRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const [loading, setLoading] = useState(false)
  const [diffs, setDiffs] = useState<FileDiff[]>([])
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('unified')
  const [listMode, setListMode] = useState<'flat' | 'tree'>('tree')

  // 选中的文件（显示在预览区）
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [openDiffFiles, setOpenDiffFiles] = useState<string[]>([])

  // 展开的目录
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())

  // 内部拖拽 resize
  const [listHeight, setListHeight] = useState<number | null>(null)
  const [isResizing, setIsResizing] = useState(false)
  const rafRef = useRef<number>(0)
  const currentHeightRef = useRef<number | null>(null)
  const requestIdRef = useRef(0)
  const openDiffFilesRef = useRef<string[]>([])
  const selectedFileRef = useRef<string | null>(null)

  const isAnyResizing = isPanelResizing || isResizing

  useEffect(() => {
    openDiffFilesRef.current = openDiffFiles
  }, [openDiffFiles])

  useEffect(() => {
    selectedFileRef.current = selectedFile
  }, [selectedFile])

  // 同步高度到 CSS 变量
  useLayoutEffect(() => {
    if (!isResizing && listRef.current && listHeight !== null) {
      listRef.current.style.setProperty('--list-height', `${listHeight}px`)
      currentHeightRef.current = listHeight
    }
  }, [listHeight, isResizing])

  // 加载数据
  useEffect(() => {
    if (!sessionId) return

    let cancelled = false
    const requestId = ++requestIdRef.current
    const timer = window.setTimeout(() => {
      setLoading(true)
      setError(null)

      getSessionDiff(sessionId)
        .then(data => {
          if (cancelled || requestId !== requestIdRef.current) return

          setDiffs(data)
          setExpandedDirs(prev => (prev.size === 0 ? collectExpandedDirPaths(buildChangesTree(data)) : prev))
          const { nextOpenFiles, nextActiveFile } = reconcileDiffPreviewState(
            data,
            openDiffFilesRef.current,
            selectedFileRef.current,
          )
          setOpenDiffFiles(nextOpenFiles)
          setSelectedFile(nextActiveFile)
        })
        .catch(err => {
          if (cancelled || requestId !== requestIdRef.current) return
          sessionErrorHandler('load session diff', err)
          setError(t('sessionChanges.failedToLoad'))
        })
        .finally(() => {
          if (!cancelled && requestId === requestIdRef.current) {
            setLoading(false)
          }
        })
    }, 0)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [sessionId])

  // 刷新
  const handleRefresh = useCallback(() => {
    if (sessionId) {
      setLoading(true)
      setError(null)
      getSessionDiff(sessionId)
        .then(data => {
          setDiffs(data)
          const { nextOpenFiles, nextActiveFile } = reconcileDiffPreviewState(
            data,
            openDiffFilesRef.current,
            selectedFileRef.current,
          )
          setOpenDiffFiles(nextOpenFiles)
          setSelectedFile(nextActiveFile)
        })
        .catch(err => {
          sessionErrorHandler('load session diff', err)
          setError(t('sessionChanges.failedToLoad'))
        })
        .finally(() => setLoading(false))
    }
  }, [sessionId])

  // 选中文件
  const handleSelectFile = useCallback((file: string) => {
    setOpenDiffFiles(prev => (prev.includes(file) ? prev : [...prev, file]))
    setSelectedFile(prev => (prev === file ? prev : file))
  }, [])

  // 切换目录展开/折叠
  const handleToggleDir = useCallback((path: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }, [])

  // 构建树形结构
  const changesTree = useMemo(() => buildChangesTree(diffs), [diffs])

  // 关闭预览
  const handleClosePreview = useCallback(() => {
    setOpenDiffFiles([])
    setSelectedFile(null)
    setListHeight(null)
    currentHeightRef.current = null
  }, [])

  const handleActivatePreview = useCallback((file: string) => {
    setSelectedFile(prev => (prev === file ? prev : file))
  }, [])

  const handleClosePreviewTab = useCallback((file: string) => {
    setOpenDiffFiles(prev => {
      const index = prev.indexOf(file)
      if (index === -1) return prev

      const next = prev.filter(item => item !== file)
      setSelectedFile(current => {
        if (current !== file) return current
        return next[Math.min(index, next.length - 1)] ?? null
      })
      return next
    })
  }, [])

  const handleReorderPreviewTabs = useCallback((draggedFile: string, targetFile: string) => {
    setOpenDiffFiles(prev => {
      const draggedIndex = prev.indexOf(draggedFile)
      const targetIndex = prev.indexOf(targetFile)
      if (draggedIndex === -1 || targetIndex === -1 || draggedIndex === targetIndex) return prev

      const next = [...prev]
      const [dragged] = next.splice(draggedIndex, 1)
      next.splice(targetIndex, 0, dragged)
      return next
    })
  }, [])

  // 鼠标拖拽调整高度
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const container = containerRef.current
    const listEl = listRef.current
    if (!container || !listEl) return

    setIsResizing(true)
    const containerRect = container.getBoundingClientRect()
    const startY = e.clientY
    const startHeight = currentHeightRef.current ?? containerRect.height * 0.4

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => {
        const deltaY = moveEvent.clientY - startY
        const newHeight = startHeight + deltaY
        const maxHeight = containerRect.height - MIN_PREVIEW_HEIGHT
        const clampedHeight = Math.min(Math.max(newHeight, MIN_LIST_HEIGHT), maxHeight)
        listEl.style.setProperty('--list-height', `${clampedHeight}px`)
        currentHeightRef.current = clampedHeight
      })
    }

    const handleMouseUp = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      setIsResizing(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      if (currentHeightRef.current !== null) {
        setListHeight(currentHeightRef.current)
      }
    }

    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [])

  // 触摸拖拽调整高度
  const handleTouchResizeStart = useCallback((e: React.TouchEvent) => {
    const container = containerRef.current
    const listEl = listRef.current
    if (!container || !listEl) return

    setIsResizing(true)
    const containerRect = container.getBoundingClientRect()
    const startY = e.touches[0].clientY
    const startHeight = currentHeightRef.current ?? containerRect.height * 0.4

    const handleTouchMove = (moveEvent: TouchEvent) => {
      moveEvent.preventDefault()
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => {
        const deltaY = moveEvent.touches[0].clientY - startY
        const newHeight = startHeight + deltaY
        const maxHeight = containerRect.height - MIN_PREVIEW_HEIGHT
        const clampedHeight = Math.min(Math.max(newHeight, MIN_LIST_HEIGHT), maxHeight)
        listEl.style.setProperty('--list-height', `${clampedHeight}px`)
        currentHeightRef.current = clampedHeight
      })
    }

    const handleTouchEnd = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      setIsResizing(false)
      document.removeEventListener('touchmove', handleTouchMove)
      document.removeEventListener('touchend', handleTouchEnd)
      if (currentHeightRef.current !== null) {
        setListHeight(currentHeightRef.current)
      }
    }

    document.addEventListener('touchmove', handleTouchMove, { passive: false })
    document.addEventListener('touchend', handleTouchEnd)
  }, [])

  // 获取选中的 diff 数据
  const selectedDiff = selectedFile ? diffs.find(d => d.file === selectedFile) : null
  const previewDiffs = useMemo(
    () =>
      openDiffFiles
        .map(file => diffs.find(diff => diff.file === file))
        .filter((diff): diff is FileDiff => Boolean(diff)),
    [diffs, openDiffFiles],
  )
  const showPreview = selectedDiff !== null

  if (loading) {
    return <div className="p-4 text-center text-text-400 text-xs">{t('sessionChanges.loadingChanges')}</div>
  }

  if (error) {
    return <div className="p-4 text-center text-danger-100 text-xs">{error}</div>
  }

  if (diffs.length === 0) {
    return <div className="p-4 text-center text-text-400 text-xs">{t('sessionChanges.noChanges')}</div>
  }

  // 总统计
  const totalStats = diffs.reduce(
    (acc, d) => ({
      additions: acc.additions + d.additions,
      deletions: acc.deletions + d.deletions,
    }),
    { additions: 0, deletions: 0 },
  )

  return (
    <div ref={containerRef} className="flex flex-col h-full">
      {/* 文件列表区 */}
      <div
        ref={listRef}
        className="overflow-hidden flex flex-col shrink-0"
        style={
          {
            '--list-height': listHeight !== null ? `${listHeight}px` : '40%',
            height: showPreview ? 'var(--list-height)' : '100%',
            minHeight: showPreview ? MIN_LIST_HEIGHT : undefined,
          } as React.CSSProperties
        }
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-border-100 bg-bg-100/30 shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-text-400 uppercase tracking-wider font-bold">
              {diffs.length} file{diffs.length !== 1 ? 's' : ''}
            </span>
            <div className="flex items-center gap-2 text-[10px] font-mono">
              <span className="text-success-100">+{totalStats.additions}</span>
              <span className="text-danger-100">-{totalStats.deletions}</span>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {/* List Mode Toggle */}
            <div className="flex items-center bg-bg-200/50 rounded overflow-hidden border border-border-200/50 mr-1">
              <button
                onClick={() => setListMode('flat')}
                className={`px-2 py-0.5 text-[10px] transition-colors ${
                  listMode === 'flat' ? 'bg-bg-000 text-text-100 shadow-sm' : 'text-text-400 hover:text-text-200'
                }`}
                title="Flat list"
              >
                {t('sessionChanges.list')}
              </button>
              <button
                onClick={() => setListMode('tree')}
                className={`px-2 py-0.5 text-[10px] transition-colors ${
                  listMode === 'tree' ? 'bg-bg-000 text-text-100 shadow-sm' : 'text-text-400 hover:text-text-200'
                }`}
                title="Tree view"
              >
                {t('sessionChanges.tree')}
              </button>
            </div>

            {/* View Mode Toggle */}
            <div className="flex items-center bg-bg-200/50 rounded overflow-hidden border border-border-200/50">
              <button
                onClick={() => setViewMode('unified')}
                className={`px-2 py-0.5 text-[10px] transition-colors ${
                  viewMode === 'unified' ? 'bg-bg-000 text-text-100 shadow-sm' : 'text-text-400 hover:text-text-200'
                }`}
              >
                {t('sessionChanges.unified')}
              </button>
              <button
                onClick={() => setViewMode('split')}
                className={`px-2 py-0.5 text-[10px] transition-colors ${
                  viewMode === 'split' ? 'bg-bg-000 text-text-100 shadow-sm' : 'text-text-400 hover:text-text-200'
                }`}
              >
                {t('sessionChanges.split')}
              </button>
            </div>

            {/* Refresh */}
            <button
              onClick={handleRefresh}
              disabled={loading}
              className="p-1 text-text-400 hover:text-text-100 hover:bg-bg-200 rounded transition-colors disabled:opacity-50"
              title={t('common:refresh')}
            >
              <RetryIcon size={12} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* File List */}
        <div className="flex-1 overflow-auto panel-scrollbar-y">
          <div className="py-0.5">
            {listMode === 'tree'
              ? // Tree view
                changesTree.map(node => (
                  <ChangesTreeItem
                    key={node.path}
                    node={node}
                    depth={0}
                    selectedFile={selectedFile}
                    expandedDirs={expandedDirs}
                    onSelectFile={handleSelectFile}
                    onToggleDir={handleToggleDir}
                  />
                ))
              : // Flat list view
                diffs.map(diff => {
                  const isSelected = selectedFile === diff.file
                  const fileStatus = getFileStatus(diff)

                  return (
                    <button
                      key={diff.file}
                      onClick={() => handleSelectFile(diff.file)}
                      className={`
                      w-full min-w-0 flex items-center gap-2 px-3 py-1 text-left
                      hover:bg-bg-200/50 transition-colors text-[12px]
                      ${isSelected ? 'bg-bg-200/70 text-text-100' : 'text-text-300'}
                    `}
                    >
                      <img
                        src={getMaterialIconUrl(diff.file, 'file')}
                        alt=""
                        width={16}
                        height={16}
                        className="shrink-0"
                        loading="lazy"
                        decoding="async"
                        onError={e => {
                          e.currentTarget.style.visibility = 'hidden'
                        }}
                      />
                      <span className={`flex-1 min-w-0 font-mono truncate ${FILE_STATUS_COLOR[fileStatus]}`}>
                        {diff.file}
                      </span>
                      <div className="flex items-center gap-2 text-[10px] font-mono shrink-0">
                        {diff.additions > 0 && <span className="text-success-100">+{diff.additions}</span>}
                        {diff.deletions > 0 && <span className="text-danger-100">-{diff.deletions}</span>}
                      </div>
                    </button>
                  )
                })}
          </div>
        </div>
      </div>

      {/* Resize Handle - 扩大拖拽区域，支持触摸 */}
      {showPreview && (
        <div
          className={`
            h-2.5 cursor-row-resize shrink-0 relative
            hover:bg-accent-main-100/50 active:bg-accent-main-100 transition-colors
            border-t border-border-200
            ${isResizing ? 'bg-accent-main-100' : 'bg-transparent'}
          `}
          onMouseDown={handleResizeStart}
          onTouchStart={handleTouchResizeStart}
        />
      )}

      {/* Diff 预览区 */}
      {showPreview && selectedDiff && (
        <div className="flex-1 flex flex-col min-h-0" style={{ minHeight: MIN_PREVIEW_HEIGHT }}>
          <DiffPreviewPanel
            panelTabId={panelTabId}
            diff={selectedDiff}
            previewDiffs={previewDiffs}
            viewMode={viewMode}
            isResizing={isAnyResizing}
            onActivatePreview={handleActivatePreview}
            onClosePreview={handleClosePreviewTab}
            onReorderPreview={handleReorderPreviewTabs}
            onClose={handleClosePreview}
          />
        </div>
      )}
    </div>
  )
})

// ============================================
// Diff Preview Panel - 下方预览区
// ============================================

interface DiffPreviewPanelProps {
  panelTabId: string
  diff: FileDiff
  previewDiffs: FileDiff[]
  viewMode: ViewMode
  isResizing: boolean
  onActivatePreview: (file: string) => void
  onClosePreview: (file: string) => void
  onReorderPreview: (draggedFile: string, targetFile: string) => void
  onClose: () => void
}

const DiffPreviewPanel = memo(function DiffPreviewPanel({
  panelTabId,
  diff,
  previewDiffs,
  viewMode,
  isResizing,
  onActivatePreview,
  onClosePreview,
  onReorderPreview,
  onClose,
}: DiffPreviewPanelProps) {
  const language = detectLanguage(diff.file) || 'text'
  const { t } = useTranslation(['components', 'common'])
  const tabsScrollRef = useRef<HTMLDivElement>(null)
  const [draggedFile, setDraggedFile] = useState<string | null>(null)
  const [dragOverFile, setDragOverFile] = useState<string | null>(null)

  const handlePreviewDragEnd = useCallback(() => {
    if (draggedFile && dragOverFile && draggedFile !== dragOverFile) {
      onReorderPreview(draggedFile, dragOverFile)
    }
    setDraggedFile(null)
    setDragOverFile(null)
  }, [draggedFile, dragOverFile, onReorderPreview])

  const handleTabsWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const container = tabsScrollRef.current
    if (!container || container.scrollWidth <= container.clientWidth) return

    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
    if (delta === 0) return

    e.preventDefault()
    container.scrollLeft += delta
  }, [])

  return (
    <div className="flex flex-col h-full">
      {/* Preview Header */}
      <div className="flex items-stretch justify-between border-b border-border-100/50 bg-bg-100/30 shrink-0">
        <div
          ref={tabsScrollRef}
          onWheel={handleTabsWheel}
          className="min-w-0 flex-1 overflow-x-auto no-scrollbar px-1 py-1"
        >
          <div className="flex min-w-max items-center gap-1">
            {previewDiffs.map(previewDiff => {
              const currentFileName = previewDiff.file.split(/[/\\]/).pop() || previewDiff.file
              const isActive = previewDiff.file === diff.file
              const isDragOver = dragOverFile === previewDiff.file && draggedFile !== previewDiff.file

              return (
                <div
                  key={`${panelTabId}:${previewDiff.file}`}
                  draggable
                  onDragStart={e => {
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('text/plain', previewDiff.file)
                    setDraggedFile(previewDiff.file)
                    setDragOverFile(null)
                  }}
                  onDragOver={e => {
                    e.preventDefault()
                    if (draggedFile && draggedFile !== previewDiff.file) {
                      setDragOverFile(previewDiff.file)
                    }
                  }}
                  onDrop={e => {
                    e.preventDefault()
                    if (draggedFile && draggedFile !== previewDiff.file) {
                      setDragOverFile(previewDiff.file)
                    }
                  }}
                  onDragEnd={handlePreviewDragEnd}
                  className={
                    isActive
                      ? `flex h-7 w-44 max-w-44 shrink-0 items-center gap-1 overflow-hidden rounded-md border bg-bg-200 text-text-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] ${isDragOver ? 'border-accent-main-100/70' : 'border-border-200/60'}`
                      : `flex h-7 w-44 max-w-44 shrink-0 items-center gap-1 overflow-hidden rounded-md border bg-transparent text-text-400 hover:border-border-100/40 hover:bg-bg-100/80 hover:text-text-200 ${isDragOver ? 'border-accent-main-100/70 bg-accent-main-100/8' : 'border-transparent'}`
                  }
                  title={previewDiff.file}
                >
                  <button
                    type="button"
                    onClick={() => onActivatePreview(previewDiff.file)}
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 overflow-hidden pl-2 pr-1 text-left"
                  >
                    <img
                      src={getMaterialIconUrl(previewDiff.file, 'file')}
                      alt=""
                      width={13}
                      height={13}
                      className="shrink-0"
                      onError={e => {
                        e.currentTarget.style.visibility = 'hidden'
                      }}
                    />
                    <span className="block min-w-0 flex-1 truncate text-[11px] font-mono">{currentFileName}</span>
                    <span className="shrink-0 text-[10px] font-mono text-success-100/90">
                      {previewDiff.additions > 0 ? `+${previewDiff.additions}` : ''}
                    </span>
                    <span className="shrink-0 text-[10px] font-mono text-danger-100/90">
                      {previewDiff.deletions > 0 ? `-${previewDiff.deletions}` : ''}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={e => {
                      e.stopPropagation()
                      onClosePreview(previewDiff.file)
                    }}
                    onDragStart={e => e.stopPropagation()}
                    className="mr-1 shrink-0 rounded p-1 text-text-500 hover:bg-bg-300 hover:text-text-100 transition-colors"
                    title={`${t('common:close')} ${currentFileName}`}
                  >
                    <CloseIcon size={10} />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0 border-l border-border-100/40 px-1.5">
          <button
            onClick={onClose}
            className="p-1 text-text-400 hover:text-text-100 hover:bg-bg-200 rounded transition-colors shrink-0"
            title={t('common:closeAllTabs')}
          >
            <CloseIcon size={12} />
          </button>
        </div>
      </div>

      {/* Diff Content - DiffViewer 自带滚动 */}
      <div className="flex-1 min-h-0">
        <DiffViewer
          before={diff.before}
          after={diff.after}
          language={language}
          viewMode={viewMode}
          isResizing={isResizing}
        />
      </div>
    </div>
  )
})

// ============================================
// File Status Helpers
// ============================================

type FileStatus = 'added' | 'modified' | 'deleted'

function getFileStatus(diff: FileDiff): FileStatus {
  if (!diff.before || diff.before.trim() === '') return 'added'
  if (!diff.after || diff.after.trim() === '') return 'deleted'
  return 'modified'
}

const FILE_STATUS_COLOR: Record<FileStatus, string> = {
  added: 'text-success-100',
  deleted: 'text-danger-100',
  modified: 'text-warning-100',
}

// ============================================
// Changes Tree Data Structure
// ============================================

interface ChangesTreeNode {
  name: string
  path: string
  type: 'file' | 'directory'
  diff?: FileDiff
  children: ChangesTreeNode[]
  additions: number
  deletions: number
  status?: FileStatus
}

/**
 * 将扁平的 FileDiff[] 转换为树形结构
 */
function buildChangesTree(diffs: FileDiff[]): ChangesTreeNode[] {
  const root: ChangesTreeNode[] = []

  for (const diff of diffs) {
    const parts = diff.file.split(/[/\\]/).filter(Boolean)
    let currentLevel = root

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const isFile = i === parts.length - 1
      const currentPath = parts.slice(0, i + 1).join('/')

      let existing = currentLevel.find(n => n.name === part)

      if (!existing) {
        const status = isFile ? getFileStatus(diff) : undefined
        existing = {
          name: part,
          path: currentPath,
          type: isFile ? 'file' : 'directory',
          diff: isFile ? diff : undefined,
          children: [],
          additions: isFile ? diff.additions : 0,
          deletions: isFile ? diff.deletions : 0,
          status,
        }
        currentLevel.push(existing)
      }

      if (!isFile) {
        // 累加目录的统计
        existing.additions += diff.additions
        existing.deletions += diff.deletions
        currentLevel = existing.children
      }
    }
  }

  // 递归排序 + 计算目录状态：目录在前，文件在后，同类按名称排序
  const processNodes = (nodes: ChangesTreeNode[]): ChangesTreeNode[] => {
    return nodes
      .map(n => {
        const processedChildren = processNodes(n.children)
        // 计算目录的累积状态
        let dirStatus: FileStatus | undefined = undefined
        if (n.type === 'directory' && processedChildren.length > 0) {
          // 优先级: added > modified > deleted
          const hasAdded = processedChildren.some(c => c.status === 'added')
          const hasModified = processedChildren.some(c => c.status === 'modified')
          const hasDeleted = processedChildren.some(c => c.status === 'deleted')
          if (hasAdded) dirStatus = 'added'
          else if (hasModified) dirStatus = 'modified'
          else if (hasDeleted) dirStatus = 'deleted'
        }
        return {
          ...n,
          children: processedChildren,
          status: n.type === 'directory' ? dirStatus : n.status,
        }
      })
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
        return a.name.localeCompare(b.name)
      })
  }

  return processNodes(root)
}

function collectExpandedDirPaths(nodes: ChangesTreeNode[]): Set<string> {
  const allDirPaths = new Set<string>()

  const collectDirs = (entries: ChangesTreeNode[]) => {
    for (const node of entries) {
      if (node.type === 'directory') {
        allDirPaths.add(node.path)
        collectDirs(node.children)
      }
    }
  }

  collectDirs(nodes)
  return allDirPaths
}

// ============================================
// ChangesTreeItem Component
// ============================================

interface ChangesTreeItemProps {
  node: ChangesTreeNode
  depth: number
  selectedFile: string | null
  expandedDirs: Set<string>
  onSelectFile: (path: string) => void
  onToggleDir: (path: string) => void
}

const ChangesTreeItem = memo(function ChangesTreeItem({
  node,
  depth,
  selectedFile,
  expandedDirs,
  onSelectFile,
  onToggleDir,
}: ChangesTreeItemProps) {
  const isExpanded = expandedDirs.has(node.path)
  const isSelected = node.type === 'file' && selectedFile === node.diff?.file
  const paddingLeft = 8 + depth * 16

  // 状态颜色
  const statusColor = node.status ? FILE_STATUS_COLOR[node.status] : 'text-text-400'

  if (node.type === 'directory') {
    return (
      <>
        <button
          onClick={() => onToggleDir(node.path)}
          className="w-full min-w-0 flex items-center gap-1.5 py-1 hover:bg-bg-200/50 transition-colors text-[12px] text-text-300"
          style={{ paddingLeft }}
        >
          <ChevronRightIcon size={12} className={`shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
          <img
            src={getMaterialIconUrl(node.path, 'directory', isExpanded)}
            alt=""
            width={16}
            height={16}
            className="shrink-0"
            loading="lazy"
            decoding="async"
            onError={e => {
              e.currentTarget.style.visibility = 'hidden'
            }}
          />
          <span className={`flex-1 min-w-0 truncate text-left ${node.status ? statusColor : ''}`}>{node.name}</span>
          <div className="flex items-center gap-1.5 text-[10px] font-mono pr-3 shrink-0">
            {node.additions > 0 && <span className="text-success-100">+{node.additions}</span>}
            {node.deletions > 0 && <span className="text-danger-100">-{node.deletions}</span>}
          </div>
        </button>
        {isExpanded &&
          node.children.map(child => (
            <ChangesTreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedFile={selectedFile}
              expandedDirs={expandedDirs}
              onSelectFile={onSelectFile}
              onToggleDir={onToggleDir}
            />
          ))}
      </>
    )
  }

  // File node
  return (
    <button
      onClick={() => node.diff && onSelectFile(node.diff.file)}
      className={`
        w-full min-w-0 flex items-center gap-1.5 py-1 transition-colors text-[12px]
        hover:bg-bg-200/50
        ${isSelected ? 'bg-bg-200/70 text-text-100' : 'text-text-300'}
      `}
      style={{ paddingLeft: paddingLeft + 16 }}
    >
      <img
        src={getMaterialIconUrl(node.name, 'file')}
        alt=""
        width={16}
        height={16}
        className="shrink-0"
        loading="lazy"
        decoding="async"
        onError={e => {
          e.currentTarget.style.visibility = 'hidden'
        }}
      />
      <span
        className={`flex-1 min-w-0 font-mono truncate text-left ${node.status ? FILE_STATUS_COLOR[node.status] : ''}`}
      >
        {node.name}
      </span>
      <div className="flex items-center gap-1.5 text-[10px] font-mono pr-3 shrink-0">
        {node.additions > 0 && <span className="text-success-100">+{node.additions}</span>}
        {node.deletions > 0 && <span className="text-danger-100">-{node.deletions}</span>}
      </div>
    </button>
  )
})
