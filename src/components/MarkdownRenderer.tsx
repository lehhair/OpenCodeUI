import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import morphdom from 'morphdom'
import { CodeBlock } from './CodeBlock'
import { CodeIcon, EyeIcon, HandIcon, RetryIcon, ZoomInIcon, ZoomOutIcon } from './Icons'
import { CopyButton } from './ui'
import { useTheme } from '../hooks/useTheme'
import { useInputCapabilities } from '../hooks/useInputCapabilities'
import { detectLanguage } from '../utils/languageUtils'
import { isTauri } from '../utils/tauri'
import { marked } from 'marked'
import type { Tokens } from 'marked'
import { isMarkupPreviewLanguage, projectMarkdownStream, stripLeadingHtmlComments, type MarkdownStreamProjection } from './markdownStream'
import { renderMarkdownToHtml } from './markdownHtmlRenderer'
import {
  buildHtmlSandboxThemeCss,
  createHtmlSandboxMeasureScript,
  createHtmlSandboxStorageScript,
  createSandboxedHtmlDocument,
  HTML_SANDBOX_SECURITY_HEAD,
  HTML_SANDBOX_VIEWPORT_HEAD,
} from './htmlSandbox'
import { getCachedMermaidSvg, getOrRenderMermaidSvg } from './mermaidRenderCache'
import { inferImageDimensions } from './imageDimensions'

interface MarkdownRendererProps {
  content: string
  className?: string
  isStreaming?: boolean
  variant?: 'default' | 'reasoning'
}

const MERMAID_MIN_SCALE = 0.5
const MERMAID_MAX_SCALE = 3
const MERMAID_SCALE_STEP = 0.15
const MERMAID_CONTROL_BUTTON_BASE_CLASS =
  'inline-flex h-8 w-8 items-center justify-center rounded-md bg-bg-300/70 backdrop-blur-md transition-colors duration-150 hover:bg-bg-300/85 disabled:opacity-40 disabled:cursor-not-allowed'
const MERMAID_CONTROL_BUTTON_CLASS = `${MERMAID_CONTROL_BUTTON_BASE_CLASS} text-text-400 hover:text-text-200`
const LOCAL_FILE_LINK_PREFIX = '#opencode-local-file:'

type DiagramPointer = { x: number; y: number }

type PinchGesture = {
  startDistance: number
  startScale: number
  startOffset: { x: number; y: number }
  startCenter: { x: number; y: number }
}

let mermaidRenderCounter = 0
const markdownProjectionCache = new Map<string, MarkdownStreamProjection>()

const htmlCache = new Map<string, string>()
const HTML_CACHE_MAX = 64
const MARKDOWN_BLOCK_CONTENT_CLASS = 'space-y-4 whitespace-normal [&>*:first-child]:mt-0 [&>*:last-child]:mb-0'
const MARKDOWN_USER_STATE_ATTRIBUTE = 'data-markdown-user-state'
const HTML_SOURCE_BUTTON_CLASS = 'absolute right-2 top-2 z-10 inline-flex h-8 w-8 items-center justify-center rounded-md bg-bg-300/70 p-2 text-accent-main-100 opacity-0 shadow-sm backdrop-blur-md transition-all hover:bg-bg-300/90 hover:text-accent-main-100 group-hover/html-preview:opacity-100 group-focus-within/html-preview:opacity-100'
const BLOCK_HTML_SOURCE_PATTERN = /^\s*<(?:address|article|aside|blockquote|center|details|dialog|div|dl|fieldset|figure|footer|form|header|html|main|nav|ol|section|svg|table|ul)\b/i
const PREFIXED_BLOCK_HTML_SOURCE_PATTERN = /^\s*<(?:style|script)\b[\s\S]*<(?:address|article|aside|blockquote|center|details|dialog|div|dl|fieldset|figure|footer|form|header|html|main|nav|ol|section|svg|table|ul)\b/i
const ARTIFACT_HTML_SOURCE_PATTERN = /(?:<!doctype\s+html\b|<html\b|<style\b|<script\b|<canvas\b|\son[a-z]+\s*=|(?:href|src)\s*=\s*["']?\s*javascript:)/i
const STREAMING_HTML_CONTENT_PATTERN = /(?:```(?:html|htm|xhtml|xml|svg)\b|<(?:address|article|aside|blockquote|canvas|center|details|dialog|div|dl|fieldset|figure|footer|form|header|html|main|nav|ol|section|style|svg|table|ul)\b)/i

function getCachedHtml(src: string, isReasoning: boolean): string {
  const key = `${isReasoning ? 'r' : 'd'}:${src}`
  const cached = htmlCache.get(key)
  if (cached !== undefined) return cached
  const html = renderMarkdownToHtml(src, isReasoning)
  if (htmlCache.size >= HTML_CACHE_MAX) {
    const firstKey = htmlCache.keys().next().value
    if (firstKey !== undefined) htmlCache.delete(firstKey)
  }
  htmlCache.set(key, html)
  return html
}

/**
 * live 尾段是否可以只追加到最后一个文本节点。
 * 保守：后缀一旦含 markdown 结构/强调/代码/链接等字符，回退全量 parse+morph。
 */
function canAppendLiveMarkdownSuffix(suffix: string): boolean {
  if (!suffix) return false
  // 排除会改 markdown 结构、math/code，或可能形成 autolink 的字符
  // （含 :/@/ 时回退全量 parse，避免流式中链接一直是纯文本）
  return /^[^\n`*_[\]()#>|!~\\<$:/@]+$/.test(suffix)
}

/** 最后一个 Text 是否安全承接追加（不能在 strong/em/a/code 等行内节点里） */
function canAppendIntoTextNode(textNode: Text): boolean {
  const parent = textNode.parentElement
  if (!parent) return false
  // 父节点后面还有兄弟时，追加会插在中间，结构不对
  if (parent.lastChild !== textNode) return false
  // 只允许块级/列表等容器的直接文本；行内格式内追加会把后续字错误包进强调/链接
  return /^(P|LI|TD|TH|H[1-6]|BLOCKQUOTE|DIV)$/.test(parent.tagName)
}

/** 把纯文本后缀接到 root 内最后一个 Text 节点；失败返回 false */
function tryAppendLiveText(root: HTMLElement, suffix: string): boolean {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let last: Text | null = null
  let node = walker.nextNode()
  while (node) {
    last = node as Text
    node = walker.nextNode()
  }
  if (!last || !canAppendIntoTextNode(last)) return false
  last.textContent = `${last.textContent ?? ''}${suffix}`
  return true
}

function applyMarkdownHtml(root: HTMLElement, html: string) {
  if (!root.hasChildNodes()) {
    root.innerHTML = html
    decorateMarkdownDom(root)
    return
  }
  const next = document.createElement('div')
  next.innerHTML = html
  decorateMarkdownDom(next)
  const dirtySelectValues = Array.from(
    root.querySelectorAll<HTMLSelectElement>(`select[${MARKDOWN_USER_STATE_ATTRIBUTE}]`),
    select => new Set(Array.from(select.selectedOptions, option => option.value)),
  )
  morphdom(root, next, {
    childrenOnly: true,
    onBeforeElUpdated: (fromEl, toEl) => {
      if (fromEl instanceof HTMLElement && toEl instanceof HTMLElement) {
        preserveMarkdownControlState(fromEl, toEl)
      }
      if (fromEl.isEqualNode(toEl)) return false
      return true
    },
  })
  root.querySelectorAll<HTMLSelectElement>(`select[${MARKDOWN_USER_STATE_ATTRIBUTE}]`).forEach((select, index) => {
    const selectedValues = dirtySelectValues[index]
    if (!selectedValues) return
    Array.from(select.options).forEach(option => {
      option.selected = selectedValues.has(option.value)
    })
  })
}

function createMermaidRenderId(prefix: string) {
  mermaidRenderCounter += 1
  const safePrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, '') || 'diagram'
  return `mermaid-${safePrefix}-${mermaidRenderCounter}`
}

function scopeMermaidSvg(svg: string, instanceId: string) {
  const template = document.createElement('template')
  template.innerHTML = svg
  const root = template.content.querySelector('svg')
  if (!root) return svg

  const idMap = new Map<string, string>()
  const elementsWithIds = [...(root.hasAttribute('id') ? [root] : []), ...root.querySelectorAll('[id]')]
  elementsWithIds.forEach((element, index) => {
    const id = element.getAttribute('id')
    if (!id) return
    const nextId = `${instanceId}-${index}`
    idMap.set(id, nextId)
    element.setAttribute('id', nextId)
  })

  const replaceReferences = (value: string) =>
    value.replace(/#([a-zA-Z0-9_.:-]+)/g, (match, id: string) => {
      const nextId = idMap.get(id)
      return nextId ? `#${nextId}` : match
    })

  const elements = [root, ...root.querySelectorAll('*')]
  elements.forEach(element => {
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.name === 'aria-labelledby' || attribute.name === 'aria-describedby') {
        const value = attribute.value
          .split(/\s+/)
          .map(id => idMap.get(id) ?? id)
          .join(' ')
        element.setAttribute(attribute.name, value)
        continue
      }
      const value = replaceReferences(attribute.value)
      if (value !== attribute.value) element.setAttribute(attribute.name, value)
    }
  })
  root.querySelectorAll('style').forEach(style => {
    if (style.textContent) style.textContent = replaceReferences(style.textContent)
  })

  return root.outerHTML
}

