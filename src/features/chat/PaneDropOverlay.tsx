/**
 * PaneDropOverlay — Visual hint for drag-to-split.
 *
 * Design:
 * - Pure hit-test (`resolveDropZone`) is exported for the pane to call.
 * - `PaneDropOverlay` is a ref-driven leaf component that owns the
 *   `activeZone` state. The parent updates the zone via an imperative handle
 *   (`setZone`), so high-frequency dragover events do NOT re-render the
 *   expensive ChatPane subtree — only this tiny overlay re-renders.
 *
 * Visual:
 * - Pure visual highlight (no text labels). Follows VS Code / JetBrains
 *   conventions where the mouse is the user's focal point during a drag.
 *
 * Hit testing:
 * - Center rectangle: inner 40% x 40% of the pane → replace session
 * - Outside: closest edge by normalized distance → split to that side
 */

import { forwardRef, memo, useImperativeHandle, useState } from 'react'

export type DropZone = 'top' | 'bottom' | 'left' | 'right' | 'center'

export interface DropPoint {
  /** Normalized mouse X position relative to the pane, 0-1 */
  xRel: number
  /** Normalized mouse Y position relative to the pane, 0-1 */
  yRel: number
}

export interface PaneDropOverlayHandle {
  /** Update the active zone without re-rendering the parent. */
  setZone(zone: DropZone | null): void
}

/** Inner half-size of the central replace zone, normalized */
const CENTER_HALF = 0.2

/**
 * Resolve which drop zone a normalized point falls into.
 */
export function resolveDropZone(point: DropPoint | null): DropZone | null {
  if (!point) return null
  const { xRel, yRel } = point

  if (xRel < 0 || xRel > 1 || yRel < 0 || yRel > 1) return null

  // Center rectangle wins first
  if (Math.abs(xRel - 0.5) < CENTER_HALF && Math.abs(yRel - 0.5) < CENTER_HALF) {
    return 'center'
  }

  // Pick the closest edge by normalized distance
  const dLeft = xRel
  const dRight = 1 - xRel
  const dTop = yRel
  const dBottom = 1 - yRel

  const min = Math.min(dLeft, dRight, dTop, dBottom)
  if (min === dLeft) return 'left'
  if (min === dRight) return 'right'
  if (min === dTop) return 'top'
  return 'bottom'
}

/**
 * Visual overlay. Listens to its own local state via imperative handle;
 * parent never re-renders for zone updates.
 *
 * Must be placed inside a `position: relative` parent. The overlay itself
 * is `pointer-events: none` so it does NOT interfere with normal UI clicks.
 */
export const PaneDropOverlay = forwardRef<PaneDropOverlayHandle>(function PaneDropOverlay(_props, ref) {
  const [activeZone, setActiveZone] = useState<DropZone | null>(null)

  useImperativeHandle(
    ref,
    () => ({
      setZone(zone: DropZone | null) {
        setActiveZone(prev => (prev === zone ? prev : zone))
      },
    }),
    [],
  )

  if (!activeZone) return null

  return <DropZoneVisual zone={activeZone} />
})

const DropZoneVisual = memo(function DropZoneVisual({ zone }: { zone: DropZone }) {
  const highlightStyle: React.CSSProperties = (() => {
    switch (zone) {
      case 'center':
        return { left: '20%', top: '20%', width: '60%', height: '60%' }
      case 'left':
        return { left: 0, top: 0, width: '50%', height: '100%' }
      case 'right':
        return { left: '50%', top: 0, width: '50%', height: '100%' }
      case 'top':
        return { left: 0, top: 0, width: '100%', height: '50%' }
      case 'bottom':
        return { left: 0, top: '50%', width: '100%', height: '50%' }
    }
  })()

  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      <div
        className="absolute rounded-md border-2 border-accent-main-100 bg-accent-main-100/15 transition-[left,top,width,height] duration-150 ease-out"
        style={highlightStyle}
      />
    </div>
  )
})
