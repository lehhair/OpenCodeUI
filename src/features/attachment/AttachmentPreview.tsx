import { AttachmentItem } from './AttachmentItem'
import type { Attachment } from './types'

interface AttachmentPreviewProps {
  attachments: Attachment[]
  onRemove?: (id: string) => void
  className?: string
  size?: 'sm' | 'md'
  expandable?: boolean
  variant?: 'wrap' | 'list' | 'grid'
  /** @deprecated use variant='list' or variant='wrap' */
  direction?: 'row' | 'column'
}

/**
 * 附件预览组件
 * 用于输入框上方预览区和消息气泡中
 */
export function AttachmentPreview({ 
  attachments, 
  onRemove,
  className = '',
  size = 'md',
  expandable = false,
  variant,
  direction,
}: AttachmentPreviewProps) {
  if (attachments.length === 0) return null

  // Backward compatibility
  const mode = variant || (direction === 'column' ? 'list' : 'wrap')

  const sizeClasses = size === 'sm' 
    ? 'text-xs gap-1.5' 
    : 'text-sm gap-2'

  const containerClasses = {
    wrap: 'flex flex-wrap',
    list: 'flex flex-col items-end', // List aligns to end (user message)
    grid: 'grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-2 w-full',
  }[mode]
  
  const itemClasses = {
    wrap: 'w-[140px]',
    list: 'w-full max-w-[280px]', // Slightly wider in list
    grid: 'w-full min-w-0', // min-w-0 required for flex/grid truncation
  }[mode]

  return (
    <div className={`${containerClasses} ${sizeClasses} ${className}`}>
      {attachments.map(attachment => (
        <AttachmentItem 
          key={attachment.id} 
          attachment={attachment}
          onRemove={onRemove}
          size={size}
          expandable={expandable}
          className={itemClasses}
        />
      ))}
    </div>
  )
}
