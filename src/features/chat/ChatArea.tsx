/**
 * ChatArea — 基于 @tanstack/react-virtual 的消息流虚拟化
 *
 * 对齐 oc message-timeline 的关键点：
 * 1. parent 在 messages ready 后 key={sessionId} remount
 * 2. mount 时读 sessionCache → initialMeasurementsCache
 * 3. 冷启动 initialOffset 估在底部 + scrollToFn 预写 total height
 * 4. anchorTo/followOnAppend + 贴底时 size change 直接 scrollToEnd
 * 5. unmount takeSnapshot 写回 cache
 * 6. directDomUpdates 滚动写 transform，不触发 React 重渲染
 */
import {
  useRef, useImperativeHandle, forwardRef, memo,
  useCallback, useEffect, useLayoutEffect, useMemo, useState,
} from 'react'
import {
  useVirtualizer, elementScroll, defaultRangeExtractor,
  type VirtualItem,
} from '@tanstack/react-virtual'
import { useTranslation } from 'react-i18next'
import {
  MessageRenderer,
  ProcessCollapseBlock,
  messageHasFinalContent,
  messageHasProcessContent,
} from '../message'
import { MessageErrorView } from '../message/parts'
import type { Message, MessageError } from '../../types/message'
import { RetryStatusInline, type RetryStatusInlineData } from './RetryStatusInline'
import { buildVisibleMessageEntries, getVisibleMessageForkTargetId } from './chatAreaVisibility'
import { AT_BOTTOM_THRESHOLD_PX } from '../../constants'
import { useChatViewport } from './chatViewport'
import {
  buildProcessTimeline,
  buildTurnDurationMap,
  buildTurnLatestAssistantIdSet,
  reuseProcessTimelineItems,
  type ProcessTimelineItem,
  type StableChatPage,
} from './chatPageModel'
import { useTheme } from '../../hooks/useTheme'
import { useAutoScroll } from './virtual/useAutoScroll'
import { AutoScrollProvider } from '../../hooks/AutoScrollContext'
import { useEmptyWorkingShellGate } from './virtual/useEmptyWorkingShellGate'

const NOOP = () => {}
const ROW_ESTIMATE = 60
/** 过程壳 header 行高（Working / Worked 一行） */
const PROCESS_SHELL_HEADER = 36
/** 用户入场生长结束后，空 Working 壳再等多久（有 assistant 则立刻挂，不等） */
const EMPTY_WORKING_SHELL_EXTRA_DELAY_MS = 500
const DEFAULT_BOTTOM_SPACER = 256
const SESSION_CACHE_LIMIT = 16

const bottomSpacerHeight = (bottomPadding: number) =>
  bottomPadding > 0 ? bottomPadding + 48 : DEFAULT_BOTTOM_SPACER

function estimateTimelineItemSize(item: ProcessTimelineItem | undefined): number {
  if (!item) return ROW_ESTIMATE
  if (item.kind === 'message') return ROW_ESTIMATE
  // 进行中默认展开：header + 壳内消息（空回合至少占 header）
  if (item.isActive) {
    const body = Math.max(item.children.length, 1) * ROW_ESTIMATE
    return PROCESS_SHELL_HEADER + body
  }
  // 结束后默认折叠：只估 header + 壳外 final，避免刷新时 120→36 的假高度再回弹
  return PROCESS_SHELL_HEADER + (item.finalMessage ? ROW_ESTIMATE : 0)
}

function sessionCacheKey(sessionId: string, processCollapseEnabled: boolean): string {
  return `${sessionId}:${processCollapseEnabled ? 'process' : 'flat'}`
}

/** 流式热行 index：末 1～2 行，避免 virtual range 边界卸载正在生成的行 */
export function getStreamingHotIndexes(count: number, isStreaming: boolean): number[] {
  if (!isStreaming || count <= 0) return []
  if (count === 1) return [0]
  return [count - 2, count - 1]
}

/** 合并 range 与 pin index（resize pin + 流式热行） */
export function mergeVirtualRangeIndexes(base: number[], ...pinnedGroups: number[][]): number[] {
  const pinned = pinnedGroups.flat()
  if (pinned.length === 0) return base
  return [...new Set([...pinned, ...base])].sort((a, b) => a - b)
}

// ─── 接口定义（保持不变） ───────────────────────────────────────

interface ChatAreaProps {
  messages: Message[]
  pageRecords?: StableChatPage[]
  visibleMessages?: Message[]
  forkTargetIdMap?: Map<string, string | undefined>
  turnDurationMap?: Map<string, number>
  turnLatestAssistantIds?: Set<string>
  sessionId?: string | null
  isStreaming?: boolean
  allowStreamingLayoutAnimation?: boolean
  loadState?: 'idle' | 'loading' | 'loaded' | 'error'
  loadError?: MessageError
  connectionError?: MessageError
  onOpenSettings?: () => void
  hasMoreHistory?: boolean
  onLoadMore?: () => void | Promise<void>
  onUndo?: (userMessageId: string) => void
  onFork?: (message: Message, forkMessageId?: string) => void | Promise<void>
  canUndo?: boolean
  registerMessage?: (id: string, element: HTMLElement | null) => void
  retryStatus?: RetryStatusInlineData | null
  bottomPadding?: number
  onVisibleMessageIdsChange?: (ids: string[]) => void
  onAtBottomChange?: (atBottom: boolean) => void
  /** 用户跟随状态变化时调用：true=正在贴底跟随，false=用户主动停止跟随 */
  onFollowingChange?: (following: boolean) => void
}

