/**
 * MultiFileDiffModal - 全屏多文件 Diff 查看器
 * 
 * VSCode 风格：全屏铺满 + 毛玻璃背景 + 左侧文件列表 + 右侧 Diff
 */

import { memo, useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { CloseIcon, FileIcon } from './Icons'
import { DiffViewer, type ViewMode } from './DiffViewer'
import { ViewModeSwitch } from './FullscreenViewer'
import { getSessionDiff } from '../api/session'
import type { FileDiff } from '../api/types'
import { detectLanguage } from '../utils/languageUtils'

// ============================================
// Types
// ============================================

interface MultiFileDiffModalProps {
  isOpen: boolean
  onClose: () => void
  sessionId: string
}

// ============================================
// Main Component
// ============================================

export const MultiFileDiffModal = memo(function MultiFileDiffModal({
  isOpen,
  onClose,
  sessionId,
}: MultiFileDiffModalProps) {
  const [shouldRender, setShouldRender] = useState(false)
  const [isVisible, setIsVisible] = useState(false)

  const [loading, setLoading] = useState(false)
  const [diffs, setDiffs] = useState<FileDiff[]>([])
  const [selectedFileIndex, setSelectedFileIndex] = useState(0)
  const [viewMode, setViewMode] = useState<ViewMode>('split')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const checkWidth = () => setViewMode(window.innerWidth >= 1200 ? 'split' : 'unified')
    checkWidth()
    window.addEventListener('resize', checkWidth)
    return () => window.removeEventListener('resize', checkWidth)
  }, [])

  useEffect(() => {
    if (isOpen && sessionId) {
      setLoading(true)
      setError(null)
      getSessionDiff(sessionId)
        .then(data => {
          setDiffs(data)
          if (data.length > 0) setSelectedFileIndex(0)
        })
        .catch(err => {
          console.error('Failed to load session diff:', err)
          setError('Failed to load changes')
        })
        .finally(() => setLoading(false))
    }
  }, [isOpen, sessionId])

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

  const selectedDiff = diffs[selectedFileIndex]
  const language = selectedDiff ? detectLanguage(selectedDiff.file) || 'text' : 'text'

  const stats = useMemo(() => {
    let additions = 0, deletions = 0
    diffs.forEach(d => { additions += d.additions; deletions += d.deletions })
    return { additions, deletions, files: diffs.length }
  }, [diffs])

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
        <div className="flex items-center gap-4 min-w-0">
          <span className="text-text-100 font-medium text-[13px]">Session Changes</span>
          <div className="flex items-center gap-3 text-[11px] font-mono text-text-400 tabular-nums">
            <span>{stats.files} file{stats.files !== 1 ? 's' : ''}</span>
            {(stats.additions > 0 || stats.deletions > 0) && (
              <div className="flex items-center gap-1.5">
                {stats.additions > 0 && <span className="text-success-100">+{stats.additions}</span>}
                {stats.deletions > 0 && <span className="text-danger-100">-{stats.deletions}</span>}
              </div>
            )}
          </div>
        </div>

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

      {/* Body */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Sidebar */}
        <div className="w-56 border-r border-border-100/30 flex flex-col shrink-0">
          <div className="flex-1 overflow-y-auto custom-scrollbar py-1">
            {loading ? (
              <div className="p-4 text-center text-text-400 text-xs">Loading...</div>
            ) : error ? (
              <div className="p-4 text-center text-danger-100 text-xs">{error}</div>
            ) : diffs.length === 0 ? (
              <div className="p-4 text-center text-text-400 text-xs">No changes found</div>
            ) : (
              diffs.map((d, idx) => {
                const name = d.file.split(/[/\\]/).pop() || d.file
                const isSelected = selectedFileIndex === idx

                return (
                  <button
                    key={idx}
                    onClick={() => setSelectedFileIndex(idx)}
                    className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors ${
                      isSelected
                        ? 'bg-accent-main-100/10 text-text-100'
                        : 'text-text-300 hover:bg-bg-200/40 hover:text-text-200'
                    }`}
                  >
                    <FileIcon
                      size={13}
                      className={isSelected ? 'text-accent-main-100 shrink-0' : 'text-text-500 shrink-0'}
                    />
                    <span className="font-mono truncate flex-1">{name}</span>
                    <div className="flex items-center gap-1 text-[10px] font-mono tabular-nums shrink-0">
                      {d.additions > 0 && <span className="text-success-100">+{d.additions}</span>}
                      {d.deletions > 0 && <span className="text-danger-100">-{d.deletions}</span>}
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </div>

        {/* Diff View */}
        <div className="flex-1 flex flex-col min-w-0">
          {selectedDiff ? (
            <>
              {/* File path bar */}
              <div className="h-8 px-4 border-b border-border-100/20 flex items-center justify-between shrink-0">
                <span className="font-mono text-[11px] text-text-300 truncate">{selectedDiff.file}</span>
                <div className="flex items-center gap-1.5 text-[10px] font-mono tabular-nums shrink-0">
                  {selectedDiff.additions > 0 && <span className="text-success-100">+{selectedDiff.additions}</span>}
                  {selectedDiff.deletions > 0 && <span className="text-danger-100">-{selectedDiff.deletions}</span>}
                </div>
              </div>

              <div className="flex-1 min-h-0">
                <DiffViewer
                  before={selectedDiff.before}
                  after={selectedDiff.after}
                  language={language}
                  viewMode={viewMode}
                />
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-text-400 text-xs">
              {loading ? 'Loading changes...' : 'Select a file to view changes'}
            </div>
          )}
        </div>
      </div>
      </div>
    </div>,
    document.body
  )
})
