import { memo } from 'react'
import { AttachmentItem } from '../../attachment'
import type { PromptAgentAttachment, PromptFileAttachment } from '../../../types/api/message'
// ============================================
// v2 用户消息附件 → 统一 Attachment
//
// v2 的 `SessionMessageUser` 自带 `files` / `agents`（`PromptFileAttachment`
// / `PromptAgentAttachment`），没有独立的 file/agent part，也没有
// v1 FilePart 的 `url`。这里把原生字段直接映射成抽屉里的 Attachment，
// 不经过任何 part 形状。
// ============================================

/** `PromptFileAttachment.source` → 可用的 url（inline 走 data:） */
function attachmentUrl(file: PromptFileAttachment): string {
  if (file.source?.type === 'uri') return file.source.uri
  return `data:${file.mime};base64,${file.data}`
}

function fileDisplayName(file: PromptFileAttachment): string {
  if (file.name) return file.name
  if (file.source?.type === 'uri') {
    const segments = file.source.uri.split(/[?#]/)[0].split('/').filter(Boolean)
    if (segments.length > 0) return segments[segments.length - 1]
  }
  return file.mime || 'attachment'
}

/** 文件提及在正文里的位置（用于高亮/回溯），v2 的 mention 就是 {start,end,text} */
function mentionRange(mention: { start: number; end: number; text: string } | undefined) {
  if (!mention) return undefined
  return { value: mention.text, start: mention.start, end: mention.end }
}

// ============================================
// File Attachment View
// ============================================

interface FilePartViewProps {
  file: PromptFileAttachment
  /** 同一消息内多附件的稳定 key */
  index: number
}

export const FilePartView = memo(function FilePartView({ file, index }: FilePartViewProps) {
  return (
    <AttachmentItem
      attachment={{
        id: `user-file:${index}`,
        type: file.mime === 'application/x-directory' ? 'folder' : 'file',
        displayName: fileDisplayName(file),
        url: attachmentUrl(file),
        mime: file.mime,
        relativePath: file.source?.type === 'uri' ? file.source.uri : file.name,
        textRange: mentionRange(file.mention),
        category: 'user',
      }}
      expandable
      size="sm"
    />
  )
})

// ============================================
// Agent Attachment View
// ============================================

interface AgentPartViewProps {
  agent: PromptAgentAttachment
  index: number
}

export const AgentPartView = memo(function AgentPartView({ agent, index }: AgentPartViewProps) {
  return (
    <AttachmentItem
      attachment={{
        id: `user-agent:${index}`,
        type: 'agent',
        displayName: agent.name,
        agentName: agent.name,
        textRange: mentionRange(agent.mention),
        category: 'user',
      }}
      expandable
      size="sm"
    />
  )
})
