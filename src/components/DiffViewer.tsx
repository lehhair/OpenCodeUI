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

import { memo, useMemo, useRef, useState, useEffect, useCallback, useSyncExternalStore, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { diffLines, diffWords } from 'diff'
import { useSyntaxHighlight, type HighlightTokens } from '../hooks/useSyntaxHighlight'
import { useDynamicVirtualScroll } from '../hooks/useDynamicVirtualScroll'
import { themeStore } from '../store/themeStore'
import type { DiffStyle } from '../store/themeStore'
import { getLineCount, getLineNumberColumnWidth } from '../utils/lineNumberUtils'

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
  data?: DiffViewerData
}

export interface DiffViewerData {
  beforeTokens: HighlightTokens | null
  afterTokens: HighlightTokens | null
  pairedLines: PairedLine[]
  unifiedLines: UnifiedLine[]
  lineNumberWidth: number
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
  isFirst: boolean
  isLast: boolean
  chunked: boolean
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
  isFirst: boolean
  isLast: boolean
  chunked: boolean
}

type UnifiedLineOrCollapsed = UnifiedLine | CollapsedUnifiedLine

function isCollapsed(
  line: PairedLineOrCollapsed | UnifiedLineOrCollapsed,
): line is CollapsedPairedLine | CollapsedUnifiedLine {
  return 'collapsed' in line && line.collapsed === true
}

function expandRegion(prev: Map<number, ExpansionRegion>, id: number, direction: ExpandDirection): Map<number, ExpansionRegion> {
  const next = new Map(prev)
  const current = next.get(id) ?? { fromStart: 0, fromEnd: 0 }
  next.set(id, {
    fromStart: current.fromStart + (direction === 'up' || direction === 'both' ? EXPANSION_LINE_COUNT : 0),
    fromEnd: current.fromEnd + (direction === 'down' || direction === 'both' ? EXPANSION_LINE_COUNT : 0),
  })
  return next
}

/** 上下文行保留数：变更前后各保留 CONTEXT_LINES 行 */
const CONTEXT_LINES = 3
const EXPANSION_LINE_COUNT = 100
type ExpandDirection = 'up' | 'down' | 'both'
interface ExpansionRegion {
  fromStart: number
  fromEnd: number
}

