/**
 * DiffViewer - 核心 Diff 渲染组件
 *
 * 两列架构（和 CodePreview 一致）：
 * - Gutter 列：行号 + 增删标记，固定不水平滚动
 * - Content 列：代码内容，独立水平滚动
 *
 * 始终使用虚拟滚动，填满父容器（h-full）
 * 大文件跳过词级别diff和语法高亮
 */

import { memo, useMemo, useRef, useState, useEffect, useCallback } from 'react'
import { diffLines, diffWords } from 'diff'
import { useSyntaxHighlight, type HighlightTokens } from '../hooks/useSyntaxHighlight'

// ============================================
// 常量
// ============================================

const LINE_HEIGHT = 20 // 和 CodePreview 保持一致
const OVERSCAN = 5

// 大文件阈值 - 超过则跳过词级别diff
const LARGE_FILE_LINES = 2000
const LARGE_FILE_CHARS = 300000

// ============================================
// Types
// ============================================

export type ViewMode = 'split' | 'unified'

export interface DiffViewerProps {
  before: string
  after: string
  language?: string
  viewMode?: ViewMode
  /** 不传则填满父容器 */
  maxHeight?: number
  isResizing?: boolean
}

export type LineType = 'add' | 'delete' | 'context' | 'empty'

interface DiffLine {
  type: LineType
  content: string
  lineNo?: number
  highlightedContent?: string
}

interface PairedLine {
  left: DiffLine
  right: DiffLine
}

interface UnifiedLine extends DiffLine {
  oldLineNo?: number
  newLineNo?: number
}

// ============================================
// Helpers
// ============================================

function getLineBgClass(type: LineType): string {
  switch (type) {
    case 'add':
      return 'bg-success-bg/40'
    case 'delete':
      return 'bg-danger-bg/40'
    case 'empty':
      return 'bg-bg-100/30'
    default:
      return ''
  }
}

