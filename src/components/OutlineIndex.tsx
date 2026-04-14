// ============================================
// OutlineIndex — 鱼眼索引条
// ============================================
//
// 信息流右侧 absolute 浮动索引条。
//
// 视觉样式与交互模式独立：
//   presentation.isCompact → DESKTOP_VISUAL / COMPACT_VISUAL
//   interaction.outlineInteraction → PointerFisheye / TouchFisheye
//
// Pointer 版本两层 DOM：
//   外层 zone — 覆盖 label 弹出范围，初始 pointer-events:none
//   内层 tick 列 — 始终可交互，mouseEnter 时激活外层
//   效果：必须从 tick 触发，激活后 zone 内自由滑动不中断
//
// Touch 版本：触摸 tick 列激活鱼眼 + 震动 + overlay 居中标题
// ============================================

import { memo, useMemo, useRef, useEffect, useCallback, useState } from 'react'
import type { Message } from '../types/message'
import { getMessageText, isUserMessage } from '../types/message'
import { useChatViewport } from '../features/chat/chatViewport'

// ─── Types ──────────────────────────────────

interface OutlineEntry {
  messageId: string
  fullTitle: string
  railLabel: string
  overlayLabel: string
}

interface OutlineIndexProps {
  messages: Message[]
  visibleMessageIds?: string[]
  onScrollToMessageId: (messageId: string) => void
}

interface FisheyeConfig {
  influenceRadius: number
  tickWidth: { min: number; max: number }
  tickHeight: number
  margin: { min: number; max: number }
  labelThreshold: number
}

interface VisualConfig {
  rightOffset: number
  hitPadLeft: number
  zonePadLeft: number
  labelClassName: string
  overlayClassName: string
  fisheye: FisheyeConfig
  railLabelMax: number
  overlayLabelMax: number
  maxEntries: number
}

interface FisheyeProps {
  entries: OutlineEntry[]
  onSelect: (messageId: string) => void
  visual: VisualConfig
}

// ─── Fisheye Math ───────────────────────────

const LERP_SPEED = 0.18
const EPSILON = 0.005
const HALF_PI = Math.PI / 2

function cosineStrength(dist: number, radius: number): number {
  return dist >= radius ? 0 : Math.cos((dist / radius) * HALF_PI)
}

function smoothStep(current: number, target: number): number {
  const next = current + (target - current) * LERP_SPEED
  return Math.abs(next) < EPSILON && target === 0 ? 0 : next
}

// ─── Fisheye Presets ────────────────────────

const DESKTOP_FISHEYE: FisheyeConfig = {
  influenceRadius: 55,
  tickWidth: { min: 8, max: 22 },
  tickHeight: 2.5,
  margin: { min: 4, max: 14 },
  labelThreshold: 0.65,
}

const COMPACT_FISHEYE: FisheyeConfig = {
  influenceRadius: 45,
  tickWidth: { min: 6, max: 20 },
  tickHeight: 2.5,
  margin: { min: 3, max: 16 },
  labelThreshold: 0.6,
}

// ─── Visual Presets ─────────────────────────

const DESKTOP_VISUAL: VisualConfig = {
  rightOffset: 5,
  hitPadLeft: 16,
  zonePadLeft: 200,
  labelClassName: 'text-[length:var(--fs-md)] leading-none text-text-200',
  overlayClassName: 'text-[length:var(--fs-heading-2)] font-semibold text-text-100',
  fisheye: DESKTOP_FISHEYE,
  railLabelMax: 24,
  overlayLabelMax: 40,
  maxEntries: 40,
}

const COMPACT_VISUAL: VisualConfig = {
  rightOffset: 4,
  hitPadLeft: 12,
  zonePadLeft: 140,
  labelClassName: 'text-[length:var(--fs-xs)] leading-none text-text-300',
  overlayClassName: 'text-[length:var(--fs-base)] font-semibold text-text-100',
  fisheye: COMPACT_FISHEYE,
  railLabelMax: 14,
  overlayLabelMax: 32,
  maxEntries: 30,
}

// ─── Fisheye Engine ─────────────────────────

interface CachedItem {
  el: HTMLElement
  tick: HTMLElement
  label: HTMLElement
}

const ITEM_SEL = '[data-oi-item]'
const TICK_ATTR = 'data-oi-tick'
const LABEL_ATTR = 'data-oi-label'

function queryCachedItems(container: HTMLElement | null): CachedItem[] {
  if (!container) return []
  return Array.from(container.querySelectorAll<HTMLElement>(ITEM_SEL))
    .map(el => ({
      el,
      tick: el.querySelector<HTMLElement>(`[${TICK_ATTR}]`)!,
      label: el.querySelector<HTMLElement>(`[${LABEL_ATTR}]`)!,
    }))
    .filter(item => item.tick && item.label)
}

