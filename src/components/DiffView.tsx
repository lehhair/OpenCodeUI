import { memo, useState, useMemo, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { diffLines } from 'diff'
import { ChevronDownIcon, MaximizeIcon } from './Icons'
import { clsx } from 'clsx'
import { detectLanguage } from '../utils/languageUtils'
import { extractContentFromUnifiedDiff } from '../utils/diffUtils'
import { FullscreenViewer, ViewModeSwitch } from './FullscreenViewer'
import { DiffViewer, type ViewMode } from './DiffViewer'

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
}

/** 轻量统计 additions/deletions，不做高亮 */
function computeDiffStats(before: string, after: string) {
  const changes = diffLines(before, after)
  let additions = 0
  let deletions = 0
  for (const change of changes) {
    const count = change.count || 0
    if (change.added) additions += count
    else if (change.removed) deletions += count
  }
  return { additions, deletions }
}

export const DiffView = memo(function DiffView({
  diff,
  before,
  after,
  filePath,
  defaultCollapsed = false,
  maxHeight = 300,
  language: explicitLanguage,
}: DiffViewProps) {
  const { t } = useTranslation(['components', 'common'])
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const [modalOpen, setModalOpen] = useState(false)
  const [fullscreenViewMode, setFullscreenViewMode] = useState<ViewMode>('split')

  // 响应式 diff view mode（全屏弹窗用）
  useEffect(() => {
    if (!modalOpen) return
    const checkWidth = () => setFullscreenViewMode(window.innerWidth >= 1000 ? 'split' : 'unified')
    checkWidth()
    window.addEventListener('resize', checkWidth)
    return () => window.removeEventListener('resize', checkWidth)
  }, [modalOpen])

  // Determine content to diff
  const content = useMemo(() => {
    if (before !== undefined && after !== undefined) {
      return { before, after }
    }
    if (diff) {
      return extractContentFromUnifiedDiff(diff)
    }
    return null
  }, [before, after, diff])

  const hasContent = content !== null

  const language = useMemo(() => {
    return explicitLanguage || detectLanguage(filePath)
  }, [filePath, explicitLanguage])

  const stats = useMemo(() => {
    if (!content) return { additions: 0, deletions: 0 }
    return computeDiffStats(content.before, content.after)
  }, [content])

  // Fallback for unified diff string only
  if (!hasContent && diff) {
    return (
      <div className="border border-border-200/50 rounded-md bg-bg-100 overflow-auto p-2 text-[length:var(--fs-sm)] font-mono whitespace-pre text-text-200">
        {diff}
      </div>
    )
  }

  if (!hasContent) return null

  const fileName = filePath ? filePath.split(/[/\\]/).pop() : undefined

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
          {stats.additions > 0 && <span className="text-success-100">+{stats.additions}</span>}
          {stats.deletions > 0 && <span className="text-danger-100">-{stats.deletions}</span>}
          {stats.additions === 0 && stats.deletions === 0 && (
            <span className="text-text-400">{t('common:noChanges')}</span>
          )}

          {/* 放大按钮 */}
          <button
            className="p-1 text-text-400 hover:text-text-200 hover:bg-bg-300/50 rounded transition-colors"
            onClick={e => {
              e.stopPropagation()
              setModalOpen(true)
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
          <DiffViewer
            before={content.before}
            after={content.after}
            language={language}
            viewMode="unified"
            maxHeight={maxHeight}
          />
        </div>
      </div>

      {/* Fullscreen Diff */}
      {content && (
        <FullscreenViewer
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          title={fileName}
          titleExtra={
            <div className="flex items-center gap-1.5 text-[length:var(--fs-xs)] font-mono tabular-nums shrink-0">
              {stats.additions > 0 && <span className="text-success-100">+{stats.additions}</span>}
              {stats.deletions > 0 && <span className="text-danger-100">-{stats.deletions}</span>}
            </div>
          }
          headerRight={<ViewModeSwitch viewMode={fullscreenViewMode} onChange={setFullscreenViewMode} />}
        >
          <DiffViewer before={content.before} after={content.after} language={language} viewMode={fullscreenViewMode} />
        </FullscreenViewer>
      )}
    </div>
  )
})