function getGutterBgClass(type: LineType): string {
  switch (type) {
    case 'add':
      return 'bg-success-bg/40'
    case 'delete':
      return 'bg-danger-bg/40'
    case 'empty':
      return 'bg-bg-100/30'
    default:
      return 'bg-bg-100'
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ============================================
// Main Component
// ============================================

export const DiffViewer = memo(function DiffViewer({
  before,
  after,
  language = 'text',
  viewMode = 'split',
  maxHeight,
  isResizing = false,
}: DiffViewerProps) {
  // 检测大文件
  const totalLines = before.split('\n').length + after.split('\n').length
  const isLargeFile = totalLines > LARGE_FILE_LINES || before.length + after.length > LARGE_FILE_CHARS

  if (viewMode === 'split') {
    return (
      <SplitDiffView
        before={before}
        after={after}
        language={language}
        isResizing={isResizing}
        isLargeFile={isLargeFile}
        maxHeight={maxHeight}
      />
    )
  }
  return (
    <UnifiedDiffView before={before} after={after} language={language} isResizing={isResizing} maxHeight={maxHeight} />
  )
})

// ============================================
// Split Diff View - 两列架构
//
// 结构:
//   外层容器 (overflow-y: auto) — 垂直滚动主控
//     flex 行
//       左面板 (flex-1, flex row)
//         左 gutter (shrink-0, overflow: hidden)
//         左 content (flex-1, overflow-x: auto scrollbar-none)
//       分隔线
//       右面板 (flex-1, flex row)
//         右 gutter (shrink-0, overflow: hidden)
//         右 content (flex-1, overflow-x: auto scrollbar-none)
//     sticky proxy scrollbar 底部
// ============================================

const SplitDiffView = memo(function SplitDiffView({
  before,
  after,
  language,
  isResizing,
  isLargeFile,
  maxHeight,
}: {
  before: string
  after: string
  language: string
  isResizing: boolean
  isLargeFile: boolean
  maxHeight?: number
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const leftContentRef = useRef<HTMLDivElement>(null)
  const rightContentRef = useRef<HTMLDivElement>(null)
  const leftScrollbarRef = useRef<HTMLDivElement>(null)
  const rightScrollbarRef = useRef<HTMLDivElement>(null)
  const leftScrollSourceRef = useRef<'content' | 'scrollbar' | null>(null)
  const rightScrollSourceRef = useRef<'content' | 'scrollbar' | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [containerHeight, setContainerHeight] = useState(300)
  const [leftContentWidth, setLeftContentWidth] = useState(0)
  const [rightContentWidth, setRightContentWidth] = useState(0)
  const [leftClientWidth, setLeftClientWidth] = useState(0)
  const [rightClientWidth, setRightClientWidth] = useState(0)

  const shouldHighlight = !isResizing && language !== 'text'
  const { output: beforeTokens } = useSyntaxHighlight(before, {
    lang: language,
    mode: 'tokens',
    enabled: shouldHighlight,
  })
  const { output: afterTokens } = useSyntaxHighlight(after, {
    lang: language,
    mode: 'tokens',
    enabled: shouldHighlight,
  })

  const skipWordDiff = isResizing || isLargeFile
  const pairedLines = useMemo(() => computePairedLines(before, after, skipWordDiff), [before, after, skipWordDiff])

  const totalHeight = pairedLines.length * LINE_HEIGHT

  const { startIndex, endIndex, offsetY } = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / LINE_HEIGHT) - OVERSCAN)
    const visibleCount = Math.ceil(containerHeight / LINE_HEIGHT)
    const end = Math.min(pairedLines.length, start + visibleCount + OVERSCAN * 2)
    return { startIndex: start, endIndex: end, offsetY: start * LINE_HEIGHT }
  }, [scrollTop, containerHeight, pairedLines.length])

  // 监听容器大小
  useEffect(() => {
    const container = containerRef.current
    if (!container || isResizing) return

    setContainerHeight(container.clientHeight)
    const resizeObserver = new ResizeObserver(() => setContainerHeight(container.clientHeight))
    resizeObserver.observe(container)
    return () => resizeObserver.disconnect()
  }, [isResizing])

  // 测量 content 宽度（scrollWidth vs clientWidth）
  useEffect(() => {
    const leftContent = leftContentRef.current
    const rightContent = rightContentRef.current
    if (!leftContent || !rightContent) return

    const measure = () => {
      const leftInner = leftContent.firstElementChild as HTMLElement
      const rightInner = rightContent.firstElementChild as HTMLElement
      if (leftInner) setLeftContentWidth(leftInner.scrollWidth)
      if (rightInner) setRightContentWidth(rightInner.scrollWidth)
      setLeftClientWidth(leftContent.clientWidth)
      setRightClientWidth(rightContent.clientWidth)
    }

    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(leftContent)
    ro.observe(rightContent)
    const mo = new MutationObserver(measure)
    mo.observe(leftContent, { childList: true, subtree: true })
    mo.observe(rightContent, { childList: true, subtree: true })
    return () => {
      ro.disconnect()
      mo.disconnect()
    }
  }, [pairedLines, startIndex, endIndex])

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop)
  }, [])

  // 同步 proxy 滚动条 <-> content 面板（带 guard 防循环）
  const handleLeftScrollbar = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (leftScrollSourceRef.current === 'content') return
    leftScrollSourceRef.current = 'scrollbar'
    if (leftContentRef.current) leftContentRef.current.scrollLeft = e.currentTarget.scrollLeft
    requestAnimationFrame(() => {
      leftScrollSourceRef.current = null
    })
  }, [])
  const handleRightScrollbar = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (rightScrollSourceRef.current === 'content') return
    rightScrollSourceRef.current = 'scrollbar'
    if (rightContentRef.current) rightContentRef.current.scrollLeft = e.currentTarget.scrollLeft
    requestAnimationFrame(() => {
      rightScrollSourceRef.current = null
    })
  }, [])
  const handleLeftContentScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (leftScrollSourceRef.current === 'scrollbar') return
    leftScrollSourceRef.current = 'content'
    if (leftScrollbarRef.current) leftScrollbarRef.current.scrollLeft = e.currentTarget.scrollLeft
    requestAnimationFrame(() => {
      leftScrollSourceRef.current = null
    })
  }, [])
  const handleRightContentScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (rightScrollSourceRef.current === 'scrollbar') return
    rightScrollSourceRef.current = 'content'
    if (rightScrollbarRef.current) rightScrollbarRef.current.scrollLeft = e.currentTarget.scrollLeft
    requestAnimationFrame(() => {
      rightScrollSourceRef.current = null
    })
  }, [])

  if (pairedLines.length === 0) {
    return <div className="h-full flex items-center justify-center text-text-400 text-sm">No changes</div>
  }

  // 渲染可见行 — 分别生成 gutter 和 content
  const leftGutterRows: React.ReactNode[] = []
  const leftContentRows: React.ReactNode[] = []
  const rightGutterRows: React.ReactNode[] = []
  const rightContentRows: React.ReactNode[] = []

  for (let i = startIndex; i < endIndex; i++) {
    const pair = pairedLines[i]

    // Left gutter: 行号 + 删除标记
    leftGutterRows.push(
      <div key={i} className={`flex ${getGutterBgClass(pair.left.type)}`} style={{ height: LINE_HEIGHT }}>
        <div className="w-8 shrink-0 px-1 text-right text-text-500 text-[11px] leading-5 select-none opacity-60">
          {pair.left.lineNo}
        </div>
        <div className="w-5 shrink-0 text-center text-[11px] leading-5 select-none">
          {pair.left.type === 'delete' && <span className="text-danger-100">−</span>}
        </div>
      </div>,
    )

    // Left content: 代码
    leftContentRows.push(
      <div
        key={i}
        className={`pr-2 leading-5 text-[11px] whitespace-pre ${getLineBgClass(pair.left.type)}`}
        style={{ height: LINE_HEIGHT }}
      >
        {pair.left.type !== 'empty' && <LineContent line={pair.left} tokens={beforeTokens} />}
      </div>,
    )

    // Right gutter
    rightGutterRows.push(
      <div key={i} className={`flex ${getGutterBgClass(pair.right.type)}`} style={{ height: LINE_HEIGHT }}>
        <div className="w-8 shrink-0 px-1 text-right text-text-500 text-[11px] leading-5 select-none opacity-60">
          {pair.right.lineNo}
        </div>
        <div className="w-5 shrink-0 text-center text-[11px] leading-5 select-none">
          {pair.right.type === 'add' && <span className="text-success-100">+</span>}
        </div>
      </div>,
    )

    // Right content
    rightContentRows.push(
      <div
        key={i}
        className={`pr-2 leading-5 text-[11px] whitespace-pre ${getLineBgClass(pair.right.type)}`}
        style={{ height: LINE_HEIGHT }}
      >
        {pair.right.type !== 'empty' && <LineContent line={pair.right} tokens={afterTokens} />}
      </div>,
    )
  }
  return (
    <div
      ref={containerRef}
      className="overflow-y-auto overflow-x-hidden custom-scrollbar font-mono h-full"
      style={maxHeight !== undefined ? { maxHeight } : undefined}
      onScroll={handleScroll}
    >
      {/* 虚拟滚动高度占位 */}
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div className="absolute top-0 left-0 right-0 flex" style={{ transform: `translateY(${offsetY}px)` }}>
          {/* 左面板 */}
          <div className="flex-1 flex min-w-0 border-r border-border-100/30">
            {/* 左 gutter */}
            <div className="shrink-0 overflow-hidden" style={{ width: 52 /* 32+20 */ }}>
              {leftGutterRows}
            </div>
            {/* 左 content — 隐藏自身滚动条，由 proxy 控制 */}
            <div
              ref={leftContentRef}
              className="flex-1 min-w-0 overflow-x-auto scrollbar-none"
              onScroll={handleLeftContentScroll}
            >
              <div className="inline-block min-w-full">{leftContentRows}</div>
            </div>
          </div>

          {/* 右面板 */}
          <div className="flex-1 flex min-w-0">
            {/* 右 gutter */}
            <div className="shrink-0 overflow-hidden" style={{ width: 52 }}>
              {rightGutterRows}
            </div>
            {/* 右 content */}
            <div
              ref={rightContentRef}
              className="flex-1 min-w-0 overflow-x-auto scrollbar-none"
              onScroll={handleRightContentScroll}
            >
              <div className="inline-block min-w-full">{rightContentRows}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Sticky proxy 横向滚动条 — 只在内容实际溢出时显示 */}
      {(leftContentWidth > leftClientWidth || rightContentWidth > rightClientWidth) && (
        <div className="sticky bottom-0 z-10 flex backdrop-blur-sm">
          <div
            ref={leftScrollbarRef}
            className="flex-1 overflow-x-auto code-scrollbar border-r border-border-100/30"
            onScroll={handleLeftScrollbar}
          >
            <div style={{ width: leftContentWidth, height: 1 }} />
          </div>
          <div
            ref={rightScrollbarRef}
            className="flex-1 overflow-x-auto code-scrollbar"
            onScroll={handleRightScrollbar}
          >
            <div style={{ width: rightContentWidth, height: 1 }} />
          </div>
        </div>
      )}
    </div>
  )
})

