// ============================================
// CollapsibleUserText — 用户长文本气泡（超长折叠，预览 8 行）
//
// 原本私有于 MessageRenderer，抽出来给队列气泡（QueueBubbles）复用：
// 正文/折叠/遮罩/展开按钮逻辑共享，气泡外壳（className）、正文颜色
// （textClassName）、渐变遮罩底色（maskClassName）按场景配。
// ============================================

import { memo, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MarkdownRenderer } from '../../components/MarkdownRenderer'
import { useDisclosureScrollLock } from '../../hooks'
import { useUiDisclosureState } from '../../utils/uiDisclosureState'
import { BoundedCache } from '../../utils/boundedCache'

/** 默认预览 8 行 */
const COLLAPSE_PREVIEW_LINES = 8
const LEADING_RELAXED = 1.625
/** 用户消息里的 HTML artifact 判定（CollapsibleUserText 与 UserMessageView 共用） */
export const USER_HTML_ARTIFACT_PATTERN =
  /(?:```(?:html|htm)\b|<!doctype\s+html\b|<html\b|<style\b|<script\b|<canvas\b|\son[a-z]+\s*=)/i

// 折叠状态缓存：消息是否溢出
const overflowStateCache = new BoundedCache<string, boolean>({ maxEntries: 2000 })

export interface CollapsibleUserTextProps {
  text: string
  collapseEnabled: boolean
  renderMarkdown: boolean
  /** 折叠/溢出状态的缓存 key（用户消息用消息 id，队列气泡用 queue:条目id） */
  messageId: string
  /** 气泡外壳；默认普通用户消息的实心灰泡 */
  className?: string
  /** 正文颜色等；默认 text-text-100 */
  textClassName?: string
  /** 底部渐变遮罩的底色类；默认 bg-bg-300（与默认外壳底色一致） */
  maskClassName?: string
  /** 是否显示底部渐变遮罩（半透明底色的气泡没有能严丝合缝的底色，可关掉） */
  showMask?: boolean
}

export const CollapsibleUserText = memo(function CollapsibleUserText({
  text,
  collapseEnabled,
  renderMarkdown,
  messageId,
  className = 'px-4 py-2.5 bg-bg-300 rounded-2xl max-w-full',
  textClassName = 'text-text-100',
  maskClassName = 'bg-bg-300',
  showMask = true,
}: CollapsibleUserTextProps) {
  const { t } = useTranslation('message')
  const contentRef = useRef<HTMLDivElement>(null)
  const { rootRef, headerRef, withScrollLock } = useDisclosureScrollLock()
  const overflowCacheKey = `${messageId}:${renderMarkdown ? 'markdown' : 'plain'}`
  const [expanded, setExpanded] = useUiDisclosureState(`message:${messageId}:user-text`, false)
  const [isOverflow, setIsOverflow] = useState(() => overflowStateCache.get(overflowCacheKey) ?? false)

  useLayoutEffect(() => {
    const el = contentRef.current
    if (!el) return

    let disposed = false
    const measure = () => {
      if (disposed) return
      const fsBase = Number.parseFloat(window.getComputedStyle(el).getPropertyValue('--fs-base'))
      if (!Number.isFinite(fsBase) || fsBase <= 0) return
      const collapsedHeight = fsBase * LEADING_RELAXED * COLLAPSE_PREVIEW_LINES
      const next = el.scrollHeight > collapsedHeight + 1
      overflowStateCache.set(overflowCacheKey, next)
      setIsOverflow(prev => (prev === next ? prev : next))
    }

    measure()
    const resizeObserver = new ResizeObserver(measure)
    resizeObserver.observe(el)
    document.fonts?.ready?.then(measure)

    return () => {
      disposed = true
      resizeObserver.disconnect()
    }
  }, [text, overflowCacheKey])

  const hasHtmlArtifact = renderMarkdown && USER_HTML_ARTIFACT_PATTERN.test(text)
  const showCollapse = collapseEnabled && !hasHtmlArtifact && isOverflow
  const isCollapsed = collapseEnabled && !hasHtmlArtifact && !expanded

  return (
    <div ref={rootRef} className={`${className} ${hasHtmlArtifact ? 'w-full max-w-2xl' : ''}`}>
      <div className="relative">
        <div
          ref={node => {
            contentRef.current = node
            headerRef(node)
          }}
          data-collapse-content={showMask && showCollapse && isCollapsed ? '' : undefined}
          className={`m-0 break-words text-[length:var(--fs-base)] ${textClassName} leading-relaxed${
            renderMarkdown ? '' : ' whitespace-pre-wrap'
          }${isCollapsed ? ' overflow-hidden' : ''}`}
          style={
            isCollapsed
              ? {
                  maxHeight: `calc(var(--fs-base) * ${LEADING_RELAXED} * ${COLLAPSE_PREVIEW_LINES})`,
                  contain: 'layout paint',
                }
              : undefined
          }
        >
          {renderMarkdown ? <MarkdownRenderer content={text} /> : text}
        </div>
        {/* 底部渐变遮罩 */}
        {showMask && showCollapse && isCollapsed && (
          <div
            data-collapse-mask
            className={`absolute bottom-0 left-0 right-0 h-12 ${maskClassName} pointer-events-none [-webkit-mask-image:linear-gradient(to_top,black,transparent)] [mask-image:linear-gradient(to_top,black,transparent)]`}
          />
        )}
      </div>
      {showCollapse && (
        <button
          type="button"
          onClick={() => withScrollLock(() => setExpanded(prev => !prev))}
          className="mt-1 text-[length:var(--fs-sm)] text-text-400 hover:text-text-200 transition-colors"
          aria-expanded={expanded}
        >
          {expanded ? t('showLess') : t('showMore')}
        </button>
      )}
    </div>
  )
})
