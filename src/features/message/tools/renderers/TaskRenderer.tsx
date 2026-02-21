import { memo, useState, useCallback, useRef, useEffect } from 'react'
import { ContentBlock } from '../../../../components'
import { ChevronRightIcon, ExternalLinkIcon, StopIcon } from '../../../../components/Icons'
import { useDelayedRender } from '../../../../hooks'
import { useChildSessions, useSessionState, messageStore, childSessionStore } from '../../../../store'
import { abortSession, getSessionMessages } from '../../../../api'
import { sessionErrorHandler } from '../../../../utils'
import type { ToolRendererProps } from '../types'
import type { Message, TextPart, ToolPart } from '../../../../types/message'

// ============================================
// Task Tool Renderer (子 agent)
// 
// 设计原则：
// 1. 渐进式展开 - 默认显示摘要，点击展开详情
// 2. 扁平布局 - 避免额外缩进，提升有效宽度
// 3. 状态优先 - 运行中/完成/错误状态一目了然
// 4. 按需交互 - 输入框只在需要时显示
// ============================================

export const TaskRenderer = memo(function TaskRenderer({ part }: ToolRendererProps) {
  const { state } = part
  const [expanded, setExpanded] = useState(() => 
    state.status === 'running' || state.status === 'pending'
  )
  const shouldRenderBody = useDelayedRender(expanded)
  
  // 从 input 中提取任务信息
  const input = state.input as Record<string, unknown> | undefined
  const description = input?.description as string || 'Subtask'
  const prompt = input?.prompt as string || ''
  const agentType = input?.subagent_type as string || 'general'
  
  // 获取子 session ID
  const metadata = state.metadata as Record<string, unknown> | undefined
  const metadataSessionId = metadata?.sessionId as string | undefined
  
  const childSessions = useChildSessions(part.sessionID)
  const storeChildSession = childSessions.length > 0 
    ? childSessions.sort((a, b) => b.createdAt - a.createdAt)[0]
    : null
    
  const targetSessionId = metadataSessionId || storeChildSession?.id
  
  const isRunning = state.status === 'running' || state.status === 'pending'
  const isCompleted = state.status === 'completed'
  const isError = state.status === 'error'

  // Stop handler
  const handleStop = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (!targetSessionId) return
    const childInfo = childSessionStore.getSessionInfo(targetSessionId)
    const parentSessionId = childInfo?.parentID || messageStore.getCurrentSessionId()
    const parentState = parentSessionId ? messageStore.getSessionState(parentSessionId) : null
    const directory = parentState?.directory || ''
    abortSession(targetSessionId, directory)
  }, [targetSessionId])

  // 运行时自动展开
  useEffect(() => {
    if (isRunning) setExpanded(true)
  }, [isRunning])

  return (
    <div className="overflow-hidden min-w-0">
      {/* Header */}
      <TaskHeader
        agentType={agentType}
        description={description}
        status={state.status}
        expanded={expanded}
        onToggle={() => setExpanded(!expanded)}
        sessionId={targetSessionId}
        onStop={isRunning ? handleStop : undefined}
      />
      
      {/* Body */}
      <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${
        expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
      }`}>
        <div className="overflow-hidden">
          {shouldRenderBody && (
            <div className="pt-1.5 space-y-3">
              {/* Prompt */}
              {prompt && (
                <div className="text-xs text-text-400 bg-bg-200/30 rounded-md px-3 py-2 whitespace-pre-wrap">
                  {prompt.length > 300 ? prompt.slice(0, 300) + '...' : prompt}
                </div>
              )}
              
              {/* 子会话内容 */}
              {targetSessionId && (
                <SubSessionView 
                  sessionId={targetSessionId} 
                  isParentRunning={isRunning}
                />
              )}
              
              {/* 完成时的输出 */}
              {isCompleted && state.output !== undefined && state.output !== null && (
                <ContentBlock
                  label="Result"
                  content={typeof state.output === 'string' ? state.output : JSON.stringify(state.output, null, 2)}
                  defaultCollapsed={true}
                  maxHeight={150}
                />
              )}
              
              {/* 错误信息 */}
              {isError && state.error !== undefined && (
                <ContentBlock
                  label="Error"
                  content={typeof state.error === 'string' ? state.error : JSON.stringify(state.error)}
                  variant="error"
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
})

// ============================================
// Task Header
// ============================================

interface TaskHeaderProps {
  agentType: string
  description: string
  status: string
  expanded: boolean
  onToggle: () => void
  sessionId?: string
  onStop?: (e: React.MouseEvent) => void
}

const TaskHeader = memo(function TaskHeader({ 
  agentType, 
  description, 
  status, 
  expanded, 
  onToggle,
  sessionId,
  onStop
}: TaskHeaderProps) {
  const handleOpenSession = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (!sessionId) return
    
    const childInfo = childSessionStore.getSessionInfo(sessionId)
    const parentSessionId = childInfo?.parentID || messageStore.getCurrentSessionId()
    const parentState = parentSessionId ? messageStore.getSessionState(parentSessionId) : null
    const directory = parentState?.directory || ''
    
    const hash = directory ? `#/session/${sessionId}?dir=${directory}` : `#/session/${sessionId}`
    window.location.hash = hash
  }, [sessionId])

  const isRunning = status === 'running' || status === 'pending'
  const isError = status === 'error'
  const isCompleted = status === 'completed'

  return (
    <div 
      className="flex items-center gap-2 py-1 cursor-pointer group"
      onClick={onToggle}
    >
      {/* Expand icon */}
      <span className={`text-text-400 transition-transform ${expanded ? 'rotate-90' : ''}`}>
        <ChevronRightIcon size={12} />
      </span>
      
      {/* Agent type badge */}
      <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${
        isRunning ? 'bg-accent-main-100/20 text-accent-main-100' :
        isError ? 'bg-danger-100/20 text-danger-100' :
        isCompleted ? 'bg-accent-secondary-100/20 text-accent-secondary-100' :
        'bg-bg-300 text-text-300'
      }`}>
        {agentType}
      </span>
      
      {/* Description */}
      <span className="text-xs text-text-300 truncate flex-1 min-w-0">
        {description}
      </span>
      
      {/* Stop button (running) */}
      {onStop && (
        <div
          role="button"
          onClick={onStop}
          className="flex-shrink-0 w-[18px] h-[18px] p-0 flex items-center justify-center bg-accent-main-000 hover:bg-accent-main-200 text-oncolor-100 rounded-sm transition-all active:scale-90"
          title="Stop"
        >
          <StopIcon size={10} />
        </div>
      )}

      {/* Open session */}
      {sessionId && (
        <button
          onClick={handleOpenSession}
          className="flex-shrink-0 p-1 text-text-500 hover:text-accent-main-100 transition-all"
          title="Open session"
        >
          <ExternalLinkIcon size={12} />
        </button>
      )}
    </div>
  )
})

// ============================================
// Sub Session View
// ============================================

interface SubSessionViewProps {
  sessionId: string
  isParentRunning: boolean
}

const SubSessionView = memo(function SubSessionView({ sessionId }: SubSessionViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const loadedRef = useRef(false)
  
  const sessionState = useSessionState(sessionId)
  const messages = sessionState?.messages || []
  const isStreaming = sessionState?.isStreaming || false
  const isLoading = sessionState?.loadState === 'loading'

  // 挂载即加载（SubSessionView 只在 task 展开时才渲染，loadedRef 防止重复请求）
  useEffect(() => {
    if (loadedRef.current) return
    
    const state = messageStore.getSessionState(sessionId)
    if (state && (state.messages.length > 0 || state.isStreaming)) {
      loadedRef.current = true
      return
    }
    
    loadedRef.current = true
    messageStore.setLoadState(sessionId, 'loading')
    
    getSessionMessages(sessionId, 20)
      .then(apiMessages => {
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

  // 自动滚动
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

  if (isLoading && messages.length === 0) {
    return <MessageSkeleton />
  }

  if (visibleMessages.length === 0) {
    return (
      <div className="text-xs text-text-500 italic py-2">
        Waiting for response...
      </div>
    )
  }

  return (
    <div className="rounded-lg bg-bg-100/50 border border-border-200/30 overflow-hidden">
      {/* Messages */}
      <div 
        ref={scrollRef}
        className="overflow-y-auto custom-scrollbar px-3 py-2 space-y-2"
        style={{ maxHeight: '240px' }}
      >
        {visibleMessages.map((msg: Message, idx: number) => (
          <MessageItem key={msg.info.id} message={msg} isLast={idx === visibleMessages.length - 1} />
        ))}
      </div>
      
    </div>
  )
})

// ============================================
// Message Item
// ============================================

interface MessageItemProps {
  message: Message
  isLast: boolean
}

const MessageItem = memo(function MessageItem({ message, isLast }: MessageItemProps) {
  const { info, parts } = message
  const isUser = info.role === 'user'
  
  const textParts = parts.filter((p): p is TextPart => p.type === 'text' && !!p.text?.trim())
  const toolParts = parts.filter((p): p is ToolPart => p.type === 'tool')
  
  const textContent = textParts.map(p => p.text).join('\n').trim()

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] px-2.5 py-1.5 rounded-lg bg-bg-300 text-text-100 text-[11px] whitespace-pre-wrap break-words">
          {textContent}
        </div>
      </div>
    )
  }

  // Assistant message
  return (
    <div className="space-y-1.5">
      {/* Text content */}
      {textContent && (
        <div className="text-[11px] text-text-200 leading-relaxed whitespace-pre-wrap">
          {textContent.length > 500 && !isLast 
            ? textContent.slice(0, 500) + '...' 
            : textContent
          }
        </div>
      )}
      
      {/* Tool calls - compact summary */}
      {toolParts.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {toolParts.map((tool, idx) => (
            <ToolBadge key={idx} tool={tool} />
          ))}
        </div>
      )}
    </div>
  )
})

// ============================================
// Tool Badge
// ============================================

const ToolBadge = memo(function ToolBadge({ tool }: { tool: ToolPart }) {
  const { state, tool: toolName } = tool
  const isRunning = state.status === 'running' || state.status === 'pending'
  const isError = state.status === 'error'
  
  const title = state.title || formatToolName(toolName)
  const displayTitle = title.length > 30 ? title.slice(0, 30) + '...' : title
  
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] ${
      isRunning ? 'bg-accent-main-100/10 text-accent-main-100' :
      isError ? 'bg-danger-100/10 text-danger-100' :
      'bg-bg-200 text-text-400'
    }`}>
      {isRunning && <span className="w-1 h-1 rounded-full bg-current animate-pulse" />}
      {displayTitle}
    </span>
  )
})

// ============================================
// Message Skeleton
// ============================================

function MessageSkeleton() {
  return (
    <div className="rounded-lg bg-bg-100/50 border border-border-200/30 p-3 space-y-2">
      <div className="h-3 bg-bg-300/50 rounded animate-pulse w-3/4" />
      <div className="h-3 bg-bg-300/50 rounded animate-pulse w-1/2" />
      <div className="h-3 bg-bg-300/50 rounded animate-pulse w-2/3" />
    </div>
  )
}

// ============================================
// Icons & Helpers
// ============================================

function formatToolName(name: string): string {
  return name.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}
