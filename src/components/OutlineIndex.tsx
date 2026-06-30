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
//   内层 tick 列 — 初始只用可见 tick 区域触发，mouseEnter 时激活外层
//   效果：必须从 tick 触发，激活后 zone 内自由滑动不中断
//
// Touch 版本：触摸 tick 列激活鱼眼，激活后全局跟踪滑动 + 震动 + overlay 居中标题
// ============================================

import { memo, useMemo, useRef, useEffect, useLayoutEffect, useCallback } from 'react'
import type { CSSProperties } from 'react'
import type { Message } from '../types/message'
import { useChatViewport } from '../features/chat/chatViewport'
import { buildOutlineSourceEntries, truncateOutlineLabel, type OutlineSourceEntry } from './outlineIndexModel'

const EMPTY_MESSAGES: Message[] = []

// ─── Types ──────────────────────────────────

interface OutlineEntry {
  messageId: string
  fullTitle: string
  railLabel: string
  overlayLabel: string
}

interface OutlineIndexProps {
  messages?: Message[]
  sourceEntries?: OutlineSourceEntry[]
  ownerByMessageId?: Map<string, string>
  visibleMessageIds?: string[]
  currentHighlightEnabled?: boolean
  onScrollToMessageId: (messageId: string) => void
}

interface FisheyeConfig {
  tickWidth: { min: number; max: number }
  tickHeight: number
  margin: { min: number; max: number }
  labelThreshold: number
  /** CSS 声明式鱼眼参数（从稳态数值拟合得到，使纯 CSS transform 1:1 复刻原 JS-per-frame 效果）。
   *  strength: s = cos(clamp(dist/strengthRadius,0,1)*90deg)^2
   *  纵向位移: delta = -shiftAmp * sin(clamp(dy/shiftRadius,-1,1)*90deg) */
  css: {
    strengthRadius: number
    shiftAmp: number
    shiftRadius: number
    /** lerp(0.18) 平滑的 CSS transition 等价时长（秒）。 */
    ease: number
  }
}

interface VisualConfig {
  rightOffset: number
  hitPadLeft: number
  pointerHitWidth: number
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
  /** 当前可见区域所属 user prompt 在 entries 中的位置。 */
  ownerVisibleIndex: number
}

// ─── Fisheye Presets ────────────────────────

const DESKTOP_FISHEYE: FisheyeConfig = {
  tickWidth: { min: 8, max: 22 },
  tickHeight: 2.5,
  margin: { min: 4, max: 14 },
  labelThreshold: 0.65,
  css: { strengthRadius: 30, shiftAmp: 28.5, shiftRadius: 30, ease: 0.3 },
}

const COMPACT_FISHEYE: FisheyeConfig = {
  tickWidth: { min: 6, max: 20 },
  tickHeight: 2.5,
  margin: { min: 3, max: 16 },
  labelThreshold: 0.6,
  css: { strengthRadius: 18, shiftAmp: 27.5, shiftRadius: 18, ease: 0.3 },
}

// ─── Visual Presets ─────────────────────────

const DESKTOP_VISUAL: VisualConfig = {
  rightOffset: 5,
  hitPadLeft: 0,
  pointerHitWidth: 8,
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
  hitPadLeft: 0,
  pointerHitWidth: 6,
  zonePadLeft: 140,
  labelClassName: 'text-[length:var(--fs-xs)] leading-none text-text-300',
  overlayClassName: 'text-[length:var(--fs-base)] font-semibold text-text-100',
  fisheye: COMPACT_FISHEYE,
  railLabelMax: 14,
  overlayLabelMax: 32,
  maxEntries: 30,
}

// ─── Fisheye Engine (CSS-variable driven) ───────────────────────────
//
// 鱼眼视觉（tick 放大 scaleX + 纵向撑开 translateY + label 弹出）全部由 CSS 声明式计算：
// 交互时主线程每帧只在 rail 容器上写一个 --oi-cursor-y 变量（和 --oi-active 0/1），
// 每个 item 用自身静止中心 --oi-cy 与之做 calc 推导出 transform。CSS transform/opacity
// 跑在合成线程，主线程被流式渲染占用时动画依旧丝滑（不再是每帧 JS 遍历写 style）。
//
// 数学与原 JS-per-frame 稳态等价（数值拟合，误差<2%）：
//   cy       = viewportCenterY + (index - (count-1)/2) * (tickHeight + 2*marginMin)
//   dist     = |cursorY - cy|
//   strength = cos(clamp(dist/strengthRadius, 0, 1) * 90deg)^2 → 驱动 tick scaleX、label
//   shift    = -shiftAmp * sin(clamp((cursorY-cy)/shiftRadius, -1, 1) * 90deg) → item translateY
// strength/shift 各乘 --oi-active，保证静止（未交互）时基线为 0，撑开关于光标上下对称。

