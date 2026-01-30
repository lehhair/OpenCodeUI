/**
 * SubSessionInline - 内嵌在 Task 工具区域的子会话视图
 * 
 * 特点：
 * - 与 ContentBlock 统一的视觉风格
 * - 可折叠的消息区域
 * - 固定高度可滚动
 * - 底部有输入框可直接交互
 */

import { useCallback, useRef, useEffect, memo, useState } from 'react'
import { useSessionState, messageStore, childSessionStore } from '../../../store'
import { sendMessage, abortSession, getSessionMessages } from '../../../api'
import { ChevronDownIcon } from '../../../components/Icons'
import { sessionErrorHandler } from '../../../utils'
import type { Message, TextPart, ToolPart } from '../../../types/message'

interface SubSessionInlineProps {
  sessionId: string
}

export const SubSessionInline = memo(function SubSessionInline({ sessionId }: SubSessionInlineProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const loadedRef = useRef(false)
  const [collapsed, setCollapsed] = useState(false)
  
  // 获取 session 数据
  const sessionState = useSessionState(sessionId)
  const messages = sessionState?.messages || []
  const isStreaming = sessionState?.isStreaming || false
  const isLoading = sessionState?.loadState === 'loading'
  
  // 轻量级加载 - 不影响 currentSessionId
  useEffect(() => {
    if (loadedRef.current) return
    
    const state = messageStore.getSessionState(sessionId)
    // 如果已有消息或正在 streaming，不需要加载
    if (state && (state.messages.length > 0 || state.isStreaming)) {
      loadedRef.current = true
      return
    }
    
    loadedRef.current = true
    messageStore.setLoadState(sessionId, 'loading')
    
    getSessionMessages(sessionId, 20)
      .then(apiMessages => {
        // 检查是否有 SSE 推送的更新数据
        const currentState = messageStore.getSessionState(sessionId)
        if (currentState && currentState.messages.length > apiMessages.length) {
          messageStore.setLoadState(sessionId, 'loaded')
          return
        }
        messageStore.setMessages(sessionId, apiMessages, {
          directory: '',
          hasMoreHistory: apiMessages.length >= 20,
        })
      })
      .catch(err => {
        sessionErrorHandler('load sub-session', err)
        messageStore.setLoadState(sessionId, 'error')
      })
  }, [sessionId])

  // 发送消息
  const handleSendMessage = useCallback(async (text: string) => {
    if (!text.trim()) return
    
    messageStore.truncateAfterRevert(sessionId)
    messageStore.setStreaming(sessionId, true)
    
    try {
      const lastMsg = [...messages].reverse().find(m => 'model' in m.info || 'modelID' in m.info)
      const lastInfo = lastMsg?.info as any
      const model = lastInfo?.model || (lastInfo?.modelID 
        ? { providerID: lastInfo.providerID, modelID: lastInfo.modelID } 
        : { providerID: 'openai', modelID: 'gpt-4o' })
      
      await sendMessage({
        sessionId,
        text,
        attachments: [],
        model
      })
    } catch (error) {
      sessionErrorHandler('send to sub-session', error)
      messageStore.setStreaming(sessionId, false)
    }
  }, [sessionId, messages])

  const handleStop = useCallback(() => {
    // 获取父 session 的 directory
    const childInfo = childSessionStore.getSessionInfo(sessionId)
    const parentSessionId = childInfo?.parentID || messageStore.getCurrentSessionId()
    const parentState = parentSessionId ? messageStore.getSessionState(parentSessionId) : null
    const directory = parentState?.directory || ''
    
    abortSession(sessionId, directory)
  }, [sessionId])

  // 在新标签页打开
  const handleOpenInNewTab = useCallback((e: React.MouseEvent) => {
    e.stopPropagation() // 防止触发折叠
    
    // 获取父 session 的 directory
    const childInfo = childSessionStore.getSessionInfo(sessionId)
    const parentSessionId = childInfo?.parentID || messageStore.getCurrentSessionId()
    const parentState = parentSessionId ? messageStore.getSessionState(parentSessionId) : null
    const directory = parentState?.directory || ''
    
    // 构造 URL，包含 directory 参数
    const baseUrl = `${window.location.origin}${window.location.pathname}#/session/${sessionId}`
    const url = directory ? `${baseUrl}?dir=${directory}` : baseUrl
    window.open(url, '_blank')
  }, [sessionId])

  // 自动滚动到底部
  useEffect(() => {
    if (scrollRef.current && isStreaming) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, isStreaming])

  // 过滤有内容的消息
  const visibleMessages = messages.filter((msg: Message) => 
    msg.parts.some((part: Message['parts'][0]) => {
      if (part.type === 'text') return (part as TextPart).text?.trim()
      if (part.type === 'tool') return true
      if (part.type === 'reasoning') return true
      return false
    })
  )
  
  // 统计信息
  const msgCount = visibleMessages.length
  const hasContent = msgCount > 0 || isLoading

  return (
    <div className="border border-border-200/50 rounded-lg overflow-hidden bg-bg-100 text-xs">
      {/* Header - 与 ContentBlock 统一的样式 */}
      <div
        className="flex items-center justify-between px-3 py-1.5 bg-bg-200/50 hover:bg-bg-200 cursor-pointer select-none transition-colors"
        onClick={() => hasContent && setCollapsed(!collapsed)}
      >
        <div className="flex items-center gap-2 min-w-0">
          {hasContent && (
            <span className={`transition-transform duration-200 text-text-400 ${collapsed ? '' : 'rotate-180'}`}>
              <ChevronDownIcon />
            </span>
          )}
          <span className="font-medium font-mono text-text-300">
            Sub-session
          </span>
          
          {/* Status indicator */}
          {isLoading ? (
            <div className="flex items-center gap-1.5 text-text-400">
              <div className="w-3 h-3 border-2 border-accent-main-100/30 border-t-accent-main-100 rounded-full animate-spin" />
              <span>Loading...</span>
            </div>
          ) : isStreaming ? (
            <div className="flex items-center gap-1.5 text-accent-main-100">
              <div className="w-1.5 h-1.5 rounded-full bg-accent-main-100 animate-pulse" />
              <span>Running...</span>
            </div>
          ) : (
            <span className="text-text-500">{msgCount} messages</span>
          )}
        </div>
        
        <div className="flex items-center gap-3 font-mono">
          {/* Open in new tab button */}
          <button
            onClick={handleOpenInNewTab}
            className="flex items-center gap-1 text-text-400 hover:text-accent-main-100 transition-colors"
          >
            <ExternalLinkIcon className="w-3 h-3" />
            <span>Open</span>
          </button>
        </div>
      </div>

      {/* Body - 使用 grid 实现平滑展开动画 */}
      <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${
        hasContent && !collapsed ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
      }`}>
        <div className="overflow-hidden">
          {/* Messages Area */}
          <div 
            ref={scrollRef}
            className="overflow-y-auto custom-scrollbar p-2 space-y-1.5 bg-bg-000/50"
            style={{ maxHeight: '200px' }}
          >
            {isLoading && messages.length === 0 ? (
              <div className="px-3 py-3 space-y-2">
                <div className="h-3 bg-bg-300/50 rounded animate-pulse w-3/4" />
                <div className="h-3 bg-bg-300/50 rounded animate-pulse w-1/2" />
              </div>
            ) : visibleMessages.length === 0 ? (
              <div className="flex items-center justify-center h-16 text-text-500">
                No messages yet
              </div>
            ) : (
              visibleMessages.map((msg: Message) => (
                <CompactMessage key={msg.info.id} message={msg} />
              ))
            )}
          </div>

          {/* Input Area */}
          <div className="border-t border-border-200/30 p-2 bg-bg-100/50">
            <CompactInput 
              onSend={handleSendMessage}
              onStop={handleStop}
              isStreaming={isStreaming}
              disabled={isLoading}
            />
          </div>
        </div>
      </div>
    </div>
  )
})

// ============================================
// Compact Message
// ============================================

function CompactMessage({ message }: { message: Message }) {
  const { info, parts } = message
  const isUser = info.role === 'user'
  
  // 提取文本内容
  const textParts = parts.filter((p): p is TextPart => p.type === 'text' && !!p.text?.trim())
  const toolParts = parts.filter((p): p is ToolPart => p.type === 'tool')
  
  const textContent = textParts.map(p => p.text).join('\n').trim()
  
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[90%] px-2.5 py-1.5 rounded-lg text-[11px] leading-relaxed ${
        isUser 
          ? 'bg-bg-300 text-text-100' 
          : 'bg-bg-100 text-text-200 border border-border-200/30'
      }`}>
        {textContent ? (
          <p className="whitespace-pre-wrap break-words">{textContent}</p>
        ) : toolParts.length > 0 ? (
          <p className="text-text-400 italic">
            {toolParts.length} tool{toolParts.length > 1 ? 's' : ''}: {toolParts.map(t => t.tool).join(', ')}
          </p>
        ) : (
          <p className="text-text-500 italic">...</p>
        )}
      </div>
    </div>
  )
}

