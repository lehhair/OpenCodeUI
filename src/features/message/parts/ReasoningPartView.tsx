import { memo, useState, useRef, useEffect, useMemo, useCallback } from 'react'
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
  const summaryContainerRef = useRef<HTMLDivElement>(null)
  const summaryMeasureRef = useRef<HTMLSpanElement>(null)
  const [summaryOverflow, setSummaryOverflow] = useState(false)
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
  const summaryText = collapsedPreview || (isPartStreaming ? 'Thinking...' : '')
  const hasLineBreak = /[\r\n]/.test(rawText)

  const measureSummaryOverflow = useCallback(() => {
    if (reasoningDisplayMode !== 'italic') return
    const containerEl = summaryContainerRef.current
    const measureEl = summaryMeasureRef.current
    if (!containerEl || !measureEl) return
    const overflow = measureEl.scrollWidth - containerEl.clientWidth > 1
    setSummaryOverflow(prev => prev === overflow ? prev : overflow)
  }, [reasoningDisplayMode])

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

  useEffect(() => {
    if (reasoningDisplayMode !== 'italic') return
    measureSummaryOverflow()

    const raf = requestAnimationFrame(measureSummaryOverflow)
    let ro: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined' && summaryContainerRef.current) {
      ro = new ResizeObserver(measureSummaryOverflow)
      ro.observe(summaryContainerRef.current)
    }

    const fontsReady = document.fonts?.ready
    if (fontsReady && typeof fontsReady.then === 'function') {
      fontsReady.then(() => measureSummaryOverflow()).catch(() => {})
    }

    return () => {
      cancelAnimationFrame(raf)
      ro?.disconnect()
    }
  }, [reasoningDisplayMode, summaryText, measureSummaryOverflow])

  if (reasoningDisplayMode === 'italic') {
    const shouldUseToggle = isPartStreaming || hasLineBreak || summaryOverflow
    const expandedMetaText = isPartStreaming
      ? 'Thinking...'
      : thoughtDurationLabel
        ? `Thought for ${thoughtDurationLabel}`
        : 'Thought process'

    return (
      <div className="py-1">
        <div className="grid grid-cols-[14px_minmax(0,1fr)] gap-x-1.5 items-start">
          <span className="inline-flex h-5 w-[14px] items-start justify-center pt-[2px] text-text-500">
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
                  className="group w-full m-0 p-0 border-0 bg-transparent grid grid-cols-[minmax(0,1fr)_12px] items-start gap-x-2 text-left cursor-pointer text-text-400 hover:text-text-200"
                >
                  <div ref={summaryContainerRef} className="min-w-0 flex-1 relative overflow-hidden">
                    <span className={`block min-w-0 italic ${
                      expanded
                        ? 'text-[12px] leading-5 text-text-500/80'
                        : 'text-[12px] leading-5 text-text-300 whitespace-nowrap overflow-hidden text-ellipsis'
                    }`}>
                      {expanded ? expandedMetaText : summaryText}
                    </span>
                    <span
                      ref={summaryMeasureRef}
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0 invisible whitespace-nowrap text-[12px] leading-5 italic"
                    >
                      {summaryText}
                    </span>
                  </div>
                  <span className={`inline-flex h-5 w-3 items-start justify-center pt-[2px] shrink-0 text-text-500/60 group-hover:text-text-300 transition-[transform,color] duration-200 ${expanded ? 'rotate-180' : ''}`}>
                    <ChevronDownIcon size={12} />
                  </span>
                </button>

                <div className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
                  expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-75'
                }`}>
                  <div className="overflow-hidden">
                    {shouldRenderBody && (
                      <div className="pt-0.5 text-[12px] leading-6 italic text-text-300 whitespace-pre-wrap break-words overflow-x-hidden">
                        {displayText}
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="grid grid-cols-[minmax(0,1fr)_12px] items-start gap-x-2 text-text-400">
                <div ref={summaryContainerRef} className="min-w-0 flex-1 relative overflow-hidden">
                  <span className="block min-w-0 text-[12px] leading-5 italic text-text-300 whitespace-pre-wrap break-words">
                    {displayText}
                  </span>
                  <span
                    ref={summaryMeasureRef}
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 invisible whitespace-nowrap text-[12px] leading-5 italic"
                  >
                    {summaryText}
                  </span>
                </div>
                <span className="inline-flex h-5 w-3 items-start justify-center pt-[2px] shrink-0" aria-hidden="true" />
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
        className={`w-full flex items-start gap-1.5 pl-3 pr-3 py-2 text-text-400 hover:bg-bg-200/50 transition-colors ${
          !hasContent ? 'cursor-default' : ''
        }`}
      >
        <span className="inline-flex h-5 w-[14px] -ml-px items-start justify-center pt-[2px] shrink-0">
          {isPartStreaming ? (
            <SpinnerIcon className="animate-spin shrink-0" size={14} />
          ) : (
            <LightbulbIcon className="shrink-0" size={14} />
          )}
        </span>
        <span className="text-xs font-medium leading-5 whitespace-nowrap">
          {isPartStreaming ? 'Thinking...' : 'Thinking'}
        </span>
        {isPartStreaming && (
          <span className="flex items-center gap-0.5 ml-1 mt-[6px]">
            <span className="w-1 h-1 bg-text-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
            <span className="w-1 h-1 bg-text-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
            <span className="w-1 h-1 bg-text-400 rounded-full animate-bounce" />
          </span>
        )}
        <span className={`ml-auto inline-flex h-5 items-start pt-[2px] transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`}>
          <ChevronDownIcon size={12} />
        </span>
      </button>
      
        <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${
          expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}>
          <div className="overflow-hidden">
            {shouldRenderBody && (
              <ScrollArea ref={scrollAreaRef} maxHeight={192} className="border-t border-border-300/20 bg-bg-200/30">
                <div className="pl-4 pr-3 py-2 text-text-300 text-xs font-mono whitespace-pre-wrap break-words overflow-x-hidden">
                  {displayText}
                </div>
              </ScrollArea>
          )}
        </div>
      </div>
    </div>
  )
})