/** 将连续 context 行折叠，只保留变更前后各 CONTEXT_LINES 行 */
function collapseContextPaired(lines: PairedLine[], expandedRegions?: ReadonlyMap<number, ExpansionRegion>): PairedLineOrCollapsed[] {
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
        if (ctxLen > minToCollapse) {
          const isFirst = contextStart === 0
          const isLast = i === lines.length
          const keepBefore = isFirst ? 0 : CONTEXT_LINES
          const keepAfter = isLast ? 0 : CONTEXT_LINES
          const expanded = expandedRegions?.get(contextStart) ?? { fromStart: 0, fromEnd: 0 }
          const prefixCount = Math.min(ctxLen, keepBefore + expanded.fromStart)
          const suffixStart = Math.max(prefixCount, ctxLen - keepAfter - expanded.fromEnd)

          for (let j = contextStart; j < contextStart + prefixCount; j++) result.push(lines[j])
          if (suffixStart > prefixCount) {
            const count = suffixStart - prefixCount
            result.push({
              collapsed: true,
              count,
              id: contextStart,
              isFirst,
              isLast,
              chunked: count > EXPANSION_LINE_COUNT,
            })
          }
          for (let j = contextStart + suffixStart; j < i; j++) result.push(lines[j])
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

function collapseContextUnified(lines: UnifiedLine[], expandedRegions?: ReadonlyMap<number, ExpansionRegion>): UnifiedLineOrCollapsed[] {
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
        if (ctxLen > minToCollapse) {
          const isFirst = contextStart === 0
          const isLast = i === lines.length
          const keepBefore = isFirst ? 0 : CONTEXT_LINES
          const keepAfter = isLast ? 0 : CONTEXT_LINES
          const expanded = expandedRegions?.get(contextStart) ?? { fromStart: 0, fromEnd: 0 }
          const prefixCount = Math.min(ctxLen, keepBefore + expanded.fromStart)
          const suffixStart = Math.max(prefixCount, ctxLen - keepAfter - expanded.fromEnd)

          for (let j = contextStart; j < contextStart + prefixCount; j++) result.push(lines[j])
          if (suffixStart > prefixCount) {
            const count = suffixStart - prefixCount
            result.push({
              collapsed: true,
              count,
              id: contextStart,
              isFirst,
              isLast,
              chunked: count > EXPANSION_LINE_COUNT,
            })
          }
          for (let j = contextStart + suffixStart; j < i; j++) result.push(lines[j])
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

function getContentBgClass(type: LineType): string {
  if (type === 'empty') return 'diff-empty-content-buffer'
  return getLineBgClass(type)
}

function getEmptyBufferBackgroundStyle(yOffset: number, xOffset = 0): CSSProperties {
  return { backgroundPosition: `${5 + xOffset}px ${-yOffset}px` }
}

function getEmptyBufferRowStyle(height: number, yOffset = 0, xOffset = 0): CSSProperties {
  return { height, ...getEmptyBufferBackgroundStyle(yOffset, xOffset) }
}

function useDiffLineNumberWidth(before: string, after: string): number {
  return useMemo(
    () => getLineNumberColumnWidth(Math.max(getLineCount(before), getLineCount(after))),
    [before, after],
  )
}

function LineNumberCell({ lineNo, width, type }: { lineNo?: number; width: number; type?: LineType }) {
  const toneClass = type === 'add' || type === 'delete' ? 'text-text-300' : 'text-text-400'
  return (
    <div
      className={`shrink-0 pl-4 pr-3 text-right text-[length:var(--fs-code)] leading-[var(--fs-code-line-height)] select-none ${toneClass}`}
      style={{ width }}
    >
      {lineNo}
    </div>
  )
}

function DiffMarkerCell({ type }: { type: LineType }) {
  return (
    <div className="w-5 shrink-0 text-center text-[length:var(--fs-code)] leading-[var(--fs-code-line-height)] select-none">
      {type === 'add' && <span className="text-success-100">+</span>}
      {type === 'delete' && <span className="text-danger-100">−</span>}
    </div>
  )
}

function EmptyContentBuffer({ height, yOffset = 0, xOffset = 0 }: { height: number; yOffset?: number; xOffset?: number }) {
  return <div className="diff-empty-content-buffer min-w-full" style={getEmptyBufferRowStyle(height, yOffset, xOffset)} />
}

/** Change bar 样式 — 行号左侧的 3px 竖条，add 实心 / delete 虚线 */
function getChangeBarProps(type: LineType): { className: string; style?: React.CSSProperties } {
  switch (type) {
    case 'add':
      return { className: 'w-1 shrink-0 bg-success-100' }
    case 'delete':
      return {
        className: 'diff-change-bar-delete w-1 shrink-0',
      }
    default:
      return { className: 'w-1 shrink-0' }
  }
}

/** Pierre-like 折叠按钮，放在 gutter 区域 */
function ExpandIcon({ type }: { type: ExpandDirection }) {
  if (type === 'both') {
    return (
      <svg aria-hidden="true" data-icon="" className="diff-separator-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M11.47 9.47a.75.75 0 1 1 1.06 1.06l-4 4a.75.75 0 0 1-1.06 0l-4-4a.75.75 0 1 1 1.06-1.06L8 12.94zM7.526 1.418a.75.75 0 0 1 1.004.052l4 4a.75.75 0 1 1-1.06 1.06L8 3.06 4.53 6.53a.75.75 0 1 1-1.06-1.06l4-4z" />
      </svg>
    )
  }

  return (
    <svg
      aria-hidden="true"
      data-icon=""
      className="diff-separator-icon"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="currentColor"
    >
      <path d="M3.47 5.47a.75.75 0 0 1 1.06 0L8 8.94l3.47-3.47a.75.75 0 1 1 1.06 1.06l-4 4a.75.75 0 0 1-1.06 0l-4-4a.75.75 0 0 1 0-1.06" />
    </svg>
  )
}

function getSeparatorDirections({ isFirst, isLast, chunked }: { isFirst?: boolean; isLast?: boolean; chunked?: boolean }): ExpandDirection[] {
  if (!chunked) return [!isFirst && !isLast ? 'both' : isFirst ? 'down' : 'up']
  const directions: ExpandDirection[] = []
  if (!isFirst) directions.push('up')
  if (!isLast) directions.push('down')
  return directions
}

function CollapsedExpandButton({
  directions,
  onExpand,
  width,
}: {
  directions: ExpandDirection[]
  onExpand?: (direction: ExpandDirection) => void
  width?: number
}) {
  const buttonWidth = width !== undefined && directions.length > 0 ? width / directions.length : undefined

  return (
    <div data-separator-wrapper="" className="diff-separator-button-group" style={width !== undefined ? { width, flexBasis: width } : undefined}>
      {directions.map(direction => (
        <button
          key={direction}
          type="button"
          data-compact=""
          data-expand-button=""
          data-expand-up={direction === 'up' ? '' : undefined}
          data-expand-down={direction === 'down' ? '' : undefined}
          data-expand-both={direction === 'both' ? '' : undefined}
          className="diff-separator-button"
          style={buttonWidth !== undefined ? { width: buttonWidth, minWidth: 0, flexBasis: buttonWidth } : undefined}
          title={direction === 'up' ? 'Expand upward' : direction === 'down' ? 'Expand downward' : 'Expand hidden lines'}
          onClick={() => onExpand?.(direction)}
        >
          <ExpandIcon type={direction} />
        </button>
      ))}
    </div>
  )
}

/** 折叠文案区，放在 content 区域 */
function CollapsedLabel({
  count,
  t,
  leadingDirections = [],
  onExpand,
  height = 24,
}: {
  count: number
  t: (key: string, opts?: Record<string, unknown>) => string
  leadingDirections?: ExpandDirection[]
  onExpand?: (direction: ExpandDirection) => void
  height?: number
}) {
  return (
    <div className="diff-separator-content-row" style={{ height }}>
      {leadingDirections.length > 0 && <CollapsedExpandButton directions={leadingDirections} onExpand={onExpand} />}
      <div data-separator-content="" className="diff-separator-content">
        <button type="button" data-compact="" data-unmodified-lines="" className="diff-separator-text-button" onClick={() => onExpand?.('both')}>
          {t('diffViewer.linesUnchanged', { count })}
        </button>
      </div>
    </div>
  )
}

function CollapsedLabelOverlay({
  count,
  t,
  onExpand,
  height,
  left,
}: {
  count: number
  t: (key: string, opts?: Record<string, unknown>) => string
  onExpand?: (direction: ExpandDirection) => void
  height: number
  left: number
}) {
  return (
    <div className="diff-separator-label-overlay" style={{ height, left }}>
      <CollapsedLabel count={count} t={t} onExpand={onExpand} height={height} />
    </div>
  )
}

/** 右侧/续接区域，只显示同一条 separator 的延伸背景 */
function CollapsedContinuation({ height = 24 }: { height?: number }) {
  return <div className="diff-separator-continuation" style={{ height }} />
}

/** Wrapped 模式直接横跨整行 */
function CollapsedBar({
  count,
  t,
  isFirst,
  isLast,
  chunked,
  onExpand,
  height = 24,
  lineNumberAreaWidth,
}: {
  count: number
  t: (key: string, opts?: Record<string, unknown>) => string
  isFirst?: boolean
  isLast?: boolean
  chunked?: boolean
  onExpand?: (direction: ExpandDirection) => void
  height?: number
  lineNumberAreaWidth?: number
}) {
  const directions = getSeparatorDirections({ isFirst, isLast, chunked })
  return (
    <div data-separator="line-info" data-expand-index="" className="diff-separator-surface" style={{ height }}>
      <CollapsedExpandButton directions={directions} onExpand={onExpand} width={lineNumberAreaWidth} />
      <CollapsedLabel count={count} t={t} onExpand={onExpand} height={height} />
    </div>
  )
}

// ============================================
// Main Component
// ============================================

// eslint-disable-next-line react-refresh/only-export-components -- DiffViewer consumers share this data with fullscreen instances.
export function useDiffViewerData(before: string, after: string, language = 'text', isResizing = false, enabled = true): DiffViewerData {
  const shouldHighlight = enabled && !isResizing && language !== 'text'
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
  const pairedLines = useMemo(() => (enabled ? computePairedLines(before, after, skipWordDiff) : []), [before, after, enabled, skipWordDiff])
  const unifiedLines = useMemo(() => (enabled ? computeUnifiedLines(before, after) : []), [before, after, enabled])
  const lineNumberWidth = useDiffLineNumberWidth(enabled ? before : '', enabled ? after : '')

  return useMemo(
    () => ({ beforeTokens, afterTokens, pairedLines, unifiedLines, lineNumberWidth }),
    [afterTokens, beforeTokens, lineNumberWidth, pairedLines, unifiedLines],
  )
}

export const DiffViewer = memo(function DiffViewer({
  data,
  ...props
}: DiffViewerProps) {
  if (data) return <DiffViewerContent {...props} data={data} />
  return <DiffViewerWithData {...props} />
})

function DiffViewerWithData({ before, after, language = 'text', isResizing = false, ...props }: DiffViewerProps) {
  const data = useDiffViewerData(before, after, language, isResizing)
  return <DiffViewerContent before={before} after={after} language={language} isResizing={isResizing} {...props} data={data} />
}

const DiffViewerContent = memo(function DiffViewerContent({
  before,
  after,
  viewMode = 'split',
  maxHeight,
  isResizing = false,
  wordWrap,
  data,
}: DiffViewerProps & { data: DiffViewerData }) {
  const { diffStyle, codeWordWrap, codeFontScale } = useSyncExternalStore(themeStore.subscribe, themeStore.getSnapshot)
  const resolvedWordWrap = wordWrap ?? codeWordWrap
  const lineHeight = codeLineHeight(codeFontScale)
  const resolvedData = data

  // 纯增加或纯删除时，split 模式另一边是空的没意义，自动降级为 unified
  const isAddOnly = !before.trim()
  const isDeleteOnly = !after.trim()
  const effectiveViewMode = isAddOnly || isDeleteOnly ? 'unified' : viewMode

  if (effectiveViewMode === 'split') {
    if (resolvedWordWrap) {
      return (
        <WrappedSplitDiffView
          beforeTokens={resolvedData.beforeTokens}
          afterTokens={resolvedData.afterTokens}
          pairedLines={resolvedData.pairedLines}
          lineNumberWidth={resolvedData.lineNumberWidth}
          isResizing={isResizing}
          maxHeight={maxHeight}
          diffStyle={diffStyle}
          lineHeight={lineHeight}
        />
      )
    }

    return (
      <SplitDiffView
        beforeTokens={resolvedData.beforeTokens}
        afterTokens={resolvedData.afterTokens}
        pairedLines={resolvedData.pairedLines}
        lineNumberWidth={resolvedData.lineNumberWidth}
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
        beforeTokens={resolvedData.beforeTokens}
        afterTokens={resolvedData.afterTokens}
        lines={resolvedData.unifiedLines}
        lineNumberWidth={resolvedData.lineNumberWidth}
        isResizing={isResizing}
        maxHeight={maxHeight}
        diffStyle={diffStyle}
        lineHeight={lineHeight}
      />
    )
  }

  return (
    <UnifiedDiffView
      beforeTokens={resolvedData.beforeTokens}
      afterTokens={resolvedData.afterTokens}
      lines={resolvedData.unifiedLines}
      lineNumberWidth={resolvedData.lineNumberWidth}
      isResizing={isResizing}
      maxHeight={maxHeight}
      diffStyle={diffStyle}
      lineHeight={lineHeight}
    />
  )
})

const WrappedSplitDiffView = memo(function WrappedSplitDiffView({
  beforeTokens,
  afterTokens,
  pairedLines,
  lineNumberWidth,
  isResizing,
  maxHeight,
  diffStyle,
  lineHeight,
}: {
  beforeTokens: HighlightTokens | null
  afterTokens: HighlightTokens | null
  pairedLines: PairedLine[]
  lineNumberWidth: number
  isResizing: boolean
  maxHeight?: number
  diffStyle: DiffStyle
  lineHeight: number
}) {
  const { t } = useTranslation(['components', 'common'])
  const [expandedRegions, setExpandedRegions] = useState<Map<number, ExpansionRegion>>(() => new Map())
  const displayLines = useMemo(() => collapseContextPaired(pairedLines, expandedRegions), [pairedLines, expandedRegions])
  const handleExpand = useCallback((id: number, direction: ExpandDirection) => {
    setExpandedRegions(prev => expandRegion(prev, id, direction))
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
  const gutterWidth = useChangeBars ? lineNumberWidth + 4 : lineNumberWidth + 20

  const visibleRows: React.ReactNode[] = []
  for (let i = startIndex; i < endIndex; i++) {
    const item = displayLines[i]

    if (isCollapsed(item)) {
      visibleRows.push(
        <div key={`c-${i}`} ref={el => measureRef(i, el)}>
          <CollapsedBar
            count={item.count}
            t={t}
            isFirst={item.isFirst}
            isLast={item.isLast}
            chunked={item.chunked}
            onExpand={direction => handleExpand(item.id, direction)}
            lineNumberAreaWidth={lineNumberWidth}
          />
        </div>,
      )
      continue
    }

    const pair = item as PairedLine
    const leftEmptyStyle = pair.left.type === 'empty' ? getEmptyBufferBackgroundStyle(0) : undefined
    const rightEmptyStyle = pair.right.type === 'empty' ? getEmptyBufferBackgroundStyle(0) : undefined
    visibleRows.push(
      <div key={i} ref={el => measureRef(i, el)} className="flex items-stretch">
        {/* Left panel */}
        <div
          className={`flex-1 flex items-stretch min-w-0 border-r border-border-100/30 ${getContentBgClass(pair.left.type)}`}
          style={leftEmptyStyle}
        >
          <div className="shrink-0" style={{ width: gutterWidth }}>
            {useChangeBars ? (
              <div className="flex items-stretch h-full">
                <div {...getChangeBarProps(pair.left.type)} />
                <LineNumberCell lineNo={pair.left.lineNo} width={lineNumberWidth} type={pair.left.type} />
              </div>
            ) : (
              <div className="flex h-full">
                <LineNumberCell lineNo={pair.left.lineNo} width={lineNumberWidth} type={pair.left.type} />
                <DiffMarkerCell type={pair.left.type} />
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
        <div className={`flex-1 flex items-stretch min-w-0 ${getContentBgClass(pair.right.type)}`} style={rightEmptyStyle}>
          <div className="shrink-0" style={{ width: gutterWidth }}>
            {useChangeBars ? (
              <div className="flex items-stretch h-full">
                <div {...getChangeBarProps(pair.right.type)} />
                <LineNumberCell lineNo={pair.right.lineNo} width={lineNumberWidth} type={pair.right.type} />
              </div>
            ) : (
              <div className="flex h-full">
                <LineNumberCell lineNo={pair.right.lineNo} width={lineNumberWidth} type={pair.right.type} />
                <DiffMarkerCell type={pair.right.type} />
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
  beforeTokens,
  afterTokens,
  pairedLines,
  lineNumberWidth,
  isResizing,
  maxHeight,
  diffStyle,
  lineHeight,
}: {
  beforeTokens: HighlightTokens | null
  afterTokens: HighlightTokens | null
  pairedLines: PairedLine[]
  lineNumberWidth: number
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
  const [leftScrollLeft, setLeftScrollLeft] = useState(0)
  const [rightScrollLeft, setRightScrollLeft] = useState(0)

  const [expandedRegions, setExpandedRegions] = useState<Map<number, ExpansionRegion>>(() => new Map())
  const displayLines = useMemo(() => collapseContextPaired(pairedLines, expandedRegions), [pairedLines, expandedRegions])
  const handleExpand = useCallback((id: number, direction: ExpandDirection) => {
    setExpandedRegions(prev => expandRegion(prev, id, direction))
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
    setLeftScrollLeft(e.currentTarget.scrollLeft)
    if (leftContentRef.current) leftContentRef.current.scrollLeft = e.currentTarget.scrollLeft
    requestAnimationFrame(() => {
      leftScrollSourceRef.current = null
    })
  }, [])
  const handleRightScrollbar = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (rightScrollSourceRef.current === 'content') return
    rightScrollSourceRef.current = 'scrollbar'
    setRightScrollLeft(e.currentTarget.scrollLeft)
    if (rightContentRef.current) rightContentRef.current.scrollLeft = e.currentTarget.scrollLeft
    requestAnimationFrame(() => {
      rightScrollSourceRef.current = null
    })
  }, [])
  const handleLeftContentScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (leftScrollSourceRef.current === 'scrollbar') return
    leftScrollSourceRef.current = 'content'
    setLeftScrollLeft(e.currentTarget.scrollLeft)
    if (leftScrollbarRef.current) leftScrollbarRef.current.scrollLeft = e.currentTarget.scrollLeft
    requestAnimationFrame(() => {
      leftScrollSourceRef.current = null
    })
  }, [])
  const handleRightContentScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (rightScrollSourceRef.current === 'scrollbar') return
    rightScrollSourceRef.current = 'content'
    setRightScrollLeft(e.currentTarget.scrollLeft)
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
  const gutterWidth = useChangeBars ? lineNumberWidth + 4 : lineNumberWidth + 20

  const leftGutterRows: React.ReactNode[] = []
  const leftContentRows: React.ReactNode[] = []
  const rightGutterRows: React.ReactNode[] = []
  const rightContentRows: React.ReactNode[] = []

  for (let i = startIndex; i < endIndex; i++) {
    const item = displayLines[i]

    if (isCollapsed(item)) {
      const directions = getSeparatorDirections(item)
      leftGutterRows.push(
        <div
          key={i}
          data-separator="line-info"
          data-expand-index=""
          className="diff-separator-surface relative overflow-visible"
          style={{ height: lineHeight }}
        >
          <CollapsedExpandButton
            directions={directions}
            onExpand={direction => handleExpand(item.id, direction)}
            width={lineNumberWidth}
          />
          <CollapsedLabelOverlay
            count={item.count}
            t={t}
            onExpand={direction => handleExpand(item.id, direction)}
            height={lineHeight}
            left={lineNumberWidth}
          />
        </div>,
      )
      leftContentRows.push(
        <div
          key={i}
          data-separator="line-info"
          data-expand-index=""
          className="diff-separator-surface"
          style={{ height: lineHeight }}
        >
          <CollapsedContinuation height={lineHeight} />
        </div>,
      )
      rightGutterRows.push(
        <div
          key={i}
          data-separator="line-info"
          className="diff-separator-surface"
          style={{ height: lineHeight }}
        />,
      )
      rightContentRows.push(
        <div
          key={i}
          data-separator="line-info"
          className="diff-separator-surface"
          style={{ height: lineHeight }}
        >
          <CollapsedContinuation height={lineHeight} />
        </div>,
      )
      continue
    }

    const pair = item as PairedLine
    const leftGutterClass = pair.left.type === 'empty' ? 'diff-empty-content-buffer' : getGutterBgClass(pair.left.type)
    const rightGutterClass = pair.right.type === 'empty' ? 'diff-empty-content-buffer' : getGutterBgClass(pair.right.type)
    const rowTop = i * lineHeight
    const leftGutterStyle = getEmptyBufferRowStyle(lineHeight, rowTop)
    const rightGutterStyle = getEmptyBufferRowStyle(lineHeight, rowTop)

    // Left gutter
    leftGutterRows.push(
      useChangeBars ? (
        <div
          key={i}
          className={`flex items-stretch ${leftGutterClass}`}
          style={pair.left.type === 'empty' ? leftGutterStyle : { height: lineHeight }}
        >
          <div {...getChangeBarProps(pair.left.type)} />
          <LineNumberCell lineNo={pair.left.lineNo} width={lineNumberWidth} type={pair.left.type} />
        </div>
      ) : (
        <div key={i} className={`flex ${leftGutterClass}`} style={pair.left.type === 'empty' ? leftGutterStyle : { height: lineHeight }}>
          <LineNumberCell lineNo={pair.left.lineNo} width={lineNumberWidth} type={pair.left.type} />
          <DiffMarkerCell type={pair.left.type} />
        </div>
      ),
    )

    // Left content: 代码
    leftContentRows.push(
      <div
        key={i}
        className={`pr-2 leading-[var(--fs-code-line-height)] text-[length:var(--fs-code)] whitespace-pre ${pair.left.type === 'empty' ? '' : getContentBgClass(pair.left.type)}`}
        style={{ height: lineHeight }}
      >
        {pair.left.type === 'empty' ? <EmptyContentBuffer height={lineHeight} yOffset={rowTop} xOffset={leftScrollLeft - gutterWidth} /> : <LineContent line={pair.left} tokens={beforeTokens} />}
      </div>,
    )

    // Right gutter
    rightGutterRows.push(
      useChangeBars ? (
        <div
          key={i}
          className={`flex items-stretch ${rightGutterClass}`}
          style={pair.right.type === 'empty' ? rightGutterStyle : { height: lineHeight }}
        >
          <div {...getChangeBarProps(pair.right.type)} />
          <LineNumberCell lineNo={pair.right.lineNo} width={lineNumberWidth} type={pair.right.type} />
        </div>
      ) : (
        <div key={i} className={`flex ${rightGutterClass}`} style={pair.right.type === 'empty' ? rightGutterStyle : { height: lineHeight }}>
          <LineNumberCell lineNo={pair.right.lineNo} width={lineNumberWidth} type={pair.right.type} />
          <DiffMarkerCell type={pair.right.type} />
        </div>
      ),
    )

    // Right content
    rightContentRows.push(
      <div
        key={i}
        className={`pr-2 leading-[var(--fs-code-line-height)] text-[length:var(--fs-code)] whitespace-pre ${pair.right.type === 'empty' ? '' : getContentBgClass(pair.right.type)}`}
        style={{ height: lineHeight }}
      >
        {pair.right.type === 'empty' ? <EmptyContentBuffer height={lineHeight} yOffset={rowTop} xOffset={rightScrollLeft - gutterWidth} /> : <LineContent line={pair.right} tokens={afterTokens} />}
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
            <div className="shrink-0 overflow-visible" style={{ width: gutterWidth }}>
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
            <div className="shrink-0 overflow-visible" style={{ width: gutterWidth }}>
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
  beforeTokens,
  afterTokens,
  lines,
  lineNumberWidth,
  isResizing,
  maxHeight,
  diffStyle,
  lineHeight,
}: {
  beforeTokens: HighlightTokens | null
  afterTokens: HighlightTokens | null
  lines: UnifiedLine[]
  lineNumberWidth: number
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

  const [expandedRegions, setExpandedRegions] = useState<Map<number, ExpansionRegion>>(() => new Map())
  const displayLines = useMemo(() => collapseContextUnified(lines, expandedRegions), [lines, expandedRegions])
  const handleExpand = useCallback((id: number, direction: ExpandDirection) => {
    setExpandedRegions(prev => expandRegion(prev, id, direction))
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

  const useChangeBars = diffStyle === 'changeBars'
  const GUTTER_WIDTH = useChangeBars ? lineNumberWidth * 2 + 4 : lineNumberWidth * 2 + 20

  const gutterRows: React.ReactNode[] = []
  const contentRows: React.ReactNode[] = []

  for (let i = startIndex; i < endIndex; i++) {
    const item = displayLines[i]

    if (isCollapsed(item)) {
      const directions = getSeparatorDirections(item)
      gutterRows.push(
        <div
          key={i}
          data-separator="line-info"
          data-expand-index=""
          className="diff-separator-surface relative overflow-visible"
          style={{ height: lineHeight }}
        >
          <CollapsedExpandButton
            directions={directions}
            onExpand={direction => handleExpand(item.id, direction)}
            width={lineNumberWidth * 2}
          />
          <CollapsedLabelOverlay
            count={item.count}
            t={t}
            onExpand={direction => handleExpand(item.id, direction)}
            height={lineHeight}
            left={lineNumberWidth * 2}
          />
        </div>,
      )
      contentRows.push(
        <div key={i} data-separator="line-info" data-expand-index="" className="diff-separator-surface" style={{ height: lineHeight }}>
          <CollapsedContinuation height={lineHeight} />
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

    // Gutter 行
    gutterRows.push(
      useChangeBars ? (
        <div key={i} className={`flex items-stretch ${getGutterBgClass(line.type)}`} style={{ height: lineHeight }}>
          <div {...getChangeBarProps(line.type)} />
          <LineNumberCell lineNo={line.oldLineNo} width={lineNumberWidth} type={line.type} />
          <LineNumberCell lineNo={line.newLineNo} width={lineNumberWidth} type={line.type} />
        </div>
      ) : (
        <div key={i} className={`flex ${getGutterBgClass(line.type)}`} style={{ height: lineHeight }}>
          <LineNumberCell lineNo={line.oldLineNo} width={lineNumberWidth} type={line.type} />
          <LineNumberCell lineNo={line.newLineNo} width={lineNumberWidth} type={line.type} />
          <DiffMarkerCell type={line.type} />
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
          <div className="shrink-0 overflow-visible" style={{ width: GUTTER_WIDTH }}>
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
  beforeTokens,
  afterTokens,
  lines,
  lineNumberWidth,
  isResizing,
  maxHeight,
  diffStyle,
  lineHeight,
}: {
  beforeTokens: HighlightTokens | null
  afterTokens: HighlightTokens | null
  lines: UnifiedLine[]
  lineNumberWidth: number
  isResizing: boolean
  maxHeight?: number
  diffStyle: DiffStyle
  lineHeight: number
}) {
  const { t } = useTranslation(['components', 'common'])
  const [expandedRegions, setExpandedRegions] = useState<Map<number, ExpansionRegion>>(() => new Map())
  const displayLines = useMemo(() => collapseContextUnified(lines, expandedRegions), [lines, expandedRegions])
  const handleExpand = useCallback((id: number, direction: ExpandDirection) => {
    setExpandedRegions(prev => expandRegion(prev, id, direction))
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
  const gutterWidth = useChangeBars ? lineNumberWidth * 2 + 4 : lineNumberWidth * 2 + 20

  const visibleRows: React.ReactNode[] = []
  for (let i = startIndex; i < endIndex; i++) {
    const item = displayLines[i]

    if (isCollapsed(item)) {
      visibleRows.push(
        <div key={`c-${i}`} ref={el => measureRef(i, el)}>
          <CollapsedBar
            count={item.count}
            t={t}
            isFirst={item.isFirst}
            isLast={item.isLast}
            chunked={item.chunked}
            onExpand={direction => handleExpand(item.id, direction)}
            lineNumberAreaWidth={lineNumberWidth * 2}
          />
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
                <LineNumberCell lineNo={line.oldLineNo} width={lineNumberWidth} type={line.type} />
                <LineNumberCell lineNo={line.newLineNo} width={lineNumberWidth} type={line.type} />
              </div>
            ) : (
              <div className="flex h-full">
                <LineNumberCell lineNo={line.oldLineNo} width={lineNumberWidth} type={line.type} />
                <LineNumberCell lineNo={line.newLineNo} width={lineNumberWidth} type={line.type} />
                <DiffMarkerCell type={line.type} />
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
