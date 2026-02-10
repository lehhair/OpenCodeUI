/**
 * FullscreenViewer - 通用全屏查看器
 * 
 * 设计理念：
 * - 卡片居中而非全屏铺满，内容少时不会显得空洞
 * - 优雅的暗色背景 + 微弱光晕效果
 * - 支持代码预览和 Diff 两种模式
 * - 自适应内容大小，有最大尺寸限制
 */

import { memo, useState, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { diffLines } from 'diff'
import { CloseIcon } from './Icons'
import { CopyButton } from './ui'
import { detectLanguage } from '../utils/languageUtils'
import { DiffViewer, extractContentFromUnifiedDiff, type ViewMode } from './DiffViewer'
import { CodePreview } from './FileExplorer'

// ============================================
// Types
// ============================================

export type ViewerMode = 'code' | 'diff'

interface BaseProps {
  isOpen: boolean
  onClose: () => void
  filePath?: string
  language?: string
}

interface CodeViewerProps extends BaseProps {
  mode: 'code'
  content: string
}

interface DiffViewerProps extends BaseProps {
  mode: 'diff'
  diff: { before: string; after: string } | string
  diffStats?: { additions: number; deletions: number }
}

export type FullscreenViewerProps = CodeViewerProps | DiffViewerProps

// ============================================
// Main Component
// ============================================

export const FullscreenViewer = memo(function FullscreenViewer(props: FullscreenViewerProps) {
  const { isOpen, onClose, filePath, language } = props
  
  const [shouldRender, setShouldRender] = useState(false)
  const [isVisible, setIsVisible] = useState(false)
  const [diffViewMode, setDiffViewMode] = useState<ViewMode>('split')

  // 响应式 diff view mode
  useEffect(() => {
    if (props.mode !== 'diff') return
    const checkWidth = () => setDiffViewMode(window.innerWidth >= 1000 ? 'split' : 'unified')
    checkWidth()
    window.addEventListener('resize', checkWidth)
    return () => window.removeEventListener('resize', checkWidth)
  }, [props.mode])

  // 动画控制
  useEffect(() => {
    if (isOpen) {
      setShouldRender(true)
    } else {
      setIsVisible(false)
      const timer = setTimeout(() => setShouldRender(false), 200)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  useEffect(() => {
    if (shouldRender && isOpen) {
      const timer = setTimeout(() => setIsVisible(true), 10)
      return () => clearTimeout(timer)
    }
  }, [shouldRender, isOpen])

  // ESC 关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  // 点击背景关闭
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose()
  }, [onClose])

  // 解析内容
  const { content, resolvedDiff, diffStats, lang, fileName, lineCount } = useMemo(() => {
    const lang = language || detectLanguage(filePath) || 'text'
    const fileName = filePath?.split(/[/\\]/).pop()
    
    if (props.mode === 'code') {
      const lines = props.content.split('\n').length
      return { 
        content: props.content, 
        resolvedDiff: null, 
        diffStats: null, 
        lang, 
        fileName,
        lineCount: lines,
      }
    }
    
    // Diff mode
    const diff = props.diff
    const resolved = typeof diff === 'object' ? diff : extractContentFromUnifiedDiff(diff)
    
    // 计算 diff stats
    let stats = props.diffStats
    if (!stats) {
      const changes = diffLines(resolved.before, resolved.after)
      let additions = 0, deletions = 0
      for (const c of changes) {
        if (c.added) additions += c.count || 0
        if (c.removed) deletions += c.count || 0
      }
      stats = { additions, deletions }
    }
    
    const maxLines = Math.max(
      resolved.before.split('\n').length,
      resolved.after.split('\n').length
    )
    
    return { 
      content: null, 
      resolvedDiff: resolved, 
      diffStats: stats, 
      lang, 
      fileName,
      lineCount: maxLines,
    }
  }, [props, language, filePath])

  if (!shouldRender) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 transition-all duration-200 ease-out"
      style={{
        backgroundColor: isVisible ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0)',
        backdropFilter: isVisible ? 'blur(2px)' : 'blur(0px)',
      }}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
    >

      {/* 卡片 - 自适应高度 */}
      <div
        className="relative flex flex-col bg-bg-100 border border-border-200/60 rounded-lg shadow-2xl overflow-hidden transition-all duration-200 ease-out"
        style={{
          width: 'min(96vw, 1400px)',
          maxHeight: 'min(90vh, 1000px)',
          opacity: isVisible ? 1 : 0,
          transform: isVisible ? 'scale(1) translateY(0)' : 'scale(0.98) translateY(4px)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between h-11 px-4 border-b border-border-100/60 bg-bg-200/30 shrink-0">
          {/* Left: file info */}
          <div className="flex items-center gap-3 min-w-0">
            {fileName && (
              <span className="text-text-100 font-mono text-[13px] font-medium truncate">
                {fileName}
              </span>
            )}
            {filePath && fileName && filePath !== fileName && (
              <span className="text-text-500 font-mono text-[11px] truncate hidden sm:block">
                {filePath}
              </span>
            )}
            
            {/* Diff stats */}
            {diffStats && (
              <div className="flex items-center gap-1.5 text-[11px] font-mono tabular-nums shrink-0">
                {diffStats.additions > 0 && <span className="text-success-100">+{diffStats.additions}</span>}
                {diffStats.deletions > 0 && <span className="text-danger-100">-{diffStats.deletions}</span>}
              </div>
            )}
            
            {/* Line count for code */}
            {props.mode === 'code' && (
              <span className="text-text-500 text-[11px] font-mono">
                {lineCount} lines
              </span>
            )}
          </div>

          {/* Right: controls */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Copy button for code */}
            {props.mode === 'code' && content && (
              <CopyButton text={content} position="static" />
            )}
            
            {/* View mode switch for diff */}
            {props.mode === 'diff' && (
              <>
                <ViewModeSwitch viewMode={diffViewMode} onChange={setDiffViewMode} />
                <div className="w-px h-4 bg-border-200/40" />
              </>
            )}
            
            <button
              onClick={onClose}
              className="p-1.5 text-text-400 hover:text-text-100 hover:bg-bg-300/60 rounded-lg transition-colors"
              title="Close (Esc)"
            >
              <CloseIcon size={16} />
            </button>
          </div>
        </div>

        {/* Content - 用 max-height 限制，减去 header 44px */}
        <div 
          className="overflow-auto custom-scrollbar"
          style={{ maxHeight: 'calc(min(90vh, 1000px) - 44px)' }}
        >
          {props.mode === 'diff' && resolvedDiff ? (
            <DiffViewer
              before={resolvedDiff.before}
              after={resolvedDiff.after}
              language={lang}
              viewMode={diffViewMode}
              autoHeight
            />
          ) : props.mode === 'code' && content ? (
            <CodePreview
              code={content}
              language={lang}
              truncateLines={false}
            />
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  )
})

// ============================================
// ViewModeSwitch - 导出供其他组件使用
// ============================================

export function ViewModeSwitch({
  viewMode,
  onChange,
}: {
  viewMode: ViewMode
  onChange: (mode: ViewMode) => void
}) {
  return (
    <div className="flex items-center bg-bg-300/50 rounded-lg p-0.5 text-[11px]">
      <button
        className={`px-2.5 py-1 rounded-md transition-all ${
          viewMode === 'split'
            ? 'bg-bg-100 text-text-100 shadow-sm'
            : 'text-text-400 hover:text-text-200'
        }`}
        onClick={() => onChange('split')}
      >
        Split
      </button>
      <button
        className={`px-2.5 py-1 rounded-md transition-all ${
          viewMode === 'unified'
            ? 'bg-bg-100 text-text-100 shadow-sm'
            : 'text-text-400 hover:text-text-200'
        }`}
        onClick={() => onChange('unified')}
      >
        Unified
      </button>
    </div>
  )
}

// ============================================
// Convenience exports
// ============================================

/** 简化的代码查看器 */
export function CodeViewer(props: Omit<CodeViewerProps, 'mode'>) {
  return <FullscreenViewer {...props} mode="code" />
}

/** 简化的 Diff 查看器 */
export function DiffModalViewer(props: Omit<DiffViewerProps, 'mode'>) {
  return <FullscreenViewer {...props} mode="diff" />
}
