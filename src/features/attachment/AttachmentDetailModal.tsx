import { useState, useCallback, useRef, useEffect, memo } from 'react'
import { createPortal } from 'react-dom'
import { CloseIcon, CopyIcon, CheckIcon, DownloadIcon, PlusIcon } from '../../components/Icons'
import { getAttachmentIcon } from './utils'
import { clipboardErrorHandler } from '../../utils'
import { saveData } from '../../utils/downloadUtils'
import type { Attachment } from './types'

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

/** 两个触摸点之间的距离 */
function getTouchDistance(t1: React.Touch | Touch, t2: React.Touch | Touch): number {
  const dx = t1.clientX - t2.clientX
  const dy = t1.clientY - t2.clientY
  return Math.sqrt(dx * dx + dy * dy)
}

/** 两个触摸点的中点 */
function getTouchCenter(t1: React.Touch | Touch, t2: React.Touch | Touch): { x: number; y: number } {
  return {
    x: (t1.clientX + t2.clientX) / 2,
    y: (t1.clientY + t2.clientY) / 2,
  }
}

/** clamp 到 [min, max] */
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
  const [shouldRender, setShouldRender] = useState(false)
  const [isVisible, setIsVisible] = useState(false)

  // 进场/退场动画
  useEffect(() => {
    if (isOpen) {
      setShouldRender(true)
    } else {
      setIsVisible(false)
      const t = setTimeout(() => setShouldRender(false), 200)
      return () => clearTimeout(t)
    }
  }, [isOpen])

  useEffect(() => {
    if (shouldRender && isOpen) {
      const t = setTimeout(() => setIsVisible(true), 10)
      return () => clearTimeout(t)
    }
  }, [shouldRender, isOpen])

  // Esc 关闭
  useEffect(() => {
    if (!isOpen) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); e.stopPropagation() }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [isOpen, onClose])

  // 锁定 body 滚动
  useEffect(() => {
    if (!isOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [isOpen])

  // 防止背景误触：触摸设备不走背景关闭，鼠标需要 pointerdown+click 都在背景上
  const mouseDownOnBackdrop = useRef(false)
  const handleBackdropPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'touch') return
    mouseDownOnBackdrop.current = e.target === e.currentTarget
  }, [])
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget && mouseDownOnBackdrop.current) {
      onClose()
    }
    mouseDownOnBackdrop.current = false
  }, [onClose])

  if (!shouldRender || !attachment) return null

  const isImage = attachment.mime?.startsWith('image/')
  const hasContent = !!attachment.content
  const hasUrl = !!attachment.url

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex flex-col transition-all duration-200 ease-out"
      style={{
        backgroundColor: isVisible ? 'hsl(var(--always-black) / 0.85)' : 'hsl(var(--always-black) / 0)',
        opacity: isVisible ? 1 : 0,
      }}
      onPointerDown={handleBackdropPointerDown}
      onClick={handleBackdropClick}
    >
      {/* 顶部工具栏 */}
      <ToolBar
        attachment={attachment}
        isImage={!!isImage}
        hasContent={hasContent}
        hasUrl={hasUrl}
        onClose={onClose}
      />

      {/* 主内容区 */}
      <div className="flex-1 min-h-0 relative">
        {isImage && hasUrl ? (
          <ZoomableImage url={attachment.url!} alt={attachment.displayName} />
        ) : hasContent ? (
          <TextViewer content={attachment.content!} />
        ) : (
          <div className="flex items-center justify-center h-full text-text-400 text-sm">
            No preview available
          </div>
        )}
      </div>
    </div>,
    document.body
  )
})

// ============================================
// ToolBar - 顶部工具栏（移动端加大触摸区域）
// ============================================

interface ToolBarProps {
  attachment: Attachment
  isImage: boolean
  hasContent: boolean
  hasUrl: boolean
  onClose: () => void
}