export type ChatAreaHandle = {
  scrollToBottom: (instant?: boolean) => void
  scrollToBottomIfAtBottom: () => void
  scrollToLastMessage: () => void
  scrollToMessageIndex: (index: number) => void
  scrollToMessageId: (messageId: string) => void
}

// ─── 虚拟行 ──────────────────────────────────────────────────

interface MessageBodyProps {
  message: Message
  registerMessage?: (id: string, element: HTMLElement | null) => void
  onUndo?: (userMessageId: string) => void
  onFork?: (message: Message, forkMessageId?: string) => void | Promise<void>
  canUndo?: boolean
  forkMessageId?: string
  turnDuration?: number
  isTurnLatestAssistant?: boolean
  allowStreamingLayoutAnimation: boolean
  processContentScope?: 'all' | 'process' | 'final' | 'inline'
  onEntryGrowComplete?: (messageId: string) => void
}

const MessageBody = memo(function MessageBody({
  message,
  registerMessage,
  onUndo,
  onFork,
  canUndo,
  forkMessageId,
  turnDuration,
  isTurnLatestAssistant,
  allowStreamingLayoutAnimation,
  processContentScope = 'all',
  onEntryGrowComplete,
}: MessageBodyProps) {
  const messageId = message.info.id
  const isUser = message.info.role === 'user'
  return (
    <div
      ref={node => registerMessage?.(messageId, node as HTMLDivElement | null)}
      data-message-id={messageId}
      data-anchor-source-id={forkMessageId ?? messageId}
    >
      <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
        <div className={`message-renderer-shell min-w-0 group ${!isUser ? 'w-full' : ''} flex flex-col gap-2`}>
          <MessageRenderer
            message={message}
            allowStreamingLayoutAnimation={message.isStreaming ? allowStreamingLayoutAnimation : false}
            turnDuration={turnDuration}
            isTurnLatestAssistant={isTurnLatestAssistant}
            processContentScope={processContentScope}
            onUndo={isUser ? onUndo : undefined}
            onFork={onFork}
            forkMessageId={forkMessageId}
            canUndo={isUser ? canUndo : undefined}
            onEnsureParts={NOOP}
            onEntryGrowComplete={isUser ? onEntryGrowComplete : undefined}
          />
        </div>
      </div>
    </div>
  )
})

interface RowProps {
  virtualItem: VirtualItem
  item: ProcessTimelineItem
  maxWidthClass: string
  paddingClass: string
  registerMessage?: (id: string, element: HTMLElement | null) => void
  onUndo?: (userMessageId: string) => void
  onFork?: (message: Message, forkMessageId?: string) => void | Promise<void>
  canUndo?: boolean
  forkMap: Map<string, string | undefined>
  turnDurationMap: Map<string, number>
  turnLatestAssistantIds: Set<string>
  allowStreamingLayoutAnimation: boolean
  measureElement: (el: HTMLElement | null) => void
  onEntryGrowComplete?: (messageId: string) => void
}

