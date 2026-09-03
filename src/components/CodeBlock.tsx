import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useInputCapabilities } from '../hooks/useInputCapabilities'
import { useSyntaxHighlight, useStreamingSyntaxHighlight, type HighlightTokens } from '../hooks/useSyntaxHighlight'
import { themeStore } from '../store/themeStore'
import { CopyButton } from './ui'
import { useInView } from '../hooks/useInView'

/** Languages that carry no useful information — hide the label */
const HIDDEN_LANGS = new Set(['text', 'plain', 'txt', 'plaintext'])

const TokenSpan = memo(
  function TokenSpan({ token }: { token: HighlightTokens[number][number] }) {
    return <span style={token.color ? { color: token.color } : undefined}>{token.content}</span>
  },
  (prev, next) => prev.token === next.token,
)

const TokenLine = memo(
  function TokenLine({ line, trailingNewline }: { line: HighlightTokens[number]; trailingNewline: boolean }) {
    return (
      <span>
        {line.map((token, tokenIndex) => (
          <TokenSpan key={tokenIndex} token={token} />
        ))}
        {trailingNewline ? '\n' : null}
      </span>
    )
  },
  (prev, next) => prev.line === next.line && prev.trailingNewline === next.trailingNewline,
)

function renderHighlightedTokens(tokens: HighlightTokens) {
  return tokens.map((line, lineIndex) => (
    <TokenLine key={lineIndex} line={line} trailingNewline={lineIndex < tokens.length - 1} />
  ))
}

function renderIncrementalTokens(tokens: HighlightTokens, suffix: string) {
  return (
    <>
      {renderHighlightedTokens(tokens)}
      {suffix ? <span>{suffix}</span> : null}
    </>
  )
}

type FlatHighlightToken = { content: string; color?: string }

function flattenTokens(tokens: HighlightTokens, suffix: string): FlatHighlightToken[] {
  const result: FlatHighlightToken[] = []
  tokens.forEach((line, lineIndex) => {
    line.forEach(token => result.push({ content: token.content, color: token.color }))
    if (lineIndex < tokens.length - 1) result.push({ content: '\n' })
  })
  if (suffix) result.push({ content: suffix })
  return result
}

function sameFlatToken(left: FlatHighlightToken, right: FlatHighlightToken | undefined) {
  return !!right && left.content === right.content && left.color === right.color
}

const StreamingCodeTokens = memo(function StreamingCodeTokens({ tokens, suffix }: { tokens: HighlightTokens; suffix: string }) {
  const codeRef = useRef<HTMLElement | null>(null)
  const previousRef = useRef<FlatHighlightToken[]>([])
  const flatTokens = useMemo(() => flattenTokens(tokens, suffix), [suffix, tokens])

  useLayoutEffect(() => {
    const code = codeRef.current
    if (!code) return

    const previous = previousRef.current
    let keep = 0
    while (keep < previous.length && keep < flatTokens.length && sameFlatToken(previous[keep], flatTokens[keep])) {
      keep += 1
    }

    while (code.childNodes.length > keep) code.lastChild?.remove()
    flatTokens.slice(keep).forEach(token => {
      const node = document.createElement('span')
      if (token.color) node.style.color = token.color
      node.textContent = token.content
      code.appendChild(node)
    })
    previousRef.current = flatTokens
  }, [flatTokens])

  return <code ref={codeRef} className="font-mono select-text" />
})

interface CodeBlockProps {
  code: string
  language?: string
  className?: string
  style?: React.CSSProperties
  /** Display variant: 'default' shows chrome (label + copy), 'reasoning' is minimal */
  variant?: 'default' | 'reasoning'
  /** 最大高度 */
  maxHeight?: number
  /** 长行自动换行 */
  wordwrap?: boolean
  /** Render plain code and skip syntax highlighting. */
  deferHighlight?: boolean
  /** Start highlighting even before in-view observation catches up. */
  forceHighlight?: boolean
  /** Use incremental Shiki tokenization for streaming code. */
  streamingHighlight?: boolean
  /** Persistent controls rendered beside the copy action. */
  headerActions?: ReactNode
}