async function getMermaidSvg(code: string, theme: 'dark' | 'default', renderPrefix: string) {
  const cacheKey = `${theme}:${code}`
  return getOrRenderMermaidSvg(cacheKey, async () => {
    const { default: mermaid } = await import('mermaid')
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme })
    const result = await mermaid.render(createMermaidRenderId(renderPrefix), code)
    return result.svg
  })
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

function decodeLocalFileHref(href?: string): string | null {
  if (!href?.startsWith(LOCAL_FILE_LINK_PREFIX)) return null
  try {
    return decodeURIComponent(href.slice(LOCAL_FILE_LINK_PREFIX.length))
  } catch {
    return null
  }
}

function openLocalFilePath(filePath: string) {
  if (!isTauri()) return
  import('@tauri-apps/plugin-opener').then(mod => mod.openPath(filePath)).catch(() => {})
}

function getOrderedListPadding(start: number, itemCount: number): string {
  const endNumber = Math.max(start + itemCount - 1, start)
  const markerChars = String(Math.abs(endNumber)).length + (endNumber < 0 ? 1 : 0)
  return `${Math.max(3, markerChars + 2)}ch`
}

// ─── Mermaid ────────────────────────────────────────────────────

const MarkdownMermaid = memo(function MarkdownMermaid({ code, isIncomplete }: { code: string; isIncomplete?: boolean }) {
  const { resolvedTheme } = useTheme()
  const mermaidTheme = resolvedTheme === 'dark' ? 'dark' : 'default'
  const { hasCoarsePointer, hasTouch, preferTouchUi } = useInputCapabilities()
  const supportsTouchGestures = hasCoarsePointer || hasTouch
  const renderPrefix = useId()
  const instanceSvgId = `mermaid-instance-${renderPrefix.replace(/[^a-zA-Z0-9_-]/g, '')}`
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
  } | null>(null)
  const touchPointersRef = useRef<Map<number, DiagramPointer>>(new Map())
  const pinchRef = useRef<PinchGesture | null>(null)
  const [svg, setSvg] = useState(() => (isIncomplete ? '' : (getCachedMermaidSvg(`${mermaidTheme}:${code}`) ?? '')))
  const [error, setError] = useState('')
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [isTouchPanEnabled, setIsTouchPanEnabled] = useState(false)

  const resetView = useCallback(() => {
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }, [])
  const scopedSvg = useMemo(() => scopeMermaidSvg(svg, instanceSvgId), [instanceSvgId, svg])

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
      if (!preferTouchUi) return
      if (event.target instanceof HTMLElement && event.target.closest('button')) return
      event.currentTarget.focus({ preventScroll: true })
    },
    [preferTouchUi],
  )

  const handleContainerBlur = useCallback(
    (event: React.FocusEvent<HTMLDivElement>) => {
      if (!preferTouchUi) return
      const nextTarget = event.relatedTarget
      if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return
      setIsTouchPanEnabled(false)
      clearTouchGesture()
    },
    [clearTouchGesture, preferTouchUi],
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
      return
    }

    let cancelled = false

    async function renderDiagram() {
      try {
        const cached = getCachedMermaidSvg(`${mermaidTheme}:${code}`)
        setSvg(cached ?? '')
        setError('')
        resetView()
        if (cached !== undefined) return
        const result = await getMermaidSvg(code, mermaidTheme, renderPrefix)
        if (!cancelled) setSvg(result)
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
  }, [code, isIncomplete, mermaidTheme, renderPrefix, resetView])

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
      className={`group/mermaid relative my-4 first:mt-0 last:mb-0 overflow-hidden ${preferTouchUi ? 'focus:outline-none' : ''}`}
      tabIndex={preferTouchUi ? 0 : undefined}
      onClick={preferTouchUi ? handleContainerClick : undefined}
      onBlur={preferTouchUi ? handleContainerBlur : undefined}
    >
      <div
        className={`absolute right-2 top-2 z-10 flex items-center gap-1 opacity-0 transition-opacity group-hover/mermaid:opacity-100 group-focus-within/mermaid:opacity-100 ${preferTouchUi ? '[@media(hover:none)]:opacity-0' : '[@media(hover:none)]:opacity-100'}`}
        onMouseDown={event => event.preventDefault()}
      >
        <CopyButton text={code} position="static" className={`!h-8 !w-8 !p-2 ${MERMAID_CONTROL_BUTTON_BASE_CLASS}`} />
        {preferTouchUi && (
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
        dangerouslySetInnerHTML={{ __html: scopedSvg }}
      />
    </div>
  )
})

// ─── Markdown Table (React) ─────────────────────────────────────

