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
  useRef,
  useImperativeHandle,
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react'
import { useVirtualizer, elementScroll, type VirtualItem } from '@tanstack/react-virtual'
import { useTranslation } from 'react-i18next'
import { MessageRenderer, ProcessCollapseBlock, messageHasFinalContent, messageHasProcessContent } from '../message'
import { MessageErrorView } from '../message/parts'
import type { SessionMessageInfo } from '../../types/api/message'
import { isAssistantMessage, isUserMessage } from '../../types/api/message'
import type { APIError } from '../../types/api/common'
import { RetryStatusInline, type RetryStatusInlineData } from './RetryStatusInline'
import { CompactionQueuedView, TurnDiffPartView } from '../message/parts'
import { QueueBubbles } from './QueueBubbles'
import type { QueuedUserPrompt, QueuedCompaction } from '../../store/inboxStore'
import {
  buildVisibleMessageEntries,
  getVisibleMessageForkTargetId,
  type VisibleMessageEntry,
} from './chatAreaVisibility'
import { AT_BOTTOM_THRESHOLD_PX } from '../../constants'
import { useChatViewport } from './chatViewport'
import {
  buildFlatTimeline,
  buildProcessTimeline,
  buildTurnDurationMap,
  buildTurnLatestAssistantIdSet,
  reuseProcessTimelineItems,
  type ProcessTimelineItem,
  type TurnDiffInfo,
} from './chatPageModel'
import { useTheme } from '../../hooks/useTheme'
import { measurePerf } from '../../utils/perfTrace'
import { createFrameSampler, reportFrameStats } from '../../utils/frameSampler'
import {
  getStreamingHotIndexes,
  getTimelineRowYClass,
  mergeVirtualRangeIndexes,
  nextPrependAdjustment,
  pickPrependAnchor,
} from './chatAreaUtils'
import {
  buildCachedSizeMap,
  estimateTimelineItemSize,
  estimateTimelineTotalHeight,
  readSessionMeasurements,
  restoreMeasurements,
  sessionCacheKey,
  writeSessionMeasurements,
} from './timelineMetrics'
import { useAutoScroll } from './virtual/useAutoScroll'
import { useEmptyWorkingShellGate } from './virtual/useEmptyWorkingShellGate'

/** 旧视图模型的 `message.isStreaming`：助手消息还没定稿 */
function isAssistantStreaming(message: SessionMessageInfo): boolean {
  return isAssistantMessage(message) && message.time.completed == null
}

/** 用户入场生长结束后，空 Working 壳再等多久（有 assistant 则立刻挂，不等） */
const EMPTY_WORKING_SHELL_EXTRA_DELAY_MS = 500
const DEFAULT_BOTTOM_SPACER = 256
const EMPTY_QUEUE: QueuedUserPrompt[] = []
const EMPTY_COMPACTIONS: QueuedCompaction[] = []

const bottomSpacerHeight = (bottomPadding: number) => (bottomPadding > 0 ? bottomPadding + 48 : DEFAULT_BOTTOM_SPACER)

// ─── 接口定义（保持不变） ───────────────────────────────────────

