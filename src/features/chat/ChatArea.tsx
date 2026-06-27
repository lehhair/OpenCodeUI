// ============================================
// ChatArea - 聊天消息显示区域
// ============================================
//
// 这版改成页块级虚拟化：
// - 消息按页分块，不再按 message 逐条虚拟
// - 视口附近少量页保持真实 DOM
// - 远页折叠成固定高度块，优先使用实测高度，未测量时使用保守估算
//
// 这样滚动链路里不会出现“正在眼前从假高度变真高度的 message”，
// 手感比消息级壳切换稳定得多，同时 DOM 数量也有上限。

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
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { animate } from 'motion/mini'
import { useVirtualizer } from '@tanstack/react-virtual'
import { MessageRenderer } from '../message'
import { MessageErrorView } from '../message/parts'
import { messageStore } from '../../store'
import { useTheme } from '../../hooks/useTheme'
import { useAutoScroll } from '../../hooks/useAutoScroll'
import { useScrollGestureDetector } from './useScrollGestureDetector'
import { useMobileChatPagerGestureBridge } from './useMobileChatPagerGestureBridge'
import type { Message, MessageError } from '../../types/message'
import { RetryStatusInline, type RetryStatusInlineData } from './RetryStatusInline'
import { buildVisibleMessageEntries, getVisibleMessageForkTargetId } from './chatAreaVisibility'
import { AT_BOTTOM_THRESHOLD_PX } from '../../constants'
import { useChatViewport } from './chatViewport'
import {
  buildContentKeyedChatPages,
  buildTurnDurationMap,
  computeAnchorRestoreScrollDelta,
  seedMeasuredPageHeightsFromPreviousPages,
  type ChatPage,
  type StableChatPage,
} from './chatPageModel'

const LOAD_MORE_ROOT_MARGIN = '240px 0px 0px 0px'
const LOAD_MORE_WHEEL_COOLDOWN_MS = 90
const LOAD_MORE_DEFER_MS = 100
const PENDING_SCROLL_TARGET_KEEPALIVE_MS = 900

type LoadMoreAnchorSnapshot = {
  messageId: string
  topOffset: number
  pageCountBefore: number
}

/** Stable no-op to avoid creating a new closure on every render. */
const NOOP = () => {}

function captureLoadMoreAnchor(root: HTMLElement, pageCountBefore = 0): LoadMoreAnchorSnapshot | null {
  const rootRect = root.getBoundingClientRect()
  const candidates = root.querySelectorAll<HTMLElement>('[data-message-id]')

  let best: LoadMoreAnchorSnapshot | null = null
  for (const element of candidates) {
    const messageId = element.getAttribute('data-message-id')
    if (!messageId) continue

    const rect = element.getBoundingClientRect()
    const intersectsViewport = rect.bottom > rootRect.top && rect.top < rootRect.bottom
    if (!intersectsViewport) continue

    const topOffset = rect.top - rootRect.top
    if (!best || topOffset < best.topOffset) {
      best = { messageId, topOffset, pageCountBefore }
    }
  }

  return best
}

