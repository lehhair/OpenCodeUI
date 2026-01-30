import { useState } from 'react'
import { CloseIcon, ChevronDownIcon } from '../../components/Icons'
import { getAttachmentIcon, hasExpandableContent } from './utils'
import type { Attachment } from './types'

interface AttachmentItemProps {
  attachment: Attachment
  onRemove?: (id: string) => void
  size?: 'sm' | 'md'
  expandable?: boolean
  className?: string
}

export function AttachmentItem({ 
  attachment, 
  onRemove, 
  size = 'md', 
  expandable = false,
  className
}: AttachmentItemProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [imageError, setImageError] = useState(false)
  
  const { Icon, colorClass } = getAttachmentIcon(attachment)
  const canExpand = expandable && hasExpandableContent(attachment)
  
  return (
    <div 
      className={`relative group flex flex-col transition-all duration-200 ease-in-out ${
        className || ''
      } ${isExpanded ? '!w-auto !min-w-[200px] !max-w-[500px]' : (!className ? 'w-[140px]' : '')}`}
    >
      {/* 标签头部 */}
      <div 
        className={`
          flex items-center gap-1.5 w-full
          px-2.5 py-1.5 rounded-lg border
          bg-bg-100/50 border-border-300/50
          ${size === 'sm' ? 'text-xs' : 'text-sm'}
          ${canExpand ? 'cursor-pointer hover:bg-bg-200 transition-colors' : ''}
        `}
        onClick={canExpand ? () => setIsExpanded(!isExpanded) : undefined}
      >
        <span className={`${colorClass} flex items-center justify-center w-4 h-4 shrink-0 [&>svg]:w-3.5 [&>svg]:h-3.5`}><Icon /></span>
        <span className="text-text-200 flex-1 truncate text-left" title={attachment.displayName}>
          {attachment.displayName}
        </span>
        {canExpand && (
          <span className={`text-text-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}>
            <ChevronDownIcon size={10} />
          </span>
        )}
        {onRemove && (
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(attachment.id) }}
            className="ml-1 text-text-400 hover:text-text-100 transition-colors"
            aria-label="Remove attachment"
          >
            <CloseIcon />
          </button>
        )}
      </div>
      
      {/* 展开的详情面板 - 带动画 */}
      {canExpand && (
        <div 
          className={`grid transition-[grid-template-rows] duration-200 ease-out ${
            isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
          }`}
        >
          <div className="overflow-hidden">
            <ExpandedContent 
              attachment={attachment} 
              imageError={imageError}
              onImageError={() => setImageError(true)}
            />
          </div>
        </div>
      )}
    </div>
  )
}

interface ExpandedContentProps {
  attachment: Attachment
  imageError: boolean
  onImageError: () => void
}

function MetaRow({ 
  label, 
  value, 
  copyable, 
  className = '' 
}: { 
  label: string
  value?: string
  copyable?: boolean
  className?: string 
}) {
  if (!value) return null
  return (
    <div className="flex gap-2">
      <span className="text-text-400 shrink-0 select-none">{label}:</span>
      <span className={`font-mono break-all text-text-200 ${copyable ? 'select-all' : ''} ${className}`}>
        {value}
      </span>
    </div>
  )
}

function ExpandedContent({ attachment, imageError, onImageError }: ExpandedContentProps) {
  const { type, url, content, relativePath, mime, agentName, agentDescription } = attachment
  const isImage = mime?.startsWith('image/')
  
  // Content Area
  let contentNode = null
  
  if (isImage && url && !imageError) {
    contentNode = (
        <div className="p-2">
          <img 
            src={url} 
            alt={attachment.displayName}
            onError={onImageError}
            className="max-h-64 w-full rounded object-contain bg-bg-300/50"
          />
        </div>
    )
  } else if (content) {
    contentNode = (
        <div className="max-h-64 overflow-auto custom-scrollbar">
          <pre className="p-2 text-xs font-mono text-text-300 whitespace-pre-wrap break-all">
            {content.length > 5000 ? content.slice(0, 5000) + '\n\n... (truncated)' : content}
          </pre>
        </div>
    )
  }

  return (
    <div className="mt-1 rounded-md bg-bg-200 border border-border-300 overflow-hidden w-full max-w-[500px]">
      {contentNode}
      
      {/* 元信息 */}
      <div className={`p-2 text-xs space-y-1 text-text-300 bg-bg-100/50 ${contentNode ? 'border-t border-border-300' : ''}`}>

        {type === 'text' && <MetaRow label="Category" value="Context" />}
        
        {/* Full Path / URL */}
        <MetaRow 
          label="Source" 
          value={
            // Only hide data: URLs if they are successfully rendered images
            // Otherwise (HTTP, broken image, non-image) show the source
            url && !(url.startsWith('data:') && isImage && !imageError) 
              ? (url.startsWith('file:///') ? decodeURIComponent(url.replace(/^file:\/\/\/?/, '')) : url) 
              : undefined
          } 
          copyable 
          // Truncate long data URIs if shown
          className={url?.startsWith('data:') ? 'line-clamp-4' : ''}
        />

        {/* Relative Path */}
        <MetaRow label="Ref Path" value={relativePath} />

        {/* MIME - Folder special case */}
        <MetaRow label="Type" value={type === 'folder' ? 'Directory' : mime} />

        {/* Dynamic Source Metadata (Symbol, Resource, etc.) */}
        {attachment.originalSource && typeof attachment.originalSource === 'object' && (
          <>
            {/* Symbol specific */}
            {attachment.originalSource.type === 'symbol' && (
              <>
                <MetaRow label="Symbol" value={attachment.originalSource.name} />
                <MetaRow label="Kind" value={String(attachment.originalSource.kind)} />
                <MetaRow label="Range" value={attachment.originalSource.range ? 
                  `L${attachment.originalSource.range.start.line}:${attachment.originalSource.range.start.character}` : undefined} 
                />
              </>
            )}
            {/* Resource specific */}
            {attachment.originalSource.type === 'resource' && (
              <>
                <MetaRow label="Resource" value={attachment.originalSource.uri} copyable />
                <MetaRow label="Client" value={attachment.originalSource.clientName} />
              </>
            )}

            {/* Mention Text (for both Agent and File) */}
            {(attachment.originalSource.value || (attachment.originalSource.text && attachment.originalSource.text.value)) && (
              <MetaRow 
                label="Mention" 
                value={attachment.originalSource.value || attachment.originalSource.text.value} 
              />
            )}
          </>
        )}

        {/* Agent Info */}
        <MetaRow label="Agent" value={agentName} />
        <MetaRow label="Desc" value={agentDescription} className="line-clamp-2" />
        
        {/* Fallback for anything else in attachment object that might be useful? */}
        {/* Currently Attachment interface is somewhat strict, but let's ensure we cover the basics */}
      </div>
    </div>
  )
}
