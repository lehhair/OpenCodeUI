import { memo } from 'react'
import { MarkdownRenderer } from '../../../components'
import { useSmoothStream } from '../../../hooks/useSmoothStream'
import type { TextPart } from '../../../types/message'

interface TextPartViewProps {
  part: TextPart
  isStreaming?: boolean
}

/**
 * TextPartView - 使用 Smooth Streaming 实现打字机效果
 * 
 * 核心思想：解耦网络接收和视觉渲染
 * - 后端推过来的文本先缓冲
 * - 前端以固定速度逐字符释放显示
 * - 不管后端推送多块多慢，用户看到的始终是均匀流畅的
 */
export const TextPartView = memo(function TextPartView({ part, isStreaming = false }: TextPartViewProps) {
  // 使用 smooth streaming hook
  const { displayText, isAnimating } = useSmoothStream(
    part.text || '',
    isStreaming,
    { charDelay: 8 }  // 8ms per char ≈ 125 chars/sec
  )

  // 跳过空文本（除非正在 streaming 或动画中）
  if (!part.text?.trim() && !isStreaming && !isAnimating) return null
  
  // 跳过 synthetic 文本（系统上下文，单独处理）
  if (part.synthetic) return null
  
  return (
    <div className="font-claude-response">
      <MarkdownRenderer content={displayText} />
    </div>
  )
})