interface ChatAreaProps {
  messages: Message[]
  pageRecords?: StableChatPage[]
  visibleMessages?: Message[]
  forkTargetIdMap?: Map<string, string | undefined>
  turnDurationMap?: Map<string, number>
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

export const ChatArea = memo(
  forwardRef<ChatAreaHandle, ChatAreaProps>(
    (
      {
        messages,
        pageRecords,
        visibleMessages: visibleMessagesProp,
        forkTargetIdMap: forkTargetIdMapProp,
        turnDurationMap: turnDurationMapProp,
        sessionId,
        isStreaming: _isStreaming = false,
        allowStreamingLayoutAnimation = true,
        loadState = 'idle',
        loadError,
        connectionError,
        onOpenSettings,
        onLoadMore,
        onUndo,
        onFork,
        canUndo,
        hasMoreHistory: _hasMoreHistory = false,
        registerMessage,
        retryStatus = null,
        onVisibleMessageIdsChange,
        onAtBottomChange,
      },
      ref,
    ) => {
      const { t } = useTranslation('chat')
      const scrollRef = useRef<HTMLDivElement>(null)
      const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null)
      const topSentinelRef = useRef<HTMLDivElement>(null)
      const isAtBottomRef = useRef(true)
      const loadMoreRef = useRef(onLoadMore)
      const isLoadingRef = useRef(false)
      const [isLoadingMore, setIsLoadingMore] = useState(false)
      const [measuredPageHeights, setMeasuredPageHeights] = useState<Record<string, number>>({})
      const [pendingScrollMessageId, setPendingScrollMessageId] = useState<string | null>(null)
      const scrollSnapshotRafRef = useRef<number | null>(null)
      const pendingLoadMoreAnchorRef = useRef<LoadMoreAnchorSnapshot | null>(null)
      const pendingLoadMoreTimerRef = useRef<number | null>(null)
      const pendingScrollClearTimerRef = useRef<number | null>(null)
      const pendingAnchorClearRafRef = useRef<number | null>(null)
      const pendingSessionResetRafRef = useRef<number | null>(null)
      const measuredPageHeightKeysRef = useRef<string[]>([])
      const previousActivePagesRef = useRef<{ sessionId?: string | null; pages: StableChatPage[] }>({ pages: [] })
      const settlingScrollMessageIdRef = useRef<string | null>(null)
      const loadMoreRequestIdRef = useRef(0)
      const topSentinelVisibleRef = useRef(false)
      const lastWheelInputAtRef = useRef(0)
      const tryLoadMoreRef = useRef<() => void>(NOOP)

      useEffect(() => {
        loadMoreRef.current = onLoadMore
      }, [onLoadMore])

      const loadMoreBlockedRef = useRef(true)

      const { isWideMode } = useTheme()
      const { presentation, interaction } = useChatViewport()
      const atBottomThreshold = AT_BOTTOM_THRESHOLD_PX
      const messagePaddingClass = presentation.isCompact ? 'px-3' : 'px-6'
      const messageMaxWidthClass = isWideMode ? 'max-w-[95%] xl:max-w-6xl' : 'max-w-2xl'
      const autoScroll = useAutoScroll({
        working: _isStreaming,
        reverse: false,
        bottomThreshold: atBottomThreshold,
        overflowAnchor: 'dynamic',
      })
      const gestureDetector = useScrollGestureDetector()
      const shouldUseExternalViewModel = pageRecords != null && visibleMessagesProp != null
      const visibleMessageEntries = useMemo(
        () => (shouldUseExternalViewModel ? [] : buildVisibleMessageEntries(messages)),
        [messages, shouldUseExternalViewModel],
      )
      const visibleMessages = useMemo(
        () => visibleMessagesProp ?? visibleMessageEntries.map(entry => entry.message),
        [visibleMessageEntries, visibleMessagesProp],
      )
      const pages = useMemo<StableChatPage[]>(
        () => (shouldUseExternalViewModel ? [] : buildContentKeyedChatPages(visibleMessages)),
        [shouldUseExternalViewModel, visibleMessages],
      )
      const localForkTargetIdMap = useMemo(
        () =>
          forkTargetIdMapProp ??
          new Map(visibleMessageEntries.map(entry => [entry.message.info.id, getVisibleMessageForkTargetId(entry)])),
        [forkTargetIdMapProp, visibleMessageEntries],
      )
      const localTurnDurationMap = useMemo(
        () => turnDurationMapProp ?? buildTurnDurationMap(messages, visibleMessages),
        [messages, turnDurationMapProp, visibleMessages],
      )

      const activePages = pageRecords ?? pages

      useLayoutEffect(() => {
        const previous = previousActivePagesRef.current
        previousActivePagesRef.current = { sessionId, pages: activePages }
        if (previous.sessionId !== sessionId || previous.pages.length === 0 || activePages.length === 0) return

        setMeasuredPageHeights(current => {
          const seeded = seedMeasuredPageHeightsFromPreviousPages({
            pages: activePages,
            previousPages: previous.pages,
            measuredPageHeights: current,
          })
          if (seeded === current) return current
          measuredPageHeightKeysRef.current = Object.keys(seeded)
          return seeded
        })
      }, [activePages, sessionId])

      // Virtualizer for page-level DOM management and scroll anchoring.
      // Each page is a virtual item. `anchorTo: 'end'` pins the bottom when
      // the last item grows (streaming). `measureElement` tracks dynamic heights.
      const pageVirtualizer = useVirtualizer({
        count: activePages.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: (index) => {
          const page = activePages[index]
          return measuredPageHeights[page.key] ?? page.estimatedHeight
        },
        getItemKey: (index) => activePages[index]?.key ?? index,
        anchorTo: 'end',
        followOnAppend: true,
        overscan: 20,
        scrollEndThreshold: atBottomThreshold,
      })

      // When an item above the viewport changes size, adjust scrollTop to keep
      // the visible content stable. Items below the viewport changing size
      // should NOT trigger any scroll adjustment. This is the core jitter fix.
      pageVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) =>
        item.end <= (instance.scrollOffset ?? 0)

      const clearPendingLoadMoreTimer = useCallback(() => {
        if (pendingLoadMoreTimerRef.current === null) return
        window.clearTimeout(pendingLoadMoreTimerRef.current)
        pendingLoadMoreTimerRef.current = null
      }, [])

      const clearPendingLoadMoreAnchorMessage = useCallback(() => {
        if (pendingAnchorClearRafRef.current !== null) cancelAnimationFrame(pendingAnchorClearRafRef.current)
        pendingAnchorClearRafRef.current = requestAnimationFrame(() => {
          pendingAnchorClearRafRef.current = null
        })
      }, [])

      const clearPendingScrollTimer = useCallback(() => {
        if (pendingScrollClearTimerRef.current === null) return
        window.clearTimeout(pendingScrollClearTimerRef.current)
        pendingScrollClearTimerRef.current = null
      }, [])

      const resetSessionViewState = useCallback(() => {
        if (pendingSessionResetRafRef.current !== null) cancelAnimationFrame(pendingSessionResetRafRef.current)
        pendingSessionResetRafRef.current = requestAnimationFrame(() => {
          pendingSessionResetRafRef.current = null
          setIsLoadingMore(false)
          measuredPageHeightKeysRef.current = []
          setMeasuredPageHeights({})
          setPendingScrollMessageId(null)
        })
      }, [])

      useEffect(() => {
        return () => {
          clearPendingLoadMoreTimer()
          clearPendingScrollTimer()
          if (scrollSnapshotRafRef.current !== null) cancelAnimationFrame(scrollSnapshotRafRef.current)
          if (pendingAnchorClearRafRef.current !== null) cancelAnimationFrame(pendingAnchorClearRafRef.current)
          if (pendingSessionResetRafRef.current !== null) cancelAnimationFrame(pendingSessionResetRafRef.current)
          if (heightBatchRafRef.current !== null) cancelAnimationFrame(heightBatchRafRef.current)
        }
      }, [clearPendingLoadMoreTimer, clearPendingScrollTimer])

      const setScrollContainerRef = useCallback((node: HTMLDivElement | null) => {
        scrollRef.current = node
        setScrollRoot(prev => (prev === node ? prev : node))
        autoScroll.scrollRef(node)
        gestureDetector.setRoot(node)
      }, [autoScroll, gestureDetector])

      useMobileChatPagerGestureBridge(
        scrollRef,
        interaction.sidebarBehavior === 'overlay',
        scrollRoot,
      )

      const setContentWrapperRef = useCallback((node: HTMLDivElement | null) => {
        autoScroll.contentRef(node)
      }, [autoScroll])

      const updateScrollOffsetSnapshot = useCallback(() => {
        const root = scrollRef.current
        if (!root) return

        if (scrollSnapshotRafRef.current !== null) cancelAnimationFrame(scrollSnapshotRafRef.current)
        scrollSnapshotRafRef.current = requestAnimationFrame(() => {
          scrollSnapshotRafRef.current = null
          // no-op: kept for forward compat (was used for premeasure direction)
        })
      }, [])

      const handleScrollContainerScroll = useCallback(() => {
        // OpenCode-style gate: only process scroll events that were triggered
        // by a recent user gesture (wheel, touch, pointer). Virtualizer-driven
        // scroll adjustments (from measureElement / anchorTo) generate scroll
        // events too — those must be ignored, otherwise handleScroll sees the
        // user "away from bottom" and calls stop(), killing auto-follow.
        if (!gestureDetector.hasGesture()) return
        autoScroll.handleScroll()
        updateScrollOffsetSnapshot()
      }, [autoScroll, gestureDetector, updateScrollOffsetSnapshot])

      const handleScrollContainerWheel = useCallback(
        (event: React.WheelEvent<HTMLDivElement>) => {
          gestureDetector.onWheel({
            deltaY: event.deltaY,
            deltaMode: event.deltaMode,
            target: event.target,
          })
          // Feed load-more cooldown (also depends on wheel, not just touch/key).
          lastWheelInputAtRef.current = Date.now()
        },
        [gestureDetector],
      )

      const handleScrollContainerPointerDown = useCallback(
        (event: React.PointerEvent<HTMLDivElement>) => {
          gestureDetector.onPointerDown({ target: event.target })
        },
        [gestureDetector],
      )

      const handleScrollContainerTouchStart = useCallback(
        (event: React.TouchEvent<HTMLDivElement>) => {
          gestureDetector.onTouchStart({ touches: event.touches })
        },
        [gestureDetector],
      )

      const handleScrollContainerTouchMove = useCallback(
        (event: React.TouchEvent<HTMLDivElement>) => {
          gestureDetector.onTouchMove({ touches: event.touches, target: event.target })
        },
        [gestureDetector],
      )

      const handleScrollContainerTouchEnd = useCallback(() => {
        gestureDetector.onTouchEnd()
      }, [gestureDetector])

      const handleScrollContainerKeyDown = useCallback(
        (event: React.KeyboardEvent<HTMLDivElement>) => {
          gestureDetector.onKeyDown({ key: event.key })
        },
        [gestureDetector],
      )

      // Sync the offset snapshot once on mount / scrollRoot change so the
      // first frame has accurate data.
      useEffect(() => {
        updateScrollOffsetSnapshot()
      }, [scrollRoot, updateScrollOffsetSnapshot])

      // Bridge `autoScroll.userScrolled` to the existing at-bottom state,
      // the legacy `isAtBottomRef` consumers, and the load-more gate.
      useEffect(() => {
        const atBottom = !autoScroll.userScrolled
        const previous = isAtBottomRef.current
        isAtBottomRef.current = atBottom
        if (previous !== atBottom) onAtBottomChange?.(atBottom)
        if (!atBottom) loadMoreBlockedRef.current = false
      }, [autoScroll.userScrolled, onAtBottomChange])

      const prevSessionIdRef = useRef(sessionId)
      useEffect(() => {
        if (sessionId === prevSessionIdRef.current) return
        prevSessionIdRef.current = sessionId
        isAtBottomRef.current = true
        loadMoreBlockedRef.current = true
        pendingLoadMoreAnchorRef.current = null
        previousActivePagesRef.current = { sessionId, pages: [] }
        clearPendingLoadMoreAnchorMessage()
        topSentinelVisibleRef.current = false
        loadMoreRequestIdRef.current += 1
        isLoadingRef.current = false
        clearPendingLoadMoreTimer()
        settlingScrollMessageIdRef.current = null
        clearPendingScrollTimer()
        resetSessionViewState()
        onAtBottomChange?.(true)
        onVisibleMessageIdsChange?.([])

        requestAnimationFrame(() => {
          const root = scrollRef.current
          if (!root) return
          root.scrollTop = root.scrollHeight
          updateScrollOffsetSnapshot()
          animate(root, { opacity: [0, 1] }, { duration: 0.2, ease: 'easeOut' })
        })
      }, [
        clearPendingLoadMoreTimer,
        clearPendingLoadMoreAnchorMessage,
        clearPendingScrollTimer,
        onAtBottomChange,
        onVisibleMessageIdsChange,
        resetSessionViewState,
        sessionId,
        updateScrollOffsetSnapshot,
        visibleMessages,
      ])

      useEffect(() => {
        if (loadState !== 'loaded') return
        requestAnimationFrame(() => {
          const root = scrollRef.current
          if (root && isAtBottomRef.current) {
            root.scrollTop = root.scrollHeight
            updateScrollOffsetSnapshot()
          }
        })
      }, [loadState, updateScrollOffsetSnapshot])

      // Core load-more logic: capture the current top-of-viewport anchor so
      // the user's scroll position doesn't shift when the new history is
      // prepended, then fire the actual `onLoadMore` callback. Returns a
      // Promise that resolves when the fetch settles (or immediately if
      // one of the no-op guards short-circuits). Shared by the
      // IntersectionObserver-driven `tryLoadMore` (which adds user-
      // engagement gates before reaching here) and the explicit
      // `loadMoreHistory` imperative handle (which bypasses them).
      const performLoadMore = useCallback((): Promise<void> => {
        const fn = loadMoreRef.current
        if (!fn) return Promise.resolve()
        const sid = sessionId
        if (!sid) return Promise.resolve()
        if (isLoadingRef.current) return Promise.resolve()

        const root = scrollRef.current
        if (root) {
          const anchor = captureLoadMoreAnchor(root, activePages.length)
          pendingLoadMoreAnchorRef.current = anchor
        }

        const requestId = ++loadMoreRequestIdRef.current
        const requestSessionId = sid
        isLoadingRef.current = true
        setIsLoadingMore(true)
        return Promise.resolve(fn()).finally(() => {
          if (loadMoreRequestIdRef.current !== requestId || sessionId !== requestSessionId) return
          isLoadingRef.current = false
          setIsLoadingMore(false)
        })
      }, [activePages.length, sessionId])

      const tryLoadMore = useCallback(() => {
        if (isLoadingRef.current) return
        if (!topSentinelVisibleRef.current) return
        if (loadMoreBlockedRef.current) return

        const fn = loadMoreRef.current
        if (!fn) return

        const sid = sessionId
        if (!sid) return
        const hasMore = messageStore.getSessionState(sid)?.hasMoreHistory ?? false
        if (!hasMore) return

        const sinceWheel = Date.now() - lastWheelInputAtRef.current
        if (sinceWheel < LOAD_MORE_WHEEL_COOLDOWN_MS) {
          clearPendingLoadMoreTimer()
          pendingLoadMoreTimerRef.current = window.setTimeout(() => {
            pendingLoadMoreTimerRef.current = null
            tryLoadMoreRef.current()
          }, LOAD_MORE_DEFER_MS)
          return
        }

        performLoadMore()
      }, [clearPendingLoadMoreTimer, performLoadMore, sessionId])

      useEffect(() => {
        tryLoadMoreRef.current = tryLoadMore
      }, [tryLoadMore])

      useEffect(() => {
        const sentinel = topSentinelRef.current
        const root = scrollRef.current
        if (!sentinel || !root) return

        const observer = new IntersectionObserver(
          ([entry]) => {
            topSentinelVisibleRef.current = entry.isIntersecting
            if (!entry.isIntersecting) {
              clearPendingLoadMoreTimer()
              return
            }
            tryLoadMore()
          },
          { root, rootMargin: LOAD_MORE_ROOT_MARGIN },
        )

        observer.observe(sentinel)
        return () => {
          observer.disconnect()
          topSentinelVisibleRef.current = false
          clearPendingLoadMoreTimer()
        }
      }, [clearPendingLoadMoreTimer, tryLoadMore, visibleMessages])

      useLayoutEffect(() => {
        const anchor = pendingLoadMoreAnchorRef.current
        const root = scrollRef.current
        if (!anchor || !root) return
        if (activePages.length <= anchor.pageCountBefore) return

        const target = root.querySelector<HTMLElement>(`[data-message-id="${anchor.messageId}"]`)
        if (!target) return

        pendingLoadMoreAnchorRef.current = null
        clearPendingLoadMoreAnchorMessage()

        const rootRect = root.getBoundingClientRect()
        const nextTopOffset = target.getBoundingClientRect().top - rootRect.top
        const delta = computeAnchorRestoreScrollDelta(anchor.topOffset, nextTopOffset)
        if (Math.abs(delta) >= 1) {
          root.scrollTop += delta
          updateScrollOffsetSnapshot()
        }
      }, [activePages, clearPendingLoadMoreAnchorMessage, updateScrollOffsetSnapshot])

      const onVisibleIdsChangeRef = useRef(onVisibleMessageIdsChange)
      useEffect(() => {
        onVisibleIdsChangeRef.current = onVisibleMessageIdsChange
      }, [onVisibleMessageIdsChange])

      useEffect(() => {
        const root = scrollRef.current
        if (!root) return

        const visibleIds = new Set<string>()
        const observer = new IntersectionObserver(
          entries => {
            let changed = false
            for (const entry of entries) {
              const id = entry.target.getAttribute('data-message-id')
              if (!id) continue
              if (entry.isIntersecting) {
                if (!visibleIds.has(id)) {
                  visibleIds.add(id)
                  changed = true
                }
              } else if (visibleIds.has(id)) {
                visibleIds.delete(id)
                changed = true
              }
            }
            if (changed) onVisibleIdsChangeRef.current?.(Array.from(visibleIds))
          },
          { root, rootMargin: '100% 0px' },
        )

        const elements = root.querySelectorAll<HTMLElement>('[data-message-id]')
        elements.forEach(element => observer.observe(element))

        return () => observer.disconnect()
      }, [activePages])

      useEffect(() => {
        if (!pendingScrollMessageId) return
        const target = scrollRef.current?.querySelector<HTMLElement>(`[data-message-id="${pendingScrollMessageId}"]`)
        if (!target) return
        if (settlingScrollMessageIdRef.current === pendingScrollMessageId) return

        settlingScrollMessageIdRef.current = pendingScrollMessageId
        target.scrollIntoView({ block: 'start', behavior: 'smooth' })
        clearPendingScrollTimer()
        pendingScrollClearTimerRef.current = window.setTimeout(() => {
          pendingScrollClearTimerRef.current = null
          if (settlingScrollMessageIdRef.current !== pendingScrollMessageId) return
          settlingScrollMessageIdRef.current = null
          setPendingScrollMessageId(current => (current === pendingScrollMessageId ? null : current))
        }, PENDING_SCROLL_TARGET_KEEPALIVE_MS)
      }, [activePages, clearPendingScrollTimer, pendingScrollMessageId])

      const scrollToBottomRef = useRef(autoScroll.scrollToBottom)
      scrollToBottomRef.current = autoScroll.scrollToBottom

      // rAF-batched height collection.  Multiple pages can grow in the same
      // frame (SmoothHeight animations, streaming tokens).  Collect all
      // pending heights and commit them once per frame so we trigger only one
      // setMeasuredPageHeights, one React render, and one scrollToBottom.
      const pendingHeightsRef = useRef<Record<string, number> | null>(null)
      const heightBatchRafRef = useRef<number | null>(null)

      const updateMeasuredPageHeight = useCallback((pageKey: string, nextHeight: number) => {
        if (nextHeight <= 0) return

        // Collect heights in a ref — no state update yet.  This avoids N
        // setMeasuredPageHeights calls and N React renders per frame.
        if (pendingHeightsRef.current === null) {
          pendingHeightsRef.current = {}
        }
        pendingHeightsRef.current[pageKey] = nextHeight

        if (heightBatchRafRef.current !== null) return // rAF already scheduled

        heightBatchRafRef.current = requestAnimationFrame(() => {
          heightBatchRafRef.current = null
          const pending = pendingHeightsRef.current
          pendingHeightsRef.current = null
          if (!pending) return

          // Commit all collected heights in a single state update.
          setMeasuredPageHeights(previous => {
            let changed = false
            const next = { ...previous }
            for (const [key, height] of Object.entries(pending)) {
              const current = previous[key] ?? null
              if (current !== null && Math.abs(current - height) < 1) continue
              next[key] = height
              changed = true
            }
            if (!changed) return previous
            measuredPageHeightKeysRef.current = Object.keys(next)
            return next
          })

          // scrollHeight already reflects the new content — scroll now so the
          // bottom stays visible.  Only one scroll per frame regardless of how
          // many pages grew.
          scrollToBottomRef.current()
        })
      }, [])

      const requestScrollToMessage = useCallback(
        (messageId: string, behavior: ScrollBehavior) => {
          const root = scrollRef.current
          if (!root) return

          const directTarget = root.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`)
          if (directTarget) {
            directTarget.scrollIntoView({ block: 'start', behavior })
            return
          }

          if (!activePages.length) return

          const targetPageIndex = activePages.findIndex(page => page.messageIds.includes(messageId))
          if (targetPageIndex === -1) return

          // Use the virtualizer to scroll to the page containing the target
          // message. The virtualizer handles scroll-position math internally.
          pageVirtualizer.scrollToIndex(targetPageIndex, { align: 'start' })
          updateScrollOffsetSnapshot()
          settlingScrollMessageIdRef.current = null
          clearPendingScrollTimer()
          setPendingScrollMessageId(messageId)
        },
        [activePages, clearPendingScrollTimer, pageVirtualizer, updateScrollOffsetSnapshot],
      )

      useImperativeHandle(
        ref,
        () => ({
          scrollToBottom: (_instant = false) => {
            // The user explicitly asked to follow the bottom again — clear
            // `userScrolled` and snap there immediately. The legacy `instant`
            // param is ignored: a "go to bottom" button shouldn't smooth-scroll
            // past the entire conversation.
            autoScroll.resume()
          },
          scrollToBottomIfAtBottom: () => {
            // SSE "scroll request" handler: only follow if the user hasn't
            // intentionally scrolled away. Gated by `userScrolled` rather than
            // a numerical `scrollTop` check — semantically the same in
            // practice, but resilient to resize-induced position drift.
            autoScroll.scrollToBottom()
          },
          scrollToLastMessage: () => {
            if (visibleMessages.length === 0) return
            requestScrollToMessage(visibleMessages[visibleMessages.length - 1].info.id, 'auto')
          },
          scrollToMessageIndex: (index: number) => {
            const message = visibleMessages[index]
            if (!message) return
            requestScrollToMessage(message.info.id, 'smooth')
          },
          scrollToMessageId: (messageId: string) => {
            requestScrollToMessage(messageId, 'smooth')
          },
        }),
        [autoScroll, requestScrollToMessage, visibleMessages],
      )

      return (
        <div className="h-full overflow-hidden contain-strict relative touch-pan-y">

          {loadState === 'loading' && visibleMessages.length === 0 && (
            <div className="absolute inset-0 z-10 flex items-center justify-center">
              <div className="flex flex-col items-center gap-3 text-text-400 session-loading-indicator">
                <span className="w-5 h-5 border-2 border-text-400/30 border-t-text-400 rounded-full animate-spin" />
                <span className="text-[length:var(--fs-base)]">{t('chatArea.loadingSession')}</span>
              </div>
            </div>
          )}

          <div
            ref={setScrollContainerRef}
            onScroll={handleScrollContainerScroll}
            onWheel={handleScrollContainerWheel}
            onPointerDown={handleScrollContainerPointerDown}
            onTouchStart={handleScrollContainerTouchStart}
            onTouchMove={handleScrollContainerTouchMove}
            onTouchEnd={handleScrollContainerTouchEnd}
            onKeyDown={handleScrollContainerKeyDown}
            tabIndex={-1}
            data-chat-scroll-root="true"
            className="h-full overflow-y-auto overflow-x-hidden custom-scrollbar contain-content flex flex-col touch-pan-y"
          >
            <div ref={topSentinelRef} className="h-px shrink-0" aria-hidden="true" />
            <div className="mobile-chat-top-spacer shrink-0" />

            {visibleMessages.length > 0 && isLoadingMore && (
              <div className="flex justify-center py-3 shrink-0">
                <div className="flex items-center gap-2 text-text-400 text-[length:var(--fs-sm)]">
                  <span className="w-3.5 h-3.5 border-2 border-text-400/30 border-t-text-400 rounded-full animate-spin" />
                  {t('chatArea.loadingHistory')}
                </div>
              </div>
            )}

            <div
              ref={setContentWrapperRef}
              onClick={autoScroll.handleInteraction}
              className="relative"
              style={{ height: `${pageVirtualizer.getTotalSize()}px` }}
            >
              {pageVirtualizer.getVirtualItems().map(virtualItem => {
                const page = activePages[virtualItem.index]
                if (!page) return null
                return (
                  <div
                    key={virtualItem.key}
                    data-index={virtualItem.index}
                    ref={pageVirtualizer.measureElement}
                    className="shrink-0"
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${virtualItem.start}px)`,
                    }}
                  >
                    <PageBlock
                      page={page}
                      messageMaxWidthClass={messageMaxWidthClass}
                      messagePaddingClass={messagePaddingClass}
                      registerMessage={registerMessage}
                      onUndo={onUndo}
                      onFork={onFork}
                      canUndo={canUndo}
                      turnDurationMap={localTurnDurationMap}
                      forkTargetIdMap={localForkTargetIdMap}
                      allowStreamingLayoutAnimation={allowStreamingLayoutAnimation}
                      onMeasuredHeightChange={updateMeasuredPageHeight}
                    />
                  </div>
                )
              })}
            </div>

            {visibleMessages.length === 0 && (loadError || connectionError) && (
              <div className={`w-full ${messageMaxWidthClass} mx-auto ${messagePaddingClass} shrink-0`}>
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

            {retryStatus && (
              <div className={`w-full ${messageMaxWidthClass} mx-auto ${messagePaddingClass} shrink-0`}>
                <div className="flex justify-start">
                  <div className="w-full min-w-0">
                    <RetryStatusInline status={retryStatus} />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )
    },
  ),
)

