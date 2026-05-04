/**
 * useDynamicVirtualScroll — 动态行高虚拟滚动
 *
 * 和固定行高虚拟滚动的区别：
 * - 初始用预估行高（LINE_HEIGHT=20px）计算位置
 * - 渲染后用 ref callback 测量实际行高
 * - 容器宽度变化时清空测量值，触发重新测量
 * - 只有视口内的行参与 DOM 渲染和 reflow
 *
 * 这样开了 whitespace-pre-wrap 换行后，resize 只影响可见行，不会 reflow 风暴。
 */

import { useState, useRef, useCallback, useMemo, useEffect } from 'react'

const DEFAULT_LINE_HEIGHT = 20
const OVERSCAN = 5

interface UseDynamicVirtualScrollOptions {
  /** 总行数 */
  lineCount: number
  /** 容器是否正在拖拽 resize（拖拽期间跳过测量） */
  isResizing?: boolean
  /** 预估行高（用于未测量行），默认 20px */
  estimateLineHeight?: number
  /** 按当前容器宽度估算指定行高度 */
  estimateHeight?: (index: number, containerWidth: number) => number
}

interface UseDynamicVirtualScrollResult {
  /** 绑定到滚动容器 */
  containerRef: React.RefObject<HTMLDivElement | null>
  /** 虚拟列表总高度 */
  totalHeight: number
  /** 可见区域起始行索引 */
  startIndex: number
  /** 可见区域结束行索引（exclusive） */
  endIndex: number
  /** 可见行的 Y 偏移（用于 translateY） */
  offsetY: number
  /** 滚动事件处理 */
  handleScroll: (e: React.UIEvent<HTMLDivElement>) => void
  /** 行高测量回调，用于每行的 ref */
  measureRef: (index: number, el: HTMLDivElement | null) => void
}

export function useDynamicVirtualScroll({
  lineCount,
  isResizing = false,
  estimateLineHeight = DEFAULT_LINE_HEIGHT,
  estimateHeight,
}: UseDynamicVirtualScrollOptions): UseDynamicVirtualScrollResult {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [containerHeight, setContainerHeight] = useState(0)
  const [containerWidth, setContainerWidth] = useState(0)
  const [measuredHeights, setMeasuredHeights] = useState<Float32Array<ArrayBufferLike>>(
    () => new Float32Array(lineCount),
  )
  const pendingMeasureRef = useRef(false)
  const pendingHeightsRef = useRef<Float32Array<ArrayBufferLike> | null>(null)
  const measureFrameRef = useRef<number | null>(null)

  const getEstimatedHeight = useCallback(
    (index: number) => Math.max(estimateLineHeight, estimateHeight?.(index, containerWidth) ?? estimateLineHeight),
    [containerWidth, estimateHeight, estimateLineHeight],
  )

  const resolvedHeights = useMemo(() => {
    const next = new Float32Array(lineCount)
    const copyLen = Math.min(measuredHeights.length, lineCount)

    for (let i = 0; i < copyLen; i++) {
      next[i] = measuredHeights[i] || getEstimatedHeight(i)
    }

    for (let i = copyLen; i < lineCount; i++) {
      next[i] = getEstimatedHeight(i)
    }

    return next
  }, [getEstimatedHeight, lineCount, measuredHeights])

  // 前缀和数组
  const offsets = useMemo(() => {
    const arr = new Float64Array(lineCount + 1)
    for (let i = 0; i < lineCount; i++) {
      arr[i + 1] = arr[i] + (resolvedHeights[i] || estimateLineHeight)
    }
    return arr
  }, [estimateLineHeight, lineCount, resolvedHeights])

  const totalHeight = offsets[lineCount] || 0

  // 二分查找
  const findIndex = useCallback(
    (top: number) => {
      let lo = 0
      let hi = lineCount - 1
      while (lo <= hi) {
        const mid = (lo + hi) >>> 1
        if (offsets[mid] <= top) lo = mid + 1
        else hi = mid - 1
      }
      return Math.max(0, lo - 1)
    },
    [offsets, lineCount],
  )

  const { startIndex, endIndex, offsetY } = useMemo(() => {
    const start = Math.max(0, findIndex(scrollTop) - OVERSCAN)
    const end = Math.min(lineCount, findIndex(scrollTop + containerHeight) + 1 + OVERSCAN)
    return { startIndex: start, endIndex: end, offsetY: offsets[start] || 0 }
  }, [scrollTop, containerHeight, findIndex, offsets, lineCount])

  // 监听容器高度
  useEffect(() => {
    const container = containerRef.current
    if (!container || isResizing) return
    setContainerHeight(container.clientHeight)
    setContainerWidth(container.clientWidth)
    const ro = new ResizeObserver(() => {
      setContainerHeight(container.clientHeight)
      setContainerWidth(container.clientWidth)
    })
    ro.observe(container)
    return () => ro.disconnect()
  }, [isResizing])

  // 监听容器宽度变化 → 清空测量值
  // 阈值 20px：滚动条出现/消失约 15-17px，不应触发全部重测
  const lastWidthRef = useRef(0)
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    lastWidthRef.current = container.clientWidth
    const ro = new ResizeObserver(() => {
      const w = container.clientWidth
      if (Math.abs(w - lastWidthRef.current) > 20) {
        lastWidthRef.current = w
        pendingHeightsRef.current = null
        setMeasuredHeights(new Float32Array(lineCount))
      }
    })
    ro.observe(container)
    return () => ro.disconnect()
  }, [lineCount])

  useEffect(() => {
    return () => {
      if (measureFrameRef.current !== null) {
        cancelAnimationFrame(measureFrameRef.current)
      }
    }
  }, [])

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop)
  }, [])

  const measureRef = useCallback((index: number, el: HTMLDivElement | null) => {
    if (!el) return
    const h = el.offsetHeight
    if (h <= 0) return
    const sourceHeights = pendingHeightsRef.current ?? measuredHeights
    const current = sourceHeights[index] || getEstimatedHeight(index)
    const next = h
    if (Math.abs(current - next) > 0.5) {
      const nextHeights = new Float32Array(sourceHeights)
      nextHeights[index] = next
      pendingHeightsRef.current = nextHeights
      if (!pendingMeasureRef.current) {
        pendingMeasureRef.current = true
        measureFrameRef.current = requestAnimationFrame(() => {
          measureFrameRef.current = null
          pendingMeasureRef.current = false
          const bufferedHeights = pendingHeightsRef.current
          pendingHeightsRef.current = null
          if (bufferedHeights) {
            setMeasuredHeights(bufferedHeights)
          }
        })
      }
    }
  }, [getEstimatedHeight, measuredHeights])

  return {
    containerRef,
    totalHeight,
    startIndex,
    endIndex,
    offsetY,
    handleScroll,
    measureRef,
  }
}