function ToolBar({ attachment, isImage, hasContent, hasUrl, onClose }: ToolBarProps) {
  const { Icon, colorClass } = getAttachmentIcon(attachment)

  return (
    <div
      className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 sm:py-2.5 shrink-0 border-b border-white/10"
      onClick={(e) => e.stopPropagation()}
    >
      {/* 左侧：文件信息 */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <span className={`${colorClass} flex items-center shrink-0 [&>svg]:w-4 [&>svg]:h-4`}>
          <Icon />
        </span>
        <span className="text-sm text-white/90 truncate" title={attachment.displayName}>
          {attachment.displayName}
        </span>
        <span className="text-xs text-white/40 shrink-0 hidden sm:inline">
          {attachment.mime || ''}
        </span>
      </div>

      {/* 右侧：操作按钮 */}
      <div className="flex items-center gap-0.5 shrink-0">
        {hasContent && <InlineCopyButton text={attachment.content!} />}
        {(hasContent || (isImage && hasUrl)) && (
          <InlineDownloadButton attachment={attachment} />
        )}
        <div className="w-px h-4 bg-white/20 mx-0.5 sm:mx-1" />
        <button
          onClick={onClose}
          className="p-2 sm:p-1.5 rounded-md text-white/60 hover:text-white active:text-white hover:bg-white/10 active:bg-white/10 transition-colors min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center"
          title="Close (Esc)"
        >
          <CloseIcon size={16} />
        </button>
      </div>
    </div>
  )
}

// ============================================
// ZoomableImage - 支持鼠标 + 触摸的图片查看器
//
// 鼠标：滚轮缩放、拖拽平移、双击切换
// 触摸：单指拖拽、双指 pinch 缩放、双击切换
// ============================================

function ZoomableImage({ url, alt }: { url: string; alt: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  const [scale, setScale] = useState(1)
  const [translate, setTranslate] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [imgLoaded, setImgLoaded] = useState(false)
  const [imgError, setImgError] = useState(false)

  // 用 ref 存储实时值，避免闭包问题
  const stateRef = useRef({ scale: 1, translate: { x: 0, y: 0 } })
  useEffect(() => {
    stateRef.current = { scale, translate }
  }, [scale, translate])

  // --- 鼠标拖拽 ---
  const dragStart = useRef({ x: 0, y: 0 })
  const translateStart = useRef({ x: 0, y: 0 })

  // --- 触摸状态 ---
  const touchState = useRef<{
    mode: 'none' | 'drag' | 'pinch'
    // 单指拖拽
    startPos: { x: number; y: number }
    startTranslate: { x: number; y: number }
    // 双指缩放
    startDistance: number
    startScale: number
    startCenter: { x: number; y: number }
    startPinchTranslate: { x: number; y: number }
    // 双击检测
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

  // 重置
  const resetView = useCallback(() => {
    setScale(1)
    setTranslate({ x: 0, y: 0 })
  }, [])

  // 获取容器中心坐标
  const getContainerCenter = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return { cx: 0, cy: 0 }
    return { cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 }
  }, [])

  // 以某个点为中心缩放
  const zoomToPoint = useCallback((newScale: number, pointX: number, pointY: number) => {
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
  }, [getContainerCenter])

  // ---- 滚轮缩放 ----
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const cur = stateRef.current
    const delta = -e.deltaY * ZOOM_WHEEL_FACTOR
    const newScale = clamp(cur.scale * (1 + delta), MIN_SCALE, MAX_SCALE)
    zoomToPoint(newScale, e.clientX, e.clientY)
  }, [zoomToPoint])

  // ---- 按钮缩放 ----
  const zoomIn = useCallback(() => {
    setScale(prev => clamp(prev + ZOOM_STEP, MIN_SCALE, MAX_SCALE))
  }, [])
  const zoomOut = useCallback(() => {
    setScale(prev => clamp(prev - ZOOM_STEP, MIN_SCALE, MAX_SCALE))
  }, [])

  // ---- 双击/双击切换 ----
  const toggleZoomAtPoint = useCallback((px: number, py: number) => {
    const cur = stateRef.current
    const isDefault = Math.abs(cur.scale - 1) < 0.05
      && Math.abs(cur.translate.x) < 2
      && Math.abs(cur.translate.y) < 2
    if (isDefault) {
      zoomToPoint(2, px, py)
    } else {
      resetView()
    }
  }, [zoomToPoint, resetView])

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    toggleZoomAtPoint(e.clientX, e.clientY)
  }, [toggleZoomAtPoint])

  // ---- 鼠标拖拽 ----
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

  // ---- 触摸：拖拽 + pinch + 双击 ----
  // 用原生 addEventListener + { passive: false } 才能 preventDefault
  // React 合成事件的 touch 默认是 passive，无法阻止浏览器缩放/滚动
  const toggleZoomRef = useRef(toggleZoomAtPoint)
  useEffect(() => { toggleZoomRef.current = toggleZoomAtPoint }, [toggleZoomAtPoint])

  const getContainerCenterRef = useRef(getContainerCenter)
  useEffect(() => { getContainerCenterRef.current = getContainerCenter }, [getContainerCenter])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const ts = touchState.current

    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault()
      const touches = e.touches

      if (touches.length === 1) {
        const t = touches[0]

        // 双击检测
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

        // 单指拖拽
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
  }, []) // 不依赖外部状态，全部通过 ref 访问

  if (imgError) {
    return (
      <div className="flex items-center justify-center h-full text-white/40 text-sm">
        Failed to load image
      </div>
    )
  }

  const scalePercent = Math.round(scale * 100)
  const isAnimating = !isDragging

  return (
    <div className="relative w-full h-full flex flex-col">
      {/* 图片区域 */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 overflow-hidden relative"
        style={{ touchAction: 'none', cursor: isDragging ? 'grabbing' : 'grab' }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
        onClick={(e) => e.stopPropagation()}
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

      {/* 底部缩放控制条 */}
      {imgLoaded && (
        <div
          className="flex items-center justify-center gap-1 py-1.5 sm:py-2 shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <ToolButton onClick={zoomOut} disabled={scale <= MIN_SCALE} title="Zoom out">
            <MinusIcon size={14} />
          </ToolButton>

          <button
            onClick={resetView}
            className="px-2 py-1 rounded text-xs font-mono text-white/70 hover:text-white active:text-white hover:bg-white/10 active:bg-white/10 transition-colors min-w-[52px] min-h-[44px] sm:min-h-0 flex items-center justify-center"
            title="Reset (double-click / double-tap)"
          >
            {scalePercent}%
          </button>

          <ToolButton onClick={zoomIn} disabled={scale >= MAX_SCALE} title="Zoom in">
            <PlusIcon size={14} />
          </ToolButton>
        </div>
      )}
    </div>
  )
}

// ============================================
// 通用工具按钮 - 保证移动端 44px 最小触摸区域
// ============================================

function ToolButton({
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
      className="p-2 rounded text-white/60 hover:text-white active:text-white hover:bg-white/10 active:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center"
      title={title}
    >
      {children}
    </button>
  )
}

// MinusIcon（项目里没有，内联）
function MinusIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

// ============================================
// TextViewer - 带行号的文本查看器
// ============================================

function TextViewer({ content }: { content: string }) {
  const lines = content.split('\n')
  const gutterWidth = String(lines.length).length

  return (
    <div
      className="w-full h-full overflow-auto custom-scrollbar overscroll-contain"
      style={{ WebkitOverflowScrolling: 'touch' }}
      onClick={(e) => e.stopPropagation()}
    >
      <table className="w-full border-collapse text-xs font-mono leading-relaxed">
        <tbody>
          {lines.map((line, i) => (
            <tr key={i} className="hover:bg-white/[0.03] active:bg-white/[0.03]">
              <td
                className="sticky left-0 px-3 py-0 text-right select-none text-white/20 bg-black/30 border-r border-white/5 align-top"
                style={{ minWidth: `${gutterWidth + 2}ch` }}
              >
                {i + 1}
              </td>
              <td className="px-4 py-0 text-white/80 whitespace-pre-wrap break-all select-text">
                {line || '\u00A0'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ============================================
// 内联操作按钮（移动端加大触摸区域）
// ============================================

function InlineCopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current) }
  }, [])

  const handleCopy = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      timeoutRef.current = setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      clipboardErrorHandler('copy', err)
    }
  }, [text])

  return (
    <button
      onClick={handleCopy}
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 justify-center ${
        copied
          ? 'text-green-400'
          : 'text-white/60 hover:text-white active:text-white hover:bg-white/10 active:bg-white/10'
      }`}
      title={copied ? 'Copied!' : 'Copy content'}
    >
      {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
      <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy'}</span>
    </button>
  )
}

function InlineDownloadButton({ attachment }: { attachment: Attachment }) {
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
      onClick={(e) => { e.stopPropagation(); handleDownload() }}
      className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-white/60 hover:text-white active:text-white hover:bg-white/10 active:bg-white/10 transition-colors min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 justify-center"
      title="Save to file"
    >
      <DownloadIcon size={14} />
      <span className="hidden sm:inline">Save</span>
    </button>
  )
}