export const CodeBlock = memo(function CodeBlock({
  code,
  language,
  className = '',
  style,
  variant = 'default',
  maxHeight,
  wordwrap,
  deferHighlight = false,
  forceHighlight = false,
  streamingHighlight = false,
  headerActions,
}: CodeBlockProps) {
  const { codeWordWrap } = useSyncExternalStore(themeStore.subscribe, themeStore.getSnapshot)
  const { preferTouchUi } = useInputCapabilities()
  const resolvedWordWrap = wordwrap ?? codeWordWrap
  const isReasoning = variant === 'reasoning'
  const highlightCode = code

  // Lazy load highlighting when close to viewport
  const { ref, inView } = useInView({ triggerOnce: true, rootMargin: '200px' })

  // Auto-detect tree structure if language is missing or text
  const effectiveLanguage = useMemo(() => {
    if (language && language !== 'text') return language

    // Check for tree structure characters
    if (
      highlightCode.includes('├──') ||
      highlightCode.includes('└──') ||
      (highlightCode.includes('│') && highlightCode.includes('──'))
    ) {
      return 'yaml'
    }

    return language || 'text'
  }, [highlightCode, language])

  const shouldHighlight = !deferHighlight && (inView || forceHighlight)
  const shouldStreamHighlight = shouldHighlight && streamingHighlight

  const { output: highlightedTokens } = useSyntaxHighlight(highlightCode, {
    lang: effectiveLanguage,
    enabled: shouldHighlight && !shouldStreamHighlight,
    delayMs: 0,
    mode: 'tokens',
  })
  const { output: streamingTokens, highlightedCode: streamingHighlightedCode = code } = useStreamingSyntaxHighlight(
    code,
    {
      lang: effectiveLanguage,
      enabled: shouldStreamHighlight,
    },
  )
  const tokens = deferHighlight ? null : (streamingTokens ?? highlightedTokens)
  const [lastHighlight, setLastHighlight] = useState<{ code: string; tokens: HighlightTokens } | null>(null)
  const tokenSourceCode = shouldStreamHighlight && streamingTokens ? streamingHighlightedCode : highlightCode
  if (tokens && lastHighlight?.code !== tokenSourceCode) {
    setLastHighlight({ code: tokenSourceCode, tokens })
  }
  const activeHighlight = deferHighlight ? null : tokens ? { code: tokenSourceCode, tokens } : lastHighlight

  const displayedHighlight =
    activeHighlight && code.startsWith(activeHighlight.code)
      ? {
          tokens: activeHighlight.tokens,
          suffix: code.slice(activeHighlight.code.length),
        }
      : null

  const containerStyle = maxHeight ? { ...style, maxHeight } : style
  const showLabel = !isReasoning && language && !HIDDEN_LANGS.has(language.toLowerCase())

  // --- Shared sub-components ---

  const wrapClasses = resolvedWordWrap ? 'whitespace-pre-wrap break-words [overflow-wrap:anywhere]' : ''

  const scrollClasses = resolvedWordWrap
    ? 'overflow-y-auto overflow-x-hidden custom-scrollbar select-text'
    : 'overflow-auto custom-scrollbar select-text'

  // Padding: reasoning is tighter; default reserves top for label row and right for copy button
  const contentPad = isReasoning ? 'p-3' : showLabel ? 'pt-0 pb-3.5 px-3.5' : 'p-4'
  const requireTapToRevealCopy = preferTouchUi && !isReasoning && !showLabel

  const handleTouchStartCapture = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      if (!requireTapToRevealCopy) return
      if (event.target instanceof HTMLElement && event.target.closest('button')) return
      event.currentTarget.focus()
    },
    [requireTapToRevealCopy],
  )

  const fontSize = isReasoning ? 'text-[length:var(--fs-sm)]' : 'text-[length:var(--fs-md)]'
  const lineHeight = isReasoning ? 'leading-5' : 'leading-6'
  const textColor = isReasoning ? 'text-text-300' : 'text-text-200'

  const content = displayedHighlight ? (
    <pre
      className={`shiki-wrapper m-0 font-mono select-text ${textColor} ${fontSize} ${lineHeight} ${contentPad} ${
        resolvedWordWrap ? 'whitespace-pre-wrap break-words [overflow-wrap:anywhere]' : 'whitespace-pre'
      }`}
      suppressHydrationWarning
    >
      {shouldStreamHighlight ? (
        <StreamingCodeTokens tokens={displayedHighlight.tokens} suffix={displayedHighlight.suffix} />
      ) : (
        <code className="font-mono select-text">
          {renderIncrementalTokens(displayedHighlight.tokens, displayedHighlight.suffix)}
        </code>
      )}
    </pre>
  ) : (
    <pre className={`${contentPad} m-0 font-mono select-text ${textColor} ${fontSize} ${lineHeight} ${wrapClasses}`}>
      <code>{code}</code>
    </pre>
  )

  // --- Reasoning: minimal shell ---
  if (isReasoning) {
    return (
      <div
        ref={ref}
        className={`rounded-sm overflow-hidden bg-bg-200/25 contain-content ${className}`}
        style={containerStyle}
      >
        <div data-scrollable className={scrollClasses} style={maxHeight ? { maxHeight } : undefined}>
          {content}
        </div>
      </div>
    )
  }

  // --- Default: light panel with floating chrome ---
  return (
    <div
      ref={ref}
      className={`group/code relative rounded-md overflow-hidden border border-border-200/40 bg-bg-200/40 w-full max-w-full flex flex-col contain-content ${requireTapToRevealCopy ? 'focus:outline-none' : ''} ${className}`}
      style={style}
      tabIndex={requireTapToRevealCopy ? 0 : undefined}
      onTouchStartCapture={requireTapToRevealCopy ? handleTouchStartCapture : undefined}
    >
      {showLabel ? (
        <div className="flex min-h-10 items-start justify-between pl-3.5 pr-0 pt-2 pb-0">
          <div className="flex h-8 min-w-0 items-center text-[length:var(--fs-xs)] font-medium leading-none tracking-wide text-text-500 select-none">
            <span className="truncate">{language}</span>
          </div>
          <div className="inline-flex h-8 shrink-0 items-center gap-0.5 pr-2 opacity-0 group-hover/code:opacity-100 group-focus-within/code:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity">
            {headerActions}
            <CopyButton text={code} position="static" className="!h-8 !w-8 !p-2" />
          </div>
        </div>
      ) : (
        <div
          className={`absolute top-2 right-2 z-10 opacity-0 group-hover/code:opacity-100 group-focus-within/code:opacity-100 ${requireTapToRevealCopy ? '[@media(hover:none)]:opacity-0' : '[@media(hover:none)]:opacity-100'} transition-opacity`}
        >
          <CopyButton
            text={code}
            position="static"
            className="!h-8 !w-8 !p-2 rounded-md bg-bg-300/70 backdrop-blur-md"
          />
        </div>
      )}

      {/* Scrollable content */}
      <div data-scrollable className={scrollClasses} style={maxHeight ? { maxHeight } : undefined}>
        {content}
      </div>
    </div>
  )
})
