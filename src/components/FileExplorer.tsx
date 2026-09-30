// ============================================
// FileExplorer - 文件浏览器组件
// 包含文件树和文件预览两个区域，支持拖拽调整高度
// 性能优化：使用 CSS 变量 + requestAnimationFrame 处理 resize
// ============================================

import { memo, useCallback, useMemo, useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useFileExplorer, type FileTreeNode } from '../hooks'
import { useVerticalSplitResize } from '../hooks/useVerticalSplitResize'
import { layoutStore, type PreviewFile } from '../store/layoutStore'
import {
  ChevronRightIcon,
  ChevronDownIcon,
  RetryIcon,
  AlertCircleIcon,
  DownloadIcon,
  MaximizeIcon,
  SearchIcon,
  CloseIcon,
} from './Icons'
import { CodePreview } from './CodePreview'
import { HtmlFilePreviewFrame } from './HtmlFilePreviewFrame'
import { PreviewTabsBar, type PreviewTabsBarItem } from './PreviewTabsBar'
import { MarkdownRenderer } from './MarkdownRenderer'
import { useFullscreenLayer } from '../contexts'
import { getMaterialIconUrl } from '../utils/materialIcons'
import { detectLanguage } from '../utils/languageUtils'
import {
  getPreviewCategory,
  isBinaryContent,
  isTextualMedia,
  buildDataUrl,
  buildTextDataUrl,
  decodeBase64Text,
  formatMimeType,
  type PreviewCategory,
} from '../utils/mimeUtils'
import { downloadFileContent } from '../utils/downloadUtils'
import { searchFiles } from '../api/file'
import type { FileContent } from '../api/types'
import { startInternalDrag } from '../lib/internalDragCore'
import { toAbsolutePath } from '../features/mention'
import { getDesktopPlatform, isTauri, isTauriMobile } from '../utils/tauri'
import type { TargetLineRange } from './codeMirrorReadonlyExtensions'

function canRevealInSystemExplorer(): boolean {
  return isTauri() && !isTauriMobile()
}

function getRevealInSystemExplorerLabel(t: (key: string) => string): string {
  switch (getDesktopPlatform()) {
    case 'windows':
      return t('fileExplorer.revealInExplorer')
    case 'macos':
      return t('fileExplorer.revealInFinder')
    default:
      return t('fileExplorer.revealInFileManager')
  }
}

async function revealPathInSystemExplorer(absolutePath: string) {
  const { revealItemInDir } = await import('@tauri-apps/plugin-opener')
  await revealItemInDir(absolutePath)
}

// 常量
const MIN_TREE_HEIGHT = 100
const MIN_PREVIEW_HEIGHT = 150

const MARKDOWN_MIME_TYPES = new Set(['text/markdown', 'text/x-markdown', 'text/md', 'application/markdown'])
const HTML_MIME_TYPES = new Set(['text/html', 'application/xhtml+xml'])

function isMarkdownPreview(language: string, mimeType?: string): boolean {
  if (language === 'markdown' || language === 'mdx') return true
  if (!mimeType) return false
  return MARKDOWN_MIME_TYPES.has(mimeType.split(';', 1)[0].toLowerCase())
}

function isHtmlPreview(language: string, mimeType?: string): boolean {
  if (language === 'html') return true
  if (!mimeType) return false
  return HTML_MIME_TYPES.has(mimeType.split(';', 1)[0].toLowerCase())
}

// 阶段 2b 移除：内容搜索（`searchText`）与符号搜索都没有 V2 端点，
// 因此下面这些只服务于内容搜索的辅助函数一并删除：
//   - `getSearchMatchRanges()`（把匹配的字节偏移换算成高亮范围）
//   - `byteOffsetToCodeUnitIndex()`（UTF-8 字节偏移 → JS 码元下标）
//   - `textEncoder`
// 迁移文档 §9.5「决策 1 = A：移除 UI」，不留置灰按钮。

interface FileExplorerProps {
  panelTabId: string
  directory?: string
  /** 数据所属服务器（右侧面板跟随焦点 session 时传入；缺省用活动服务器） */
  serverId?: string
  previewFile: PreviewFile | null
  previewFiles: PreviewFile[]
  position?: 'bottom' | 'right'
  isPanelResizing?: boolean
  sessionId?: string | null
}

