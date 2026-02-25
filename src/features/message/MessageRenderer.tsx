import { memo, useState, useRef, useEffect, useMemo } from 'react'
import { ChevronDownIcon, ChevronRightIcon, UndoIcon } from '../../components/Icons'
import { CopyButton } from '../../components/ui'
import { useDelayedRender } from '../../hooks'
import { useTheme } from '../../hooks/useTheme'
import {
  TextPartView,
  ReasoningPartView,
  ToolPartView,
  FilePartView,
  AgentPartView,
  SyntheticTextPartView,
  StepFinishPartView,
  SubtaskPartView,
  RetryPartView,
  CompactionPartView,
  MessageErrorView,
} from './parts'
import type { 
  Message, 
  Part, 
  TextPart, 
  ReasoningPart, 
  ToolPart,
  FilePart,
  AgentPart,
  StepFinishPart,
  SubtaskPart,
  RetryPart,
  CompactionPart,
  AssistantMessageInfo,
} from '../../types/message'

interface MessageRendererProps {
  message: Message
  /** 回合总时长（毫秒），仅在回合最后一条 assistant 消息上有值 */
  turnDuration?: number
  onUndo?: (userMessageId: string) => void
  canUndo?: boolean
  onEnsureParts?: (messageId: string) => void
}

export const MessageRenderer = memo(function MessageRenderer({ message, turnDuration, onUndo, canUndo, onEnsureParts }: MessageRendererProps) {
  const { info } = message
  const isUser = info.role === 'user'
  
  if (isUser) {
    return <UserMessageView message={message} onUndo={onUndo} canUndo={canUndo} />
  }
  
  return <AssistantMessageView message={message} turnDuration={turnDuration} onEnsureParts={onEnsureParts} />
})

// ============================================
// Collapsible User Text
// ============================================

/** 折叠阈值：超过此高度(px)时才折叠，大约 8 行 */
const COLLAPSE_HEIGHT_THRESHOLD = 184

