import { memo, useState, useEffect, useCallback } from 'react'
import { ChevronDownIcon, ChevronRightIcon, FileIcon } from './Icons'
import { DiffViewer, type ViewMode } from './DiffViewer'
import { getSessionDiff } from '../api/session'
import type { FileDiff } from '../api/types'
import { detectLanguage } from '../utils/languageUtils'

interface SessionChangesPanelProps {
  sessionId: string
}

export const SessionChangesPanel = memo(function SessionChangesPanel({
  sessionId,
}: SessionChangesPanelProps) {
  const [loading, setLoading] = useState(false)
  const [diffs, setDiffs] = useState<FileDiff[]>([])
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('unified')

  // 加载数据
  useEffect(() => {
    if (sessionId) {
      setLoading(true)
      setError(null)
      getSessionDiff(sessionId)
        .then(data => {
          setDiffs(data)
          // 默认展开第一个
          if (data.length > 0) {
            setExpandedFiles(new Set([data[0].file]))
          }
        })
        .catch(err => {
          console.error('Failed to load session diff:', err)
          setError('Failed to load changes')
        })
        .finally(() => setLoading(false))
    }
  }, [sessionId])

  const toggleFile = useCallback((file: string) => {
    setExpandedFiles(prev => {
      const newSet = new Set(prev)
      if (newSet.has(file)) {
        newSet.delete(file)
      } else {
        newSet.add(file)
      }
      return newSet
    })
  }, [])
  
  // 展开/收起所有 - 用一个按钮切换
  const allExpanded = expandedFiles.size === diffs.length && diffs.length > 0
  
  const toggleExpandAll = useCallback(() => {
    if (allExpanded) {
      setExpandedFiles(new Set())
    } else {
      setExpandedFiles(new Set(diffs.map(d => d.file)))
    }
  }, [allExpanded, diffs])

  if (loading) {
    return <div className="p-4 text-center text-text-400 text-xs">Loading changes...</div>
  }

  if (error) {
    return <div className="p-4 text-center text-danger-100 text-xs">{error}</div>
  }

  if (diffs.length === 0) {
    return <div className="p-4 text-center text-text-400 text-xs">No changes in this session</div>
  }

  // 计算总的变化统计
  const totalStats = diffs.reduce(
    (acc, d) => ({
      additions: acc.additions + d.additions,
      deletions: acc.deletions + d.deletions,
    }),
    { additions: 0, deletions: 0 }
  )

  return (
    <div className="flex flex-col h-full">
      {/* Header with controls */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border-100 bg-bg-100/30 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-text-400 uppercase tracking-wider font-bold">
            {diffs.length} file{diffs.length !== 1 ? 's' : ''}
          </span>
          <div className="flex items-center gap-2 text-[10px] font-mono">
            <span className="text-success-100">+{totalStats.additions}</span>
            <span className="text-danger-100">−{totalStats.deletions}</span>
          </div>
        </div>
        
        <div className="flex items-center gap-1">
          {/* View Mode Toggle */}
          <div className="flex items-center bg-bg-200/50 rounded overflow-hidden border border-border-200/50">
            <button
              onClick={() => setViewMode('unified')}
              className={`px-2 py-0.5 text-[10px] transition-colors ${
                viewMode === 'unified' 
                  ? 'bg-bg-000 text-text-100 shadow-sm' 
                  : 'text-text-400 hover:text-text-200'
              }`}
            >
              Unified
            </button>
            <button
              onClick={() => setViewMode('split')}
              className={`px-2 py-0.5 text-[10px] transition-colors ${
                viewMode === 'split' 
                  ? 'bg-bg-000 text-text-100 shadow-sm' 
                  : 'text-text-400 hover:text-text-200'
              }`}
            >
              Split
            </button>
          </div>
          
          {/* Expand/Collapse toggle button */}
          <button
            onClick={toggleExpandAll}
            className="p-1 text-text-400 hover:text-text-200 hover:bg-bg-200 rounded transition-colors"
            title={allExpanded ? "Collapse all" : "Expand all"}
          >
            {allExpanded ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
          </button>
        </div>
      </div>
      
      {/* File list */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {diffs.map((diff) => {
          const isExpanded = expandedFiles.has(diff.file)
          const language = detectLanguage(diff.file) || 'text'
          const fileStatus = getFileStatus(diff)
          
          return (
            <div key={diff.file} className="border-b border-border-100/50 last:border-0">
              <button
                onClick={() => toggleFile(diff.file)}
                className="w-full flex items-center gap-2 px-3 py-2 hover:bg-bg-200/50 transition-colors text-left group"
              >
                <span className="text-text-400 shrink-0">
                  {isExpanded ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
                </span>
                
                {/* File status icon */}
                <FileStatusIcon status={fileStatus} />
                
                <span className="flex-1 text-xs font-mono text-text-100 truncate">{diff.file}</span>
                
                <div className="flex items-center gap-2 text-[10px] font-mono shrink-0">
                  {diff.additions > 0 && <span className="text-success-100">+{diff.additions}</span>}
                  {diff.deletions > 0 && <span className="text-danger-100">−{diff.deletions}</span>}
                </div>
              </button>
              
              {isExpanded && (
                <div className="bg-bg-100/30 border-t border-border-100/50">
                  <DiffViewer 
                    before={diff.before} 
                    after={diff.after} 
                    language={language}
                    viewMode={viewMode}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
})

// ============================================
// File Status Helpers
// ============================================

type FileStatus = 'added' | 'modified' | 'deleted'

function getFileStatus(diff: FileDiff): FileStatus {
  if (!diff.before || diff.before.trim() === '') return 'added'
  if (!diff.after || diff.after.trim() === '') return 'deleted'
  return 'modified'
}

function FileStatusIcon({ status }: { status: FileStatus }) {
  const colorClass = {
    added: 'text-success-100',
    deleted: 'text-danger-100',
    modified: 'text-warning-100',
  }[status]
  
  return <FileIcon size={14} className={`${colorClass} shrink-0`} />
}