function applyFisheye(
  items: CachedItem[],
  cursorY: number | null,
  strengths: number[],
  config: FisheyeConfig,
): { alive: boolean; focusIndex: number; maxStrength: number } {
  let alive = false
  let focusIndex = -1
  let maxStrength = 0

  // Pass 1: 计算 strength，找 focusIndex
  for (let i = 0; i < items.length; i++) {
    let target = 0
    if (cursorY !== null) {
      const rect = items[i].el.getBoundingClientRect()
      target = cosineStrength(Math.abs(cursorY - (rect.top + rect.height / 2)), config.influenceRadius)
    }
    const s = smoothStep(strengths[i] ?? 0, target)
    strengths[i] = s
    if (Math.abs(s - target) > EPSILON) alive = true
    if (s > maxStrength) {
      maxStrength = s
      focusIndex = i
    }
  }

  // Pass 2: 应用视觉。颜色高亮只给 focusIndex，label 鱼眼渐显
  for (let i = 0; i < items.length; i++) {
    const { el, tick, label } = items[i]
    const s = strengths[i]
    const focused = i === focusIndex && maxStrength > 0.3

    tick.style.width = `${config.tickWidth.min + s * (config.tickWidth.max - config.tickWidth.min)}px`
    if (focused) {
      tick.style.backgroundColor = 'hsl(var(--accent-main-200))'
      tick.style.boxShadow = '0 0 3px hsl(var(--accent-main-100) / 0.4)'
    } else {
      tick.style.backgroundColor = 'hsl(var(--border-300))'
      tick.style.boxShadow = 'none'
    }

    const m = config.margin.min + s * (config.margin.max - config.margin.min)
    el.style.marginTop = `${m}px`
    el.style.marginBottom = `${m}px`

    if (s > config.labelThreshold) {
      const t = Math.min(1, (s - config.labelThreshold) / (1 - config.labelThreshold))
      label.style.opacity = `${t}`
      label.style.transform = `translateX(${(1 - t) * 10}px)`
      label.style.visibility = 'visible'
    } else {
      label.style.opacity = '0'
      label.style.transform = 'translateX(10px)'
      label.style.visibility = 'hidden'
    }
  }

  return { alive, focusIndex, maxStrength }
}

// ─── Data Extraction ────────────────────────

const FULL_TITLE_MAX = 80

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + '\u2026'
}

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

