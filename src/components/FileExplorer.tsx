// ============================================
// FileExplorer - 文件浏览器组件
// 包含文件树和文件预览两个区域，支持拖拽调整高度
// 性能优化：使用 CSS 变量 + requestAnimationFrame 处理 resize
// ============================================

import { memo, useCallback, useMemo, useEffect, useRef, useState, useLayoutEffect } from 'react'
import { useFileExplorer, type FileTreeNode } from '../hooks'
import { layoutStore, type PreviewFile } from '../store/layoutStore'
import { 
  FileIcon, 
  FolderIcon, 
  FolderOpenIcon, 
  ChevronRightIcon, 
  ChevronDownIcon,
  RetryIcon,
  CloseIcon,
  AlertCircleIcon,
  DownloadIcon,
} from './Icons'
import { detectLanguage } from '../utils/languageUtils'
import { useSyntaxHighlight } from '../hooks/useSyntaxHighlight'
import { getPreviewCategory, isBinaryContent, isTextualMedia, buildDataUrl, buildTextDataUrl, decodeBase64Text, formatMimeType, type PreviewCategory } from '../utils/mimeUtils'
import { downloadFileContent } from '../utils/downloadUtils'
import type { FileContent } from '../api/types'

// 常量
const MIN_TREE_HEIGHT = 100
const MIN_PREVIEW_HEIGHT = 150
const LINE_HEIGHT = 20 // 每行高度（用于虚拟滚动）
const OVERSCAN = 5 // 额外渲染的行数
const MAX_LINE_LENGTH = 5000 // 超过此长度截断显示，避免 DOM 过大

interface FileExplorerProps {
  directory?: string
  previewFile: PreviewFile | null
  position?: 'bottom' | 'right'
  isPanelResizing?: boolean
  sessionId?: string | null
}

