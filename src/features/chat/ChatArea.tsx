// ============================================
// ChatArea - 聊天消息显示区域
// ============================================

import { useRef, useImperativeHandle, forwardRef, useState, memo, useCallback, useEffect, useMemo } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { MessageRenderer } from '../message'
import { messageStore } from '../../store'
import { SpinnerIcon } from '../../components/Icons'
import type { Message } from '../../types/message'
import {
  VIRTUOSO_START_INDEX,
  SCROLL_CHECK_INTERVAL_MS,
  SCROLL_RESUME_DELAY_MS,
  AT_BOTTOM_THRESHOLD_PX,
  VIRTUOSO_OVERSCAN_PX,
  VIRTUOSO_ESTIMATED_ITEM_HEIGHT,
  MESSAGE_PREFETCH_BUFFER,
} from '../../constants'

interface ChatAreaProps {
  messages: Message[]
  /** 当前 session ID，用于检测 session 切换并触发过渡动画 */
  sessionId?: string | null
  /** 是否正在 streaming，用于定时自动滚动 */
  isStreaming?: boolean
  /** 累计向前加载的消息数量，用于计算 Virtuoso 的 firstItemIndex */
  prependedCount?: number
  /** Session 加载状态 */
  loadState?: 'idle' | 'loading' | 'loaded' | 'error'
  /** 是否还有更多历史消息可加载 */
  hasMoreHistory?: boolean
  onLoadMore?: () => void | Promise<void>
  onUndo?: (userMessageId: string) => void
  canUndo?: boolean
  registerMessage?: (id: string, element: HTMLElement | null) => void
  isWideMode?: boolean
  /** 底部留白高度（输入框实际高度），0 则用默认值 */
  bottomPadding?: number
  onVisibleMessageIdsChange?: (ids: string[]) => void
  onAtBottomChange?: (atBottom: boolean) => void
}

export type ChatAreaHandle = {
  scrollToBottom: (instant?: boolean) => void
  /** 只有用户在底部时才滚动 */
  scrollToBottomIfAtBottom: () => void
  /** 滚动到最后一条消息（显示在视口上部，用于 Undo 后） */
  scrollToLastMessage: () => void
  /** 临时禁用自动滚动（用于 undo/redo） */
  suppressAutoScroll: (duration?: number) => void
  /** 滚动到指定索引的消息（用于目录导航） */
  scrollToMessageIndex: (index: number) => void
}

