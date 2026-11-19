import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { CodeBlock } from '../CodeBlock'
import { HandIcon, RetryIcon, ZoomInIcon, ZoomOutIcon } from '../Icons'
import { CopyButton } from '../ui'
import { useTheme } from '../../hooks/useTheme'
import { useInputCapabilities } from '../../hooks/useInputCapabilities'
import { getCachedMermaidSvg, getOrRenderMermaidSvg } from '../mermaidRenderCache'
import { reportRenderFailure } from '../../utils/renderDiagnostics'

const MERMAID_MIN_SCALE = 0.5
const MERMAID_MAX_SCALE = 3
const MERMAID_SCALE_STEP = 0.15
const MERMAID_CONTROL_BUTTON_BASE_CLASS =
  'inline-flex h-8 w-8 items-center justify-center rounded-md bg-bg-300/70 backdrop-blur-md transition-colors duration-150 hover:bg-bg-300/85 disabled:opacity-40 disabled:cursor-not-allowed'
const MERMAID_CONTROL_BUTTON_CLASS = `${MERMAID_CONTROL_BUTTON_BASE_CLASS} text-text-400 hover:text-text-200`
type DiagramPointer = { x: number; y: number }

type PinchGesture = {
  startDistance: number
  startScale: number
  startOffset: { x: number; y: number }
  startCenter: { x: number; y: number }
}

let mermaidRenderCounter = 0

function createMermaidRenderId(prefix: string) {
  mermaidRenderCounter += 1
  const safePrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, '') || 'diagram'
  return `mermaid-${safePrefix}-${mermaidRenderCounter}`
}

function scopeMermaidSvg(svg: string, instanceId: string) {
  const template = document.createElement('template')
  template.innerHTML = svg
  const root = template.content.querySelector('svg')
  if (!root) return svg

  const idMap = new Map<string, string>()
  const elementsWithIds = [...(root.hasAttribute('id') ? [root] : []), ...root.querySelectorAll('[id]')]
  elementsWithIds.forEach((element, index) => {
    const id = element.getAttribute('id')
    if (!id) return
    const nextId = `${instanceId}-${index}`
    idMap.set(id, nextId)
    element.setAttribute('id', nextId)
  })

  const replaceReferences = (value: string) =>
    value.replace(/#([a-zA-Z0-9_.:-]+)/g, (match, id: string) => {
      const nextId = idMap.get(id)
      return nextId ? `#${nextId}` : match
    })

  const elements = [root, ...root.querySelectorAll('*')]
  elements.forEach(element => {
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.name === 'aria-labelledby' || attribute.name === 'aria-describedby') {
        const value = attribute.value
          .split(/\s+/)
          .map(id => idMap.get(id) ?? id)
          .join(' ')
        element.setAttribute(attribute.name, value)
        continue
      }
      const value = replaceReferences(attribute.value)
      if (value !== attribute.value) element.setAttribute(attribute.name, value)
    }
  })
  root.querySelectorAll('style').forEach(style => {
    if (style.textContent) style.textContent = replaceReferences(style.textContent)
  })

  return root.outerHTML
}

async function getMermaidSvg(code: string, theme: 'dark' | 'default', renderPrefix: string) {
  const cacheKey = `${theme}:${code}`
  return getOrRenderMermaidSvg(cacheKey, async () => {
    const { default: mermaid } = await import('mermaid')
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme })
    const result = await mermaid.render(createMermaidRenderId(renderPrefix), code)
    return result.svg
  })
}

function clampMermaidScale(scale: number) {
  return Math.min(MERMAID_MAX_SCALE, Math.max(MERMAID_MIN_SCALE, Number(scale.toFixed(2))))
}

function getPointerDistance(first: DiagramPointer, second: DiagramPointer) {
  return Math.hypot(first.x - second.x, first.y - second.y)
}

function getPointerCenter(first: DiagramPointer, second: DiagramPointer) {
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
  }
}

function getRelativeCenter(target: HTMLDivElement, first: DiagramPointer, second: DiagramPointer) {
  const center = getPointerCenter(first, second)
  const rect = target.parentElement?.getBoundingClientRect()
  if (!rect) return center
  return {
    x: center.x - rect.left,
    y: center.y - rect.top,
  }
}

// ─── Mermaid ────────────────────────────────────────────────────

