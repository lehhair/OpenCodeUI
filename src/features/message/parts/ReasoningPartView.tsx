import { memo, useState, useRef, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDownIcon, LightbulbIcon, SpinnerIcon } from '../../../components/Icons'
import { ScrollArea } from '../../../components/ui'
import { useDelayedRender } from '../../../hooks'
import { useTheme } from '../../../hooks/useTheme'
import { MarkdownRenderer } from '../../../components/MarkdownRenderer'
import type { ReasoningPart } from '../../../types/message'

// italic 默认不显示前导图标；如果后续要恢复，只改这里。
const ITALIC_SHOW_LEADING_GLYPH = false

interface ReasoningPartViewProps {
  part: ReasoningPart
  isStreaming?: boolean
}

export const ReasoningPartView = memo(function ReasoningPartView({ part, isStreaming }: ReasoningPartViewProps) {
  const { t } = useTranslation('message')
  const { reasoningDisplayMode } = useTheme()
  const rawText = part.text || ''

  const isPartStreaming = isStreaming && !part.time?.end
  const hasContent = !!rawText.trim()

  const displayText = rawText
  const [expanded, setExpanded] = useState(false)
  const shouldRenderBody = useDelayedRender(expanded)
  const scrollAreaRef = useRef<HTMLDivElement>(null)

  const collapsedPreview = useMemo(() => (displayText || '').replace(/\s+/g, ' ').trim(), [displayText])
  const thoughtDurationLabel = useMemo(() => {
    const start = part.time?.start
    const end = part.time?.end
    if (!start || !end || end <= start) return null
    const durationMs = end - start
    if (durationMs < 1000) return `${Math.max(1, Math.round(durationMs))}ms`
    if (durationMs < 10000) return `${(durationMs / 1000).toFixed(1)}s`
    return `${Math.round(durationMs / 1000)}s`
  }, [part.time?.start, part.time?.end])
  const summaryText = collapsedPreview || (isPartStreaming ? t('reasoning.thinking') : '')
  const hasLineBreak = /[\r\n]/.test(rawText)

  useEffect(() => {
    let frameId: number | null = null

    if (isPartStreaming && hasContent) {
      frameId = requestAnimationFrame(() => {
        setExpanded(true)
      })
    } else if (!isPartStreaming) {
      frameId = requestAnimationFrame(() => {
        setExpanded(false)
      })
    }

    return () => {
      if (frameId !== null) cancelAnimationFrame(frameId)
    }
  }, [isPartStreaming, hasContent])

  useEffect(() => {
    if (reasoningDisplayMode !== 'capsule') return
    if (isPartStreaming && expanded && scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight
    }
  }, [displayText, isPartStreaming, expanded, reasoningDisplayMode])

  if (!hasContent) return null

  if (reasoningDisplayMode === 'italic') {
    const shouldUseToggle = isPartStreaming || hasLineBreak
    const expandedMetaText = isPartStreaming
      ? t('reasoning.thinking')
      : thoughtDurationLabel
        ? t('reasoning.thoughtFor', { duration: thoughtDurationLabel })
        : t('reasoning.thoughtProcess')
    const summaryClassName = expanded
      ? isPartStreaming
        ? 'text-[12px] leading-5 text-text-200'
        : 'text-[12px] leading-5 text-text-500/80'
      : isPartStreaming
        ? 'text-[12px] leading-5 text-text-200 whitespace-nowrap overflow-hidden text-ellipsis'
        : 'text-[12px] leading-5 text-text-300 whitespace-nowrap overflow-hidden text-ellipsis'

    const content = shouldUseToggle ? (
      <>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          className="group/reasoning flex w-full min-w-0 items-start gap-2 m-0 border-0 bg-transparent p-0 pr-2 text-left cursor-pointer text-text-400 hover:text-text-200"
        >
          <div className="relative min-w-0 flex-1 overflow-hidden">
            <span className="relative inline-block min-w-0 max-w-full align-top">
              <span
                className={`block min-w-0 italic ${summaryClassName} ${isPartStreaming ? 'reasoning-shimmer-text' : ''}`}
              >
                {expanded ? expandedMetaText : summaryText}
              </span>
            </span>
          </div>
          <span
            className={`inline-flex h-5 w-3 items-center justify-center shrink-0 text-text-500 group-hover/reasoning:text-text-300 transition-[transform,color] duration-200 ${expanded ? 'rotate-180' : ''}`}
          >
            <ChevronDownIcon size={12} />
          </span>
        </button>

        <div
          className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
            expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-75'
          }`}
        >
          <div className="min-h-0 min-w-0 overflow-hidden" style={{ clipPath: 'inset(0 -100% 0 -100%)' }}>
            {shouldRenderBody && (
              <div className="pt-0.5 pr-7 text-[12px]">
                <MarkdownRenderer content={displayText} variant="reasoning" isStreaming={isPartStreaming} />
              </div>
            )}
          </div>
        </div>
      </>
    ) : (
      <div className="relative min-w-0 overflow-hidden text-[12px]">
        <MarkdownRenderer content={displayText} variant="reasoning" isStreaming={isPartStreaming} />
      </div>
    )

    return (
      <div className="py-1">
        {ITALIC_SHOW_LEADING_GLYPH ? (
          <div className="grid grid-cols-[14px_minmax(0,1fr)] gap-x-1.5 items-start">
            <span className="inline-flex h-5 w-[14px] items-start justify-center pt-[2px] text-text-500">
              {isPartStreaming ? <SpinnerIcon className="animate-spin" size={14} /> : <LightbulbIcon size={14} />}
            </span>
            <div className="min-w-0">{content}</div>
          </div>
        ) : (
          content
        )}

        <span className="sr-only" role="status" aria-live="polite">
          {summaryText}
        </span>
      </div>
    )
  }

  return (
    <div
      className={`ring-1 ring-inset ring-border-300/20 rounded-xl overflow-hidden transition-all duration-300 ease-out ${
        expanded ? 'w-full' : 'w-[260px]'
      }`}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        disabled={!hasContent && !isPartStreaming}
        className={`w-full grid grid-cols-[auto_minmax(0,1fr)_12px] items-center gap-x-1.5 px-2 py-2 text-text-400 hover:bg-bg-200/50 transition-colors ${
          !hasContent ? 'cursor-default' : ''
        }`}
      >
        <span className="inline-flex w-[14px] items-center justify-center shrink-0">
          {isPartStreaming ? (
            <SpinnerIcon className="animate-spin shrink-0" size={14} />
          ) : (
            <LightbulbIcon className="shrink-0" size={14} />
          )}
        </span>
        <span className="text-xs font-medium leading-5 whitespace-nowrap text-left">
          {isPartStreaming ? t('reasoning.thinking') : t('reasoning.thinkingLabel')}
        </span>
        <span
          className={`inline-flex h-5 w-3 items-center justify-center shrink-0 transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`}
        >
          <ChevronDownIcon size={12} />
        </span>
      </button>

      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-out ${expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
      >
        <div className="min-h-0 min-w-0 overflow-hidden" style={{ clipPath: 'inset(0 -100% 0 -100%)' }}>
          {shouldRenderBody && (
            <ScrollArea ref={scrollAreaRef} maxHeight={192} className="border-t border-border-300/20 bg-bg-200/30">
              <div className="px-2 py-2 text-xs">
                <MarkdownRenderer content={displayText} variant="reasoning" isStreaming={isPartStreaming} />
              </div>
            </ScrollArea>
          )}
        </div>
      </div>
    </div>
  )
})
