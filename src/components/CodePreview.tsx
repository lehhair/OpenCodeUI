import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSyntaxHighlightRef, type HighlightTokens } from '../hooks/useSyntaxHighlight'

const LINE_HEIGHT = 20
const OVERSCAN = 5
const MAX_LINE_LENGTH = 5000

interface CodePreviewProps {
  code: string
  language: string
  truncateLines?: boolean
  maxHeight?: number
  isResizing?: boolean
}

/**
 * CodePreview - 代码预览组件
 *
 * 架构（和 SplitDiffView 一致）：
 *   外层容器 (overflow-y: auto, overflow-x: hidden) — 垂直滚动唯一来源
 *     高度占位 (height: totalHeight, relative) — 虚拟滚动
 *       absolute div (translateY: offsetY) — 可见行
 *         flex row
 *           gutter (shrink-0, overflow: hidden) — 行号，不水平滚动
 *           content (flex-1, overflow-x: auto, scrollbar-none) — 代码，独立水平滚动
 *             inline-block min-w-full — 被最宽行撑开
 *     sticky proxy scrollbar (bottom: 0) — 可见的横向滚动条
 */
export function CodePreview({ code, language, truncateLines = true, maxHeight, isResizing = false }: CodePreviewProps) {
  const lines = useMemo(() => {
    const raw = code.split('\n')
    if (raw.length > 1 && raw[raw.length - 1] === '' && code.endsWith('\n')) {
      raw.pop()
    }
    return raw
  }, [code])
  const totalHeight = lines.length * LINE_HEIGHT
  // 行号栏宽度：根据总行数的位数动态计算，用 ch 单位
  const gutterCh = Math.max(2, String(lines.length).length)
  // gutter 总宽度 = pl-4(16px) + 数字(gutterCh ch) + pr-3(12px)
  const gutterWidth = `calc(${gutterCh}ch + 1.75rem)`

  // tokens 存在 ref 里，不经过 React state/props
  const enableHighlight = language !== 'text'
  const { tokensRef, version } = useSyntaxHighlightRef(code, {
    lang: language,
    enabled: enableHighlight,
  })

  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const scrollbarRef = useRef<HTMLDivElement>(null)
  const scrollSourceRef = useRef<'content' | 'scrollbar' | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [containerHeight, setContainerHeight] = useState(0)
  const [contentWidth, setContentWidth] = useState(0)
  const [contentClientWidth, setContentClientWidth] = useState(0)

  const { startIndex, endIndex, offsetY } = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / LINE_HEIGHT) - OVERSCAN)
    const visibleCount = Math.ceil(containerHeight / LINE_HEIGHT)
    const end = Math.min(lines.length, start + visibleCount + OVERSCAN * 2)
    return {
      startIndex: start,
      endIndex: end,
      offsetY: start * LINE_HEIGHT,
    }
  }, [scrollTop, containerHeight, lines.length])

  // 监听外层容器大小
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    if (isResizing) return

    let rafId: number | null = null
    const updateHeight = () => {
      if (rafId) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        setContainerHeight(container.clientHeight)
      })
    }

    setContainerHeight(container.clientHeight)

    const resizeObserver = new ResizeObserver(updateHeight)
    resizeObserver.observe(container)

    return () => {
      if (rafId) cancelAnimationFrame(rafId)
      resizeObserver.disconnect()
    }
  }, [isResizing])

  // 测量 content 宽度（scrollWidth vs clientWidth，判断是否需要横向滚动条）
  useEffect(() => {
    const content = contentRef.current
    if (!content) return

    const measure = () => {
      const inner = content.firstElementChild as HTMLElement
      if (inner) setContentWidth(inner.scrollWidth)
      setContentClientWidth(content.clientWidth)
    }

    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(content)
    const mo = new MutationObserver(measure)
    mo.observe(content, { childList: true, subtree: true })
    return () => {
      ro.disconnect()
      mo.disconnect()
    }
  }, [startIndex, endIndex])

  // 外层垂直滚动
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop)
  }, [])

  // proxy scrollbar ↔ content 面板水平同步（带 guard 防循环触发）
  const handleScrollbar = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (scrollSourceRef.current === 'content') return
    scrollSourceRef.current = 'scrollbar'
    if (contentRef.current) contentRef.current.scrollLeft = e.currentTarget.scrollLeft
    requestAnimationFrame(() => {
      scrollSourceRef.current = null
    })
  }, [])
  const handleContentScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (scrollSourceRef.current === 'scrollbar') return
    scrollSourceRef.current = 'content'
    if (scrollbarRef.current) scrollbarRef.current.scrollLeft = e.currentTarget.scrollLeft
    requestAnimationFrame(() => {
      scrollSourceRef.current = null
    })
  }, [])

  // 渲染可见行：分别生成 gutter 和 content
  const { gutterRows, contentRows } = useMemo(() => {
    void version
    const tokens = tokensRef.current
    const gutters: React.ReactNode[] = []
    const contents: React.ReactNode[] = []

    for (let i = startIndex; i < endIndex; i++) {
      const rawLine = lines[i] || ' '
      const lineTokens = tokens?.[i]

      let displayContent: React.ReactNode
      let isTruncated = false

      if (lineTokens && lineTokens.length > 0) {
        if (truncateLines) {
          const { elements, truncated } = renderTokensTruncated(lineTokens)
          isTruncated = truncated
          displayContent = <span className="whitespace-pre">{elements}</span>
        } else {
          displayContent = (
            <span className="whitespace-pre">
              {lineTokens.map((token, j) => (
                <span key={j} style={token.color ? { color: token.color } : undefined}>
                  {token.content}
                </span>
              ))}
            </span>
          )
        }
      } else {
        if (truncateLines && rawLine.length > MAX_LINE_LENGTH) {
          isTruncated = true
          displayContent = <span className="text-text-200 whitespace-pre">{rawLine.slice(0, MAX_LINE_LENGTH)}</span>
        } else {
          displayContent = <span className="text-text-200 whitespace-pre">{rawLine}</span>
        }
      }

      gutters.push(
        <div
          key={i}
          className="text-text-500 text-right pr-3 pl-4 leading-5 select-none"
          style={{ height: LINE_HEIGHT }}
        >
          {i + 1}
        </div>,
      )

      contents.push(
        <div key={i} className="leading-5 pl-3 pr-4 whitespace-pre" style={{ height: LINE_HEIGHT }}>
          {displayContent}
          {isTruncated && <span className="text-text-500 ml-1">… (truncated)</span>}
        </div>,
      )
    }

    return { gutterRows: gutters, contentRows: contents }
  }, [startIndex, endIndex, lines, version, tokensRef, truncateLines])

  return (
    <div
      ref={containerRef}
      className="overflow-y-auto overflow-x-hidden code-scrollbar h-full font-mono text-[11px] leading-relaxed"
      onScroll={handleScroll}
      style={maxHeight !== undefined ? { maxHeight } : undefined}
    >
      {/* 虚拟滚动高度占位 */}
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div className="absolute top-0 left-0 right-0 flex" style={{ transform: `translateY(${offsetY}px)` }}>
          {/* Gutter: 固定宽度，不水平滚动，跟外层一起垂直滚动 */}
          <div className="shrink-0 overflow-hidden" style={{ width: gutterWidth }}>
            {gutterRows}
          </div>

          {/* Content: 独立水平滚动，隐藏自身滚动条，由 proxy 控制 */}
          <div
            ref={contentRef}
            className="flex-1 min-w-0 overflow-x-auto scrollbar-none"
            onScroll={handleContentScroll}
          >
            <div className="inline-block min-w-full">{contentRows}</div>
          </div>
        </div>
      </div>

      {/* Sticky proxy 横向滚动条 — 只在内容实际溢出时显示 */}
      {contentWidth > contentClientWidth && (
        <div className="sticky bottom-0 z-10 flex backdrop-blur-sm">
          {/* gutter 占位 */}
          <div className="shrink-0" style={{ width: gutterWidth }} />
          <div ref={scrollbarRef} className="flex-1 min-w-0 overflow-x-auto code-scrollbar" onScroll={handleScrollbar}>
            <div style={{ width: contentWidth, height: 1 }} />
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================
// Token 截断渲染
// ============================================

type HighlightToken = HighlightTokens[number][number]

function renderTokensTruncated(lineTokens: HighlightToken[]): {
  elements: React.ReactNode[]
  truncated: boolean
} {
  const elements: React.ReactNode[] = []
  let charCount = 0
  let truncated = false

  for (let j = 0; j < lineTokens.length; j++) {
    const token = lineTokens[j]
    const remaining = MAX_LINE_LENGTH - charCount

    if (remaining <= 0) {
      truncated = true
      break
    }

    if (token.content.length > remaining) {
      elements.push(
        <span key={j} style={token.color ? { color: token.color } : undefined}>
          {token.content.slice(0, remaining)}
        </span>,
      )
      truncated = true
      break
    }

    elements.push(
      <span key={j} style={token.color ? { color: token.color } : undefined}>
        {token.content}
      </span>,
    )
    charCount += token.content.length
  }

  return { elements, truncated }
}