export const MermaidBlock = memo(function MermaidBlock({ code, isIncomplete }: { code: string; isIncomplete?: boolean }) {
  const { resolvedTheme } = useTheme()
  const mermaidTheme = resolvedTheme === 'dark' ? 'dark' : 'default'
  const { hasCoarsePointer, hasTouch, preferTouchUi } = useInputCapabilities()
  const supportsTouchGestures = hasCoarsePointer || hasTouch
  const renderPrefix = useId()
  const instanceSvgId = `mermaid-instance-${renderPrefix.replace(/[^a-zA-Z0-9_-]/g, '')}`
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
  } | null>(null)
  const touchPointersRef = useRef<Map<number, DiagramPointer>>(new Map())
  const pinchRef = useRef<PinchGesture | null>(null)
  const [svg, setSvg] = useState(() => (isIncomplete ? '' : (getCachedMermaidSvg(`${mermaidTheme}:${code}`) ?? '')))
  const [error, setError] = useState('')
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [isTouchPanEnabled, setIsTouchPanEnabled] = useState(false)

  const resetView = useCallback(() => {
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }, [])
  const scopedSvg = useMemo(() => scopeMermaidSvg(svg, instanceSvgId), [instanceSvgId, svg])

  const zoomBy = useCallback((delta: number) => {
    setScale(current => clampMermaidScale(current + delta))
  }, [])

  const clearTouchGesture = useCallback(() => {
    touchPointersRef.current.clear()
    pinchRef.current = null
    dragRef.current = null
  }, [])

  const beginPinchGesture = useCallback(
    (target: HTMLDivElement) => {
      const pointers = Array.from(touchPointersRef.current.values())
      if (pointers.length < 2) return
      const [first, second] = pointers
      pinchRef.current = {
        startDistance: Math.max(1, getPointerDistance(first, second)),
        startScale: scale,
        startOffset: offset,
        startCenter: getRelativeCenter(target, first, second),
      }
      dragRef.current = null
    },
    [offset, scale],
  )

  const handleContainerClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!preferTouchUi) return
      if (event.target instanceof HTMLElement && event.target.closest('button')) return
      event.currentTarget.focus({ preventScroll: true })
    },
    [preferTouchUi],
  )

  const handleContainerBlur = useCallback(
    (event: React.FocusEvent<HTMLDivElement>) => {
      if (!preferTouchUi) return
      const nextTarget = event.relatedTarget
      if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return
      setIsTouchPanEnabled(false)
      clearTouchGesture()
    },
    [clearTouchGesture, preferTouchUi],
  )

  useEffect(() => {
    if (isTouchPanEnabled) return
    clearTouchGesture()
  }, [clearTouchGesture, isTouchPanEnabled])

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return
      if (supportsTouchGestures && event.pointerType !== 'mouse' && !isTouchPanEnabled) return
      if (event.pointerType !== 'mouse') {
        touchPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
        if (touchPointersRef.current.size >= 2) {
          beginPinchGesture(event.currentTarget)
          event.currentTarget.setPointerCapture?.(event.pointerId)
          return
        }
      }
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: offset.x,
        originY: offset.y,
      }
      event.currentTarget.setPointerCapture?.(event.pointerId)
    },
    [beginPinchGesture, supportsTouchGestures, isTouchPanEnabled, offset.x, offset.y],
  )

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse' && touchPointersRef.current.has(event.pointerId)) {
      touchPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      const pointers = Array.from(touchPointersRef.current.values())
      const pinch = pinchRef.current
      if (pointers.length >= 2 && pinch) {
        const [first, second] = pointers
        const distance = Math.max(1, getPointerDistance(first, second))
        const center = getRelativeCenter(event.currentTarget, first, second)
        const nextScale = clampMermaidScale(pinch.startScale * (distance / pinch.startDistance))
        const anchorX = (pinch.startCenter.x - pinch.startOffset.x) / pinch.startScale
        const anchorY = (pinch.startCenter.y - pinch.startOffset.y) / pinch.startScale

        event.preventDefault()
        setScale(nextScale)
        setOffset({
          x: center.x - anchorX * nextScale,
          y: center.y - anchorY * nextScale,
        })
        return
      }
    }

    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    setOffset({
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY,
    })
  }, [])

  const handlePointerEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse') {
      touchPointersRef.current.delete(event.pointerId)
      if (touchPointersRef.current.size < 2) pinchRef.current = null
    }
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null
    }
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }, [])

  useEffect(() => {
    if (isIncomplete || !code.trim()) {
      return
    }

    let cancelled = false

    async function renderDiagram() {
      try {
        const cached = getCachedMermaidSvg(`${mermaidTheme}:${code}`)
        setSvg(cached ?? '')
        setError('')
        resetView()
        if (cached !== undefined) return
        const result = await getMermaidSvg(code, mermaidTheme, renderPrefix)
        if (!cancelled) setSvg(result)
      } catch (err) {
        // 渲染失败退化成源码块，属于降级；内容本身还在
        reportRenderFailure('mermaid', 'degraded', err)
        if (!cancelled) {
          setSvg('')
          setError(err instanceof Error ? err.message : 'Failed to render Mermaid diagram')
        }
      }
    }

    void renderDiagram()

    return () => {
      cancelled = true
    }
  }, [code, isIncomplete, mermaidTheme, renderPrefix, resetView])

  if (isIncomplete) {
    return <CodeBlock code={code} language="mermaid" deferHighlight />
  }

  if (error) {
    return (
      <div className="my-4 first:mt-0 last:mb-0 rounded-md border border-danger-100/30 bg-danger-bg/40 p-3">
        <p className="mb-2 text-[length:var(--fs-sm)] font-medium text-danger-100">Mermaid render failed</p>
        <CodeBlock code={code} language="mermaid" />
      </div>
    )
  }

  if (!svg) {
    return (
      <div
        className="my-4 first:mt-0 last:mb-0 flex min-h-40 items-center justify-center"
        aria-label="Rendering diagram"
      >
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-text-400/25 border-t-text-400" />
      </div>
    )
  }

  return (
    <div
      className={`group/mermaid relative my-4 first:mt-0 last:mb-0 overflow-hidden ${preferTouchUi ? 'focus:outline-none' : ''}`}
      tabIndex={preferTouchUi ? 0 : undefined}
      onClick={preferTouchUi ? handleContainerClick : undefined}
      onBlur={preferTouchUi ? handleContainerBlur : undefined}
    >
      <div
        className={`absolute right-2 top-2 z-10 flex items-center gap-1 opacity-0 transition-opacity group-hover/mermaid:opacity-100 group-focus-within/mermaid:opacity-100 ${preferTouchUi ? '[@media(hover:none)]:opacity-0' : '[@media(hover:none)]:opacity-100'}`}
        onMouseDown={event => event.preventDefault()}
      >
        <CopyButton text={code} position="static" className={`!h-8 !w-8 !p-2 ${MERMAID_CONTROL_BUTTON_BASE_CLASS}`} />
        {preferTouchUi && (
          <button
            type="button"
            className={`${MERMAID_CONTROL_BUTTON_CLASS} ${isTouchPanEnabled ? 'ring-1 ring-accent-main-100/60 !text-accent-main-100' : ''}`}
            onClick={() => setIsTouchPanEnabled(current => !current)}
            title={isTouchPanEnabled ? 'Disable diagram pan' : 'Enable diagram pan'}
            aria-label={isTouchPanEnabled ? 'Disable diagram pan' : 'Enable diagram pan'}
            aria-pressed={isTouchPanEnabled}
          >
            <HandIcon />
          </button>
        )}
        {!preferTouchUi && (
          <>
            <button
              type="button"
              className={MERMAID_CONTROL_BUTTON_CLASS}
              onClick={() => zoomBy(-MERMAID_SCALE_STEP)}
              disabled={scale <= MERMAID_MIN_SCALE}
              title="Zoom out"
              aria-label="Zoom out diagram"
            >
              <ZoomOutIcon />
            </button>
            <button
              type="button"
              className={MERMAID_CONTROL_BUTTON_CLASS}
              onClick={() => zoomBy(MERMAID_SCALE_STEP)}
              disabled={scale >= MERMAID_MAX_SCALE}
              title="Zoom in"
              aria-label="Zoom in diagram"
            >
              <ZoomInIcon />
            </button>
          </>
        )}
        <button
          type="button"
          className={MERMAID_CONTROL_BUTTON_CLASS}
          onClick={resetView}
          title="Reset view"
          aria-label="Reset diagram view"
        >
          <RetryIcon />
        </button>
      </div>
      <div
        className={`mermaid-diagram min-h-40 min-w-fit select-none overflow-hidden p-1 [&_svg]:max-w-full [&_svg]:h-auto ${supportsTouchGestures && !isTouchPanEnabled ? 'cursor-default touch-pan-y' : 'cursor-grab touch-none active:cursor-grabbing'}`}
        role="img"
        aria-label="Mermaid diagram"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          transformOrigin: 'top left',
        }}
        dangerouslySetInnerHTML={{ __html: scopedSvg }}
      />
    </div>
  )
})