interface PageBlockProps {
  page: ChatPage
  messageMaxWidthClass: string
  messagePaddingClass: string
  registerMessage?: (id: string, element: HTMLElement | null) => void
  onUndo?: (userMessageId: string) => void
  onFork?: (message: Message, forkMessageId?: string) => void | Promise<void>
  canUndo?: boolean
  turnDurationMap: Map<string, number>
  forkTargetIdMap: Map<string, string | undefined>
  allowStreamingLayoutAnimation: boolean
  onMeasuredHeightChange: (pageKey: string, nextHeight: number) => void
}

function usePageHeightMeasurement(pageKey: string, onMeasuredHeightChange: (pageKey: string, nextHeight: number) => void) {
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  const measure = useCallback(() => {
    const element = wrapperRef.current
    if (!element) return
    onMeasuredHeightChange(pageKey, element.offsetHeight)
  }, [onMeasuredHeightChange, pageKey])

  useLayoutEffect(() => {
    measure()
  }, [measure])

  useEffect(() => {
    const element = wrapperRef.current
    if (!element || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [measure])

  return wrapperRef
}

const PageBlock = memo(function PageBlock({
  page,
  messageMaxWidthClass,
  messagePaddingClass,
  registerMessage,
  onUndo,
  onFork,
  canUndo,
  turnDurationMap,
  forkTargetIdMap,
  allowStreamingLayoutAnimation,
  onMeasuredHeightChange,
}: PageBlockProps) {
  const wrapperRef = usePageHeightMeasurement(page.key, onMeasuredHeightChange)

  return (
    <div ref={wrapperRef} className="shrink-0" data-page-key={page.key}>
      {page.rows.map(row => {
        const isUser = row.messages[0].info.role === 'user'
        return (
          <div
            key={row.key}
            className={`w-full ${messageMaxWidthClass} mx-auto ${messagePaddingClass} py-3 transition-[max-width] duration-300 ease-in-out`}
          >
            <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
              <div className={`min-w-0 group ${!isUser ? 'w-full' : ''} flex flex-col gap-2`}>
                {row.messages.map(message => (
                  <RenderedMessageItem key={message.info.id} messageId={message.info.id} registerMessage={registerMessage}>
                    <MessageRenderer
                      message={message}
                      allowStreamingLayoutAnimation={allowStreamingLayoutAnimation}
                      turnDuration={turnDurationMap.get(message.info.id)}
                      onUndo={onUndo}
                      onFork={onFork}
                      forkMessageId={forkTargetIdMap.get(message.info.id)}
                      canUndo={canUndo}
                      onEnsureParts={NOOP}
                    />
                  </RenderedMessageItem>
                ))}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
})

interface RenderedMessageItemProps {
  messageId: string
  registerMessage?: (id: string, element: HTMLElement | null) => void
  children: ReactNode
}

const RenderedMessageItem = memo(function RenderedMessageItem({
  messageId,
  registerMessage,
  children,
}: RenderedMessageItemProps) {
  const setElement = useCallback(
    (node: HTMLDivElement | null) => {
      registerMessage?.(messageId, node)
    },
    [messageId, registerMessage],
  )

  return (
    <div ref={setElement} data-message-id={messageId}>
      {children}
    </div>
  )
})