const CollapsibleUserText = memo(function CollapsibleUserText({ text, collapseEnabled }: { text: string; collapseEnabled: boolean }) {
  const contentRef = useRef<HTMLParagraphElement>(null)
  const [isOverflow, setIsOverflow] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [fullHeight, setFullHeight] = useState(0)
  
  useEffect(() => {
    const el = contentRef.current
    if (!el || !collapseEnabled) {
      setIsOverflow(false)
      return
    }
    // 检测内容是否超出阈值
    const check = () => {
      const h = el.scrollHeight
      setFullHeight(h)
      setIsOverflow(h > COLLAPSE_HEIGHT_THRESHOLD)
    }
    check()
    // 字体加载后可能改变高度
    if (document.fonts?.ready) {
      document.fonts.ready.then(check)
    }
  }, [text, collapseEnabled])
  
  const showCollapse = collapseEnabled && isOverflow
  const isCollapsed = showCollapse && !expanded
  
  return (
    <div className="px-4 py-2.5 bg-bg-300 rounded-2xl max-w-full">
      <div className="relative">
        <p
          ref={contentRef}
          className="whitespace-pre-wrap break-words text-sm text-text-100 leading-relaxed overflow-hidden transition-[max-height] duration-300 ease-in-out"
          style={showCollapse ? { maxHeight: isCollapsed ? `${COLLAPSE_HEIGHT_THRESHOLD}px` : `${fullHeight}px` } : undefined}
        >
          {text}
        </p>
        {/* 底部渐变遮罩 */}
        <div 
          className={`absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-bg-300 to-transparent pointer-events-none transition-opacity duration-300 ${
            isCollapsed ? 'opacity-100' : 'opacity-0'
          }`}
          style={!showCollapse ? { display: 'none' } : undefined}
        />
      </div>
      {showCollapse && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-1 text-xs text-text-400 hover:text-text-200 transition-colors"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  )
})

// ============================================
// User Message View
// ============================================

interface UserMessageViewProps {
  message: Message
  onUndo?: (userMessageId: string) => void
  canUndo?: boolean
}

const UserMessageView = memo(function UserMessageView({ message, onUndo, canUndo }: UserMessageViewProps) {
  const { parts, info } = message
  const [showSystemContext, setShowSystemContext] = useState(false)
  const shouldRenderSystemContext = useDelayedRender(showSystemContext)
  const { collapseUserMessages } = useTheme()
  
  // 分离不同类型的 parts
  const textParts = parts.filter((p): p is TextPart => p.type === 'text' && !p.synthetic)
  const syntheticParts = parts.filter((p): p is TextPart => p.type === 'text' && !!p.synthetic)
  const fileParts = parts.filter((p): p is FilePart => p.type === 'file')
  const agentParts = parts.filter((p): p is AgentPart => p.type === 'agent')
  
  const hasSystemContext = syntheticParts.length > 0
  const messageText = textParts.map(p => p.text).join('')
  
  return (
    <div className="flex flex-col items-end group">
      <div className="flex flex-col gap-1 items-end w-full">
        {/* 消息文本 */}
        {messageText && (
          <CollapsibleUserText text={messageText} collapseEnabled={collapseUserMessages} />
        )}
        
        {/* 用户附件 */}
        {(fileParts.length > 0 || agentParts.length > 0) && (
          <div className="mt-1 flex flex-wrap gap-2 justify-end">
            {fileParts.map(part => (
              <FilePartView key={part.id} part={part} />
            ))}
            {agentParts.map(part => (
              <AgentPartView key={part.id} part={part} />
            ))}
          </div>
        )}

        {/* 系统上下文 */}
        {hasSystemContext && (
          <div className="flex flex-col items-end mt-1 w-full">
            <button 
              onClick={() => setShowSystemContext(!showSystemContext)}
              className="flex items-center gap-1 text-xs text-text-400 hover:text-text-300 transition-colors py-1 px-2 rounded hover:bg-bg-200"
            >
              <span>{showSystemContext ? 'Hide' : 'Show'} system context ({syntheticParts.length})</span>
              <span className={`transition-transform duration-300 ${showSystemContext ? 'rotate-180' : ''}`}>
                <ChevronDownIcon size={10} />
              </span>
            </button>
            
            <div className={`grid w-full transition-[grid-template-rows,opacity] duration-300 ease-out ${
              showSystemContext ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
            }`}>
              <div className="overflow-hidden">
                {shouldRenderSystemContext && (
                  <div className="pt-2 flex flex-wrap gap-2 justify-end">
                    {syntheticParts.map(part => (
                      <SyntheticTextPartView key={part.id} part={part} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-1 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
          {/* Undo button */}
          {canUndo && onUndo && (
            <button
              onClick={() => onUndo(info.id)}
              className="p-1.5 rounded-md transition-colors duration-150 text-text-400 hover:text-text-200"
              title="Undo from here"
            >
              <UndoIcon />
            </button>
          )}
          {/* Copy button */}
          {messageText && (
            <CopyButton text={messageText} position="static" />
          )}
        </div>
      </div>
    </div>
  )
})

// ============================================
// Assistant Message View
// ============================================

const AssistantMessageView = memo(function AssistantMessageView({ message, turnDuration, onEnsureParts }: { message: Message; turnDuration?: number; onEnsureParts?: (messageId: string) => void }) {
  const { parts, isStreaming, info } = message

  useEffect(() => {
    if (parts.length === 0 && onEnsureParts) {
      onEnsureParts(message.info.id)
    }
  }, [parts.length, onEnsureParts, message.info.id])
  
  // 收集连续的 tool parts 合并渲染
  const renderItems = useMemo(() => groupPartsForRender(parts), [parts])
  
  // 判断哪些 reasoning part 已经结束（后面出现了任何非基础设施 part）
  // 直接检查源 parts 数组，而非 renderItems，因为 renderItems 会过滤掉空 text，
  // 但空 text part 的存在本身就说明模型已经进入了下一输出阶段
  const endedReasoningIds = useMemo(() => {
    const ended = new Set<string>()
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].type !== 'reasoning') continue
      for (let j = i + 1; j < parts.length; j++) {
        const t = parts[j].type
        // snapshot/patch 是纯内部状态，不代表内容流转
        if (t === 'snapshot' || t === 'patch') continue
        // 任何其他 part 类型（包括空 text、step-start、tool 等）都说明思考已结束
        ended.add(parts[i].id)
        break
      }
    }
    return ended
  }, [parts])
  
  // 计算完整文本用于复制
  const fullText = parts
    .filter((p): p is TextPart => p.type === 'text' && !p.synthetic)
    .map(p => p.text)
    .join('')
  
  // 检查消息级别错误
  const messageError = (info as AssistantMessageInfo).error
  
  // 消息总耗时
  const { created, completed } = info.time
  const duration = completed ? completed - created : undefined

  if (!isStreaming && parts.length === 0) {
    // 有错误时直接显示错误信息
    if (messageError) {
      return (
        <div className="flex flex-col gap-2 w-full">
          <MessageErrorView error={messageError} />
        </div>
      )
    }
    // 使用骨架屏占位，预留合理高度减少 CLS
    return (
      <div className="flex flex-col gap-2 w-full min-h-[80px]">
        <div className="flex items-center gap-2 text-xs text-text-500">
          <span className="w-2 h-2 rounded-full bg-text-500/50 animate-pulse" />
          <span className="text-text-400">Loading...</span>
        </div>
        {/* 骨架屏模拟文本行 */}
        <div className="space-y-2">
          <div className="h-4 bg-bg-200/50 rounded w-3/4 animate-pulse" />
          <div className="h-4 bg-bg-200/50 rounded w-1/2 animate-pulse" />
        </div>
      </div>
    )
  }
  
  return (
    <div className="flex flex-col gap-2 w-full group">


      {renderItems.map((item: RenderItem, idx: number) => {
        // 耗时只在最后一个含 stepFinish 的 item 上显示
        const isLastStepFinish = idx === renderItems.findLastIndex(
          it => it.type === 'tool-group' ? !!it.stepFinish : it.part.type === 'step-finish'
        )
        
        if (item.type === 'tool-group') {
          return (
            <ToolGroup 
              key={item.parts[0].id} 
              parts={item.parts as ToolPart[]}
              stepFinish={item.stepFinish}
              duration={isLastStepFinish ? duration : undefined}
              turnDuration={isLastStepFinish ? turnDuration : undefined}
            />
          )
        }
        
        const part = item.part
        switch (part.type) {
          case 'text':
            return (
              <TextPartView 
                key={part.id} 
                part={part as TextPart} 
                isStreaming={isStreaming}
              />
            )
          case 'reasoning': {
            // 通过源 parts 数组判断思考是否已结束，而非依赖 renderItems 位置
            // 这样即使空 text part 被 renderItems 过滤，也能正确检测到思考结束
            const reasoningDone = endedReasoningIds.has(part.id)
            return (
              <ReasoningPartView 
                key={part.id} 
                part={part as ReasoningPart}
                isStreaming={isStreaming && !reasoningDone}
              />
            )
          }
          case 'step-finish':
            return (
              <StepFinishPartView 
                key={part.id} 
                part={part as StepFinishPart}
                duration={isLastStepFinish ? duration : undefined}
                turnDuration={isLastStepFinish ? turnDuration : undefined}
              />
            )
          case 'subtask':
            return (
              <SubtaskPartView
                key={part.id}
                part={part as SubtaskPart}
              />
            )
          case 'retry':
            return (
              <RetryPartView
                key={part.id}
                part={part as RetryPart}
              />
            )
          case 'compaction':
            return (
              <CompactionPartView
                key={part.id}
                part={part as CompactionPart}
              />
            )
          default:
            return null
        }
      })}

      {/* Message-level error */}
      {messageError && (
        <MessageErrorView error={messageError} />
      )}

      {/* Copy button */}
      {fullText.trim() && (
        <div className="md:opacity-0 md:group-hover:opacity-100 transition-opacity">
          <CopyButton text={fullText} position="static" />
        </div>
      )}
    </div>
  )
})

// ============================================
// Tool Group (连续的 tool parts)
// ============================================

interface ToolGroupProps {
  parts: ToolPart[]
  stepFinish?: StepFinishPart
  duration?: number
  turnDuration?: number
}

const ToolGroup = memo(function ToolGroup({ parts, stepFinish, duration, turnDuration }: ToolGroupProps) {
  const [expanded, setExpanded] = useState(true)
  const shouldRenderBody = useDelayedRender(expanded)
  
  const doneCount = parts.filter(p => p.state.status === 'completed').length
  const totalCount = parts.length
  const isAllDone = doneCount === totalCount
  
  return (
    <div className="flex flex-col">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-start gap-1.5 py-1.5 text-text-400 text-sm hover:text-text-200 rounded-md transition-colors w-fit"
      >
        <span className="inline-flex h-5 w-[14px] items-start justify-center pt-[2px] shrink-0">
          {expanded ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
        </span>
        <span className="inline-flex h-5 items-baseline gap-2 whitespace-nowrap">
          <span className="text-[13px] font-medium leading-tight">
            {isAllDone ? `${totalCount} steps` : `${doneCount}/${totalCount} steps`}
          </span>
          {!expanded && stepFinish && (
            <span className="text-xs text-text-500 font-mono opacity-70">
              {formatTokens(stepFinish.tokens)}
            </span>
          )}
        </span>
      </button>

      <div className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
        expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
      }`}>
        <div className="flex flex-col overflow-hidden">
          {shouldRenderBody && parts.map((part, idx) => (
            <ToolPartView 
              key={part.id} 
              part={part} 
              isFirst={idx === 0}
              isLast={idx === parts.length - 1}
            />
          ))}
        </div>
      </div>

      {stepFinish && (
        <StepFinishPartView part={stepFinish} duration={duration} turnDuration={turnDuration} />
      )}
    </div>
  )
})

// ============================================
// Helpers
// ============================================

function formatTokens(tokens: StepFinishPart['tokens']): string {
  const total = tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
  if (total >= 1000) {
    return `${(total / 1000).toFixed(1)}k tokens`
  }
  return `${total} tokens`
}

// ============================================
// Helper: Group parts for rendering
// ============================================

type RenderItem = 
  | { type: 'single'; part: Part }
  | { type: 'tool-group'; parts: Part[]; stepFinish?: StepFinishPart }

/** parts[from..] 跳过基础设施和空内容后，下一个有意义的 part 是否为 tool */
function hasMoreToolsAhead(parts: Part[], from: number): boolean {
  for (let k = from; k < parts.length; k++) {
    const t = parts[k].type
    if (t === 'step-start' || t === 'step-finish' || t === 'snapshot' || t === 'patch') continue
    if (t === 'text' && !(parts[k] as TextPart).text?.trim()) continue
    if (t === 'reasoning' && !(parts[k] as ReasoningPart).text?.trim()) continue
    return t === 'tool'
  }
  return false
}

function groupPartsForRender(parts: Part[]): RenderItem[] {
  const result: RenderItem[] = []
  let toolGroup: ToolPart[] = []
  let stepFinish: StepFinishPart | undefined
  
  const flushToolGroup = (sf?: StepFinishPart) => {
    if (toolGroup.length === 0) return
    result.push({ type: 'tool-group', parts: toolGroup, stepFinish: sf })
    toolGroup = []
    stepFinish = undefined
  }
  
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    
    // 跳过不渲染的 parts
    if (part.type === 'step-start' || part.type === 'snapshot' || part.type === 'patch') continue
    if (part.type === 'text' && (!(part as TextPart).text?.trim() || (part as TextPart).synthetic)) continue
    if (part.type === 'reasoning' && !(part as ReasoningPart).text?.trim()) continue
    
    if (part.type === 'tool') {
      toolGroup.push(part as ToolPart)
    } else if (part.type === 'step-finish') {
      if (toolGroup.length > 0 && hasMoreToolsAhead(parts, i + 1)) {
        // 中间 step-finish：后面还有 tool，暂存不 flush
        stepFinish = part as StepFinishPart
      } else if (toolGroup.length > 0) {
        // 最后一个 step-finish，结束 tool group
        flushToolGroup(part as StepFinishPart)
      } else {
        result.push({ type: 'single', part })
      }
    } else {
      flushToolGroup(stepFinish)
      result.push({ type: 'single', part })
    }
  }
  
  flushToolGroup(stepFinish)
  return result
}