const MarkdownTable = memo(function MarkdownTable({
  children,
  isReasoning,
}: {
  children: React.ReactNode
  isReasoning: boolean
}) {
  if (isReasoning) {
    return (
      <div className="overflow-x-auto my-2 first:mt-0 last:mb-0 w-full">
        <table className="min-w-full border-collapse text-[length:var(--fs-sm)]">
          {children}
        </table>
      </div>
    )
  }

  return (
    <div className="group/table relative my-5 first:mt-0 last:mb-0 rounded-md border border-border-200/35 w-full">
      <div className="overflow-x-auto">
        <table className="w-full text-[length:var(--fs-md)] border-collapse">
          {children}
        </table>
      </div>
    </div>
  )
})

function MarkdownTableCell({
  children,
  isHeader,
  isReasoning,
}: {
  children: React.ReactNode
  isHeader: boolean
  isReasoning: boolean
}) {
  if (isHeader) {
    return (
      <th
        className={isReasoning
          ? 'px-3 py-1.5 text-left text-[length:var(--fs-sm)] font-medium whitespace-nowrap border-b border-border-200/32'
          : 'relative px-3 py-2.5 text-left text-[length:var(--fs-md)] font-semibold whitespace-nowrap border-b border-border-200/38'
        }
      >
        {children}
      </th>
    )
  }
  return (
    <td
      className={isReasoning
        ? 'px-3 py-1.5 text-[length:var(--fs-sm)] text-text-300 w-max border-b border-border-200/18'
        : 'px-3 py-2 text-[length:var(--fs-md)] text-text-300 leading-[1.55] w-max border-b border-border-200/14'
      }
    >
      {children}
    </td>
  )
}

function MarkdownTableRow({ children, isReasoning }: { children: React.ReactNode; isReasoning: boolean }) {
  return (
    <tr className={isReasoning ? 'hover:bg-bg-200/10 transition-colors' : 'hover:bg-bg-200/12 transition-colors'}>
      {children}
    </tr>
  )
}

function MarkdownTableHeader({ children, isReasoning }: { children: React.ReactNode; isReasoning: boolean }) {
  return <thead className={isReasoning ? 'text-text-400' : 'text-text-200'}>{children}</thead>
}

function renderTableFromSrc(src: string, isReasoning: boolean): React.ReactNode {
  const tokens = marked.lexer(src)
  const tableToken = tokens.find(t => t.type === 'table') as Tokens.Table | undefined
  if (!tableToken) return null

  const headerTexts = tableToken.header.map(cell => cell.text)
  const rowTexts = tableToken.rows.map(row => row.map(cell => cell.text))
  const copyText = [
    `| ${headerTexts.join(' | ')} |`,
    `| ${headerTexts.map(() => '---').join(' | ')} |`,
    ...rowTexts.map(row => `| ${row.join(' | ')} |`),
  ].join('\n')

  return (
    <MarkdownTable isReasoning={isReasoning}>
      <MarkdownTableHeader isReasoning={isReasoning}>
        <MarkdownTableRow isReasoning={isReasoning}>
          {tableToken.header.map((cell, i) => {
            const isLastHeader = i === tableToken.header.length - 1
            return (
              <MarkdownTableCell key={i} isHeader isReasoning={isReasoning}>
                {isLastHeader && copyText && !isReasoning ? (
                  <>
                    <span className="block pr-8">
                      {cell.tokens ? renderInlineTokensToReact(cell.tokens, isReasoning) : cell.text}
                    </span>
                    <span className="absolute inset-y-0 right-0 flex items-center px-2">
                      <CopyButton
                        text={copyText}
                        position="static"
                        className="!p-1 opacity-0 group-hover/table:opacity-100 group-focus-within/table:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity"
                      />
                    </span>
                  </>
                ) : cell.tokens ? (
                  renderInlineTokensToReact(cell.tokens, isReasoning)
                ) : (
                  cell.text
                )}
              </MarkdownTableCell>
            )
          })}
        </MarkdownTableRow>
      </MarkdownTableHeader>
      <tbody>
        {tableToken.rows.map((row, rowIndex) => (
          <MarkdownTableRow key={rowIndex} isReasoning={isReasoning}>
            {row.map((cell, cellIndex) => (
              <MarkdownTableCell key={cellIndex} isHeader={false} isReasoning={isReasoning}>
                {cell.tokens ? renderInlineTokensToReact(cell.tokens, isReasoning) : cell.text}
              </MarkdownTableCell>
            ))}
          </MarkdownTableRow>
        ))}
      </tbody>
    </MarkdownTable>
  )
}

function renderInlineTokensToReact(tokens: unknown[], _isReasoning: boolean): React.ReactNode {
  return tokens.map((token, index) => {
    const item = token as Record<string, unknown>
    if (item.type === 'text') {
      const nested = item.tokens as unknown[] | undefined
      if (nested?.length) return <Fragment key={index}>{renderInlineTokensToReact(nested, _isReasoning)}</Fragment>
      return renderTextExtensionsToReact(String(item.text ?? ''), `text-${index}`, _isReasoning)
    }
    if (item.type === 'strong') return <strong key={index} className={_isReasoning ? 'font-semibold text-text-300' : 'font-semibold text-text-100'}>{renderInlineTokensToReact((item.tokens as unknown[]) ?? [], _isReasoning)}</strong>
    if (item.type === 'em') return <em key={index} className={_isReasoning ? 'italic text-text-300' : 'italic text-text-200'}>{renderInlineTokensToReact((item.tokens as unknown[]) ?? [], _isReasoning)}</em>
    if (item.type === 'del') {
      const raw = typeof item.raw === 'string' ? item.raw : ''
      if (raw.startsWith('~') && !raw.startsWith('~~') && !raw.endsWith('~~')) {
        const inner = raw.slice(1, -1)
        // 仅解析化学式下标（H~2~O、SO~4~）：无空格、无 CJK、长度 ≤ 5。
        if (inner && !/\s/.test(inner) && !/[\u4e00-\u9fff\u3040-\u30ff]/.test(inner) && inner.length <= 5) {
          return <sub key={index}>{renderInlineTokensToReact((item.tokens as unknown[]) ?? [], _isReasoning)}</sub>
        }
      }
      return <del key={index} className={_isReasoning ? 'text-text-500 line-through decoration-text-500/50' : 'text-text-400 line-through decoration-text-400/50'}>{renderInlineTokensToReact((item.tokens as unknown[]) ?? [], _isReasoning)}</del>
    }
    if (item.type === 'codespan') return <code key={index} className={_isReasoning ? 'font-mono text-accent-main-100 text-[0.9em] align-baseline break-words' : 'text-accent-main-100 text-[0.9em] font-mono align-baseline break-words'}>{String(item.text ?? '')}</code>
    if (item.type === 'link') {
      const href = typeof item.href === 'string' ? item.href : undefined
      if (isUnsafeHrefInline(href)) return <span key={index}>{renderInlineTokensToReact((item.tokens as unknown[]) ?? [], _isReasoning)} [blocked]</span>
      const localPath = decodeLocalFileHrefInline(href) ?? getWindowsAbsolutePathInline(href)
      const className = _isReasoning
        ? 'text-[length:var(--fs-sm)] font-medium text-accent-main-200/80 hover:text-accent-main-200 underline underline-offset-2 transition-colors'
        : 'font-medium text-accent-main-100 hover:text-accent-main-200 underline underline-offset-2 transition-colors'
      if (localPath) {
        return (
          <a key={index} href={encodeLocalFileHrefInline(localPath)} title={localPath} className={className} onClick={e => { e.preventDefault(); openLocalFilePath(localPath) }}>
            {renderInlineTokensToReact((item.tokens as unknown[]) ?? [], _isReasoning)}
          </a>
        )
      }
      return <a key={index} href={href} target="_blank" rel="noopener noreferrer" className={className}>{renderInlineTokensToReact((item.tokens as unknown[]) ?? [], _isReasoning)}</a>
    }
    if (item.type === 'image') {
      const src = typeof item.href === 'string' ? item.href : undefined
      if (!src || isUnsafeImageSrcInline(src)) return <span key={index}>[Image blocked: {String(item.text ?? '')}]</span>
      const dimensions = inferImageDimensions(src)
      return <img key={index} src={src} alt={String(item.text ?? '')} width={dimensions?.width} height={dimensions?.height} loading="eager" decoding="async" className="block max-w-full rounded-md" />
    }
    if (item.type === 'br') return <br key={index} />
    return <span key={index}>{String(item.text ?? item.raw ?? '')}</span>
  })
}