// ============================================
// Unified Diff View — 和 SplitDiffView / CodePreview 一致的架构
//
// 结构:
//   外层容器 (overflow-y: auto, overflow-x: hidden) — 垂直滚动唯一来源
//     高度占位 (height: totalHeight, relative) — 虚拟滚动
//       absolute div (translateY: offsetY) — 可见行
//         flex row
//           gutter (shrink-0, overflow: hidden): oldLineNo | newLineNo | +/-
//           content (flex-1, overflow-x: auto, scrollbar-none): 代码
//             inline-block min-w-full — 被最宽行撑开
//     sticky proxy scrollbar (bottom: 0) — 可见的横向滚动条
// ============================================

const UnifiedDiffView = memo(function UnifiedDiffView({
  before,
  after,
  language,
  isResizing,
  maxHeight,
}: {
  before: string
  after: string
  language: string
  isResizing: boolean
  maxHeight?: number
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const scrollbarRef = useRef<HTMLDivElement>(null)
  const scrollSourceRef = useRef<'content' | 'scrollbar' | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [containerHeight, setContainerHeight] = useState(300)
  const [contentWidth, setContentWidth] = useState(0)
  const [contentClientWidth, setContentClientWidth] = useState(0)

  const shouldHighlight = !isResizing && language !== 'text'
  const { output: beforeTokens } = useSyntaxHighlight(before, {
    lang: language,
    mode: 'tokens',
    enabled: shouldHighlight,
  })
  const { output: afterTokens } = useSyntaxHighlight(after, {
    lang: language,
    mode: 'tokens',
    enabled: shouldHighlight,
  })

  const lines = useMemo(() => computeUnifiedLines(before, after), [before, after])

  const totalHeight = lines.length * LINE_HEIGHT

  const { startIndex, endIndex, offsetY } = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / LINE_HEIGHT) - OVERSCAN)
    const visibleCount = Math.ceil(containerHeight / LINE_HEIGHT)
    const end = Math.min(lines.length, start + visibleCount + OVERSCAN * 2)
    return { startIndex: start, endIndex: end, offsetY: start * LINE_HEIGHT }
  }, [scrollTop, containerHeight, lines.length])

  useEffect(() => {
    const container = containerRef.current
    if (!container || isResizing) return

    setContainerHeight(container.clientHeight)
    const resizeObserver = new ResizeObserver(() => setContainerHeight(container.clientHeight))
    resizeObserver.observe(container)
    return () => resizeObserver.disconnect()
  }, [isResizing])

  // 测量 content 宽度（scrollWidth vs clientWidth）
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

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop)
  }, [])

  // proxy scrollbar ↔ content 面板水平同步（带 guard 防循环）
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

  if (lines.length === 0) {
    return <div className="h-full flex items-center justify-center text-text-400 text-sm">No changes</div>
  }

  // gutter 宽度: oldLineNo(32px) + newLineNo(32px) + 标记(20px) = 84px
  const GUTTER_WIDTH = 84

  const gutterRows: React.ReactNode[] = []
  const contentRows: React.ReactNode[] = []

  for (let i = startIndex; i < endIndex; i++) {
    const line = lines[i]
    let tokens: HighlightTokens | null = null
    let lineNo: number | undefined
    if (line.type === 'delete' && line.oldLineNo) {
      tokens = beforeTokens
      lineNo = line.oldLineNo
    } else if ((line.type === 'add' || line.type === 'context') && line.newLineNo) {
      tokens = afterTokens
      lineNo = line.newLineNo
    }

    // Gutter 行: oldLineNo | newLineNo | +/-
    gutterRows.push(
      <div key={i} className={`flex ${getGutterBgClass(line.type)}`} style={{ height: LINE_HEIGHT }}>
        <div className="w-8 shrink-0 px-1 text-right text-text-500 text-[11px] leading-5 select-none opacity-60">
          {line.oldLineNo}
        </div>
        <div className="w-8 shrink-0 px-1 text-right text-text-500 text-[11px] leading-5 select-none opacity-60">
          {line.newLineNo}
        </div>
        <div className="w-5 shrink-0 text-center text-[11px] leading-5 select-none">
          {line.type === 'add' && <span className="text-success-100">+</span>}
          {line.type === 'delete' && <span className="text-danger-100">−</span>}
        </div>
      </div>,
    )

    // Content 行
    contentRows.push(
      <div
        key={i}
        className={`pr-2 pl-2 leading-5 text-[11px] whitespace-pre ${getLineBgClass(line.type)}`}
        style={{ height: LINE_HEIGHT }}
      >
        <LineContent line={{ ...line, lineNo }} tokens={tokens} />
      </div>,
    )
  }

  return (
    <div
      ref={containerRef}
      className="overflow-y-auto overflow-x-hidden custom-scrollbar font-mono h-full"
      style={maxHeight !== undefined ? { maxHeight } : undefined}
      onScroll={handleScroll}
    >
      {/* 虚拟滚动高度占位 */}
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div className="absolute top-0 left-0 right-0 flex" style={{ transform: `translateY(${offsetY}px)` }}>
          {/* Gutter: 固定宽度，不水平滚动 */}
          <div className="shrink-0 overflow-hidden" style={{ width: GUTTER_WIDTH }}>
            {gutterRows}
          </div>

          {/* Content: 独立水平滚动，隐藏自身滚动条 */}
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
          <div className="shrink-0" style={{ width: GUTTER_WIDTH }} />
          <div ref={scrollbarRef} className="flex-1 min-w-0 overflow-x-auto code-scrollbar" onScroll={handleScrollbar}>
            <div style={{ width: contentWidth, height: 1 }} />
          </div>
        </div>
      )}
    </div>
  )
})

