/**
 * DiffViewer - 核心 Diff 渲染组件
 * 
 * 参考 FileExplorer 的 CodePreview 实现：
 * 1. 始终使用虚拟滚动
 * 2. 填满父容器（h-full）
 * 3. 大文件跳过词级别diff和语法高亮
 */

import { memo, useMemo, useRef, useState, useEffect, useCallback } from 'react'
import { diffLines, diffWords } from 'diff'
import { useSyntaxHighlight } from '../hooks/useSyntaxHighlight'

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
    case 'add': return 'bg-success-bg/40'
    case 'delete': return 'bg-danger-bg/40'
    case 'empty': return 'bg-bg-100/30'
    default: return ''
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
    <UnifiedDiffView
      before={before}
      after={after}
      language={language}
      isResizing={isResizing}
      maxHeight={maxHeight}
    />
  )
})

// ============================================
// Split Diff View - 整体垂直滚动，左右各自水平滚动
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
  const leftPanelRef = useRef<HTMLDivElement>(null)
  const rightPanelRef = useRef<HTMLDivElement>(null)
  const leftScrollbarRef = useRef<HTMLDivElement>(null)
  const rightScrollbarRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [containerHeight, setContainerHeight] = useState(300)
  const [leftContentWidth, setLeftContentWidth] = useState(0)
  const [rightContentWidth, setRightContentWidth] = useState(0)
  
  const cachedRef = useRef<PairedLine[] | null>(null)
  
  const shouldHighlight = !isResizing && language !== 'text'
  const { output: beforeTokens } = useSyntaxHighlight(before, { lang: language, mode: 'tokens', enabled: shouldHighlight })
  const { output: afterTokens } = useSyntaxHighlight(after, { lang: language, mode: 'tokens', enabled: shouldHighlight })
  
  const skipWordDiff = isResizing || isLargeFile
  const pairedLines = useMemo(() => {
    if (isResizing && cachedRef.current) return cachedRef.current
    const result = computePairedLines(before, after, skipWordDiff)
    cachedRef.current = result
    return result
  }, [before, after, isResizing, skipWordDiff])
  
  const totalHeight = pairedLines.length * LINE_HEIGHT
  
  // 可见范围
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
  
  // 测量内容宽度
  useEffect(() => {
    const leftPanel = leftPanelRef.current
    const rightPanel = rightPanelRef.current
    if (!leftPanel || !rightPanel) return
    
    const updateWidths = () => {
      const leftContent = leftPanel.firstElementChild as HTMLElement
      const rightContent = rightPanel.firstElementChild as HTMLElement
      if (leftContent) setLeftContentWidth(leftContent.scrollWidth)
      if (rightContent) setRightContentWidth(rightContent.scrollWidth)
    }
    
    updateWidths()
    const observer = new MutationObserver(updateWidths)
    observer.observe(leftPanel, { childList: true, subtree: true })
    observer.observe(rightPanel, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [pairedLines, startIndex, endIndex])
  
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop)
  }, [])
  
  // 同步 proxy 滚动条 <-> 面板
  const handleLeftScrollbar = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (leftPanelRef.current) leftPanelRef.current.scrollLeft = e.currentTarget.scrollLeft
  }, [])
  const handleRightScrollbar = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (rightPanelRef.current) rightPanelRef.current.scrollLeft = e.currentTarget.scrollLeft
  }, [])
  const handleLeftPanelScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (leftScrollbarRef.current) leftScrollbarRef.current.scrollLeft = e.currentTarget.scrollLeft
  }, [])
  const handleRightPanelScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (rightScrollbarRef.current) rightScrollbarRef.current.scrollLeft = e.currentTarget.scrollLeft
  }, [])

  if (pairedLines.length === 0) {
    return <div className="h-full flex items-center justify-center text-text-400 text-sm">No changes</div>
  }
  
  const leftRows: React.ReactNode[] = []
  const rightRows: React.ReactNode[] = []
  
  for (let i = startIndex; i < endIndex; i++) {
    const pair = pairedLines[i]
    
    leftRows.push(
      <div key={i} className={`flex ${getLineBgClass(pair.left.type)}`} style={{ height: LINE_HEIGHT }}>
        <div className="w-10 shrink-0 px-1 text-right text-text-500 text-[11px] leading-5 select-none opacity-60">
          {pair.left.lineNo}
        </div>
        <div className="px-2 leading-5 text-[11px] whitespace-pre">
          {pair.left.type === 'delete' && <span className="text-danger-100 select-none mr-1">−</span>}
          {pair.left.type !== 'empty' && <LineContent line={pair.left} tokens={beforeTokens as any[][] | null} />}
        </div>
      </div>
    )
    
    rightRows.push(
      <div key={i} className={`flex ${getLineBgClass(pair.right.type)}`} style={{ height: LINE_HEIGHT }}>
        <div className="w-10 shrink-0 px-1 text-right text-text-500 text-[11px] leading-5 select-none opacity-60">
          {pair.right.lineNo}
        </div>
        <div className="px-2 leading-5 text-[11px] whitespace-pre">
          {pair.right.type === 'add' && <span className="text-success-100 select-none mr-1">+</span>}
          {pair.right.type !== 'empty' && <LineContent line={pair.right} tokens={afterTokens as any[][] | null} />}
        </div>
      </div>
    )
  }

  return (
    <div 
      ref={containerRef}
      className="h-full overflow-y-auto overflow-x-hidden panel-scrollbar-y font-mono"
      style={maxHeight !== undefined ? { maxHeight } : undefined}
      onScroll={handleScroll}
    >
      {/* 虚拟滚动占位 */}
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div 
          className="absolute top-0 left-0 right-0 flex"
          style={{ transform: `translateY(${offsetY}px)` }}
        >
          {/* Left — 隐藏自身滚动条，由 proxy 控制 */}
          <div 
            ref={leftPanelRef}
            className="flex-1 overflow-x-auto scrollbar-none border-r border-border-100/30"
            onScroll={handleLeftPanelScroll}
          >
            <div className="inline-block min-w-full">
              {leftRows}
            </div>
          </div>
          {/* Right */}
          <div 
            ref={rightPanelRef}
            className="flex-1 overflow-x-auto scrollbar-none"
            onScroll={handleRightPanelScroll}
          >
            <div className="inline-block min-w-full">
              {rightRows}
            </div>
          </div>
        </div>
      </div>

      {/* Sticky proxy 横向滚动条 — 固定在可视区底部，和面板天然对齐 */}
      <div className="sticky bottom-0 z-10 flex bg-bg-100/90 backdrop-blur-sm">
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
    </div>
  )
})