const VirtualRow = memo(function VirtualRow({
  virtualItem,
  item,
  maxWidthClass,
  paddingClass,
  registerMessage,
  onUndo,
  onFork,
  canUndo,
  forkMap,
  turnDurationMap,
  turnLatestAssistantIds,
  allowStreamingLayoutAnimation,
  measureElement,
  onEntryGrowComplete,
}: RowProps) {
  const rowRef = useRef<HTMLDivElement | null>(null)

  const setRef = useCallback((el: HTMLDivElement | null) => {
    rowRef.current = el
    measureElement(el)
  }, [measureElement])

  useLayoutEffect(() => {
    if (rowRef.current) measureElement(rowRef.current)
  }, [measureElement, virtualItem.index, item.key])

  return (
    <div
      ref={setRef}
      data-timeline-key={item.key}
      data-index={virtualItem.index}
      style={{ position: 'absolute', top: 0, left: 0, width: '100%' }}
    >
      <div className={`w-full ${maxWidthClass} mx-auto ${paddingClass} py-3 transition-[max-width] duration-300 ease-in-out`}>
        {item.kind === 'message' ? (
          <MessageBody
            message={item.message}
            registerMessage={registerMessage}
            onUndo={onUndo}
            onFork={onFork}
            canUndo={canUndo}
            forkMessageId={forkMap.get(item.message.info.id)}
            turnDuration={turnDurationMap.get(item.message.info.id)}
            isTurnLatestAssistant={
              item.message.info.role === 'assistant'
                ? turnLatestAssistantIds.has(item.message.info.id)
                : undefined
            }
            allowStreamingLayoutAnimation={allowStreamingLayoutAnimation}
            processContentScope={item.processContentScope ?? 'all'}
            onEntryGrowComplete={onEntryGrowComplete}
          />
        ) : (
          <div className="flex justify-start">
            <div className="message-renderer-shell min-w-0 group w-full flex flex-col gap-2">
              <ProcessCollapseBlock
                stateKey={`turn-process:${item.userMessageId ?? item.key}`}
                startedAt={item.startedAt}
                durationMs={item.durationMs}
                isActive={item.isActive}
              >
                {item.children.map(child => (
                  <MessageBody
                    key={`${child.message.info.id}:${child.processContentScope}`}
                    message={child.message}
                    registerMessage={registerMessage}
                    onUndo={onUndo}
                    onFork={onFork}
                    canUndo={canUndo}
                    forkMessageId={forkMap.get(child.message.info.id)}
                    turnDuration={turnDurationMap.get(child.message.info.id)}
                    isTurnLatestAssistant={turnLatestAssistantIds.has(child.message.info.id)}
                    allowStreamingLayoutAnimation={allowStreamingLayoutAnimation}
                    processContentScope={child.processContentScope}
                  />
                ))}
              </ProcessCollapseBlock>
              {item.finalMessage && (
                <MessageBody
                  message={item.finalMessage}
                  registerMessage={registerMessage}
                  onUndo={onUndo}
                  onFork={onFork}
                  canUndo={canUndo}
                  forkMessageId={forkMap.get(item.finalMessage.info.id)}
                  turnDuration={turnDurationMap.get(item.finalMessage.info.id)}
                  isTurnLatestAssistant
                  allowStreamingLayoutAnimation={allowStreamingLayoutAnimation}
                  processContentScope="final"
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}, (prev, next) =>
  prev.virtualItem.index === next.virtualItem.index &&
  prev.virtualItem.start === next.virtualItem.start &&
  prev.virtualItem.size === next.virtualItem.size &&
  prev.item === next.item &&
  prev.maxWidthClass === next.maxWidthClass &&
  prev.paddingClass === next.paddingClass &&
  prev.registerMessage === next.registerMessage &&
  prev.onUndo === next.onUndo &&
  prev.onFork === next.onFork &&
  prev.canUndo === next.canUndo &&
  prev.forkMap === next.forkMap &&
  prev.turnDurationMap === next.turnDurationMap &&
  prev.turnLatestAssistantIds === next.turnLatestAssistantIds &&
  prev.allowStreamingLayoutAnimation === next.allowStreamingLayoutAnimation &&
  prev.measureElement === next.measureElement &&
  prev.onEntryGrowComplete === next.onEntryGrowComplete
)

// ─── 会话缓存（LRU 16） ───────────────────────────────────────

const sessionCache = new Map<string, { measurements: VirtualItem[] }>()

// ─── ChatArea ────────────────────────────────────────────────

export const ChatArea = memo(
  forwardRef<ChatAreaHandle, ChatAreaProps>(
    (
      {
        messages, visibleMessages: visibleMessagesProp,
        forkTargetIdMap: forkTargetIdMapProp, turnDurationMap: turnDurationMapProp,
        turnLatestAssistantIds: turnLatestAssistantIdsProp,
        sessionId, isStreaming = false, allowStreamingLayoutAnimation = false,
        loadState = 'idle', loadError, connectionError, onOpenSettings,
        hasMoreHistory = false, onLoadMore, onUndo, onFork, canUndo,
        registerMessage, retryStatus = null, bottomPadding = 0,
        onVisibleMessageIdsChange, onAtBottomChange, onFollowingChange,
      },
      ref,
    ) => {
      const { t } = useTranslation('chat')
      const { isWideMode, processCollapseEnabled } = useTheme()
      const { presentation } = useChatViewport()
      const atBottomThreshold = presentation.isCompact ? 150 : AT_BOTTOM_THRESHOLD_PX
      const paddingClass = presentation.isCompact ? 'px-3' : 'px-5'
      const maxWidthClass = isWideMode ? 'max-w-[95%] xl:max-w-6xl' : 'max-w-2xl'

      // ── 派生数据 ──
      const entries = useMemo(() => buildVisibleMessageEntries(messages), [messages])
      const visibleMessages = useMemo(
        () => visibleMessagesProp ?? entries.map(e => e.message),
        [entries, visibleMessagesProp],
      )
      const forkMap = useMemo(
        () => forkTargetIdMapProp ?? new Map(entries.map(e => [e.message.info.id, getVisibleMessageForkTargetId(e)])),
        [forkTargetIdMapProp, entries],
      )
      const turnDurationMap = useMemo(
        () => turnDurationMapProp ?? buildTurnDurationMap(messages, visibleMessages),
        [messages, turnDurationMapProp, visibleMessages],
      )
      const turnLatestAssistantIds = useMemo(
        () => turnLatestAssistantIdsProp ?? buildTurnLatestAssistantIdSet(visibleMessages),
        [turnLatestAssistantIdsProp, visibleMessages],
      )

      // 空 Working 壳闸门：入场完成 + 额外停顿；idle 清空；有 assistant 立刻挂
      const emptyShellGate = useEmptyWorkingShellGate(isStreaming, EMPTY_WORKING_SHELL_EXTRA_DELAY_MS)

      // 过程折叠：按 user 回合建时间线；关闭时退回「一行一条消息」
      // previous 用于 item 级 structural sharing：流式只脏热行，VirtualRow memo 才能命中
      // 折叠开关切换时不跨模式复用（flat 与 process-shell 的 key 语义不同）
      const previousTimelineRef = useRef<{
        processCollapseEnabled: boolean
        items?: ProcessTimelineItem[]
      }>({ processCollapseEnabled })
      const timeline = useMemo<ProcessTimelineItem[]>(() => {
        const next = !processCollapseEnabled
          ? visibleMessages.map(message => ({
              kind: 'message' as const,
              key: message.info.id,
              message,
            }))
          : buildProcessTimeline(visibleMessages, {
              turnDurationMap,
              sessionIsStreaming: isStreaming,
              messageHasProcess: messageHasProcessContent,
              messageHasFinal: messageHasFinalContent,
              isUserEntryReady: emptyShellGate.isReady,
            })
        const previous =
          previousTimelineRef.current.processCollapseEnabled === processCollapseEnabled
            ? previousTimelineRef.current.items
            : undefined
        const reused = reuseProcessTimelineItems(previous, next)
        previousTimelineRef.current = { processCollapseEnabled, items: reused }
        return reused
        // emptyShellGate.version：额外延迟到期后强制重算，挂上 Working 壳
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [processCollapseEnabled, visibleMessages, turnDurationMap, isStreaming, emptyShellGate.version, emptyShellGate.isReady])

      const messageIdToTimelineIndex = useMemo(() => {
        const map = new Map<string, number>()
        timeline.forEach((item, index) => {
          if (item.kind === 'message') {
            map.set(item.message.info.id, index)
            return
          }
          if (item.userMessageId) map.set(item.userMessageId, index)
          for (const child of item.children) map.set(child.message.info.id, index)
          if (item.finalMessage) map.set(item.finalMessage.info.id, index)
        })
        return map
      }, [timeline])

      // ── Refs（避免闭包过期） ──
      const scrollRef = useRef<HTMLDivElement | null>(null)
      const contentRef = useRef<HTMLDivElement | null>(null)
      const sessionIdRef = useRef(sessionId); sessionIdRef.current = sessionId
      const onLoadMoreRef = useRef(onLoadMore); onLoadMoreRef.current = onLoadMore
      const onVisibleIdsRef = useRef(onVisibleMessageIdsChange); onVisibleIdsRef.current = onVisibleMessageIdsChange
      const onAtBottomRef = useRef(onAtBottomChange); onAtBottomRef.current = onAtBottomChange
      const onFollowingRef = useRef(onFollowingChange); onFollowingRef.current = onFollowingChange
      const hasMoreRef = useRef(hasMoreHistory); hasMoreRef.current = hasMoreHistory
      const loadStateRef = useRef(loadState); loadStateRef.current = loadState
      const thresholdRef = useRef(atBottomThreshold); thresholdRef.current = atBottomThreshold

      const [isLoadingMore, setIsLoadingMore] = useState(false)
      const loadingMoreRef = useRef(false)

      // ── 自动滚动 ──
      // userScrolled 判定用小阈值（10px），和 UI 回底按钮的 60/150 阈值分开。
      // 否则上滚一点点仍在“底部区”里，userScrolled 会被立刻清掉，
      // 再碰上最后一条 HTML 时钟每秒重测 → scrollToEnd，怎么滚都拉回底。
      const auto = useAutoScroll(10)
      const autoSetScrollRef = auto.setScrollRef
      const autoSetContentRef = auto.setContentRef
      const autoHandleScroll = auto.handleScroll
      const autoForceScroll = auto.forceScrollToBottom
      const autoScrollBottom = auto.scrollToBottom
      const autoPause = auto.pause
      const autoSetStreaming = auto.setStreaming
      const userScrolledRef = auto.userScrolledRef
      const autoSetPinToBottom = auto.setPinToBottom
      const spacerHeight = bottomSpacerHeight(bottomPadding)
      // 贴底判断必须读 ref：wheel→stop 后 state 还没 re-render，
      // 若仍用 state，同一帧的 ResizeObserver 会误判仍可贴底。
      const shouldAnchorBottom = () => !userScrolledRef.current

      // 给 message tree 里的 disclosure widget 用：用户主动操作（展开/折叠）
      // 时通知这里停止贴底跟随。值 stable（pause 是 useCallback），不会引起消费方 re-render。
      const autoScrollCtxValue = useMemo(() => ({ pause: autoPause }), [autoPause])

      // 同步 isStreaming 到 useAutoScroll —— selection 只在流式时才影响跟随
      useEffect(() => { autoSetStreaming(isStreaming) }, [autoSetStreaming, isStreaming])

      // ── 滚动状态（同步计算，不使用 rAF） ──
      const prevState = useRef({ overflow: false, bottom: true, jump: false })
      const computeScrollState = useCallback(() => {
        const el = scrollRef.current
        if (!el) return
        const max = el.scrollHeight - el.clientHeight
        const dist = max - el.scrollTop
        const overflow = max > 1
        const bottom = !overflow || dist <= thresholdRef.current
        const jump = overflow && dist > Math.max(400, el.clientHeight)
        const p = prevState.current
        if (p.overflow !== overflow || p.bottom !== bottom || p.jump !== jump) {
          prevState.current = { overflow, bottom, jump }
          onAtBottomRef.current?.(bottom)
        }
      }, [])

      // ── Virtualizer ──
      // parent key={sessionId} remount 后，这里只在 mount 时读一次 cache
      // cache key 必须带过程折叠模式：flat 与 process 的 item key/高度完全不同
      const cacheKey = sessionId ? sessionCacheKey(sessionId, processCollapseEnabled) : null
      const initialCacheRef = useRef(cacheKey ? sessionCache.get(cacheKey)?.measurements : undefined)
      const coldBottomMount = !initialCacheRef.current?.length
      const [renderOverscan, setRenderOverscan] = useState(
        initialCacheRef.current?.length || coldBottomMount ? 6 : 15,
      )
      const resizePinnedRef = useRef<number[]>([])
      const resizePinFrame = useRef<number | undefined>(undefined)
      const resizeAnchorScheduled = useRef(false)
      /** 流式热行 pin：ref 更新，不碰贴底/SSE 路径 */
      const hotPinnedRef = useRef<number[]>([])
      hotPinnedRef.current = getStreamingHotIndexes(timeline.length, isStreaming)

      // 冷启动估在底部：有 cache 用 cache 总高，否则 estimate*count + paddingEnd。
      // 不用 MAX_SAFE_INTEGER（单列 range 不会向前扩，只会渲染最后一项）。
      const estimatedBottomOffset = useMemo(() => {
        const cached = initialCacheRef.current
        if (cached?.length) {
          const last = cached[cached.length - 1]
          return Math.max(0, (last?.end ?? 0) + spacerHeight - 600)
        }
        const estimatedTotal = timeline.reduce((sum, item) => sum + estimateTimelineItemSize(item), 0)
        return Math.max(0, estimatedTotal + spacerHeight - 600)
        // 只在 mount 用初始 count 估一次
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
        count: timeline.length,
        getScrollElement: () => scrollRef.current,
        initialOffset: estimatedBottomOffset,
        initialMeasurementsCache: initialCacheRef.current,
        estimateSize: (index) => estimateTimelineItemSize(timeline[index]),
        getItemKey: (i) => timeline[i]?.key ?? `removed:${i}`,
        // 输入框占位放在消息区外（retry/error 之后），避免重试提示被压到输入框下面
        paddingEnd: 0,
        scrollEndThreshold: 80,
        // 预写 total height，避免浏览器把新 offset clamp 到旧高度（oc 同款）
        scrollToFn: (offset, options, instance) => {
          if (contentRef.current) contentRef.current.style.height = `${instance.getTotalSize()}px`
          elementScroll(offset, options, instance)
        },
        anchorTo: 'end',
        followOnAppend: false,
        overscan: 50,
        directDomUpdates: true,
        directDomUpdatesMode: 'transform',
        rangeExtractor: (range) => {
          const indexes = defaultRangeExtractor({ ...range, overscan: renderOverscan })
          return mergeVirtualRangeIndexes(indexes, resizePinnedRef.current, hotPinnedRef.current)
        },
      })

      // 一次性 overrides（resizeItem + shouldAdjust）——对齐 oc
      const overridesApplied = useRef(false)
      if (!overridesApplied.current) {
        const origResize = virtualizer.resizeItem
        virtualizer.resizeItem = (index: number, size: number) => {
          const item = (virtualizer as any).measurementsCache[index]
          const prev = item ? ((virtualizer as any).itemSizeCache.get(item.key) ?? item.size) : undefined
          const root = scrollRef.current
          if (root && prev !== undefined && Math.abs(size - prev) > root.clientHeight) {
            const view = root.getBoundingClientRect()
            resizePinnedRef.current = [...root.querySelectorAll<HTMLElement>('[data-index]')]
              .filter(el => {
                const r = el.getBoundingClientRect()
                return r.bottom > view.top && r.top < view.bottom
              })
              .map(el => Number(el.dataset.index))
            if (resizePinFrame.current !== undefined) cancelAnimationFrame(resizePinFrame.current)
            resizePinFrame.current = requestAnimationFrame(() => {
              resizePinFrame.current = requestAnimationFrame(() => {
                resizePinFrame.current = undefined
                resizePinnedRef.current = []
              })
            })
          }
          // 用户已上滚（userScrolledRef）时，临时关掉 anchorTo:'end'，
          // 阻止 virtual-core resizeItem 内部的 wasAtEnd 路径（applyScrollAdjustment 拉回）。
          // wasAtEnd 用 getVirtualDistanceFromEnd()（基于内部 scrollOffset），
          // 但 React commit 阶段 ref 回调触发 measureElement 时 scroll 事件还没 fire，
          // scrollOffset 是陈旧的（仍指向底部），wasAtEnd 误判为 true → 拉回。
          // userScrolledRef 现在只由输入事件设置（useAutoScroll 的 wheel/touch/...），
          // handleScroll 在用户回到底部阈值内时清掉。
          if (userScrolledRef.current) {
            const opts = (virtualizer as any).options
            const origAnchor = opts.anchorTo
            opts.anchorTo = 'start'
            origResize(index, size)
            opts.anchorTo = origAnchor
          } else {
            origResize(index, size)
          }
          if (
            root
            && shouldAnchorBottom()
            && !resizeAnchorScheduled.current
            && (virtualizer as any).isAtEnd?.(80)
          ) {
            resizeAnchorScheduled.current = true
            queueMicrotask(() => {
              resizeAnchorScheduled.current = false
              if (!shouldAnchorBottom()) return
              if (!(virtualizer as any).isAtEnd?.(80)) return
              const el = scrollRef.current
              if (!el) return
              const max = Math.max(0, el.scrollHeight - el.clientHeight)
              if (max - el.scrollTop >= 2) el.scrollTop = max
            })
          }
        }
        virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item: VirtualItem, _delta: number, instance: any) => {
          if (shouldAnchorBottom()) return false
          return item.end <= (instance.getScrollOffset?.() ?? 0) + (instance.scrollAdjustments ?? 0)
        }
        overridesApplied.current = true
      }

      // ── 历史加载（prepend 锚点） ──
      const prependAnchor = useRef<{ key: string; offset: number } | undefined>(undefined)
      const prependFrame = useRef<number | undefined>(undefined)
      const prependLoading = useRef(false)

      const clearPrepend = useCallback(() => {
        prependLoading.current = false
        prependAnchor.current = undefined
        if (prependFrame.current !== undefined) { cancelAnimationFrame(prependFrame.current); prependFrame.current = undefined }
      }, [])

      const updatePrependAnchor = useCallback(() => {
        const root = scrollRef.current
        if (!root) return
        const view = root.getBoundingClientRect()
        const anchor = [...root.querySelectorAll<HTMLElement>('[data-timeline-key]')]
          .map(el => ({ el, rect: el.getBoundingClientRect() }))
          .filter(x => x.rect.bottom > view.top && x.rect.top < view.bottom)
          .sort((a, b) => a.rect.top - b.rect.top)[0]
        if (anchor?.el.dataset.timelineKey) {
          prependAnchor.current = { key: anchor.el.dataset.timelineKey, offset: anchor.rect.top - view.top }
        }
      }, [])

      const applyPrependAnchor = useCallback(() => {
        const root = scrollRef.current
        if (!root || !prependAnchor.current) return
        if (prependFrame.current !== undefined) cancelAnimationFrame(prependFrame.current)
        let frames = 0, stable = 0
        const apply = () => {
          prependFrame.current = undefined
          const a = prependAnchor.current
          if (!a) return
          const el = root.querySelector<HTMLElement>(`[data-timeline-key="${CSS.escape(a.key)}"]`)
          const delta = el ? el.getBoundingClientRect().top - root.getBoundingClientRect().top - a.offset : undefined
          if (delta !== undefined && Math.abs(delta) > 0.5) { root.scrollTop += delta; stable = 0 }
          else stable++
          if (++frames >= 180 || stable >= 30) { if (!prependLoading.current) prependAnchor.current = undefined; return }
          prependFrame.current = requestAnimationFrame(apply)
        }
        prependFrame.current = requestAnimationFrame(apply)
      }, [])

      const capturePrepend = useCallback(() => {
        prependLoading.current = true
        updatePrependAnchor()
      }, [updatePrependAnchor])

      const restorePrepend = useCallback((done: boolean) => {
        if (done) prependLoading.current = false
        applyPrependAnchor()
      }, [applyPrependAnchor])

      const loadMore = useCallback(() => {
        capturePrepend()
        setIsLoadingMore(true); loadingMoreRef.current = true
        Promise.resolve(onLoadMoreRef.current?.())
          .catch(() => {})
          .finally(() => {
            setIsLoadingMore(false); loadingMoreRef.current = false
            restorePrepend(true)
          })
      }, [capturePrepend, restorePrepend])

      // fill: 内容不足以填满视口时自动加载
      const fillFrame = useRef<number | undefined>(undefined)
      const fill = useCallback(() => {
        if (fillFrame.current !== undefined) return
        fillFrame.current = requestAnimationFrame(() => {
          fillFrame.current = undefined
          if (!sessionIdRef.current || loadStateRef.current !== 'loaded') return
          if (userScrolledRef.current || loadingMoreRef.current) return
          const el = scrollRef.current
          if (el && el.scrollHeight > el.clientHeight + 1) return
          if (!hasMoreRef.current) return
          void loadMore()
        })
      }, [loadMore, userScrolledRef])

      // ── Ref 回调 ──
      const setScrollRoot = useCallback((el: HTMLDivElement | null) => {
        scrollRef.current = el
        autoSetScrollRef(el)
        if (el) { computeScrollState(); fill() }
      }, [autoSetScrollRef, computeScrollState, fill])

      const setVirtualContent = useCallback((el: HTMLDivElement | null) => {
        contentRef.current = el
        autoSetContentRef(el)
        virtualizer.containerRef(el)
        if (el && scrollRef.current) computeScrollState()
      }, [autoSetContentRef, virtualizer, computeScrollState])

      const pinToBottom = useCallback(() => {
        // 必须滚到整页底（含 retry/error + 输入框 spacer），不能只 scrollToEnd 虚拟消息区
        const el = scrollRef.current
        if (!el) return
        const max = Math.max(0, el.scrollHeight - el.clientHeight)
        if (max - el.scrollTop >= 2) el.scrollTop = max
      }, [])

      // 把 pinToBottom 注入 useAutoScroll，让 drift 自愈路径能调到
      useEffect(() => {
        autoSetPinToBottom(pinToBottom)
      }, [autoSetPinToBottom, pinToBottom])

      // ── 事件处理 ──
      const onScroll = useCallback(() => {
        if (prependLoading.current) updatePrependAnchor()
        computeScrollState()
        if (
          userScrolledRef.current
          && (scrollRef.current?.scrollTop ?? 0) < 200
          && !loadingMoreRef.current
          && hasMoreRef.current
        ) {
          void loadMore()
        }
        // 始终走 handleScroll：滚动条/键盘也能离底；程序贴底靠 markAuto 过滤
        autoHandleScroll()
      }, [updatePrependAnchor, computeScrollState, autoHandleScroll, loadMore, userScrolledRef])

      const onWheel = useCallback(() => {
        if (!prependLoading.current) clearPrepend()
      }, [clearPrepend])

      const onTouchStart = useCallback(() => {
        if (!prependLoading.current) clearPrepend()
      }, [clearPrepend])

      // ── Effects（parent key remount 后，这里只处理本实例生命周期） ──

      // 冷启动 / 回流：双 rAF 贴底 + 抬 overscan（对齐 oc onMount）
      useEffect(() => {
        let cancelled = false
        let outer = 0
        let inner = 0
        outer = requestAnimationFrame(() => {
          if (cancelled) return
          if (shouldAnchorBottom()) pinToBottom()
          inner = requestAnimationFrame(() => {
            if (cancelled) return
            if (renderOverscan < 15) setRenderOverscan(15)
            if (shouldAnchorBottom()) pinToBottom()
          })
        })
        return () => {
          cancelled = true
          cancelAnimationFrame(outer)
          cancelAnimationFrame(inner)
        }
        // mount-only
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      // rows 变化且应贴底时再确认一次（append / 首批消息）
      // prepend 由 anchorTo + prepend 锚点处理，这里在用户已离底时不跟
      useLayoutEffect(() => {
        if (timeline.length === 0) return
        if (!shouldAnchorBottom() || prependLoading.current) return
        pinToBottom()
      }, [timeline.length, pinToBottom])

      // retry/error 出现消失、输入框高度变 → 底部 footer 高度变，贴底时要跟着滚
      // 否则重试条进出后 scrollTop 停在旧位置，看起来没贴底
      const footerPinKey = `${retryStatus ? 'r' : ''}|${loadError || connectionError ? 'e' : ''}|${spacerHeight}`
      useLayoutEffect(() => {
        if (!shouldAnchorBottom() || prependLoading.current) return
        pinToBottom()
        // 展开重试详情等会在下一帧才量完高度
        const frame = requestAnimationFrame(() => {
          if (shouldAnchorBottom()) pinToBottom()
        })
        return () => cancelAnimationFrame(frame)
      }, [footerPinKey, pinToBottom])

      // 用户返回底部时重新贴底
      const userScrolledInit = useRef(false)
      useEffect(() => {
        if (!userScrolledInit.current) {
          userScrolledInit.current = true
          return
        }
        if (auto.userScrolled) return
        const frame = requestAnimationFrame(() => {
          autoScrollBottom()
          pinToBottom()
        })
        return () => cancelAnimationFrame(frame)
      }, [auto.userScrolled, autoScrollBottom, pinToBottom])

      // 通知父组件跟随状态变化（toBottom 按钮的显隐依据）
      // useLayoutEffect 避免新 session remount 时按钮闪烁
      useLayoutEffect(() => {
        onFollowingRef.current?.(!auto.userScrolled)
      }, [auto.userScrolled])

      // fill effect
      useEffect(() => {
        if (!sessionId || loadState !== 'loaded' || isLoadingMore || auto.userScrolled || !hasMoreHistory) return
        fill()
      }, [sessionId, loadState, isLoadingMore, auto.userScrolled, hasMoreHistory, fill])

      // unmount：snapshot 写回 cache（对齐 oc onCleanup）
      useLayoutEffect(() => {
        const key = cacheKey
        return () => {
          if (fillFrame.current !== undefined) cancelAnimationFrame(fillFrame.current)
          if (resizePinFrame.current !== undefined) cancelAnimationFrame(resizePinFrame.current)
          clearPrepend()
          if (!key) return
          sessionCache.delete(key)
          sessionCache.set(key, { measurements: virtualizer.takeSnapshot() })
          while (sessionCache.size > SESSION_CACHE_LIMIT) {
            sessionCache.delete(sessionCache.keys().next().value!)
          }
        }
      }, [cacheKey, virtualizer, clearPrepend])

      // ── 渲染数据 ──
      const items = virtualizer.getVirtualItems()
      const mountedMessageIdsKey = useMemo(
        () => items.map(item => timeline[item.index]?.key).filter(Boolean).join(','),
        [items, timeline],
      )

      // Outline 可见消息：跟随虚拟行挂载变化
      useEffect(() => {
        const root = scrollRef.current
        if (!root) return
        const visible = new Set<string>()
        const observer = new IntersectionObserver(
          entries => {
            let changed = false
            for (const entry of entries) {
              const id = entry.target.getAttribute('data-message-id')
              if (!id) continue
              if (entry.isIntersecting) {
                if (!visible.has(id)) {
                  visible.add(id)
                  changed = true
                }
              } else if (visible.has(id)) {
                visible.delete(id)
                changed = true
              }
            }
            if (changed) onVisibleIdsRef.current?.(Array.from(visible))
          },
          { root, rootMargin: '100% 0px' },
        )
        root.querySelectorAll<HTMLElement>('[data-message-id]').forEach(el => observer.observe(el))
        return () => observer.disconnect()
      }, [mountedMessageIdsKey])

      // ── 命令式接口 ──
      useImperativeHandle(ref, () => ({
        scrollToBottom: () => {
          autoForceScroll()
        },
        scrollToBottomIfAtBottom: () => {
          // 每个 SSE chunk 调用一次。userScrolled=true（用户主动操作过）时直接 return，
          // 否则贴底。不再用 prevState.bottom 做二次门控——
          // 用户手势是唯一停止信号，drift 之类不应该让 chunk 停止 pin。
          if (userScrolledRef.current) return
          pinToBottom()
        },
        scrollToLastMessage: () => {
          if (timeline.length === 0) return
          virtualizer.scrollToIndex(timeline.length - 1, { align: 'end' })
        },
        scrollToMessageIndex: (index: number) => {
          // index 仍按 visibleMessages 语义；过程折叠时映射到 timeline 行
          if (index < 0 || index >= visibleMessages.length) return
          const messageId = visibleMessages[index]?.info.id
          const timelineIndex = messageId != null
            ? (messageIdToTimelineIndex.get(messageId) ?? index)
            : index
          if (timelineIndex < 0 || timelineIndex >= timeline.length) return
          autoPause()
          virtualizer.scrollToIndex(timelineIndex, { align: 'center' })
        },
        scrollToMessageId: (messageId: string) => {
          const timelineIndex = messageIdToTimelineIndex.get(messageId)
          if (timelineIndex == null) return
          autoPause()
          virtualizer.scrollToIndex(timelineIndex, { align: 'center' })
        },
      }), [autoForceScroll, autoPause, pinToBottom, virtualizer, timeline, visibleMessages, messageIdToTimelineIndex])

      return (
        <AutoScrollProvider value={autoScrollCtxValue}>
          <div className="h-full overflow-hidden contain-strict relative">
          {loadState === 'loading' && visibleMessages.length === 0 && (
            <div className="absolute inset-0 z-10 flex items-center justify-center">
              <div className="flex flex-col items-center gap-3 text-text-400 session-loading-indicator">
                <span className="w-5 h-5 border-2 border-text-400/30 border-t-text-400 rounded-full animate-spin" />
                <span className="text-[length:var(--fs-base)]">{t('chatArea.loadingSession')}</span>
              </div>
            </div>
          )}

          <div
            ref={setScrollRoot}
            data-chat-scroll-root="true"
            className="h-full overflow-y-auto overflow-x-hidden custom-scrollbar contain-content"
            style={{
              overflowAnchor: 'none',
              paddingTop: 'calc(5rem + var(--app-safe-top, 0px))',
            }}
            onWheel={onWheel}
            onTouchStart={onTouchStart}
            onScroll={onScroll}
          >
            {visibleMessages.length > 0 && isLoadingMore && (
              <div className="flex justify-center py-3" aria-live="polite">
                <div className="flex items-center gap-2 text-text-400 text-[length:var(--fs-sm)]">
                  <span className="w-3.5 h-3.5 border-2 border-text-400/30 border-t-text-400 rounded-full animate-spin" />
                  {t('chatArea.loadingHistory')}
                </div>
              </div>
            )}

            <div ref={setVirtualContent} style={{ position: 'relative', width: '100%' }}>
              {items.map(item => {
                const timelineItem = timeline[item.index]
                if (!timelineItem) return null
                return (
                  <VirtualRow
                    key={item.key}
                    virtualItem={item}
                    item={timelineItem}
                    maxWidthClass={maxWidthClass}
                    paddingClass={paddingClass}
                    registerMessage={registerMessage}
                    onUndo={onUndo}
                    onFork={onFork}
                    canUndo={canUndo}
                    forkMap={forkMap}
                    turnDurationMap={turnDurationMap}
                    turnLatestAssistantIds={turnLatestAssistantIds}
                    allowStreamingLayoutAnimation={allowStreamingLayoutAnimation}
                    measureElement={virtualizer.measureElement as (el: HTMLElement | null) => void}
                    onEntryGrowComplete={emptyShellGate.onEntryGrowComplete}
                  />
                )
              })}
            </div>

            {/* 顺序必须是：消息 → 重试/错误提示 → 输入框占位。
                旧 Virtuoso Footer 就是这样；换 virtualizer 后 paddingEnd 在前、提示在后，会叠到输入框下。 */}
            {retryStatus && (
              <div className={`w-full ${maxWidthClass} mx-auto ${paddingClass}`}>
                <div className="flex justify-start">
                  <div className="w-full min-w-0">
                    <RetryStatusInline status={retryStatus} />
                  </div>
                </div>
              </div>
            )}

            {visibleMessages.length === 0 && (loadError || connectionError) && (
              <div className={`w-full ${maxWidthClass} mx-auto ${paddingClass}`}>
                <div className="flex justify-start">
                  <div className="w-full min-w-0 space-y-2">
                    <MessageErrorView error={loadError ?? connectionError!} />
                    {connectionError && onOpenSettings && (
                      <button
                        type="button"
                        onClick={onOpenSettings}
                        className="rounded-md border border-border-200 bg-bg-100 px-3 py-1.5 text-[length:var(--fs-sm)] text-text-200 transition-colors hover:bg-bg-200"
                      >
                        Open server settings
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div style={{ height: spacerHeight }} aria-hidden="true" />
          </div>
          </div>
        </AutoScrollProvider>
      )
    },
  ),
)