// ============================================
// Line Content Renderer
// ============================================

type HighlightToken = HighlightTokens[number][number]
type WordDiffChange = ReturnType<typeof diffWords>[number]

const LineContent = memo(function LineContent({ line, tokens }: { line: DiffLine; tokens: HighlightTokens | null }) {
  // 词级别diff高亮
  if (line.highlightedContent) {
    return <span className="text-text-100" dangerouslySetInnerHTML={{ __html: line.highlightedContent }} />
  }

  // 语法高亮
  if (tokens && line.lineNo && tokens[line.lineNo - 1]) {
    const lineTokens = tokens[line.lineNo - 1]
    return (
      <>
        {lineTokens.map((token: HighlightToken, i: number) => (
          <span key={i} style={{ color: token.color }}>
            {token.content}
          </span>
        ))}
      </>
    )
  }

  // 纯文本
  return <span className="text-text-100">{line.content}</span>
})

// ============================================
// Diff Computation
// ============================================

function computePairedLines(before: string, after: string, skipWordDiff: boolean): PairedLine[] {
  const changes = diffLines(before, after)
  const result: PairedLine[] = []
  const beforeLines = before.split('\n')
  const afterLines = after.split('\n')

  let oldIdx = 0,
    newIdx = 0,
    i = 0

  while (i < changes.length) {
    const change = changes[i]
    const count = change.count || 0

    if (change.removed) {
      const next = changes[i + 1]
      if (next?.added) {
        const addCount = next.count || 0
        const maxCount = Math.max(count, addCount)

        for (let j = 0; j < maxCount; j++) {
          const oldLine = j < count ? beforeLines[oldIdx + j] : undefined
          const newLine = j < addCount ? afterLines[newIdx + j] : undefined

          let leftHighlight: string | undefined
          let rightHighlight: string | undefined

          if (!skipWordDiff && oldLine !== undefined && newLine !== undefined) {
            const wordDiff = computeWordDiff(oldLine, newLine)
            if (!isTooFragmented(wordDiff.changes)) {
              leftHighlight = wordDiff.left
              rightHighlight = wordDiff.right
            }
          }

          result.push({
            left:
              oldLine !== undefined
                ? { type: 'delete', content: oldLine, lineNo: oldIdx + j + 1, highlightedContent: leftHighlight }
                : { type: 'empty', content: '' },
            right:
              newLine !== undefined
                ? { type: 'add', content: newLine, lineNo: newIdx + j + 1, highlightedContent: rightHighlight }
                : { type: 'empty', content: '' },
          })
        }

        oldIdx += count
        newIdx += addCount
        i += 2
        continue
      }

      for (let j = 0; j < count; j++) {
        result.push({
          left: { type: 'delete', content: beforeLines[oldIdx + j] || '', lineNo: oldIdx + j + 1 },
          right: { type: 'empty', content: '' },
        })
      }
      oldIdx += count
    } else if (change.added) {
      for (let j = 0; j < count; j++) {
        result.push({
          left: { type: 'empty', content: '' },
          right: { type: 'add', content: afterLines[newIdx + j] || '', lineNo: newIdx + j + 1 },
        })
      }
      newIdx += count
    } else {
      for (let j = 0; j < count; j++) {
        result.push({
          left: { type: 'context', content: beforeLines[oldIdx + j] || '', lineNo: oldIdx + j + 1 },
          right: { type: 'context', content: afterLines[newIdx + j] || '', lineNo: newIdx + j + 1 },
        })
      }
      oldIdx += count
      newIdx += count
    }
    i++
  }

  return result
}

