/**
 * DiffViewer - 核心 Diff 渲染组件
 *
 * 两列架构（和 CodePreview 一致）：
 * - Gutter 列：change bar（3px 竖条，增绿删红）+ 行号，固定不水平滚动
 * - Content 列：代码内容，独立水平滚动
 *
 * 默认使用虚拟滚动；启用自动换行后切到 wrapped 渲染
 * 不再按文件大小、行数、字符数降级高亮或 diff
 */

import { memo, useMemo, useRef, useState, useEffect, useCallback, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { diffLines, diffWords } from 'diff'
import { useSyntaxHighlight, type HighlightTokens } from '../hooks/useSyntaxHighlight'
import { useDynamicVirtualScroll } from '../hooks/useDynamicVirtualScroll'
import { themeStore } from '../store/themeStore'
import type { DiffStyle } from '../store/themeStore'

// ============================================
// 常量
// ============================================

/** codeFontScale 偏移 → 代码行高 (px)。基准 24px，每 1px 字号偏移对应 2px 行高增量 */
function codeLineHeight(offset: number): number {
  return 24 + offset * 2
}
const OVERSCAN = 5

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
  wordWrap?: boolean
}

export type LineType = 'add' | 'delete' | 'context' | 'empty'

interface DiffLine {
  type: LineType
  content: string
  lineNo?: number
  /** 词级别 diff 标记（结构化），与 syntax token 共存 */
  wordDiffSegments?: WordDiffSegment[]
}

/** 词级别 diff 的单个片段 */
interface WordDiffSegment {
  text: string
  /** 'add' | 'delete' 表示增删标记，undefined 表示无变化 */
  diffType?: 'add' | 'delete'
}

interface PairedLine {
  left: DiffLine
  right: DiffLine
}

/** 折叠的 context 行占位 */
interface CollapsedPairedLine {
  collapsed: true
  count: number
  /** 在原始 lines 数组中的起始索引，用于展开 */
  id: number
}

type PairedLineOrCollapsed = PairedLine | CollapsedPairedLine

interface UnifiedLine extends DiffLine {
  oldLineNo?: number
  newLineNo?: number
}

interface CollapsedUnifiedLine {
  collapsed: true
  count: number
  id: number
}

type UnifiedLineOrCollapsed = UnifiedLine | CollapsedUnifiedLine

function isCollapsed(
  line: PairedLineOrCollapsed | UnifiedLineOrCollapsed,
): line is CollapsedPairedLine | CollapsedUnifiedLine {
  return 'collapsed' in line && line.collapsed === true
}

/** 上下文行保留数：变更前后各保留 CONTEXT_LINES 行 */
const CONTEXT_LINES = 3

/** 将连续 context 行折叠，只保留变更前后各 CONTEXT_LINES 行 */
function collapseContextPaired(lines: PairedLine[], expandedIds?: ReadonlySet<number>): PairedLineOrCollapsed[] {
  if (lines.length === 0) return []

  const result: PairedLineOrCollapsed[] = []
  let contextStart = -1

  for (let i = 0; i <= lines.length; i++) {
    const isCtx = i < lines.length && lines[i].left.type === 'context' && lines[i].right.type === 'context'

    if (isCtx) {
      if (contextStart === -1) contextStart = i
    } else {
      if (contextStart !== -1) {
        const ctxLen = i - contextStart
        const minToCollapse = CONTEXT_LINES * 2 + 2
        if (ctxLen > minToCollapse && !expandedIds?.has(contextStart)) {
          for (let j = contextStart; j < contextStart + CONTEXT_LINES; j++) result.push(lines[j])
          result.push({ collapsed: true, count: ctxLen - CONTEXT_LINES * 2, id: contextStart })
          for (let j = i - CONTEXT_LINES; j < i; j++) result.push(lines[j])
        } else {
          for (let j = contextStart; j < i; j++) result.push(lines[j])
        }
        contextStart = -1
      }
      if (i < lines.length) result.push(lines[i])
    }
  }

  return result
}

function collapseContextUnified(lines: UnifiedLine[], expandedIds?: ReadonlySet<number>): UnifiedLineOrCollapsed[] {
  if (lines.length === 0) return []

  const result: UnifiedLineOrCollapsed[] = []
  let contextStart = -1

  for (let i = 0; i <= lines.length; i++) {
    const isCtx = i < lines.length && lines[i].type === 'context'

    if (isCtx) {
      if (contextStart === -1) contextStart = i
    } else {
      if (contextStart !== -1) {
        const ctxLen = i - contextStart
        const minToCollapse = CONTEXT_LINES * 2 + 2
        if (ctxLen > minToCollapse && !expandedIds?.has(contextStart)) {
          for (let j = contextStart; j < contextStart + CONTEXT_LINES; j++) result.push(lines[j])
          result.push({ collapsed: true, count: ctxLen - CONTEXT_LINES * 2, id: contextStart })
          for (let j = i - CONTEXT_LINES; j < i; j++) result.push(lines[j])
        } else {
          for (let j = contextStart; j < i; j++) result.push(lines[j])
        }
        contextStart = -1
      }
      if (i < lines.length) result.push(lines[i])
    }
  }

  return result
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
      return ''
  }
}

