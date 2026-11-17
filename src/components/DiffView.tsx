import { memo, useState, useMemo, useEffect, useId } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDownIcon, MaximizeIcon } from './Icons'
import { clsx } from 'clsx'
import { detectLanguage } from '../utils/languageUtils'
import {
  diffLineStats,
  extractContentFromUnifiedDiff,
  MAX_DIFF_DETAIL_CHARS,
  reconstructBeforeAfterFromPatch,
} from '../utils/diffUtils'
import { cropContent } from '../utils/contentBudget'
import { ViewModeSwitch } from './FullscreenViewer'
import { DiffViewer, useDiffViewerData, type ViewMode } from './DiffViewer'
import { CodePreview } from './CodePreview'
import { CopyButton, TruncatedNote } from './ui'
import { useFullscreenLayer } from '../contexts'

interface DiffViewProps {
  /** Unified diff format string */
  diff?: string
  /** Original content */
  before?: string
  /** New content */
  after?: string
  /** File path for title and language detection */
  filePath?: string
  /** Default collapsed state */
  defaultCollapsed?: boolean
  /** Max height of the diff view */
  maxHeight?: number
  /** Explicit language */
  language?: string
  /** 去掉外层卡片 / 头部 / 边框，只渲染 diff 正文（挂在文件行下面时用） */
  bare?: boolean
}

/** 轻量统计 additions/deletions，不做高亮（超限返回 null） */
function computeDiffStats(before: string, after: string) {
  return diffLineStats(before, after)
}

