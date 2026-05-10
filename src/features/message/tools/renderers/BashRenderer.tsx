/**
 * BashRenderer - Bash 工具专用渲染器
 *
 * 终端风格：
 * - $ prompt + 命令（Shiki 高亮，点击复制）
 * - 输出支持 ANSI 颜色
 * - 运行中光标闪烁
 * - exit code 内联在输出末尾
 */

import { useMemo, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { FullscreenViewer } from '../../../../components/FullscreenViewer'
import { MaximizeIcon, MinimizeIcon } from '../../../../components/Icons'
import { useSyntaxHighlight } from '../../../../hooks/useSyntaxHighlight'
import { useResponsiveMaxHeight } from '../../../../hooks/useResponsiveMaxHeight'
import { parseAnsi, type AnsiSegment } from '../../../../utils/ansiUtils'
import { copyTextToClipboard, clipboardErrorHandler } from '../../../../utils'
import type { ToolRendererProps } from '../types'

// ============================================
// Main
// ============================================

export function BashRenderer({ part, data }: ToolRendererProps) {
  const { t } = useTranslation(['components'])
  const { state } = part
  const isActive = state.status === 'running' || state.status === 'pending'
  const hasError = !!data.error
  const command = data.input?.trim()
  const output = data.output?.trim()
  const cwd = data.cwd?.trim()
  const exitCode = data.exitCode
  const maxHeight = useResponsiveMaxHeight()
  const [fullscreenOpen, setFullscreenOpen] = useState(false)

  // 解析 ANSI
  const outputSegments = useMemo(() => {
    if (!output) return null
    return parseAnsi(output)
  }, [output])

  // 空状态
  if (!isActive && !hasError && !command && !output) {
    return null
  }

  const hasOutput = !!(outputSegments && outputSegments.length > 0)
  const isDone = !isActive

  const surface = (isFullscreen: boolean) => (
    <TerminalSurface
      command={command}
      cwd={cwd}
      outputSegments={outputSegments}
      isActive={isActive}
      hasOutput={hasOutput}
      hasError={hasError}
      error={data.error}
      isDone={isDone}
      exitCode={exitCode}
      maxHeight={isFullscreen ? undefined : maxHeight}
      fullHeight={isFullscreen}
      isFullscreen={isFullscreen}
      onToggleFullscreen={() => setFullscreenOpen(open => !open)}
      exitCodeLabel={exitCode !== undefined ? t('contentBlock.exitCode', { code: exitCode }) : undefined}
    />
  )

  return (
    <>
      {surface(false)}
      {fullscreenOpen && (
        <FullscreenViewer isOpen onClose={() => setFullscreenOpen(false)} showHeader={false}>
          <div className="h-full p-4">{surface(true)}</div>
        </FullscreenViewer>
      )}
    </>
  )
}

function TerminalSurface({
  command,
  cwd,
  outputSegments,
  isActive,
  hasOutput,
  hasError,
  error,
  isDone,
  exitCode,
  maxHeight,
  fullHeight = false,
  isFullscreen = false,
  onToggleFullscreen,
  exitCodeLabel,
}: {
  command?: string
  cwd?: string
  outputSegments: AnsiSegment[] | null
  isActive: boolean
  hasOutput: boolean
  hasError: boolean
  error?: string
  isDone: boolean
  exitCode?: number
  maxHeight?: number | string
  fullHeight?: boolean
  isFullscreen?: boolean
  onToggleFullscreen?: () => void
  exitCodeLabel?: string
}) {
  const fullscreenLabel = isFullscreen ? 'Exit fullscreen' : 'Fullscreen'

  return (
    <div
      className={`rounded-md border border-border-200/40 bg-bg-100 overflow-hidden font-mono text-[length:var(--fs-code)] leading-[1.6] ${
        fullHeight ? 'h-full flex flex-col' : ''
      }`}
    >
      <div
        className={`px-3 py-2 overflow-y-auto custom-scrollbar ${fullHeight ? 'flex-1 min-h-0' : ''}`}
        style={fullHeight ? undefined : { maxHeight }}
      >
        <div className="flex min-w-0 items-baseline gap-2">
          {cwd && <WorkingDirectoryPrompt cwd={cwd} />}
          {onToggleFullscreen && (
            <button
              type="button"
              onClick={onToggleFullscreen}
              className="ml-auto inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-500 transition-colors hover:bg-bg-200/60 hover:text-text-100"
              title={fullscreenLabel}
              aria-label={fullscreenLabel}
            >
              {isFullscreen ? <MinimizeIcon size={12} /> : <MaximizeIcon size={12} />}
            </button>
          )}
        </div>

        {command && <ClickToCopyCommand command={command} />}

        {isActive && !hasOutput && !hasError && (
          <div className="mt-0.5">
            <TerminalCursor />
          </div>
        )}

        {hasOutput && (
          <div className="text-text-300 whitespace-pre-wrap break-all mt-0.5">
            <AnsiOutput segments={outputSegments!} />
            {isActive && <TerminalCursor />}
          </div>
        )}

        {hasError && <div className="text-danger-100 whitespace-pre-wrap break-all mt-0.5">{error}</div>}

        {isDone && exitCode !== undefined && (
          <div
            className={`mt-0.5 text-[length:var(--fs-xxs)] font-medium ${
              exitCode === 0 ? 'text-accent-secondary-100' : 'text-warning-100'
            }`}
          >
            {exitCodeLabel}
          </div>
        )}
      </div>
    </div>
  )
}

function WorkingDirectoryPrompt({ cwd }: { cwd: string }) {
  const [copied, setCopied] = useState(false)
  const displayPath = useMemo(() => truncatePromptPath(cwd), [cwd])

  const handleClick = useCallback(async () => {
    try {
      await copyTextToClipboard(cwd)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (err) {
      clipboardErrorHandler('copy cwd', err)
    }
  }, [cwd])

  return (
    <div className="group/cwd mb-0.5 flex min-w-0 flex-1 items-baseline whitespace-nowrap">
      <button
        type="button"
        onClick={handleClick}
        className={`min-w-0 max-w-full truncate text-left font-mono transition-colors ${
          copied ? 'text-success-100' : 'text-accent-main-100 hover:text-text-100'
        }`}
        title={copied ? 'Copied!' : `Click to copy: ${cwd}`}
        style={{ direction: 'rtl' }}
      >
        <bdi>{displayPath}</bdi>
      </button>
    </div>
  )
}

/**
 * 中间省略路径，保留根和最后两段。
 * 例如 /a/b/c/d/e -> /a/…/d/e, E:\a\b\c\d -> E:\…\c\d
 */
function truncatePromptPath(path: string): string {
  const separator = path.includes('\\') ? '\\' : '/'
  const segments = path.split(/[\\/]+/).filter(Boolean)
  if (segments.length <= 4) return path

  const isAbsolute = path.startsWith('/') || path.startsWith('\\')
  const root = isAbsolute ? separator : segments[0]
  const tail = segments.slice(-2).join(separator)
  const rootWithSep = root.endsWith(separator) ? root : `${root}${separator}`
  return `${rootWithSep}…${separator}${tail}`
}

// ============================================
// Click-to-Copy Command
// ============================================

function ClickToCopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false)

  const handleClick = useCallback(async () => {
    try {
      await copyTextToClipboard(command)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (err) {
      clipboardErrorHandler('copy', err)
    }
  }, [command])

  return (
    <div
      className="cursor-pointer group/cmd whitespace-pre-wrap break-all"
      onClick={handleClick}
      title={copied ? 'Copied!' : 'Click to copy'}
    >
      <span className="inline-block w-[1ch] text-center text-accent-main-100 select-none font-semibold">
        {copied ? '✓' : '$'}
      </span>{' '}
      <HighlightedCommand command={command} />
    </div>
  )
}

// ============================================
// Highlighted Command (Shiki)
// ============================================

function HighlightedCommand({ command }: { command: string }) {
  const { output: tokens } = useSyntaxHighlight(command, { lang: 'bash', mode: 'tokens' })

  if (tokens) {
    return (
      <span className="text-text-100 whitespace-pre-wrap break-all [overflow-wrap:anywhere]">
        {tokens.map((line, lineIndex) => (
          <span key={lineIndex}>
            {line.map((token, tokenIndex) => (
              <span key={tokenIndex} style={token.color ? { color: token.color } : undefined}>
                {token.content}
              </span>
            ))}
            {lineIndex < tokens.length - 1 ? '\n' : null}
          </span>
        ))}
      </span>
    )
  }

  return <span className="text-text-100 whitespace-pre-wrap break-all [overflow-wrap:anywhere]">{command}</span>
}

// ============================================
// Terminal Cursor
// ============================================

function TerminalCursor() {
  return (
    <span
      className="inline-block w-[6px] h-[14px] bg-text-300 rounded-[1px] align-middle ml-px"
      style={{ animation: 'terminal-blink 1s step-end infinite' }}
    />
  )
}

// ============================================
// ANSI Output
// ============================================

function AnsiOutput({ segments }: { segments: AnsiSegment[] }) {
  return (
    <>
      {segments.map((seg, i) => {
        if (!seg.fg && !seg.bold && !seg.dim && !seg.italic) {
          return <span key={i}>{seg.text}</span>
        }

        const style: React.CSSProperties = {}
        if (seg.fg) style.color = seg.fg
        if (seg.bold) style.fontWeight = 600
        if (seg.dim) style.opacity = 0.6
        if (seg.italic) style.fontStyle = 'italic'

        return (
          <span key={i} style={style}>
            {seg.text}
          </span>
        )
      })}
    </>
  )
}
