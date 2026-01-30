import { memo } from 'react'
import { AttachmentItem, fromFilePart, fromAgentPart, fromTextPart } from '../../attachment'
import type { FilePart, AgentPart, TextPart } from '../../../types/message'

// ============================================
// File Part View
// ============================================

interface FilePartViewProps {
  part: FilePart
}

export const FilePartView = memo(function FilePartView({ part }: FilePartViewProps) {
  // 转换为 Attachment 类型
  const attachment = fromFilePart(part)
  
  return (
    <AttachmentItem 
      attachment={attachment}
      expandable
      size="sm"
    />
  )
})

// ============================================
// Agent Part View
// ============================================

interface AgentPartViewProps {
  part: AgentPart
}

export const AgentPartView = memo(function AgentPartView({ part }: AgentPartViewProps) {
  // 转换为 Attachment 类型
  const attachment = fromAgentPart(part)
  
  return (
    <AttachmentItem 
      attachment={attachment}
      expandable
      size="sm"
    />
  )
})

// ============================================
// Synthetic Text Part View (系统上下文)
// ============================================

interface SyntheticTextPartViewProps {
  part: TextPart
}

export const SyntheticTextPartView = memo(function SyntheticTextPartView({ part }: SyntheticTextPartViewProps) {
  if (!part.synthetic) return null
  
  // 转换为 Attachment 类型
  const attachment = fromTextPart(part)
  
  return (
    <AttachmentItem 
      attachment={attachment}
      expandable
      size="sm"
    />
  )
})