export const DiffView = memo(function DiffView({
  diff,
  before,
  after,
  filePath,
  defaultCollapsed = false,
  maxHeight,
  language: explicitLanguage,
  bare = false,
}: DiffViewProps) {
  const { t } = useTranslation(['components', 'common'])
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const [fullscreenViewMode, setFullscreenViewMode] = useState<ViewMode>('split')
  const generatedFullscreenId = useId()

  // Determine content to diff
  const content = useMemo(() => {
    if (before !== undefined && after !== undefined) {
      return { before, after }
    }
    if (diff) {
      // 优先按 patch 的 @@ 绝对行号还原完整 before/after（行号正确）；
      // 失败（非标准 patch、超大等）退回片段提取（行号从 1 开始）
      return reconstructBeforeAfterFromPatch(diff) ?? extractContentFromUnifiedDiff(diff)
    }
    return null
  }, [before, after, diff])

  const hasContent = content !== null

  const language = useMemo(() => {
    return explicitLanguage || detectLanguage(filePath)
  }, [filePath, explicitLanguage])

  // 大 diff 不走逐行视图：`useDiffViewerData` 会把整份文件摊成行对象，
  // 权限确认弹窗里打开一个几 MB 的编辑照样会卡死。
  const contentTooLarge =
    !!content && content.before.length + content.after.length > MAX_DIFF_DETAIL_CHARS
  const previewText = content ? (content.after.trim() ? content.after : content.before) : ''
  const croppedPreview = useMemo(
    () => (contentTooLarge ? cropContent(previewText) : null),
    [contentTooLarge, previewText],
  )

  const diffViewerData = useDiffViewerData(
    content?.before ?? '',
    content?.after ?? '',
    language,
    false,
    !contentTooLarge,
  )

  const stats = useMemo(() => {
    if (!content) return null
    return computeDiffStats(content.before, content.after)
  }, [content])
  const fileName = filePath ? filePath.split(/[/\\]/).pop() : undefined
  const fullscreenLayer = useMemo(
    () =>
      content
        ? {
            id: `diff-view:${generatedFullscreenId}`,
            title: fileName,
            titleExtra: stats ? (
              <div className="flex items-center gap-1.5 text-[length:var(--fs-xs)] font-mono tabular-nums shrink-0">
                {stats.additions > 0 && <span className="text-success-100">+{stats.additions}</span>}
                {stats.deletions > 0 && <span className="text-danger-100">-{stats.deletions}</span>}
              </div>
            ) : undefined,
            headerRight: contentTooLarge ? (
              <CopyButton text={previewText} position="static" />
            ) : (
              <ViewModeSwitch viewMode={fullscreenViewMode} onChange={setFullscreenViewMode} />
            ),
            deferContent: true,
            content: contentTooLarge ? (
              <CodePreview code={previewText} language={language} />
            ) : (
              <DiffViewer
                before={content.before}
                after={content.after}
                language={language}
                viewMode={fullscreenViewMode}
                data={diffViewerData}
              />
            ),
          }
        : null,
    [
      content,
      contentTooLarge,
      diffViewerData,
      fileName,
      fullscreenViewMode,
      generatedFullscreenId,
      language,
      previewText,
      stats,
    ],
  )
  const { isOpen: fullscreenOpen, open: openFullscreen } = useFullscreenLayer(fullscreenLayer)

  // 响应式 diff view mode（全屏弹窗用）
  useEffect(() => {
    if (!fullscreenOpen) return
    const checkWidth = () => setFullscreenViewMode(window.innerWidth >= 1000 ? 'split' : 'unified')
    checkWidth()
    window.addEventListener('resize', checkWidth)
    return () => window.removeEventListener('resize', checkWidth)
  }, [fullscreenOpen])

  if (bare) {
    if (!content) {
      return diff ? (
        <pre className="overflow-auto whitespace-pre p-3 font-mono text-[length:var(--fs-sm)] text-text-200">{diff}</pre>
      ) : null
    }
    return (
      <div className="overflow-hidden font-mono text-[length:var(--fs-code)]">
        {contentTooLarge ? (
          <div>
            <CodePreview code={croppedPreview?.text ?? ''} language={language} maxHeight={maxHeight} />
            <div className="border-t border-border-200/40 px-3 py-1.5 text-[length:var(--fs-xxs)] text-text-500">
              {t('contentBlock.diffFallback')}
            </div>
            {croppedPreview?.cropped && (
              <TruncatedNote
                className="border-t border-border-200/40 px-3 py-1.5 text-[length:var(--fs-xxs)] text-text-500"
                omittedLines={croppedPreview.omittedLines}
                omittedChars={croppedPreview.omittedChars}
              />
            )}
          </div>
        ) : (
          <DiffViewer
            before={content.before}
            after={content.after}
            language={language}
            viewMode="unified"
            maxHeight={maxHeight}
            data={diffViewerData}
            stateKey={`${generatedFullscreenId}:bare`}
          />
        )}
      </div>
    )
  }

  // Fallback for unified diff string only
  if (!hasContent && diff) {
    return (
      <div className="border border-border-200/50 rounded-md bg-bg-100 overflow-auto p-2 text-[length:var(--fs-sm)] font-mono whitespace-pre text-text-200">
        {diff}
      </div>
    )
  }

  if (!hasContent) return null

  return (
    <div className="border border-border-200/50 rounded-md overflow-hidden bg-bg-100 font-mono text-[length:var(--fs-code)]">
      {/* Header */}
      <div
        className="flex items-center gap-3 px-3 h-8 bg-bg-200/50 cursor-pointer hover:bg-bg-200 transition-colors select-none"
        onClick={() => setCollapsed(!collapsed)}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className={`transition-transform duration-200 ${collapsed ? '-rotate-90' : ''} text-text-400`}>
            <ChevronDownIcon />
          </div>
          {fileName && <span className="text-text-200 font-medium truncate flex-1 min-w-0">{fileName}</span>}
        </div>
        <div className="flex items-center gap-3 tabular-nums font-medium shrink-0 whitespace-nowrap">
          {stats && stats.additions > 0 && <span className="text-success-100">+{stats.additions}</span>}
          {stats && stats.deletions > 0 && <span className="text-danger-100">-{stats.deletions}</span>}
          {stats && stats.additions === 0 && stats.deletions === 0 && (
            <span className="text-text-400">{t('common:noChanges')}</span>
          )}

          {/* 放大按钮 */}
          <button
            className="p-1 text-text-400 hover:text-text-200 hover:bg-bg-300/50 rounded transition-colors"
            onClick={e => {
              e.stopPropagation()
              openFullscreen()
            }}
            title={t('diffView.fullscreenView')}
          >
            <MaximizeIcon size={14} />
          </button>
        </div>
      </div>

      {/* Content - 使用 grid 实现平滑展开动画 */}
      <div
        className={clsx(
          'grid transition-[grid-template-rows] duration-300 ease-in-out',
          collapsed ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]',
        )}
      >
        <div className="overflow-hidden">
          {contentTooLarge ? (
            <div>
              <CodePreview code={croppedPreview?.text ?? ''} language={language} maxHeight={maxHeight ?? 300} />
              <div className="border-t border-border-200/40 px-3 py-1.5 text-[length:var(--fs-xxs)] text-text-500">
                {t('contentBlock.diffFallback')}
              </div>
              {croppedPreview?.cropped && (
                <TruncatedNote
                  className="border-t border-border-200/40 px-3 py-1.5 text-[length:var(--fs-xxs)] text-text-500"
                  omittedLines={croppedPreview.omittedLines}
                  omittedChars={croppedPreview.omittedChars}
                />
              )}
            </div>
          ) : (
            <DiffViewer
              before={content.before}
              after={content.after}
              language={language}
              viewMode="unified"
              maxHeight={maxHeight ?? 300}
              data={diffViewerData}
            />
          )}
        </div>
      </div>
    </div>
  )
})