function isEscapedTextAt(text: string, index: number): boolean {
  let slashCount = 0
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) slashCount += 1
  return slashCount % 2 === 1
}

function findUnescapedText(text: string, marker: string, start: number): number {
  let cursor = start
  while (cursor < text.length) {
    const index = text.indexOf(marker, cursor)
    if (index === -1) return -1
    if (!isEscapedTextAt(text, index)) return index
    cursor = index + marker.length
  }
  return -1
}

function getFootnoteIdInline(label: string): string {
  const normalized = label.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-')
  return normalized || 'note'
}

function renderTextExtensionsToReact(text: string, keyPrefix: string, isReasoning: boolean): React.ReactNode {
  const parts: React.ReactNode[] = []
  let cursor = 0
  let lastIndex = 0

  const pushText = (end: number) => {
    if (end > lastIndex) parts.push(text.slice(lastIndex, end))
  }

  while (cursor < text.length) {
    if (isEscapedTextAt(text, cursor)) {
      cursor += 1
      continue
    }

    if (text.startsWith('[^', cursor)) {
      const close = text.indexOf(']', cursor + 2)
      const label = close === -1 ? '' : text.slice(cursor + 2, close)
      if (label && !/\s/.test(label)) {
        const id = getFootnoteIdInline(label)
        const className = isReasoning ? 'align-super text-[0.75em] text-accent-main-200/80' : 'align-super text-[0.75em] text-accent-main-100'
        pushText(cursor)
        parts.push(
          <sup key={`${keyPrefix}-fn-${cursor}`} id={`fnref-${id}`} className={className}>
            <a href={`#fn-${id}`} className="font-medium underline underline-offset-2">
              {label}
            </a>
          </sup>,
        )
        cursor = close + 1
        lastIndex = cursor
        continue
      }
    }

    if (text.startsWith('==', cursor)) {
      const close = findUnescapedText(text, '==', cursor + 2)
      const content = close === -1 ? '' : text.slice(cursor + 2, close)
      if (content && !content.includes('\n')) {
        const className = isReasoning ? 'rounded-sm bg-bg-300/70 px-0.5 text-text-300' : 'rounded-sm bg-accent-main-100/15 px-0.5 text-text-100'
        pushText(cursor)
        parts.push(
          <mark key={`${keyPrefix}-mark-${cursor}`} className={className}>
            {renderTextExtensionsToReact(content, `${keyPrefix}-mark-${cursor}`, isReasoning)}
          </mark>,
        )
        cursor = close + 2
        lastIndex = cursor
        continue
      }
    }

    if (text[cursor] === '^') {
      const close = findUnescapedText(text, '^', cursor + 1)
      const content = close === -1 ? '' : text.slice(cursor + 1, close)
      if (content && !/\s/.test(content)) {
        pushText(cursor)
        parts.push(<sup key={`${keyPrefix}-sup-${cursor}`}>{renderTextExtensionsToReact(content, `${keyPrefix}-sup-${cursor}`, isReasoning)}</sup>)
        cursor = close + 1
        lastIndex = cursor
        continue
      }
    }

    if (text[cursor] === '~' && text[cursor + 1] !== '~') {
      const close = findUnescapedText(text, '~', cursor + 1)
      const content = close === -1 ? '' : text.slice(cursor + 1, close)
      // 仅解析化学式下标（H~2~O、SO~4~）：无空格、无 CJK、长度 ≤ 5。
      // 否则 ~ 会被范围/约数文本误匹配（如 TGP021~024流量8.85~9.16）。
      if (content && !/\s/.test(content) && !/[\u4e00-\u9fff\u3040-\u30ff]/.test(content) && content.length <= 5) {
        pushText(cursor)
        parts.push(<sub key={`${keyPrefix}-sub-${cursor}`}>{renderTextExtensionsToReact(content, `${keyPrefix}-sub-${cursor}`, isReasoning)}</sub>)
        cursor = close + 1
        lastIndex = cursor
        continue
      }
    }

    cursor += 1
  }

  pushText(text.length)
  if (parts.length === 0) return text
  if (parts.length === 1) return parts[0]
  return parts
}

function isUnsafeHrefInline(href?: string): boolean {
  if (!href) return false
  const normalized = Array.from(href.trim()).filter(char => { const code = char.charCodeAt(0); return code > 0x1f && code !== 0x7f && !/\s/.test(char) }).join('').toLowerCase()
  return normalized.startsWith('javascript:') || normalized.startsWith('vbscript:') || normalized.startsWith('data:')
}

function isUnsafeImageSrcInline(src?: string): boolean {
  if (!src) return false
  if (/^data:/i.test(src.trim())) return true
  return isUnsafeHrefInline(src)
}

function getWindowsAbsolutePathInline(value: string | undefined): string | null {
  if (!value) return null
  try { const decoded = decodeURIComponent(value); return /^[A-Za-z]:[\\/]/.test(decoded) ? decoded : null } catch { return value }
}

function encodeLocalFileHrefInline(filePath: string): string {
  return `${LOCAL_FILE_LINK_PREFIX}${encodeURIComponent(filePath)}`
}

function decodeLocalFileHrefInline(href?: string): string | null {
  if (!href?.startsWith(LOCAL_FILE_LINK_PREFIX)) return null
  try { return decodeURIComponent(href.slice(LOCAL_FILE_LINK_PREFIX.length)) } catch { return null }
}