function syncRailCenter(rail: HTMLElement | null): number {
  if (!rail) return 0
  const rect = rail.getBoundingClientRect()
  const center = rect.top + rect.height / 2
  rail.style.setProperty('--oi-rail-center-y', String(center))
  return center
}

function activateRail(rail: HTMLElement, cursorY: number) {
  rail.style.setProperty('--oi-cursor-y', String(cursorY))
  rail.style.setProperty('--oi-active', '1')
}

function deactivateRail(rail: HTMLElement | null) {
  rail?.style.setProperty('--oi-active', '0')
}

/** 根据光标 Y 与 rail 静态几何，算最近 item 下标（用于选中 / overlay 标题 / 触觉反馈）。
 *  不读 DOM、不写样式；中心点公式与 CSS --oi-cy 完全一致。 */
function nearestIndexFromY(count: number, cursorY: number, railCenterY: number, fisheye: FisheyeConfig): number {
  if (count <= 0 || typeof window === 'undefined') return -1
  const step = fisheye.tickHeight + fisheye.margin.min * 2
  const mid = (count - 1) / 2
  const index = Math.round((cursorY - railCenterY) / step + mid)
  if (index < 0 || index >= count) return -1

  const centerY = railCenterY + (index - mid) * step
  return Math.abs(cursorY - centerY) <= fisheye.css.strengthRadius ? index : -1
}

/** 从 entries 中找偏置后的可见索引。
 *  取第二个匹配项（而非第一个），避免 viewport 顶部刚好落在上一条 prompt 尾部时误判。
 *  若只有一条匹配则退化为第一条。 */
function findBiasedVisibleIndex(entries: OutlineEntry[], ownerVisibleIds?: Set<string>): number {
  if (!ownerVisibleIds || ownerVisibleIds.size === 0) return -1
  let first = -1
  let second = -1
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    if (entry && ownerVisibleIds.has(entry.messageId)) {
      if (first === -1) first = i
      else {
        second = i
        break
      }
    }
  }
  return second !== -1 ? second : first
}


