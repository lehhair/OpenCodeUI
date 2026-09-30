/**
 * ContentBlock - 通用内容展示容器
 *
 * 根据内容类型自动选择渲染器：
 * - 普通代码/文本 -> CodePreview
 * - Diff -> DiffViewer
 * - Loading 状态 -> Skeleton
 */

import { memo, useState, useMemo, useEffect, useId, type ReactNode, type TransitionEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { diffLines } from 'diff'
import { ChevronDownIcon, ChevronRightIcon, MaximizeIcon } from './Icons'
import { CopyButton } from './ui'
import { DiffViewer, useDiffViewerData, type ViewMode } from './DiffViewer'
import { CodePreview } from './CodePreview'
import { detectLanguage } from '../utils/languageUtils'
import { ViewModeSwitch } from './FullscreenViewer'
import { extractContentFromUnifiedDiff } from '../utils/diffUtils'
import { useCompositorExpand } from '../hooks/useCompositorExpand'
import { useDelayedRender } from '../hooks/useDelayedRender'
import { useResponsiveMaxHeight } from '../hooks/useResponsiveMaxHeight'
import { useFullscreenLayer } from '../contexts'
import { useUiDisclosureState } from '../utils/uiDisclosureState'

// ============================================
// Types
// ============================================

export interface ContentBlockProps {
  /** 标签 */
  label: string
  /** 标签前的图标 */
  labelIcon?: ReactNode
  /** 隐藏标签文本，仅保留图标 / 文件名 */
  hideLabel?: boolean
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
  /** 全屏状态变化时回调，用于上层保持内容挂载 */
  onFullscreenChange?: (isFullscreen: boolean) => void
  /** 稳定的全屏层 ID，避免源组件重挂后全屏状态丢失 */
  fullscreenId?: string
  /** 折叠状态缓存 key。消息流内传入稳定 key，避免流式刷新重置用户操作。 */
  stateKey?: string

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
  labelIcon,
  hideLabel = false,
  filePath,
  language,
  variant = 'default',
  defaultCollapsed = false,
  maxHeight: maxHeightProp,
  collapsible = true,
  compact = false,
  onFullscreenChange,
  fullscreenId,
  stateKey,
  content,
  diff,
  diffStats: providedDiffStats,
  stats,
  isLoading = false,
  loadingText,
}: ContentBlockProps) {
  const { t } = useTranslation(['components', 'common'])
  const resolvedLoadingText = loadingText ?? t('common:loading')
  const generatedFullscreenId = useId()
  const [cachedCollapsed, setCachedCollapsed] = useUiDisclosureState(
    stateKey ?? `content-block:${generatedFullscreenId}`,
    compact ? false : defaultCollapsed,
  )
  const [diffViewMode, setDiffViewMode] = useState<ViewMode>('split')
  const [fullscreenDiffViewMode, setFullscreenDiffViewMode] = useState<ViewMode>('split')
  const [contentLayoutVersion, setContentLayoutVersion] = useState(0)

  // 响应式 maxHeight，外部传入的值优先
  const responsiveMaxHeight = useResponsiveMaxHeight()

  const isError = variant === 'error'
  const maxHeight = maxHeightProp ?? responsiveMaxHeight
  const isDiff = !!diff
  const hasContent = !!content?.trim() || isDiff || stats?.exit !== undefined
  const canCollapse = !compact && collapsible && hasContent
  const lang = language || (filePath ? detectLanguage(filePath) : 'text')
  const fileName = filePath?.split(/[/\\]/).pop()
  const resolvedFullscreenId = fullscreenId ?? `content-block:${generatedFullscreenId}`
  const collapsed = compact ? false : cachedCollapsed

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
  const diffViewerData = useDiffViewerData(resolvedDiff?.before ?? '', resolvedDiff?.after ?? '', lang, false, isDiff)

  const fullscreenTitleExtra = useMemo(
    () =>
      diffStats && (
        <div className="flex items-center gap-1.5 text-[length:var(--fs-xs)] font-mono tabular-nums shrink-0">
          {diffStats.additions > 0 && <span className="text-success-100">+{diffStats.additions}</span>}
          {diffStats.deletions > 0 && <span className="text-danger-100">-{diffStats.deletions}</span>}
        </div>
      ),
    [diffStats],
  )

  const fullscreenHeaderRight = useMemo(() => {
    if (isDiff && resolvedDiff) {
      return <ViewModeSwitch viewMode={fullscreenDiffViewMode} onChange={setFullscreenDiffViewMode} />
    }
    if (content?.trim()) {
      return <CopyButton text={content} position="static" />
    }
    return undefined
  }, [content, fullscreenDiffViewMode, isDiff, resolvedDiff])

  const fullscreenContent = useMemo(() => {
    if (isDiff && resolvedDiff) {
      return (
        <DiffViewer
          before={resolvedDiff.before}
          after={resolvedDiff.after}
          language={lang}
          viewMode={fullscreenDiffViewMode}
          data={diffViewerData}
          stateKey={stateKey ? `${stateKey}:fullscreen-diff` : undefined}
        />
      )
    }
    if (content?.trim()) {
      return <CodePreview code={content} language={lang} />
    }
    return null
  }, [content, diffViewerData, fullscreenDiffViewMode, isDiff, lang, resolvedDiff, stateKey])

  const fullscreenLayer = useMemo(() => {
    if (!fullscreenContent) return null
    return {
      id: resolvedFullscreenId,
      title: fileName || label,
      titleExtra: isDiff ? fullscreenTitleExtra : undefined,
      headerRight: fullscreenHeaderRight,
      deferContent: isDiff && !!resolvedDiff,
      content: fullscreenContent,
    }
  }, [
    fileName,
    fullscreenContent,
    fullscreenHeaderRight,
    fullscreenTitleExtra,
    isDiff,
    label,
    resolvedDiff,
    resolvedFullscreenId,
  ])
  const { isOpen: fullscreenOpen, open: openFullscreen } = useFullscreenLayer(fullscreenLayer)

  // 是否展开内容区
  const showBody = (hasContent && !collapsed) || (isLoading && !hasContent)
  const { contentRef, layoutOpen, keepMounted, panelClassName } = useCompositorExpand(showBody)
  const shouldRenderContent = useDelayedRender(keepMounted)

  useEffect(() => {
    onFullscreenChange?.(fullscreenOpen)
    return () => {
      if (fullscreenOpen) onFullscreenChange?.(false)
    }
  }, [fullscreenOpen, onFullscreenChange])

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
  }, [isDiff, contentRef, shouldRenderContent, layoutOpen])

  // 全屏时响应式切换 diff view mode
  useEffect(() => {
    if (!fullscreenOpen || !isDiff) return
    const checkWidth = () => setFullscreenDiffViewMode(window.innerWidth >= 1000 ? 'split' : 'unified')
    checkWidth()
    window.addEventListener('resize', checkWidth)
    return () => window.removeEventListener('resize', checkWidth)
  }, [fullscreenOpen, isDiff])

  const handleBodyTransitionEnd = (event: TransitionEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || !layoutOpen) return
    setContentLayoutVersion(version => version + 1)
  }

  // 容器样式
  const containerClass = isError
    ? 'border border-danger-100/30 bg-danger-100/5'
    : 'bg-bg-100 border border-border-200/40'

  // Header 样式
  const headerClass = isError ? 'bg-danger-100/8 hover:bg-danger-100/12' : 'bg-bg-200/40 hover:bg-bg-200/60'

  return (
    <div className={`rounded-md overflow-hidden text-[length:var(--fs-sm)] ${containerClass}`}>
      {/* Header */}
      <div
        className={`flex items-center gap-2 px-3 h-8 select-none transition-colors ${
          canCollapse ? 'cursor-pointer' : ''
        } ${headerClass}`}
        onClick={canCollapse ? () => setCachedCollapsed(!collapsed) : undefined}
      >
        {/* Left: chevron + label + filename */}
        <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden">
          {canCollapse && (
            <span className={`shrink-0 ${isError ? 'text-danger-100/60' : 'text-text-500'}`}>
              {collapsed ? <ChevronRightIcon size={12} /> : <ChevronDownIcon size={12} />}
            </span>
          )}
          {labelIcon && <span className="flex h-4 w-4 shrink-0 items-center justify-center">{labelIcon}</span>}
          {!hideLabel && (
            <span
              className={`font-medium font-mono leading-4 whitespace-nowrap ${
                isError ? 'text-danger-100' : 'text-text-300'
              }`}
            >
              {label}
            </span>
          )}
          {fileName && (
            <span className={`text-text-500 truncate font-mono leading-4 min-w-0 flex-1 ${hideLabel ? '' : 'ml-0.5'}`}>
              {fileName}
            </span>
          )}

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
                openFullscreen()
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
        data-content-block-body
        onTransitionEnd={handleBodyTransitionEnd}
        className={`grid ${panelClassName} ${layoutOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
      >
        <div className="overflow-hidden min-h-0">
          {shouldRenderContent && hasContent && (
            <div ref={contentRef} className="relative group/content">
              {content && <CopyButton text={content} position="absolute" groupName="content" />}

              {isDiff && resolvedDiff ? (
                <DiffViewer
                  before={resolvedDiff.before}
                  after={resolvedDiff.after}
                  language={lang}
                  viewMode={diffViewMode}
                  maxHeight={maxHeight}
                  data={diffViewerData}
                  stateKey={stateKey ? `${stateKey}:diff` : undefined}
                />
              ) : content?.trim() ? (
                <CodePreview
                  code={content}
                  language={lang}
                  maxHeight={maxHeight}
                  isVisible={layoutOpen}
                  layoutVersion={contentLayoutVersion}
                />
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  )
})
