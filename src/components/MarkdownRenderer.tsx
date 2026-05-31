import {
  Children,
  cloneElement,
  isValidElement,
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Streamdown, type Components, type CustomRendererProps, type PluginConfig } from 'streamdown'
import { createMathPlugin } from '@streamdown/math'
import { CodeBlock } from './CodeBlock'
import { HandIcon, RetryIcon, ZoomInIcon, ZoomOutIcon } from './Icons'
import { CopyButton } from './ui'
import { useTheme } from '../hooks/useTheme'
import { useInputCapabilities } from '../hooks/useInputCapabilities'
import { detectLanguage } from '../utils/languageUtils'

interface MarkdownRendererProps {
  content: string
  className?: string
  /** Whether the content is actively being streamed */
  isStreaming?: boolean
  /** Display variant: 'default' for normal content, 'reasoning' for subdued thinking blocks */
  variant?: 'default' | 'reasoning'
}

const markdownMath = createMathPlugin({ singleDollarTextMath: true })
const MERMAID_MIN_SCALE = 0.5
const MERMAID_MAX_SCALE = 3
const MERMAID_SCALE_STEP = 0.15
const STREAMING_CODE_HIGHLIGHT_DELAY_MS = 48
const MERMAID_CONTROL_BUTTON_BASE_CLASS =
  'inline-flex h-8 w-8 items-center justify-center rounded-md bg-bg-300/70 backdrop-blur-md transition-colors duration-150 hover:bg-bg-300/85 disabled:opacity-40 disabled:cursor-not-allowed'
const MERMAID_CONTROL_BUTTON_CLASS = `${MERMAID_CONTROL_BUTTON_BASE_CLASS} text-text-400 hover:text-text-200`

type DiagramPointer = { x: number; y: number }

type PinchGesture = {
  startDistance: number
  startScale: number
  startOffset: { x: number; y: number }
  startCenter: { x: number; y: number }
}

let mermaidRenderCounter = 0

function createMermaidRenderId(prefix: string) {
  mermaidRenderCounter += 1
  const safePrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, '') || 'diagram'
  return `mermaid-${safePrefix}-${mermaidRenderCounter}`
}

function clampMermaidScale(scale: number) {
  return Math.min(MERMAID_MAX_SCALE, Math.max(MERMAID_MIN_SCALE, Number(scale.toFixed(2))))
}

function getPointerDistance(first: DiagramPointer, second: DiagramPointer) {
  return Math.hypot(first.x - second.x, first.y - second.y)
}

function getPointerCenter(first: DiagramPointer, second: DiagramPointer) {
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
  }
}

function getRelativeCenter(target: HTMLDivElement, first: DiagramPointer, second: DiagramPointer) {
  const center = getPointerCenter(first, second)
  const rect = target.parentElement?.getBoundingClientRect()
  if (!rect) return center
  return {
    x: center.x - rect.left,
    y: center.y - rect.top,
  }
}

// ─── Inline Code ───────────────────────────────────────────────

const InlineCode = memo(function InlineCode({
  children,
  variant = 'default',
}: {
  children: React.ReactNode
  variant?: 'default' | 'reasoning'
}) {
  return (
    <code
      className={
        variant === 'reasoning'
          ? 'font-mono text-accent-main-100 text-[0.9em] align-baseline break-words'
          : 'text-accent-main-100 text-[0.9em] font-mono align-baseline break-words'
      }
    >
      {children}
    </code>
  )
})

const MarkdownImage = memo(function MarkdownImage({ src, alt, title }: { src?: string; alt?: string; title?: string }) {
  if (!src) return null

  return (
    <a
      href={src}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-block max-w-full align-top"
      title={title || alt || undefined}
    >
      <img src={src} alt={alt || ''} title={title} loading="lazy" className="block max-w-full rounded-md" />
    </a>
  )
})

// ─── Helpers ───────────────────────────────────────────────────

/** Extract text content from React node tree */
function extractText(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (isValidElement(node)) {
    const props = node.props as { children?: React.ReactNode }
    return extractText(props.children)
  }
  return ''
}

