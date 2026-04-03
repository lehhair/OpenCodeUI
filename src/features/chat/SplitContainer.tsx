/**
 * SplitContainer — Recursive split tree renderer with draggable dividers.
 *
 * Renders a PaneNode tree: leaves are rendered via `renderLeaf`, splits are
 * rendered as CSS grid containers with a thin draggable divider between them.
 *
 * Performance strategy for drag resize:
 * - Layout uses CSS grid (grid-template-columns / grid-template-rows).
 * - During drag: modify grid-template directly on the DOM element, bypassing
 *   React and the store entirely. rAF throttles writes to one per frame.
 * - On pointerup: clear inline styles and commit the final ratio to the store.
 * - Pane wrappers use `contain: layout style` to isolate internal reflow,
 *   but do NOT use `overflow: hidden` so that ring / box-shadow borders
 *   on child ChatPane components remain visible.
 *
 * Fullscreen mode:
 * - When `fullscreenPaneId` is set, the tree is still rendered to preserve
 *   React state and DOM, but non-fullscreen leaves get `content-visibility: hidden`
 *   and the fullscreen leaf is pulled out of flow via absolute positioning to
 *   cover the entire container. This avoids costly unmount/remount cycles.
 */

import { useCallback, useRef } from 'react'
import type { PaneNode, PaneSplit } from '../../store/paneLayoutStore'
import { paneLayoutStore } from '../../store/paneLayoutStore'

/** Check whether a subtree contains a given leaf id */
function containsLeaf(node: PaneNode, leafId: string): boolean {
  if (node.type === 'leaf') return node.id === leafId
  return containsLeaf(node.first, leafId) || containsLeaf(node.second, leafId)
}

/** Visual gap between panes in px */
const SPLIT_GAP = 6
/** Extra invisible hit area on each side of the divider for easier grabbing */
const HIT_EXTEND = 4
/** Minimum ratio to prevent a pane from collapsing to zero */
const MIN_RATIO = 0.1
const MAX_RATIO = 0.9

interface SplitContainerProps {
  node: PaneNode
  renderLeaf: (paneId: string, sessionId: string | null) => React.ReactNode
  /** When set, the matching leaf is shown fullscreen and siblings are hidden. */
  fullscreenPaneId?: string | null
}

export function SplitContainer({ node, renderLeaf, fullscreenPaneId }: SplitContainerProps) {
  if (node.type === 'leaf') {
    return <>{renderLeaf(node.id, node.sessionId)}</>
  }

  return <SplitNode split={node} renderLeaf={renderLeaf} fullscreenPaneId={fullscreenPaneId} />
}

// ============================================
// SplitNode — renders a single split with divider
// ============================================

interface SplitNodeProps {
  split: PaneSplit
  renderLeaf: (paneId: string, sessionId: string | null) => React.ReactNode
  fullscreenPaneId?: string | null
}

/** Build a CSS grid-template value like "49.5fr 6px 50.5fr" */
function buildGridTemplate(ratio: number): string {
  const r = Math.max(MIN_RATIO, Math.min(MAX_RATIO, ratio))
  return `${(r * 100).toFixed(4)}fr ${SPLIT_GAP}px ${((1 - r) * 100).toFixed(4)}fr`
}