interface ChatAreaProps {
  messages: SessionMessageInfo[]
  visibleMessageEntries?: VisibleMessageEntry[]
  visibleMessages?: SessionMessageInfo[]
  forkTargetIdMap?: Map<string, string | undefined>
  turnDurationMap?: Map<string, number>
  turnLatestAssistantIds?: Set<string>
  sessionId?: string | null
  isStreaming?: boolean
  allowStreamingLayoutAnimation?: boolean
  loadState?: 'idle' | 'loading' | 'loaded' | 'error'
  loadError?: APIError
  connectionError?: APIError
  onOpenSettings?: () => void
  hasMoreHistory?: boolean
  onLoadMore?: () => void | Promise<void>
  onUndo?: (userMessageId: string) => void
  onFork?: (message: SessionMessageInfo, forkMessageId?: string) => void | Promise<void>
  canUndo?: boolean
  registerMessage?: (id: string, element: HTMLElement | null) => void
  retryStatus?: RetryStatusInlineData | null
  /** 下轮队列气泡（PiUI 同款：融在消息流尾部，虚拟行之后、重试提示之前） */
  queuedFollowUps?: QueuedUserPrompt[]
  /** 已入队、尚未开始的压缩（官方 CompactionQueued 行，排在队列气泡之前） */
  queuedCompactions?: QueuedCompaction[]
  /** 正在编辑的队列条目 id（该条目的「撤回编辑」切换为「取消编辑」） */
  queueEditingId?: string
  /** 队列 mutation 投影（编辑/重排期间显示期望形态，无事件落地跳变） */
  queueMutation?: import('./queueProjection').QueueMutation | null
  onQueueSteer?: (item: QueuedUserPrompt) => void
  onQueueEdit?: (item: QueuedUserPrompt) => void
  onQueueRemove?: (item: QueuedUserPrompt) => void
  /** 拖拽重排（官方 queue.reorder 同款） */
  onQueueReorder?: (ids: string[]) => void
  bottomPadding?: number
  onVisibleMessageIdsChange?: (ids: string[]) => void
  onAtBottomChange?: (atBottom: boolean) => void
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
  message: SessionMessageInfo
  registerMessage?: (id: string, element: HTMLElement | null) => void
  onUndo?: (userMessageId: string) => void
  onFork?: (message: SessionMessageInfo, forkMessageId?: string) => void | Promise<void>
  canUndo?: boolean
  forkMessageId?: string
  turnDuration?: number
  isTurnLatestAssistant?: boolean
  allowStreamingLayoutAnimation: boolean
  processContentScope?: 'all' | 'process' | 'final' | 'inline'
  /** step 完成信息是否由本实例渲染（壳内那截且壳外还有一份时传 false） */
  stepFinishVisible?: boolean
  /** 回合文件变更摘要（渲染在正文末尾、step 信息之前） */
  turnDiff?: TurnDiffInfo
  sessionId?: string | null
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
  stepFinishVisible,
  turnDiff,
  sessionId,
  onEntryGrowComplete,
}: MessageBodyProps) {
  const messageId = message.id
  const registerNode = useCallback(
    (node: HTMLDivElement | null) => {
      registerMessage?.(messageId, node)
    },
    [messageId, registerMessage],
  )
  const isUser = isUserMessage(message)
  // undo 边界：用户消息，或 v2 的独立压缩消息（revert.stage 接受任意 messageID）
  const undoable = isUser || message.type === 'compaction'
  return (
    <div
      ref={registerNode}
      data-message-id={messageId}
      data-anchor-source-id={forkMessageId ?? messageId}
    >
      <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
        <div className={`message-renderer-shell min-w-0 group ${!isUser ? 'w-full' : ''}`}>
          <MessageRenderer
            message={message}
            allowStreamingLayoutAnimation={isAssistantStreaming(message) ? allowStreamingLayoutAnimation : false}
            turnDuration={turnDuration}
            isTurnLatestAssistant={isTurnLatestAssistant}
            processContentScope={processContentScope}
            stepFinishVisible={stepFinishVisible}
            onUndo={undoable ? onUndo : undefined}
            onFork={onFork}
            forkMessageId={forkMessageId}
            canUndo={undoable ? canUndo : undefined}
            turnDiff={turnDiff}
            sessionId={sessionId}
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
  sessionId: string | null
  maxWidthClass: string
  paddingClass: string
  rowYClass: string
  registerMessage?: (id: string, element: HTMLElement | null) => void
  onUndo?: (userMessageId: string) => void
  onFork?: (message: SessionMessageInfo, forkMessageId?: string) => void | Promise<void>
  canUndo?: boolean
  forkMap: Map<string, string | undefined>
  turnDurationMap: Map<string, number>
  turnLatestAssistantIds: Set<string>
  allowStreamingLayoutAnimation: boolean
  measureElement: (el: HTMLElement | null) => void
  onEntryGrowComplete?: (messageId: string) => void
}

const VirtualRow = memo(
  function VirtualRow({
    virtualItem,
    item,
    sessionId,
    maxWidthClass,
    paddingClass,
    rowYClass,
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

    const setRef = useCallback(
      (el: HTMLDivElement | null) => {
        rowRef.current = el
        measureElement(el)
      },
      [measureElement],
    )

    useLayoutEffect(() => {
      if (rowRef.current) measureElement(rowRef.current)
    }, [measureElement, virtualItem.index, item, rowYClass])

    return (
      <div
        ref={setRef}
        data-timeline-key={item.key}
        data-index={virtualItem.index}
        style={{ position: 'absolute', top: 0, left: 0, width: '100%' }}
      >
        <div
          className={`w-full ${maxWidthClass} mx-auto ${paddingClass} ${rowYClass} transition-[max-width] duration-300 ease-in-out`}
        >
          {item.kind === 'message' ? (
            <MessageBody
              message={item.message}
              registerMessage={registerMessage}
              onUndo={onUndo}
              onFork={onFork}
              canUndo={canUndo}
              forkMessageId={forkMap.get(item.message.id)}
              turnDuration={turnDurationMap.get(item.message.id)}
              isTurnLatestAssistant={
                isAssistantMessage(item.message) ? turnLatestAssistantIds.has(item.message.id) : undefined
              }
              allowStreamingLayoutAnimation={allowStreamingLayoutAnimation}
              processContentScope={item.processContentScope ?? 'all'}
              turnDiff={item.turnDiff}
              sessionId={sessionId}
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
                      key={`${child.message.id}:${child.processContentScope}`}
                      message={child.message}
                      registerMessage={registerMessage}
                      onUndo={onUndo}
                      onFork={onFork}
                      canUndo={canUndo}
                      forkMessageId={forkMap.get(child.message.id)}
                      turnDuration={turnDurationMap.get(child.message.id)}
                      isTurnLatestAssistant={turnLatestAssistantIds.has(child.message.id)}
                      allowStreamingLayoutAnimation={allowStreamingLayoutAnimation}
                      processContentScope={child.processContentScope}
                      // 这条消息的正文还在壳外单独渲染一份 → step 完成信息由壳外那份负责
                      stepFinishVisible={item.finalMessage?.id !== child.message.id}
                    />
                  ))}
                </ProcessCollapseBlock>
                {/* shell 的 gap-2 只服务 process 壳 ↔ final 文本，子消息间距由 processBody 管 */}
                {item.finalMessage && (
                  <MessageBody
                    message={item.finalMessage}
                    registerMessage={registerMessage}
                    onUndo={onUndo}
                    onFork={onFork}
                    canUndo={canUndo}
                    forkMessageId={forkMap.get(item.finalMessage.id)}
                    turnDuration={turnDurationMap.get(item.finalMessage.id)}
                    isTurnLatestAssistant
                    allowStreamingLayoutAnimation={allowStreamingLayoutAnimation}
                    processContentScope="final"
                    turnDiff={item.turnDiff}
                    sessionId={sessionId}
                  />
                )}
                {!item.finalMessage && item.turnDiff && (
                  <TurnDiffPartView
                    sessionId={sessionId}
                    from={item.turnDiff.from}
                    files={item.turnDiff.files}
                    stateKey={`turn-diff:${item.turnDiff.from}`}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    )
  },
  (prev, next) =>
    prev.virtualItem.index === next.virtualItem.index &&
    prev.virtualItem.start === next.virtualItem.start &&
    prev.virtualItem.size === next.virtualItem.size &&
    prev.item === next.item &&
    prev.sessionId === next.sessionId &&
    prev.maxWidthClass === next.maxWidthClass &&
    prev.paddingClass === next.paddingClass &&
    prev.rowYClass === next.rowYClass &&
    prev.registerMessage === next.registerMessage &&
    prev.onUndo === next.onUndo &&
    prev.onFork === next.onFork &&
    prev.canUndo === next.canUndo &&
    prev.forkMap === next.forkMap &&
    prev.turnDurationMap === next.turnDurationMap &&
    prev.turnLatestAssistantIds === next.turnLatestAssistantIds &&
    prev.allowStreamingLayoutAnimation === next.allowStreamingLayoutAnimation &&
    prev.measureElement === next.measureElement &&
    prev.onEntryGrowComplete === next.onEntryGrowComplete,
)

// ─── ChatArea ────────────────────────────────────────────────

export const ChatArea = memo(
  forwardRef<ChatAreaHandle, ChatAreaProps>(
    (
      {
        messages,
        visibleMessages: visibleMessagesProp,
        visibleMessageEntries: visibleMessageEntriesProp,
        forkTargetIdMap: forkTargetIdMapProp,
        turnDurationMap: turnDurationMapProp,
        turnLatestAssistantIds: turnLatestAssistantIdsProp,
        sessionId,
        isStreaming = false,
        allowStreamingLayoutAnimation = false,
        loadState = 'idle',
        loadError,
        connectionError,
        onOpenSettings,
        hasMoreHistory = false,
        onLoadMore,
        onUndo,
        onFork,
        canUndo,
        registerMessage,
        retryStatus = null,
        queuedFollowUps = EMPTY_QUEUE,
        queuedCompactions = EMPTY_COMPACTIONS,
        queueEditingId,
        queueMutation,
        onQueueSteer,
        onQueueEdit,
        onQueueRemove,
        onQueueReorder,
        bottomPadding = 0,
        onVisibleMessageIdsChange,
        onAtBottomChange,
      },
      ref,
    ) => {
      const { t } = useTranslation('chat')
      const { processCollapseEnabled, showTimelineNotices, showTurnDiff } = useTheme()
      const { presentation } = useChatViewport()
      const atBottomThreshold = presentation.isCompact ? 150 : AT_BOTTOM_THRESHOLD_PX
      const paddingClass = presentation.isCompact ? 'px-3' : 'px-5'
      // 消息列宽统一引用 pane 根上的 CSS 变量（ChatPane 按 窄672/宽95%·6xl/拖拽自定义 解析），
      // 变量缺席时回落 42rem(=原 max-w-2xl)。字符串恒定，VirtualRow memo 比较不受影响
      const maxWidthClass = 'max-w-[min(100%,var(--oc-chat-column-width,42rem))]'

      // ── 派生数据 ──
      const entries = useMemo(
        () => visibleMessageEntriesProp ?? buildVisibleMessageEntries(messages, { showNotices: showTimelineNotices }),
        [messages, visibleMessageEntriesProp, showTimelineNotices],
      )
      const visibleMessages = useMemo(
        () => visibleMessagesProp ?? entries.map(e => e.message),
        [entries, visibleMessagesProp],
      )
      const forkMap = useMemo(
        () => forkTargetIdMapProp ?? new Map(entries.map(e => [e.message.id, getVisibleMessageForkTargetId(e)])),
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
        const next = measurePerf(
          'chat.timeline',
          () =>
            !processCollapseEnabled
              ? buildFlatTimeline(visibleMessages, isStreaming, showTurnDiff)
              : buildProcessTimeline(visibleMessages, {
                  turnDurationMap,
                  sessionIsStreaming: isStreaming,
                  messageHasProcess: messageHasProcessContent,
                  messageHasFinal: messageHasFinalContent,
                  isUserEntryReady: emptyShellGate.isReady,
                  turnDiff: showTurnDiff,
                }),
          4,
          `${visibleMessages.length} rows`,
        )
        const previous =
          previousTimelineRef.current.processCollapseEnabled === processCollapseEnabled
            ? previousTimelineRef.current.items
            : undefined
        const reused = reuseProcessTimelineItems(previous, next)
        previousTimelineRef.current = { processCollapseEnabled, items: reused }
        return reused
        // emptyShellGate.version：额外延迟到期后强制重算，挂上 Working 壳
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [
        processCollapseEnabled,
        visibleMessages,
        turnDurationMap,
        isStreaming,
        showTurnDiff,
        emptyShellGate.version,
        emptyShellGate.isReady,
      ])

      const messageIdToTimelineIndex = useMemo(() => {
        const map = new Map<string, number>()
        timeline.forEach((item, index) => {
          if (item.kind === 'message') {
            map.set(item.message.id, index)
            return
          }
          if (item.userMessageId) map.set(item.userMessageId, index)
          for (const child of item.children) map.set(child.message.id, index)
          if (item.finalMessage) map.set(item.finalMessage.id, index)
        })
        return map
      }, [timeline])

      // ── Refs（避免闭包过期） ──
      const scrollRef = useRef<HTMLDivElement | null>(null)
      const contentRef = useRef<HTMLDivElement | null>(null)
      /** 已写入容器的总高度，避免重复写同一个值 */
      const appliedContentHeightRef = useRef(-1)
      /**
       * 容器总高 = 全部条目之和（含未渲染条目的估算）。
       * 必须跟着尺寸/条数变化同步：只在 scrollToFn 里写会让 scrollHeight 停在旧值，
       * 贴底时算出的 max 偏小，滚动条长度也不对。
       */
      const writeContentHeight = useCallback((height: number) => {
        if (Math.abs(height - appliedContentHeightRef.current) < 0.5) return
        appliedContentHeightRef.current = height
        if (contentRef.current) contentRef.current.style.height = `${height}px`
      }, [])
      const sessionIdRef = useRef(sessionId)
      sessionIdRef.current = sessionId
      const onLoadMoreRef = useRef(onLoadMore)
      onLoadMoreRef.current = onLoadMore
      const onVisibleIdsRef = useRef(onVisibleMessageIdsChange)
      onVisibleIdsRef.current = onVisibleMessageIdsChange
      const onAtBottomRef = useRef(onAtBottomChange)
      onAtBottomRef.current = onAtBottomChange
      const hasMoreRef = useRef(hasMoreHistory)
      hasMoreRef.current = hasMoreHistory
      const loadStateRef = useRef(loadState)
      loadStateRef.current = loadState
      const thresholdRef = useRef(atBottomThreshold)
      thresholdRef.current = atBottomThreshold

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
      const autoHandleWheel = auto.handleWheel
      const autoHandleTouchStart = auto.handleTouchStart
      const autoHandleTouchMove = auto.handleTouchMove
      const autoHandleTouchEnd = auto.handleTouchEnd
      const autoHandleKeyDown = auto.handleKeyDown
      const autoHandlePointerDown = auto.handlePointerDown
      const autoHandlePointerEnd = auto.handlePointerEnd
      const autoHandleInteraction = auto.handleInteraction
      const autoForceScroll = auto.forceScrollToBottom
      const autoScrollBottom = auto.scrollToBottom
      const autoPause = auto.pause
      const autoMarkAuto = auto.markAuto
      const userScrolledRef = auto.userScrolledRef
      const spacerHeight = bottomSpacerHeight(bottomPadding)
      // 贴底判断必须读 ref：wheel→stop 后 state 还没 re-render，
      // 若仍用 state，同一帧的 ResizeObserver 会误判仍可贴底。
      const shouldAnchorBottom = () => !userScrolledRef.current

      // ── 滚动状态（同步计算，不使用 rAF） ──
      // prevState.bottom 仍是几何贴底，给 scrollToBottomIfAtBottom 用。
      // onAtBottomChange 给输入区 dock / 回底按钮：只反映 !userScrolled（用户意图），
      // 不跟 dist——流式长高那一帧 dist 会越过阈值，会把 isCollapsed 抖翻。
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
        }
      }, [])

      // 输入区折叠 / 回底按钮：只跟用户是否主动离底
      useEffect(() => {
        onAtBottomRef.current?.(!auto.userScrolled)
      }, [auto.userScrolled])

      // ── Virtualizer ──
      // parent key={sessionId} remount 后，这里只在 mount 时读一次 cache
      // cache key 必须带过程折叠模式：flat 与 process 的 item key/高度完全不同
      const cacheKey = sessionId ? sessionCacheKey(sessionId, processCollapseEnabled) : null
      const initialCacheRef = useRef(cacheKey ? readSessionMeasurements(cacheKey) : undefined)
      const cachedSizeByKey = useMemo(
        () => buildCachedSizeMap(initialCacheRef.current),
        // 只在 mount 读一次
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [],
      )
      /**
       * 视口外预渲染的高度预算，按视口高度的倍数算，而不是按行数。
       *
       * 按行数会让短消息只预渲染不到一屏、长消息预渲染好几屏；按像素才能保证
       * 用户感知到的始终是「上下各两屏已经画好了」。首帧用小预算，两帧后放大，
       * 避免冷启动一次挂太多。
       */
      const RENDER_BUFFER_RATIO = 2
      const RENDER_BUFFER_RATIO_FIRST_PAINT = 0.5
      const [renderBufferRatio, setRenderBufferRatio] = useState(RENDER_BUFFER_RATIO_FIRST_PAINT)
      /** rangeExtractor 可能在 virtualizer 赋值前就被调用，用 holder 拿测量值避免暂时性死区 */
      const measurementsHolder = useRef<Array<{ size?: number } | undefined> | null>(null)
      const resizePinnedRef = useRef<number[]>([])
      const resizePinFrame = useRef<number | undefined>(undefined)
      const resizeAnchorScheduled = useRef(false)
      /** dev：上方行从估算修正为实测的累计幅度，用来判断估算模型够不够准 */
      const sizeDriftRef = useRef({ count: 0, px: 0, lastLog: 0 })
      /** 流式热行 pin：ref 更新，不碰贴底/SSE 路径 */
      const hotPinnedRef = useRef<number[]>([])
      hotPinnedRef.current = getStreamingHotIndexes(timeline.length, isStreaming)

      // 流式期间的掉帧采样：只在 dev 里跑，结束时只在指标确实差时打一条警告
      useEffect(() => {
        if (!import.meta.env.DEV || import.meta.env.MODE === 'test' || !isStreaming) return
        const sampler = createFrameSampler()
        sampler.start()
        return () => reportFrameStats('chat.stream.jank', sampler.stop())
      }, [isStreaming])

      // 恢复上一次会话测量值时按当前 timeline 的 key 重新取：
      // 消息追加/删除后，旧快照里的绝对 start/end 已经不可信，只有 key→size 还有效。
      const initialMeasurementsCache = useMemo(
        () => restoreMeasurements(initialCacheRef.current, timeline),
        // 只在 mount 恢复一次
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [],
      )

      // 冷启动估在底部：已知 key 用真实高度，新消息用估算值重新累加。
      // 直接用缓存最后一条的 end 会在「缓存之后又来了新消息」时把初始位置算低。
      // 不用 MAX_SAFE_INTEGER（单列 range 不会向前扩，只会渲染最后一项）。
      const estimatedBottomOffset = useMemo(
        () => Math.max(0, estimateTimelineTotalHeight(timeline, cachedSizeByKey) + spacerHeight - 600),
        // 只在 mount 用初始 count 估一次
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [],
      )

      const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
        count: timeline.length,
        getScrollElement: () => scrollRef.current,
        initialOffset: estimatedBottomOffset,
        initialMeasurementsCache,
        estimateSize: index => estimateTimelineItemSize(timeline[index]),
        getItemKey: i => timeline[i]?.key ?? `removed:${i}`,
        // 关键修复：同步重测（ref / layoutEffect，无 RO entry）必须读真实 DOM 高度。
        // 库默认实现在无 entry 时回退 itemSizeCache 旧值——陈旧缓存会自我续命：
        // 行尺寸一旦被冻结（RO 错过一次变更或会话缓存恢复），后续所有同步重测
        // 都返回同一个错值，相邻虚拟行永久错位叠印，只能刷新恢复。
        measureElement: (el, entry, instance) => {
          const box = entry?.borderBoxSize?.[0]
          if (box) {
            return Math.round(instance.options.horizontal ? box.inlineSize : box.blockSize)
          }
          return instance.options.horizontal ? el.offsetWidth : el.offsetHeight
        },
        // 输入框占位放在消息区外（retry/error 之后），避免重试提示被压到输入框下面
        paddingEnd: 0,
        scrollEndThreshold: 80,
        // 预写 total height，避免浏览器把新 offset clamp 到旧高度（oc 同款）
        scrollToFn: (offset, options, instance) => {
          writeContentHeight(instance.getTotalSize())
          autoMarkAuto(scrollRef.current)
          elementScroll(offset, options, instance)
        },
        anchorTo: 'end',
        followOnAppend: false,
        overscan: 50,
        directDomUpdates: true,
        directDomUpdatesMode: 'transform',
        rangeExtractor: range => {
          // 从可见范围向两侧按估算/实测高度累加，直到覆盖预算
          const viewport = scrollRef.current?.clientHeight || 800
          const budget = viewport * renderBufferRatio
          const measurements = measurementsHolder.current

          let start = range.startIndex
          let accumulated = 0
          while (start > 0 && accumulated < budget) {
            start -= 1
            accumulated += measurements?.[start]?.size ?? 200
          }

          let end = range.endIndex
          accumulated = 0
          while (end < range.count - 1 && accumulated < budget) {
            end += 1
            accumulated += measurements?.[end]?.size ?? 200
          }

          const indexes: number[] = []
          for (let index = start; index <= end; index += 1) indexes.push(index)
          return mergeVirtualRangeIndexes(indexes, resizePinnedRef.current, hotPinnedRef.current)
        },
      })

      // 一次性 overrides（resizeItem + shouldAdjust）——对齐 oc
      measurementsHolder.current = (virtualizer as any).measurementsCache
      const overridesApplied = useRef(false)
      if (!overridesApplied.current) {
        const origResize = virtualizer.resizeItem
        virtualizer.resizeItem = (index: number, size: number) => {
          const item = (virtualizer as any).measurementsCache[index]
          const prev = item ? ((virtualizer as any).itemSizeCache.get(item.key) ?? item.size) : undefined
          const root = scrollRef.current

          // dev 诊断：只看视口上方的行——它们的尺寸修正才会引发位置补偿
          if (import.meta.env.DEV && item && prev !== undefined && root) {
            const drift = Math.abs(size - prev)
            const offset = (virtualizer as any).getScrollOffset?.() ?? 0
            if (drift > 4 && item.end <= offset) {
              const stats = sizeDriftRef.current
              stats.count += 1
              stats.px += drift
              const now = performance.now()
              if (now - stats.lastLog > 2000) {
                console.warn(`[perf] chat.rowResize count=${stats.count} px=${Math.round(stats.px)}`)
                stats.count = 0
                stats.px = 0
                stats.lastLog = now
              }
            }
          }
          if (root && prev !== undefined && Math.abs(size - prev) > root.clientHeight) {
            const view = root.getBoundingClientRect()
            const container = contentRef.current
            resizePinnedRef.current = Array.from(container?.children ?? [])
              .filter((node): node is HTMLElement => node instanceof HTMLElement && node.hasAttribute('data-index'))
              .filter(element => {
                const rect = element.getBoundingClientRect()
                return rect.bottom > view.top && rect.top < view.bottom
              })
              .map(element => Number(element.dataset.index))
            if (resizePinFrame.current !== undefined) cancelAnimationFrame(resizePinFrame.current)
            resizePinFrame.current = requestAnimationFrame(() => {
              resizePinFrame.current = requestAnimationFrame(() => {
                resizePinFrame.current = undefined
                resizePinnedRef.current = []
              })
            })
          }
          // 抑制 virtual-core resizeItem 内部 wasAtEnd 路径（applyScrollAdjustment
          // 的相对 delta 调整），两种状态都不让它生效：
          // - 用户已离底（userScrolledRef）：React commit 阶段 ref 回调触发
          //   measureElement 时 scroll 事件还没 fire，scrollOffset 是陈旧的
          //   （仍指向底部），wasAtEnd 误判为 true → 拉回底部。
          // - 跟随中：内容收缩时浏览器 clamp 若先于 RO 入账（scroll 事件经任务
          //   队列抢在同一帧 RO 投递前派发），getScrollOffset() 已是钳后值，
          //   wasAtEnd 的相对 delta 会二次叠加，把 scrollTop 拽到底部上方
          //   （概率性失贴的根源之一）。
          // 跟随贴底统一走下方 queueMicrotask 的**绝对**写底（幂等、clamp 安全）；
          // 离底时的阅读位置由 shouldAdjustScrollPositionOnItemSizeChange
          // （上方条目补偿）+ prepend 锚点负责。
          {
            const opts = (virtualizer as any).options
            const origAnchor = opts.anchorTo
            opts.anchorTo = 'start'
            origResize(index, size)
            opts.anchorTo = origAnchor
          }
          // 尺寸变了总高就变了：同步容器高度，贴底取 max 和滚动条才跟得上
          writeContentHeight(virtualizer.getTotalSize())
          // 跟随中的贴底：绝对写底，不做 isAtEnd 门槛——shouldAnchorBottom()
          // 已经表达了跟随意图，>80px 的单帧突增（图片/代码块渲染）也必须追回。
          if (root && shouldAnchorBottom() && !resizeAnchorScheduled.current) {
            resizeAnchorScheduled.current = true
            queueMicrotask(() => {
              resizeAnchorScheduled.current = false
              if (!shouldAnchorBottom()) return
              const el = scrollRef.current
              if (!el) return
              autoMarkAuto(el)
              const max = Math.max(0, el.scrollHeight - el.clientHeight)
              if (max - el.scrollTop >= 2) el.scrollTop = max
            })
          }
        }
        virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item: VirtualItem, _delta: number, instance: any) => {
          if (shouldAnchorBottom()) return false
          const offset = instance.getScrollOffset?.() ?? 0
          // 只补偿完全在视口上方的行：跨过顶边的行自身变高不会推动下面的内容
          if (item.end > offset + (instance.scrollAdjustments ?? 0)) return false
          // 首次测量（还没有缓存尺寸）无论往哪滚都要补偿——否则估算和实测的
          // 差额会一直留在那里；只有「重新测量」在向上滚时跳过，避免
          // 一圈接一圈的尺寸修正把滚动顶得一跳一跳。
          const sized = instance.itemSizeCache?.has?.(item.key) ?? false
          return !sized || instance.scrollDirection !== 'backward'
        }
        overridesApplied.current = true
      }

      // 条数/结构变化（追加、前插、切换视图）都会改变总高，先同步一次；
      // 单行尺寸变化走 resizeItem
      useLayoutEffect(() => {
        writeContentHeight(virtualizer.getTotalSize())
      }, [writeContentHeight, virtualizer, timeline])

      // ── 历史加载（prepend 锚点） ──
      const prependAnchor = useRef<{ key: string; offset: number } | undefined>(undefined)
      const prependFrame = useRef<number | undefined>(undefined)
      const prependLoading = useRef(false)

      const clearPrepend = useCallback(() => {
        prependLoading.current = false
        prependAnchor.current = undefined
        if (prependFrame.current !== undefined) {
          cancelAnimationFrame(prependFrame.current)
          prependFrame.current = undefined
        }
      }, [])

      const updatePrependAnchor = useCallback(() => {
        const root = scrollRef.current
        if (!root) return
        const view = root.getBoundingClientRect()
        // 只遍历已挂载的行（虚拟列表里就十来行），单次取最靠上的可见行
        const rows: Array<{ key?: string; top: number; bottom: number }> = []
        root.querySelectorAll<HTMLElement>('[data-timeline-key]').forEach(el => {
          const rect = el.getBoundingClientRect()
          rows.push({ key: el.dataset.timelineKey, top: rect.top, bottom: rect.bottom })
        })
        const next = pickPrependAnchor(rows, view.top, view.bottom)
        if (next) prependAnchor.current = next
      }, [])

      const applyPrependAnchor = useCallback(() => {
        const root = scrollRef.current
        if (!root || !prependAnchor.current) return
        if (prependFrame.current !== undefined) cancelAnimationFrame(prependFrame.current)

        let state = { frames: 0, stable: 0, expectedScrollTop: undefined as number | undefined }
        const apply = () => {
          prependFrame.current = undefined
          const a = prependAnchor.current
          if (!a) return

          const el = root.querySelector<HTMLElement>(`[data-timeline-key="${CSS.escape(a.key)}"]`)
          const delta = el ? el.getBoundingClientRect().top - root.getBoundingClientRect().top - a.offset : undefined
          const decision = nextPrependAdjustment(state, { scrollTop: root.scrollTop, delta })

          if (decision.delta !== 0) root.scrollTop += decision.delta
          state = { frames: decision.frames, stable: decision.stable, expectedScrollTop: root.scrollTop }

          if (decision.stop) {
            if (!prependLoading.current) prependAnchor.current = undefined
            return
          }
          prependFrame.current = requestAnimationFrame(apply)
        }
        prependFrame.current = requestAnimationFrame(apply)
      }, [])

      const capturePrepend = useCallback(() => {
        prependLoading.current = true
        updatePrependAnchor()
      }, [updatePrependAnchor])

      const restorePrepend = useCallback(
        (done: boolean) => {
          if (done) prependLoading.current = false
          applyPrependAnchor()
        },
        [applyPrependAnchor],
      )

      const loadMore = useCallback(() => {
        capturePrepend()
        setIsLoadingMore(true)
        loadingMoreRef.current = true
        Promise.resolve(onLoadMoreRef.current?.())
          .catch(() => {})
          .finally(() => {
            setIsLoadingMore(false)
            loadingMoreRef.current = false
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
      const setScrollRoot = useCallback(
        (el: HTMLDivElement | null) => {
          scrollRef.current = el
          autoSetScrollRef(el)
          if (el) {
            computeScrollState()
            fill()
          }
        },
        [autoSetScrollRef, computeScrollState, fill],
      )

      const setVirtualContent = useCallback(
        (el: HTMLDivElement | null) => {
          contentRef.current = el
          autoSetContentRef(el)
          virtualizer.containerRef(el)
          if (el && scrollRef.current) computeScrollState()
        },
        [autoSetContentRef, virtualizer, computeScrollState],
      )

      const pinToBottom = useCallback(() => {
        // 必须滚到整页底（含 retry/error + 输入框 spacer），不能只 scrollToEnd 虚拟消息区
        const el = scrollRef.current
        if (!el) return
        autoMarkAuto(el)
        const max = Math.max(0, el.scrollHeight - el.clientHeight)
        if (max - el.scrollTop >= 2) el.scrollTop = max
      }, [autoMarkAuto])

      // 流式期间每帧兜底：高度可能来自工具卡、输出文本、图片、展开面板……
      // 只靠某条 resizeItem 路径会漏；用户没离底时按绝对位置贴住，
      // 离底后立刻停手，不会把人拽回去。
      useEffect(() => {
        if (!isStreaming) return
        let frame = 0
        const tick = () => {
          const el = scrollRef.current
          // 先判断意图再读高度：用户离底后连布局都不碰。
          // 只有真的需要补位才调 pinToBottom（它内部会 markAuto + 写 scrollTop）。
          if (el && !userScrolledRef.current) {
            const max = Math.max(0, el.scrollHeight - el.clientHeight)
            if (max - el.scrollTop >= 2) pinToBottom()
          }
          frame = requestAnimationFrame(tick)
        }
        frame = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(frame)
      }, [isStreaming, pinToBottom])

      // ── 事件处理 ──
      const onScroll = useCallback(() => {
        if (prependLoading.current) updatePrependAnchor()
        computeScrollState()
        if (
          userScrolledRef.current &&
          (scrollRef.current?.scrollTop ?? 0) < 200 &&
          !loadingMoreRef.current &&
          hasMoreRef.current
        ) {
          void loadMore()
        }
        // 始终走 handleScroll：滚动条/键盘也能离底；程序贴底靠 markAuto 过滤
        autoHandleScroll()
      }, [updatePrependAnchor, computeScrollState, autoHandleScroll, loadMore, userScrolledRef])

      const onWheel = useCallback(
        (e: React.WheelEvent<HTMLDivElement>) => {
          if (!prependLoading.current) clearPrepend()
          autoHandleWheel(e.nativeEvent)
        },
        [autoHandleWheel, clearPrepend],
      )

      const onTouchStart = useCallback(
        (e: React.TouchEvent<HTMLDivElement>) => {
          if (!prependLoading.current) clearPrepend()
          autoHandleTouchStart(e.nativeEvent)
        },
        [autoHandleTouchStart, clearPrepend],
      )

      const onTouchMove = useCallback(
        (e: React.TouchEvent<HTMLDivElement>) => {
          autoHandleTouchMove(e.nativeEvent)
        },
        [autoHandleTouchMove],
      )

      const onTouchEnd = useCallback(() => {
        autoHandleTouchEnd()
      }, [autoHandleTouchEnd])

      const onKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLDivElement>) => {
          autoHandleKeyDown(e.nativeEvent)
        },
        [autoHandleKeyDown],
      )

      const onPointerDown = useCallback(
        (e: React.PointerEvent<HTMLDivElement>) => {
          autoHandlePointerDown(e.nativeEvent)
        },
        [autoHandlePointerDown],
      )

      const onPointerEnd = useCallback(
        (e: React.PointerEvent<HTMLDivElement>) => {
          autoHandlePointerEnd(e.nativeEvent)
        },
        [autoHandlePointerEnd],
      )

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
            if (renderBufferRatio < RENDER_BUFFER_RATIO) setRenderBufferRatio(RENDER_BUFFER_RATIO)
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
      const footerPinKey = `${retryStatus ? 'r' : ''}|${loadError || connectionError ? 'e' : ''}|${queuedCompactions.map(item => item.id).join('')}|${queuedFollowUps.map(item => item.id).join('')}|${spacerHeight}`
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
          writeSessionMeasurements(key, virtualizer.takeSnapshot())
        }
      }, [cacheKey, virtualizer, clearPrepend])

      // ── 渲染数据 ──
      const items = virtualizer.getVirtualItems()
      const mountedMessageIdsKey = useMemo(
        () =>
          items
            .map(item => timeline[item.index]?.key)
            .filter(Boolean)
            .join(','),
        [items, timeline],
      )

      // Outline 可见消息：observer 只建一次，虚拟范围变化时只补/撤观察目标。
      // 以前每次虚拟范围变化都新建 observer 并重新 observe 全部行，快速滚动时每帧都在重建。
      const outlineObserverRef = useRef<{
        observer: IntersectionObserver
        visible: Set<string>
        targets: Set<Element>
      } | null>(null)

      useEffect(() => {
        const root = scrollRef.current
        if (!root || typeof IntersectionObserver === 'undefined') return
        const visible = new Set<string>()
        const targets = new Set<Element>()
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
        const state = { observer, visible, targets }
        outlineObserverRef.current = state
        return () => {
          observer.disconnect()
          targets.clear()
          if (outlineObserverRef.current === state) outlineObserverRef.current = null
        }
      }, [])

      useEffect(() => {
        const state = outlineObserverRef.current
        const root = scrollRef.current
        if (!state || !root) return
        const current = new Set<Element>(root.querySelectorAll<HTMLElement>('[data-message-id]'))
        let changed = false
        for (const element of state.targets) {
          if (current.has(element)) continue
          state.observer.unobserve(element)
          state.targets.delete(element)
          const id = element.getAttribute('data-message-id')
          if (id && state.visible.delete(id)) changed = true
        }
        for (const element of current) {
          if (state.targets.has(element)) continue
          state.targets.add(element)
          state.observer.observe(element)
        }
        if (changed) onVisibleIdsRef.current?.(Array.from(state.visible))
      }, [mountedMessageIdsKey])

      // ── 命令式接口 ──
      useImperativeHandle(
        ref,
        () => ({
          scrollToBottom: () => {
            autoForceScroll()
            pinToBottom()
          },
          scrollToBottomIfAtBottom: () => {
            // userScrolled 守卫：用户上滚后 userScrolled=true，此函数由 onScrollRequest
            //（每个 SSE chunk）调用。autoForceScroll() 的 force=true 会清掉 userScrolled，
            // 导致 resizeItem 的 anchorTo toggle 失效 → wasAtEnd 恢复拉回。
            // 不在此处清 userScrolled——用户主动下滚回底时 handleWheel 会清。
            // 正常贴底跟随（userScrolled=false 时）不受影响。
            if (userScrolledRef.current) return
            if (!prevState.current.bottom) return
            autoForceScroll()
            pinToBottom()
          },
          scrollToLastMessage: () => {
            if (timeline.length === 0) return
            autoMarkAuto(scrollRef.current)
            virtualizer.scrollToIndex(timeline.length - 1, { align: 'end' })
          },
          scrollToMessageIndex: (index: number) => {
            // index 仍按 visibleMessages 语义；过程折叠时映射到 timeline 行
            if (index < 0 || index >= visibleMessages.length) return
            const messageId = visibleMessages[index]?.id
            const timelineIndex = messageId != null ? (messageIdToTimelineIndex.get(messageId) ?? index) : index
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
        }),
        [
          autoForceScroll,
          autoPause,
          autoMarkAuto,
          pinToBottom,
          virtualizer,
          timeline,
          visibleMessages,
          messageIdToTimelineIndex,
        ],
      )

      return (
        <div
          className="h-full overflow-hidden contain-strict relative"
          onPointerDownCapture={onPointerDown}
          onPointerUpCapture={onPointerEnd}
          onPointerCancelCapture={onPointerEnd}
        >
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
            onWheelCapture={onWheel}
            onTouchStartCapture={onTouchStart}
            onTouchMoveCapture={onTouchMove}
            onTouchEndCapture={onTouchEnd}
            onTouchCancelCapture={onTouchEnd}
            onKeyDownCapture={onKeyDown}
            onScroll={onScroll}
            onClick={autoHandleInteraction}
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
                    sessionId={sessionId ?? null}
                    maxWidthClass={maxWidthClass}
                    paddingClass={paddingClass}
                    rowYClass={getTimelineRowYClass(timelineItem, timeline[item.index - 1], timeline[item.index + 1])}
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

            {/* 已入队未开始的压缩：官方 CompactionQueued 行，排在待投递输入之前 */}
            {queuedCompactions.length > 0 && (
              <div className={`w-full ${maxWidthClass} mx-auto ${paddingClass}`}>
                {queuedCompactions.map(item => (
                  <CompactionQueuedView key={item.id} />
                ))}
              </div>
            )}

            {/* 队列气泡：融在消息流尾部（PiUI 同款位置：虚拟行之后、重试提示之前） */}
            {queuedFollowUps.length > 0 && (
              <div className={`w-full ${maxWidthClass} mx-auto ${paddingClass}`}>
                <QueueBubbles
                  items={queuedFollowUps}
                  editingId={queueEditingId}
                  mutation={queueMutation}
                  stateKey={sessionId ? `queue-bubbles:${sessionId}` : undefined}
                  onSteer={onQueueSteer}
                  onEdit={onQueueEdit}
                  onRemove={onQueueRemove}
                  onReorder={onQueueReorder}
                />
              </div>
            )}

            {/* 顺序必须是：消息 → 压缩排队 → 队列 → 重试/错误提示 → 输入框占位。
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
      )
    },
  ),
)
