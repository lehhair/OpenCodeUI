/**
 * DiffModal - 全屏 Diff 查看器
 * 
 * VSCode 风格：全屏铺满 + 毛玻璃背景 + 顶部操作栏
 */

import { memo, useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { diffLines } from 'diff'
import { CloseIcon } from './Icons'
import { detectLanguage } from '../utils/languageUtils'
import { DiffViewer, extractContentFromUnifiedDiff, type ViewMode } from './DiffViewer'

// ============================================
// Types
// ============================================

interface DiffModalProps {
  isOpen: boolean
  onClose: () => void
  diff: { before: string; after: string } | string
  filePath?: string
  language?: string
  diffStats?: { additions: number; deletions: number }
}

// ============================================
// Main Component
// ============================================

export const DiffModal = memo(function DiffModal({
  isOpen,
  onClose,
  diff,
  filePath,
  language,
  diffStats: providedStats,
}: DiffModalProps) {
  const [shouldRender, setShouldRender] = useState(false)
  const [isVisible, setIsVisible] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('split')

  useEffect(() => {
    const checkWidth = () => setViewMode(window.innerWidth >= 1000 ? 'split' : 'unified')
    checkWidth()
    window.addEventListener('resize', checkWidth)
    return () => window.removeEventListener('resize', checkWidth)
  }, [])

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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  const { before, after } = useMemo(() => {
    if (typeof diff === 'object') return diff
    return extractContentFromUnifiedDiff(diff)
  }, [diff])

  const lang = language || detectLanguage(filePath) || 'text'
  const fileName = filePath?.split(/[/\\]/).pop()

  const diffStats = useMemo(() => {
    if (providedStats) return providedStats
    const changes = diffLines(before, after)
    let additions = 0, deletions = 0
    for (const c of changes) {
      if (c.added) additions += c.count || 0
      if (c.removed) deletions += c.count || 0
    }
    return { additions, deletions }
  }, [before, after, providedStats])

  if (!shouldRender) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center transition-all duration-200 ease-out"
      style={{
        backgroundColor: isVisible ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0)',
        backdropFilter: isVisible ? 'blur(2px)' : 'blur(0px)',
      }}
      role="dialog"
      aria-modal="true"
    >
      {/* 内容面板 - 全屏铺满但有不透明背景 */}
      <div
        className="w-full h-full flex flex-col bg-bg-000 transition-all duration-200 ease-out"
        style={{
          opacity: isVisible ? 1 : 0,
          transform: isVisible ? 'scale(1)' : 'scale(0.98)',
        }}
      >
      {/* Toolbar */}
      <div className="flex items-center justify-between h-11 px-4 border-b border-border-100/40 shrink-0">
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
          <div className="flex items-center gap-1.5 text-[11px] font-mono tabular-nums shrink-0">
            {diffStats.additions > 0 && <span className="text-success-100">+{diffStats.additions}</span>}
            {diffStats.deletions > 0 && <span className="text-danger-100">-{diffStats.deletions}</span>}
          </div>
        </div>

        {/* Right: controls */}
        <div className="flex items-center gap-2 shrink-0">
          <ViewModeSwitch viewMode={viewMode} onChange={setViewMode} />
          <div className="w-px h-4 bg-border-200/30" />
          <button
            onClick={onClose}
            className="p-1 text-text-400 hover:text-text-100 hover:bg-bg-200/60 rounded-md transition-colors"
            title="Close (Esc)"
          >
            <CloseIcon size={16} />
          </button>
        </div>
      </div>

      {/* Diff — 填满剩余空间 */}
      <div className="flex-1 min-h-0">
        <DiffViewer
          before={before}
          after={after}
          language={lang}
          viewMode={viewMode}
        />
      </div>
      </div>
    </div>,
    document.body
  )
})

// ============================================
// ViewModeSwitch
// ============================================

export function ViewModeSwitch({
  viewMode,
  onChange,
}: {
  viewMode: ViewMode
  onChange: (mode: ViewMode) => void
}) {
  return (
    <div className="flex items-center bg-bg-200/60 rounded-md p-0.5 text-[11px]">
      <button
        className={`px-2 py-0.5 rounded transition-colors ${
          viewMode === 'split'
            ? 'bg-bg-000 text-text-100 shadow-sm'
            : 'text-text-400 hover:text-text-200'
        }`}
        onClick={() => onChange('split')}
      >
        Split
      </button>
      <button
        className={`px-2 py-0.5 rounded transition-colors ${
          viewMode === 'unified'
            ? 'bg-bg-000 text-text-100 shadow-sm'
            : 'text-text-400 hover:text-text-200'
        }`}
        onClick={() => onChange('unified')}
      >
        Unified
      </button>
    </div>
  )
}
