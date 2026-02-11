// ============================================
// OutlineIndex - Dynamic Aperture Index
// 动态光圈索引
//
// PC 端：右侧浮动，余弦插值光圈 + 滚轮导航
// 移动端：右边缘触摸，背景模糊 + 震动反馈
//
// 性能：rAF + 直接 DOM 操作，不用 React State 驱动动画
// ============================================

import { memo, useMemo, useRef, useEffect, useCallback, useState } from 'react'
import type { Message } from '../types/message'
import { isUserMessage } from '../types/message'

// ============================================
// Types
// ============================================

interface OutlineEntry {
  index: number
  title: string
  messageId: string
}

interface OutlineIndexProps {
  messages: Message[]
  onScrollToIndex: (index: number) => void
  visibleMessageIds?: string[]
}

// ============================================
// Constants
// ============================================

const INFLUENCE_RADIUS = 55
const LERP_FACTOR = 0.18
const EPSILON = 0.005
const LABEL_THRESHOLD = 0.65

const TICK_W_MIN = 8
const TICK_W_MAX = 22
const TICK_H = 2.5
const MARGIN_MIN = 4
const MARGIN_MAX = 14

// ============================================
// Data extraction (同 ChatArea 的过滤逻辑)
// ============================================

function messageHasContent(msg: Message): boolean {
  if (msg.parts.length === 0) return true
  return msg.parts.some(part => {
    switch (part.type) {
      case 'text':
        return part.text?.trim().length > 0
      case 'reasoning':
        return part.text?.trim().length > 0
      case 'tool':
      case 'file':
      case 'agent':
      case 'step-finish':
      case 'subtask':
        return true
      default:
        return false
    }
  })
}

function extractOutlineEntries(messages: Message[]): OutlineEntry[] {
  const entries: OutlineEntry[] = []
  const visible = messages.filter(messageHasContent)
  for (let i = 0; i < visible.length; i++) {
    const msg = visible[i]
    if (isUserMessage(msg.info) && msg.info.summary?.title) {
      entries.push({
        index: i,
        title: msg.info.summary.title,
        messageId: msg.info.id,
      })
    }
  }
  return entries
}

function truncate(s: string, max: number) {
  return s.length <= max ? s : s.slice(0, max) + '…'
}

// ============================================
// Entry Component
// ============================================

export const OutlineIndex = memo(function OutlineIndex({
  messages,
  onScrollToIndex,
  visibleMessageIds,
}: OutlineIndexProps) {
  const entries = useMemo(() => extractOutlineEntries(messages), [messages])

  if (entries.length < 2) return null

  return (
    <>
      <DesktopAperture
        entries={entries}
        onScrollToIndex={onScrollToIndex}
        visibleMessageIds={visibleMessageIds}
      />
      <MobileAperture
        entries={entries}
        onScrollToIndex={onScrollToIndex}
        visibleMessageIds={visibleMessageIds}
      />
    </>
  )
})

// ============================================
// Shared props
// ============================================

interface ApertureProps {
  entries: OutlineEntry[]
  onScrollToIndex: (index: number) => void
  visibleMessageIds?: string[]
}

// ============================================
// PC 端：右侧光圈索引
// ============================================

