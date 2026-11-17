/**
 * BashRenderer - Bash 工具专用渲染器
 *
 * 终端风格：
 * - $ prompt + 命令（Shiki 高亮，点击复制）
 * - 输出支持 ANSI 颜色
 * - 运行中光标闪烁
 * - exit code 内联在输出末尾
 */

import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { MaximizeIcon, MinimizeIcon } from '../../../../components/Icons'
import { useFullscreen } from '../../../../contexts'
import { DirectoryContext } from '../../../../contexts/DirectoryContext.shared'
import { useInlineToolRequests } from '../../../chat/InlineToolRequestContext'
import { useSyntaxHighlight } from '../../../../hooks/useSyntaxHighlight'
import { useResponsiveMaxHeight } from '../../../../hooks/useResponsiveMaxHeight'
import { parseAnsi, type AnsiSegment } from '../../../../utils/ansiUtils'
import { currentToolMetadata } from '../../../../types/api'
import { followShellOutput } from '../../shellOutput'
import { copyTextToClipboard, clipboardErrorHandler } from '../../../../utils'
import { cropContent } from '../../../../utils/contentBudget'
import { TruncatedNote } from '../../../../components/ui'
import type { ToolRendererProps } from '../types'

// ============================================
// Main
// ============================================

export function BashRenderer({ part, data, onFullscreenChange }: ToolRendererProps) {
  const { t } = useTranslation(['components'])
  const { state } = part
  const isActive = state.status === 'running' || state.status === 'streaming'
  const hasError = !!data.error
  const command = data.input?.trim()
  // 运行中 shell 的实时输出跟随（官方 session-ui shell 渲染器同款）：
  // v2 shell 工具一启动就 progress({ shellID })，事件流只在结束时给最终
  // output，存活期间靠 shell.output 游标轮询。目录上下文用可选读取——
  // 没有 DirectoryProvider 的环境（部分测试）不启用跟随，而不是炸掉。
  const shellID = (() => {
    const metadata = currentToolMetadata(part)
    return typeof metadata.shellID === 'string' ? metadata.shellID : undefined
  })()
  const directoryContext = useContext(DirectoryContext)
  const currentDirectory = directoryContext?.currentDirectory
  const { serverId } = useInlineToolRequests()
  const [streamedOutput, setStreamedOutput] = useState('')
  useEffect(() => {
    if (!isActive || !shellID || !currentDirectory) return
    return followShellOutput({
      id: shellID,
      directory: currentDirectory,
      serverId: serverId || undefined,
      running: true,
      onOutput: setStreamedOutput,
    })
  }, [isActive, shellID, currentDirectory, serverId])
  // 存活期间以流式输出为准；结束后 content 里的最终 output 是权威
  const output = (isActive && shellID ? streamedOutput.trim() : '') || data.output?.trim()
  const cwd = data.cwd?.trim()
  const exitCode = data.exitCode
  const maxHeight = useResponsiveMaxHeight()
  const fullscreenId = `bash:${part.messageID}:${part.id}`
  const { activeId, openFullscreen, updateFullscreen, closeFullscreen } = useFullscreen()
  const fullscreenOpen = activeId === fullscreenId

  // 全屏状态变化时通知父级，防止自动折叠
  useEffect(() => {
    onFullscreenChange?.(fullscreenOpen)
    return () => {
      if (fullscreenOpen) onFullscreenChange?.(false)
    }
  }, [fullscreenOpen, onFullscreenChange])

  // 解析 ANSI（内联只铺头尾，完整输出留给全屏）
  const croppedOutput = useMemo(() => cropContent(output ?? ''), [output])
  const outputSegments = useMemo(() => {
    if (!croppedOutput.text) return null
    // 裁剪可能切在 ANSI 序列中间，前后补一个 reset 防止颜色漏出去
    return parseAnsi(croppedOutput.cropped ? `\u001b[0m${croppedOutput.text}\u001b[0m` : croppedOutput.text)
  }, [croppedOutput])

  const hasOutput = !!(outputSegments && outputSegments.length > 0)
  const isDone = !isActive
  // 运行中只是 64KB 尾部窗口，全屏也拿不到更早的内容，别提示「全屏看完整输出」
  const truncatedNote =
    !isActive && croppedOutput.cropped ? (
      <TruncatedNote omittedLines={croppedOutput.omittedLines} omittedChars={croppedOutput.omittedChars} />
    ) : undefined

  const handleCloseFullscreen = useCallback(() => {
    closeFullscreen(fullscreenId)
  }, [closeFullscreen, fullscreenId])

  const fullscreenContent = useMemo(
    () => (
      <div className="h-full p-4">
        <FullscreenTerminal
          command={command}
          cwd={cwd}
          output={output ?? ''}
          isActive={isActive}
          hasError={hasError}
          error={data.error}
          isDone={isDone}
          exitCode={exitCode}
          outputKey={output ?? ''}
          onToggleFullscreen={handleCloseFullscreen}
          exitCodeLabel={exitCode !== undefined ? t('contentBlock.exitCode', { code: exitCode }) : undefined}
        />
      </div>
    ),
    [command, cwd, data.error, exitCode, handleCloseFullscreen, hasError, isActive, isDone, output, t],
  )

  const handleToggleFullscreen = useCallback(() => {
    if (fullscreenOpen) {
      closeFullscreen(fullscreenId)
      return
    }

    openFullscreen({ id: fullscreenId, showHeader: false, content: fullscreenContent })
  }, [closeFullscreen, fullscreenContent, fullscreenId, fullscreenOpen, openFullscreen])

  useEffect(() => {
    if (!fullscreenOpen) return
    updateFullscreen({ id: fullscreenId, showHeader: false, content: fullscreenContent })
  }, [fullscreenContent, fullscreenId, fullscreenOpen, updateFullscreen])

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
      outputKey={output ?? ''}
      maxHeight={isFullscreen ? undefined : maxHeight}
      fullHeight={isFullscreen}
      isFullscreen={isFullscreen}
      onToggleFullscreen={handleToggleFullscreen}
      exitCodeLabel={exitCode !== undefined ? t('contentBlock.exitCode', { code: exitCode }) : undefined}
      footerNote={truncatedNote}
    />
  )

  // 空状态
  if (!isActive && !hasError && !command && !output) {
    return null
  }

  return surface(false)
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
  outputKey,
  maxHeight,
  fullHeight = false,
  isFullscreen = false,
  onToggleFullscreen,
  exitCodeLabel,
  footerNote,
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
  outputKey: string
  maxHeight?: number | string
  fullHeight?: boolean
  isFullscreen?: boolean
  onToggleFullscreen?: () => void
  exitCodeLabel?: string
  /** 内联裁剪提示（全屏不传，全屏看的是完整输出） */
  footerNote?: ReactNode
}) {
  const fullscreenLabel = isFullscreen ? 'Exit fullscreen' : 'Fullscreen'

  const scrollRef = useRef<HTMLDivElement>(null)
  const isAtBottomRef = useRef(true)
  // 仅本轮流式会话跟随：历史打开已完成工具不贴底（默认从顶部看命令）
  const shouldFollowRef = useRef(false)

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
  }, [])

  // 流式中贴底；刚结束时 exit code/error 不是 output chunk，再贴一次。
  // 不在「已完成工具重新展开/刷新打开」时贴底。
  useLayoutEffect(() => {
    if (isActive) shouldFollowRef.current = true

    const el = scrollRef.current
    if (!el || !shouldFollowRef.current || !isAtBottomRef.current) return
    el.scrollTop = el.scrollHeight
  }, [isActive, outputKey, isDone, exitCode, hasError, error, exitCodeLabel])

  return (
    <div
      className={`rounded-md border border-border-200/40 bg-bg-100 overflow-hidden font-mono text-[length:var(--fs-code)] leading-[1.6] ${
        fullHeight ? 'h-full flex flex-col' : ''
      }`}
    >
      <div
        ref={scrollRef}
        onScroll={handleScroll}
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

        {footerNote && <div className="mt-1 text-[length:var(--fs-xxs)] leading-4 text-text-500">{footerNote}</div>}
      </div>
    </div>
  )
}

/**
 * 全屏输出：完整文本在这里才做 ANSI 解析。
 * 内联只铺裁剪后的头尾，避免一条几 MB 的输出在消息流里直接排版。
 */
function FullscreenTerminal({
  output,
  ...rest
}: Omit<Parameters<typeof TerminalSurface>[0], 'outputSegments' | 'hasOutput' | 'footerNote'> & {
  output: string
}) {
  const segments = useMemo(() => (output ? parseAnsi(output) : null), [output])
  return (
    <TerminalSurface
      {...rest}
      outputSegments={segments}
      hasOutput={!!segments && segments.length > 0}
      fullHeight
      isFullscreen
    />
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