function formatEntries(entries: OutlineSourceEntry[], visual: VisualConfig): OutlineEntry[] {
  return entries.map(entry => ({
    messageId: entry.messageId,
    fullTitle: entry.title,
    railLabel: truncateOutlineLabel(entry.title, visual.railLabelMax),
    overlayLabel: truncateOutlineLabel(entry.title, visual.overlayLabelMax),
  }))
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

const TICK_COLORS = {
  focused: { bg: 'hsl(var(--accent-brand))', shadow: '0 0 4px hsl(var(--accent-brand) / 0.5)' },
  visible: { bg: 'hsl(var(--text-100))', shadow: '0 0 3px hsl(var(--text-100) / 0.3)' },
  default: { bg: 'hsl(var(--border-300))', shadow: 'none' },
} as const

/** 给单个 tick 上色（focused/visible/default）。仅在 focusIndex/visibleIndex 变化时调用，
 *  颜色变化只触发 paint、不触发 layout，且非每帧执行。 */
function paintTick(tick: HTMLElement | null, state: keyof typeof TICK_COLORS) {
  if (!tick) return
  tick.style.backgroundColor = TICK_COLORS[state].bg
  tick.style.boxShadow = TICK_COLORS[state].shadow
}

/** 重新着色所有 tick：focus 优先 > visible > default。仅在 focus/visible 下标变化时调用。 */
function repaintTicks(ticks: HTMLElement[], focusIndex: number, visibleIndex: number) {
  for (let i = 0; i < ticks.length; i++) {
    const state = i === focusIndex ? 'focused' : i === visibleIndex ? 'visible' : 'default'
    paintTick(ticks[i], state)
  }
}

/** 构建 item 的 CSS 变量声明式样式：纵向撑开 translateY 由 --oi-cursor-y/--oi-cy/--oi-active 推导，
 *  全部交给合成线程，交互时主线程每帧只需更新容器的 --oi-cursor-y。 */
function buildItemStyle(css: FisheyeConfig['css'], marginMin: number): CSSProperties {
  return {
    marginTop: `${marginMin}px`,
    marginBottom: `${marginMin}px`,
    // 静止中心（viewport 像素数，unitless）：rail 垂直居中，item 以固定 step 排列。
    // 不读 DOM，CSS 与 nearestIndexFromY 使用同一套几何公式。
    '--oi-cy': 'calc(var(--oi-rail-center-y, 0) + (var(--oi-index, 0) - var(--oi-mid, 0)) * var(--oi-step, 1))',
    // 距离（相对静止中心）；adist 取绝对值
    '--oi-dy': 'calc(var(--oi-cursor-y, 0) - var(--oi-cy, 0))',
    '--oi-adist': 'max(var(--oi-dy), calc(-1 * var(--oi-dy)))',
    '--oi-t': `clamp(0, calc(var(--oi-adist) / ${css.strengthRadius}), 1)`,
    // strength = cos(t*90deg)^pow（pow=2 → 平方），乘 --oi-active 保证静止基线为 0
    '--oi-c1': 'cos(calc(var(--oi-t) * 90deg))',
    '--oi-s': 'calc(var(--oi-active, 0) * var(--oi-c1) * var(--oi-c1))',
    // 纵向位移闭式解：-active * amp * sin(clamp(dy/shiftRadius, -1, 1) * 90deg)
    '--oi-u': `clamp(-1, calc(var(--oi-dy) / ${css.shiftRadius}), 1)`,
    '--oi-shift': `calc(-1 * var(--oi-active, 0) * ${css.shiftAmp} * sin(calc(var(--oi-u) * 90deg)))`,
    transform: 'translateY(calc(var(--oi-shift) * 1px))',
    transition: `transform ${css.ease}s cubic-bezier(0, 0, 0.2, 1)`,
    willChange: 'transform',
  } as CSSProperties
}

/** tick 样式：base width 设为 tickWidth.max，scaleX 按 strength 缩到 (min/max .. 1)。
 *  transform-origin 右对齐 → 与原 width 模型左向生长一致。 */
function buildTickStyle(fisheye: FisheyeConfig): CSSProperties {
  const { tickWidth, tickHeight, css } = fisheye
  return {
    width: `${tickWidth.max}px`,
    height: `${tickHeight}px`,
    backgroundColor: TICK_COLORS.default.bg,
    transformOrigin: 'right center',
    transform: `scaleX(calc((${tickWidth.min} + var(--oi-s, 0) * ${tickWidth.max - tickWidth.min}) / ${tickWidth.max}))`,
    transition: `transform ${css.ease}s cubic-bezier(0, 0, 0.2, 1)`,
    willChange: 'transform',
  } as CSSProperties
}

/** label 样式：opacity/translateX 由 strength 推导（声明式）。scaleX 不改变布局盒，
 *  故无需补偿 tick 宽度位移。 */
function buildLabelStyle(fisheye: FisheyeConfig): CSSProperties {
  const { labelThreshold, css } = fisheye
  return {
    // lt = clamp(0, (s - threshold)/(1-threshold), 1)
    '--oi-lt': `clamp(0, calc((var(--oi-s, 0) - ${labelThreshold}) / ${1 - labelThreshold}), 1)`,
    opacity: 'var(--oi-lt)',
    transform: 'translateX(calc((1 - var(--oi-lt)) * 10px))',
    transition: `opacity ${css.ease}s cubic-bezier(0, 0, 0.2, 1), transform ${css.ease}s cubic-bezier(0, 0, 0.2, 1)`,
    willChange: 'opacity, transform',
  } as CSSProperties
}

function buildRailVars(entriesLength: number, fisheye: FisheyeConfig): CSSProperties {
  return {
    '--oi-mid': String((entriesLength - 1) / 2),
    '--oi-step': String(fisheye.tickHeight + fisheye.margin.min * 2),
  } as CSSProperties
}

function TickRail({ entries, visual }: TickRailProps) {
  const itemStyle = buildItemStyle(visual.fisheye.css, visual.fisheye.margin.min)
  const tickStyle = buildTickStyle(visual.fisheye)
  const labelStyle = buildLabelStyle(visual.fisheye)
  return (
    <>
      {entries.map((entry, index) => (
        <div
          key={entry.messageId}
          data-oi-item
          className="relative flex items-center justify-end cursor-pointer"
          style={{ ...itemStyle, '--oi-index': String(index) } as CSSProperties}
          title={entry.fullTitle}
        >
          <div
            data-oi-label
            className={`absolute right-full mr-2.5 whitespace-nowrap pointer-events-none ${visual.labelClassName}`}
            style={labelStyle}
          >
            {entry.railLabel}
          </div>
          <div data-oi-tick className="rounded-full shrink-0" style={tickStyle} />
        </div>
      ))}
    </>
  )
}

// ─── Entry Point ────────────────────────────

export const OutlineIndex = memo(function OutlineIndex({
  messages = EMPTY_MESSAGES,
  sourceEntries,
  ownerByMessageId,
  visibleMessageIds,
  currentHighlightEnabled = true,
  onScrollToMessageId,
}: OutlineIndexProps) {
  const { interaction, presentation } = useChatViewport()
  const visual = presentation.isCompact ? COMPACT_VISUAL : DESKTOP_VISUAL
  const outlineSourceEntries = useMemo(() => sourceEntries ?? buildOutlineSourceEntries(messages), [messages, sourceEntries])
  const allEntries = useMemo(() => formatEntries(outlineSourceEntries, visual), [outlineSourceEntries, visual])
  const entries = useMemo(
    () => sliceAroundVisible(allEntries, visibleMessageIds ?? [], visual.maxEntries),
    [allEntries, visibleMessageIds, visual.maxEntries],
  )
  const resolvedOwnerByMessageId = useMemo(() => {
    if (ownerByMessageId) return ownerByMessageId

    let lastUserMsgId: string | null = null
    const ownerMap = new Map<string, string>()
    for (const msg of messages) {
      if (msg.info.role === 'user') lastUserMsgId = msg.info.id
      if (lastUserMsgId) ownerMap.set(msg.info.id, lastUserMsgId)
    }
    return ownerMap
  }, [messages, ownerByMessageId])

  // 构建 territory 映射：每个消息 ID → 所属 user prompt 的 ID
  const ownerVisibleIds = useMemo(() => {
    const set = new Set<string>()
    if (!currentHighlightEnabled || !visibleMessageIds) return set

    for (const vid of visibleMessageIds) {
      const owner = resolvedOwnerByMessageId.get(vid)
      if (owner) set.add(owner)
    }
    return set
  }, [currentHighlightEnabled, resolvedOwnerByMessageId, visibleMessageIds])
  const ownerVisibleIndex = useMemo(() => findBiasedVisibleIndex(entries, ownerVisibleIds), [entries, ownerVisibleIds])

  if (entries.length < 2) return null

  return interaction.outlineInteraction === 'touch' ? (
    <TouchFisheye entries={entries} onSelect={onScrollToMessageId} visual={visual} ownerVisibleIndex={ownerVisibleIndex} />
  ) : (
    <PointerFisheye entries={entries} onSelect={onScrollToMessageId} visual={visual} ownerVisibleIndex={ownerVisibleIndex} />
  )
})

// ─── PointerFisheye ─────────────────────────

const PointerFisheye = memo(function PointerFisheye({ entries, onSelect, visual, ownerVisibleIndex }: FisheyeProps) {
  const zoneRef = useRef<HTMLDivElement>(null)
  const railRef = useRef<HTMLDivElement>(null)
  const hoveringRef = useRef(false)
  const focusIdxRef = useRef(-1)
  // tick 元素缓存（只用于低频颜色重绘；entries 变化时清空）
  const ticksRef = useRef<HTMLElement[]>([])
  const railCenterRef = useRef(0)
  const entriesRef = useRef(entries)
  const onSelectRef = useRef(onSelect)
  const ownerVisibleIndexRef = useRef(ownerVisibleIndex)
  const fisheyeRef = useRef(visual.fisheye)
  useEffect(() => {
    entriesRef.current = entries
    onSelectRef.current = onSelect
    ownerVisibleIndexRef.current = ownerVisibleIndex
    fisheyeRef.current = visual.fisheye
  })

  useEffect(() => {
    ticksRef.current = []
    focusIdxRef.current = -1
  }, [entries])

  useLayoutEffect(() => {
    railCenterRef.current = syncRailCenter(railRef.current)
  }, [entries, visual])

  useEffect(() => {
    const onResize = () => {
      railCenterRef.current = syncRailCenter(railRef.current)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  /** 缓存 tick 元素列表（不读 layout，entries 变化时清空）。 */
  const getTicks = useCallback(() => {
    if (ticksRef.current.length === 0 && railRef.current) {
      ticksRef.current = Array.from(railRef.current.querySelectorAll<HTMLElement>('[data-oi-tick]'))
    }
    return ticksRef.current
  }, [])

  // visible 高亮：仅在 ownerVisibleIndex 变化且未交互时更新 tick 颜色（低频、非热路径）
  useEffect(() => {
    if (hoveringRef.current) return
    repaintTicks(getTicks(), -1, ownerVisibleIndex)
  }, [ownerVisibleIndex, entries, getTicks])

  const setZoneActive = useCallback((active: boolean) => {
    const z = zoneRef.current
    if (z) z.style.pointerEvents = active ? 'auto' : 'none'
  }, [])

  const deactivate = useCallback(() => {
    hoveringRef.current = false
    focusIdxRef.current = -1
    setZoneActive(false)
    const rail = railRef.current
    if (rail) rail.style.setProperty('--oi-active', '0')
    // 恢复 visible 高亮
    repaintTicks(getTicks(), -1, ownerVisibleIndexRef.current)
  }, [setZoneActive, getTicks])

  const onTickEnter = useCallback((e: React.MouseEvent) => {
    hoveringRef.current = true
    setZoneActive(true)
    const rail = railRef.current
    if (!rail) return
    ticksRef.current = getTicks()
    activateRail(rail, e.clientY)
    const next = nearestIndexFromY(entriesRef.current.length, e.clientY, railCenterRef.current, fisheyeRef.current)
    focusIdxRef.current = next
    repaintTicks(ticksRef.current, next, ownerVisibleIndexRef.current)
  }, [setZoneActive, getTicks])

  const onZoneMove = useCallback((e: React.MouseEvent) => {
    const rail = railRef.current
    if (!rail) return
    // 主线程每帧唯一的工作：写一个变量。其余 transform 交给合成线程。
    rail.style.setProperty('--oi-cursor-y', String(e.clientY))
    // 算最近焦点（纯数值），仅在变化时重新着色（paint-only，非每帧）
    const next = nearestIndexFromY(entriesRef.current.length, e.clientY, railCenterRef.current, fisheyeRef.current)
    if (next !== focusIdxRef.current) {
      if (ticksRef.current.length === 0) ticksRef.current = getTicks()
      focusIdxRef.current = next
      repaintTicks(ticksRef.current, next, ownerVisibleIndexRef.current)
    }
  }, [getTicks])
  const onZoneLeave = useCallback(() => deactivate(), [deactivate])

  const onZoneClick = useCallback(() => {
    const idx = focusIdxRef.current
    const cur = entriesRef.current
    if (idx >= 0 && idx < cur.length) {
      deactivate()
      onSelectRef.current(cur[idx].messageId)
    }
  }, [deactivate])

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
        className="flex justify-end py-1"
        style={{
          pointerEvents: 'auto',
          paddingRight: `${visual.rightOffset}px`,
          paddingLeft: `${visual.hitPadLeft}px`,
          width: `${visual.pointerHitWidth + visual.hitPadLeft + visual.rightOffset}px`,
        }}
        onMouseEnter={onTickEnter}
      >
        <div ref={railRef} className="pointer-events-none flex flex-col items-end" style={buildRailVars(entries.length, visual.fisheye)}>
          <TickRail entries={entries} visual={visual} />
        </div>
      </div>
    </div>
  )
})

// ─── TouchFisheye ───────────────────────────

const TouchFisheye = memo(function TouchFisheye({ entries, onSelect, visual, ownerVisibleIndex }: FisheyeProps) {
  const railRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
  const touchingRef = useRef(false)
  const prevFocusRef = useRef(-1)
  // tick 元素缓存（只用于低频颜色重绘；entries 变化时清空）
  const ticksRef = useRef<HTMLElement[]>([])
  const railCenterRef = useRef(0)

  const entriesRef = useRef(entries)
  const onSelectRef = useRef(onSelect)
  const ownerVisibleIndexRef = useRef(ownerVisibleIndex)
  const fisheyeRef = useRef(visual.fisheye)
  useEffect(() => {
    entriesRef.current = entries
    onSelectRef.current = onSelect
    ownerVisibleIndexRef.current = ownerVisibleIndex
    fisheyeRef.current = visual.fisheye
  })

  useEffect(() => {
    ticksRef.current = []
    prevFocusRef.current = -1
  }, [entries])

  useLayoutEffect(() => {
    railCenterRef.current = syncRailCenter(railRef.current)
  }, [entries, visual])

  useEffect(() => {
    const onResize = () => {
      railCenterRef.current = syncRailCenter(railRef.current)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const getTicks = useCallback(() => {
    if (ticksRef.current.length === 0 && railRef.current) {
      ticksRef.current = Array.from(railRef.current.querySelectorAll<HTMLElement>('[data-oi-tick]'))
    }
    return ticksRef.current
  }, [])

  // visible 高亮：仅在 ownerVisibleIndex 变化且未交互时更新（低频、非热路径）
  useEffect(() => {
    if (touchingRef.current) return
    repaintTicks(getTicks(), -1, ownerVisibleIndex)
  }, [ownerVisibleIndex, entries, getTicks])

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

  useEffect(() => {
    const el = railRef.current
    if (!el) return

    const onStart = (e: TouchEvent) => {
      const touch = e.touches[0]
      if (!touch) return
      e.preventDefault()
      touchingRef.current = true
      prevFocusRef.current = -1
      const y = touch.clientY
      ticksRef.current = getTicks()
      activateRail(el, y)
      // 直接用 ref 显示遮罩，不触发 React 重渲染
      if (backdropRef.current) backdropRef.current.style.display = 'flex'
      updateFocus(y)
    }
    const onMove = (e: TouchEvent) => {
      if (!touchingRef.current) return
      const touch = e.touches[0]
      if (!touch) return
      e.preventDefault()
      const y = touch.clientY
      // 主线程每帧唯一的工作：写一个变量
      el.style.setProperty('--oi-cursor-y', String(y))
      updateFocus(y)
    }
    // 算焦点 + 触觉 + overlay 标题（仅在焦点变化时，paint-only）
    const updateFocus = (y: number) => {
      const next = nearestIndexFromY(entriesRef.current.length, y, railCenterRef.current, fisheyeRef.current)
      if (next === prevFocusRef.current) return
      prevFocusRef.current = next
      if (ticksRef.current.length === 0) ticksRef.current = getTicks()
      repaintTicks(ticksRef.current, next, ownerVisibleIndexRef.current)
      const ov = overlayRef.current
      if (next >= 0) {
        vibrate()
        if (ov) {
          ov.textContent = entriesRef.current[next]?.overlayLabel ?? ''
          ov.style.opacity = '1'
          ov.style.transform = 'translateY(0px)'
        }
      } else if (ov) {
        ov.style.opacity = '0'
        ov.style.transform = 'translateY(4px)'
      }
    }
    const onEnd = () => {
      if (!touchingRef.current) return
      const idx = prevFocusRef.current
      const cur = entriesRef.current
      if (idx >= 0 && idx < cur.length) onSelectRef.current(cur[idx].messageId)

      touchingRef.current = false
      prevFocusRef.current = -1
      deactivateRail(el)
      const title = overlayRef.current
      if (title) {
        title.style.opacity = '0'
        title.style.transform = 'translateY(4px)'
      }
      if (backdropRef.current) backdropRef.current.style.display = 'none'
      repaintTicks(getTicks(), -1, ownerVisibleIndexRef.current)
    }

    el.addEventListener('touchstart', onStart, { passive: false })
    document.addEventListener('touchmove', onMove, { passive: false })
    document.addEventListener('touchend', onEnd)
    document.addEventListener('touchcancel', onEnd)
    return () => {
      el.removeEventListener('touchstart', onStart)
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend', onEnd)
      document.removeEventListener('touchcancel', onEnd)
    }
  }, [getTicks, vibrate])

  return (
    <div>
      <div
        ref={backdropRef}
        className="absolute inset-0 z-[14] bg-bg-100/40 backdrop-blur-sm flex items-start justify-center pointer-events-none"
        style={{ display: 'none', paddingTop: `calc(30% + var(--app-safe-top, 0px))` }}
      >
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

      <div
        ref={railRef}
        className="absolute top-1/2 -translate-y-1/2 z-[15] flex flex-col items-end select-none"
        style={{ right: `${visual.rightOffset}px`, ...buildRailVars(entries.length, visual.fisheye) }}
      >
        <TickRail entries={entries} visual={visual} />
      </div>
    </div>
  )
})
