/**
 * ContentBlock - 通用内容展示容器
 *
 * 根据内容类型自动选择渲染器：
 * - 普通代码/文本 -> CodePreview
 * - Diff -> DiffViewer
 * - Loading 状态 -> Skeleton
 */

import { memo, useState, useMemo, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { diffLines } from 'diff'
import { ChevronDownIcon, ChevronRightIcon, MaximizeIcon } from './Icons'
import { CopyButton } from './ui'
import { DiffViewer, type ViewMode } from './DiffViewer'
import { CodePreview } from './CodePreview'
import { detectLanguage } from '../utils/languageUtils'
import { FullscreenViewer, ViewModeSwitch } from './FullscreenViewer'
import { extractContentFromUnifiedDiff } from '../utils/diffUtils'
import { useResponsiveMaxHeight } from '../hooks/useResponsiveMaxHeight'

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
  /** 精简模式：header 和代码行等高（20px），不可折叠 */
  compact?: boolean

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
  maxHeight: maxHeightProp,
  collapsible = true,
  compact = false,
  content,
  diff,
  diffStats: providedDiffStats,
  stats,
  isLoading = false,
  loadingText,
}: ContentBlockProps) {
  const { t } = useTranslation(['components', 'common'])
  const resolvedLoadingText = loadingText ?? t('common:loading')
  const [collapsed, setCollapsed] = useState(compact ? false : defaultCollapsed)
  const [fullscreenOpen, setFullscreenOpen] = useState(false)
  const [diffViewMode, setDiffViewMode] = useState<ViewMode>('split')
  const [fullscreenDiffViewMode, setFullscreenDiffViewMode] = useState<ViewMode>('split')
  const contentRef = useRef<HTMLDivElement>(null)

  // 响应式 maxHeight，外部传入的值优先
  const responsiveMaxHeight = useResponsiveMaxHeight()

  const isError = variant === 'error'
  const maxHeight = maxHeightProp ?? responsiveMaxHeight
  const isDiff = !!diff
  const hasContent = !!content?.trim() || isDiff || stats?.exit !== undefined
  const canCollapse = !compact && collapsible && hasContent
  const lang = language || (filePath ? detectLanguage(filePath) : 'text')
  const fileName = filePath?.split(/[/\\]/).pop()

  // Diff 统计
  const diffStats = useMemo(() => {
    if (!isDiff) return null
    if (providedDiffStats) return providedDiffStats

    if (typeof diff === 'object') {
      const changes = diffLines(diff.before, diff.after)
      let additions = 0,
        deletions = 0
      for (const c of changes) {
        if (c.added) additions += c.count || 0
        if (c.removed) deletions += c.count || 0
      }
      return { additions, deletions }
    }

    const lines = (diff as string).split('\n')
    let additions = 0,
      deletions = 0
    for (const line of lines) {
      if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('Index:') || line.startsWith('==='))
        continue
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

  // 全屏时响应式切换 diff view mode
  useEffect(() => {
    if (!fullscreenOpen || !isDiff) return
    const checkWidth = () => setFullscreenDiffViewMode(window.innerWidth >= 1000 ? 'split' : 'unified')
    checkWidth()
    window.addEventListener('resize', checkWidth)
    return () => window.removeEventListener('resize', checkWidth)
  }, [fullscreenOpen, isDiff])

  // 是否展开内容区
  const showBody = (hasContent && !collapsed) || (isLoading && !hasContent)

  // 容器样式
  const containerClass = isError
    ? 'border border-danger-100/30 bg-danger-100/5'
    : 'bg-bg-100 border border-border-200/40'

  // Header 样式
  const headerClass = isError ? 'bg-danger-100/8 hover:bg-danger-100/12' : 'bg-bg-200/40 hover:bg-bg-200/60'

  return (
    <div className={`rounded-md overflow-hidden text-[length:var(--fs-sm)] contain-content ${containerClass}`}>
      {/* Header */}
      <div
        className={`flex items-center gap-2 px-3 h-8 select-none transition-colors ${
          canCollapse ? 'cursor-pointer' : ''
        } ${headerClass}`}
        onClick={canCollapse ? () => setCollapsed(!collapsed) : undefined}
      >
        {/* Left: chevron + label + filename */}
        <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden">
          {canCollapse && (
            <span className={`shrink-0 ${isError ? 'text-danger-100/60' : 'text-text-500'}`}>
              {collapsed ? <ChevronRightIcon size={12} /> : <ChevronDownIcon size={12} />}
            </span>
          )}
          <span
            className={`font-medium font-mono leading-none whitespace-nowrap ${
              isError ? 'text-danger-100' : 'text-text-300'
            }`}
          >
            {label}
          </span>
          {fileName && <span className="text-text-500 truncate font-mono min-w-0 flex-1 ml-0.5">{fileName}</span>}

          {/* Loading spinner */}
          {isLoading && (
            <div className="flex items-center gap-1.5 text-text-400 ml-1">
              <div className="w-3 h-3 border-2 border-accent-main-100/30 border-t-accent-main-100 rounded-full animate-spin" />
              {resolvedLoadingText && <span>{resolvedLoadingText}</span>}
            </div>
          )}
        </div>

        {/* Right: stats + actions */}
        <div className="flex items-center gap-2.5 font-mono shrink-0">
          {/* Diff stats */}
          {diffStats && (
            <div className="flex items-center gap-1.5 tabular-nums font-medium text-[length:var(--fs-xxs)]">
              {diffStats.additions > 0 && <span className="text-success-100">+{diffStats.additions}</span>}
              {diffStats.deletions > 0 && <span className="text-danger-100">-{diffStats.deletions}</span>}
              {diffStats.additions === 0 && diffStats.deletions === 0 && (
                <span className="text-text-500">{t('common:noChanges')}</span>
              )}
            </div>
          )}

          {/* Fullscreen button - 支持 diff 和代码 */}
          {(isDiff || content?.trim()) && !collapsed && (
            <button
              className="p-0.5 text-text-400 hover:text-text-200 rounded transition-colors"
              onClick={e => {
                e.stopPropagation()
                setFullscreenOpen(true)
              }}
              title={t('contentBlock.fullscreen')}
            >
              <MaximizeIcon size={13} />
            </button>
          )}

          {/* Exit code */}
          {stats?.exit !== undefined && (
            <span
              className={`tabular-nums text-[length:var(--fs-xxs)] font-medium ${
                stats.exit === 0 ? 'text-accent-secondary-100' : 'text-warning-100'
              }`}
            >
              {t('contentBlock.exitCode', { code: stats.exit })}
            </span>
          )}
        </div>
      </div>

      {/* Body - grid collapse animation */}
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-out ${
          showBody ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden">
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
                <CodePreview code={content} language={lang} maxHeight={maxHeight} />
              ) : null}
            </div>
          )}
        </div>
      </div>

      {/* Fullscreen Viewer - 支持 diff 和代码 */}
      {isDiff && diff && resolvedDiff ? (
        <FullscreenViewer
          isOpen={fullscreenOpen}
          onClose={() => setFullscreenOpen(false)}
          title={fileName || label}
          titleExtra={
            diffStats && (
              <div className="flex items-center gap-1.5 text-[length:var(--fs-xs)] font-mono tabular-nums shrink-0">
                {diffStats.additions > 0 && <span className="text-success-100">+{diffStats.additions}</span>}
                {diffStats.deletions > 0 && <span className="text-danger-100">-{diffStats.deletions}</span>}
              </div>
            )
          }
          headerRight={<ViewModeSwitch viewMode={fullscreenDiffViewMode} onChange={setFullscreenDiffViewMode} />}
        >
          <DiffViewer
            before={resolvedDiff.before}
            after={resolvedDiff.after}
            language={lang}
            viewMode={fullscreenDiffViewMode}
          />
        </FullscreenViewer>
      ) : content?.trim() ? (
        <FullscreenViewer
          isOpen={fullscreenOpen}
          onClose={() => setFullscreenOpen(false)}
          title={fileName || label}
          headerRight={<CopyButton text={content} position="static" />}
        >
          <CodePreview code={content} language={lang} />
        </FullscreenViewer>
      ) : null}
    </div>
  )
})
