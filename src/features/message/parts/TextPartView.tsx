import { memo, useEffect, useState, useRef } from 'react'
import { MarkdownRenderer } from '../../../components'
import type { TextPart } from '../../../types/message'

interface TextPartViewProps {
  part: TextPart
  isStreaming?: boolean
}

// 限制流式渲染帧率，避免 Markdown 解析阻塞主线程
// 16ms = 60fps，既保证流畅度，又避免过度渲染
const STREAMING_THROTTLE_MS = 16

export const TextPartView = memo(function TextPartView({ part, isStreaming }: TextPartViewProps) {
  const [displayContent, setDisplayContent] = useState(part.text)
  const lastUpdateRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 处理流式节流
  useEffect(() => {
    // 非流式状态或内容未变时，确保内容同步并清理定时器
    if (!isStreaming || part.text === displayContent) {
      if (part.text !== displayContent) {
        setDisplayContent(part.text)
      }
      return
    }

    const now = Date.now()
    const timeSinceLastUpdate = now - lastUpdateRef.current

    if (timeSinceLastUpdate >= STREAMING_THROTTLE_MS) {
      // 超过阈值，立即更新
      setDisplayContent(part.text)
      lastUpdateRef.current = now
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    } else {
      // 未到阈值，延迟更新
      if (!timerRef.current) {
        timerRef.current = setTimeout(() => {
          setDisplayContent(part.text)
          lastUpdateRef.current = Date.now()
          timerRef.current = null
        }, STREAMING_THROTTLE_MS - timeSinceLastUpdate)
      }
    }

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [part.text, isStreaming, displayContent])

  // 组件卸载或 streaming 结束时，确保显示最终完整内容
  useEffect(() => {
    if (!isStreaming) {
      setDisplayContent(part.text)
    }
  }, [isStreaming, part.text])

  // 跳过空文本（除非正在 streaming）
  if (!part.text?.trim() && !isStreaming) return null
  
  // 跳过 synthetic 文本（系统上下文，单独处理）
  if (part.synthetic) return null
  
  return (
    <div className="font-claude-response">
      <MarkdownRenderer content={displayContent} />
    </div>
  )
})
