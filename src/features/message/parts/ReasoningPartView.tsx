import { memo, useState, useRef, useEffect, useMemo } from 'react'
import { ChevronDownIcon, LightbulbIcon, SpinnerIcon } from '../../../components/Icons'
import { ScrollArea } from '../../../components/ui'
import { useDelayedRender } from '../../../hooks'
import { useTheme } from '../../../hooks/useTheme'
import { useSmoothStream } from '../../../hooks/useSmoothStream'
import type { ReasoningPart } from '../../../types/message'

interface ReasoningPartViewProps {
  part: ReasoningPart
  isStreaming?: boolean
}

export const ReasoningPartView = memo(function ReasoningPartView({ part, isStreaming }: ReasoningPartViewProps) {
  if (!part.text?.trim()) return null
  const { reasoningDisplayMode } = useTheme()
  const rawText = part.text || ''
  
  const isPartStreaming = isStreaming && !part.time?.end
  const hasContent = !!rawText.trim()
  
  // 使用 smooth streaming 实现打字机效果
  const { displayText } = useSmoothStream(
    rawText,
    !!isPartStreaming,
    { charDelay: 6, disableAnimation: !isPartStreaming }  // 稍快一点，因为是思考过程
  )
  const [expanded, setExpanded] = useState(false)
  const shouldRenderBody = useDelayedRender(expanded)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const collapsedPreview = useMemo(
    () => (displayText || '').replace(/\s+/g, ' ').trim(),
    [displayText]
  )
  const thoughtDurationLabel = useMemo(() => {
    const start = part.time?.start
    const end = part.time?.end
    if (!start || !end || end <= start) return null
    const durationMs = end - start
    if (durationMs < 1000) return `${Math.max(1, Math.round(durationMs))}ms`
    if (durationMs < 10000) return `${(durationMs / 1000).toFixed(1)}s`
    return `${Math.round(durationMs / 1000)}s`
  }, [part.time?.start, part.time?.end])

  useEffect(() => {
    if (isPartStreaming && hasContent) {
      setExpanded(true)
    } else if (!isPartStreaming) {
      setExpanded(false)
    }
  }, [isPartStreaming, hasContent])

  useEffect(() => {
    if (reasoningDisplayMode !== 'capsule') return
    if (isPartStreaming && expanded && scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight
    }
  }, [displayText, isPartStreaming, expanded, reasoningDisplayMode])

  if (reasoningDisplayMode === 'italic') {
    const summaryText = collapsedPreview || (isPartStreaming ? 'Thinking...' : '')
    const shouldUseToggle = isPartStreaming || /[\r\n]/.test(rawText) || summaryText.length > 84
    const expandedMetaText = isPartStreaming
      ? 'Thinking...'
      : thoughtDurationLabel
        ? `Thought for ${thoughtDurationLabel}`
        : 'Thought process'

    return (
      <div className="py-1">
        <div className="grid grid-cols-[14px_minmax(0,1fr)] gap-x-1.5 items-start">
          <span className="inline-flex h-5 w-[14px] items-center justify-center text-text-500">
            {isPartStreaming ? (
              <SpinnerIcon className="animate-spin" size={14} />
            ) : (
              <LightbulbIcon size={14} />
            )}
          </span>

          <div className="min-w-0">
            {shouldUseToggle ? (
              <>
                <button
                  type="button"
                  onClick={() => setExpanded(!expanded)}
                  aria-expanded={expanded}
                  className="group w-full m-0 p-0 border-0 bg-transparent flex items-center gap-2 text-left cursor-pointer text-text-400 hover:text-text-200"
                >
                  <span className={`min-w-0 flex-1 italic ${
                    expanded
                      ? 'text-[12px] leading-5 text-text-500/80'
                      : 'text-[12px] leading-5 text-text-300 whitespace-nowrap overflow-hidden text-ellipsis'
                  }`}>
                    {expanded ? expandedMetaText : summaryText}
                  </span>
                  <span className={`inline-flex h-5 w-3 items-center justify-center shrink-0 text-text-500/60 group-hover:text-text-300 transition-[transform,color] duration-200 relative -top-px ${expanded ? 'rotate-180' : ''}`}>
                    <ChevronDownIcon size={12} />
                  </span>
                </button>

                <div className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
                  expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-75'
                }`}>
                  <div className="overflow-hidden">
                    {shouldRenderBody && (
                      <div className="pt-0.5 text-[12px] leading-6 italic text-text-300 whitespace-pre-wrap break-words">
                        {displayText}
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="flex items-start gap-2 text-text-400">
                <span className="min-w-0 flex-1 text-[12px] leading-5 italic text-text-300 whitespace-pre-wrap break-words">
                  {displayText}
                </span>
                <span className="inline-flex h-5 w-3 shrink-0" aria-hidden="true" />
              </div>
            )}
          </div>
        </div>

        <span className="sr-only" role="status" aria-live="polite">
          {summaryText}
        </span>
      </div>
    )
  }

  return (
    <div className={`border border-border-300/20 rounded-xl overflow-hidden transition-all duration-300 ease-out -ml-3 ${
      expanded ? 'w-[calc(100%+1.5rem)]' : 'w-[260px]'
    }`}>
      <button
        onClick={() => setExpanded(!expanded)}
        disabled={!hasContent && !isPartStreaming} // 没内容且没流式时禁用点击（其实这种情况下组件都不渲染了）
        className={`w-full flex items-center gap-1.5 pl-0 pr-3 py-2 text-text-400 hover:bg-bg-200/50 transition-colors ${
          !hasContent ? 'cursor-default' : ''
        }`}
      >
        <span className="inline-flex h-5 w-[14px] items-center justify-center shrink-0">
          {isPartStreaming ? (
            <SpinnerIcon className="animate-spin shrink-0" size={14} />
          ) : (
            <LightbulbIcon className="shrink-0" size={14} />
          )}
        </span>
        <span className="text-xs font-medium leading-none whitespace-nowrap">
          {isPartStreaming ? 'Thinking...' : 'Thinking'}
        </span>
        {isPartStreaming && (
          <span className="flex items-center gap-0.5 ml-1">
            <span className="w-1 h-1 bg-text-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
            <span className="w-1 h-1 bg-text-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
            <span className="w-1 h-1 bg-text-400 rounded-full animate-bounce" />
          </span>
        )}
        <span className={`ml-auto transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`}>
          <ChevronDownIcon />
        </span>
      </button>
      
        <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${
          expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}>
          <div className="overflow-hidden">
            {shouldRenderBody && (
              <ScrollArea ref={scrollAreaRef} maxHeight={192} className="border-t border-border-300/20 bg-bg-200/30">
                <div className="pl-4 pr-3 py-2 text-text-300 text-xs font-mono whitespace-pre-wrap">
                  {displayText}
                </div>
              </ScrollArea>
          )}
        </div>
      </div>
    </div>
  )
})
