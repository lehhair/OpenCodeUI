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
import { MessageRenderer } from '../message'
import { MessageErrorView } from '../message/parts'
import { messageStore } from '../../store'
import { useTheme } from '../../hooks/useTheme'
import type { Message, MessageError } from '../../types/message'
import { RetryStatusInline, type RetryStatusInlineData } from './RetryStatusInline'
import { buildVisibleMessageEntries, getVisibleMessageForkTargetId } from './chatAreaVisibility'
import { AT_BOTTOM_THRESHOLD_PX } from '../../constants'
import { useChatViewport } from './chatViewport'
import {
  buildContentKeyedChatPages,
  buildExpandedPageSelection,
  buildPageOffsets,
  buildPageRenderSegments,
  computeAnchorRestoreScrollDelta,
  computePremeasureMessageBudget,
  buildTurnDurationMap,
  computeExpandedPageRange,
  expandSelectionWithPageKeys,
  findPagesToPremeasure,
  seedMeasuredPageHeightsFromPreviousPages,
  type ChatPage,
  type PagePremeasureDirection,
  type StableChatPage,
} from './chatPageModel'

const LOAD_MORE_ROOT_MARGIN = '240px 0px 0px 0px'
const LOAD_MORE_WHEEL_COOLDOWN_MS = 90
const LOAD_MORE_DEFER_MS = 100
const PENDING_SCROLL_TARGET_KEEPALIVE_MS = 900
const SCROLL_PREMEASURE_IDLE_MS = 180
const SCROLL_PREMEASURE_FAST_DELTA_RATIO = 0.8
const SCROLL_PREMEASURE_MEDIUM_DELTA_PX = 160
const SCROLL_PREMEASURE_MAX_PAGES = 3

type LoadMoreAnchorSnapshot = {
  messageId: string
  topOffset: number
  pageCountBefore: number
}

/** Stable no-op to avoid creating a new closure on every render. */
const NOOP = () => {}

function pageHasStreamingMessage(page: ChatPage): boolean {
  return page.rows.some(row =>
    row.messages.some(
      message => message.isStreaming || (message.info.role === 'assistant' && message.info.time.completed == null),
    ),
  )
}

