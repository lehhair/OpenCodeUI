import { memo, useState } from 'react'
import { RetryIcon, CompactIcon, PatchIcon, ChevronDownIcon, FileIcon } from '../../../components/Icons'
import { useDelayedRender } from '../../../hooks/useDelayedRender'
import type { RetryPart, CompactionPart, PatchPart } from '../../../types/message'

// ============================================
// Retry Part View - 显示重试状态
// ============================================

interface RetryPartViewProps {
  part: RetryPart
}

export const RetryPartView = memo(function RetryPartView({ part }: RetryPartViewProps) {
  const [expanded, setExpanded] = useState(false)
  const shouldRenderBody = useDelayedRender(expanded)
  const { attempt, error, time } = part
  
  const timeStr = new Date(time.created).toLocaleTimeString()
  const isRetryable = error.data.isRetryable
  
  return (
    <div className="my-2 px-3 py-2 rounded-lg bg-warning-100/10 border border-warning-100/20">
      <div 
        className="flex items-center gap-2 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <RetryIcon className="w-4 h-4 text-warning-100 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-sm text-warning-100">
            Retry attempt {attempt}
          </span>
          <span className="text-xs text-text-500 ml-2">
            {timeStr}
          </span>
        </div>
        {isRetryable && (
          <span className="text-[10px] text-warning-100/70 bg-warning-100/10 px-1.5 py-0.5 rounded">
            Retryable
          </span>
        )}
        <ChevronDownIcon className={`w-4 h-4 text-text-400 transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`} />
      </div>
      
      <div className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${
        expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
      }`}>
        <div className="overflow-hidden">
          {shouldRenderBody && (
            <div className="mt-2 pt-2 border-t border-warning-100/20">
              <p className="text-xs text-text-300 break-all">
                {error.data.message}
              </p>
              {error.data.statusCode && (
                <p className="text-[10px] text-text-500 mt-1">
                  Status: {error.data.statusCode}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
})

// ============================================
// Compaction Part View - 显示上下文压缩
// ============================================

interface CompactionPartViewProps {
  part: CompactionPart
}

export const CompactionPartView = memo(function CompactionPartView({ part }: CompactionPartViewProps) {
  const isAuto = part.auto
  
  return (
    <div className="my-2 flex items-center gap-2 px-3 py-1.5 text-xs text-text-500">
      <div className="flex-1 h-px bg-border-200" />
      <CompactIcon className="w-3.5 h-3.5" />
      <span>
        Context {isAuto ? 'auto-' : ''}compacted
      </span>
      <div className="flex-1 h-px bg-border-200" />
    </div>
  )
})

// ============================================
// Patch Part View - 显示文件变更补丁
// ============================================

interface PatchPartViewProps {
  part: PatchPart
}

export const PatchPartView = memo(function PatchPartView({ part }: PatchPartViewProps) {
  const [expanded, setExpanded] = useState(false)
  const shouldRenderBody = useDelayedRender(expanded)
  const { hash, files } = part
  const fileCount = files.length
  
  return (
    <div className="my-2 rounded-lg border border-border-200/60 bg-bg-100/50 overflow-hidden">
      <div 
        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-bg-200/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <PatchIcon className="w-4 h-4 text-text-400 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-sm text-text-200">
            {fileCount} file{fileCount !== 1 ? 's' : ''} changed
          </span>
          <span className="text-xs text-text-500 ml-2">
            {hash.slice(0, 7)}
          </span>
        </div>
        <ChevronDownIcon className={`w-4 h-4 text-text-400 transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`} />
      </div>
      
      <div className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${
        expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
      }`}>
        <div className="overflow-hidden">
          {shouldRenderBody && (
            <div className="px-3 py-2 border-t border-border-200/40 space-y-1">
              {files.map((file, idx) => (
                <div key={idx} className="flex items-center gap-2 text-xs">
                  <FileIcon className="w-3 h-3 text-text-500" />
                  <span className="text-text-300 truncate">{file}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
})