function computeUnifiedLines(before: string, after: string): UnifiedLine[] {
  const changes = diffLines(before, after)
  const result: UnifiedLine[] = []
  const beforeLines = before.split('\n')
  const afterLines = after.split('\n')

  let oldIdx = 0,
    newIdx = 0

  for (const change of changes) {
    const count = change.count || 0

    if (change.removed) {
      for (let j = 0; j < count; j++) {
        result.push({ type: 'delete', content: beforeLines[oldIdx + j] || '', oldLineNo: oldIdx + j + 1 })
      }
      oldIdx += count
    } else if (change.added) {
      for (let j = 0; j < count; j++) {
        result.push({ type: 'add', content: afterLines[newIdx + j] || '', newLineNo: newIdx + j + 1 })
      }
      newIdx += count
    } else {
      for (let j = 0; j < count; j++) {
        result.push({
          type: 'context',
          content: afterLines[newIdx + j] || '',
          oldLineNo: oldIdx + j + 1,
          newLineNo: newIdx + j + 1,
        })
      }
      oldIdx += count
      newIdx += count
    }
  }

  return result
}

function isTooFragmented(changes: WordDiffChange[]): boolean {
  let commonLength = 0,
    totalLength = 0
  for (const change of changes) {
    totalLength += change.value.length
    if (!change.added && !change.removed) commonLength += change.value.length
  }
  return totalLength > 10 && commonLength / totalLength < 0.4
}

function computeWordDiff(oldLine: string, newLine: string): { left: string; right: string; changes: WordDiffChange[] } {
  const changes = diffWords(oldLine, newLine)

  const mergedChanges: WordDiffChange[] = []
  for (let i = 0; i < changes.length; i++) {
    const current = changes[i]
    const prev = mergedChanges[mergedChanges.length - 1]

    if (prev && !current.added && !current.removed && /^\s*$/.test(current.value)) {
      const next = changes[i + 1]
      if ((prev.removed && next?.removed) || (prev.added && next?.added)) {
        prev.value += current.value
        continue
      }
    }

    if (prev && ((prev.added && current.added) || (prev.removed && current.removed))) {
      prev.value += current.value
    } else {
      mergedChanges.push({ ...current })
    }
  }

  let left = '',
    right = ''
  for (const change of mergedChanges) {
    const escaped = escapeHtml(change.value)
    if (change.removed) left += `<span class="bg-danger-100/30">${escaped}</span>`
    else if (change.added) right += `<span class="bg-success-100/30">${escaped}</span>`
    else {
      left += escaped
      right += escaped
    }
  }

  return { left, right, changes: mergedChanges }
}