function pageHasUserMessage(page: ChatPage): boolean {
  return page.rows.some(row => row.messages.some(message => message.info.role === 'user'))
}

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
        bottomPadding = 0,
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
      const [scrollOffsetFromBottom, setScrollOffsetFromBottom] = useState(0)
      const [viewportHeight, setViewportHeight] = useState(0)
      const [measuredPageHeights, setMeasuredPageHeights] = useState<Record<string, number>>({})
      const [stalePageKeys, setStalePageKeys] = useState<ReadonlySet<string>>(() => new Set())
      const [pendingScrollMessageId, setPendingScrollMessageId] = useState<string | null>(null)
      const [pendingLoadMoreAnchorMessageId, setPendingLoadMoreAnchorMessageId] = useState<string | null>(null)
      const [scrollPremeasureHint, setScrollPremeasureHint] = useState<{
        direction: PagePremeasureDirection
        fast: boolean
        token: number
      } | null>(null)
      const scrollOffsetFromBottomRef = useRef(0)
      const scrollSnapshotRafRef = useRef<number | null>(null)
      const pendingLoadMoreAnchorRef = useRef<LoadMoreAnchorSnapshot | null>(null)
      const pendingLayoutAnchorRef = useRef<LoadMoreAnchorSnapshot | null>(null)
      const pendingLoadMoreTimerRef = useRef<number | null>(null)
      const pendingScrollClearTimerRef = useRef<number | null>(null)
      const scrollPremeasureIdleTimerRef = useRef<number | null>(null)
      const scrollPremeasureTokenRef = useRef(0)
      const measuredPageHeightsRef = useRef<Record<string, number>>({})
      const pendingAnchorClearRafRef = useRef<number | null>(null)
      const pendingSessionResetRafRef = useRef<number | null>(null)
      const lastScrollRootSizeRef = useRef({ width: 0, height: 0 })
      const previousActivePagesRef = useRef<{ sessionId?: string | null; pages: StableChatPage[] }>({ pages: [] })
      const lastStreamingPageKeysRef = useRef<ReadonlySet<string>>(new Set())
      const settlingScrollMessageIdRef = useRef<string | null>(null)
      const loadMoreRequestIdRef = useRef(0)
      const topSentinelVisibleRef = useRef(false)
      const lastWheelInputAtRef = useRef(0)
      const tryLoadMoreRef = useRef<() => void>(NOOP)

      useEffect(() => {
        loadMoreRef.current = onLoadMore
      }, [onLoadMore])

      useEffect(() => {
        measuredPageHeightsRef.current = measuredPageHeights
      }, [measuredPageHeights])

      const loadMoreBlockedRef = useRef(true)

      const { isWideMode } = useTheme()
      const { presentation } = useChatViewport()
      const atBottomThreshold = presentation.isCompact ? 150 : AT_BOTTOM_THRESHOLD_PX
      const messagePaddingClass = presentation.isCompact ? 'px-3' : 'px-5'
      const messageMaxWidthClass = isWideMode ? 'max-w-[95%] xl:max-w-6xl' : 'max-w-2xl'
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
          return seeded
        })
      }, [activePages, sessionId])

      const pendingTargetPageIndex = useMemo(
        () =>
          pendingScrollMessageId == null
            ? -1
            : activePages.findIndex(page => page.messageIds.includes(pendingScrollMessageId)),
        [activePages, pendingScrollMessageId],
      )

      const pendingLoadMoreAnchorPageIndex = useMemo(
        () =>
          pendingLoadMoreAnchorMessageId == null
            ? -1
            : activePages.findIndex(page => page.messageIds.includes(pendingLoadMoreAnchorMessageId)),
        [activePages, pendingLoadMoreAnchorMessageId],
      )

      const expandedPageRange = useMemo(
        () =>
          computeExpandedPageRange({
            pages: activePages,
            measuredPageHeights,
            scrollOffsetFromBottom,
            viewportHeight,
          }),
        [activePages, measuredPageHeights, scrollOffsetFromBottom, viewportHeight],
      )

      const expandedPageSelection = useMemo(
        () => buildExpandedPageSelection(expandedPageRange, [pendingTargetPageIndex, pendingLoadMoreAnchorPageIndex]),
        [expandedPageRange, pendingLoadMoreAnchorPageIndex, pendingTargetPageIndex],
      )

      const streamingPageKeys = useMemo(() => {
        const keys = new Set<string>()
        for (const page of activePages) {
          if (pageHasStreamingMessage(page)) keys.add(page.key)
        }
        return keys
      }, [activePages])

      useLayoutEffect(() => {
        lastStreamingPageKeysRef.current = streamingPageKeys
      }, [streamingPageKeys])

      const renderPageSelection = useMemo(
        () =>
          expandSelectionWithPageKeys({
            pages: activePages,
            expandedPageSelection,
            pageKeys: streamingPageKeys,
          }),
        [activePages, expandedPageSelection, streamingPageKeys],
      )

      const renderSegments = useMemo(
        () =>
          buildPageRenderSegments({
            pages: activePages,
            expandedPageSelection: renderPageSelection,
            measuredPageHeights,
          }),
        [activePages, measuredPageHeights, renderPageSelection],
      )

      const premeasurePages = useMemo(() => {
        if (activePages.length === 0) return []

        const pageIndexByKey = new Map<string, number>()
        for (let index = 0; index < activePages.length; index += 1) {
          pageIndexByKey.set(activePages[index].key, index)
        }

        const byKey = new Map<string, StableChatPage>()
        const addPage = (page: StableChatPage | undefined) => {
          if (!page) return
          const index = pageIndexByKey.get(page.key)
          if (index == null || renderPageSelection.has(index)) return
          if (measuredPageHeights[page.key] != null && !stalePageKeys.has(page.key)) return
          byKey.set(page.key, page)
        }

        if (pendingTargetPageIndex >= 0) {
          addPage(activePages[pendingTargetPageIndex])
          addPage(activePages[pendingTargetPageIndex - 1])
          addPage(activePages[pendingTargetPageIndex + 1])
        }

        if (scrollPremeasureHint) {
          const messageBudget = scrollPremeasureHint.fast
            ? computePremeasureMessageBudget(viewportHeight)
            : Math.max(1, Math.ceil(computePremeasureMessageBudget(viewportHeight) / 2))
          const pagesToPremeasure = findPagesToPremeasure({
            pages: activePages,
            expandedPageRange,
            measuredPageHeights,
            stalePageKeys,
            direction: scrollPremeasureHint.direction,
            messageBudget,
            maxPages: scrollPremeasureHint.fast ? SCROLL_PREMEASURE_MAX_PAGES : 1,
          })
          for (const page of pagesToPremeasure) addPage(page)
        }

        return Array.from(byKey.values())
      }, [
        activePages,
        expandedPageRange,
        measuredPageHeights,
        pendingTargetPageIndex,
        renderPageSelection,
        scrollPremeasureHint,
        stalePageKeys,
        viewportHeight,
      ])

      const clearPendingLoadMoreTimer = useCallback(() => {
        if (pendingLoadMoreTimerRef.current === null) return
        window.clearTimeout(pendingLoadMoreTimerRef.current)
        pendingLoadMoreTimerRef.current = null
      }, [])

      const clearPendingScrollTimer = useCallback(() => {
        if (pendingScrollClearTimerRef.current === null) return
        window.clearTimeout(pendingScrollClearTimerRef.current)
        pendingScrollClearTimerRef.current = null
      }, [])

      const clearScrollPremeasureIdleTimer = useCallback(() => {
        if (scrollPremeasureIdleTimerRef.current === null) return
        window.clearTimeout(scrollPremeasureIdleTimerRef.current)
        scrollPremeasureIdleTimerRef.current = null
      }, [])

      const clearPendingLoadMoreAnchorMessage = useCallback(() => {
        if (pendingAnchorClearRafRef.current !== null) cancelAnimationFrame(pendingAnchorClearRafRef.current)
        pendingAnchorClearRafRef.current = requestAnimationFrame(() => {
          pendingAnchorClearRafRef.current = null
          setPendingLoadMoreAnchorMessageId(null)
        })
      }, [])

      const resetSessionViewState = useCallback(() => {
        clearScrollPremeasureIdleTimer()
        scrollOffsetFromBottomRef.current = 0
        scrollPremeasureTokenRef.current += 1
        if (pendingSessionResetRafRef.current !== null) cancelAnimationFrame(pendingSessionResetRafRef.current)
        pendingSessionResetRafRef.current = requestAnimationFrame(() => {
          pendingSessionResetRafRef.current = null
          setIsLoadingMore(false)
          setScrollOffsetFromBottom(0)
          setScrollPremeasureHint(null)
          setMeasuredPageHeights({})
          measuredPageHeightsRef.current = {}
          setStalePageKeys(new Set())
          setPendingScrollMessageId(null)
        })
      }, [clearScrollPremeasureIdleTimer])

      useEffect(() => {
        return () => {
          clearPendingLoadMoreTimer()
          clearPendingScrollTimer()
          clearScrollPremeasureIdleTimer()
          if (scrollSnapshotRafRef.current !== null) cancelAnimationFrame(scrollSnapshotRafRef.current)
          if (pendingAnchorClearRafRef.current !== null) cancelAnimationFrame(pendingAnchorClearRafRef.current)
          if (pendingSessionResetRafRef.current !== null) cancelAnimationFrame(pendingSessionResetRafRef.current)
        }
      }, [clearPendingLoadMoreTimer, clearPendingScrollTimer, clearScrollPremeasureIdleTimer])

      const setScrollContainerRef = useCallback((node: HTMLDivElement | null) => {
        scrollRef.current = node
        setScrollRoot(prev => (prev === node ? prev : node))
      }, [])

      const updateScrollOffsetSnapshot = useCallback(() => {
        const root = scrollRef.current
        if (!root) return

        const nextOffset = Math.abs(root.scrollTop)
        if (scrollSnapshotRafRef.current !== null) cancelAnimationFrame(scrollSnapshotRafRef.current)
        scrollSnapshotRafRef.current = requestAnimationFrame(() => {
          scrollSnapshotRafRef.current = null
          const delta = nextOffset - scrollOffsetFromBottomRef.current
          if (Math.abs(delta) < 1) return

          scrollOffsetFromBottomRef.current = nextOffset
          const direction: PagePremeasureDirection = delta > 0 ? 'older' : 'newer'
          const fastThreshold = Math.max(SCROLL_PREMEASURE_MEDIUM_DELTA_PX, root.clientHeight * SCROLL_PREMEASURE_FAST_DELTA_RATIO)
          const fast = Math.abs(delta) >= fastThreshold
          const token = ++scrollPremeasureTokenRef.current
          clearScrollPremeasureIdleTimer()
          if (nextOffset > 1) {
            setScrollPremeasureHint({ direction, fast, token })
            scrollPremeasureIdleTimerRef.current = window.setTimeout(() => {
              scrollPremeasureIdleTimerRef.current = null
              setScrollPremeasureHint(current => (current?.token === token ? null : current))
            }, SCROLL_PREMEASURE_IDLE_MS)
          } else {
            setScrollPremeasureHint(null)
          }
          setScrollOffsetFromBottom(nextOffset)
        })
      }, [clearScrollPremeasureIdleTimer])

      useEffect(() => {
        const root = scrollRoot
        if (!root || typeof ResizeObserver === 'undefined') return

        const syncViewport = () => {
          const nextSize = { width: root.clientWidth, height: root.clientHeight }
          const previousSize = lastScrollRootSizeRef.current
          const widthChanged = Math.abs(previousSize.width - nextSize.width) >= 1
          const heightChanged = Math.abs(previousSize.height - nextSize.height) >= 1

          if (widthChanged || heightChanged) {
            lastScrollRootSizeRef.current = nextSize
          }

          if (widthChanged) {
            const measuredKeys = Object.keys(measuredPageHeightsRef.current)
            if (measuredKeys.length > 0) {
              setStalePageKeys(previous => {
                let changed = false
                const next = new Set(previous)
                for (const key of measuredKeys) {
                  if (next.has(key)) continue
                  next.add(key)
                  changed = true
                }
                return changed ? next : previous
              })
            }
          }

          setViewportHeight(prev => (Math.abs(prev - nextSize.height) < 1 ? prev : nextSize.height))
        }

        syncViewport()
        const observer = new ResizeObserver(syncViewport)
        observer.observe(root)
        return () => observer.disconnect()
      }, [scrollRoot])

      useEffect(() => {
        const root = scrollRef.current
        if (!root) return

        const onScroll = () => {
          const hasOverflow = root.scrollHeight > root.clientHeight + 1
          const distFromBottom = Math.abs(root.scrollTop)
          const atBottom = !hasOverflow || distFromBottom <= atBottomThreshold
          const previous = isAtBottomRef.current
          isAtBottomRef.current = atBottom
          if (previous !== atBottom) onAtBottomChange?.(atBottom)

          if (!atBottom) loadMoreBlockedRef.current = false
          updateScrollOffsetSnapshot()
        }

        const onWheel = () => {
          lastWheelInputAtRef.current = Date.now()
        }

        root.addEventListener('scroll', onScroll, { passive: true })
        root.addEventListener('wheel', onWheel, { passive: true })
        updateScrollOffsetSnapshot()
        return () => {
          root.removeEventListener('scroll', onScroll)
          root.removeEventListener('wheel', onWheel)
        }
      }, [atBottomThreshold, onAtBottomChange, updateScrollOffsetSnapshot])

      const prevSessionIdRef = useRef(sessionId)
      useEffect(() => {
        if (sessionId === prevSessionIdRef.current) return
        prevSessionIdRef.current = sessionId
        isAtBottomRef.current = true
        loadMoreBlockedRef.current = true
        pendingLoadMoreAnchorRef.current = null
        previousActivePagesRef.current = { sessionId, pages: [] }
        lastStreamingPageKeysRef.current = new Set()
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
          root.scrollTop = 0
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
            root.scrollTop = 0
            scrollOffsetFromBottomRef.current = 0
            clearScrollPremeasureIdleTimer()
            setScrollPremeasureHint(null)
            setScrollOffsetFromBottom(0)
            updateScrollOffsetSnapshot()
          }
        })
      }, [clearScrollPremeasureIdleTimer, loadState, updateScrollOffsetSnapshot])

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

        const root = scrollRef.current
        if (root) {
          const anchor = captureLoadMoreAnchor(root, activePages.length)
          pendingLoadMoreAnchorRef.current = anchor
          setPendingLoadMoreAnchorMessageId(anchor?.messageId ?? null)
        }

        const requestId = ++loadMoreRequestIdRef.current
        const requestSessionId = sid
        isLoadingRef.current = true
        setIsLoadingMore(true)
        Promise.resolve(fn()).finally(() => {
          if (loadMoreRequestIdRef.current !== requestId || sessionId !== requestSessionId) return
          isLoadingRef.current = false
          setIsLoadingMore(false)
        })
      }, [activePages.length, clearPendingLoadMoreTimer, sessionId])

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

      useLayoutEffect(() => {
        const anchor = pendingLayoutAnchorRef.current
        const root = scrollRef.current
        if (!anchor || !root) return

        const target = root.querySelector<HTMLElement>(`[data-message-id="${anchor.messageId}"]`)
        pendingLayoutAnchorRef.current = null
        if (!target) return

        const rootRect = root.getBoundingClientRect()
        const nextTopOffset = target.getBoundingClientRect().top - rootRect.top
        const delta = computeAnchorRestoreScrollDelta(anchor.topOffset, nextTopOffset)
        if (Math.abs(delta) >= 1) {
          root.scrollTop += delta
          updateScrollOffsetSnapshot()
        }
      }, [activePages, measuredPageHeights, renderSegments, updateScrollOffsetSnapshot])

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
      }, [activePages, expandedPageRange.endIndex, expandedPageRange.startIndex])

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
      }, [
        activePages,
        clearPendingScrollTimer,
        expandedPageRange.endIndex,
        expandedPageRange.startIndex,
        pendingScrollMessageId,
      ])

      const updateMeasuredPageHeight = useCallback((pageKey: string, nextHeight: number) => {
        if (nextHeight <= 0) return
        setMeasuredPageHeights(previous => {
          const current = previous[pageKey] ?? null
          if (current !== null && Math.abs(current - nextHeight) < 1) return previous
          const root = scrollRef.current
          if (root && !isAtBottomRef.current && (current === null || Math.abs(current - nextHeight) >= 1)) {
            pendingLayoutAnchorRef.current = captureLoadMoreAnchor(root)
          }
          const next = { ...previous, [pageKey]: nextHeight }
          measuredPageHeightsRef.current = next
          return next
        })
        setStalePageKeys(previousKeys => {
          if (!previousKeys.has(pageKey)) return previousKeys
          const nextKeys = new Set(previousKeys)
          nextKeys.delete(pageKey)
          return nextKeys
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

          const targetPageIndex = activePages.findIndex(page => page.messageIds.includes(messageId))
          if (targetPageIndex === -1) return

          settlingScrollMessageIdRef.current = null
          clearPendingScrollTimer()
          setPendingScrollMessageId(messageId)

          const targetPageKey = activePages[targetPageIndex].key
          if (measuredPageHeights[targetPageKey] == null || stalePageKeys.has(targetPageKey)) return

          const pageOffsets = buildPageOffsets(activePages, measuredPageHeights)
          root.scrollTo({ top: -pageOffsets[targetPageIndex], behavior: behavior === 'smooth' ? 'auto' : behavior })
          updateScrollOffsetSnapshot()
        },
        [activePages, clearPendingScrollTimer, measuredPageHeights, stalePageKeys, updateScrollOffsetSnapshot],
      )

      useImperativeHandle(
        ref,
        () => ({
          scrollToBottom: (instant = false) => {
            const root = scrollRef.current
            if (!root) return
            root.scrollTo({ top: 0, behavior: instant ? 'auto' : 'smooth' })
          },
          scrollToBottomIfAtBottom: () => {
            const root = scrollRef.current
            if (!root) return
            if (Math.abs(root.scrollTop) > 2) return
            root.scrollTop = 0
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
        [requestScrollToMessage, visibleMessages],
      )

      return (
        <div className="h-full overflow-hidden contain-strict relative">
          {premeasurePages.length > 0 && (
            <div
              className="absolute left-0 right-0 top-0 pointer-events-none opacity-0"
              style={{ visibility: 'hidden', contain: 'layout style paint' }}
              aria-hidden="true"
            >
              {premeasurePages.map(page => (
                <PageMeasureBlock
                  key={page.key}
                  page={page}
                  messageMaxWidthClass={messageMaxWidthClass}
                  messagePaddingClass={messagePaddingClass}
                  onUndo={onUndo}
                  onFork={onFork}
                  canUndo={canUndo}
                  turnDurationMap={localTurnDurationMap}
                  forkTargetIdMap={localForkTargetIdMap}
                  onMeasuredHeightChange={updateMeasuredPageHeight}
                />
              ))}
            </div>
          )}

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
            data-chat-scroll-root="true"
            className="h-full overflow-y-auto overflow-x-hidden custom-scrollbar contain-content flex flex-col-reverse"
          >
            <div className="flex-1" />

            <div
              className="shrink-0"
              style={{
                height: bottomPadding > 0 ? `${bottomPadding + 48}px` : '256px',
              }}
            />

            {retryStatus && (
              <div className={`w-full ${messageMaxWidthClass} mx-auto ${messagePaddingClass} shrink-0`}>
                <div className="flex justify-start">
                  <div className="w-full min-w-0">
                    <RetryStatusInline status={retryStatus} />
                  </div>
                </div>
              </div>
            )}

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

            {renderSegments.map(segment =>
              segment.kind === 'expanded' ? (
                <PageBlock
                  key={segment.key}
                  page={segment.page}
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
              ) : (
                <CollapsedPagesBlock key={segment.key} height={segment.height} />
              ),
            )}

            {visibleMessages.length > 0 && isLoadingMore && (
              <div className="flex justify-center py-3 shrink-0">
                <div className="flex items-center gap-2 text-text-400 text-[length:var(--fs-sm)]">
                  <span className="w-3.5 h-3.5 border-2 border-text-400/30 border-t-text-400 rounded-full animate-spin" />
                  {t('chatArea.loadingHistory')}
                </div>
              </div>
            )}

            <div className="mobile-chat-top-spacer shrink-0" />
            <div ref={topSentinelRef} className="h-px shrink-0" aria-hidden="true" />
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

interface PageDerivedValueProps {
  page: ChatPage
  turnDurationMap: Map<string, number>
  forkTargetIdMap: Map<string, string | undefined>
}

interface PageMeasureBlockProps {
  page: ChatPage
  messageMaxWidthClass: string
  messagePaddingClass: string
  onUndo?: (userMessageId: string) => void
  onFork?: (message: Message, forkMessageId?: string) => void | Promise<void>
  canUndo?: boolean
  turnDurationMap: Map<string, number>
  forkTargetIdMap: Map<string, string | undefined>
  onMeasuredHeightChange: (pageKey: string, nextHeight: number) => void
}

function pageMessageDerivedValuesEqual(previous: PageDerivedValueProps, next: PageDerivedValueProps) {
  return previous.page.messageIds.every(messageId => {
    return (
      previous.turnDurationMap.get(messageId) === next.turnDurationMap.get(messageId) &&
      previous.forkTargetIdMap.get(messageId) === next.forkTargetIdMap.get(messageId)
    )
  })
}

export function arePageBlockPropsEqual(previous: PageBlockProps, next: PageBlockProps) {
  if (previous.page !== next.page) return false
  if (previous.messageMaxWidthClass !== next.messageMaxWidthClass) return false
  if (previous.messagePaddingClass !== next.messagePaddingClass) return false
  if (previous.registerMessage !== next.registerMessage) return false
  if (previous.onUndo !== next.onUndo && pageHasUserMessage(next.page)) return false
  if (previous.onFork !== next.onFork) return false
  if (previous.canUndo !== next.canUndo && pageHasUserMessage(next.page)) return false
  if (
    previous.allowStreamingLayoutAnimation !== next.allowStreamingLayoutAnimation &&
    (pageHasStreamingMessage(previous.page) || pageHasStreamingMessage(next.page))
  ) {
    return false
  }
  if (previous.onMeasuredHeightChange !== next.onMeasuredHeightChange) return false
  return pageMessageDerivedValuesEqual(previous, next)
}

function usePageHeightMeasurement(
  pageKey: string,
  onMeasuredHeightChange: (pageKey: string, nextHeight: number) => void,
) {
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
                  <RenderedMessageItem
                    key={message.info.id}
                    messageId={message.info.id}
                    registerMessage={registerMessage}
                  >
                    <MessageRenderer
                      message={message}
                      allowStreamingLayoutAnimation={message.isStreaming ? allowStreamingLayoutAnimation : false}
                      turnDuration={turnDurationMap.get(message.info.id)}
                      onUndo={message.info.role === 'user' ? onUndo : undefined}
                      onFork={onFork}
                      forkMessageId={forkTargetIdMap.get(message.info.id)}
                      canUndo={message.info.role === 'user' ? canUndo : undefined}
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
}, arePageBlockPropsEqual)

const PageMeasureBlock = memo(function PageMeasureBlock({
  page,
  messageMaxWidthClass,
  messagePaddingClass,
  onUndo,
  onFork,
  canUndo,
  turnDurationMap,
  forkTargetIdMap,
  onMeasuredHeightChange,
}: PageMeasureBlockProps) {
  const wrapperRef = usePageHeightMeasurement(page.key, onMeasuredHeightChange)

  return (
    <div ref={wrapperRef} className="shrink-0" data-page-measure-key={page.key}>
      {page.rows.map(row => {
        const isUser = row.messages[0].info.role === 'user'
        return (
          <div key={row.key} className={`w-full ${messageMaxWidthClass} mx-auto ${messagePaddingClass} py-3`}>
            <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
              <div className={`min-w-0 group ${!isUser ? 'w-full' : ''} flex flex-col gap-2`}>
                {row.messages.map(message => (
                  <div key={message.info.id}>
                    <MessageRenderer
                      message={message}
                      allowStreamingLayoutAnimation={false}
                      turnDuration={turnDurationMap.get(message.info.id)}
                      onUndo={message.info.role === 'user' ? onUndo : undefined}
                      onFork={onFork}
                      forkMessageId={forkTargetIdMap.get(message.info.id)}
                      canUndo={message.info.role === 'user' ? canUndo : undefined}
                      onEnsureParts={NOOP}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
})

const CollapsedPagesBlock = memo(function CollapsedPagesBlock({ height }: { height: number }) {
  return <div className="shrink-0" style={{ height: `${height}px`, overflowAnchor: 'none' }} aria-hidden="true" />
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
