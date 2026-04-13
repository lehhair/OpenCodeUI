import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RetryIcon, PatchIcon, ChevronDownIcon, FileIcon } from '../../../components/Icons'
import { useDelayedRender } from '../../../hooks/useDelayedRender'
import type { RetryPart, CompactionPart, PatchPart } from '../../../types/message'

// ============================================
// Retry Part View - 显示重试状态
// ============================================

interface RetryPartViewProps {
  part: RetryPart
}

export const RetryPartView = memo(function RetryPartView({ part }: RetryPartViewProps) {
  const { t } = useTranslation('message')
  const [expanded, setExpanded] = useState(false)
  const shouldRenderBody = useDelayedRender(expanded)
  const { attempt, error, time } = part

  const timeStr = new Date(time.created).toLocaleTimeString()
  const isRetryable = error.data.isRetryable

  return (
    <div className="px-3 py-2 rounded-md bg-warning-100/10 border border-warning-100/20">
      <div className="flex items-center gap-2 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <RetryIcon className="w-4 h-4 text-warning-100 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-[length:var(--fs-base)] text-warning-100">{t('system.retryAttempt', { attempt })}</span>
          <span className="text-[length:var(--fs-sm)] text-text-500 ml-2">{timeStr}</span>
        </div>
        {isRetryable && (
          <span className="text-[length:var(--fs-xxs)] text-warning-100/70 bg-warning-100/10 px-1.5 py-0.5 rounded">
            {t('system.retryable')}
          </span>
        )}
        <ChevronDownIcon
          className={`w-4 h-4 text-text-400 transition-transform duration-300 ${expanded ? '' : '-rotate-90'}`}
        />
      </div>

      <div
        className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${
          expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}
      >
        <div className="overflow-hidden">
          {shouldRenderBody && (
            <div className="mt-2 pt-2 border-t border-warning-100/20">
              <p className="text-[length:var(--fs-sm)] text-text-300 font-mono whitespace-pre-wrap break-words overflow-x-hidden">
                {error.data.message}
              </p>
              {error.data.statusCode && (
                <p className="text-[length:var(--fs-xxs)] text-text-500 mt-1">
                  {t('system.statusCode', { code: error.data.statusCode })}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
})

// ============================================
// Compaction Part View - 显示上下文压缩
// ============================================

interface CompactionPartViewProps {
  part: CompactionPart
}

export const CompactionPartView = memo(function CompactionPartView({ part }: CompactionPartViewProps) {
  const { t } = useTranslation('message')
  void part

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-[length:var(--fs-sm)] text-text-500">
      <span className="flex-1 h-px bg-border-200/70" />
      <span className="shrink-0 text-[length:var(--fs-xs)] leading-none text-text-400">{t('system.contextCompacted')}</span>
      <span className="flex-1 h-px bg-border-200/70" />
    </div>
  )
})

// ============================================
// Patch Part View - 显示文件变更补丁
// ============================================

interface PatchPartViewProps {
  part: PatchPart
}

export const PatchPartView = memo(function PatchPartView({ part }: PatchPartViewProps) {
  const { t } = useTranslation('message')
  const [expanded, setExpanded] = useState(false)
  const shouldRenderBody = useDelayedRender(expanded)
  const { hash, files } = part
  const fileCount = files.length

  return (
    <div className="rounded-md border border-border-200/60 bg-bg-100/50 overflow-hidden">
      <div
        className="flex items-center gap-2 px-3 h-8 cursor-pointer hover:bg-bg-200/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <PatchIcon className="w-4 h-4 text-text-400 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-[length:var(--fs-base)] text-text-200">{t('system.filesChanged', { count: fileCount })}</span>
          <span className="text-[length:var(--fs-sm)] text-text-500 ml-2 font-mono">{hash.slice(0, 7)}</span>
        </div>
        <ChevronDownIcon
          className={`w-4 h-4 text-text-400 transition-transform duration-300 ${expanded ? '' : '-rotate-90'}`}
        />
      </div>

      <div
        className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${
          expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}
      >
        <div className="overflow-hidden">
          {shouldRenderBody && (
            <div className="px-3 py-2 border-t border-border-200/40 space-y-1">
              {files.map((file, idx) => (
                <div key={idx} className="flex items-center gap-2 text-[length:var(--fs-sm)]">
                  <FileIcon className="w-3 h-3 text-text-500" />
                  <span className="text-text-300 font-mono truncate">{file}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
})