function createStreamingHtmlDocument(resizeId: string, theme: 'light' | 'dark'): string {
  const themeHead = `<style id="opencode-html-theme">${buildHtmlSandboxThemeCss(theme, 'hidden')}</style>`
  const themeCss = JSON.stringify({
    light: buildHtmlSandboxThemeCss('light', 'hidden'),
    dark: buildHtmlSandboxThemeCss('dark', 'hidden'),
  })
  const storageScript = createHtmlSandboxStorageScript()
  const measureScript = createHtmlSandboxMeasureScript(resizeId)
  const bridge = `<script>
  (() => {
    const id = ${JSON.stringify(resizeId)};
    const themeCss = ${themeCss};
    const measure = () => dispatchEvent(new Event('opencode-html-measure'));
    let scheduledScripts = 0;
    let scriptQueue = Promise.resolve();
    const applyTheme = theme => {
      document.documentElement.style.colorScheme = theme;
      document.documentElement.dataset.theme = theme;
      const style = document.getElementById('opencode-html-theme');
      if (style) style.textContent = themeCss[theme] || themeCss.light;
      dispatchEvent(new CustomEvent('opencode-theme-change', { detail: { theme } }));
      dispatchEvent(new Event('resize'));
      measure();
    };
    const clean = (doc, scriptCount) => {
      const descriptors = [];
      Array.from(doc.querySelectorAll('script')).forEach((node, index) => {
        if (index >= scriptCount) {
          node.remove();
          return;
        }
        descriptors.push({
          attributes: Array.from(node.attributes).map(attr => [attr.name, attr.value]),
          text: node.textContent || ''
        });
        node.setAttribute('data-opencode-script-index', String(index));
        node.setAttribute('type', 'application/x-opencode-pending');
      });
      doc.querySelectorAll('*').forEach(node => Array.from(node.attributes).forEach(attr => {
        if (/^(href|src|action|formaction)$/i.test(attr.name) && /^\\s*javascript:/i.test(attr.value)) node.removeAttribute(attr.name);
      }));
      return descriptors;
    };
    const clone = node => document.importNode(node, true);
    const compatible = (current, next) => {
      if (current.nodeType !== next.nodeType || current.nodeName !== next.nodeName) return false;
      if (current.nodeType !== 1) return true;
      const currentId = current.getAttribute('id');
      const nextId = next.getAttribute('id');
      if (currentId || nextId) return currentId === nextId;
      if (current.nodeName === 'SCRIPT') {
        return current.getAttribute('data-opencode-script-index') === next.getAttribute('data-opencode-script-index');
      }
      return true;
    };
    const patch = (current, next) => {
      if (!compatible(current, next)) {
        current.replaceWith(clone(next));
        return;
      }
      if (current.nodeType === 3 || current.nodeType === 8) {
        if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
        return;
      }
      const currentElement = current;
      const nextElement = next;
      if (currentElement.nodeName === 'SCRIPT' && currentElement.hasAttribute('data-opencode-script-executed')) return;
      Array.from(currentElement.attributes).forEach(attr => {
        if (!nextElement.hasAttribute(attr.name)) currentElement.removeAttribute(attr.name);
      });
      Array.from(nextElement.attributes).forEach(attr => {
        if (currentElement.getAttribute(attr.name) !== attr.value) currentElement.setAttribute(attr.name, attr.value);
      });
      const nextChildren = Array.from(nextElement.childNodes);
      for (let index = 0; index < nextChildren.length; index += 1) {
        const nextChild = nextChildren[index];
        const currentChild = currentElement.childNodes[index];
        if (!currentChild) {
          currentElement.append(clone(nextChild));
          continue;
        }
        if (compatible(currentChild, nextChild)) {
          patch(currentChild, nextChild);
          continue;
        }
        const laterMatch = Array.from(currentElement.childNodes)
          .slice(index + 1)
          .find(candidate => compatible(candidate, nextChild));
        if (laterMatch) {
          currentElement.insertBefore(laterMatch, currentChild);
          patch(laterMatch, nextChild);
        } else {
          currentElement.insertBefore(clone(nextChild), currentChild);
        }
      }
      while (currentElement.childNodes.length > nextChildren.length) currentElement.lastChild?.remove();
    };
    const patchHead = next => {
      const currentNodes = Array.from(document.head.querySelectorAll('[data-opencode-stream-head]'));
      const nextNodes = Array.from(next.head.querySelectorAll('style,link[rel="stylesheet"],script'));
      for (let index = 0; index < Math.max(currentNodes.length, nextNodes.length); index += 1) {
        const current = currentNodes[index];
        const candidate = nextNodes[index];
        if (!candidate) current?.remove();
        else if (!current) {
          const added = clone(candidate);
          added.setAttribute('data-opencode-stream-head', '');
          document.head.append(added);
        } else patch(current, candidate);
      }
    };
    const runScripts = descriptors => {
      for (let index = scheduledScripts; index < descriptors.length; index += 1) {
        const descriptor = descriptors[index];
        scheduledScripts = index + 1;
        scriptQueue = scriptQueue.then(() => new Promise(resolve => {
          const pending = document.querySelector('script[data-opencode-script-index="' + index + '"]');
          if (!pending || pending.hasAttribute('data-opencode-script-executed')) {
            resolve();
            return;
          }
          const script = document.createElement('script');
          descriptor.attributes.forEach(([name, value]) => script.setAttribute(name, value));
          script.setAttribute('data-opencode-script-index', String(index));
          script.setAttribute('data-opencode-script-executed', '');
          if (pending.hasAttribute('data-opencode-stream-head')) script.setAttribute('data-opencode-stream-head', '');
          script.textContent = descriptor.text;
          const waitsForLoad = script.hasAttribute('src') || script.getAttribute('type') === 'module';
          if (script.hasAttribute('src') && !script.hasAttribute('async') && !script.hasAttribute('defer')) script.async = false;
          if (waitsForLoad) {
            script.addEventListener('load', resolve, { once: true });
            script.addEventListener('error', resolve, { once: true });
          }
          pending.replaceWith(script);
          if (!waitsForLoad) resolve();
        }));
      }
      scriptQueue.then(measure);
    };
    addEventListener('message', event => {
      const data = event.data;
      if (data?.type === 'opencode-html-theme') {
        applyTheme(data.theme);
        return;
      }
      if (data?.type !== 'opencode-html-stream' || data.id !== id || typeof data.html !== 'string') return;
      const next = new DOMParser().parseFromString(data.html, 'text/html');
      const scriptCount = data.complete === true ? Number.MAX_SAFE_INTEGER : Math.max(0, Number(data.scriptCount) || 0);
      const descriptors = clean(next, scriptCount);
      patchHead(next);
      patch(document.body, next.body);
      runScripts(descriptors);
      measure();
    });
  })();
  </script>`
  return `<!doctype html><html><head>${HTML_SANDBOX_SECURITY_HEAD}${HTML_SANDBOX_VIEWPORT_HEAD}${themeHead}${storageScript}</head><body>${measureScript}${bridge}</body></html>`
}