/** Extract code and language from a <pre> element's children */
function extractBlockCode(children: React.ReactNode): { code: string; language?: string } | null {
  const codeNode = Array.isArray(children) ? children[0] : children
  if (!isValidElement(codeNode)) return null

  const props = codeNode.props as { className?: string; children?: React.ReactNode }
  const match = /language-([\w-]+)/.exec(props.className || '')
  const contentStr = extractText(props.children).replace(/\n$/, '')

  return {
    code: contentStr,
    language: match?.[1],
  }
}

// ─── Markdown Table ────────────────────────────────────────────

/**
 * Extract table AST into rows of cell text for markdown copy.
 * Walks thead/tbody > tr > th|td children.
 */
function extractTableData(children: React.ReactNode): { headers: string[]; rows: string[][] } {
  const headers: string[] = []
  const rows: string[][] = []

  const childArr = Array.isArray(children) ? children : [children]
  for (const section of childArr) {
    if (!isValidElement(section)) continue
    const sectionProps = section.props as { children?: React.ReactNode }
    const trArr = Array.isArray(sectionProps.children) ? sectionProps.children : [sectionProps.children]

    for (const tr of trArr) {
      if (!isValidElement(tr)) continue
      const trProps = tr.props as { children?: React.ReactNode }
      const cells = Array.isArray(trProps.children) ? trProps.children : [trProps.children]
      const texts = cells
        .filter(isValidElement)
        .map(c => extractText((c as React.ReactElement<{ children?: React.ReactNode }>).props?.children ?? ''))

      // If this row is inside thead (section type name check), treat as headers
      const sectionType = typeof section.type === 'string' ? section.type : (section.type as { name?: string })?.name
      if (sectionType === 'thead' || String(sectionType).toLowerCase().includes('thead')) {
        headers.push(...texts)
      } else {
        rows.push(texts)
      }
    }
  }
  return { headers, rows }
}

function tableToMarkdown(headers: string[], rows: string[][]): string {
  if (!headers.length) return ''
  const sep = headers.map(() => '---')
  const lines = [`| ${headers.join(' | ')} |`, `| ${sep.join(' | ')} |`, ...rows.map(r => `| ${r.join(' | ')} |`)]
  return lines.join('\n')
}

function getOrderedListStyle(start: unknown, children: React.ReactNode): React.CSSProperties {
  const startNumber = typeof start === 'number' && Number.isFinite(start) ? start : 1
  const itemCount = Math.max(Children.count(children), 1)
  const endNumber = Math.max(startNumber + itemCount - 1, startNumber)
  const markerChars = String(Math.abs(endNumber)).length + (endNumber < 0 ? 1 : 0)

  return {
    paddingInlineStart: `${Math.max(3, markerChars + 2)}ch`,
  }
}

function injectTableCopyButton(
  children: React.ReactNode,
  copyText: string,
): { children: React.ReactNode; inserted: boolean } {
  let inserted = false

  const nextChildren = Children.map(children, section => {
    if (!isValidElement(section)) return section

    const sectionType = typeof section.type === 'string' ? section.type : (section.type as { name?: string })?.name
    if (sectionType !== 'thead' && !String(sectionType).toLowerCase().includes('thead')) return section

    const sectionElement = section as React.ReactElement<{ children?: React.ReactNode }>
    const rows = Children.toArray(sectionElement.props.children)
    if (rows.length === 0) return section

    return cloneElement(
      sectionElement,
      undefined,
      rows.map((row, rowIndex) => {
        if (!isValidElement(row) || rowIndex !== rows.length - 1) return row

        const rowElement = row as React.ReactElement<{ children?: React.ReactNode }>
        const cells = Children.toArray(rowElement.props.children)
        if (cells.length === 0) return row

        return cloneElement(
          rowElement,
          undefined,
          cells.map((cell, cellIndex) => {
            if (!isValidElement(cell) || cellIndex !== cells.length - 1 || inserted) return cell

            inserted = true
            const cellElement = cell as React.ReactElement<{ children?: React.ReactNode }>

            return cloneElement(
              cellElement,
              undefined,
              <>
                <span className="block pr-8">{cellElement.props.children}</span>
                <span className="absolute inset-y-0 right-0 flex items-center px-2">
                  <CopyButton
                    text={copyText}
                    position="static"
                    className="!p-1 opacity-0 group-hover/table:opacity-100 group-focus-within/table:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity"
                  />
                </span>
              </>,
            )
          }),
        )
      }),
    )
  })

  return { children: nextChildren ?? children, inserted }
}