// ============================================
// Compact Input
// ============================================

interface CompactInputProps {
  onSend: (text: string) => void
  onStop: () => void
  isStreaming: boolean
  disabled?: boolean
}

function CompactInput({ onSend, onStop, isStreaming, disabled }: CompactInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!inputRef.current || isStreaming || disabled) return
    
    const text = inputRef.current.value.trim()
    if (text) {
      onSend(text)
      inputRef.current.value = ''
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
      <input
        ref={inputRef}
        type="text"
        placeholder={isStreaming ? 'Waiting...' : 'Send a message...'}
        disabled={isStreaming || disabled}
        onKeyDown={handleKeyDown}
        className="flex-1 px-2.5 py-1.5 text-[11px] bg-bg-000 border border-border-200/50 rounded-md text-text-100 placeholder:text-text-500 focus:outline-none focus:border-accent-main-100/50 disabled:opacity-50"
      />
      {isStreaming ? (
        <button
          type="button"
          onClick={onStop}
          className="px-2 py-1 text-[10px] font-medium text-danger-100 hover:bg-danger-100/10 rounded transition-colors"
        >
          Stop
        </button>
      ) : (
        <button
          type="submit"
          disabled={disabled}
          className="px-2 py-1 text-[10px] font-medium text-accent-main-100 hover:bg-accent-main-100/10 rounded transition-colors disabled:opacity-50"
        >
          Send
        </button>
      )}
    </form>
  )
}

// ============================================
// Icons
// ============================================

function ExternalLinkIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  )
}