function HtmlPreviewSurface({
  children,
  className = '',
  forceTouchControlsVisible = false,
  onViewSource,
  surfaceRef,
  style,
}: {
  children: React.ReactNode
  className?: string
  forceTouchControlsVisible?: boolean
  onViewSource: () => void
  surfaceRef?: React.RefObject<HTMLDivElement | null>
  style?: React.CSSProperties
}) {
  const { preferTouchUi } = useInputCapabilities()

  const handleClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (
      event.target instanceof Element &&
      event.target.closest('button, a, input, textarea, select, summary, [contenteditable]')
    ) {
      return
    }
    event.currentTarget.focus({ preventScroll: true })
  }, [])

  return (
    <div
      ref={surfaceRef}
      className={`group/html-preview relative max-w-full overflow-hidden contain-content ${preferTouchUi ? 'focus:outline-none' : ''} ${className}`}
      style={style}
      tabIndex={preferTouchUi ? 0 : undefined}
      onClick={preferTouchUi ? handleClick : undefined}
    >
      <button
        type="button"
        onClick={onViewSource}
        className={`${HTML_SOURCE_BUTTON_CLASS} ${preferTouchUi && !forceTouchControlsVisible ? '[@media(hover:none)]:opacity-0' : '[@media(hover:none)]:opacity-100'}`}
        title="View HTML source"
        aria-label="View HTML source"
      >
        <CodeIcon />
      </button>
      {children}
    </div>
  )
}

function MarkdownHtmlArtifact({
  code,
  isReasoning,
  isIncomplete,
  language = 'html',
}: {
  code: string
  isReasoning: boolean
  isIncomplete?: boolean
  language?: string
}) {
  const [view, setView] = useState<'preview' | 'code'>('preview')
  const [contentHeight, setContentHeight] = useState(120)
  const [contentWidth, setContentWidth] = useState<number | null>(null)
  const [touchControlsVisible, setTouchControlsVisible] = useState(false)
  const previewSurfaceRef = useRef<HTMLDivElement>(null)
  const scrollportRef = useRef<HTMLDivElement>(null)
  const streamFrameRef = useRef<HTMLIFrameElement>(null)
  const canonicalFrameRef = useRef<HTMLIFrameElement>(null)
  const [canonicalReady, setCanonicalReady] = useState(false)
  const resizeId = useId()
  const canonicalResizeId = `${resizeId}-canonical`
  const { resolvedTheme } = useTheme()
  const theme = resolvedTheme === 'dark' ? 'dark' : 'light'
  const [initialTheme] = useState<'light' | 'dark'>(theme)
  const [usesStreamBridge] = useState(() => !!isIncomplete)
  const streamSrcDoc = useMemo(() => createStreamingHtmlDocument(resizeId, initialTheme), [initialTheme, resizeId])
  const canonicalSrcDoc = useMemo(
    () => createSandboxedHtmlDocument(code, canonicalResizeId, initialTheme),
    [canonicalResizeId, code, initialTheme],
  )
  const showCanonical = !usesStreamBridge || !isIncomplete

  const sendStreamingHtml = useCallback(() => {
    if (!usesStreamBridge) return
    const scriptCount = isIncomplete
      ? Array.from(code.matchAll(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi)).length
      : Number.MAX_SAFE_INTEGER
    streamFrameRef.current?.contentWindow?.postMessage(
      { type: 'opencode-html-stream', id: resizeId, html: code, complete: !isIncomplete, scriptCount },
      '*',
    )
  }, [code, isIncomplete, resizeId, usesStreamBridge])

  useEffect(() => {
    sendStreamingHtml()
  }, [sendStreamingHtml])

  const sendTheme = useCallback(() => {
    const message = { type: 'opencode-html-theme', theme }
    streamFrameRef.current?.contentWindow?.postMessage(message, '*')
    canonicalFrameRef.current?.contentWindow?.postMessage(message, '*')
  }, [theme])

  useEffect(() => {
    sendTheme()
  }, [sendTheme])

  useEffect(() => {
    if (!touchControlsVisible) return
    const hideControlsOutsidePreview = (event: PointerEvent) => {
      if (event.target instanceof Node && !previewSurfaceRef.current?.contains(event.target)) {
        setTouchControlsVisible(false)
      }
    }
    window.addEventListener('pointerdown', hideControlsOutsidePreview, true)
    return () => window.removeEventListener('pointerdown', hideControlsOutsidePreview, true)
  }, [touchControlsVisible])

  useEffect(() => {
    const scrollport = scrollportRef.current
    if (!scrollport || typeof ResizeObserver === 'undefined') return
    let lastWidth = scrollport.clientWidth
    const observer = new ResizeObserver(() => {
      const nextWidth = scrollport.clientWidth
      if (nextWidth === lastWidth) return
      lastWidth = nextWidth
      // Unlock width only. Height updates from the next content measure after reflow.
      setContentWidth(current => (current == null ? current : null))
    })
    observer.observe(scrollport)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const handleFrameMessage = (event: MessageEvent) => {
      const data = event.data
      if (data?.type !== 'opencode-html-interaction' && data?.type !== 'opencode-html-resize') return
      const fromStream = event.source === streamFrameRef.current?.contentWindow && data.id === resizeId
      const fromCanonical = event.source === canonicalFrameRef.current?.contentWindow && data.id === canonicalResizeId
      if (!fromStream && !fromCanonical) return
      if (data.type === 'opencode-html-interaction') {
        setTouchControlsVisible(true)
        return
      }
      const height = Number(data.height)
      const width = Number(data.width)
      if (Number.isFinite(height)) setContentHeight(Math.min(4000, Math.max(120, Math.round(height))))
      if (Number.isFinite(width)) {
        const measured = Math.min(10000, Math.max(1, Math.round(width)))
        const available = scrollportRef.current?.clientWidth ?? 0
        setContentWidth(current => {
          const next = available > 0 && measured <= available + 1 ? null : measured
          return current === next ? current : next
        })
      }
    }
    window.addEventListener('message', handleFrameMessage)
    return () => window.removeEventListener('message', handleFrameMessage)
  }, [canonicalResizeId, resizeId])

  if (view === 'code') {
    return (
      <CodeBlock
        code={code}
        language={language}
        variant={isReasoning ? 'reasoning' : 'default'}
        wordwrap={isReasoning}
        className="my-4 first:mt-0 last:mb-0"
        headerActions={
          <button
            type="button"
            onClick={() => setView('preview')}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md p-2 text-text-400 transition-colors hover:bg-bg-300/60 hover:text-text-200"
            title="Preview HTML"
            aria-label="Preview HTML"
          >
            <EyeIcon />
          </button>
        }
      />
    )
  }

  return (
    <HtmlPreviewSurface
      className="my-4 first:mt-0 last:mb-0 w-full max-w-full transition-[height] duration-75 ease-out"
      forceTouchControlsVisible={touchControlsVisible}
      style={{ height: `${contentHeight}px` }}
      onViewSource={() => setView('code')}
      surfaceRef={previewSurfaceRef}
    >
      <div
        ref={scrollportRef}
        className="h-full w-full max-w-full overflow-x-auto overflow-y-hidden code-scrollbar"
        style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-x pan-y', overscrollBehaviorX: 'contain' }}
      >
        <div
          className="relative h-full w-full"
          style={{ minWidth: contentWidth == null ? '100%' : `${contentWidth}px` }}
        >
          {usesStreamBridge && !canonicalReady && (
            <iframe
              ref={streamFrameRef}
              title="HTML preview"
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
              srcDoc={streamSrcDoc}
              onLoad={() => {
                sendStreamingHtml()
                sendTheme()
              }}
              style={{ colorScheme: theme }}
              className="absolute inset-0 block h-full w-full border-0 bg-transparent"
            />
          )}
          {showCanonical && (
            <iframe
              ref={canonicalFrameRef}
              title="HTML preview"
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
              srcDoc={canonicalSrcDoc}
              onLoad={() => {
                setCanonicalReady(true)
                sendTheme()
              }}
              style={{ colorScheme: theme }}
              className={`absolute inset-0 block h-full w-full border-0 bg-transparent ${usesStreamBridge && !canonicalReady ? 'pointer-events-none opacity-0' : 'opacity-100'}`}
            />
          )}
        </div>
      </div>
    </HtmlPreviewSurface>
  )
}