const MarkdownTable = memo(function MarkdownTable({
  children,
  isReasoning,
}: {
  children: React.ReactNode
  isReasoning: boolean
}) {
  const copyText = useMemo(() => {
    const { headers, rows } = extractTableData(children)
    return tableToMarkdown(headers, rows)
  }, [children])

  const { children: tableChildren, inserted: hasInlineCopyButton } = useMemo(() => {
    if (isReasoning || !copyText) return { children, inserted: false }
    return injectTableCopyButton(children, copyText)
  }, [children, copyText, isReasoning])

  if (isReasoning) {
    return (
      <div className="overflow-x-auto my-2 first:mt-0 last:mb-0 w-full">
        <table className="min-w-full border-collapse text-[length:var(--fs-sm)]">{children}</table>
      </div>
    )
  }

  return (
    <div className="group/table relative my-5 first:mt-0 last:mb-0 rounded-md border border-border-200/35 w-full">
      {/* Scrollable table area */}
      <div className="overflow-x-auto">
        <table className="w-full text-[length:var(--fs-md)] border-collapse">{tableChildren}</table>
      </div>
      {/* Copy button — outside scroll, pinned to visible top-right */}
      {copyText && !hasInlineCopyButton && (
        <CopyButton
          text={copyText}
          position="absolute"
          className="!top-1.5 !right-2 opacity-0 group-hover/table:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity z-20"
        />
      )}
    </div>
  )
})

