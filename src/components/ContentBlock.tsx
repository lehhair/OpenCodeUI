/**
 * ContentBlock - 通用内容展示容器
 * 
 * 根据内容类型自动选择渲染器：
 * - 普通代码/文本 -> CodePreview
 * - Diff -> DiffViewer
 * - Loading 状态 -> Skeleton
 */

import { memo, useState, useMemo, useEffect, useRef } from 'react'
import { diffLines } from 'diff'
import { ChevronDownIcon, MaximizeIcon } from './Icons'
import { CopyButton } from './ui'
import { DiffViewer, extractContentFromUnifiedDiff, type ViewMode } from './DiffViewer'
import { CodePreview } from './FileExplorer'
import { detectLanguage } from '../utils/languageUtils'
import { DiffModal } from './DiffModal'

// ============================================
// Types
// ============================================

export interface ContentBlockProps {
  /** 标签 */
  label: string
  /** 文件路径 */
  filePath?: string
  /** 语言 */
  language?: string
  /** 样式变体 */
  variant?: 'default' | 'error'
  /** 默认折叠 */
  defaultCollapsed?: boolean
  /** 最大高度（px），0 表示不限制 */
  maxHeight?: number
  /** 是否可折叠 */
  collapsible?: boolean
  
  // 内容
  /** 普通文本/代码内容 */
  content?: string
  /** Diff 数据 */
  diff?: { before: string; after: string } | string
  /** Diff 统计 */
  diffStats?: { additions: number; deletions: number }
  /** 统计信息 */
  stats?: { exit?: number }
  
  // Loading 状态
  /** 是否正在加载 */
  isLoading?: boolean
  /** 加载时显示的文字 */
  loadingText?: string
}

// ============================================
// Main Component
// ============================================

