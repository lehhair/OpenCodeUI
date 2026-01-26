// ============================================
// ChatArea - 聊天消息显示区域
// ============================================

import { useRef, useImperativeHandle, forwardRef, useState, memo, useCallback } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { MessageRenderer } from '../message'
import type { Message } from '../../types/message'

interface ChatAreaProps {
  messages: Message[]
  /** 累计向前加载的消息数量，用于计算 Virtuoso 的 firstItemIndex */
  prependedCount?: number
  onLoadMore?: () => void
  onUndo?: (userMessageId: string) => void
  canUndo?: boolean
  registerMessage?: (id: string, element: HTMLElement | null) => void
}

export type ChatAreaHandle = {
  scrollToBottom: (instant?: boolean) => void
  /** 只有用户在底部时才滚动 */
  scrollToBottomIfAtBottom: () => void
  /** 滚动到最后一条消息（显示在视口上部，用于 Undo 后） */
  scrollToLastMessage: () => void
  /** 临时禁用自动滚动（用于 undo/redo） */
  suppressAutoScroll: (duration?: number) => void
}

// 检查消息是否有可见内容
function messageHasContent(msg: Message): boolean {
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
const START_INDEX = 1000000

export const ChatArea = memo(forwardRef<ChatAreaHandle, ChatAreaProps>(({ 
  messages, 
  prependedCount = 0,
  onLoadMore,
  onUndo,
  canUndo,
  registerMessage,
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
  
  // 过滤空消息
  const visibleMessages = messages.filter(messageHasContent)
  
  // 用 ref 追踪最新的消息数量，确保 useImperativeHandle 中能获取到
  const visibleMessagesCountRef = useRef(visibleMessages.length)
  visibleMessagesCountRef.current = visibleMessages.length
  
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
      // 用户正在滚动、被禁用、或不在底部时，不自动滚动
      if (isUserScrollingRef.current || suppressScrollRef.current || !isUserAtBottomRef.current) {
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
    }
  }))
  
  // followOutput: 完全禁用，改用手动控制
  // Virtuoso 的 followOutput 会在每次数据变化时触发，太频繁了
  const handleFollowOutput = useCallback(() => false, [])
  
  // 追踪用户滚动位置
  const handleAtBottomStateChange = useCallback((atBottom: boolean) => {
    isUserAtBottomRef.current = atBottom
  }, [])
  
  // 追踪用户是否正在滚动
  const handleIsScrolling = useCallback((scrolling: boolean) => {
    if (scrolling) {
      // 用户开始滚动，立即禁用自动滚动
      isUserScrollingRef.current = true
      // 清除之前的 timeout
      if (scrollingTimeoutRef.current) {
        clearTimeout(scrollingTimeoutRef.current)
        scrollingTimeoutRef.current = null
      }
    } else {
      // 滚动停止后延迟 500ms 才允许自动滚动
      // 给用户足够的缓冲时间
      scrollingTimeoutRef.current = setTimeout(() => {
        isUserScrollingRef.current = false
      }, 500)
    }
  }, [])

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
    
    return (
      <div ref={handleRef} className="w-full max-w-5xl mx-auto px-4 py-3">
        <div className={`flex ${msg.info.role === 'user' ? 'justify-end' : 'justify-start'}`}>
          <div className={`min-w-0 group ${msg.info.role === 'assistant' ? 'w-full' : ''}`}>
            <MessageRenderer 
              message={msg} 
              onUndo={onUndo}
              canUndo={canUndo}
            />
          </div>
        </div>
      </div>
    )
  }, [registerMessage, onUndo, canUndo])

  return (
    <div className="h-full overflow-hidden">
      <div 
        ref={setScrollParent} 
        className="h-full overflow-y-auto custom-scrollbar"
      >
        {scrollParent && (
          <Virtuoso
            ref={virtuosoRef}
            data={visibleMessages}
            customScrollParent={scrollParent}
            firstItemIndex={firstItemIndex}
            initialTopMostItemIndex={visibleMessages.length - 1}
            startReached={onLoadMore}
            followOutput={handleFollowOutput}
            atBottomStateChange={handleAtBottomStateChange}
            isScrolling={handleIsScrolling}
            atBottomThreshold={60}
            // 减少 prepend 时的闪烁，跳过 ResizeObserver 的 requestAnimationFrame
            // 可能产生 console 警告但能改善体验
            skipAnimationFrameInResizeObserver
            // 增加 overscan 预渲染更多内容，减少滚动时的实时渲染压力
            overscan={{ main: 500, reverse: 500 }}
            components={{
              Header: () => <div className="h-20" />,
              Footer: () => <div className="h-64" />
            }}
            itemContent={(_, msg) => renderMessage(msg)}
          />
        )}
      </div>
    </div>
  )
}))
