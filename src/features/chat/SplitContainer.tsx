/**
 * SplitContainer — Recursive split tree renderer with draggable dividers.
 *
 * Renders a PaneNode tree: leaves are rendered via `renderLeaf`, splits are
 * rendered as flex containers with a thin draggable divider between them.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PaneNode, PaneSplit } from '../../store/paneLayoutStore'
import { paneLayoutStore } from '../../store/paneLayoutStore'

/** Gap between panes in px */
const SPLIT_GAP = 6
/** Extra hit area on each side of the divider */
const HIT_EXTEND = 4

interface SplitContainerProps {
  node: PaneNode
  renderLeaf: (paneId: string, sessionId: string | null) => React.ReactNode
}

export function SplitContainer({ node, renderLeaf }: SplitContainerProps) {
  if (node.type === 'leaf') {
    return <>{renderLeaf(node.id, node.sessionId)}</>
  }

  return <SplitNode split={node} renderLeaf={renderLeaf} />
}

// ============================================
// SplitNode — renders a single split with divider
// ============================================

interface SplitNodeProps {
  split: PaneSplit
  renderLeaf: (paneId: string, sessionId: string | null) => React.ReactNode
}

function SplitNode({ split, renderLeaf }: SplitNodeProps) {
  const isHorizontal = split.direction === 'horizontal'
  const containerRef = useRef<HTMLDivElement>(null)
  const [displayRatio, setDisplayRatio] = useState(split.ratio)
  const [isEntering, setIsEntering] = useState(true)
  const isBootstrappingRef = useRef(true)

  useLayoutEffect(() => {
    let raf1 = 0
    let raf2 = 0

    // 首次挂载时从“单个 pane”平滑分裂成两个 pane。
    setDisplayRatio(1)
    setIsEntering(true)

    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        isBootstrappingRef.current = false
        setIsEntering(false)
        setDisplayRatio(split.ratio)
      })
    })

    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
    }
  }, [split.id])

  useEffect(() => {
    if (isBootstrappingRef.current) return
    setDisplayRatio(split.ratio)
  }, [split.ratio])

  const handleDrag = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      const container = containerRef.current
      if (!container) return

      const rect = container.getBoundingClientRect()

      const onMove = (ev: PointerEvent) => {
        let ratio: number
        if (isHorizontal) {
          ratio = (ev.clientX - rect.left) / rect.width
        } else {
          ratio = (ev.clientY - rect.top) / rect.height
        }
        paneLayoutStore.setRatio(split.id, ratio)
      }

      const onUp = () => {
        document.removeEventListener('pointermove', onMove)
        document.removeEventListener('pointerup', onUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }

      document.body.style.cursor = isHorizontal ? 'col-resize' : 'row-resize'
      document.body.style.userSelect = 'none'
      document.addEventListener('pointermove', onMove)
      document.addEventListener('pointerup', onUp)
    },
    [split.id, isHorizontal],
  )

  const firstGrow = Math.max(displayRatio, 0.0001)
  const secondGrow = Math.max(1 - displayRatio, 0.0001)

  const hitSize = SPLIT_GAP + HIT_EXTEND * 2
  const negMargin = -(hitSize + SPLIT_GAP) / 2

  return (
    <div
      ref={containerRef}
      className={`flex ${isHorizontal ? 'flex-row' : 'flex-col'} w-full h-full`}
      style={{ gap: SPLIT_GAP }}
    >
      {/* First child */}
      <div
        className="min-w-0 min-h-0 relative transition-[flex-grow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
        style={{ flexBasis: 0, flexGrow: firstGrow, flexShrink: 1 }}
      >
        <SplitContainer node={split.first} renderLeaf={renderLeaf} />
      </div>

      {/* Divider — invisible hit area overlapping the gap */}
      <div
        className={`relative z-10 shrink-0 transition-opacity duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
          isHorizontal ? 'cursor-col-resize' : 'cursor-row-resize'
        } ${isEntering ? 'opacity-0' : 'opacity-100'}`}
        style={{
          [isHorizontal ? 'width' : 'height']: hitSize,
          [isHorizontal ? 'marginLeft' : 'marginTop']: negMargin,
          [isHorizontal ? 'marginRight' : 'marginBottom']: negMargin,
        }}
        onPointerDown={handleDrag}
      />

      {/* Second child */}
      <div
        className={`min-w-0 min-h-0 relative transition-[flex-grow,opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
          isEntering ? 'opacity-0 scale-[0.985]' : 'opacity-100 scale-100'
        }`}
        style={{ flexBasis: 0, flexGrow: secondGrow, flexShrink: 1 }}
      >
        <SplitContainer node={split.second} renderLeaf={renderLeaf} />
      </div>
    </div>
  )
}