// ─── DOM decoration and native control state ────────────────────

function decorateMarkdownDom(root: HTMLElement) {
  root.querySelectorAll('img').forEach(image => {
    const dimensions = inferImageDimensions(image.currentSrc || image.src)
    if (dimensions && !image.hasAttribute('width') && !image.hasAttribute('height')) {
      image.width = dimensions.width
      image.height = dimensions.height
    }
    image.loading = 'eager'
    image.decoding = 'async'
  })

  root.querySelectorAll('ol').forEach(list => {
    const startAttr = list.getAttribute('start')
    const start = startAttr ? parseInt(startAttr, 10) : 1
    const itemCount = Math.max(list.children.length, 1)
    list.style.paddingInlineStart = getOrderedListPadding(start, itemCount)
  })

  root.querySelectorAll('input[type="checkbox"][disabled]').forEach(input => {
    if (!(input instanceof HTMLInputElement)) return
    input.readOnly = true
    input.className = 'mr-2 align-middle'
  })
}

function preserveMarkdownControlState(fromElement: HTMLElement, toElement: HTMLElement) {
  if (!fromElement.hasAttribute(MARKDOWN_USER_STATE_ATTRIBUTE)) return
  toElement.setAttribute(MARKDOWN_USER_STATE_ATTRIBUTE, '')

  if (fromElement instanceof HTMLDetailsElement && toElement instanceof HTMLDetailsElement) {
    toElement.open = fromElement.open
    return
  }
  if (fromElement instanceof HTMLInputElement && toElement instanceof HTMLInputElement) {
    toElement.value = fromElement.value
    toElement.setAttribute('value', fromElement.value)
    if (fromElement.type === 'checkbox' || fromElement.type === 'radio') {
      toElement.checked = fromElement.checked
      toElement.toggleAttribute('checked', fromElement.checked)
    }
    return
  }
  if (fromElement instanceof HTMLTextAreaElement && toElement instanceof HTMLTextAreaElement) {
    toElement.value = fromElement.value
    toElement.textContent = fromElement.value
    return
  }
  if (fromElement instanceof HTMLSelectElement && toElement instanceof HTMLSelectElement) {
    const selectedValues = new Set(Array.from(fromElement.selectedOptions, option => option.value))
    Array.from(toElement.options).forEach(option => {
      const selected = selectedValues.has(option.value)
      option.selected = selected
      option.toggleAttribute('selected', selected)
    })
  }
}

// ─── DOM Island Block ───────────────────────────────────────────

const MarkdownDomBlock = memo(function MarkdownDomBlock({
  src,
  isReasoning,
  isLive,
}: {
  src: string
  isReasoning: boolean
  isLive?: boolean
}) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const appliedHtmlRef = useRef<string | null>(null)
  const appliedSrcRef = useRef<string | null>(null)
  // useSmoothMarkdownStream 上游已做 rAF 平滑，这里不再叠 useDeferredValue：
  // 双重延迟会让 React 18 concurrent 每帧跑两轮协调（紧急+deferred），流式帧时长翻倍。
  const renderSrc = src

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const markUserState = (event: Event) => {
      if (event.target instanceof HTMLElement) event.target.setAttribute(MARKDOWN_USER_STATE_ATTRIBUTE, '')
    }
    root.addEventListener('input', markUserState)
    root.addEventListener('change', markUserState)
    root.addEventListener('toggle', markUserState, true)
    return () => {
      root.removeEventListener('input', markUserState)
      root.removeEventListener('change', markUserState)
      root.removeEventListener('toggle', markUserState, true)
    }
  }, [])

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return

    // live 纯文本追加：跳过 parse + morphdom，只改最后一个 Text 节点
    const prevSrc = appliedSrcRef.current
    if (
      isLive &&
      prevSrc != null &&
      root.hasChildNodes() &&
      renderSrc.startsWith(prevSrc)
    ) {
      const suffix = renderSrc.slice(prevSrc.length)
      if (canAppendLiveMarkdownSuffix(suffix) && tryAppendLiveText(root, suffix)) {
        appliedSrcRef.current = renderSrc
        // 文本已偏离开 html 快照，强制后续全量路径重算
        appliedHtmlRef.current = null
        return
      }
    }

    // live 中间态不进 htmlCache（避免 64 槽被流式碎片挤爆）；稳定块才缓存
    const html = isLive ? renderMarkdownToHtml(renderSrc, isReasoning) : getCachedHtml(renderSrc, isReasoning)
    if (appliedHtmlRef.current === html) {
      appliedSrcRef.current = renderSrc
      return
    }
    appliedHtmlRef.current = html
    appliedSrcRef.current = renderSrc
    applyMarkdownHtml(root, html)
  }, [renderSrc, isReasoning, isLive])

  const handleClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (event.defaultPrevented) return
    const target = event.target instanceof Element ? event.target : null

    if (target?.closest('summary')) {
      target.closest('details')?.setAttribute(MARKDOWN_USER_STATE_ATTRIBUTE, '')
    }

    // Local file link
    const anchor = target?.closest<HTMLAnchorElement>(`a[href^="${LOCAL_FILE_LINK_PREFIX}"]`)
    const localPath = decodeLocalFileHref(anchor?.getAttribute('href') ?? undefined)
    if (anchor && localPath) {
      event.preventDefault()
      openLocalFilePath(localPath)
    }
  }, [])

  const handleSubmit = useCallback((event: React.FormEvent<HTMLDivElement>) => {
    event.preventDefault()
  }, [])

  return (
    <div
      ref={rootRef}
      className={MARKDOWN_BLOCK_CONTENT_CLASS}
      onClick={handleClick}
      onSubmit={handleSubmit}
    />
  )
})