/** Change bar 样式 — 行号左侧的 3px 竖条，add 实心 / delete 虚线 */
function getChangeBarProps(type: LineType): { className: string; style?: React.CSSProperties } {
  switch (type) {
    case 'add':
      return { className: 'w-[3px] shrink-0 bg-success-100' }
    case 'delete':
      return {
        className: 'w-[3px] shrink-0',
        style: {
          background:
            'repeating-linear-gradient(to bottom, var(--color-danger-100) 0px, var(--color-danger-100) 2px, transparent 2px, transparent 4px)',
        },
      }
    default:
      return { className: 'w-[3px] shrink-0' }
  }
}

/** 折叠占位条 — "N lines unchanged"，点击可展开 */
function CollapsedBar({
  count,
  t,
  onExpand,
  height = 24,
}: {
  count: number
  t: (key: string, opts?: Record<string, unknown>) => string
  onExpand?: () => void
  height?: number
}) {
  return (
    <div
      className="box-border flex items-center justify-center text-[length:var(--fs-code)] text-text-500 select-none bg-bg-200/40 border-y border-border-100/30 cursor-pointer hover:bg-bg-200/60 transition-colors"
      style={{ height }}
      onClick={onExpand}
    >
      <span className="px-3 py-0.5 rounded bg-bg-300/50 text-text-400 font-mono">
        {t('diffViewer.linesUnchanged', { count })}
      </span>
    </div>
  )
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
  wordWrap,
}: DiffViewerProps) {
  const { diffStyle, codeWordWrap, codeFontScale } = useSyncExternalStore(themeStore.subscribe, themeStore.getSnapshot)
  const resolvedWordWrap = wordWrap ?? codeWordWrap
  const lineHeight = codeLineHeight(codeFontScale)

  // 纯增加或纯删除时，split 模式另一边是空的没意义，自动降级为 unified
  const isAddOnly = !before.trim()
  const isDeleteOnly = !after.trim()
  const effectiveViewMode = isAddOnly || isDeleteOnly ? 'unified' : viewMode

  if (effectiveViewMode === 'split') {
    if (resolvedWordWrap) {
      return (
        <WrappedSplitDiffView
          before={before}
          after={after}
          language={language}
          isResizing={isResizing}
          maxHeight={maxHeight}
          diffStyle={diffStyle}
          lineHeight={lineHeight}
        />
      )
    }

    return (
      <SplitDiffView
        before={before}
        after={after}
        language={language}
        isResizing={isResizing}
        maxHeight={maxHeight}
        diffStyle={diffStyle}
        lineHeight={lineHeight}
      />
    )
  }

  if (resolvedWordWrap) {
    return (
      <WrappedUnifiedDiffView
        before={before}
        after={after}
        language={language}
        isResizing={isResizing}
        maxHeight={maxHeight}
        diffStyle={diffStyle}
        lineHeight={lineHeight}
      />
    )
  }

  return (
    <UnifiedDiffView
      before={before}
      after={after}
      language={language}
      isResizing={isResizing}
      maxHeight={maxHeight}
      diffStyle={diffStyle}
      lineHeight={lineHeight}
    />
  )
})

