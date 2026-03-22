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
  const exitCode = data.exitCode
  const maxHeight = useResponsiveMaxHeight()

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

  return (
    <div className="rounded-lg border border-border-200/40 bg-bg-100 overflow-hidden font-mono text-[11px] leading-[1.6]">
      <div className="px-3 py-2 overflow-y-auto custom-scrollbar" style={{ maxHeight }}>
        {/* $ command — 点击复制 */}
        {command && <ClickToCopyCommand command={command} />}

        {/* 光标 */}
        {isActive && !hasOutput && !hasError && (
          <div className="mt-0.5">
            <TerminalCursor />
          </div>
        )}

        {/* 输出 */}
        {hasOutput && (
          <div className="text-text-300 whitespace-pre-wrap break-all mt-0.5">
            <AnsiOutput segments={outputSegments!} />
            {isActive && <TerminalCursor />}
          </div>
        )}

        {/* Error */}
        {hasError && <div className="text-danger-100 whitespace-pre-wrap break-all mt-0.5">{data.error}</div>}

        {/* Exit code */}
        {isDone && exitCode !== undefined && (
          <div
            className={`mt-0.5 text-[10px] font-medium ${
              exitCode === 0 ? 'text-accent-secondary-100' : 'text-warning-100'
            }`}
          >
            {t('contentBlock.exitCode', { code: exitCode })}
          </div>
        )}
      </div>
    </div>
  )
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
      className="flex items-start gap-1.5 cursor-pointer group/cmd"
      onClick={handleClick}
      title={copied ? 'Copied!' : 'Click to copy'}
    >
      <span className="text-accent-main-100 shrink-0 select-none font-semibold">{copied ? '✓' : '$'}</span>
      <HighlightedCommand command={command} />
    </div>
  )
}

// ============================================
// Highlighted Command (Shiki)
// ============================================

function HighlightedCommand({ command }: { command: string }) {
  const { output: highlighted } = useSyntaxHighlight(command, { lang: 'bash' })

  if (highlighted) {
    return (
      <span
        className="whitespace-pre-wrap break-all [&>pre]:!bg-transparent [&>pre]:!p-0 [&>pre]:!m-0 [&_code]:!bg-transparent [&_code]:!p-0"
        dangerouslySetInnerHTML={{ __html: highlighted }}
      />
    )
  }

  return <span className="text-text-100 whitespace-pre-wrap break-all">{command}</span>
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