function messageHasContent(msg: Message): boolean {
  if (msg.parts.length === 0) {
    if (msg.info.role === 'assistant' && 'error' in msg.info && msg.info.error) {
      return msg.info.error.name !== 'MessageAbortedError'
    }
    return true
  }
  return msg.parts.some(part => {
    switch (part.type) {
      case 'text':
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

function extractEntries(messages: Message[], visual: VisualConfig): OutlineEntry[] {
  const entries: OutlineEntry[] = []
  for (const msg of messages.filter(messageHasContent)) {
    if (!isUserMessage(msg.info)) continue
    const raw =
      msg.info.summary?.title?.trim() ||
      getMessageText(msg)
        .trim()
        .split(/\r?\n/)
        .map(l => l.trim())
        .find(Boolean)
    if (!raw) continue
    const n = normalizeWhitespace(raw)
    entries.push({
      messageId: msg.info.id,
      fullTitle: truncate(n, FULL_TITLE_MAX),
      railLabel: truncate(n, visual.railLabelMax),
      overlayLabel: truncate(n, visual.overlayLabelMax),
    })
  }
  return entries
}

/** 条目超过上限时，取可见区域附近的 N 条 */
function sliceAroundVisible(entries: OutlineEntry[], visibleIds: string[], max: number): OutlineEntry[] {
  if (entries.length <= max) return entries

  const visibleSet = new Set(visibleIds)
  let first = -1
  let last = -1
  for (let i = 0; i < entries.length; i++) {
    if (visibleSet.has(entries[i].messageId)) {
      if (first === -1) first = i
      last = i
    }
  }
  if (first === -1) return entries.slice(-max)

  const center = Math.floor((first + last) / 2)
  let start = center - Math.floor(max / 2)
  let end = start + max
  if (start < 0) {
    start = 0
    end = max
  }
  if (end > entries.length) {
    end = entries.length
    start = Math.max(0, end - max)
  }
  return entries.slice(start, end)
}

// ─── Shared: TickRail ───────────────────────

interface TickRailProps {
  entries: OutlineEntry[]
  visual: VisualConfig
}

function TickRail({ entries, visual }: TickRailProps) {
  return (
    <>
      {entries.map(entry => (
        <div
          key={entry.messageId}
          data-oi-item
          className="relative flex items-center justify-end cursor-pointer"
          style={{ marginTop: `${visual.fisheye.margin.min}px`, marginBottom: `${visual.fisheye.margin.min}px` }}
          title={entry.fullTitle}
        >
          <div
            data-oi-label
            className={`absolute right-full mr-2.5 whitespace-nowrap pointer-events-none ${visual.labelClassName}`}
            style={{ opacity: 0, transform: 'translateX(10px)', visibility: 'hidden' }}
          >
            {entry.railLabel}
          </div>
          <div
            data-oi-tick
            className="rounded-full shrink-0"
            style={{
              width: `${visual.fisheye.tickWidth.min}px`,
              height: `${visual.fisheye.tickHeight}px`,
              backgroundColor: 'hsl(var(--border-300))',
            }}
          />
        </div>
      ))}
    </>
  )
}

// ─── Entry Point ────────────────────────────

export const OutlineIndex = memo(function OutlineIndex({
  messages,
  visibleMessageIds,
  onScrollToMessageId,
}: OutlineIndexProps) {
  const { interaction, presentation } = useChatViewport()
  const visual = presentation.isCompact ? COMPACT_VISUAL : DESKTOP_VISUAL
  const allEntries = useMemo(() => extractEntries(messages, visual), [messages, visual])
  const entries = useMemo(
    () => sliceAroundVisible(allEntries, visibleMessageIds ?? [], visual.maxEntries),
    [allEntries, visibleMessageIds, visual.maxEntries],
  )

  if (entries.length < 2) return null

  return interaction.outlineInteraction === 'touch' ? (
    <TouchFisheye entries={entries} onSelect={onScrollToMessageId} visual={visual} />
  ) : (
    <PointerFisheye entries={entries} onSelect={onScrollToMessageId} visual={visual} />
  )
})

// ─── PointerFisheye ─────────────────────────

const PointerFisheye = memo(function PointerFisheye({ entries, onSelect, visual }: FisheyeProps) {
  const zoneRef = useRef<HTMLDivElement>(null)
  const railRef = useRef<HTMLDivElement>(null)
  const cursorYRef = useRef<number | null>(null)
  const strengthsRef = useRef<number[]>([])
  const rafIdRef = useRef(0)
  const hoveringRef = useRef(false)
  const cachedRef = useRef<CachedItem[] | null>(null)
  const focusIdxRef = useRef(-1)
  const entriesRef = useRef(entries)
  entriesRef.current = entries

  useEffect(() => {
    strengthsRef.current = entries.map(() => 0)
    cachedRef.current = null
    focusIdxRef.current = -1
  }, [entries])

  const getItems = useCallback(() => {
    cachedRef.current ??= queryCachedItems(railRef.current)
    return cachedRef.current
  }, [])

  const loop = useCallback(
    function tick() {
      const { alive, focusIndex } = applyFisheye(getItems(), cursorYRef.current, strengthsRef.current, visual.fisheye)
      focusIdxRef.current = focusIndex
      if (hoveringRef.current || alive) rafIdRef.current = requestAnimationFrame(tick)
    },
    [getItems, visual.fisheye],
  )

  const kick = useCallback(() => {
    cancelAnimationFrame(rafIdRef.current)
    rafIdRef.current = requestAnimationFrame(loop)
  }, [loop])

  const setZoneActive = useCallback((active: boolean) => {
    const z = zoneRef.current
    if (z) z.style.pointerEvents = active ? 'auto' : 'none'
  }, [])

  const deactivate = useCallback(() => {
    hoveringRef.current = false
    cursorYRef.current = null
    focusIdxRef.current = -1
    setZoneActive(false)
    kick()
  }, [kick, setZoneActive])

  const onTickEnter = useCallback(() => {
    hoveringRef.current = true
    setZoneActive(true)
    kick()
  }, [kick, setZoneActive])

  const onZoneMove = useCallback((e: React.MouseEvent) => {
    cursorYRef.current = e.clientY
  }, [])
  const onZoneLeave = useCallback(() => deactivate(), [deactivate])

  const onZoneClick = useCallback(() => {
    const idx = focusIdxRef.current
    const cur = entriesRef.current
    if (idx >= 0 && idx < cur.length) {
      deactivate()
      onSelect(cur[idx].messageId)
    }
  }, [onSelect, deactivate])

  useEffect(() => () => cancelAnimationFrame(rafIdRef.current), [])

  return (
    <div
      ref={zoneRef}
      className="absolute right-0 top-1/2 -translate-y-1/2 z-[5] select-none"
      style={{ pointerEvents: 'none', paddingLeft: `${visual.zonePadLeft}px` }}
      onMouseMove={onZoneMove}
      onMouseLeave={onZoneLeave}
      onClick={onZoneClick}
    >
      <div
        ref={railRef}
        className="flex flex-col items-end py-1"
        style={{
          pointerEvents: 'auto',
          paddingRight: `${visual.rightOffset}px`,
          paddingLeft: `${visual.hitPadLeft}px`,
        }}
        onMouseEnter={onTickEnter}
      >
        <TickRail entries={entries} visual={visual} />
      </div>
    </div>
  )
})

// ─── TouchFisheye ───────────────────────────

const TouchFisheye = memo(function TouchFisheye({ entries, onSelect, visual }: FisheyeProps) {
  const [overlayVisible, setOverlayVisible] = useState(false)
  const railRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const touchYRef = useRef<number | null>(null)
  const strengthsRef = useRef<number[]>([])
  const rafIdRef = useRef(0)
  const touchingRef = useRef(false)
  const prevFocusRef = useRef(-1)
  const cachedRef = useRef<CachedItem[] | null>(null)

  const entriesRef = useRef(entries)
  entriesRef.current = entries
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const visualRef = useRef(visual)
  visualRef.current = visual

  useEffect(() => {
    strengthsRef.current = entries.map(() => 0)
    cachedRef.current = null
  }, [entries])

  const getItems = useCallback(() => {
    cachedRef.current ??= queryCachedItems(railRef.current)
    return cachedRef.current
  }, [])

  const vibrate = useCallback(() => {
    try {
      const bridge = (window as unknown as { __opencode_android?: { vibrate?: (ms: number) => void } })
        .__opencode_android
      if (bridge?.vibrate) {
        bridge.vibrate(8)
        return
      }
      navigator.vibrate?.(5)
    } catch {
      /* ignore */
    }
  }, [])

  const loop = useCallback(
    function tick() {
      const { alive, focusIndex, maxStrength } = applyFisheye(
        getItems(),
        touchYRef.current,
        strengthsRef.current,
        visualRef.current.fisheye,
      )

      if (focusIndex >= 0 && maxStrength > 0.5 && focusIndex !== prevFocusRef.current) {
        prevFocusRef.current = focusIndex
        vibrate()
        const el = overlayRef.current
        if (el) {
          el.textContent = entriesRef.current[focusIndex]?.overlayLabel ?? ''
          el.style.opacity = '1'
          el.style.transform = 'translateY(0px)'
        }
      }
      if ((focusIndex < 0 || maxStrength <= 0.5) && !touchingRef.current) {
        const el = overlayRef.current
        if (el) {
          el.style.opacity = '0'
          el.style.transform = 'translateY(4px)'
        }
      }

      if (touchingRef.current || alive) {
        rafIdRef.current = requestAnimationFrame(tick)
      } else {
        setOverlayVisible(false)
      }
    },
    [getItems, vibrate],
  )

  // 用 ref 包 kick，供原生事件回调读取最新闭包
  const kickRef = useRef(() => {})
  kickRef.current = () => {
    cancelAnimationFrame(rafIdRef.current)
    rafIdRef.current = requestAnimationFrame(loop)
  }

  useEffect(() => {
    const el = railRef.current
    if (!el) return

    const onStart = (e: TouchEvent) => {
      e.preventDefault()
      touchingRef.current = true
      prevFocusRef.current = -1
      touchYRef.current = e.touches[0].clientY
      setOverlayVisible(true)
      kickRef.current()
    }
    const onMove = (e: TouchEvent) => {
      e.preventDefault()
      touchYRef.current = e.touches[0].clientY
    }
    const onEnd = () => {
      const idx = prevFocusRef.current
      const cur = entriesRef.current
      if (idx >= 0 && idx < cur.length) onSelectRef.current(cur[idx].messageId)

      touchingRef.current = false
      touchYRef.current = null
      prevFocusRef.current = -1
      const title = overlayRef.current
      if (title) {
        title.style.opacity = '0'
        title.style.transform = 'translateY(4px)'
      }
      kickRef.current()
    }

    el.addEventListener('touchstart', onStart, { passive: false })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd)
    el.addEventListener('touchcancel', onEnd)
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
    }
  }, [])

  useEffect(() => () => cancelAnimationFrame(rafIdRef.current), [])

  return (
    <div>
      {overlayVisible && (
        <div className="absolute inset-0 z-[14] bg-bg-100/40 backdrop-blur-sm flex items-start justify-center pt-[30%] pointer-events-none">
          <div
            ref={overlayRef}
            className={`px-5 py-2 max-w-[75vw] text-center ${visual.overlayClassName}`}
            style={{
              opacity: 0,
              transform: 'translateY(4px)',
              transition: 'opacity 0.15s ease-out, transform 0.15s ease-out',
            }}
          />
        </div>
      )}

      <div
        ref={railRef}
        className="absolute top-1/2 -translate-y-1/2 z-[15] flex flex-col items-end pl-4 py-4 select-none"
        style={{ right: `${visual.rightOffset}px` }}
      >
        <TickRail entries={entries} visual={visual} />
      </div>
    </div>
  )
})