function SplitNode({ split, renderLeaf, fullscreenPaneId }: SplitNodeProps) {
  const isHorizontal = split.direction === 'horizontal'
  const containerRef = useRef<HTMLDivElement>(null)
  const isFullscreen = !!fullscreenPaneId

  const handleDrag = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      const container = containerRef.current
      if (!container) return

      const rect = container.getBoundingClientRect()
      let pendingRatio: number | null = null
      let rafId: number | null = null

      // Notify listeners (e.g. CodePreview) that a resize is in progress
      window.dispatchEvent(new CustomEvent('panel-resize-start'))

      const applyRatio = (ratio: number) => {
        const tpl = buildGridTemplate(ratio)
        if (isHorizontal) {
          container.style.gridTemplateColumns = tpl
        } else {
          container.style.gridTemplateRows = tpl
        }
      }

      const onMove = (ev: PointerEvent) => {
        const raw = isHorizontal ? (ev.clientX - rect.left) / rect.width : (ev.clientY - rect.top) / rect.height
        pendingRatio = Math.max(MIN_RATIO, Math.min(MAX_RATIO, raw))

        // Throttle DOM writes to one per animation frame
        if (rafId === null) {
          rafId = requestAnimationFrame(() => {
            rafId = null
            if (pendingRatio !== null) {
              applyRatio(pendingRatio)
            }
          })
        }
      }

      const onUp = (ev: PointerEvent) => {
        document.removeEventListener('pointermove', onMove)
        document.removeEventListener('pointerup', onUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        if (rafId !== null) cancelAnimationFrame(rafId)

        // Clear inline overrides — hand control back to React
        container.style.gridTemplateColumns = ''
        container.style.gridTemplateRows = ''

        // Compute and commit the final ratio
        const raw = isHorizontal ? (ev.clientX - rect.left) / rect.width : (ev.clientY - rect.top) / rect.height
        paneLayoutStore.setRatio(split.id, Math.max(MIN_RATIO, Math.min(MAX_RATIO, raw)))

        window.dispatchEvent(new CustomEvent('panel-resize-end'))
      }

      document.body.style.cursor = isHorizontal ? 'col-resize' : 'row-resize'
      document.body.style.userSelect = 'none'
      document.addEventListener('pointermove', onMove)
      document.addEventListener('pointerup', onUp)
    },
    [split.id, isHorizontal],
  )

  // ---- Static layout (React-controlled, used when not dragging) ----
  const gridTemplate = buildGridTemplate(split.ratio)

  const hitSize = SPLIT_GAP + HIT_EXTEND * 2
  const negMargin = -(hitSize + SPLIT_GAP) / 2

  // ---- Fullscreen: bypass grid, use absolute overlay ----
  if (isFullscreen) {
    const firstHasFs = containsLeaf(split.first, fullscreenPaneId!)
    const secondHasFs = containsLeaf(split.second, fullscreenPaneId!)

    const fsStyle: React.CSSProperties = { position: 'absolute', inset: 0, zIndex: 1 }
    const hiddenStyle: React.CSSProperties = {
      position: 'absolute',
      width: 0,
      height: 0,
      overflow: 'hidden',
      contentVisibility: 'hidden',
    }

    return (
      <div ref={containerRef} className="relative w-full h-full">
        {/* The branch containing the fullscreen pane gets absolute positioning to fill the container */}
        <div className="min-w-0 min-h-0" style={firstHasFs ? fsStyle : hiddenStyle}>
          <SplitContainer node={split.first} renderLeaf={renderLeaf} fullscreenPaneId={fullscreenPaneId} />
        </div>
        <div className="min-w-0 min-h-0" style={secondHasFs ? fsStyle : hiddenStyle}>
          <SplitContainer node={split.second} renderLeaf={renderLeaf} fullscreenPaneId={fullscreenPaneId} />
        </div>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="grid w-full h-full"
      style={
        isHorizontal
          ? { gridTemplateColumns: gridTemplate, gridTemplateRows: '1fr' }
          : { gridTemplateRows: gridTemplate, gridTemplateColumns: '1fr' }
      }
    >
      {/* First child — contain: layout style isolates reflow without clipping ring borders */}
      <div className="min-w-0 min-h-0 relative" style={{ contain: 'layout style' }}>
        <SplitContainer node={split.first} renderLeaf={renderLeaf} />
      </div>

      {/* Divider — invisible hit area overlapping the grid gap */}
      <div
        className={`relative z-10 ${isHorizontal ? 'cursor-col-resize' : 'cursor-row-resize'}`}
        style={{
          [isHorizontal ? 'width' : 'height']: hitSize,
          [isHorizontal ? 'marginLeft' : 'marginTop']: negMargin,
          [isHorizontal ? 'marginRight' : 'marginBottom']: negMargin,
        }}
        onPointerDown={handleDrag}
      />

      {/* Second child */}
      <div className="min-w-0 min-h-0 relative" style={{ contain: 'layout style' }}>
        <SplitContainer node={split.second} renderLeaf={renderLeaf} />
      </div>
    </div>
  )
}
