import { useState, useCallback, useRef, useEffect, memo } from 'react'
import { useTranslation } from 'react-i18next'
import { DownloadIcon, PlusIcon, MinusIcon } from '../../components/Icons'
import { CopyButton } from '../../components/ui'
import { getAttachmentIcon } from './utils'
import { saveData } from '../../utils/downloadUtils'
import type { Attachment } from './types'
import { FullscreenViewer } from '../../components/FullscreenViewer'
import { CodePreview } from '../../components/CodePreview'
import { detectLanguage } from '../../utils/languageUtils'

// ============================================
// 常量
// ============================================

const MIN_SCALE = 0.1
const MAX_SCALE = 10
const ZOOM_STEP = 0.25
const ZOOM_WHEEL_FACTOR = 0.001
const DOUBLE_TAP_DELAY = 300 // ms

// ============================================
// 工具函数
// ============================================

function getTouchDistance(t1: React.Touch | Touch, t2: React.Touch | Touch): number {
  const dx = t1.clientX - t2.clientX
  const dy = t1.clientY - t2.clientY
  return Math.sqrt(dx * dx + dy * dy)
}

function getTouchCenter(t1: React.Touch | Touch, t2: React.Touch | Touch): { x: number; y: number } {
  return {
    x: (t1.clientX + t2.clientX) / 2,
    y: (t1.clientY + t2.clientY) / 2,
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

// ============================================
// 主组件
// ============================================

interface AttachmentDetailModalProps {
  attachment: Attachment | null
  isOpen: boolean
  onClose: () => void
}

export const AttachmentDetailModal = memo(function AttachmentDetailModal({
  attachment,
  isOpen,
  onClose,
}: AttachmentDetailModalProps) {
  const { t } = useTranslation(['commands', 'common'])

  if (!attachment) return null

  const isImage = attachment.mime?.startsWith('image/')
  const hasContent = !!attachment.content
  const hasUrl = !!attachment.url
  const { Icon, colorClass } = getAttachmentIcon(attachment)

  const titleNode = (
    <div className="flex items-center gap-2 min-w-0 flex-1">
      <span className={`${colorClass} flex items-center shrink-0 [&>svg]:w-4 [&>svg]:h-4`}>
        <Icon />
      </span>
      <span className="text-text-100 text-[length:var(--fs-md)] font-mono font-medium truncate min-w-0 flex-1">
        {attachment.displayName}
      </span>
      {attachment.mime && (
        <span className="text-[length:var(--fs-xs)] text-text-500 shrink-0 hidden sm:inline">{attachment.mime}</span>
      )}
    </div>
  )

  const headerRightNode = (
    <div className="flex items-center gap-1">
      {hasContent && <CopyButton text={attachment.content!} position="static" />}
      {(hasContent || (isImage && hasUrl)) && <DownloadButton attachment={attachment} />}
    </div>
  )

  return (
    <FullscreenViewer isOpen={isOpen} onClose={onClose} zIndex={200} title={titleNode} headerRight={headerRightNode}>
      {isImage && hasUrl ? (
        <ZoomableImage url={attachment.url!} alt={attachment.displayName} />
      ) : hasContent ? (
        <CodePreview code={attachment.content!} language={detectLanguage(attachment.displayName) || 'text'} />
      ) : (
        <div className="flex items-center justify-center h-full text-text-400 text-[length:var(--fs-base)]">{t('attachment.noPreview')}</div>
      )}
    </FullscreenViewer>
  )
})

// ============================================
// DownloadButton - 主题色下载按钮
// ============================================

function DownloadButton({ attachment }: { attachment: Attachment }) {
  const { t } = useTranslation(['commands', 'common'])

  const handleDownload = useCallback(() => {
    const isImage = attachment.mime?.startsWith('image/')
    const fileName = attachment.displayName || (isImage ? 'image' : 'attachment.txt')

    if (isImage && attachment.url) {
      fetch(attachment.url)
        .then(res => res.arrayBuffer())
        .then(buf => saveData(new Uint8Array(buf), fileName, attachment.mime || 'image/png'))
        .catch(err => console.warn('[AttachmentDetailModal] save image failed:', err))
    } else if (attachment.content) {
      saveData(new TextEncoder().encode(attachment.content), fileName, 'text/plain;charset=utf-8')
    }
  }, [attachment])

  return (
    <button
      onClick={handleDownload}
      className="p-1.5 text-text-400 hover:text-text-100 hover:bg-bg-200/60 rounded-lg transition-colors"
      title={t('attachment.saveToFile')}
    >
      <DownloadIcon size={16} />
    </button>
  )
}

// ============================================
// ZoomableImage - 支持鼠标 + 触摸的图片查看器
// ============================================

function ZoomableImage({ url, alt }: { url: string; alt: string }) {
  const { t } = useTranslation(['commands', 'common'])
  const containerRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  const [scale, setScale] = useState(1)
  const [translate, setTranslate] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [imgLoaded, setImgLoaded] = useState(false)
  const [imgError, setImgError] = useState(false)

  const stateRef = useRef({ scale: 1, translate: { x: 0, y: 0 } })
  useEffect(() => {
    stateRef.current = { scale, translate }
  }, [scale, translate])

  const dragStart = useRef({ x: 0, y: 0 })
  const translateStart = useRef({ x: 0, y: 0 })

  const touchState = useRef<{
    mode: 'none' | 'drag' | 'pinch'
    startPos: { x: number; y: number }
    startTranslate: { x: number; y: number }
    startDistance: number
    startScale: number
    startCenter: { x: number; y: number }
    startPinchTranslate: { x: number; y: number }
    lastTapTime: number
    lastTapPos: { x: number; y: number }
  }>({
    mode: 'none',
    startPos: { x: 0, y: 0 },
    startTranslate: { x: 0, y: 0 },
    startDistance: 0,
    startScale: 1,
    startCenter: { x: 0, y: 0 },
    startPinchTranslate: { x: 0, y: 0 },
    lastTapTime: 0,
    lastTapPos: { x: 0, y: 0 },
  })

  const resetView = useCallback(() => {
    setScale(1)
    setTranslate({ x: 0, y: 0 })
  }, [])

  const getContainerCenter = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return { cx: 0, cy: 0 }
    return { cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 }
  }, [])

  const zoomToPoint = useCallback(
    (newScale: number, pointX: number, pointY: number) => {
      const { cx, cy } = getContainerCenter()
      const mx = pointX - cx
      const my = pointY - cy
      const cur = stateRef.current
      const ratio = newScale / cur.scale
      setScale(newScale)
      setTranslate({
        x: mx - ratio * (mx - cur.translate.x),
        y: my - ratio * (my - cur.translate.y),
      })
    },
    [getContainerCenter],
  )

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const cur = stateRef.current
      const delta = -e.deltaY * ZOOM_WHEEL_FACTOR
      const newScale = clamp(cur.scale * (1 + delta), MIN_SCALE, MAX_SCALE)
      zoomToPoint(newScale, e.clientX, e.clientY)
    },
    [zoomToPoint],
  )

  const zoomIn = useCallback(() => {
    setScale(prev => clamp(prev + ZOOM_STEP, MIN_SCALE, MAX_SCALE))
  }, [])
  const zoomOut = useCallback(() => {
    setScale(prev => clamp(prev - ZOOM_STEP, MIN_SCALE, MAX_SCALE))
  }, [])

  const toggleZoomAtPoint = useCallback(
    (px: number, py: number) => {
      const cur = stateRef.current
      const isDefault = Math.abs(cur.scale - 1) < 0.05 && Math.abs(cur.translate.x) < 2 && Math.abs(cur.translate.y) < 2
      if (isDefault) {
        zoomToPoint(2, px, py)
      } else {
        resetView()
      }
    },
    [zoomToPoint, resetView],
  )

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      toggleZoomAtPoint(e.clientX, e.clientY)
    },
    [toggleZoomAtPoint],
  )

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    setIsDragging(true)
    dragStart.current = { x: e.clientX, y: e.clientY }
    translateStart.current = { ...stateRef.current.translate }
  }, [])

  useEffect(() => {
    if (!isDragging) return
    const handleMouseMove = (e: MouseEvent) => {
      setTranslate({
        x: translateStart.current.x + (e.clientX - dragStart.current.x),
        y: translateStart.current.y + (e.clientY - dragStart.current.y),
      })
    }
    const handleMouseUp = () => setIsDragging(false)
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging])

  const toggleZoomRef = useRef(toggleZoomAtPoint)
  useEffect(() => {
    toggleZoomRef.current = toggleZoomAtPoint
  }, [toggleZoomAtPoint])

  const getContainerCenterRef = useRef(getContainerCenter)
  useEffect(() => {
    getContainerCenterRef.current = getContainerCenter
  }, [getContainerCenter])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const ts = touchState.current

    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault()
      const touches = e.touches

      if (touches.length === 1) {
        const t = touches[0]
        const now = Date.now()
        const dt = now - ts.lastTapTime
        const dx = Math.abs(t.clientX - ts.lastTapPos.x)
        const dy = Math.abs(t.clientY - ts.lastTapPos.y)

        if (dt < DOUBLE_TAP_DELAY && dx < 30 && dy < 30) {
          ts.lastTapTime = 0
          toggleZoomRef.current(t.clientX, t.clientY)
          return
        }

        ts.lastTapTime = now
        ts.lastTapPos = { x: t.clientX, y: t.clientY }
        ts.mode = 'drag'
        ts.startPos = { x: t.clientX, y: t.clientY }
        ts.startTranslate = { ...stateRef.current.translate }
        setIsDragging(true)
      } else if (touches.length === 2) {
        ts.mode = 'pinch'
        ts.lastTapTime = 0
        ts.startDistance = getTouchDistance(touches[0], touches[1])
        ts.startScale = stateRef.current.scale
        ts.startCenter = getTouchCenter(touches[0], touches[1])
        ts.startPinchTranslate = { ...stateRef.current.translate }
        setIsDragging(true)
      }
    }

    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault()
      const touches = e.touches

      if (ts.mode === 'drag' && touches.length === 1) {
        const t = touches[0]
        setTranslate({
          x: ts.startTranslate.x + (t.clientX - ts.startPos.x),
          y: ts.startTranslate.y + (t.clientY - ts.startPos.y),
        })
      } else if (ts.mode === 'pinch' && touches.length >= 2) {
        const newDist = getTouchDistance(touches[0], touches[1])
        const ratio = newDist / ts.startDistance
        const newScale = clamp(ts.startScale * ratio, MIN_SCALE, MAX_SCALE)

        const { cx, cy } = getContainerCenterRef.current()
        const mx = ts.startCenter.x - cx
        const my = ts.startCenter.y - cy
        const scaleRatio = newScale / ts.startScale

        const newCenter = getTouchCenter(touches[0], touches[1])
        const panX = newCenter.x - ts.startCenter.x
        const panY = newCenter.y - ts.startCenter.y

        setScale(newScale)
        setTranslate({
          x: mx - scaleRatio * (mx - ts.startPinchTranslate.x) + panX,
          y: my - scaleRatio * (my - ts.startPinchTranslate.y) + panY,
        })
      }
    }

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length === 0) {
        ts.mode = 'none'
        setIsDragging(false)
      } else if (e.touches.length === 1 && ts.mode === 'pinch') {
        const t = e.touches[0]
        ts.mode = 'drag'
        ts.startPos = { x: t.clientX, y: t.clientY }
        ts.startTranslate = { ...stateRef.current.translate }
      }
    }

    el.addEventListener('touchstart', onTouchStart, { passive: false })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd)

    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
    }
  }, [])

  if (imgError) {
    return (
      <div className="flex items-center justify-center h-full text-text-400 text-[length:var(--fs-base)]">
        {t('attachment.failedToLoadImage')}
      </div>
    )
  }

  const scalePercent = Math.round(scale * 100)
  const isAnimating = !isDragging

  return (
    <div className="relative w-full h-full flex flex-col">
      <div
        ref={containerRef}
        className="flex-1 min-h-0 overflow-hidden relative"
        style={{ touchAction: 'none', cursor: isDragging ? 'grabbing' : 'grab' }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
      >
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{
            transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
            transition: isAnimating ? 'transform 0.15s ease-out' : 'none',
            willChange: 'transform',
          }}
        >
          <img
            ref={imgRef}
            src={url}
            alt={alt}
            onLoad={() => setImgLoaded(true)}
            onError={() => setImgError(true)}
            draggable={false}
            className="max-w-[90%] max-h-[90%] object-contain select-none pointer-events-none"
            style={{ imageRendering: scale > 2 ? 'pixelated' : 'auto' }}
          />
        </div>
      </div>

      {/* 底部缩放控制条 — 用主题色 */}
      {imgLoaded && (
        <div className="flex items-center justify-center gap-1 py-1.5 sm:py-2 shrink-0">
          <ZoomButton onClick={zoomOut} disabled={scale <= MIN_SCALE} title={t('attachment.zoomOut')}>
            <MinusIcon size={14} />
          </ZoomButton>
          <button
            onClick={resetView}
            className="px-2 py-1 rounded text-[length:var(--fs-sm)] font-mono text-text-400 hover:text-text-100 hover:bg-bg-200/60 transition-colors min-w-[52px] min-h-[44px] sm:min-h-0 flex items-center justify-center"
            title={t('attachment.zoomReset')}
          >
            {scalePercent}%
          </button>
          <ZoomButton onClick={zoomIn} disabled={scale >= MAX_SCALE} title={t('attachment.zoomIn')}>
            <PlusIcon size={14} />
          </ZoomButton>
        </div>
      )}
    </div>
  )
}

// ============================================
// ZoomButton - 缩放操作按钮
// ============================================

function ZoomButton({
  onClick,
  disabled,
  title,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="p-2 rounded text-text-400 hover:text-text-100 hover:bg-bg-200/60 transition-colors disabled:opacity-30 disabled:cursor-not-allowed min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center"
      title={title}
    >
      {children}
    </button>
  )
}
