import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { ContentBlock } from '../../../../components'
import { AlertCircleIcon } from '../../../../components/Icons'
import { AttachmentItem } from '../../../attachment'
import { detectLanguage } from '../../../../utils/languageUtils'
import { getMaterialIconUrl } from '../../../../utils/materialIcons'
import { themeStore } from '../../../../store/themeStore'
import type { ToolRendererProps, ExtractedToolData } from '../types'

// ============================================
// Default Tool Renderer
// 通用的 Input/Output 渲染逻辑
// ============================================

export function DefaultRenderer({ part, data, onFullscreenChange }: ToolRendererProps) {
  const { t } = useTranslation('message')
  const { state } = part
  const { toolCardStyle } = useSyncExternalStore(themeStore.subscribe, themeStore.getSnapshot)
  const isCompact = toolCardStyle === 'compact'
  const isActive = state.status === 'running' || state.status === 'streaming'
  const hasError = !!data.error || !!data.failed

  const hasInput = !!data.input?.trim()
  const hasToolFiles = !!data.toolFiles?.length
  const hasOutput = !!(data.files || data.diff || data.output?.trim() || data.exitCode !== undefined || hasToolFiles)
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
          stateKey={`message:${part.messageID}:tool:${part.id}:input`}
          label={t('defaultRenderer.input')}
          content={data.input || ''}
          language={data.inputLang}
          isLoading={isActive && !hasInput}
          loadingText=""
          defaultCollapsed={true}
          onFullscreenChange={onFullscreenChange}
          fullscreenId={`tool:${part.messageID}:${part.id}:input`}
        />
      )}

      {/* Output */}
      {showOutput && (
        <OutputBlock
          tool={part.name}
          data={data}
          isActive={isActive}
          hasError={hasError}
          hasOutput={hasOutput}
          compact={isCompact}
          onFullscreenChange={onFullscreenChange}
          fullscreenBaseId={`tool:${part.messageID}:${part.id}:output`}
          stateBaseKey={`message:${part.messageID}:tool:${part.id}:output`}
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
  onFullscreenChange?: (isFullscreen: boolean) => void
  fullscreenBaseId: string
  stateBaseKey: string
}

function OutputBlock({
  tool,
  data,
  isActive,
  hasError,
  hasOutput,
  compact,
  onFullscreenChange,
  fullscreenBaseId,
  stateBaseKey,
}: OutputBlockProps) {
  const { t } = useTranslation('message')

  // 1. Error 优先
  if (hasError) {
    return (
      <div className="flex flex-col gap-2">
        <ContentBlock
          stateKey={stateBaseKey}
          label={t('defaultRenderer.error')}
          content={data.error || ''}
          variant="error"
          compact={compact}
          onFullscreenChange={onFullscreenChange}
          fullscreenId={`${fullscreenBaseId}:error`}
        />
        {data.toolFiles?.length ? <ToolFilesBlock files={data.toolFiles} /> : null}
      </div>
    )
  }

  // 2. 工具活跃时（running/streaming）统一显示 loading — compact 模式下不显示
  if (isActive) {
    if (compact) return null
    return (
      <ContentBlock
        stateKey={stateBaseKey}
        label={t('defaultRenderer.output')}
        isLoading={true}
        loadingText=""
        compact={compact}
        onFullscreenChange={onFullscreenChange}
        fullscreenId={`${fullscreenBaseId}:loading`}
      />
    )
  }

  // 3. 完成后显示结果
  if (hasOutput) {
    const fileMedia = data.toolFiles?.length ? <ToolFilesBlock files={data.toolFiles} /> : null

    // Multiple files with diff
    if (data.files) {
      return (
        <div className="flex flex-col gap-2">
          {fileMedia}
          {data.files.map((file, idx) => (
            <ContentBlock
              key={idx}
              stateKey={`${stateBaseKey}:file:${file.filePath || idx}`}
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
              onFullscreenChange={onFullscreenChange}
              fullscreenId={`${fullscreenBaseId}:file:${file.filePath || idx}`}
            />
          ))}
        </div>
      )
    }

    // Single diff
    if (data.diff) {
      return (
        <div className="flex flex-col gap-2">
          {fileMedia}
          <ContentBlock
            stateKey={stateBaseKey}
            label={t('defaultRenderer.output')}
            labelIcon={data.filePath ? <FileResultIcon filePath={data.filePath} /> : undefined}
            hideLabel={!!data.filePath}
            filePath={data.filePath}
            diff={data.diff}
            diffStats={data.diffStats}
            language={data.outputLang}
            compact={compact}
            onFullscreenChange={onFullscreenChange}
            fullscreenId={`${fullscreenBaseId}:diff`}
          />
        </div>
      )
    }

    // 只有文件类产出（无文本）：直接展示附件
    if (!data.output?.trim() && fileMedia) {
      return <div className="flex flex-col gap-2">{fileMedia}</div>
    }

    // Regular output
    return (
      <div className="flex flex-col gap-2">
        {fileMedia}
        <ContentBlock
          stateKey={stateBaseKey}
          label={t('defaultRenderer.output')}
          content={data.output}
          language={data.outputLang}
          filePath={data.filePath}
          stats={data.exitCode !== undefined ? { exit: data.exitCode } : undefined}
          compact={compact}
          onFullscreenChange={onFullscreenChange}
          fullscreenId={`${fullscreenBaseId}:text`}
        />
      </div>
    )
  }

  // 4. 无输出
  return (
    <ContentBlock
      stateKey={stateBaseKey}
      label={t('defaultRenderer.output')}
      compact={compact}
      onFullscreenChange={onFullscreenChange}
      fullscreenId={`${fullscreenBaseId}:empty`}
    />
  )
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
// Tool Files Block — v2 工具产出的文件类 content
// ============================================
//
// 旧层把 `state.output` 压成字符串，文件类产出（图片 / 附件）被整块丢掉。
// 这里按官方做法把它们当附件展示：`uri` 是 data: 或 file: 形式，
// name 缺失时回退到 uri 的最后一段。

function ToolFilesBlock({ files }: { files: NonNullable<ExtractedToolData['toolFiles']> }) {
  return (
    <div className="flex flex-wrap gap-2">
      {files.map((file, idx) => (
        <AttachmentItem
          key={`${file.uri}:${idx}`}
          attachment={{
            id: `tool-file:${idx}:${file.uri}`,
            type: 'file',
            displayName: file.name || fileNameFromUri(file.uri),
            url: file.uri,
            mime: file.mime,
            relativePath: file.name ?? undefined,
            category: 'system',
          }}
          size="sm"
        />
      ))}
    </div>
  )
}

function fileNameFromUri(uri: string): string {
  const trimmed = uri.split(/[?#]/)[0]
  const segments = trimmed.split('/').filter(Boolean)
  return segments[segments.length - 1] || uri
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
