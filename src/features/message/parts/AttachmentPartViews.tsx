import { memo, useMemo } from 'react'
import { AttachmentItem } from '../../attachment'
import { absolutePathToFileUrl } from '../../../utils/pathUtils'
import { fileUrlToAbsolutePath, type PromptAttachmentReference } from '../../../api/message'
import type { PromptAgentAttachment, PromptFileAttachment, PromptSkillAttachment } from '../../../types/api/message'
// ============================================
// v2 用户消息附件 → 统一 Attachment
//
// v2 的 `SessionMessageUser` 自带 `files` / `agents`（`PromptFileAttachment`
// / `PromptAgentAttachment`），没有独立的 file/agent part，也没有
// v1 FilePart 的 `url`。这里把原生字段直接映射成抽屉里的 Attachment，
// 不经过任何 part 形状。
// ============================================

/** `PromptFileAttachment.source` → 可用的 url（图片优先用读回的字节） */
function attachmentUrl(file: PromptFileAttachment): string {
  // Tauri webview 默认不允许直接加载 file:// 资源，图片预览会 onError。
  // 服务端已经把字节读回来了（data 是 base64），直接用 data URL。
  if (file.mime.startsWith('image/') && file.data) {
    return `data:${file.mime};base64,${file.data}`
  }
  if (file.source?.type === 'uri') return file.source.uri
  return file.data ? `data:${file.mime};base64,${file.data}` : ''
}

/**
 * 服务端读回来的文本内容。
 *
 * `files[]` 里的文本附件带着 base64 `data`，之前完全没用上——胶囊展开只能
 * 看到「引用路径 / 类型」，看着像被降级成了路径引用。这里解码给
 * `AttachmentItem`，展开就能预览正文（组件内部会截断到 5000 字）。
 */
function fileTextContent(file: PromptFileAttachment): string | undefined {
  if (!file.data || !file.mime?.startsWith('text/')) return undefined
  try {
    const binary = atob(file.data)
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return undefined
  }
}

function fileDisplayName(file: PromptFileAttachment): string {
  if (file.name) return file.name
  if (file.source?.type === 'uri') {
    // source.uri 是 percent-encoding 过的，先解码再取文件名
    const decoded = fileUrlToAbsolutePath(file.source.uri) ?? safeDecodeUri(file.source.uri)
    const segments = decoded.split(/[?#]/)[0].split(/[/\\]/).filter(Boolean)
    if (segments.length > 0) return segments[segments.length - 1]
  }
  return file.mime || 'attachment'
}

function safeDecodeUri(uri: string): string {
  try {
    return decodeURIComponent(uri)
  } catch {
    return uri
  }
}

/** 文件来源路径（解码后的绝对路径，用于展示） */
function fileSourcePath(file: PromptFileAttachment): string | undefined {
  if (file.source?.type !== 'uri') return file.name
  return fileUrlToAbsolutePath(file.source.uri) ?? safeDecodeUri(file.source.uri)
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
  const content = useMemo(() => fileTextContent(file), [file])
  return (
    <AttachmentItem
      attachment={{
        id: `user-file:${index}`,
        type: file.mime === 'application/x-directory' ? 'folder' : 'file',
        displayName: fileDisplayName(file),
        url: attachmentUrl(file),
        mime: file.mime,
        relativePath: fileSourcePath(file),
        content,
        textRange: mentionRange(file.mention),
        category: 'user',
      }}
      expandable
      size="sm"
    />
  )
})

// ============================================
// Path Reference View
//
// 二进制 / 超 20MB / 拖入的本机文件走的是「路径引用」：不进 message.files，
// 只存在 metadata.attachments。气泡必须单独渲染，否则用户看到的就是
// 「输入框有胶囊、发出去没了」。
// ============================================

interface PathReferencePartViewProps {
  reference: PromptAttachmentReference
  index: number
}

export const PathReferencePartView = memo(function PathReferencePartView({
  reference,
  index,
}: PathReferencePartViewProps) {
  return (
    <AttachmentItem
      attachment={{
        id: `user-path:${index}`,
        type: reference.mime === 'application/x-directory' ? 'folder' : 'file',
        displayName: reference.name,
        url: absolutePathToFileUrl(reference.path),
        mime: reference.mime,
        relativePath: reference.path,
        pathOnly: true,
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

// ============================================
// Skill Attachment View
// ============================================

interface SkillPartViewProps {
  skill: PromptSkillAttachment
  index: number
}

/** `@skill` 提及：和文件 / agent 附件同一套 chip，展开可看技能正文 */
export const SkillPartView = memo(function SkillPartView({ skill, index }: SkillPartViewProps) {
  return (
    <AttachmentItem
      attachment={{
        id: `user-skill:${skill.id || index}`,
        type: 'skill',
        displayName: skill.name,
        skillId: skill.id,
        content: skill.text,
        textRange: mentionRange(skill.mention),
        category: 'user',
      }}
      expandable
      size="sm"
    />
  )
})
