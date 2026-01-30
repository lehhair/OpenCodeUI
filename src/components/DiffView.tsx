import { memo, useState, useEffect, useMemo } from 'react'
import { diffLines } from 'diff'
import { ChevronDownIcon } from './Icons'
import { clsx } from 'clsx'
import { useSyntaxHighlight } from '../hooks/useSyntaxHighlight'
import { detectLanguage } from '../utils/languageUtils'
import { syntaxErrorHandler } from '../utils'

interface DiffViewProps {
  /** Unified diff format string */
  diff?: string
  /** Original content */
  before?: string
  /** New content */
  after?: string
  /** File path for title and language detection */
  filePath?: string
  /** Default collapsed state */
  defaultCollapsed?: boolean
  /** Max height of the diff view */
  maxHeight?: number
  /** Explicit language */
  language?: string
}

interface DiffLine {
  type: 'add' | 'delete' | 'context'
  content: string // HTML content string
  oldLineNo?: number
  newLineNo?: number
}

// Simple HTML escaper
function escapeHtml(str: string) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

// Parse start line numbers from unified diff string
function getStartLine(diffString?: string): { old: number, new: number } {
  if (!diffString) return { old: 1, new: 1 }
  // Match the first hunk header: @@ -1,1 +1,2 @@
  const match = diffString.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/m)
  if (match) {
    return { old: parseInt(match[1], 10), new: parseInt(match[2], 10) }
  }
  return { old: 1, new: 1 }
}

// Extract content (before/after) from unified diff string
function extractContentFromDiff(diff: string): { before: string, after: string } {
  const lines = diff.split('\n');
  let before = '';
  let after = '';
  
  for (const line of lines) {
    if (line.startsWith('Index:')) continue;
    if (line.startsWith('===')) continue;
    if (line.startsWith('---')) continue;
    if (line.startsWith('+++')) continue;
    if (line.startsWith('@@')) continue; 
    if (line.startsWith('\\ No newline')) continue;
    
    if (line.startsWith(' ')) {
      const content = line.slice(1) + '\n';
      before += content;
      after += content;
    } else if (line.startsWith('-')) {
      const content = line.slice(1) + '\n';
      before += content;
    } else if (line.startsWith('+')) {
      const content = line.slice(1) + '\n';
      after += content;
    }
  }
  
  return { before: before.trimEnd(), after: after.trimEnd() };
}

// Hook to highlight code using tokens API (Robust)
function useHighlightedDiff(before: string, after: string, language: string) {
  // Use generic hooks for highlighting
  const { output: oldTokens } = useSyntaxHighlight(before, { lang: language, mode: 'tokens' })
  const { output: newTokens } = useSyntaxHighlight(after, { lang: language, mode: 'tokens' })
  
  const [result, setResult] = useState<{ 
    lines: DiffLine[], 
    stats: { additions: number, deletions: number } 
  } | null>(null)

  useEffect(() => {
    // If tokens are not ready or reset, reset result
    if (!oldTokens || !newTokens) {
      setResult(null)
      return
    }

    try {
        // 1. Calculate diff on raw text
        const changes = diffLines(before, after, { newlineIsToken: false })
        
        // 2. Convert tokens to HTML strings per line
        const tokensToHtmlLines = (tokenLines: any[][]) => {
          return tokenLines.map(lineTokens => {
             if (lineTokens.length === 0) return ' ' // Empty line
             return lineTokens.map(t => 
               `<span style="color:${t.color}">${escapeHtml(t.content)}</span>`
             ).join('')
          })
        }

        const oldLinesHtml = tokensToHtmlLines(oldTokens)
        const newLinesHtml = tokensToHtmlLines(newTokens)

        // 3. Map diff changes to highlighted lines
        const finalLines: DiffLine[] = []
        let oldIndex = 0
        let newIndex = 0
        let additions = 0
        let deletions = 0

        for (const change of changes) {
          const count = change.count || 0
          
          if (change.removed) {
            deletions += count
            for (let i = 0; i < count; i++) {
              finalLines.push({
                type: 'delete',
                content: oldLinesHtml[oldIndex + i] || ' ', 
                oldLineNo: oldIndex + i + 1
              })
            }
            oldIndex += count
          } else if (change.added) {
            additions += count
            for (let i = 0; i < count; i++) {
              finalLines.push({
                type: 'add',
                content: newLinesHtml[newIndex + i] || ' ', 
                newLineNo: newIndex + i + 1
              })
            }
            newIndex += count
          } else {
            // Context (unchanged)
            for (let i = 0; i < count; i++) {
              finalLines.push({
                type: 'context',
                content: newLinesHtml[newIndex + i] || ' ', // Prefer new version for context
                oldLineNo: oldIndex + i + 1,
                newLineNo: newIndex + i + 1
              })
            }
            oldIndex += count
            newIndex += count
          }
        }

        setResult({
          lines: finalLines,
          stats: { additions, deletions }
        })

    } catch (err) {
        syntaxErrorHandler('diff highlighting', err)
    }
  }, [before, after, oldTokens, newTokens])

  return result
}