const WrappedSplitDiffView = memo(function WrappedSplitDiffView({
  before,
  after,
  language,
  isResizing,
  maxHeight,
  diffStyle,
  lineHeight,
}: {
  before: string
  after: string
  language: string
  isResizing: boolean
  maxHeight?: number
  diffStyle: DiffStyle
  lineHeight: number
}) {
  const { t } = useTranslation(['components', 'common'])

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

  const skipWordDiff = isResizing
  const pairedLines = useMemo(() => computePairedLines(before, after, skipWordDiff), [before, after, skipWordDiff])
  const [expandedIds, setExpandedIds] = useState<Set<number>>(() => new Set())
  const displayLines = useMemo(() => collapseContextPaired(pairedLines, expandedIds), [pairedLines, expandedIds])
  const handleExpand = useCallback((id: number) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      next.add(id)
      return next
    })
  }, [])

  const { containerRef, totalHeight, startIndex, endIndex, offsetY, handleScroll, measureRef } =
    useDynamicVirtualScroll({ lineCount: displayLines.length, isResizing, estimateLineHeight: lineHeight })

  if (pairedLines.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-text-400 text-[length:var(--fs-base)]">
        {t('diffViewer.noChanges')}
      </div>
    )
  }

  const useChangeBars = diffStyle === 'changeBars'
  const gutterWidth = useChangeBars ? 35 : 52

  const visibleRows: React.ReactNode[] = []
  for (let i = startIndex; i < endIndex; i++) {
    const item = displayLines[i]

    if (isCollapsed(item)) {
      visibleRows.push(
        <div key={`c-${i}`} ref={el => measureRef(i, el)}>
          <CollapsedBar count={item.count} t={t} onExpand={() => handleExpand(item.id)} />
        </div>,
      )
      continue
    }

    const pair = item as PairedLine
    visibleRows.push(
      <div key={i} ref={el => measureRef(i, el)} className="flex items-stretch">
        {/* Left panel */}
        <div
          className={`flex-1 flex items-stretch min-w-0 border-r border-border-100/30 ${getLineBgClass(pair.left.type)}`}
        >
          <div className="shrink-0" style={{ width: gutterWidth }}>
            {useChangeBars ? (
              <div className="flex items-stretch h-full">
                <div {...getChangeBarProps(pair.left.type)} />
                <div className="w-8 shrink-0 px-1 text-right text-text-500 text-[length:var(--fs-code)] leading-[var(--fs-code-line-height)] select-none opacity-60">
                  {pair.left.lineNo}
                </div>
              </div>
            ) : (
              <div className="flex h-full">
                <div className="w-8 shrink-0 px-1 text-right text-text-500 text-[length:var(--fs-code)] leading-[var(--fs-code-line-height)] select-none opacity-60">
                  {pair.left.lineNo}
                </div>
                <div className="w-5 shrink-0 text-center text-[length:var(--fs-code)] leading-[var(--fs-code-line-height)] select-none">
                  {pair.left.type === 'delete' && <span className="text-danger-100">−</span>}
                </div>
              </div>
            )}
          </div>

          <div
            className="min-w-0 flex-1 px-2 leading-[var(--fs-code-line-height)] text-[length:var(--fs-code)] whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
            style={{ minHeight: lineHeight }}
          >
            {pair.left.type !== 'empty' && <LineContent line={pair.left} tokens={beforeTokens} />}
          </div>
        </div>

        {/* Right panel */}
        <div className={`flex-1 flex items-stretch min-w-0 ${getLineBgClass(pair.right.type)}`}>
          <div className="shrink-0" style={{ width: gutterWidth }}>
            {useChangeBars ? (
              <div className="flex items-stretch h-full">
                <div {...getChangeBarProps(pair.right.type)} />
                <div className="w-8 shrink-0 px-1 text-right text-text-500 text-[length:var(--fs-code)] leading-[var(--fs-code-line-height)] select-none opacity-60">
                  {pair.right.lineNo}
                </div>
              </div>
            ) : (
              <div className="flex h-full">
                <div className="w-8 shrink-0 px-1 text-right text-text-500 text-[length:var(--fs-code)] leading-[var(--fs-code-line-height)] select-none opacity-60">
                  {pair.right.lineNo}
                </div>
                <div className="w-5 shrink-0 text-center text-[length:var(--fs-code)] leading-[var(--fs-code-line-height)] select-none">
                  {pair.right.type === 'add' && <span className="text-success-100">+</span>}
                </div>
              </div>
            )}
          </div>

          <div
            className="min-w-0 flex-1 px-2 leading-[var(--fs-code-line-height)] text-[length:var(--fs-code)] whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
            style={{ minHeight: lineHeight }}
          >
            {pair.right.type !== 'empty' && <LineContent line={pair.right} tokens={afterTokens} />}
          </div>
        </div>
      </div>,
    )
  }

  return (
    <div
      ref={containerRef}
      className="overflow-y-auto overflow-x-hidden custom-scrollbar font-mono text-[length:var(--fs-code)] h-full"
      onScroll={handleScroll}
      style={maxHeight !== undefined ? { maxHeight } : undefined}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div className="absolute top-0 left-0 right-0" style={{ transform: `translateY(${offsetY}px)` }}>
          {visibleRows}
        </div>
      </div>
    </div>
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
  maxHeight,
  diffStyle,
  lineHeight,
}: {
  before: string
  after: string
  language: string
  isResizing: boolean
  maxHeight?: number
  diffStyle: DiffStyle
  lineHeight: number
}) {
  const { t } = useTranslation(['components', 'common'])
  const containerRef = useRef<HTMLDivElement>(null)
  const leftContentRef = useRef<HTMLDivElement>(null)
  const rightContentRef = useRef<HTMLDivElement>(null)
  const leftScrollbarRef = useRef<HTMLDivElement>(null)
  const rightScrollbarRef = useRef<HTMLDivElement>(null)
  const leftScrollSourceRef = useRef<'content' | 'scrollbar' | null>(null)
  const rightScrollSourceRef = useRef<'content' | 'scrollbar' | null>(null)
  const maxLeftScrollWidthRef = useRef(0)
  const maxRightScrollWidthRef = useRef(0)
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

  const skipWordDiff = isResizing
  const pairedLines = useMemo(() => computePairedLines(before, after, skipWordDiff), [before, after, skipWordDiff])
  const [expandedIds, setExpandedIds] = useState<Set<number>>(() => new Set())
  const displayLines = useMemo(() => collapseContextPaired(pairedLines, expandedIds), [pairedLines, expandedIds])
  const handleExpand = useCallback((id: number) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      next.add(id)
      return next
    })
  }, [])

  const totalHeight = displayLines.length * lineHeight

  const { startIndex, endIndex, offsetY } = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / lineHeight) - OVERSCAN)
    const visibleCount = Math.ceil(containerHeight / lineHeight)
    const end = Math.min(displayLines.length, start + visibleCount + OVERSCAN * 2)
    return { startIndex: start, endIndex: end, offsetY: start * lineHeight }
  }, [scrollTop, containerHeight, displayLines.length, lineHeight])

  // 监听容器大小
  useEffect(() => {
    const container = containerRef.current
    if (!container || isResizing) return

    setContainerHeight(container.clientHeight)
    const resizeObserver = new ResizeObserver(() => setContainerHeight(container.clientHeight))
    resizeObserver.observe(container)
    return () => resizeObserver.disconnect()
  }, [isResizing])

  // 测量 content 宽度 — 追踪可见行 scrollWidth 历史最大值
  useEffect(() => {
    const leftContent = leftContentRef.current
    const rightContent = rightContentRef.current
    if (!leftContent || !rightContent) return
    const leftInner = leftContent.firstElementChild as HTMLElement
    const rightInner = rightContent.firstElementChild as HTMLElement

    const measure = () => {
      if (leftInner) {
        const sw = leftInner.scrollWidth
        if (sw > maxLeftScrollWidthRef.current) {
          maxLeftScrollWidthRef.current = sw
          leftInner.style.minWidth = `${sw}px`
        }
        setLeftContentWidth(maxLeftScrollWidthRef.current)
      }
      if (rightInner) {
        const sw = rightInner.scrollWidth
        if (sw > maxRightScrollWidthRef.current) {
          maxRightScrollWidthRef.current = sw
          rightInner.style.minWidth = `${sw}px`
        }
        setRightContentWidth(maxRightScrollWidthRef.current)
      }
      setLeftClientWidth(leftContent.clientWidth)
      setRightClientWidth(rightContent.clientWidth)
    }

    measure()
    const ro = new ResizeObserver(() => {
      maxLeftScrollWidthRef.current = 0
      maxRightScrollWidthRef.current = 0
      if (leftInner) leftInner.style.minWidth = ''
      if (rightInner) rightInner.style.minWidth = ''
      measure()
    })
    ro.observe(leftContent)
    ro.observe(rightContent)
    const mo = new MutationObserver(measure)
    mo.observe(leftContent, { childList: true, subtree: true })
    mo.observe(rightContent, { childList: true, subtree: true })
    return () => {
      ro.disconnect()
      mo.disconnect()
    }
  }, [displayLines, startIndex, endIndex])

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
    return (
      <div className="h-full flex items-center justify-center text-text-400 text-[length:var(--fs-base)]">
        {t('diffViewer.noChanges')}
      </div>
    )
  }

  // 渲染可见行 — 分别生成 gutter 和 content
  const useChangeBars = diffStyle === 'changeBars'
  // markers: 行号(32) + 符号(20) = 52px;  changeBars: bar(3) + 行号(32) = 35px
  const gutterWidth = useChangeBars ? 35 : 52

  const leftGutterRows: React.ReactNode[] = []
  const leftContentRows: React.ReactNode[] = []
  const rightGutterRows: React.ReactNode[] = []
  const rightContentRows: React.ReactNode[] = []

  for (let i = startIndex; i < endIndex; i++) {
    const item = displayLines[i]

    if (isCollapsed(item)) {
      const barNode = (
        <CollapsedBar key={i} count={item.count} t={t} onExpand={() => handleExpand(item.id)} height={lineHeight} />
      )
      leftGutterRows.push(
        <div
          key={i}
          className="box-border bg-bg-200/40 border-y border-border-100/30"
          style={{ height: lineHeight }}
        />,
      )
      leftContentRows.push(barNode)
      rightGutterRows.push(
        <div
          key={i}
          className="box-border bg-bg-200/40 border-y border-border-100/30"
          style={{ height: lineHeight }}
        />,
      )
      rightContentRows.push(
        <div
          key={i}
          className="box-border bg-bg-200/40 border-y border-border-100/30"
          style={{ height: lineHeight }}
        />,
      )
      continue
    }

    const pair = item as PairedLine

    // Left gutter
    leftGutterRows.push(
      useChangeBars ? (
        <div
          key={i}
          className={`flex items-stretch ${getGutterBgClass(pair.left.type)}`}
          style={{ height: lineHeight }}
        >
          <div {...getChangeBarProps(pair.left.type)} />
          <div className="w-8 shrink-0 px-1 text-right text-text-500 text-[length:var(--fs-code)] leading-[var(--fs-code-line-height)] select-none opacity-60">
            {pair.left.lineNo}
          </div>
        </div>
      ) : (
        <div key={i} className={`flex ${getGutterBgClass(pair.left.type)}`} style={{ height: lineHeight }}>
          <div className="w-8 shrink-0 px-1 text-right text-text-500 text-[length:var(--fs-code)] leading-[var(--fs-code-line-height)] select-none opacity-60">
            {pair.left.lineNo}
          </div>
          <div className="w-5 shrink-0 text-center text-[length:var(--fs-code)] leading-[var(--fs-code-line-height)] select-none">
            {pair.left.type === 'delete' && <span className="text-danger-100">−</span>}
          </div>
        </div>
      ),
    )

    // Left content: 代码
    leftContentRows.push(
      <div
        key={i}
        className={`pr-2 leading-[var(--fs-code-line-height)] text-[length:var(--fs-code)] whitespace-pre ${getLineBgClass(pair.left.type)}`}
        style={{ height: lineHeight }}
      >
        {pair.left.type !== 'empty' && <LineContent line={pair.left} tokens={beforeTokens} />}
      </div>,
    )

    // Right gutter
    rightGutterRows.push(
      useChangeBars ? (
        <div
          key={i}
          className={`flex items-stretch ${getGutterBgClass(pair.right.type)}`}
          style={{ height: lineHeight }}
        >
          <div {...getChangeBarProps(pair.right.type)} />
          <div className="w-8 shrink-0 px-1 text-right text-text-500 text-[length:var(--fs-code)] leading-[var(--fs-code-line-height)] select-none opacity-60">
            {pair.right.lineNo}
          </div>
        </div>
      ) : (
        <div key={i} className={`flex ${getGutterBgClass(pair.right.type)}`} style={{ height: lineHeight }}>
          <div className="w-8 shrink-0 px-1 text-right text-text-500 text-[length:var(--fs-code)] leading-[var(--fs-code-line-height)] select-none opacity-60">
            {pair.right.lineNo}
          </div>
          <div className="w-5 shrink-0 text-center text-[length:var(--fs-code)] leading-[var(--fs-code-line-height)] select-none">
            {pair.right.type === 'add' && <span className="text-success-100">+</span>}
          </div>
        </div>
      ),
    )

    // Right content
    rightContentRows.push(
      <div
        key={i}
        className={`pr-2 leading-[var(--fs-code-line-height)] text-[length:var(--fs-code)] whitespace-pre ${getLineBgClass(pair.right.type)}`}
        style={{ height: lineHeight }}
      >
        {pair.right.type !== 'empty' && <LineContent line={pair.right} tokens={afterTokens} />}
      </div>,
    )
  }
  return (
    <div
      ref={containerRef}
      className="overflow-y-auto overflow-x-hidden custom-scrollbar font-mono text-[length:var(--fs-code)] h-full"
      style={maxHeight !== undefined ? { maxHeight } : undefined}
      onScroll={handleScroll}
    >
      {/* 虚拟滚动高度占位 */}
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div className="absolute top-0 left-0 right-0 flex" style={{ transform: `translateY(${offsetY}px)` }}>
          {/* 左面板 */}
          <div className="flex-1 flex min-w-0 border-r border-border-100/30">
            {/* 左 gutter */}
            <div className="shrink-0 overflow-hidden" style={{ width: gutterWidth }}>
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
            <div className="shrink-0 overflow-hidden" style={{ width: gutterWidth }}>
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
        <div className="sticky bottom-0 z-10 flex">
          {/* 左面板: gutter 占位 + scrollbar */}
          <div className="flex-1 flex min-w-0 border-r border-border-100/30">
            <div className="shrink-0" style={{ width: gutterWidth }} />
            <div
              ref={leftScrollbarRef}
              className="flex-1 min-w-0 overflow-x-auto code-scrollbar"
              onScroll={handleLeftScrollbar}
            >
              <div style={{ width: leftContentWidth, height: 1 }} />
            </div>
          </div>
          {/* 右面板: gutter 占位 + scrollbar */}
          <div className="flex-1 flex min-w-0">
            <div className="shrink-0" style={{ width: gutterWidth }} />
            <div
              ref={rightScrollbarRef}
              className="flex-1 min-w-0 overflow-x-auto code-scrollbar"
              onScroll={handleRightScrollbar}
            >
              <div style={{ width: rightContentWidth, height: 1 }} />
            </div>
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
//           gutter (shrink-0, overflow: hidden):
//             markers 模式: oldLineNo | newLineNo | +/-
//             changeBars 模式: changeBar | oldLineNo | newLineNo
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
  diffStyle,
  lineHeight,
}: {
  before: string
  after: string
  language: string
  isResizing: boolean
  maxHeight?: number
  diffStyle: DiffStyle
  lineHeight: number
}) {
  const { t } = useTranslation(['components', 'common'])
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const scrollbarRef = useRef<HTMLDivElement>(null)
  const scrollSourceRef = useRef<'content' | 'scrollbar' | null>(null)
  const maxScrollWidthRef = useRef(0)
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
  const [expandedIds, setExpandedIds] = useState<Set<number>>(() => new Set())
  const displayLines = useMemo(() => collapseContextUnified(lines, expandedIds), [lines, expandedIds])
  const handleExpand = useCallback((id: number) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      next.add(id)
      return next
    })
  }, [])

  const totalHeight = displayLines.length * lineHeight

  const { startIndex, endIndex, offsetY } = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / lineHeight) - OVERSCAN)
    const visibleCount = Math.ceil(containerHeight / lineHeight)
    const end = Math.min(displayLines.length, start + visibleCount + OVERSCAN * 2)
    return { startIndex: start, endIndex: end, offsetY: start * lineHeight }
  }, [scrollTop, containerHeight, displayLines.length, lineHeight])

  useEffect(() => {
    const container = containerRef.current
    if (!container || isResizing) return

    setContainerHeight(container.clientHeight)
    const resizeObserver = new ResizeObserver(() => setContainerHeight(container.clientHeight))
    resizeObserver.observe(container)
    return () => resizeObserver.disconnect()
  }, [isResizing])

  // 测量 content 宽度 — 追踪可见行 scrollWidth 历史最大值
  useEffect(() => {
    const content = contentRef.current
    if (!content) return
    const inner = content.firstElementChild as HTMLElement

    const measure = () => {
      if (inner) {
        const sw = inner.scrollWidth
        if (sw > maxScrollWidthRef.current) {
          maxScrollWidthRef.current = sw
          inner.style.minWidth = `${sw}px`
        }
        setContentWidth(maxScrollWidthRef.current)
      }
      setContentClientWidth(content.clientWidth)
    }

    measure()
    const ro = new ResizeObserver(() => {
      maxScrollWidthRef.current = 0
      if (inner) inner.style.minWidth = ''
      measure()
    })
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
    return (
      <div className="h-full flex items-center justify-center text-text-400 text-[length:var(--fs-base)]">
        {t('diffViewer.noChanges')}
      </div>
    )
  }

  // markers: oldLineNo(32) + newLineNo(32) + 符号(20) = 84px
  // changeBars: bar(3) + oldLineNo(32) + newLineNo(32) = 67px
  const useChangeBars = diffStyle === 'changeBars'
  const GUTTER_WIDTH = useChangeBars ? 67 : 84

  const gutterRows: React.ReactNode[] = []
  const contentRows: React.ReactNode[] = []

  for (let i = startIndex; i < endIndex; i++) {
    const item = displayLines[i]

    if (isCollapsed(item)) {
      gutterRows.push(
        <div
          key={i}
          className="box-border bg-bg-200/40 border-y border-border-100/30"
          style={{ height: lineHeight }}
        />,
      )
      contentRows.push(
        <CollapsedBar key={i} count={item.count} t={t} onExpand={() => handleExpand(item.id)} height={lineHeight} />,
      )
      continue
    }

    const line = item as UnifiedLine
    let tokens: HighlightTokens | null = null
    let lineNo: number | undefined
    if (line.type === 'delete' && line.oldLineNo) {
      tokens = beforeTokens
      lineNo = line.oldLineNo
    } else if ((line.type === 'add' || line.type === 'context') && line.newLineNo) {
      tokens = afterTokens
      lineNo = line.newLineNo
    }

    // Gutter 行
    gutterRows.push(
      useChangeBars ? (
        <div key={i} className={`flex items-stretch ${getGutterBgClass(line.type)}`} style={{ height: lineHeight }}>
          <div {...getChangeBarProps(line.type)} />
          <div className="w-8 shrink-0 px-1 text-right text-text-500 text-[length:var(--fs-code)] leading-[var(--fs-code-line-height)] select-none opacity-60">
            {line.oldLineNo}
          </div>
          <div className="w-8 shrink-0 px-1 text-right text-text-500 text-[length:var(--fs-code)] leading-[var(--fs-code-line-height)] select-none opacity-60">
            {line.newLineNo}
          </div>
        </div>
      ) : (
        <div key={i} className={`flex ${getGutterBgClass(line.type)}`} style={{ height: lineHeight }}>
          <div className="w-8 shrink-0 px-1 text-right text-text-500 text-[length:var(--fs-code)] leading-[var(--fs-code-line-height)] select-none opacity-60">
            {line.oldLineNo}
          </div>
          <div className="w-8 shrink-0 px-1 text-right text-text-500 text-[length:var(--fs-code)] leading-[var(--fs-code-line-height)] select-none opacity-60">
            {line.newLineNo}
          </div>
          <div className="w-5 shrink-0 text-center text-[length:var(--fs-code)] leading-[var(--fs-code-line-height)] select-none">
            {line.type === 'add' && <span className="text-success-100">+</span>}
            {line.type === 'delete' && <span className="text-danger-100">−</span>}
          </div>
        </div>
      ),
    )

    // Content 行
    contentRows.push(
      <div
        key={i}
        className={`pr-2 pl-2 leading-[var(--fs-code-line-height)] text-[length:var(--fs-code)] whitespace-pre ${getLineBgClass(line.type)}`}
        style={{ height: lineHeight }}
      >
        <LineContent line={{ ...line, lineNo }} tokens={tokens} />
      </div>,
    )
  }

  return (
    <div
      ref={containerRef}
      className="overflow-y-auto overflow-x-hidden custom-scrollbar font-mono text-[length:var(--fs-code)] h-full"
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
        <div className="sticky bottom-0 z-10 flex">
          <div className="shrink-0" style={{ width: GUTTER_WIDTH }} />
          <div ref={scrollbarRef} className="flex-1 min-w-0 overflow-x-auto code-scrollbar" onScroll={handleScrollbar}>
            <div style={{ width: contentWidth, height: 1 }} />
          </div>
        </div>
      )}
    </div>
  )
})