const MarkdownMermaid = memo(function MarkdownMermaid({ code, isIncomplete }: CustomRendererProps) {
  const { resolvedTheme } = useTheme()
  const { hasCoarsePointer, hasTouch, preferTouchUi } = useInputCapabilities()
  const supportsTouchGestures = hasCoarsePointer || hasTouch
  const renderPrefix = useId()
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
  } | null>(null)
  const touchPointersRef = useRef<Map<number, DiagramPointer>>(new Map())
  const pinchRef = useRef<PinchGesture | null>(null)
  const [svg, setSvg] = useState('')
  const [error, setError] = useState('')
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [isTouchPanEnabled, setIsTouchPanEnabled] = useState(false)

  const resetView = useCallback(() => {
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }, [])

  const zoomBy = useCallback((delta: number) => {
    setScale(current => clampMermaidScale(current + delta))
  }, [])

  const clearTouchGesture = useCallback(() => {
    touchPointersRef.current.clear()
    pinchRef.current = null
    dragRef.current = null
  }, [])

  const beginPinchGesture = useCallback(
    (target: HTMLDivElement) => {
      const pointers = Array.from(touchPointersRef.current.values())
      if (pointers.length < 2) return
      const [first, second] = pointers
      pinchRef.current = {
        startDistance: Math.max(1, getPointerDistance(first, second)),
        startScale: scale,
        startOffset: offset,
        startCenter: getRelativeCenter(target, first, second),
      }
      dragRef.current = null
    },
    [offset, scale],
  )

  const handleContainerClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!supportsTouchGestures) return
      if (event.target instanceof HTMLElement && event.target.closest('button')) return
      event.currentTarget.focus()
    },
    [supportsTouchGestures],
  )

  const handleContainerBlur = useCallback(
    (event: React.FocusEvent<HTMLDivElement>) => {
      if (!supportsTouchGestures) return
      const nextTarget = event.relatedTarget
      if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return
      setIsTouchPanEnabled(false)
      clearTouchGesture()
    },
    [clearTouchGesture, supportsTouchGestures],
  )

  useEffect(() => {
    if (isTouchPanEnabled) return
    clearTouchGesture()
  }, [clearTouchGesture, isTouchPanEnabled])

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return
      if (supportsTouchGestures && event.pointerType !== 'mouse' && !isTouchPanEnabled) return
      if (event.pointerType !== 'mouse') {
        touchPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
        if (touchPointersRef.current.size >= 2) {
          beginPinchGesture(event.currentTarget)
          event.currentTarget.setPointerCapture?.(event.pointerId)
          return
        }
      }
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: offset.x,
        originY: offset.y,
      }
      event.currentTarget.setPointerCapture?.(event.pointerId)
    },
    [beginPinchGesture, supportsTouchGestures, isTouchPanEnabled, offset.x, offset.y],
  )

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse' && touchPointersRef.current.has(event.pointerId)) {
      touchPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      const pointers = Array.from(touchPointersRef.current.values())
      const pinch = pinchRef.current
      if (pointers.length >= 2 && pinch) {
        const [first, second] = pointers
        const distance = Math.max(1, getPointerDistance(first, second))
        const center = getRelativeCenter(event.currentTarget, first, second)
        const nextScale = clampMermaidScale(pinch.startScale * (distance / pinch.startDistance))
        const anchorX = (pinch.startCenter.x - pinch.startOffset.x) / pinch.startScale
        const anchorY = (pinch.startCenter.y - pinch.startOffset.y) / pinch.startScale

        event.preventDefault()
        setScale(nextScale)
        setOffset({
          x: center.x - anchorX * nextScale,
          y: center.y - anchorY * nextScale,
        })
        return
      }
    }

    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    setOffset({
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY,
    })
  }, [])

  const handlePointerEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse') {
      touchPointersRef.current.delete(event.pointerId)
      if (touchPointersRef.current.size < 2) pinchRef.current = null
    }
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null
    }
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }, [])

  useEffect(() => {
    if (isIncomplete || !code.trim()) {
      setSvg('')
      setError('')
      resetView()
      return
    }

    let cancelled = false

    async function renderDiagram() {
      try {
        setSvg('')
        setError('')
        resetView()
        const { default: mermaid } = await import('mermaid')
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: resolvedTheme === 'dark' ? 'dark' : 'default',
        })
        const result = await mermaid.render(createMermaidRenderId(renderPrefix), code)
        if (!cancelled) setSvg(result.svg)
      } catch (err) {
        if (import.meta.env.DEV) {
          console.warn('[Markdown] Mermaid render failed:', err)
        }
        if (!cancelled) {
          setSvg('')
          setError(err instanceof Error ? err.message : 'Failed to render Mermaid diagram')
        }
      }
    }

    void renderDiagram()

    return () => {
      cancelled = true
    }
  }, [code, isIncomplete, renderPrefix, resetView, resolvedTheme])

  if (isIncomplete) {
    return <CodeBlock code={code} language="mermaid" deferHighlight />
  }

  if (error) {
    return (
      <div className="my-4 first:mt-0 last:mb-0 rounded-md border border-danger-100/30 bg-danger-bg/40 p-3">
        <p className="mb-2 text-[length:var(--fs-sm)] font-medium text-danger-100">Mermaid render failed</p>
        <CodeBlock code={code} language="mermaid" />
      </div>
    )
  }

  if (!svg) {
    return (
      <div
        className="my-4 first:mt-0 last:mb-0 flex min-h-40 items-center justify-center"
        aria-label="Rendering diagram"
      >
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-text-400/25 border-t-text-400" />
      </div>
    )
  }

  return (
    <div
      className={`group/mermaid relative my-4 first:mt-0 last:mb-0 overflow-hidden ${supportsTouchGestures ? 'focus:outline-none' : ''}`}
      tabIndex={supportsTouchGestures ? 0 : undefined}
      onClick={supportsTouchGestures ? handleContainerClick : undefined}
      onBlur={supportsTouchGestures ? handleContainerBlur : undefined}
    >
      <div
        className={`absolute right-2 top-2 z-10 flex items-center gap-1 opacity-0 transition-opacity group-hover/mermaid:opacity-100 group-focus-within/mermaid:opacity-100 ${preferTouchUi ? '[@media(hover:none)]:opacity-0' : '[@media(hover:none)]:opacity-100'}`}
      >
        <CopyButton text={code} position="static" className={`!h-8 !w-8 !p-2 ${MERMAID_CONTROL_BUTTON_BASE_CLASS}`} />
        {supportsTouchGestures && (
          <button
            type="button"
            className={`${MERMAID_CONTROL_BUTTON_CLASS} ${isTouchPanEnabled ? 'ring-1 ring-accent-main-100/60 !text-accent-main-100' : ''}`}
            onClick={() => setIsTouchPanEnabled(current => !current)}
            title={isTouchPanEnabled ? 'Disable diagram pan' : 'Enable diagram pan'}
            aria-label={isTouchPanEnabled ? 'Disable diagram pan' : 'Enable diagram pan'}
            aria-pressed={isTouchPanEnabled}
          >
            <HandIcon />
          </button>
        )}
        {!preferTouchUi && (
          <>
            <button
              type="button"
              className={MERMAID_CONTROL_BUTTON_CLASS}
              onClick={() => zoomBy(-MERMAID_SCALE_STEP)}
              disabled={scale <= MERMAID_MIN_SCALE}
              title="Zoom out"
              aria-label="Zoom out diagram"
            >
              <ZoomOutIcon />
            </button>
            <button
              type="button"
              className={MERMAID_CONTROL_BUTTON_CLASS}
              onClick={() => zoomBy(MERMAID_SCALE_STEP)}
              disabled={scale >= MERMAID_MAX_SCALE}
              title="Zoom in"
              aria-label="Zoom in diagram"
            >
              <ZoomInIcon />
            </button>
          </>
        )}
        <button
          type="button"
          className={MERMAID_CONTROL_BUTTON_CLASS}
          onClick={resetView}
          title="Reset view"
          aria-label="Reset diagram view"
        >
          <RetryIcon />
        </button>
      </div>
      <div
        className={`mermaid-diagram min-h-40 min-w-fit select-none overflow-hidden p-1 [&_svg]:max-w-full [&_svg]:h-auto ${supportsTouchGestures && !isTouchPanEnabled ? 'cursor-default touch-pan-y' : 'cursor-grab touch-none active:cursor-grabbing'}`}
        role="img"
        aria-label="Mermaid diagram"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          transformOrigin: 'top left',
        }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  )
})

