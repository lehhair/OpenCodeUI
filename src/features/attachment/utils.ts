import { FileIcon, FolderIcon, AgentIcon, ImageIcon, TerminalIcon } from '../../components/Icons'
import type { Attachment } from './types'

/**
 * 从 API file part 创建 Attachment
 * 注意：source.text.value 只是用户输入的 @mention 文本，不是文件内容
 * 真正的文件内容会通过 synthetic text part 传递
 */
export function fromFilePart(part: {
  id?: string
  type: 'file'
  mime: string
  url: string
  filename?: string
  source?: {
    text?: { value: string; start: number; end: number }
    path?: string
  }
}, content?: string): Attachment {
  const isFolder = part.mime === 'application/x-directory'
  return {
    id: part.id || crypto.randomUUID(),
    type: isFolder ? 'folder' : 'file',
    displayName: part.filename || part.source?.path || 'file',
    url: part.url,
    mime: part.mime,
    relativePath: part.source?.path,
    // content 优先使用传入的 synthetic content
    // source.text.value 只是 @mention 文本，不作为 content
    content: content,
    textRange: part.source?.text ? {
      value: part.source.text.value,
      start: part.source.text.start,
      end: part.source.text.end,
    } : undefined,
    category: 'user',
    originalSource: part.source,
  }
}

/**
 * 从 API agent part 创建 Attachment
 */
export function fromAgentPart(part: {
  id?: string
  type: 'agent'
  name: string
  source?: { value: string; start: number; end: number }
}): Attachment {
  return {
    id: part.id || crypto.randomUUID(),
    type: 'agent',
    displayName: part.name,
    agentName: part.name,
    textRange: part.source ? {
      value: part.source.value,
      start: part.source.start,
      end: part.source.end,
    } : undefined,
    category: 'user',
    originalSource: part.source,
  }
}

/**
 * 从 API synthetic text part 创建 Attachment
 */
export function fromTextPart(part: {
  id?: string
  text: string
}): Attachment {
  const text = part.text.trim()
  
  // 简化命名逻辑，直接使用内容摘要
  const displayName = text.length > 30 
    ? text.slice(0, 30).replace(/\n/g, ' ') + '...' 
    : text.replace(/\n/g, ' ') || 'Context'

  return {
    id: part.id || crypto.randomUUID(),
    type: 'text',
    displayName,
    content: part.text,
    category: 'system',
  }
}

/**
 * 生成 @ mention 的显示文本
 */
export function getMentionText(attachment: Attachment): string {
  if (attachment.type === 'agent') {
    return `@${attachment.agentName}`
  }
  // file/folder 用相对路径
  const path = attachment.relativePath || attachment.displayName
  return `@${path}`
}

/**
 * 判断附件是否有可展开的内容
 */
export function hasExpandableContent(attachment: Attachment): boolean {
  const isImage = attachment.mime?.startsWith('image/')
  
  switch (attachment.type) {
    case 'file':
      // 图片需要 url，其他文件需要 content 或 relativePath
      return isImage ? !!attachment.url : (!!attachment.content || !!attachment.relativePath)
    case 'folder':
      return !!attachment.relativePath
    case 'agent':
      return !!attachment.agentName
    case 'text':
      return !!attachment.content
    default:
      return false
  }
}

export function getAttachmentIcon(attachment: Attachment): { Icon: React.FC; colorClass: string } {
  const isImage = attachment.mime?.startsWith('image/')
  
  if (isImage) {
    return { Icon: ImageIcon, colorClass: 'text-accent-secondary-100' }
  }
  
  switch (attachment.type) {
    case 'file':
      return { Icon: FileIcon, colorClass: 'text-info-100' }
    case 'folder':
      return { Icon: FolderIcon, colorClass: 'text-warning-100' }
    case 'agent':
      return { Icon: AgentIcon, colorClass: 'text-accent-main-100' }
    case 'text':
      return { Icon: TerminalIcon, colorClass: 'text-text-400' }
    case 'command':
      return { Icon: TerminalIcon, colorClass: 'text-accent-secondary-100' }
    default:
      return { Icon: FileIcon, colorClass: 'text-text-400' }
  }
}