export const FileExplorer = memo(function FileExplorer({ 
  directory, 
  previewFile,
  position = 'right',
  isPanelResizing = false,
  sessionId,
}: FileExplorerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const treeRef = useRef<HTMLDivElement>(null)
  const [treeHeight, setTreeHeight] = useState<number | null>(null) // null 表示自动
  const [isResizing, setIsResizing] = useState(false)
  const rafRef = useRef<number>(0)
  const currentHeightRef = useRef<number | null>(null)
  
  // 综合 resize 状态 - 外部面板 resize 或内部 resize
  const isAnyResizing = isPanelResizing || isResizing
  
  const {
    tree,
    isLoading,
    error,
    expandedPaths,
    toggleExpand,
    selectedPath,
    selectFile,
    previewContent,
    previewLoading,
    previewError,
    loadPreview,
    clearPreview,
    fileStatus,
    refresh,
  } = useFileExplorer({ directory, autoLoad: true, sessionId: sessionId || undefined })

  // 同步高度到 CSS 变量
  useLayoutEffect(() => {
    if (!isResizing && treeRef.current && treeHeight !== null) {
      treeRef.current.style.setProperty('--tree-height', `${treeHeight}px`)
      currentHeightRef.current = treeHeight
    }
  }, [treeHeight, isResizing])

  // 当 previewFile 改变时加载预览
  useEffect(() => {
    if (previewFile) {
      selectFile(previewFile.path)
      loadPreview(previewFile.path)
    }
  }, [previewFile, selectFile, loadPreview])

  // 处理文件点击
  const handleFileClick = useCallback((node: FileTreeNode) => {
    if (node.type === 'directory') {
      toggleExpand(node.path)
    } else {
      selectFile(node.path)
      loadPreview(node.path)
      layoutStore.openFilePreview({ path: node.path, name: node.name }, position)
    }
  }, [toggleExpand, selectFile, loadPreview, position])

  // 关闭预览
  const handleClosePreview = useCallback(() => {
    clearPreview()
    layoutStore.closeFilePreview()
    setTreeHeight(null)
    currentHeightRef.current = null
  }, [clearPreview])

  // 拖拽调整高度 - 使用 CSS 变量 + requestAnimationFrame 优化
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    
    const container = containerRef.current
    const treeEl = treeRef.current
    if (!container || !treeEl) return
    
    setIsResizing(true)
    
    const containerRect = container.getBoundingClientRect()
    const startY = e.clientY
    const startHeight = currentHeightRef.current ?? containerRect.height * 0.4
    
    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
      }
      
      rafRef.current = requestAnimationFrame(() => {
        const deltaY = moveEvent.clientY - startY
        const newHeight = startHeight + deltaY
        const maxHeight = containerRect.height - MIN_PREVIEW_HEIGHT
        const clampedHeight = Math.min(Math.max(newHeight, MIN_TREE_HEIGHT), maxHeight)
        // 直接修改 CSS 变量
        treeEl.style.setProperty('--tree-height', `${clampedHeight}px`)
        currentHeightRef.current = clampedHeight
      })
    }
    
    const handleMouseUp = () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
      }
      
      setIsResizing(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      
      // 更新 state 以持久化
      if (currentHeightRef.current !== null) {
        setTreeHeight(currentHeightRef.current)
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
    const treeEl = treeRef.current
    if (!container || !treeEl) return

    setIsResizing(true)

    const containerRect = container.getBoundingClientRect()
    const startY = e.touches[0].clientY
    const startHeight = currentHeightRef.current ?? containerRect.height * 0.4

    const handleTouchMove = (moveEvent: TouchEvent) => {
      moveEvent.preventDefault()
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
      }

      rafRef.current = requestAnimationFrame(() => {
        const deltaY = moveEvent.touches[0].clientY - startY
        const newHeight = startHeight + deltaY
        const maxHeight = containerRect.height - MIN_PREVIEW_HEIGHT
        const clampedHeight = Math.min(Math.max(newHeight, MIN_TREE_HEIGHT), maxHeight)
        treeEl.style.setProperty('--tree-height', `${clampedHeight}px`)
        currentHeightRef.current = clampedHeight
      })
    }

    const handleTouchEnd = () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
      }

      setIsResizing(false)
      document.removeEventListener('touchmove', handleTouchMove)
      document.removeEventListener('touchend', handleTouchEnd)

      if (currentHeightRef.current !== null) {
        setTreeHeight(currentHeightRef.current)
      }
    }

    document.addEventListener('touchmove', handleTouchMove, { passive: false })
    document.addEventListener('touchend', handleTouchEnd)
  }, [])

  // 是否显示预览
  const showPreview = previewContent || previewLoading || previewError

  // 没有选择目录
  if (!directory) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-400 text-sm gap-2 p-4">
        <FolderIcon size={32} className="opacity-30" />
        <span className="text-center">Select a project to browse files</span>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="flex flex-col h-full">
      {/* File Tree - 使用 CSS 变量控制高度 */}
      <div 
        ref={treeRef}
        className="overflow-hidden flex flex-col shrink-0"
        style={{ 
          '--tree-height': treeHeight !== null ? `${treeHeight}px` : '40%',
          height: showPreview ? 'var(--tree-height)' : '100%',
          minHeight: showPreview ? MIN_TREE_HEIGHT : undefined,
        } as React.CSSProperties}
      >
        {/* Tree Header */}
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-border-100/50 shrink-0">
          <span className="text-[10px] font-bold text-text-400 uppercase tracking-wider">
            Explorer
          </span>
          <button
            onClick={refresh}
            disabled={isLoading}
            className="p-1 text-text-400 hover:text-text-100 hover:bg-bg-200 rounded transition-colors disabled:opacity-50"
            title="Refresh"
          >
            <RetryIcon size={12} className={isLoading ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Tree Content */}
        <div className="flex-1 overflow-auto panel-scrollbar-y">
          {isLoading && tree.length === 0 ? (
            <div className="flex items-center justify-center h-20 text-text-400 text-xs">
              Loading...
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-20 text-danger-100 text-xs gap-1 px-4">
              <AlertCircleIcon size={16} />
              <span className="text-center">{error}</span>
            </div>
          ) : tree.length === 0 ? (
            <div className="flex items-center justify-center h-20 text-text-400 text-xs">
              No files found
            </div>
          ) : (
            <div className="py-1">
              {tree.map(node => (
                <FileTreeItem
                  key={node.path}
                  node={node}
                  depth={0}
                  expandedPaths={expandedPaths}
                  selectedPath={selectedPath}
                  fileStatus={fileStatus}
                  onClick={handleFileClick}
                />
              ))}
            </div>
          )}
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

      {/* Preview Area */}
      {showPreview && (
        <div className="flex-1 flex flex-col min-h-0" style={{ minHeight: MIN_PREVIEW_HEIGHT }}>
          <FilePreview
            path={selectedPath}
            content={previewContent}
            isLoading={previewLoading}
            error={previewError}
            onClose={handleClosePreview}
            isResizing={isAnyResizing}
          />
        </div>
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
  selectedPath: string | null
  fileStatus: Map<string, { status: string }>
  onClick: (node: FileTreeNode) => void
}

const FileTreeItem = memo(function FileTreeItem({
  node,
  depth,
  expandedPaths,
  selectedPath,
  fileStatus,
  onClick,
}: FileTreeItemProps) {
  const isExpanded = expandedPaths.has(node.path)
  const isSelected = selectedPath === node.path
  const isDirectory = node.type === 'directory'
  // node.path 可能用反斜杠（Windows），statusMap key 统一用正斜杠
  const status = fileStatus.get(node.path) || fileStatus.get(node.path.replace(/\\/g, '/'))

  // 状态颜色
  const statusColor = useMemo(() => {
    if (!status) return null
    switch (status.status) {
      case 'added': return 'text-success-100'
      case 'modified': return 'text-warning-100'
      case 'deleted': return 'text-danger-100'
      default: return null
    }
  }, [status])

  return (
    <div>
      <button
        onClick={() => onClick(node)}
        className={`
          w-full flex items-center gap-1 px-2 py-0.5 text-left
          hover:bg-bg-200/50 transition-colors text-[12px]
          ${isSelected ? 'bg-bg-200/70 text-text-100' : 'text-text-300'}
          ${node.ignored ? 'opacity-50' : ''}
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

        {/* File/Folder Icon */}
        <span className={`shrink-0 ${statusColor || 'text-text-400'}`}>
          {isDirectory ? (
            isExpanded ? <FolderOpenIcon size={14} /> : <FolderIcon size={14} />
          ) : (
            <FileIcon size={14} />
          )}
        </span>

        {/* Name */}
        <span className={`truncate flex-1 ${statusColor || ''}`}>
          {node.name}
        </span>

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
              selectedPath={selectedPath}
              fileStatus={fileStatus}
              onClick={onClick}
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
  path: string | null
  content: FileContent | null
  isLoading: boolean
  error: string | null
  onClose: () => void
  isResizing?: boolean
}

function FilePreview({ path, content, isLoading, error, onClose, isResizing = false }: FilePreviewProps) {
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

  // 处理内容类型分发
  const displayContent = useMemo(() => {
    if (!content) return null

    const category = getPreviewCategory(content.mimeType)

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
  }, [content])

  return (
    <div className="flex flex-col h-full relative">
      {/* Preview Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border-100/50 bg-bg-100/30 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <FileIcon size={12} className="text-text-400 shrink-0" />
          <span className="text-[11px] font-mono text-text-200 truncate">{fileName}</span>
          {/* Modified 标签暂不在 Files 预览显示 */}
          {/* {content?.diff && (
            <span className="text-[9px] px-1.5 py-0.5 bg-warning-100/20 text-warning-100 rounded font-medium shrink-0">
              Modified
            </span>
          )} */}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {/* 下载按钮 */}
          {content && (
            <button
              onClick={handleDownload}
              className="p-1 text-text-400 hover:text-text-100 hover:bg-bg-200 rounded transition-colors"
              title={`Save ${fileName}`}
            >
              <DownloadIcon size={12} />
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1 text-text-400 hover:text-text-100 hover:bg-bg-200 rounded transition-colors"
          >
            <CloseIcon size={12} />
          </button>
        </div>
      </div>

      {/* Preview Content */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto panel-scrollbar"
      >
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-text-400 text-xs">
            Loading...
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full text-danger-100 text-xs gap-1 px-4">
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
            dataUrl={displayContent.dataUrl}
            text={displayContent.text}
            language={language || 'xml'}
            fileName={fileName}
            isResizing={isResizing}
          />
        // diff 渲染已移至 Changes 面板
        // ) : displayContent?.type === 'diff' ? (
        //   <DiffPreview hunks={displayContent.hunks} isResizing={isResizing} />
        ) : displayContent?.type === 'text' ? (
          <CodePreview code={displayContent.text} language={language || 'text'} isResizing={isResizing} />
        ) : (
          <div className="flex items-center justify-center h-full text-text-400 text-xs">
            No content
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
          <div className="text-text-400 text-xs">{formatMimeType(mimeType)}</div>
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
  const containerRef = useRef<HTMLDivElement>(null)
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 })
  const scaleRef = useRef(1) // 同步访问，避免 stale closure
  const [scale, setScale] = useState(1)
  const [translate, setTranslate] = useState({ x: 0, y: 0 })
  const [initialized, setInitialized] = useState(false)
  const dragRef = useRef({ active: false, startX: 0, startY: 0 })

  // fit-to-container scale
  const getFitScale = useCallback(() => {
    const el = containerRef.current
    if (!el || !naturalSize.w || !naturalSize.h) return 1
    const rect = el.getBoundingClientRect()
    return Math.min(rect.width / naturalSize.w, rect.height / naturalSize.h, 1)
  }, [naturalSize])

  // 图片加载后初始化
  useEffect(() => {
    if (naturalSize.w && !initialized) {
      const fit = getFitScale()
      scaleRef.current = fit
      setScale(fit)
      setTranslate({ x: 0, y: 0 })
      setInitialized(true)
    }
  }, [naturalSize, initialized, getFitScale])

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
    const fit = getFitScale()
    scaleRef.current = fit
    setScale(fit)
    setTranslate({ x: 0, y: 0 })
  }, [getFitScale])

  const zoomActual = useCallback(() => {
    scaleRef.current = 1
    setScale(1)
    setTranslate({ x: 0, y: 0 })
  }, [])

  const fitScale = getFitScale()
  const isFit = Math.abs(scale - fitScale) < 0.001 && translate.x === 0 && translate.y === 0
  const isActual = Math.abs(scale - 1) < 0.001 && translate.x === 0 && translate.y === 0

  return (
    <div className="flex flex-col h-full">
      {/* Zoom toolbar */}
      <div className="shrink-0 flex items-center justify-center gap-1.5 px-2 py-1 border-b border-border-100/30 bg-bg-100/50 text-[10px]">
        <button
          onClick={zoomOut}
          className="px-1.5 py-0.5 rounded hover:bg-bg-200 text-text-300 hover:text-text-100 transition-colors"
        >
          −
        </button>
        <span className="w-10 text-center text-text-400 tabular-nums">
          {Math.round(scale * 100)}%
        </span>
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
          Fit
        </button>
        <button
          onClick={zoomActual}
          className={`px-1.5 py-0.5 rounded transition-colors ${isActual ? 'bg-bg-200 text-text-100' : 'text-text-400 hover:bg-bg-200 hover:text-text-100'}`}
        >
          1:1
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
          onLoad={(e) => {
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
}

function TextMediaPreview({ dataUrl, text, language, fileName, isResizing = false }: TextMediaPreviewProps) {
  const [mode, setMode] = useState<'preview' | 'code'>('preview')

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="shrink-0 flex items-center gap-0.5 px-2 py-1 border-b border-border-100/30 bg-bg-100/50 text-[10px]">
        <button
          onClick={() => setMode('preview')}
          className={`px-2 py-0.5 rounded transition-colors ${mode === 'preview' ? 'bg-bg-200 text-text-100' : 'text-text-400 hover:bg-bg-200 hover:text-text-100'}`}
        >
          Preview
        </button>
        <button
          onClick={() => setMode('code')}
          className={`px-2 py-0.5 rounded transition-colors ${mode === 'code' ? 'bg-bg-200 text-text-100' : 'text-text-400 hover:bg-bg-200 hover:text-text-100'}`}
        >
          Code
        </button>
      </div>
      {/* Content */}
      {mode === 'preview' ? (
        <ImagePreview dataUrl={dataUrl} fileName={fileName} />
      ) : (
        <CodePreview code={text} language={language} isResizing={isResizing} />
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
  return (
    <div className="flex flex-col items-center justify-center h-full text-text-400 text-xs gap-2 p-4">
      <FileIcon size={32} className="opacity-30" />
      <span className="font-medium text-text-300">{fileName}</span>
      <span>{formatMimeType(mimeType)}</span>
      <span className="text-text-500 text-[10px]">Binary file — preview not available</span>
      {onDownload && (
        <button
          onClick={onDownload}
          className="mt-2 flex items-center gap-1.5 px-3 py-1.5 bg-bg-200 hover:bg-bg-300 text-text-200 rounded transition-colors text-[11px]"
        >
          <DownloadIcon size={12} />
          Download
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
      className={`font-mono text-[11px] leading-relaxed ${isResizing ? 'whitespace-pre overflow-hidden' : ''}`} 
      style={{ contain: 'content' }}
    >
      {hunks.map((hunk, hunkIdx) => (
        <div key={hunkIdx} className="border-b border-border-100/30 last:border-0">
          {/* Hunk Header */}
          <div className="px-3 py-1 bg-bg-200/50 text-text-400 text-[10px]">
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

// ============================================
// Code Preview - 统一使用虚拟滚动 + 禁用自动换行
// 核心优化：
// 1. 始终使用虚拟滚动，不论文件大小
// 2. 禁用自动换行，使用水平滚动
// 3. 超长行截断显示
// ============================================

interface CodePreviewProps {
  code: string
  language: string
  truncateLines?: boolean
  maxHeight?: number
  isResizing?: boolean
}

/** 截断超长行，避免 DOM 过大 */
function truncateLine(line: string): { text: string; truncated: boolean } {
  if (line.length <= MAX_LINE_LENGTH) {
    return { text: line, truncated: false }
  }
  return { 
    text: line.slice(0, MAX_LINE_LENGTH), 
    truncated: true 
  }
}

/** 截断高亮 HTML，保持标签完整性 */
function truncateHtml(html: string): { html: string; truncated: boolean } {
  // 简单估算：如果原始 HTML 很长，进行截断
  // 这里用一个保守的阈值，因为 HTML 有标签开销
  if (html.length <= MAX_LINE_LENGTH * 2) {
    return { html, truncated: false }
  }
  // 截断并闭合所有打开的标签
  const truncated = html.slice(0, MAX_LINE_LENGTH * 2)
  // 简单处理：直接截断，浏览器会自动修复
  return { html: truncated, truncated: true }
}

export function CodePreview({
  code,
  language,
  truncateLines = true,
  maxHeight,
  isResizing = false,
}: CodePreviewProps) {
  const lines = useMemo(() => {
    const raw = code.split('\n')
    if (raw.length > 1 && raw[raw.length - 1] === '' && code.endsWith('\n')) {
      raw.pop()
    }
    return raw
  }, [code])
  const totalHeight = lines.length * LINE_HEIGHT
  
  // text 类型不走高亮，resize 时也禁用以提高性能
  const enableHighlight = language !== 'text' && !isResizing
  const { output: html, isLoading } = useSyntaxHighlight(code, { lang: language, enabled: enableHighlight })
  
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [containerHeight, setContainerHeight] = useState(0)
  
  // 缓存高亮结果 - 仅在同一段 code 的高亮加载期间保留旧结果
  const highlightedLinesRef = useRef<string[] | null>(null)
  const highlightedCodeRef = useRef(code)

  // code 变化时清除缓存，防止显示旧代码的高亮内容
  if (highlightedCodeRef.current !== code) {
    highlightedLinesRef.current = null
    highlightedCodeRef.current = code
  }
  
  // 解析高亮后的行
  const highlightedLines = useMemo(() => {
    if (isLoading || !html) return highlightedLinesRef.current
    
    const parser = new DOMParser()
    const doc = parser.parseFromString(html as string, 'text/html')
    const lineElements = doc.querySelectorAll('.line')
    
    if (lineElements.length === 0) return highlightedLinesRef.current
    
    const result = Array.from(lineElements).map(el => el.innerHTML || '')
    highlightedLinesRef.current = result
    return result
  }, [html, isLoading])
  
  // 计算可见范围
  const { startIndex, endIndex, offsetY } = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / LINE_HEIGHT) - OVERSCAN)
    const visibleCount = Math.ceil(containerHeight / LINE_HEIGHT)
    const end = Math.min(lines.length, start + visibleCount + OVERSCAN * 2)
    return {
      startIndex: start,
      endIndex: end,
      offsetY: start * LINE_HEIGHT,
    }
  }, [scrollTop, containerHeight, lines.length])
  
  // 监听容器大小变化 - resize 时完全跳过
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    
    // resize 时跳过 ResizeObserver
    if (isResizing) return
    
    let rafId: number | null = null
    const updateHeight = () => {
      if (rafId) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        setContainerHeight(container.clientHeight)
      })
    }
    
    // 初始化立即执行
    setContainerHeight(container.clientHeight)
    
    const resizeObserver = new ResizeObserver(updateHeight)
    resizeObserver.observe(container)
    
    return () => {
      if (rafId) cancelAnimationFrame(rafId)
      resizeObserver.disconnect()
    }
  }, [isResizing])
  
  // 处理滚动
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop)
  }, [])
  
  // 渲染可见行
  const visibleLines = useMemo(() => {
    const result: React.ReactNode[] = []
    
    for (let i = startIndex; i < endIndex; i++) {
      const rawLine = lines[i] || ' '
      const highlighted = highlightedLines?.[i]
      const isHtml = highlighted && highlighted.includes('<')
      
      // 截断处理
      let displayContent: React.ReactNode
      let isTruncated = false
      
      if (isHtml && highlighted) {
        if (truncateLines) {
          const { html: truncatedHtml, truncated } = truncateHtml(highlighted)
          isTruncated = truncated
          displayContent = (
            <span 
              className="whitespace-pre"
              dangerouslySetInnerHTML={{ __html: truncatedHtml }}
            />
          )
        } else {
          displayContent = (
            <span 
              className="whitespace-pre"
              dangerouslySetInnerHTML={{ __html: highlighted }}
            />
          )
        }
      } else {
        if (truncateLines) {
          const { text, truncated } = truncateLine(highlighted || rawLine)
          isTruncated = truncated
          displayContent = (
            <span className="text-text-200 whitespace-pre">
              {text}
            </span>
          )
        } else {
          displayContent = (
            <span className="text-text-200 whitespace-pre">
              {highlighted || rawLine}
            </span>
          )
        }
      }
      
      result.push(
        <div 
          key={i} 
          className="flex hover:bg-bg-200/30"
          style={{ height: LINE_HEIGHT }}
        >
          <span className="select-none text-text-500 w-10 text-right pr-3 shrink-0 border-r border-border-100/30 mr-3 leading-5">
            {i + 1}
          </span>
          <span className="leading-5 pr-4">
            {displayContent}
            {isTruncated && (
              <span className="text-text-500 ml-1">… (truncated)</span>
            )}
          </span>
        </div>
      )
    }
    return result
  }, [startIndex, endIndex, lines, highlightedLines])

  return (
    <div 
      ref={containerRef}
      className="overflow-auto code-scrollbar"
      onScroll={handleScroll}
      style={maxHeight !== undefined ? { maxHeight } : undefined}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div 
          style={{ 
            position: 'absolute', 
            top: 0, 
            left: 0, 
            right: 0, 
            transform: `translateY(${offsetY}px)` 
          }}
          className="font-mono text-[11px] leading-relaxed"
        >
          {visibleLines}
        </div>
      </div>
    </div>
  )
}
