import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { ContentBlock } from '../../../../components'
import { AlertCircleIcon } from '../../../../components/Icons'
import { detectLanguage } from '../../../../utils/languageUtils'
import { getMaterialIconUrl } from '../../../../utils/materialIcons'
import { themeStore } from '../../../../store/themeStore'
import type { ToolRendererProps, ExtractedToolData } from '../types'

// ============================================
// Default Tool Renderer
// 通用的 Input/Output 渲染逻辑
// ============================================

export function DefaultRenderer({ part, data }: ToolRendererProps) {
  const { t } = useTranslation('message')
  const { state, tool } = part
  const { toolCardStyle } = useSyncExternalStore(themeStore.subscribe, themeStore.getSnapshot)
  const isCompact = toolCardStyle === 'compact'
  const isActive = state.status === 'running' || state.status === 'pending'

  const hasInput = !!data.input?.trim()
  const hasError = !!data.error
  const hasOutput = !!(data.files || data.diff || data.output?.trim() || data.exitCode !== undefined)
  const hasDiagnostics = !!data.diagnostics?.length

  const showOutput = hasOutput || hasError || (isActive && !hasOutput)

  // compact 模式下，工具还在运行且没有任何输出时，不渲染任何东西
  if (isCompact && isActive && !hasOutput && !hasError) {
    return null
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Input — compact 模式下不渲染 */}
      {!isCompact && (hasInput || (isActive && !hasInput)) && (
        <ContentBlock
          label={t('defaultRenderer.input')}
          content={data.input || ''}
          language={data.inputLang}
          isLoading={isActive && !hasInput}
          loadingText=""
          defaultCollapsed={true}
        />
      )}

      {/* Output */}
      {showOutput && (
        <OutputBlock
          tool={tool}
          data={data}
          isActive={isActive}
          hasError={hasError}
          hasOutput={hasOutput}
          compact={isCompact}
        />
      )}

      {/* Diagnostics */}
      {hasDiagnostics && <DiagnosticsBlock diagnostics={data.diagnostics!} />}
    </div>
  )
}

// ============================================
// Output Block
// ============================================

interface OutputBlockProps {
  tool: string
  data: ExtractedToolData
  isActive: boolean
  hasError: boolean
  hasOutput: boolean
  compact?: boolean
}

function OutputBlock({ tool, data, isActive, hasError, hasOutput, compact }: OutputBlockProps) {
  const { t } = useTranslation('message')

  // 1. Error 优先
  if (hasError) {
    return (
      <ContentBlock label={t('defaultRenderer.error')} content={data.error || ''} variant="error" compact={compact} />
    )
  }

  // 2. 工具活跃时（running/pending）统一显示 loading — compact 模式下不显示
  if (isActive) {
    if (compact) return null
    return <ContentBlock label={t('defaultRenderer.output')} isLoading={true} loadingText="" compact={compact} />
  }

  // 3. 完成后显示结果
  if (hasOutput) {
    // Multiple files with diff
    if (data.files) {
      return (
        <div className="flex flex-col gap-2">
          {data.files.map((file, idx) => (
            <ContentBlock
              key={idx}
              label={formatLabel(tool, t)}
              labelIcon={<FileResultIcon filePath={file.filePath} />}
              hideLabel
              filePath={file.filePath}
              diff={
                file.diff ||
                file.patch ||
                (file.before !== undefined && file.after !== undefined
                  ? { before: file.before, after: file.after }
                  : undefined)
              }
              language={detectLanguage(file.filePath)}
              compact={compact}
            />
          ))}
        </div>
      )
    }

    // Single diff
    if (data.diff) {
      return (
        <ContentBlock
          label={t('defaultRenderer.output')}
          labelIcon={data.filePath ? <FileResultIcon filePath={data.filePath} /> : undefined}
          hideLabel={!!data.filePath}
          filePath={data.filePath}
          diff={data.diff}
          diffStats={data.diffStats}
          language={data.outputLang}
          compact={compact}
        />
      )
    }

    // Regular output
    return (
      <ContentBlock
        label={t('defaultRenderer.output')}
        content={data.output}
        language={data.outputLang}
        filePath={data.filePath}
        stats={data.exitCode !== undefined ? { exit: data.exitCode } : undefined}
        compact={compact}
      />
    )
  }

  // 4. 无输出
  return <ContentBlock label={t('defaultRenderer.output')} compact={compact} />
}

function FileResultIcon({ filePath }: { filePath: string }) {
  return (
    <img
      src={getMaterialIconUrl(filePath, 'file')}
      alt=""
      width={14}
      height={14}
      className="block h-3.5 w-3.5 shrink-0"
      loading="lazy"
      decoding="async"
      onError={event => {
        event.currentTarget.style.visibility = 'hidden'
      }}
    />
  )
}

// ============================================
// Diagnostics Block
// ============================================

interface DiagnosticsBlockProps {
  diagnostics: NonNullable<ExtractedToolData['diagnostics']>
}

function DiagnosticsBlock({ diagnostics }: DiagnosticsBlockProps) {
  const { t } = useTranslation('message')
  const errors = diagnostics.filter(d => d.severity === 'error')
  const warnings = diagnostics.filter(d => d.severity === 'warning')

  if (errors.length === 0 && warnings.length === 0) return null

  return (
    <div className="rounded-md border border-border-200/40 bg-bg-100/80 overflow-hidden text-[length:var(--fs-sm)]">
      <div className="px-3 h-8 bg-bg-200/40 flex items-center gap-2">
        <AlertCircleIcon className="w-3.5 h-3.5 text-text-400" />
        <span className="font-medium text-text-300">{t('defaultRenderer.diagnostics')}</span>
        <div className="flex items-center gap-2 ml-auto font-mono text-[length:var(--fs-xxs)]">
          {errors.length > 0 && (
            <span className="text-danger-100">{t('defaultRenderer.errorsCount', { count: errors.length })}</span>
          )}
          {warnings.length > 0 && (
            <span className="text-warning-100">{t('defaultRenderer.warningsCount', { count: warnings.length })}</span>
          )}
        </div>
      </div>
      <div className="px-3 py-2 space-y-1.5 max-h-40 overflow-auto custom-scrollbar">
        {diagnostics.map((d, idx) => (
          <div key={idx} className="flex items-start gap-2 text-[length:var(--fs-code)]">
            <span
              className={`flex-shrink-0 mt-1 w-1.5 h-1.5 rounded-full ${
                d.severity === 'error' ? 'bg-danger-100' : 'bg-warning-100'
              }`}
            />
            <span className="text-text-400 font-mono flex-shrink-0">
              {d.file}:{d.line + 1}
            </span>
            <span className="text-text-300 break-words">{d.message}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ============================================
// Helpers
// ============================================

function formatLabel(name: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  if (!name) return t('defaultRenderer.result')
  const formatted = name
    .split(/[_-]/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
  return t('defaultRenderer.nameResult', { name: formatted })
}