const WrappedUnifiedDiffView = memo(function WrappedUnifiedDiffView({
  before,
  after,
  language,
  isResizing,
  maxHeight,
  diffStyle,
  lineHeight,
}: {
  before: string
  after: string
  language: string
  isResizing: boolean
  maxHeight?: number
  diffStyle: DiffStyle
  lineHeight: number
}) {
  const { t } = useTranslation(['components', 'common'])

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
  const [expandedIds, setExpandedIds] = useState<Set<number>>(() => new Set())
  const displayLines = useMemo(() => collapseContextUnified(lines, expandedIds), [lines, expandedIds])
  const handleExpand = useCallback((id: number) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      next.add(id)
      return next
    })
  }, [])

  const { containerRef, totalHeight, startIndex, endIndex, offsetY, handleScroll, measureRef } =
    useDynamicVirtualScroll({ lineCount: displayLines.length, isResizing, estimateLineHeight: lineHeight })

  if (lines.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-text-400 text-[length:var(--fs-base)]">
        {t('diffViewer.noChanges')}
      </div>
    )
  }

  const useChangeBars = diffStyle === 'changeBars'
  const gutterWidth = useChangeBars ? 67 : 84

  const visibleRows: React.ReactNode[] = []
  for (let i = startIndex; i < endIndex; i++) {
    const item = displayLines[i]

    if (isCollapsed(item)) {
      visibleRows.push(
        <div key={`c-${i}`} ref={el => measureRef(i, el)}>
          <CollapsedBar count={item.count} t={t} onExpand={() => handleExpand(item.id)} />
        </div>,
      )
      continue
    }

    const line = item as UnifiedLine
    let tokens: HighlightTokens | null = null
    let lineNo: number | undefined

    if (line.type === 'delete' && line.oldLineNo) {
      tokens = beforeTokens
      lineNo = line.oldLineNo
    } else if ((line.type === 'add' || line.type === 'context') && line.newLineNo) {
      tokens = afterTokens
      lineNo = line.newLineNo
    }

    visibleRows.push(
      <div key={i} ref={el => measureRef(i, el)} className={`flex items-stretch ${getLineBgClass(line.type)}`}>
        <div className="shrink-0" style={{ width: gutterWidth }}>
          {useChangeBars ? (
            <div className="flex items-stretch h-full">
              <div {...getChangeBarProps(line.type)} />
              <div className="w-8 shrink-0 px-1 text-right text-text-500 text-[length:var(--fs-code)] leading-[var(--fs-code-line-height)] select-none opacity-60">
                {line.oldLineNo}
              </div>
              <div className="w-8 shrink-0 px-1 text-right text-text-500 text-[length:var(--fs-code)] leading-[var(--fs-code-line-height)] select-none opacity-60">
                {line.newLineNo}
              </div>
            </div>
          ) : (
            <div className="flex h-full">
              <div className="w-8 shrink-0 px-1 text-right text-text-500 text-[length:var(--fs-code)] leading-[var(--fs-code-line-height)] select-none opacity-60">
                {line.oldLineNo}
              </div>
              <div className="w-8 shrink-0 px-1 text-right text-text-500 text-[length:var(--fs-code)] leading-[var(--fs-code-line-height)] select-none opacity-60">
                {line.newLineNo}
              </div>
              <div className="w-5 shrink-0 text-center text-[length:var(--fs-code)] leading-[var(--fs-code-line-height)] select-none">
                {line.type === 'add' && <span className="text-success-100">+</span>}
                {line.type === 'delete' && <span className="text-danger-100">−</span>}
              </div>
            </div>
          )}
        </div>

        <div
          className="min-w-0 flex-1 px-2 leading-[var(--fs-code-line-height)] text-[length:var(--fs-code)] whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
          style={{ minHeight: lineHeight }}
        >
          <LineContent line={{ ...line, lineNo }} tokens={tokens} />
        </div>
      </div>,
    )
  }

  return (
    <div
      ref={containerRef}
      className="overflow-y-auto overflow-x-hidden custom-scrollbar font-mono text-[length:var(--fs-code)] h-full"
      onScroll={handleScroll}
      style={maxHeight !== undefined ? { maxHeight } : undefined}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div className="absolute top-0 left-0 right-0" style={{ transform: `translateY(${offsetY}px)` }}>
          {visibleRows}
        </div>
      </div>
    </div>
  )
})