const DesktopAperture = memo(function DesktopAperture({
  entries,
  onScrollToIndex,
  visibleMessageIds,
}: ApertureProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const cursorYRef = useRef<number | null>(null)
  const strengthsRef = useRef<number[]>([])
  const rafIdRef = useRef(0)
  const isHoveringRef = useRef(false)

  const activeSet = useMemo(() => {
    if (!visibleMessageIds || visibleMessageIds.length === 0) return null
    return new Set(visibleMessageIds)
  }, [visibleMessageIds])

  useEffect(() => {
    strengthsRef.current = entries.map(() => 0)
  }, [entries.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Animation loop ----
  const runLoop = useCallback(() => {
    const container = containerRef.current
    if (!container) return

    const items = container.querySelectorAll<HTMLElement>('[data-oi]')
    const cursorY = cursorYRef.current
    let alive = false

    items.forEach((item, i) => {
      const tick = item.querySelector<HTMLElement>('[data-tick]')
      const label = item.querySelector<HTMLElement>('[data-label]')
      if (!tick || !label) return

      // target strength
      let target = 0
      if (cursorY !== null) {
        const rect = item.getBoundingClientRect()
        const centerY = rect.top + rect.height / 2
        const d = Math.abs(cursorY - centerY)
        if (d < INFLUENCE_RADIUS) {
          target = Math.cos((d / INFLUENCE_RADIUS) * (Math.PI / 2))
        }
      }

      // lerp
      const prev = strengthsRef.current[i] ?? 0
      let s = prev + (target - prev) * LERP_FACTOR
      if (Math.abs(s) < EPSILON && target === 0) s = 0
      strengthsRef.current[i] = s
      if (Math.abs(s - target) > EPSILON) alive = true

      // active 标记
      const isActive = item.dataset.active === '1'
      const baseW = isActive ? 13 : TICK_W_MIN

      // apply styles
      tick.style.width = `${baseW + s * (TICK_W_MAX - TICK_W_MIN)}px`
      item.style.marginTop = `${MARGIN_MIN + s * (MARGIN_MAX - MARGIN_MIN)}px`
      item.style.marginBottom = `${MARGIN_MIN + s * (MARGIN_MAX - MARGIN_MIN)}px`

      // tick 颜色 —— 不用 opacity，直接实色
      const shouldHL = s > 0.5
      if (shouldHL) {
        tick.style.backgroundColor = 'hsl(var(--accent-main-200))'
        tick.style.boxShadow = '0 0 3px hsl(var(--accent-main-100) / 0.4)'
      } else if (isActive) {
        tick.style.backgroundColor = 'hsl(var(--accent-main-100) / 0.55)'
        tick.style.boxShadow = 'none'
      } else {
        tick.style.backgroundColor = 'hsl(var(--border-300))'
        tick.style.boxShadow = 'none'
      }

      // label
      if (s > LABEL_THRESHOLD) {
        const t = Math.min(1, (s - LABEL_THRESHOLD) / (1 - LABEL_THRESHOLD))
        label.style.opacity = `${t}`
        label.style.transform = `translateX(${(1 - t) * 10}px)`
        label.style.visibility = 'visible'
      } else {
        label.style.opacity = '0'
        label.style.transform = 'translateX(10px)'
        label.style.visibility = 'hidden'
      }
    })

    if (isHoveringRef.current || alive) {
      rafIdRef.current = requestAnimationFrame(runLoop)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const ensureLoop = useCallback(() => {
    cancelAnimationFrame(rafIdRef.current)
    rafIdRef.current = requestAnimationFrame(runLoop)
  }, [runLoop])

  // ---- Event handlers ----
  const handleMouseEnter = useCallback(() => {
    isHoveringRef.current = true
    ensureLoop()
  }, [ensureLoop])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    cursorYRef.current = e.clientY
  }, [])

  const handleMouseLeave = useCallback(() => {
    isHoveringRef.current = false
    cursorYRef.current = null
    ensureLoop()
  }, [ensureLoop])

  const handleClick = useCallback((entryIndex: number) => {
    onScrollToIndex(entryIndex)
  }, [onScrollToIndex])

  useEffect(() => {
    return () => cancelAnimationFrame(rafIdRef.current)
  }, [])

  return (
    <div
      ref={containerRef}
      className="
        hidden md:flex flex-col items-end
        absolute right-3.5 top-1/2 -translate-y-1/2 z-[5]
        py-1 pr-1 select-none
      "
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {entries.map((entry) => {
        const isActive = activeSet?.has(entry.messageId) ?? false
        return (
          <div
            key={entry.messageId}
            data-oi
            data-active={isActive ? '1' : '0'}
            className="relative flex items-center justify-end cursor-pointer"
            style={{ marginTop: `${MARGIN_MIN}px`, marginBottom: `${MARGIN_MIN}px` }}
            onClick={() => handleClick(entry.index)}
          >
            {/* Label — absolute 定位，不撑大触发区域 */}
            <div
              data-label
              className="absolute right-full mr-2.5 text-[13px] leading-none text-text-200 whitespace-nowrap pointer-events-none"
              style={{ opacity: 0, transform: 'translateX(10px)', visibility: 'hidden' }}
            >
              {entry.title}
            </div>
            {/* Tick mark */}
            <div
              data-tick
              className="rounded-full shrink-0"
              style={{
                width: `${isActive ? 13 : TICK_W_MIN}px`,
                height: `${TICK_H}px`,
                backgroundColor: isActive
                  ? 'hsl(var(--accent-main-100) / 0.55)'
                  : 'hsl(var(--border-300))',
              }}
            />
          </div>
        )
      })}
    </div>
  )
})

// ============================================
// 移动端：按住滑动索引
// 同样的 rAF + 余弦插值光圈引擎，输入源为 touch
// ============================================

const MOBILE_INFLUENCE_RADIUS = 45
const MOBILE_MARGIN_MIN = 3
const MOBILE_MARGIN_MAX = 16
const MOBILE_TICK_W_MIN = 6
const MOBILE_TICK_W_MAX = 20
const MOBILE_LABEL_THRESHOLD = 0.6

const MobileAperture = memo(function MobileAperture({
  entries,
  onScrollToIndex,
  visibleMessageIds,
}: ApertureProps) {
  const [overlayVisible, setOverlayVisible] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const overlayTitleRef = useRef<HTMLDivElement>(null)
  const touchYRef = useRef<number | null>(null)
  const strengthsRef = useRef<number[]>([])
  const rafIdRef = useRef(0)
  const isTouchingRef = useRef(false)
  const prevFocusIdxRef = useRef(-1)

  const activeSet = useMemo(() => {
    if (!visibleMessageIds || visibleMessageIds.length === 0) return null
    return new Set(visibleMessageIds)
  }, [visibleMessageIds])

  useEffect(() => {
    strengthsRef.current = entries.map(() => 0)
  }, [entries.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // 震动
  const vibrate = useCallback(() => {
    try { navigator.vibrate?.(5) } catch { /* ignore */ }
  }, [])

  // ---- 动画循环 ----
  const runLoop = useCallback(() => {
    const container = containerRef.current
    if (!container) return

    const items = container.querySelectorAll<HTMLElement>('[data-moi]')
    const touchY = touchYRef.current
    let alive = false
    let focusIdx = -1
    let maxS = 0

    items.forEach((item, i) => {
      const tick = item.querySelector<HTMLElement>('[data-mtick]')
      const label = item.querySelector<HTMLElement>('[data-mlabel]')
      if (!tick || !label) return

      // target
      let target = 0
      if (touchY !== null) {
        const rect = item.getBoundingClientRect()
        const centerY = rect.top + rect.height / 2
        const d = Math.abs(touchY - centerY)
        if (d < MOBILE_INFLUENCE_RADIUS) {
          target = Math.cos((d / MOBILE_INFLUENCE_RADIUS) * (Math.PI / 2))
        }
      }

      // lerp
      const prev = strengthsRef.current[i] ?? 0
      let s = prev + (target - prev) * LERP_FACTOR
      if (Math.abs(s) < EPSILON && target === 0) s = 0
      strengthsRef.current[i] = s
      if (Math.abs(s - target) > EPSILON) alive = true

      // 找最强项
      if (s > maxS) { maxS = s; focusIdx = i }

      const isActive = item.dataset.active === '1'
      const baseW = isActive ? 10 : MOBILE_TICK_W_MIN

      // styles
      const w = baseW + s * (MOBILE_TICK_W_MAX - MOBILE_TICK_W_MIN)
      const m = MOBILE_MARGIN_MIN + s * (MOBILE_MARGIN_MAX - MOBILE_MARGIN_MIN)
      tick.style.width = `${w}px`
      item.style.marginTop = `${m}px`
      item.style.marginBottom = `${m}px`
      tick.style.opacity = '1'

      // tick 颜色
      if (s > 0.5) {
        tick.style.backgroundColor = 'hsl(var(--accent-main-200))'
        tick.style.boxShadow = '0 0 3px hsl(var(--accent-main-100) / 0.4)'
      } else if (isActive) {
        tick.style.backgroundColor = 'hsl(var(--accent-main-100) / 0.55)'
        tick.style.boxShadow = 'none'
      } else {
        tick.style.backgroundColor = 'hsl(var(--border-300))'
        tick.style.boxShadow = 'none'
      }

      // label
      if (s > MOBILE_LABEL_THRESHOLD) {
        const t = Math.min(1, (s - MOBILE_LABEL_THRESHOLD) / (1 - MOBILE_LABEL_THRESHOLD))
        label.style.opacity = `${t}`
        label.style.transform = `translateX(${(1 - t) * 12}px)`
        label.style.visibility = 'visible'
      } else {
        label.style.opacity = '0'
        label.style.transform = 'translateX(12px)'
        label.style.visibility = 'hidden'
      }
    })

    // 焦点切换 → 震动 + 更新 overlay 标题
    if (focusIdx >= 0 && maxS > 0.5 && focusIdx !== prevFocusIdxRef.current) {
      prevFocusIdxRef.current = focusIdx
      vibrate()
      // 更新模糊层上的标题
      const titleEl = overlayTitleRef.current
      if (titleEl) {
        titleEl.textContent = entries[focusIdx].title
        titleEl.style.opacity = '1'
        titleEl.style.transform = 'translateY(0px)'
      }
    }
    // 没有焦点时淡出标题
    if ((focusIdx < 0 || maxS <= 0.5) && !isTouchingRef.current) {
      const titleEl = overlayTitleRef.current
      if (titleEl) {
        titleEl.style.opacity = '0'
        titleEl.style.transform = 'translateY(4px)'
      }
    }

    if (isTouchingRef.current || alive) {
      rafIdRef.current = requestAnimationFrame(runLoop)
    } else {
      // 所有 strength 归零后收起 overlay
      setOverlayVisible(false)
    }
  }, [entries, vibrate, onScrollToIndex]) // eslint-disable-line react-hooks/exhaustive-deps

  const ensureLoop = useCallback(() => {
    cancelAnimationFrame(rafIdRef.current)
    rafIdRef.current = requestAnimationFrame(runLoop)
  }, [runLoop])

  // ---- Touch handlers ----
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault()
    isTouchingRef.current = true
    prevFocusIdxRef.current = -1
    touchYRef.current = e.touches[0].clientY
    setOverlayVisible(true)
    ensureLoop()
  }, [ensureLoop])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault()
    touchYRef.current = e.touches[0].clientY
  }, [])

  const handleTouchEnd = useCallback(() => {
    // 松手 → 跳转到最后聚焦的条目
    const idx = prevFocusIdxRef.current
    if (idx >= 0 && idx < entries.length) {
      onScrollToIndex(entries[idx].index)
    }
    isTouchingRef.current = false
    touchYRef.current = null
    prevFocusIdxRef.current = -1
    // 淡出 overlay 标题
    const titleEl = overlayTitleRef.current
    if (titleEl) {
      titleEl.style.opacity = '0'
      titleEl.style.transform = 'translateY(4px)'
    }
    // 回弹动画继续跑，归零后 runLoop 会 setOverlayVisible(false)
    ensureLoop()
  }, [entries, onScrollToIndex, ensureLoop])

  useEffect(() => {
    return () => cancelAnimationFrame(rafIdRef.current)
  }, [])

  return (
    <div className="md:hidden">
      {/* 背景模糊 overlay + 居中标题 */}
      {overlayVisible && (
        <div className="absolute inset-0 z-[14] bg-bg-100/40 backdrop-blur-sm flex items-start justify-center pt-[30%]">
          <div
            ref={overlayTitleRef}
            className="text-lg font-semibold text-text-100 px-5 py-2 rounded-xl bg-bg-000/60 backdrop-blur-md shadow-lg max-w-[75vw] text-center pointer-events-none"
            style={{ opacity: 0, transform: 'translateY(4px)', transition: 'opacity 0.15s ease-out, transform 0.15s ease-out' }}
          />
        </div>
      )}

      {/* 索引条 */}
      <div
        ref={containerRef}
        className="
          absolute right-0 top-1/2 -translate-y-1/2 z-[15]
          flex flex-col items-end
          pr-1.5 py-4
          select-none
        "
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        {entries.map((entry) => {
          const isVisibleEntry = activeSet?.has(entry.messageId) ?? false
          return (
            <div
              key={entry.messageId}
              data-moi
              data-active={isVisibleEntry ? '1' : '0'}
              className="relative flex items-center justify-end"
              style={{
                marginTop: `${MOBILE_MARGIN_MIN}px`,
                marginBottom: `${MOBILE_MARGIN_MIN}px`,
              }}
            >
              {/* Label — absolute 定位，不撑大触发区域 */}
              <div
                data-mlabel
                className="absolute right-full mr-2.5 text-sm leading-none text-text-200 whitespace-nowrap pointer-events-none"
                style={{ opacity: 0, transform: 'translateX(12px)', visibility: 'hidden' }}
              >
                {truncate(entry.title, 14)}
              </div>
              {/* Tick */}
              <div
                data-mtick
                className="rounded-full shrink-0"
                style={{
                  width: `${isVisibleEntry ? 10 : MOBILE_TICK_W_MIN}px`,
                  height: `${TICK_H}px`,
                  backgroundColor: isVisibleEntry
                    ? 'hsl(var(--accent-main-100) / 0.55)'
                    : 'hsl(var(--border-300))',
                }}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
})
