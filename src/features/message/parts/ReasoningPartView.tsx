import { memo, useState, useRef, useEffect } from 'react'
import { ChevronDownIcon } from '../../../components/Icons'
import { ScrollArea } from '../../../components/ui'
import type { ReasoningPart } from '../../../types/message'

function ThinkingIcon() {
  return (
    <svg 
      width="14" 
      height="14" 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round"
    >
      <path d="M12 2a8 8 0 0 0-8 8c0 3.5 2.5 6.5 6 7.5V19a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-1.5c3.5-1 6-4 6-7.5a8 8 0 0 0-8-8Z" />
      <path d="M10 22h4" />
    </svg>
  )
}

function ThinkingSpinner() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="animate-spin"
    >
      <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
      <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
    </svg>
  )
}

interface ReasoningPartViewProps {
  part: ReasoningPart
  isStreaming?: boolean
}

export const ReasoningPartView = memo(function ReasoningPartView({ part, isStreaming }: ReasoningPartViewProps) {
  // 跳过空的 reasoning
  // 只有当有实质内容时才渲染，即使正在 streaming 也不渲染空壳
  if (!part.text?.trim()) return null
  
  const isPartStreaming = isStreaming && !part.time?.end
  const hasContent = !!part.text?.trim()
  const [expanded, setExpanded] = useState(false)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  
  // 自动控制展开状态
  useEffect(() => {
    if (isPartStreaming && hasContent) {
      // 流式传输中有内容时自动展开
      setExpanded(true)
    } else if (!isPartStreaming) {
      // 结束时自动折叠
      setExpanded(false)
    }
    // 注意：我们不处理 "流式中但无内容" 的情况，保持默认（折叠），避免空框
  }, [isPartStreaming, hasContent])

  // 滚动 ScrollArea 内部到底部
  useEffect(() => {
    if (isPartStreaming && expanded && scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight
    }
  }, [part.text, isPartStreaming, expanded])

  return (
    <div className={`border border-border-300/20 rounded-xl overflow-hidden transition-[width] duration-300 ease-out ${
      expanded ? 'w-full' : 'w-[260px]'
    }`}>
      <button
        onClick={() => setExpanded(!expanded)}
        disabled={!hasContent && !isPartStreaming} // 没内容且没流式时禁用点击（其实这种情况下组件都不渲染了）
        className={`w-full flex items-center gap-2 px-3 py-2 text-text-400 hover:bg-bg-200/50 transition-colors ${
          !hasContent ? 'cursor-default' : ''
        }`}
      >
        {isPartStreaming ? (
          <ThinkingSpinner />
        ) : (
          <ThinkingIcon />
        )}
        <span className="text-xs font-medium whitespace-nowrap">
          {isPartStreaming ? 'Thinking...' : 'Thinking'}
        </span>
        {isPartStreaming && (
          <span className="flex gap-0.5 ml-1">
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
          <ScrollArea ref={scrollAreaRef} maxHeight={192} className="border-t border-border-300/20 bg-bg-200/30">
            <div className="px-3 py-2 text-text-300 text-xs font-mono whitespace-pre-wrap">
              {part.text}
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  )
})