// ============================================
// Unified Diff View - 始终虚拟滚动
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
  const [scrollTop, setScrollTop] = useState(0)
  const [containerHeight, setContainerHeight] = useState(300)
  
  const cachedRef = useRef<UnifiedLine[] | null>(null)
  
  // resize时禁用高亮（大文件仍然高亮，因为useSyntaxHighlight是异步的不会阻塞）
  const shouldHighlight = !isResizing && language !== 'text'
  const { output: beforeTokens } = useSyntaxHighlight(before, { lang: language, mode: 'tokens', enabled: shouldHighlight })
  const { output: afterTokens } = useSyntaxHighlight(after, { lang: language, mode: 'tokens', enabled: shouldHighlight })
  
  const lines = useMemo(() => {
    if (isResizing && cachedRef.current) return cachedRef.current
    const result = computeUnifiedLines(before, after)
    cachedRef.current = result
    return result
  }, [before, after, isResizing])
  
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
  
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop)
  }, [])

  if (lines.length === 0) {
    return <div className="h-full flex items-center justify-center text-text-400 text-sm">No changes</div>
  }
  
  const visibleRows: React.ReactNode[] = []
  for (let i = startIndex; i < endIndex; i++) {
    const line = lines[i]
    let tokens: any[][] | null = null
    let lineNo: number | undefined
    if (line.type === 'delete' && line.oldLineNo) {
      tokens = beforeTokens as any[][] | null
      lineNo = line.oldLineNo
    } else if ((line.type === 'add' || line.type === 'context') && line.newLineNo) {
      tokens = afterTokens as any[][] | null
      lineNo = line.newLineNo
    }
    
    visibleRows.push(
      <div key={i} className={`flex ${getLineBgClass(line.type)}`} style={{ height: LINE_HEIGHT }}>
        <div className="w-10 shrink-0 px-1 text-right text-text-500 text-[11px] leading-5 select-none opacity-60">
          {line.oldLineNo}
        </div>
        <div className="w-10 shrink-0 px-1 text-right text-text-500 text-[11px] leading-5 select-none opacity-60">
          {line.newLineNo}
        </div>
        <div className="px-2 leading-5 text-[11px] whitespace-pre">
          {line.type === 'add' && <span className="text-success-100 select-none mr-1">+</span>}
          {line.type === 'delete' && <span className="text-danger-100 select-none mr-1">−</span>}
          <LineContent line={{ ...line, lineNo }} tokens={tokens} />
        </div>
      </div>
    )
  }

  return (
    <div 
      ref={containerRef}
      className="h-full overflow-auto panel-scrollbar font-mono"
      style={maxHeight !== undefined ? { maxHeight } : undefined}
      onScroll={handleScroll}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, transform: `translateY(${offsetY}px)` }}>
          {visibleRows}
        </div>
      </div>
    </div>
  )
})