// ============================================
// Line Content Renderer
// ============================================

type HighlightToken = HighlightTokens[number][number]
type WordDiffChange = ReturnType<typeof diffWords>[number]

const LineContent = memo(function LineContent({ line, tokens }: { line: DiffLine; tokens: HighlightTokens | null }) {
  const lineTokens = tokens && line.lineNo ? tokens[line.lineNo - 1] : null

  // 有 word diff 标记时：在语法着色基础上叠加增删背景
  if (line.wordDiffSegments) {
    // 有语法 token → 合并渲染（token 提供颜色，word diff segment 提供背景）
    if (lineTokens) {
      return <MergedWordDiffLine segments={line.wordDiffSegments} lineTokens={lineTokens} />
    }
    // 无语法 token → 纯 word diff（文字用默认色 + 增删背景）
    return (
      <>
        {line.wordDiffSegments.map((seg, i) =>
          seg.diffType ? (
            <span key={i} className={seg.diffType === 'delete' ? 'bg-danger-100/30' : 'bg-success-100/30'}>
              {seg.text}
            </span>
          ) : (
            <span key={i} className="text-text-100">
              {seg.text}
            </span>
          ),
        )}
      </>
    )
  }

  // 无 word diff，有语法高亮
  if (lineTokens) {
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

/**
 * 合并渲染：syntax token 提供文字颜色，word diff segment 提供背景色。
 *
 * 两者的切分边界不同，需要对齐遍历——
 * 遍历 word diff segment，在每个 segment 内部按 syntax token 切分渲染。
 */
function MergedWordDiffLine({ segments, lineTokens }: { segments: WordDiffSegment[]; lineTokens: HighlightToken[] }) {
  const result: React.ReactNode[] = []
  let tokenIdx = 0
  let tokenOffset = 0 // 当前 token 内已消费的字符数

  for (let si = 0; si < segments.length; si++) {
    const seg = segments[si]
    let remaining = seg.text.length
    const bgClass = seg.diffType === 'delete' ? 'bg-danger-100/30' : seg.diffType === 'add' ? 'bg-success-100/30' : ''
    const children: React.ReactNode[] = []

    while (remaining > 0 && tokenIdx < lineTokens.length) {
      const token = lineTokens[tokenIdx]
      const available = token.content.length - tokenOffset
      const take = Math.min(remaining, available)
      const slice = token.content.substring(tokenOffset, tokenOffset + take)

      children.push(
        <span key={`${si}-${tokenIdx}-${tokenOffset}`} style={token.color ? { color: token.color } : undefined}>
          {slice}
        </span>,
      )

      remaining -= take
      tokenOffset += take
      if (tokenOffset >= token.content.length) {
        tokenIdx++
        tokenOffset = 0
      }
    }

    // 如果 token 用完了但 segment 还有剩余（不应该发生，但防御性处理）
    if (remaining > 0) {
      const extraStart = seg.text.length - remaining
      children.push(<span key={`${si}-extra`}>{seg.text.substring(extraStart)}</span>)
    }

    if (bgClass) {
      result.push(
        <span key={si} className={bgClass}>
          {children}
        </span>,
      )
    } else {
      result.push(...children)
    }
  }

  return <>{result}</>
}

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

          let leftSegments: WordDiffSegment[] | undefined
          let rightSegments: WordDiffSegment[] | undefined

          if (!skipWordDiff && oldLine !== undefined && newLine !== undefined) {
            const wordDiff = computeWordDiff(oldLine, newLine)
            if (!isTooFragmented(wordDiff.changes)) {
              leftSegments = wordDiff.left
              rightSegments = wordDiff.right
            }
          }

          result.push({
            left:
              oldLine !== undefined
                ? { type: 'delete', content: oldLine, lineNo: oldIdx + j + 1, wordDiffSegments: leftSegments }
                : { type: 'empty', content: '' },
            right:
              newLine !== undefined
                ? { type: 'add', content: newLine, lineNo: newIdx + j + 1, wordDiffSegments: rightSegments }
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

function computeWordDiff(
  oldLine: string,
  newLine: string,
): { left: WordDiffSegment[]; right: WordDiffSegment[]; changes: WordDiffChange[] } {
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

  const left: WordDiffSegment[] = []
  const right: WordDiffSegment[] = []
  for (const change of mergedChanges) {
    if (change.removed) left.push({ text: change.value, diffType: 'delete' })
    else if (change.added) right.push({ text: change.value, diffType: 'add' })
    else {
      left.push({ text: change.value })
      right.push({ text: change.value })
    }
  }

  return { left, right, changes: mergedChanges }
}