const markdownPlugins: PluginConfig = {
  math: markdownMath,
  renderers: [{ language: 'mermaid', component: MarkdownMermaid }],
}

// ─── Main Renderer ─────────────────────────────────────────────

export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  className = '',
  isStreaming = false,
  variant = 'default',
}: MarkdownRendererProps) {
  const isReasoning = variant === 'reasoning'

  const components = useMemo<Components>(
    () => ({
      // --- Inline code ---
      inlineCode({ children }) {
        return <InlineCode variant={isReasoning ? 'reasoning' : 'default'}>{children}</InlineCode>
      },

      // --- Block code ---
      pre({ children }) {
        const blockCode = extractBlockCode(children)
        if (!blockCode) return <pre>{children}</pre>

        if (blockCode.language?.toLowerCase() === 'mermaid') {
          return <MarkdownMermaid code={blockCode.code} language="mermaid" isIncomplete={isStreaming} />
        }

        return (
          <div className={isReasoning ? 'my-2 first:mt-0 last:mb-0 w-full' : 'my-4 first:mt-0 last:mb-0 w-full'}>
            <CodeBlock
              code={blockCode.code}
              language={blockCode.language}
              variant={isReasoning ? 'reasoning' : 'default'}
              wordwrap={isReasoning}
              highlightDelayMs={isStreaming ? STREAMING_CODE_HIGHLIGHT_DELAY_MS : 0}
            />
          </div>
        )
      },

      // --- Headings ---
      h1: ({ children }) => (
        <h1
          className={
            isReasoning
              ? 'text-[length:var(--fs-sm)] font-semibold text-text-300 mt-2 mb-1 first:mt-0 last:mb-0'
              : 'text-[length:var(--fs-heading-1)] font-bold text-text-100 mt-8 mb-4 first:mt-0 last:mb-0 tracking-tight'
          }
        >
          {children}
        </h1>
      ),
      h2: ({ children }) => (
        <h2
          className={
            isReasoning
              ? 'text-[length:var(--fs-sm)] font-semibold text-text-300 mt-2 mb-1 first:mt-0 last:mb-0'
              : 'text-[length:var(--fs-heading-2)] font-bold text-text-100 mt-6 mb-3 first:mt-0 last:mb-0 tracking-tight pb-1.5 border-b border-border-100/40'
          }
        >
          {children}
        </h2>
      ),
      h3: ({ children }) => (
        <h3
          className={
            isReasoning
              ? 'text-[length:var(--fs-sm)] font-semibold text-text-300 mt-2 mb-1 first:mt-0 last:mb-0'
              : 'text-[length:var(--fs-heading-3)] font-semibold text-text-100 mt-5 mb-2 first:mt-0 last:mb-0 tracking-tight'
          }
        >
          {children}
        </h3>
      ),
      h4: ({ children }) => (
        <h4
          className={
            isReasoning
              ? 'text-[length:var(--fs-sm)] font-semibold text-text-300 mt-2 mb-1 first:mt-0 last:mb-0'
              : 'text-[length:var(--fs-base)] font-semibold text-text-100 mt-4 mb-2 first:mt-0 last:mb-0 tracking-tight'
          }
        >
          {children}
        </h4>
      ),

      // --- Paragraphs ---
      p: ({ children }) => (
        <p
          className={
            isReasoning
              ? 'text-[length:var(--fs-sm)] mb-2 last:mb-0 leading-5 text-text-400'
              : 'mb-4 last:mb-0 leading-7 text-text-200'
          }
        >
          {children}
        </p>
      ),

      // --- Lists ---
      ul: ({ children }) => (
        <ul
          className={
            isReasoning
              ? 'text-[length:var(--fs-sm)] list-disc list-outside ml-4 mb-2 last:mb-0 space-y-0.5 marker:text-text-500/60'
              : 'list-disc list-outside ml-5 mb-4 last:mb-0 space-y-1 marker:text-text-400/80'
          }
        >
          {children}
        </ul>
      ),
      ol: ({ children, start }) => (
        <ol
          style={getOrderedListStyle(start, children)}
          className={
            isReasoning
              ? 'text-[length:var(--fs-sm)] list-decimal list-outside mb-2 last:mb-0 space-y-0.5 marker:text-text-500/60'
              : 'list-decimal list-outside mb-4 last:mb-0 space-y-1 marker:text-text-400/80'
          }
        >
          {children}
        </ol>
      ),
      li: ({ children }) => (
        <li
          className={
            isReasoning ? 'text-[length:var(--fs-sm)] text-text-400 pl-1 leading-5' : 'text-text-200 pl-1 leading-7'
          }
        >
          {children}
        </li>
      ),

      // --- Links ---
      a: ({ href, children }) => (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={
            isReasoning
              ? 'text-[length:var(--fs-sm)] font-medium text-accent-main-200/80 hover:text-accent-main-200 underline underline-offset-2 transition-colors'
              : 'font-medium text-accent-main-100 hover:text-accent-main-200 underline underline-offset-2 transition-colors'
          }
        >
          {children}
        </a>
      ),

      // --- Images ---
      img: ({ src, alt, title }) => <MarkdownImage src={src} alt={alt} title={title} />,

      // --- Blockquotes ---
      blockquote: ({ children }) => (
        <blockquote
          className={
            isReasoning
              ? 'border-l-2 border-text-500/30 pl-3 py-0.5 my-2 first:mt-0 last:mb-0 text-text-400'
              : 'border-l-2 border-accent-main-100/60 pl-4 py-1 my-4 first:mt-0 last:mb-0 text-text-300 italic'
          }
        >
          {children}
        </blockquote>
      ),

      // --- Tables ---
      table: ({ children }) => <MarkdownTable isReasoning={isReasoning}>{children}</MarkdownTable>,

      thead: ({ children }) => <thead className={isReasoning ? 'text-text-400' : 'text-text-200'}>{children}</thead>,
      th: ({ children }) => (
        <th
          className={
            isReasoning
              ? 'px-3 py-1.5 text-left text-[length:var(--fs-sm)] font-medium whitespace-nowrap border-b border-border-200/32'
              : 'relative px-3 py-2.5 text-left text-[length:var(--fs-md)] font-semibold whitespace-nowrap border-b border-border-200/38'
          }
        >
          {children}
        </th>
      ),
      tbody: ({ children }) => <tbody>{children}</tbody>,
      tr: ({ children }) => (
        <tr className={isReasoning ? 'hover:bg-bg-200/10 transition-colors' : 'hover:bg-bg-200/12 transition-colors'}>
          {children}
        </tr>
      ),
      td: ({ children }) => (
        <td
          className={
            isReasoning
              ? 'px-3 py-1.5 text-[length:var(--fs-sm)] text-text-300 w-max border-b border-border-200/18'
              : 'px-3 py-2 text-[length:var(--fs-md)] text-text-300 leading-[1.55] w-max border-b border-border-200/14'
          }
        >
          {children}
        </td>
      ),

      // --- Horizontal rule ---
      hr: () => (
        <hr
          className={
            isReasoning
              ? 'border-border-200/40 my-4 first:mt-0 last:mb-0'
              : 'border-border-200/60 my-8 first:mt-0 last:mb-0'
          }
        />
      ),

      // --- Strong & emphasis ---
      strong: ({ children }) => (
        <strong className={isReasoning ? 'font-semibold text-text-300' : 'font-semibold text-text-100'}>
          {children}
        </strong>
      ),
      em: ({ children }) => (
        <em className={isReasoning ? 'italic text-text-300' : 'italic text-text-200'}>{children}</em>
      ),

      // --- Strikethrough (GFM) ---
      del: ({ children }) => (
        <del
          className={
            isReasoning
              ? 'text-[length:var(--fs-sm)] text-text-500 line-through decoration-text-500/50'
              : 'text-text-400 line-through decoration-text-400/50'
          }
        >
          {children}
        </del>
      ),
    }),
    [isReasoning, isStreaming],
  )

  return (
    <div
      className={`markdown-content ${isReasoning ? 'text-[length:var(--fs-sm)] leading-5 text-text-400' : 'text-[length:var(--fs-base)] leading-relaxed text-text-100'} break-words min-w-0 overflow-hidden ${className}`}
    >
      <Streamdown components={components} isAnimating={isStreaming} controls={false} plugins={markdownPlugins}>
        {content}
      </Streamdown>
    </div>
  )
})

// ─── Standalone Code Highlighter ───────────────────────────────

/**
 * Standalone code highlighter for tool previews.
 * Uses file extension to determine language.
 */
export const HighlightedCode = memo(function HighlightedCode({
  code,
  filePath,
  language,
  maxHeight,
  className = '',
}: {
  code: string
  filePath?: string
  language?: string
  maxHeight?: number
  className?: string
}) {
  const lang = useMemo(() => {
    return language || detectLanguage(filePath)
  }, [filePath, language])

  return (
    <div className={`overflow-auto ${className}`} style={maxHeight ? { maxHeight } : undefined}>
      <CodeBlock code={code} language={lang} />
    </div>
  )
})

export default MarkdownRenderer