// 检查消息是否有可见内容
function messageHasContent(msg: Message): boolean {
  if (msg.parts.length === 0) {
    // 有错误的 assistant 消息：中止类错误不显示，其他错误（API错误等）需要展示给用户
    if (msg.info.role === 'assistant' && 'error' in msg.info && msg.info.error) {
      return msg.info.error.name !== 'MessageAbortedError'
    }
    return true
  }
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

// 大数字作为起始索引，允许向前 prepend
const START_INDEX = VIRTUOSO_START_INDEX

export const ChatArea = memo(forwardRef<ChatAreaHandle, ChatAreaProps>(({ 
  messages, 
  sessionId,
  isStreaming = false,
  prependedCount = 0,
  loadState = 'idle',
  hasMoreHistory = false,
  onLoadMore,
  onUndo,
  canUndo,
  registerMessage,
  isWideMode = false,
  bottomPadding = 0,
  onVisibleMessageIdsChange,
  onAtBottomChange,
}, ref) => {
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  // 外部滚动容器
  const [scrollParent, setScrollParent] = useState<HTMLElement | null>(null)
  // 追踪用户是否在底部附近 - 用于决定是否自动滚动
  const isUserAtBottomRef = useRef(true)
  // 临时禁用自动滚动的标志
  const suppressScrollRef = useRef(false)
  // 用户正在滚动的标志 - 滚动期间不触发自动滚动
  const isUserScrollingRef = useRef(false)
  const scrollingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 用户在流式期间主动向上滚动 - 完全停止自动滚动，直到用户滚回底部
  const userScrolledAwayRef = useRef(false)
  // 程序触发的滚动标志 - 用于区分用户手动滚动和 scrollToIndex 触发的滚动
  const programmaticScrollRef = useRef(false)
  const programmaticScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  
  // Session 切换：追踪上一个 sessionId，用于检测切换并触发滚动+动画
  const prevSessionIdRef = useRef(sessionId)
  
  // 向上滚动加载更多历史消息的 loading 状态
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const isLoadingMoreRef = useRef(false)
  // 用户是否在列表顶部附近（用于决定是否显示加载 spinner）
  const [isNearTop, setIsNearTop] = useState(false)
  
  // 监听 scrollParent 滚动，追踪是否在顶部附近
  useEffect(() => {
    if (!scrollParent) return
    const THRESHOLD = 150
    const handleScroll = () => {
      setIsNearTop(scrollParent.scrollTop < THRESHOLD)
    }
    handleScroll() // 初始检查
    scrollParent.addEventListener('scroll', handleScroll, { passive: true })
    return () => scrollParent.removeEventListener('scroll', handleScroll)
  }, [scrollParent])
  
  // 监听用户直接交互事件（wheel/touch），确保第一时间标记用户主动滚动
  // 这比 Virtuoso 的 isScrolling 回调更及时
  useEffect(() => {
    if (!scrollParent || !isStreaming) return
    
    const markUserScrolling = () => {
      // 用户主动触发了滚动操作
      isUserScrollingRef.current = true
      // 如果不在底部，标记为滚离
      if (!isUserAtBottomRef.current) {
        userScrolledAwayRef.current = true
      }
    }
    
    scrollParent.addEventListener('wheel', markUserScrolling, { passive: true })
    scrollParent.addEventListener('touchstart', markUserScrolling, { passive: true })
    return () => {
      scrollParent.removeEventListener('wheel', markUserScrolling)
      scrollParent.removeEventListener('touchstart', markUserScrolling)
    }
  }, [scrollParent, isStreaming])
  
  // 包装 onLoadMore，追踪加载状态（带最小展示时间防止闪烁）
  const handleLoadMore = useCallback(async () => {
    if (!onLoadMore || !hasMoreHistory || isLoadingMoreRef.current) return
    isLoadingMoreRef.current = true
    setIsLoadingMore(true)
    const minDelay = new Promise(r => setTimeout(r, 400))
    try {
      await Promise.all([onLoadMore(), minDelay])
    } finally {
      isLoadingMoreRef.current = false
      setIsLoadingMore(false)
    }
  }, [onLoadMore, hasMoreHistory])
  
  // 过滤空消息（有 memo 避免每次 render 都创建新数组）
  const visibleMessages = useMemo(() => messages.filter(messageHasContent), [messages])
  
  // 用 ref 追踪最新的消息数量，确保回调和 effect 中能获取到
  const visibleMessagesCountRef = useRef(visibleMessages.length)
  visibleMessagesCountRef.current = visibleMessages.length

  // Always start at the bottom (latest message)
  const effectiveInitialIndex = Math.max(0, visibleMessages.length - 1)

  // 定时自动滚动：在 streaming 时定期检查是否需要滚动
  // 这样打字机效果导致的内容增长也会触发滚动
  useEffect(() => {
    if (!isStreaming) return
    
    const scrollInterval = setInterval(() => {
      // 如果用户正在滚动、被禁用、或用户已主动滚离底部，绝对不自动滚
      if (isUserScrollingRef.current || suppressScrollRef.current || userScrolledAwayRef.current) {
        return
      }
      
      // 只在用户确实在底部时才自动滚动
      if (!isUserAtBottomRef.current) {
        return
      }
      
      // 标记为程序触发的滚动，防止 handleIsScrolling 误判
      programmaticScrollRef.current = true
      if (programmaticScrollTimerRef.current) {
        clearTimeout(programmaticScrollTimerRef.current)
      }
      programmaticScrollTimerRef.current = setTimeout(() => {
        programmaticScrollRef.current = false
      }, 150) // 给 Virtuoso 足够时间完成滚动
      
      // 只用 Virtuoso 滚动，不强制 DOM 滚动
      virtuosoRef.current?.scrollToIndex({ 
        index: visibleMessagesCountRef.current - 1, 
        align: 'end', 
        behavior: 'auto' 
      })
    }, SCROLL_CHECK_INTERVAL_MS)
    
    return () => clearInterval(scrollInterval)
  }, [isStreaming])
  
  // 清理 timeout refs 防止内存泄漏
  useEffect(() => {
    return () => {
      if (scrollingTimeoutRef.current) {
        clearTimeout(scrollingTimeoutRef.current)
        scrollingTimeoutRef.current = null
      }
      if (programmaticScrollTimerRef.current) {
        clearTimeout(programmaticScrollTimerRef.current)
        programmaticScrollTimerRef.current = null
      }
    }
  }, [])
  
  // 流式结束时重置"用户滚离"标志，避免下次发消息时残留
  useEffect(() => {
    if (!isStreaming) {
      userScrolledAwayRef.current = false
    }
  }, [isStreaming])
  
  // Session 切换时：滚动到底部 + 触发淡入动画
  // 因为不再用 key 重新挂载 Virtuoso，需要在 sessionId 变化时主动处理
  useEffect(() => {
    if (sessionId === prevSessionIdRef.current) return
    prevSessionIdRef.current = sessionId
    
    // 触发淡入动画：移除再添加 animate-fade-in class
    if (scrollParent) {
      scrollParent.classList.remove('animate-fade-in')
      // 强制 reflow 让浏览器重新识别动画
      void scrollParent.offsetWidth
      scrollParent.classList.add('animate-fade-in')
    }
    
    // 滚动到底部 —— 使用 requestAnimationFrame 确保 Virtuoso 已处理新数据
    // 不需要 setTimeout，因为 Virtuoso 没有被重新挂载，只是数据更新了
    requestAnimationFrame(() => {
      virtuosoRef.current?.scrollToIndex({
        index: visibleMessagesCountRef.current - 1,
        align: 'end',
        behavior: 'auto',
      })
    })
  }, [sessionId, scrollParent])
  
  // firstItemIndex：基于 prependedCount 计算，确保和 messages 同步
  const firstItemIndex = START_INDEX - prependedCount

  useImperativeHandle(ref, () => ({
    scrollToBottom: (instant = false) => {
      virtuosoRef.current?.scrollToIndex({ 
        index: visibleMessages.length - 1, 
        align: 'end', 
        behavior: instant ? 'auto' : 'smooth' 
      })
    },
    scrollToBottomIfAtBottom: () => {
      // 用户正在滚动、被禁用、不在底部、或已主动滚离时，不自动滚动
      if (isUserScrollingRef.current || suppressScrollRef.current || !isUserAtBottomRef.current || userScrolledAwayRef.current) {
        return
      }
      // 使用 auto 而不是 smooth，减少和用户滚动的冲突
      virtuosoRef.current?.scrollToIndex({ 
        index: visibleMessagesCountRef.current - 1, 
        align: 'end', 
        behavior: 'auto' 
      })
    },
    scrollToLastMessage: () => {
      // 滚动到最后一条消息，显示在视口上部（用于 Undo 后）
      const count = visibleMessagesCountRef.current
      if (count > 0) {
        virtuosoRef.current?.scrollToIndex({ 
          index: count - 1, 
          align: 'start', 
          behavior: 'auto' 
        })
      }
    },
    suppressAutoScroll: (duration = 500) => {
      suppressScrollRef.current = true
      setTimeout(() => {
        suppressScrollRef.current = false
      }, duration)
    },
    scrollToMessageIndex: (index: number) => {
      if (index >= 0 && index < visibleMessagesCountRef.current) {
        // 临时禁用自动滚动，避免被拉回底部
        suppressScrollRef.current = true
        setTimeout(() => { suppressScrollRef.current = false }, 1000)
        
        virtuosoRef.current?.scrollToIndex({
          index,
          align: 'start',
          behavior: 'smooth',
        })
      }
    },
  }))
  
  // followOutput: 完全禁用，改用手动控制
  // Virtuoso 的 followOutput 会在每次数据变化时触发，太频繁了
  const handleFollowOutput = useCallback(() => false, [])
  
  // 追踪用户滚动位置
  const handleAtBottomStateChange = useCallback((atBottom: boolean) => {
    isUserAtBottomRef.current = atBottom
    // 用户滚回底部，重置"滚离"标志，恢复自动滚动
    if (atBottom) {
      userScrolledAwayRef.current = false
    }
    onAtBottomChange?.(atBottom)
  }, [onAtBottomChange])
  
  // 追踪用户是否正在滚动
  const handleIsScrolling = useCallback((scrolling: boolean) => {
    // 如果是程序触发的滚动（scrollToIndex），忽略
    if (programmaticScrollRef.current) return
    
    if (scrolling) {
      // 用户开始滚动，立即禁用自动滚动
      isUserScrollingRef.current = true
      // 如果正在流式且用户不在底部，标记为"主动滚离"
      if (isStreaming && !isUserAtBottomRef.current) {
        userScrolledAwayRef.current = true
      }
      // 清除之前的 timeout
      if (scrollingTimeoutRef.current) {
        clearTimeout(scrollingTimeoutRef.current)
        scrollingTimeoutRef.current = null
      }
    } else {
      // 滚动停止后延迟才允许自动滚动
      // 给用户足够的缓冲时间
      scrollingTimeoutRef.current = setTimeout(() => {
        isUserScrollingRef.current = false
        // 再次检查：如果滚动停止时不在底部且正在流式，确保标记滚离
        if (isStreaming && !isUserAtBottomRef.current) {
          userScrolledAwayRef.current = true
        }
      }, SCROLL_RESUME_DELAY_MS)
    }
  }, [isStreaming])

  // 消息项渲染 - 带 ref 注册
  const renderMessage = useCallback((msg: Message) => {
    const handleRef = (el: HTMLDivElement | null) => {
      if (el) {
        // 清除可能残留的动画样式
        el.style.opacity = ''
        el.style.transform = ''
        el.style.transition = ''
      }
      registerMessage?.(msg.info.id, el)
    }
    
    const maxWidthClass = isWideMode ? 'max-w-[95%] xl:max-w-6xl' : 'max-w-2xl'

    return (
      <div ref={handleRef} className={`w-full ${maxWidthClass} mx-auto px-4 py-3 transition-[max-width] duration-300 ease-in-out`}>
        <div className={`flex ${msg.info.role === 'user' ? 'justify-end' : 'justify-start'}`}>
          <div className={`min-w-0 group ${msg.info.role === 'assistant' ? 'w-full' : ''}`}>
            <MessageRenderer
              message={msg}
              onUndo={onUndo}
              canUndo={canUndo}
              onEnsureParts={(id) => {
                if (!sessionId) return
                void messageStore.hydrateMessageParts(sessionId, id)
              }}
            />
          </div>
        </div>
      </div>
    )
  }, [registerMessage, onUndo, canUndo, isWideMode, sessionId])

  // Session 正在加载且没有消息 → 显示全屏 spinner（仅在有 sessionId 时，新建对话不显示）
  const showSessionLoading = !!sessionId && loadState === 'loading' && visibleMessages.length === 0

  return (
    <div className="h-full overflow-hidden contain-strict relative">
      {/* Session 加载中的全屏居中 spinner */}
      {showSessionLoading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-text-400 animate-in fade-in duration-300">
            <SpinnerIcon size={24} className="animate-spin" />
            <span className="text-sm">Loading session...</span>
          </div>
        </div>
      )}
      {/* 向上加载历史消息的顶部 spinner：仅在有更多历史且用户停留在顶部时显示 */}
      {isLoadingMore && hasMoreHistory && isNearTop && (
        <div className="absolute top-24 left-0 right-0 z-10 flex justify-center pointer-events-none">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-bg-100/90 border border-border-200 shadow-sm text-text-400 animate-in fade-in slide-in-from-top-2 duration-200">
            <SpinnerIcon size={14} className="animate-spin" />
            <span className="text-xs">Loading...</span>
          </div>
        </div>
      )}
      <div 
        ref={setScrollParent} 
        className="h-full overflow-y-auto custom-scrollbar animate-fade-in contain-content"
      >
        {scrollParent && (
          <Virtuoso
            ref={virtuosoRef}
            data={visibleMessages}
            customScrollParent={scrollParent}
            firstItemIndex={firstItemIndex}
            initialTopMostItemIndex={effectiveInitialIndex}
            startReached={handleLoadMore}
            followOutput={handleFollowOutput}
            atBottomStateChange={handleAtBottomStateChange}
            isScrolling={handleIsScrolling}
            atBottomThreshold={AT_BOTTOM_THRESHOLD_PX}
            defaultItemHeight={VIRTUOSO_ESTIMATED_ITEM_HEIGHT}
            skipAnimationFrameInResizeObserver
            overscan={{ main: VIRTUOSO_OVERSCAN_PX, reverse: VIRTUOSO_OVERSCAN_PX }}
            components={{
              Header: () => <div className="h-20" />,
              Footer: () => (
                <div
                  style={{
                    height: bottomPadding > 0
                      ? `${bottomPadding + 16}px`
                      : '256px'
                  }}
                />
              )
            }}
            rangeChanged={(range) => {
              if (!onVisibleMessageIdsChange) return
              const start = Math.max(0, range.startIndex - MESSAGE_PREFETCH_BUFFER)
              const end = Math.min(visibleMessages.length - 1, range.endIndex + MESSAGE_PREFETCH_BUFFER)
              const ids: string[] = []
              for (let i = start; i <= end; i++) {
                const id = visibleMessages[i]?.info.id
                if (id) ids.push(id)
              }
              onVisibleMessageIdsChange(ids)
            }}
            itemContent={(_, msg) => renderMessage(msg)}
          />
        )}
      </div>
    </div>
  )
}))