function MarkdownHtmlIsland({
  src,
  isReasoning,
  isLive,
}: {
  src: string
  isReasoning: boolean
  isLive: boolean
}) {
  const [showSource, setShowSource] = useState(false)
  if (showSource) {
    return (
      <CodeBlock
        code={src}
        language="html"
        variant={isReasoning ? 'reasoning' : 'default'}
        wordwrap={isReasoning}
        className="my-4 first:mt-0 last:mb-0"
        headerActions={
          <button
            type="button"
            onClick={() => setShowSource(false)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md p-2 text-text-400 transition-colors hover:bg-bg-300/60 hover:text-text-200"
            title="Render HTML"
            aria-label="Render HTML"
          >
            <EyeIcon />
          </button>
        }
      />
    )
  }

  return (
    <HtmlPreviewSurface onViewSource={() => setShowSource(true)}>
      <MarkdownDomBlock src={src} isReasoning={isReasoning} isLive={isLive} />
    </HtmlPreviewSurface>
  )
}

// ─── Stream Block ───────────────────────────────────────────────

const MarkdownStreamBlock = memo(function MarkdownStreamBlock({
  src,
  mode,
  language,
  complete,
  isReasoning,
  isStreaming,
}: {
  src: string
  mode: 'full' | 'live' | 'code' | 'table'
  language?: string
  complete?: boolean
  isReasoning: boolean
  isStreaming: boolean
}) {
  // 流式高亮/未完成态只对「未闭合 code」或 live 有意义；稳定 full 块 isStreaming 恒 false 以冻 memo
  const streamActive = isStreaming && (mode === 'live' || (mode === 'code' && !complete))

  if (mode === 'table') {
    return (
      <div className="markdown-stream-block">
        <div className={MARKDOWN_BLOCK_CONTENT_CLASS}>{renderTableFromSrc(src, isReasoning)}</div>
      </div>
    )
  }

  if (mode === 'code') {
    if (language?.toLowerCase() === 'mermaid') {
      return (
        <div className="markdown-stream-block">
          <div className={MARKDOWN_BLOCK_CONTENT_CLASS}>
            <MarkdownMermaid code={src} isIncomplete={streamActive} />
          </div>
        </div>
      )
    }
    if (isMarkupPreviewLanguage(language) && !isReasoning) {
      return (
        <div className="markdown-stream-block">
          <div className={MARKDOWN_BLOCK_CONTENT_CLASS}>
            <MarkdownHtmlArtifact
              code={src}
              language={language}
              isReasoning={isReasoning}
              isIncomplete={streamActive}
            />
          </div>
        </div>
      )
    }
    return (
      <div className="markdown-stream-block">
        <div className={MARKDOWN_BLOCK_CONTENT_CLASS}>
          <div className={isReasoning ? 'my-2 first:mt-0 last:mb-0 w-full' : 'my-4 first:mt-0 last:mb-0 w-full'}>
            <CodeBlock
              code={src}
              language={language}
              variant={isReasoning ? 'reasoning' : 'default'}
              wordwrap={isReasoning}
              forceHighlight={streamActive}
              streamingHighlight={streamActive}
            />
          </div>
        </div>
      </div>
    )
  }

  const htmlSourceStart = stripLeadingHtmlComments(src)
  const isHtmlDocument = /^(?:<!doctype\s+html\b|<html\b)/i.test(htmlSourceStart)
  const isHtmlArtifact =
    ARTIFACT_HTML_SOURCE_PATTERN.test(src) &&
    (BLOCK_HTML_SOURCE_PATTERN.test(htmlSourceStart) || PREFIXED_BLOCK_HTML_SOURCE_PATTERN.test(htmlSourceStart))
  if (!isReasoning && (isHtmlDocument || isHtmlArtifact)) {
    return (
      <div className="markdown-stream-block">
        <div className={MARKDOWN_BLOCK_CONTENT_CLASS}>
          <MarkdownHtmlArtifact code={src} isReasoning={false} isIncomplete={streamActive && mode === 'live'} />
        </div>
      </div>
    )
  }

  if (!isReasoning && BLOCK_HTML_SOURCE_PATTERN.test(htmlSourceStart)) {
    return (
      <div className="markdown-stream-block">
        <MarkdownHtmlIsland src={src} isReasoning={false} isLive={mode === 'live'} />
      </div>
    )
  }

  return (
    <div className="markdown-stream-block">
      <MarkdownDomBlock src={src} isReasoning={isReasoning} isLive={mode === 'live'} />
    </div>
  )
})

// ─── Smooth stream ──────────────────────────────────────────────

function useSmoothMarkdownStream(content: string, enabled: boolean) {
  const [displayedContent, setDisplayedContent] = useState(content)
  const displayedRef = useRef(content)
  const targetRef = useRef(content)
  const rafRef = useRef<number | null>(null)

  const stop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
  }, [])

  useEffect(() => {
    if (!enabled) {
      stop()
      if (displayedRef.current !== content) {
        displayedRef.current = content
        setDisplayedContent(content)
      }
      return
    }

    targetRef.current = content
    if (content === displayedRef.current) return

    if (rafRef.current !== null) return

    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      const target = targetRef.current
      if (target === displayedRef.current) return
      displayedRef.current = target
      setDisplayedContent(target)
    })
    return stop
  }, [content, enabled, stop])

  return displayedContent
}

// ─── Main Renderer ──────────────────────────────────────────────

export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  className = '',
  isStreaming = false,
  variant = 'default',
}: MarkdownRendererProps) {
  const isReasoning = variant === 'reasoning'
  const projectionKey = useId()
  const renderHtmlImmediately = isStreaming && STREAMING_HTML_CONTENT_PATTERN.test(content)
  const smoothedContent = useSmoothMarkdownStream(content, isStreaming && !renderHtmlImmediately)
  const renderedContent = renderHtmlImmediately ? content : isStreaming ? smoothedContent : content
  const streamBlocks = useMemo(() => {
    const projection = projectMarkdownStream(markdownProjectionCache.get(projectionKey), renderedContent, isStreaming)
    markdownProjectionCache.set(projectionKey, projection)
    return projection.blocks
  }, [projectionKey, renderedContent, isStreaming])

  useEffect(() => {
    return () => {
      markdownProjectionCache.delete(projectionKey)
    }
  }, [projectionKey])

  return (
    <div
      className={`markdown-content ${isReasoning ? 'text-[length:var(--fs-sm)] leading-5 text-text-400' : 'text-[length:var(--fs-base)] leading-relaxed text-text-100'} break-words min-w-0 overflow-hidden ${className}`}
    >
      {streamBlocks.map(block => (
        <MarkdownStreamBlock
          key={block.key}
          src={block.src}
          mode={block.mode}
          language={block.language}
          complete={block.complete}
          isReasoning={isReasoning}
          isStreaming={
            isStreaming && (block.mode === 'live' || (block.mode === 'code' && !block.complete))
          }
        />
      ))}
    </div>
  )
})

// ─── Standalone Code Highlighter ────────────────────────────────

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
    <div data-scrollable className={`overflow-auto ${className}`} style={maxHeight ? { maxHeight } : undefined}>
      <CodeBlock code={code} language={lang} />
    </div>
  )
})

export default MarkdownRenderer
