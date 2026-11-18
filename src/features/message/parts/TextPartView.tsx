import { memo } from 'react'
import { MarkdownRenderer } from '../../../components'
import type { AssistantText } from '../../../types/api/message'

interface TextPartViewProps {
  /** v2 原生文本内容：`{ type: 'text', text, state? }` */
  part: AssistantText
  isStreaming?: boolean
}

/**
 * TextPartView - 直接渲染后端推送的文本；数据层不做缓冲，
 * 显示节奏由 MarkdownRenderer 负责
 */
export const TextPartView = memo(function TextPartView({ part, isStreaming = false }: TextPartViewProps) {
  const displayText = part.text || ''

  // 跳过空文本（除非正在 streaming）
  if (!displayText.trim() && !isStreaming) return null

  return (
    <div style={{ contain: 'layout' }}>
      <MarkdownRenderer content={displayText} isStreaming={isStreaming} />
    </div>
  )
})
