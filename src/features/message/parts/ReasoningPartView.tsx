import { memo, useState, useRef, useEffect } from 'react'
import { ChevronDownIcon, LightbulbIcon, SpinnerIcon } from '../../../components/Icons'
import { ScrollArea } from '../../../components/ui'
import { useDelayedRender } from '../../../hooks'
import { useSmoothStream } from '../../../hooks/useSmoothStream'
import type { ReasoningPart } from '../../../types/message'

interface ReasoningPartViewProps {
  part: ReasoningPart
  isStreaming?: boolean
}

export const ReasoningPartView = memo(function ReasoningPartView({ part, isStreaming }: ReasoningPartViewProps) {
  const rawText = part.text || ''
  const hasContent = !!rawText.trim()
  const isPartStreaming = isStreaming && !part.time?.end

  // 使用 smooth streaming 实现打字机效果
  const { displayText } = useSmoothStream(
    rawText,
    !!isPartStreaming,
    { charDelay: 6, disableAnimation: !isPartStreaming }
  )
  const [expanded, setExpanded] = useState(false)
  const shouldRenderBody = useDelayedRender(expanded)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<HTMLSpanElement>(null)
  const [isOverflow, setIsOverflow] = useState(false)

  const normalizedText = displayText
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*\*/g, '')
  const previewText = normalizedText.replace(/\s+/g, ' ').trim()
  const canExpand = isOverflow || expanded

  // 预览是否超出一行（决定是否显示省略和展开按钮）
  useEffect(() => {
    if (!hasContent) return
    const el = previewRef.current
    if (!el) return

    const checkOverflow = () => {
      setIsOverflow(el.scrollWidth > el.clientWidth + 1)
    }

    checkOverflow()
    window.addEventListener('resize', checkOverflow)
    if (document.fonts?.ready) {
      void document.fonts.ready.then(checkOverflow)
    }

    return () => {
      window.removeEventListener('resize', checkOverflow)
    }
  }, [previewText, hasContent])

  // 滚动 ScrollArea 内部到底部
  useEffect(() => {
    if (isPartStreaming && expanded && scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight
    }
  }, [displayText, isPartStreaming, expanded])

  if (!hasContent) return null

  return (
    <div className="w-full py-0.5">
      <button
        type="button"
        onClick={() => {
          if (!canExpand) return
          setExpanded(v => !v)
        }}
        aria-expanded={expanded}
        className={`w-full flex items-center gap-2 py-1 text-left transition-colors ${
          canExpand ? 'text-text-400 hover:text-text-200 cursor-pointer' : 'text-text-400 cursor-default'
        }`}
      >
        {isPartStreaming ? (
          <SpinnerIcon className="animate-spin" size={14} />
        ) : (
          <LightbulbIcon size={14} />
        )}
        <span ref={previewRef} className="min-w-0 flex-1 truncate text-xs text-text-300">
          {previewText}
        </span>
        {canExpand && (
          <span className={`ml-auto transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}>
            <ChevronDownIcon size={12} />
          </span>
        )}
      </button>
      
      <div className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
        <div className="overflow-hidden">
          {shouldRenderBody && (
            <ScrollArea ref={scrollAreaRef} maxHeight={208} className="mt-1">
              <div className="py-1 pr-1 text-text-300 text-xs whitespace-pre-wrap">
                {normalizedText}
              </div>
            </ScrollArea>
          )}
        </div>
      </div>
    </div>
  )
})