export const FileExplorer = memo(function FileExplorer({
  panelTabId,
  directory,
  serverId,
  previewFile,
  previewFiles,
  position = 'right',
  isPanelResizing = false,
  sessionId,
}: FileExplorerProps) {
  const { t } = useTranslation(['components', 'common'])
  const containerRef = useRef<HTMLDivElement>(null)
  const treeRef = useRef<HTMLDivElement>(null)
  const fileContextMenuRef = useRef<HTMLDivElement>(null)
  const searchRequestIdRef = useRef(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [fileResults, setFileResults] = useState<string[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [fileContextMenu, setFileContextMenu] = useState<{ x: number; y: number; absolutePath: string } | null>(null)
  const canRevealFiles = canRevealInSystemExplorer()
  const revealInSystemExplorerLabel = useMemo(() => getRevealInSystemExplorerLabel(t), [t])
  const {
    splitHeight: treeHeight,
    isResizing,
    resetSplitHeight,
    handleResizeStart,
    handleTouchResizeStart,
  } = useVerticalSplitResize({
    containerRef,
    primaryRef: treeRef,
    cssVariableName: '--tree-height',
    minPrimaryHeight: MIN_TREE_HEIGHT,
    minSecondaryHeight: MIN_PREVIEW_HEIGHT,
  })

  // 综合 resize 状态 - 外部面板 resize 或内部 resize
  const isAnyResizing = isPanelResizing || isResizing

  const {
    tree,
    isLoading,
    error,
    expandedPaths,
    toggleExpand,
    previewContent,
    previewLoading,
    previewError,
    loadPreview,
    clearPreview,
    fileStatus,
    refresh,
  } = useFileExplorer({
    directory,
    autoLoad: true,
    sessionId: sessionId || undefined,
    serverId,
    consumerId: `file-explorer-${panelTabId}`,
  })

  // 当 previewFile 改变时加载预览
  useEffect(() => {
    if (previewFile) {
      loadPreview(previewFile.path)
    } else {
      clearPreview()
    }
  }, [previewFile, loadPreview, clearPreview])

  const handleRefresh = useCallback(async () => {
    await refresh()
    if (previewFile) {
      await loadPreview(previewFile.path)
    }
  }, [loadPreview, previewFile, refresh])

  // 处理文件点击
  const handleFileClick = useCallback(
    (node: FileTreeNode) => {
      if (node.type === 'directory') {
        toggleExpand(node.path)
      } else {
        layoutStore.openFilePreview({ path: node.path, name: node.name }, position)
      }
    },
    [toggleExpand, position],
  )

  const resolveAbsolutePath = useCallback(
    (path: string, absolute?: string) => {
      if (absolute) return absolute
      if (!directory) return null
      return toAbsolutePath(path, directory)
    },
    [directory],
  )

  const handleFileContextMenu = useCallback(
    (event: React.MouseEvent, path: string, absolute?: string) => {
      if (!canRevealFiles) return
      const absolutePath = resolveAbsolutePath(path, absolute)
      if (!absolutePath) return
      event.preventDefault()
      event.stopPropagation()
      setFileContextMenu({ x: event.clientX, y: event.clientY, absolutePath })
    },
    [canRevealFiles, resolveAbsolutePath],
  )

  const handleRevealInSystemExplorer = useCallback(() => {
    if (!fileContextMenu) return
    const absolutePath = fileContextMenu.absolutePath
    setFileContextMenu(null)
    void revealPathInSystemExplorer(absolutePath).catch(() => {})
  }, [fileContextMenu])

  useEffect(() => {
    if (!fileContextMenu) return

    const handleClickOutside = (event: MouseEvent) => {
      if (fileContextMenuRef.current && !fileContextMenuRef.current.contains(event.target as Node)) {
        setFileContextMenu(null)
      }
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFileContextMenu(null)
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [fileContextMenu])

  // 关闭预览
  const handleClosePreview = useCallback(() => {
    layoutStore.closeAllFilePreviews(panelTabId)
    resetSplitHeight()
  }, [panelTabId, resetSplitHeight])

  const handleActivatePreview = useCallback(
    (path: string) => {
      layoutStore.activateFilePreview(panelTabId, path)
    },
    [panelTabId],
  )

  const handleClosePreviewTab = useCallback(
    (path: string) => {
      layoutStore.closeFilePreview(panelTabId, path)
    },
    [panelTabId],
  )

  const handleReorderPreviewTabs = useCallback(
    (draggedPath: string, targetPath: string) => {
      layoutStore.reorderFilePreviews(panelTabId, draggedPath, targetPath)
    },
    [panelTabId],
  )

  // 是否显示预览
  const showPreview = Boolean(previewFile) || previewLoading || Boolean(previewError)
  const trimmedSearchQuery = searchQuery.trim()
  const isSearchingText = trimmedSearchQuery.length > 0

  useEffect(() => {
    if (!directory || !trimmedSearchQuery) {
      searchRequestIdRef.current += 1
      return
    }

    const requestId = ++searchRequestIdRef.current
    const timer = window.setTimeout(() => {
      setSearchLoading(true)
      setFileResults([])

      // 阶段 2b：只剩**文件名搜索**（V2 的 `GET /api/fs/find` 只匹配文件名/目录名）。
      // 内容搜索没有 V2 端点，已按迁移文档 §9.5 决策 1 整体移除。
      searchFiles(trimmedSearchQuery, { directory, limit: 50, serverId })
        .then(paths => {
          if (requestId !== searchRequestIdRef.current) return
          setFileResults(paths)
        })
        .catch(() => {
          // 文件名搜索失败静默处理（不打断浏览）
          if (requestId !== searchRequestIdRef.current) return
          setFileResults([])
        })
        .finally(() => {
          if (requestId === searchRequestIdRef.current) setSearchLoading(false)
        })
    }, 250)

    return () => {
      window.clearTimeout(timer)
    }
  }, [directory, trimmedSearchQuery, serverId])

  const handleFileResultClick = useCallback(
    (path: string) => {
      const name = path.split(/[/\\]/).pop() || path
      layoutStore.openFilePreview({ path, name }, position)
    },
    [position],
  )

  const handleSearchQueryChange = useCallback((value: string) => {
    setSearchQuery(value)
    if (!value.trim()) {
      setFileResults([])
      setSearchLoading(false)
    }
  }, [])

  // 没有选择目录
  if (!directory) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-400 text-[length:var(--fs-base)] gap-2 p-4">
        <img
          src={getMaterialIconUrl('folder', 'directory', false)}
          alt=""
          width={32}
          height={32}
          className="opacity-30"
          onError={e => {
            e.currentTarget.style.visibility = 'hidden'
          }}
        />
        <span className="text-center">{t('fileExplorer.selectProject')}</span>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="flex flex-col h-full">
      {/* File Tree - 使用 CSS 变量控制高度 */}
      <div
        ref={treeRef}
        className="overflow-hidden flex flex-col shrink-0"
        style={
          {
            '--tree-height': treeHeight !== null ? `${treeHeight}px` : '40%',
            height: showPreview ? 'var(--tree-height)' : '100%',
            minHeight: showPreview ? MIN_TREE_HEIGHT : undefined,
          } as React.CSSProperties
        }
      >
        {/* Tree Header */}
        <div className="relative flex h-10 items-center gap-2 px-3 shrink-0">
          <div className="relative group min-w-0 flex-1">
            <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-400 w-3.5 h-3.5 group-focus-within:text-accent-main-100 transition-colors" />
            <input
              type="text"
              name="file-explorer-text-search"
              value={searchQuery}
              onChange={e => handleSearchQueryChange(e.target.value)}
              placeholder={t('fileExplorer.searchFiles')}
              aria-label={t('fileExplorer.searchFiles')}
              autoComplete="off"
              className="w-full bg-bg-200/40 hover:bg-bg-200/60 focus:bg-bg-000 border border-transparent focus:border-border-200 rounded-lg py-1 pl-[30px] pr-7 text-[length:var(--fs-xs)] text-text-100 placeholder:text-text-400/70 focus-visible:ring-1 focus-visible:ring-border-200 focus-visible:ring-inset transition-all"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => handleSearchQueryChange('')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex h-5 w-5 items-center justify-center text-text-400 hover:text-text-100 rounded transition-colors"
                aria-label={t('fileExplorer.clearSearch')}
                title={t('fileExplorer.clearSearch')}
              >
                <CloseIcon size={12} />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isLoading}
            aria-label={t('common:refresh')}
            className="inline-flex h-6 w-6 items-center justify-center text-text-400 hover:text-text-100 hover:bg-bg-200/50 rounded-md transition-colors disabled:opacity-50"
            title={t('common:refresh')}
          >
            <RetryIcon size={12} className={isLoading ? 'animate-spin' : ''} />
          </button>
          <div className="pointer-events-none absolute inset-x-3 bottom-0 h-px bg-border-200/30" />
        </div>

        {/* Tree Content */}
        <div className="flex-1 overflow-auto panel-scrollbar-y">
          {isSearchingText ? (
            <FileSearchResults
              fileResults={fileResults}
              isLoading={searchLoading}
              onSelectFile={handleFileResultClick}
              onContextMenuFile={canRevealFiles ? handleFileContextMenu : undefined}
              directory={directory}
            />
          ) : isLoading && tree.length === 0 ? (
            <div className="flex items-center justify-center h-20 text-text-400 text-[length:var(--fs-sm)]">
              {t('common:loading')}
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-20 text-danger-100 text-[length:var(--fs-sm)] gap-1 px-4">
              <AlertCircleIcon size={16} />
              <span className="text-center">{error}</span>
            </div>
          ) : tree.length === 0 ? (
            <div className="flex items-center justify-center h-20 text-text-400 text-[length:var(--fs-sm)]">
              {t('fileExplorer.noFilesFound')}
            </div>
          ) : (
            <div className="py-1">
              {tree.map(node => (
                <FileTreeItem
                  key={node.path}
                  node={node}
                  depth={0}
                  expandedPaths={expandedPaths}
                  fileStatus={fileStatus}
                  onClick={handleFileClick}
                  onContextMenu={canRevealFiles ? handleFileContextMenu : undefined}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {fileContextMenu &&
        createPortal(
          <div
            ref={fileContextMenuRef}
            className="fixed z-[9999] bg-bg-100 border border-border-200 rounded-lg shadow-lg p-1 min-w-[160px]"
            style={{ left: fileContextMenu.x, top: fileContextMenu.y }}
          >
            <button
              type="button"
              onClick={handleRevealInSystemExplorer}
              className="w-full px-2.5 py-1.5 text-left text-[length:var(--fs-sm)] text-text-200 hover:bg-bg-200/60 hover:text-text-100 rounded-md transition-colors"
            >
              {revealInSystemExplorerLabel}
            </button>
          </div>,
          document.body,
        )}

      {/* Resize Handle - 与标签栏同色 */}
      {showPreview && (
        <div
          className={`
            h-1.5 cursor-row-resize shrink-0 relative
            hover:bg-accent-main-100/50 active:bg-accent-main-100 transition-colors
            ${isResizing ? 'bg-accent-main-100' : 'bg-bg-200/60'}
          `}
          onMouseDown={handleResizeStart}
          onTouchStart={handleTouchResizeStart}
        />
      )}

      {/* Preview Area */}
      {showPreview && (
        <div className="flex-1 flex flex-col min-h-0" style={{ minHeight: MIN_PREVIEW_HEIGHT }}>
          <FilePreview
            previewFiles={previewFiles}
            path={previewFile?.path ?? null}
            targetLine={previewFile?.targetLine}
            targetKey={previewFile?.targetKey}
            targetRanges={previewFile?.targetRanges}
            content={previewContent}
            isLoading={previewLoading}
            error={previewError}
            onClose={handleClosePreview}
            onActivatePreview={handleActivatePreview}
            onClosePreview={handleClosePreviewTab}
            onReorderPreview={handleReorderPreviewTabs}
            isResizing={isAnyResizing}
            directory={directory}
          />
        </div>
      )}
    </div>
  )
})

interface FileSearchResultsProps {
  /** 文件名搜索命中的路径列表（V2 的 `GET /api/fs/find` 只搜文件名/目录名） */
  fileResults: string[]
  isLoading: boolean
  onSelectFile: (path: string) => void
  onContextMenuFile?: (event: React.MouseEvent, path: string, absolute?: string) => void
  directory?: string
}

/**
 * 文件搜索结果的渲染
 *
 * ⚠️ 阶段 2b：**只剩文件名搜索**。
 *   V2 没有任何内容搜索端点（`GET /api/fs/find` 只匹配文件名/目录名），
 *   按迁移文档 §9.5「决策 1 = A」移除了内容搜索的 UI 与请求分支
 *   —— 不保留置灰按钮，也不留"内容匹配"分组。
 */
const FileSearchResults = memo(function FileSearchResults({
  fileResults,
  isLoading,
  onSelectFile,
  onContextMenuFile,
  directory,
}: FileSearchResultsProps) {
  const { t } = useTranslation(['components', 'common'])

  const hasFiles = fileResults.length > 0

  // 拖拽到输入框实现 @mention，与文件树项行为一致
  const handlePointerDragStart = useCallback(
    (e: PointerEvent<HTMLButtonElement>, path: string) => {
      if (!directory) return
      const name = path.split(/[/\\]/).pop() || path
      startInternalDrag(e, {
        kind: 'file-mention',
        file: {
          type: 'file',
          path,
          absolute: toAbsolutePath(path, directory),
          name,
        },
      })
    },
    [directory],
  )

  if (isLoading && !hasFiles) {
    return (
      <div className="flex items-center justify-center h-20 text-text-400 text-[length:var(--fs-sm)]">
        {t('common:loading')}
      </div>
    )
  }

  if (!hasFiles) {
    return (
      <div className="flex items-center justify-center h-20 text-text-400 text-[length:var(--fs-sm)]">
        {t('fileExplorer.noFileMatches')}
      </div>
    )
  }

  return (
    <div className="py-1">
      <div className="px-2 py-1 text-[length:var(--fs-xxs)] font-medium text-text-500 uppercase tracking-wide">
        {t('fileExplorer.fileMatches')}
      </div>
      {fileResults.map(path => {
        const name = path.split(/[/\\]/).pop() || path
        return (
          <button
            key={`file:${path}`}
            type="button"
            onPointerDown={e => handlePointerDragStart(e, path)}
            onClick={() => onSelectFile(path)}
            onContextMenu={event => onContextMenuFile?.(event, path)}
            className="w-full px-2 py-1.5 text-left hover:bg-bg-200/50 transition-colors"
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <img
                src={getMaterialIconUrl(path, 'file', false)}
                alt=""
                width={16}
                height={16}
                draggable={false}
                className="shrink-0"
                loading="lazy"
                decoding="async"
                onError={e => {
                  e.currentTarget.style.visibility = 'hidden'
                }}
              />
              <span className="truncate text-[length:var(--fs-sm)] text-text-200">{name}</span>
            </div>
            <div className="mt-0.5 truncate pl-[22px] text-[length:var(--fs-xxs)] text-text-500">{path}</div>
          </button>
        )
      })}
      {isLoading && (
        <div className="px-2 py-1.5 text-center text-[length:var(--fs-xs)] text-text-500">{t('common:loading')}</div>
      )}
    </div>
  )
})

// ============================================
// File Tree Item
// ============================================

interface FileTreeItemProps {
  node: FileTreeNode
  depth: number
  expandedPaths: Set<string>
  fileStatus: Map<string, { status: string }>
  onClick: (node: FileTreeNode) => void
  onContextMenu?: (event: React.MouseEvent, path: string, absolute?: string) => void
}

const FileTreeItem = memo(function FileTreeItem({
  node,
  depth,
  expandedPaths,
  fileStatus,
  onClick,
  onContextMenu,
}: FileTreeItemProps) {
  const isExpanded = expandedPaths.has(node.path)
  const isDirectory = node.type === 'directory'
  // node.path 可能用反斜杠（Windows），statusMap key 统一用正斜杠
  const status = fileStatus.get(node.path) || fileStatus.get(node.path.replace(/\\/g, '/'))

  // 状态颜色
  const statusColor = useMemo(() => {
    if (!status) return null
    switch (status.status) {
      case 'added':
        return 'text-success-100'
      case 'modified':
        return 'text-warning-100'
      case 'deleted':
        return 'text-danger-100'
      default:
        return null
    }
  }, [status])

  // 拖拽到输入框实现 @mention。使用 pointer 拖拽，避免 Tauri 原生文件 drop 接管 HTML5 DnD。
  const handlePointerDragStart = useCallback(
    (e: PointerEvent<HTMLButtonElement>) => {
      const fileData = {
        type: (isDirectory ? 'folder' : 'file') as 'file' | 'folder',
        path: node.path, // 相对路径
        absolute: node.absolute, // 绝对路径
        name: node.name,
      }
      startInternalDrag(e, { kind: 'file-mention', file: fileData })
    },
    [node.path, node.absolute, node.name, isDirectory],
  )

  return (
    <div>
      <button
        type="button"
        onPointerDown={handlePointerDragStart}
        onClick={() => onClick(node)}
        onContextMenu={event => onContextMenu?.(event, node.path, node.absolute)}
        className={`
          w-full flex items-center gap-1 px-2 py-0.5 text-left cursor-default
          select-none hover:bg-bg-200/50 transition-colors text-[length:var(--fs-sm)]
          text-text-300
        `}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {/* Expand/Collapse Icon */}
        {isDirectory ? (
          <span className="w-4 h-4 flex items-center justify-center text-text-400 shrink-0">
            {isExpanded ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
          </span>
        ) : (
          <span className="w-4 shrink-0" />
        )}

        {/* File/Folder Icon - Material Icon Theme */}
        <img
          src={getMaterialIconUrl(node.path, isDirectory ? 'directory' : 'file', isExpanded)}
          alt=""
          width={16}
          height={16}
          draggable={false}
          className="shrink-0"
          loading="lazy"
          decoding="async"
          onError={e => {
            e.currentTarget.style.visibility = 'hidden'
          }}
        />

        {/* Name */}
        <span className={`truncate flex-1 ${statusColor || ''}`}>{node.name}</span>

        {/* Loading Indicator */}
        {node.isLoading && (
          <span className="w-3 h-3 border border-text-400 border-t-transparent rounded-full animate-spin shrink-0" />
        )}
      </button>

      {/* Children */}
      {isDirectory && isExpanded && node.children && (
        <div>
          {node.children.map(child => (
            <FileTreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              expandedPaths={expandedPaths}
              fileStatus={fileStatus}
              onClick={onClick}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      )}
    </div>
  )
})

// ============================================
// File Preview
// ============================================

interface FilePreviewProps {
  previewFiles: PreviewFile[]
  path: string | null
  targetLine?: number
  targetKey?: string
  targetRanges?: readonly TargetLineRange[]
  content: FileContent | null
  isLoading: boolean
  error: string | null
  onClose: () => void
  onActivatePreview: (path: string) => void
  onClosePreview: (path: string) => void
  onReorderPreview: (draggedPath: string, targetPath: string) => void
  isResizing?: boolean
  directory?: string
}

function FilePreview({
  previewFiles,
  path,
  targetLine,
  targetKey,
  targetRanges,
  content,
  isLoading,
  error,
  onClose,
  onActivatePreview,
  onClosePreview,
  onReorderPreview,
  isResizing = false,
  directory,
}: FilePreviewProps) {
  const { t } = useTranslation(['components', 'common'])
  const scrollRef = useRef<HTMLDivElement>(null)

  // 获取文件名
  const fileName = path?.split(/[/\\]/).pop() || 'Untitled'
  const language = path ? detectLanguage(path) : 'text'

  // 下载当前文件
  const handleDownload = useCallback(() => {
    if (content) {
      downloadFileContent(content, fileName)
    }
  }, [content, fileName])

  const previewTabItems = useMemo<PreviewTabsBarItem[]>(
    () =>
      previewFiles.map(file => ({
        id: file.path,
        title: file.path,
        closeTitle: `${t('common:close')} ${file.name}`,
        iconPath: file.path,
        label: <span className="block whitespace-nowrap text-[length:var(--fs-xs)] font-mono">{file.name}</span>,
      })),
    [previewFiles, t],
  )

  // 处理内容类型分发
  const displayContent = useMemo(() => {
    if (!content) return null

    const category = getPreviewCategory(content.mimeType)

    if (isHtmlPreview(language, content.mimeType)) {
      return {
        type: 'html' as const,
        text: isBinaryContent(content.encoding) ? decodeBase64Text(content.content) : content.content,
      }
    }

    if (isMarkdownPreview(language, content.mimeType)) {
      const text = isBinaryContent(content.encoding) ? decodeBase64Text(content.content) : content.content
      return {
        type: 'markdown' as const,
        text,
      }
    }

    // 文本型可渲染媒体（如 SVG）— 同时提供渲染和源码
    // 优先级最高：即使以 base64 传输，也支持解码为文本查看
    if (isTextualMedia(content.mimeType)) {
      const isBase64 = isBinaryContent(content.encoding)
      const text = isBase64 ? decodeBase64Text(content.content) : content.content
      const dataUrl = isBase64
        ? buildDataUrl(content.mimeType!, content.content)
        : buildTextDataUrl(content.mimeType!, content.content)
      return {
        type: 'textMedia' as const,
        text,
        dataUrl,
        category: category!,
        mimeType: content.mimeType!,
      }
    }

    // 二进制 + 可预览的媒体类型
    if (isBinaryContent(content.encoding) && category) {
      return {
        type: 'media' as const,
        category,
        dataUrl: buildDataUrl(content.mimeType!, content.content),
        mimeType: content.mimeType!,
      }
    }

    // 二进制 + 不可预览
    if (isBinaryContent(content.encoding)) {
      return {
        type: 'binary' as const,
        mimeType: content.mimeType || 'application/octet-stream',
      }
    }

    // diff 渲染交给 Changes 面板，Files 预览只显示文件内容
    // if (content.patch && content.patch.hunks.length > 0) {
    //   return {
    //     type: 'diff' as const,
    //     hunks: content.patch.hunks,
    //   }
    // }

    // 显示文件内容
    return {
      type: 'text' as const,
      text: content.content,
    }
  }, [content, language])

  // 全屏内容
  const fullscreenContent = useMemo((): ReactNode => {
    if (!displayContent) return null
    switch (displayContent.type) {
      case 'media':
        return (
          <MediaPreview
            category={displayContent.category}
            dataUrl={displayContent.dataUrl}
            mimeType={displayContent.mimeType}
            fileName={fileName}
          />
        )
      case 'binary':
        return <BinaryPlaceholder mimeType={displayContent.mimeType} fileName={fileName} onDownload={handleDownload} />
      case 'textMedia':
        return (
          <TextMediaPreview
            key={targetKey ?? path ?? fileName}
            dataUrl={displayContent.dataUrl}
            text={displayContent.text}
            language={language || 'xml'}
            fileName={fileName}
            isResizing={false}
            targetLine={targetLine}
            targetKey={targetKey}
            targetRanges={targetRanges}
          />
        )
      case 'markdown':
        return (
          <MarkdownFilePreview
            key={targetKey ?? path ?? fileName}
            text={displayContent.text}
            isResizing={false}
            targetLine={targetLine}
            targetKey={targetKey}
            targetRanges={targetRanges}
          />
        )
      case 'html':
        return (
          <HtmlFilePreview
            key={targetKey ?? path ?? fileName}
            text={displayContent.text}
            fileName={fileName}
            filePath={path ?? fileName}
            directory={directory}
            isResizing={false}
            targetLine={targetLine}
            targetKey={targetKey}
            targetRanges={targetRanges}
          />
        )
      case 'text':
        return (
          <CodePreview
            code={displayContent.text}
            language={language || 'text'}
            targetLine={targetLine}
            targetKey={targetKey}
            targetRanges={targetRanges}
          />
        )
      default:
        return null
    }
  }, [directory, displayContent, fileName, handleDownload, language, path, targetKey, targetLine, targetRanges])

  const fullscreenHeaderRight = useMemo(
    () =>
      content ? (
        <button
          onClick={handleDownload}
          className="p-1.5 text-text-400 hover:text-text-100 hover:bg-bg-200/60 rounded-lg transition-colors"
          title={`${t('common:save')} ${fileName}`}
        >
          <DownloadIcon size={14} />
        </button>
      ) : null,
    [content, fileName, handleDownload, t],
  )

  const fullscreenLayer = useMemo(
    () =>
      fullscreenContent
        ? {
            id: `file-preview:${path || fileName}`,
            title: fileName,
            headerRight: fullscreenHeaderRight,
            content: fullscreenContent,
            deferContent: displayContent?.type === 'html',
          }
        : null,
    [displayContent?.type, fileName, fullscreenContent, fullscreenHeaderRight, path],
  )
  const { isOpen: isFullscreenOpen, open: openFullscreen } = useFullscreenLayer(fullscreenLayer)

  return (
    <div className="flex flex-col h-full relative">
      <PreviewTabsBar
        items={previewTabItems}
        activeId={path}
        closeAllTitle={t('common:closeAllTabs')}
        onActivate={onActivatePreview}
        onClose={onClosePreview}
        onCloseAll={onClose}
        onReorder={onReorderPreview}
        tabWidthClassName="w-auto max-w-none min-w-max"
        rightActions={
          content ? (
            <>
              <button
                onClick={openFullscreen}
                className="p-1 text-text-400 hover:text-text-100 hover:bg-bg-300/50 rounded transition-colors"
                title={t('contentBlock.fullscreen')}
              >
                <MaximizeIcon size={12} />
              </button>
              <button
                onClick={handleDownload}
                className="p-1 text-text-400 hover:text-text-100 hover:bg-bg-300/50 rounded transition-colors"
                title={`${t('common:save')} ${fileName}`}
              >
                <DownloadIcon size={12} />
              </button>
            </>
          ) : null
        }
      />

      {/* Preview Content */}
      <div ref={scrollRef} className="flex-1 overflow-auto panel-scrollbar">
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-text-400 text-[length:var(--fs-sm)]">
            {t('common:loading')}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full text-danger-100 text-[length:var(--fs-sm)] gap-1 px-4">
            <AlertCircleIcon size={16} />
            <span className="text-center">{error}</span>
          </div>
        ) : displayContent?.type === 'media' ? (
          <MediaPreview
            category={displayContent.category}
            dataUrl={displayContent.dataUrl}
            mimeType={displayContent.mimeType}
            fileName={fileName}
          />
        ) : displayContent?.type === 'binary' ? (
          <BinaryPlaceholder mimeType={displayContent.mimeType} fileName={fileName} onDownload={handleDownload} />
        ) : displayContent?.type === 'textMedia' ? (
          <TextMediaPreview
            key={targetKey ?? path ?? fileName}
            dataUrl={displayContent.dataUrl}
            text={displayContent.text}
            language={language || 'xml'}
            fileName={fileName}
            isResizing={isResizing}
            targetLine={targetLine}
            targetKey={targetKey}
            targetRanges={targetRanges}
          />
        ) : displayContent?.type === 'markdown' ? (
          <MarkdownFilePreview
            key={targetKey ?? path ?? fileName}
            text={displayContent.text}
            isResizing={isResizing}
            targetLine={targetLine}
            targetKey={targetKey}
            targetRanges={targetRanges}
          />
        ) : displayContent?.type === 'html' ? (
          isFullscreenOpen ? null : (
            <HtmlFilePreview
              key={targetKey ?? path ?? fileName}
              text={displayContent.text}
              fileName={fileName}
              filePath={path ?? fileName}
              directory={directory}
              isResizing={isResizing}
              targetLine={targetLine}
              targetKey={targetKey}
              targetRanges={targetRanges}
            />
          )
        ) : // diff 渲染已移至 Changes 面板
        // ) : displayContent?.type === 'diff' ? (
        //   <DiffPreview hunks={displayContent.hunks} isResizing={isResizing} />
        displayContent?.type === 'text' ? (
          <CodePreview
            code={displayContent.text}
            language={language || 'text'}
            isResizing={isResizing}
            targetLine={targetLine}
            targetKey={targetKey}
            targetRanges={targetRanges}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-text-400 text-[length:var(--fs-sm)]">
            {t('common:noContent')}
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================
// Media Preview - 路由到具体渲染器
// ============================================

interface MediaPreviewProps {
  category: PreviewCategory
  dataUrl: string
  mimeType: string
  fileName: string
}

function MediaPreview({ category, dataUrl, mimeType, fileName }: MediaPreviewProps) {
  switch (category) {
    case 'image':
      return <ImagePreview dataUrl={dataUrl} fileName={fileName} />
    case 'audio':
      return (
        <div className="flex flex-col items-center justify-center h-full gap-3 p-4">
          <div className="text-text-400 text-[length:var(--fs-sm)]">{formatMimeType(mimeType)}</div>
          <audio controls src={dataUrl} className="w-full max-w-xs" />
        </div>
      )
    case 'video':
      return (
        <div className="flex items-center justify-center h-full p-4">
          <video controls src={dataUrl} className="max-w-full max-h-full rounded" />
        </div>
      )
    case 'pdf':
      return <iframe src={dataUrl} title={fileName} className="w-full h-full border-0" />
  }
}

// ============================================
// Image Preview - 缩放 + 拖拽平移
// 直接滚轮缩放（以鼠标为锚点），左键拖拽平移
// ============================================

const MIN_ZOOM = 0.05
const MAX_ZOOM = 20
const ZOOM_FACTOR = 1.15 // 每次滚轮的缩放倍率

interface ImagePreviewProps {
  dataUrl: string
  fileName: string
}

function ImagePreview({ dataUrl, fileName }: ImagePreviewProps) {
  const { t } = useTranslation(['components', 'common'])
  const containerRef = useRef<HTMLDivElement>(null)
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 })
  const scaleRef = useRef(1) // 同步访问，避免 stale closure
  const [scale, setScale] = useState(1)
  const [fitScale, setFitScale] = useState(1)
  const [translate, setTranslate] = useState({ x: 0, y: 0 })
  const [initialized, setInitialized] = useState(false)
  const dragRef = useRef({ active: false, startX: 0, startY: 0 })

  // fit-to-container scale
  const computeFitScale = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el || !naturalSize.w || !naturalSize.h) return 1
      const rect = el.getBoundingClientRect()
      return Math.min(rect.width / naturalSize.w, rect.height / naturalSize.h, 1)
    },
    [naturalSize],
  )

  // 图片加载后初始化
  useEffect(() => {
    const container = containerRef.current
    if (!container || !naturalSize.w || !naturalSize.h) return

    const updateFitScale = () => {
      const nextFitScale = computeFitScale(container)
      setFitScale(nextFitScale)

      if (!initialized) {
        scaleRef.current = nextFitScale
        setScale(nextFitScale)
        setTranslate({ x: 0, y: 0 })
        setInitialized(true)
      }
    }

    updateFitScale()

    const resizeObserver = new ResizeObserver(updateFitScale)
    resizeObserver.observe(container)

    return () => {
      resizeObserver.disconnect()
    }
  }, [naturalSize, initialized, computeFitScale])

  // 滚轮缩放 — 以鼠标位置为锚点
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      // 鼠标相对容器中心
      const cx = e.clientX - rect.left - rect.width / 2
      const cy = e.clientY - rect.top - rect.height / 2
      const factor = e.deltaY > 0 ? 1 / ZOOM_FACTOR : ZOOM_FACTOR
      const oldScale = scaleRef.current
      const newScale = Math.min(Math.max(oldScale * factor, MIN_ZOOM), MAX_ZOOM)
      const ratio = newScale / oldScale
      scaleRef.current = newScale
      setScale(newScale)
      setTranslate(t => ({
        x: cx - ratio * (cx - t.x),
        y: cy - ratio * (cy - t.y),
      }))
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [])

  // 拖拽平移
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current.active) return
      const dx = e.clientX - dragRef.current.startX
      const dy = e.clientY - dragRef.current.startY
      dragRef.current.startX = e.clientX
      dragRef.current.startY = e.clientY
      setTranslate(t => ({ x: t.x + dx, y: t.y + dy }))
    }
    const onUp = () => {
      if (dragRef.current.active) {
        dragRef.current.active = false
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragRef.current = { active: true, startX: e.clientX, startY: e.clientY }
    document.body.style.cursor = 'grabbing'
    document.body.style.userSelect = 'none'
  }, [])

  const zoomIn = useCallback(() => {
    const s = Math.min(scaleRef.current * 1.25, MAX_ZOOM)
    scaleRef.current = s
    setScale(s)
  }, [])

  const zoomOut = useCallback(() => {
    const s = Math.max(scaleRef.current / 1.25, MIN_ZOOM)
    scaleRef.current = s
    setScale(s)
  }, [])

  const zoomFit = useCallback(() => {
    scaleRef.current = fitScale
    setScale(fitScale)
    setTranslate({ x: 0, y: 0 })
  }, [fitScale])

  const zoomActual = useCallback(() => {
    scaleRef.current = 1
    setScale(1)
    setTranslate({ x: 0, y: 0 })
  }, [])

  const isFit = Math.abs(scale - fitScale) < 0.001 && translate.x === 0 && translate.y === 0
  const isActual = Math.abs(scale - 1) < 0.001 && translate.x === 0 && translate.y === 0

  return (
    <div className="flex flex-col h-full">
      {/* Zoom toolbar */}
      <div className="shrink-0 flex items-center justify-center gap-1.5 px-2 py-1 border-b border-border-100/30 bg-bg-100/50 text-[length:var(--fs-xxs)]">
        <button
          onClick={zoomOut}
          className="px-1.5 py-0.5 rounded hover:bg-bg-200 text-text-300 hover:text-text-100 transition-colors"
        >
          −
        </button>
        <span className="w-10 text-center text-text-400 tabular-nums">{Math.round(scale * 100)}%</span>
        <button
          onClick={zoomIn}
          className="px-1.5 py-0.5 rounded hover:bg-bg-200 text-text-300 hover:text-text-100 transition-colors"
        >
          +
        </button>
        <span className="w-px h-3 bg-border-200 mx-1" />
        <button
          onClick={zoomFit}
          className={`px-1.5 py-0.5 rounded transition-colors ${isFit ? 'bg-bg-200 text-text-100' : 'text-text-400 hover:bg-bg-200 hover:text-text-100'}`}
        >
          {t('fileExplorer.fit')}
        </button>
        <button
          onClick={zoomActual}
          className={`px-1.5 py-0.5 rounded transition-colors ${isActual ? 'bg-bg-200 text-text-100' : 'text-text-400 hover:bg-bg-200 hover:text-text-100'}`}
        >
          {t('fileExplorer.oneToOne')}
        </button>
      </div>
      {/* Image area */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden relative cursor-grab active:cursor-grabbing"
        onMouseDown={handleMouseDown}
      >
        <img
          src={dataUrl}
          alt={fileName}
          draggable={false}
          className="absolute left-1/2 top-1/2 select-none"
          style={{
            transform: `translate(-50%, -50%) translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
            transformOrigin: 'center center',
          }}
          onLoad={e => {
            setNaturalSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
          }}
        />
      </div>
    </div>
  )
}

// ============================================
// Text Media Preview - 文本型可渲染媒体（如 SVG）
// 支持 Preview / Code 两种视图切换
// ============================================

interface TextMediaPreviewProps {
  dataUrl: string
  text: string
  language: string
  fileName: string
  isResizing?: boolean
  targetLine?: number
  targetKey?: string
  targetRanges?: readonly TargetLineRange[]
}

function TextMediaPreview({
  dataUrl,
  text,
  language,
  fileName,
  isResizing = false,
  targetLine,
  targetKey,
  targetRanges,
}: TextMediaPreviewProps) {
  const { t } = useTranslation(['components', 'common'])
  const [mode, setMode] = useState<'preview' | 'code'>(targetLine ? 'code' : 'preview')

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="shrink-0 flex items-center gap-0.5 px-2 py-1 border-b border-border-100/30 bg-bg-100/50 text-[length:var(--fs-xxs)]">
        <button
          onClick={() => setMode('preview')}
          className={`px-2 py-0.5 rounded transition-colors ${mode === 'preview' ? 'bg-bg-200 text-text-100' : 'text-text-400 hover:bg-bg-200 hover:text-text-100'}`}
        >
          {t('common:preview')}
        </button>
        <button
          onClick={() => setMode('code')}
          className={`px-2 py-0.5 rounded transition-colors ${mode === 'code' ? 'bg-bg-200 text-text-100' : 'text-text-400 hover:bg-bg-200 hover:text-text-100'}`}
        >
          {t('common:code')}
        </button>
      </div>
      {/* Content */}
      {mode === 'preview' ? (
        <ImagePreview dataUrl={dataUrl} fileName={fileName} />
      ) : (
        <div className="flex-1 min-h-0">
          <CodePreview
            code={text}
            language={language}
            isResizing={isResizing}
            targetLine={targetLine}
            targetKey={targetKey}
            targetRanges={targetRanges}
          />
        </div>
      )}
    </div>
  )
}

interface HtmlFilePreviewProps {
  text: string
  fileName: string
  filePath: string
  directory?: string
  isResizing?: boolean
  targetLine?: number
  targetKey?: string
  targetRanges?: readonly TargetLineRange[]
}

function HtmlFilePreview({
  text,
  fileName,
  filePath,
  directory,
  isResizing = false,
  targetLine,
  targetKey,
  targetRanges,
}: HtmlFilePreviewProps) {
  const { t } = useTranslation(['components', 'common'])
  const [mode, setMode] = useState<'preview' | 'code'>(targetLine ? 'code' : 'preview')

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-0.5 border-b border-border-100/30 bg-bg-100/50 px-2 py-1 text-[length:var(--fs-xxs)]">
        <button
          type="button"
          onClick={() => setMode('preview')}
          className={`rounded px-2 py-0.5 transition-colors ${mode === 'preview' ? 'bg-bg-200 text-text-100' : 'text-text-400 hover:bg-bg-200 hover:text-text-100'}`}
        >
          {t('common:preview')}
        </button>
        <button
          type="button"
          onClick={() => setMode('code')}
          className={`rounded px-2 py-0.5 transition-colors ${mode === 'code' ? 'bg-bg-200 text-text-100' : 'text-text-400 hover:bg-bg-200 hover:text-text-100'}`}
        >
          {t('common:code')}
        </button>
      </div>
      {mode === 'preview' ? (
        <div className="min-h-0 flex-1">
          <HtmlFilePreviewFrame
            html={text}
            title={fileName}
            filePath={filePath}
            directory={directory}
            isResizing={isResizing}
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          <CodePreview
            code={text}
            language="html"
            isResizing={isResizing}
            targetLine={targetLine}
            targetKey={targetKey}
            targetRanges={targetRanges}
          />
        </div>
      )}
    </div>
  )
}

interface MarkdownFilePreviewProps {
  text: string
  isResizing?: boolean
  targetLine?: number
  targetKey?: string
  targetRanges?: readonly TargetLineRange[]
}

function MarkdownFilePreview({
  text,
  isResizing = false,
  targetLine,
  targetKey,
  targetRanges,
}: MarkdownFilePreviewProps) {
  const { t } = useTranslation(['components', 'common'])
  const [mode, setMode] = useState<'preview' | 'code'>(targetLine ? 'code' : 'preview')

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 flex items-center gap-0.5 px-2 py-1 border-b border-border-100/30 bg-bg-100/50 text-[length:var(--fs-xxs)]">
        <button
          onClick={() => setMode('preview')}
          className={`px-2 py-0.5 rounded transition-colors ${mode === 'preview' ? 'bg-bg-200 text-text-100' : 'text-text-400 hover:bg-bg-200 hover:text-text-100'}`}
        >
          {t('common:preview')}
        </button>
        <button
          onClick={() => setMode('code')}
          className={`px-2 py-0.5 rounded transition-colors ${mode === 'code' ? 'bg-bg-200 text-text-100' : 'text-text-400 hover:bg-bg-200 hover:text-text-100'}`}
        >
          {t('common:code')}
        </button>
      </div>

      {mode === 'preview' ? (
        <div className="flex-1 min-h-0 overflow-auto panel-scrollbar px-5 py-4">
          <MarkdownRenderer content={text} />
        </div>
      ) : (
        <div className="flex-1 min-h-0">
          <CodePreview
            code={text}
            language="markdown"
            isResizing={isResizing}
            targetLine={targetLine}
            targetKey={targetKey}
            targetRanges={targetRanges}
          />
        </div>
      )}
    </div>
  )
}

// ============================================
// Binary Placeholder - 不可预览的二进制文件
// ============================================

interface BinaryPlaceholderProps {
  mimeType: string
  fileName: string
  onDownload?: () => void
}

function BinaryPlaceholder({ mimeType, fileName, onDownload }: BinaryPlaceholderProps) {
  const { t } = useTranslation(['components', 'common'])

  return (
    <div className="flex flex-col items-center justify-center h-full text-text-400 text-[length:var(--fs-sm)] gap-2 p-4">
      <img
        src={getMaterialIconUrl(fileName, 'file')}
        alt=""
        width={32}
        height={32}
        className="opacity-50"
        onError={e => {
          e.currentTarget.style.visibility = 'hidden'
        }}
      />
      <span className="font-medium text-text-300">{fileName}</span>
      <span>{formatMimeType(mimeType)}</span>
      <span className="text-text-500 text-[length:var(--fs-xxs)]">{t('components:fileExplorer.binaryFile')}</span>
      {onDownload && (
        <button
          onClick={onDownload}
          className="mt-2 flex items-center gap-1.5 px-3 py-1.5 bg-bg-200 hover:bg-bg-300 text-text-200 rounded transition-colors text-[length:var(--fs-xs)]"
        >
          <DownloadIcon size={12} />
          {t('common:download')}
        </button>
      )}
    </div>
  )
}

// ============================================
// Diff Preview
// ============================================

interface DiffPreviewProps {
  hunks: Array<{
    oldStart: number
    oldLines: number
    newStart: number
    newLines: number
    lines: string[]
  }>
  isResizing?: boolean
}

// 当前未在 Files 预览中使用，保留供 Changes 面板等复用
export function DiffPreview({ hunks, isResizing = false }: DiffPreviewProps) {
  return (
    <div
      className={`font-mono text-[length:var(--fs-code)] leading-relaxed ${isResizing ? 'whitespace-pre overflow-hidden' : ''}`}
      style={{ contain: 'content' }}
    >
      {hunks.map((hunk, hunkIdx) => (
        <div key={hunkIdx} className="border-b border-border-100/30 last:border-0">
          {/* Hunk Header */}
          <div className="px-3 py-1 bg-bg-200/50 text-text-400 text-[length:var(--fs-xxs)]">
            @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
          </div>
          {/* Lines */}
          <div>
            {hunk.lines.map((line, lineIdx) => {
              const type = line[0]
              let bgClass = ''
              let textClass = 'text-text-300'

              if (type === '+') {
                bgClass = 'bg-success-100/10'
                textClass = 'text-success-100'
              } else if (type === '-') {
                bgClass = 'bg-danger-100/10'
                textClass = 'text-danger-100'
              }

              return (
                <div key={lineIdx} className={`px-3 py-0.5 ${bgClass} ${textClass}`}>
                  <span className="select-none opacity-50 w-4 inline-block">{type || ' '}</span>
                  <span>{line.slice(1)}</span>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
