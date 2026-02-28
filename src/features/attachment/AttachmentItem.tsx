import { useState, useCallback, useRef, useEffect, memo } from 'react'
import { CloseIcon, ChevronDownIcon, CopyIcon, CheckIcon, DownloadIcon, ExpandIcon } from '../../components/Icons'
import { getAttachmentIcon, hasExpandableContent } from './utils'
import { useDelayedRender } from '../../hooks/useDelayedRender'
import { AttachmentDetailModal } from './AttachmentDetailModal'
import { clipboardErrorHandler } from '../../utils'
import { saveData } from '../../utils/downloadUtils'
import type { Attachment } from './types'

interface AttachmentItemProps {
  attachment: Attachment
  onRemove?: (id: string) => void
  size?: 'sm' | 'md'
  expandable?: boolean
  className?: string
}

function AttachmentItemComponent({ 
  attachment, 
  onRemove, 
  size = 'md', 
  expandable = false,
  className
}: AttachmentItemProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [imageError, setImageError] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const shouldRenderBody = useDelayedRender(isExpanded)
  
  const { Icon, colorClass } = getAttachmentIcon(attachment)
  const canExpand = expandable && hasExpandableContent(attachment)
  
  // 宽度模型：学习 ReasoningPartView 的做法
  // 收起时固定宽度，展开时用百分比+max限制（可被 CSS 过渡）
  // 不用 w-auto（无法过渡），用 w-full（百分比 → 计算像素 → 可过渡）
  const collapsedWidth = className ? '' : 'w-[140px]'
  const expandedWidth = 'w-full min-w-[140px] max-w-[440px]'
  
  return (
    <div 
      className={`relative group flex flex-col overflow-hidden transition-all duration-300 ease-out ${
        className || ''
      } ${isExpanded ? expandedWidth : collapsedWidth}`}
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
        <span className="text-text-200 flex-1 min-w-0 truncate text-left" title={attachment.displayName}>
          {attachment.displayName}
        </span>
        {canExpand && (
          <span className={`text-text-400 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}>
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
      
      {/* 展开的详情面板 - grid-rows 动画（和 think tag 同源） */}
      {canExpand && (
        <div 
          className={`grid transition-[grid-template-rows] duration-300 ease-out ${
            isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
          }`}
        >
          <div className="overflow-hidden">
            {shouldRenderBody && (
              <ExpandedContent 
                attachment={attachment} 
                imageError={imageError}
                onImageError={() => setImageError(true)}
                onOpenDetail={() => setIsModalOpen(true)}
              />
            )}
          </div>
        </div>
      )}

      {/* 附件详情弹窗 */}
      <AttachmentDetailModal
        attachment={attachment}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </div>
  )
}

interface ExpandedContentProps {
  attachment: Attachment
  imageError: boolean
  onImageError: () => void
  onOpenDetail: () => void
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

function ExpandedContent({ attachment, imageError, onImageError, onOpenDetail }: ExpandedContentProps) {
  const { type, url, content, relativePath, mime, agentName, agentDescription } = attachment
  const isImage = mime?.startsWith('image/')
  const hasContent = !!content
  const hasDownloadable = hasContent || (!!isImage && !!url)
  
  // Content Area
  let contentNode = null
  
  if (isImage && url && !imageError) {
    contentNode = (
        <div className="p-2">
          <img 
            src={url} 
            alt={attachment.displayName}
            onError={onImageError}
            loading="lazy"
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
    <div className="mt-1 rounded-md bg-bg-200 border border-border-300 overflow-hidden w-full">
      {contentNode}
      
      {/* 操作按钮栏 */}
      <ActionBar
        attachment={attachment}
        hasContent={hasContent}
        hasDownloadable={hasDownloadable}
        onOpenDetail={onOpenDetail}
        showBorderTop={!!contentNode}
      />

      {/* 元信息 */}
      <div className="p-2 text-xs space-y-1 text-text-300 bg-bg-100/50 border-t border-border-300">

        {type === 'text' && <MetaRow label="Category" value="Context" />}
        
        {/* Full Path / URL */}
        <MetaRow 
          label="Source" 
          value={
            url && !(url.startsWith('data:') && isImage && !imageError) 
              ? (url.startsWith('file:///') ? decodeURIComponent(url.replace(/^file:\/\/\/?/, '')) : url) 
              : undefined
          } 
          copyable 
          className={url?.startsWith('data:') ? 'line-clamp-4' : ''}
        />

        <MetaRow label="Ref Path" value={relativePath} />
        <MetaRow label="Type" value={type === 'folder' ? 'Directory' : mime} />

        {attachment.originalSource && typeof attachment.originalSource === 'object' && (
          <>
            {attachment.originalSource.type === 'symbol' && (
              <>
                <MetaRow label="Symbol" value={attachment.originalSource.name} />
                <MetaRow label="Kind" value={String(attachment.originalSource.kind)} />
                <MetaRow label="Range" value={attachment.originalSource.range ? 
                  `L${attachment.originalSource.range.start.line}:${attachment.originalSource.range.start.character}` : undefined} 
                />
              </>
            )}
            {attachment.originalSource.type === 'resource' && (
              <>
                <MetaRow label="Resource" value={attachment.originalSource.uri} copyable />
                <MetaRow label="Client" value={attachment.originalSource.clientName} />
              </>
            )}
            {(attachment.originalSource.value || (attachment.originalSource.text && attachment.originalSource.text.value)) && (
              <MetaRow 
                label="Mention" 
                value={attachment.originalSource.value || attachment.originalSource.text.value} 
              />
            )}
          </>
        )}

        <MetaRow label="Agent" value={agentName} />
        <MetaRow label="Desc" value={agentDescription} className="line-clamp-2" />
      </div>
    </div>
  )
}

// ============================================
// ActionBar - 操作按钮栏（查看详情、复制、下载）
// ============================================

interface ActionBarProps {
  attachment: Attachment
  hasContent: boolean
  hasDownloadable: boolean
  onOpenDetail: () => void
  showBorderTop: boolean
}

function ActionBar({ attachment, hasContent, hasDownloadable, onOpenDetail, showBorderTop }: ActionBarProps) {
  const [copied, setCopied] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  const handleCopy = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!attachment.content) return
    try {
      await navigator.clipboard.writeText(attachment.content)
      setCopied(true)
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      timeoutRef.current = setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      clipboardErrorHandler('copy', err)
    }
  }, [attachment.content])

  const handleDownload = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const isImage = attachment.mime?.startsWith('image/')
    const fileName = attachment.displayName || (isImage ? 'image' : 'attachment.txt')

    if (isImage && attachment.url) {
      // 图片：从 data URI 或 URL fetch 后保存
      fetch(attachment.url)
        .then(res => res.arrayBuffer())
        .then(buf => saveData(new Uint8Array(buf), fileName, attachment.mime || 'image/png'))
        .catch(err => console.warn('[AttachmentItem] save image failed:', err))
    } else if (attachment.content) {
      saveData(new TextEncoder().encode(attachment.content), fileName, 'text/plain;charset=utf-8')
    }
  }, [attachment])

  const handleOpenDetail = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onOpenDetail()
  }, [onOpenDetail])

  if (!hasContent && !hasDownloadable) return null

  const btnBase = "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition-colors duration-150"

  return (
    <div className={`flex items-center gap-1 px-2 py-1 bg-bg-100/30 ${showBorderTop ? 'border-t border-border-300/50' : ''}`}>
      <button
        onClick={handleOpenDetail}
        className={`${btnBase} text-text-400 hover:text-text-200 hover:bg-bg-300/50`}
        title="View detail"
      >
        <ExpandIcon size={11} />
        <span>Detail</span>
      </button>

      {hasContent && (
        <button
          onClick={handleCopy}
          className={`${btnBase} ${copied ? 'text-success-100' : 'text-text-400 hover:text-text-200 hover:bg-bg-300/50'}`}
          title={copied ? 'Copied!' : 'Copy content'}
        >
          {copied ? <CheckIcon size={11} /> : <CopyIcon size={11} />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      )}

      {hasDownloadable && (
        <button
          onClick={handleDownload}
          className={`${btnBase} text-text-400 hover:text-text-200 hover:bg-bg-300/50`}
          title="Save to file"
        >
          <DownloadIcon size={11} />
          <span>Save</span>
        </button>
      )}
    </div>
  )
}

// ============================================
// Export with memo for performance optimization
// ============================================

export const AttachmentItem = memo(AttachmentItemComponent)