// ============================================
// Line Content Renderer
// ============================================

const LineContent = memo(function LineContent({ 
  line, 
  tokens 
}: { 
  line: DiffLine
  tokens: any[][] | null 
}) {
  // 词级别diff高亮
  if (line.highlightedContent) {
    return <span className="text-text-100" dangerouslySetInnerHTML={{ __html: line.highlightedContent }} />
  }
  
  // 语法高亮
  if (tokens && line.lineNo && tokens[line.lineNo - 1]) {
    const lineTokens = tokens[line.lineNo - 1]
    return <>{lineTokens.map((token: any, i: number) => <span key={i} style={{ color: token.color }}>{token.content}</span>)}</>
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
  
  let oldIdx = 0, newIdx = 0, i = 0
  
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
            left: oldLine !== undefined 
              ? { type: 'delete', content: oldLine, lineNo: oldIdx + j + 1, highlightedContent: leftHighlight }
              : { type: 'empty', content: '' },
            right: newLine !== undefined
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
  
  let oldIdx = 0, newIdx = 0
  
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
        result.push({ type: 'context', content: afterLines[newIdx + j] || '', oldLineNo: oldIdx + j + 1, newLineNo: newIdx + j + 1 })
      }
      oldIdx += count
      newIdx += count
    }
  }
  
  return result
}

function isTooFragmented(changes: any[]): boolean {
  let commonLength = 0, totalLength = 0
  for (const change of changes) {
    totalLength += change.value.length
    if (!change.added && !change.removed) commonLength += change.value.length
  }
  return totalLength > 10 && commonLength / totalLength < 0.4
}

function computeWordDiff(oldLine: string, newLine: string): { left: string; right: string; changes: any[] } {
  const changes = diffWords(oldLine, newLine)
  
  const mergedChanges: any[] = []
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

  let left = '', right = ''
  for (const change of mergedChanges) {
    const escaped = escapeHtml(change.value)
    if (change.removed) left += `<span class="bg-danger-100/30">${escaped}</span>`
    else if (change.added) right += `<span class="bg-success-100/30">${escaped}</span>`
    else { left += escaped; right += escaped }
  }
  
  return { left, right, changes: mergedChanges }
}

// ============================================
// Export helper
// ============================================

export function extractContentFromUnifiedDiff(diff: string): { before: string, after: string } {
  let before = '', after = ''
  for (const line of diff.split('\n')) {
    if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('Index:') || 
        line.startsWith('===') || line.startsWith('@@') || line.startsWith('\\ No newline')) continue
    if (line.startsWith('-')) before += line.slice(1) + '\n'
    else if (line.startsWith('+')) after += line.slice(1) + '\n'
    else if (line.startsWith(' ')) { before += line.slice(1) + '\n'; after += line.slice(1) + '\n' }
  }
  return { before: before.trimEnd(), after: after.trimEnd() }
}