export const DiffView = memo(function DiffView({
  diff,
  before,
  after,
  filePath,
  defaultCollapsed = false,
  maxHeight = 300,
  language: explicitLanguage
}: DiffViewProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  
  // Determine content to diff
  const content = useMemo(() => {
    if (before !== undefined && after !== undefined) {
      return { before, after }
    }
    if (diff) {
      return extractContentFromDiff(diff)
    }
    return null
  }, [before, after, diff])

  const hasContent = content !== null
  
  // Hook calls must be unconditional
  const language = useMemo(() => {
    return explicitLanguage || detectLanguage(filePath)
  }, [filePath, explicitLanguage])

  const diffResult = useHighlightedDiff(content?.before || '', content?.after || '', language)
  
  // Calculate start lines from unified diff header to show correct line numbers
  const startLines = useMemo(() => getStartLine(diff), [diff])

  // Fallback for unified diff string only (should rarely happen now as we extract content)
  if (!hasContent && diff) {
     return (
        <div className="border border-border-200/50 rounded-lg bg-bg-100 overflow-auto p-2 text-xs font-mono whitespace-pre text-text-200">
           {diff}
        </div>
     )
  }

  if (!hasContent) return null
  
  // Loading state
  if (hasContent && !diffResult) {
    return (
      <div className="border border-border-200/50 rounded-lg bg-bg-100 p-4 text-center text-text-300 text-xs animate-pulse">
        Generating diff...
      </div>
    )
  }

  const { lines, stats } = diffResult!
  const fileName = filePath ? filePath.split(/[/\\]/).pop() : undefined

  return (
    <div className="border border-border-200/50 rounded-lg overflow-hidden bg-bg-100 font-mono text-xs">
      {/* Header */}
      <div 
        className="flex items-center justify-between px-3 py-2 bg-bg-200/50 cursor-pointer hover:bg-bg-200 transition-colors select-none"
        onClick={() => setCollapsed(!collapsed)}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className={`transition-transform duration-200 ${collapsed ? '' : 'rotate-180'} text-text-400`}>
             <ChevronDownIcon />
          </div>
          {fileName && (
            <span className="text-text-200 font-medium truncate">{fileName}</span>
          )}
        </div>
        <div className="flex items-center gap-3 tabular-nums font-medium">
          {stats.additions > 0 && (
            <span className="text-success-100">+{stats.additions}</span>
          )}
          {stats.deletions > 0 && (
            <span className="text-danger-100">-{stats.deletions}</span>
          )}
          {stats.additions === 0 && stats.deletions === 0 && (
             <span className="text-text-400">No changes</span>
          )}
        </div>
      </div>

      {/* Content - 使用 grid 实现平滑展开动画 */}
      <div className={clsx(
        "grid transition-[grid-template-rows] duration-300 ease-in-out",
        collapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]"
      )}>
        <div className="overflow-hidden">
          <div 
            className="overflow-auto custom-scrollbar"
            style={{ maxHeight }}
          >
            <table className="w-full border-collapse table-fixed">
              <colgroup>
                <col className="w-[40px]" />
                <col className="w-[40px]" />
                <col className="w-full" />
              </colgroup>
              <tbody>
                {lines.map((line, idx) => (
                  <tr 
                    key={idx} 
                    className={clsx(
                      "hover:bg-opacity-50 transition-colors",
                      line.type === 'add' && "bg-success-bg",
                      line.type === 'delete' && "bg-danger-bg",
                      line.type === 'context' && "bg-transparent"
                    )}
                  >
                    {/* Old Line Number */}
                    <td className="px-2 py-0.5 text-right text-text-500 border-r border-border-200/10 select-none opacity-50 tabular-nums align-top">
                      {line.type !== 'add' && (line.oldLineNo! + startLines.old - 1)}
                    </td>
                    
                    {/* New Line Number */}
                    <td className="px-2 py-0.5 text-right text-text-500 border-r border-border-200/10 select-none opacity-50 tabular-nums align-top">
                      {line.type !== 'delete' && (line.newLineNo! + startLines.new - 1)}
                    </td>

                    {/* Code Content */}
                    <td className="px-4 py-0.5 relative group overflow-hidden align-top">
                      {/* Indicator for add/delete */}
                      {(line.type === 'add' || line.type === 'delete') && (
                        <span className={clsx(
                          "absolute left-1 top-0.5 select-none font-bold opacity-70",
                          line.type === 'add' ? "text-success-100" : "text-danger-100"
                        )}>
                          {line.type === 'add' ? '+' : '-'}
                        </span>
                      )}
                      
                      {/* The code itself */}
                      <div 
                        className="whitespace-pre break-all font-mono"
                        dangerouslySetInnerHTML={{ __html: line.content }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
})