export const ContentBlock = memo(function ContentBlock({
  label,
  filePath,
  language,
  variant = 'default',
  defaultCollapsed = false,
  maxHeight = 400,
  collapsible = true,
  content,
  diff,
  diffStats: providedDiffStats,
  stats,
  isLoading = false,
  loadingText = 'Loading...',
}: ContentBlockProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const [diffModalOpen, setDiffModalOpen] = useState(false)
  const [diffViewMode, setDiffViewMode] = useState<ViewMode>('split')
  const contentRef = useRef<HTMLDivElement>(null)
  
  const isError = variant === 'error'
  const isDiff = !!diff
  const hasContent = !!(content?.trim()) || isDiff || stats?.exit !== undefined
  const canCollapse = collapsible && hasContent
  const lang = language || (filePath ? detectLanguage(filePath) : 'text')
  const fileName = filePath?.split(/[/\\]/).pop()
  
  // Diff 统计
  const diffStats = useMemo(() => {
    if (!isDiff) return null
    if (providedDiffStats) return providedDiffStats
    
    if (typeof diff === 'object') {
      const changes = diffLines(diff.before, diff.after)
      let additions = 0, deletions = 0
      for (const c of changes) {
        if (c.added) additions += c.count || 0
        if (c.removed) deletions += c.count || 0
      }
      return { additions, deletions }
    }
    
    const lines = (diff as string).split('\n')
    let additions = 0, deletions = 0
    for (const line of lines) {
      if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('Index:') || line.startsWith('===')) continue
      if (line.startsWith('+')) additions++
      if (line.startsWith('-')) deletions++
    }
    return { additions, deletions }
  }, [isDiff, diff, providedDiffStats])

  const resolvedDiff = useMemo(() => {
    if (!diff) return null
    if (typeof diff === 'object') return diff
    return extractContentFromUnifiedDiff(diff)
  }, [diff])

  // 自动响应式切换 diff view mode
  useEffect(() => {
    if (!isDiff) return
    const container = contentRef.current
    if (!container) return

    const updateViewMode = () => {
      const width = container.clientWidth
      const nextMode: ViewMode = width < 720 ? 'unified' : 'split'
      setDiffViewMode(prev => (prev === nextMode ? prev : nextMode))
    }

    updateViewMode()
    const observer = new ResizeObserver(updateViewMode)
    observer.observe(container)
    return () => observer.disconnect()
  }, [isDiff])

  // 是否展开内容区
  const showBody = (hasContent && !collapsed) || (isLoading && !hasContent)

  return (
    <div className={`rounded-lg overflow-hidden text-xs ${
      isError
        ? 'border border-danger-100/30 bg-danger-100/5'
        : 'bg-bg-100/80 border border-border-200/40'
    }`}>
      {/* Header */}
      <div
        className={`flex items-center gap-2 px-3 h-8 select-none transition-colors ${
          canCollapse ? 'cursor-pointer' : ''
        } ${isError
          ? 'bg-danger-100/8 hover:bg-danger-100/12'
          : 'bg-bg-200/40 hover:bg-bg-200/60'
        }`}
        onClick={canCollapse ? () => setCollapsed(!collapsed) : undefined}
      >
        {/* Left: chevron + label + filename */}
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {canCollapse && (
            <span className={`transition-transform duration-200 shrink-0 ${collapsed ? '' : 'rotate-180'} ${
              isError ? 'text-danger-100/60' : 'text-text-500'
            }`}>
              <ChevronDownIcon size={12} />
            </span>
          )}
          <span className={`font-medium font-mono leading-none ${
            isError ? 'text-danger-100' : 'text-text-300'
          }`}>
            {label}
          </span>
          {fileName && (
            <span className="text-text-500 truncate font-mono ml-0.5">{fileName}</span>
          )}
          
          {/* Loading spinner */}
          {isLoading && (
            <div className="flex items-center gap-1.5 text-text-400 ml-1">
              <div className="w-3 h-3 border-2 border-accent-main-100/30 border-t-accent-main-100 rounded-full animate-spin" />
              {loadingText && <span>{loadingText}</span>}
            </div>
          )}
        </div>
        
        {/* Right: stats + actions */}
        <div className="flex items-center gap-2.5 font-mono shrink-0">
          {/* Diff stats */}
          {diffStats && (
            <div className="flex items-center gap-1.5 tabular-nums font-medium text-[10px]">
              {diffStats.additions > 0 && <span className="text-success-100">+{diffStats.additions}</span>}
              {diffStats.deletions > 0 && <span className="text-danger-100">-{diffStats.deletions}</span>}
              {diffStats.additions === 0 && diffStats.deletions === 0 && (
                <span className="text-text-500">No changes</span>
              )}
            </div>
          )}
          
          {/* Fullscreen button (diff only) */}
          {isDiff && diff && !collapsed && (
            <button
              className="p-0.5 text-text-400 hover:text-text-200 rounded transition-colors"
              onClick={(e) => {
                e.stopPropagation()
                setDiffModalOpen(true)
              }}
              title="Fullscreen"
            >
              <MaximizeIcon size={13} />
            </button>
          )}
          
          {/* Exit code */}
          {stats?.exit !== undefined && (
            <span className={`tabular-nums text-[10px] font-medium ${
              stats.exit === 0 ? 'text-accent-secondary-100' : 'text-warning-100'
            }`}>
              exit {stats.exit}
            </span>
          )}
        </div>
      </div>

      {/* Body - grid collapse animation */}
      <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${
        showBody ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
      }`}>
        <div className="overflow-hidden">
          {/* Loading skeleton */}
          {isLoading && !hasContent && (
            <div className="px-3 py-3 space-y-2">
              <div className="h-3 bg-bg-300/40 rounded animate-pulse w-3/4" />
              <div className="h-3 bg-bg-300/40 rounded animate-pulse w-1/2" />
            </div>
          )}
          
          {/* Content */}
          {hasContent && (
            <div ref={contentRef} className="relative group/content">
              {content && <CopyButton text={content} position="absolute" groupName="content" />}
              
              {isDiff && resolvedDiff ? (
                <DiffViewer
                  before={resolvedDiff.before}
                  after={resolvedDiff.after}
                  language={lang}
                  viewMode={diffViewMode}
                  maxHeight={maxHeight}
                />
              ) : content?.trim() ? (
                <CodePreview
                  code={content}
                  language={lang}
                  maxHeight={maxHeight}
                  truncateLines={false}
                />
              ) : stats?.exit !== undefined ? (
                <div className="px-3 py-2 text-text-500 font-mono">
                  {stats.exit === 0 ? 'Completed successfully' : 'No output'}
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
      
      {/* Diff Modal */}
      {isDiff && diff && (
        <DiffModal
          isOpen={diffModalOpen}
          onClose={() => setDiffModalOpen(false)}
          diff={diff}
          filePath={filePath}
          language={lang}
          diffStats={diffStats || undefined}
        />
      )}
    </div>
  )
})
