import { memo, useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { diffLines } from 'diff'
import { animate } from 'motion/mini'
import { ChevronDownIcon, ChevronRightIcon, SplitIcon, SpinnerIcon, UndoIcon } from '../../components/Icons'
import { CopyButton, SmoothHeight } from '../../components/ui'
import { MarkdownRenderer } from '../../components/MarkdownRenderer'
import { useCompositorExpand, useDelayedRender, useDisclosureScrollLock } from '../../hooks'
import { useInputCapabilities } from '../../hooks/useInputCapabilities'
import { useNow } from '../../hooks/useNow'
import { useTheme } from '../../hooks/useTheme'
import {
  useInlineToolRequests,
  findPermissionRequestForTool,
  findQuestionRequestForTool,
} from '../chat/InlineToolRequestContext'
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
import { extractToolData } from './tools'
import type {
  Message,
  Part,
  TextPart,
  ToolPart,
  FilePart,
  AgentPart,
  StepFinishPart,
  CompactionPart,
  AssistantMessageInfo,
} from '../../types/message'
import { isToolPart, isVisibleReasoningPart, isVisibleTextPart } from '../../types/message'
import {
  ENTRY_GROW_DURATION_MS,
  isEntryGrowComplete,
  markEntryGrowComplete,
  shouldPlayEntryGrow,
} from '../../utils/entryGrow'
import {
  formatDuration,
  formatProcessDuration,
  formatCompletedAt,
  formatDetailedDateTime,
} from '../../utils/formatUtils'
import { lockScrollAroundAnchor } from '../../utils/scrollUtils'
import { useUiDisclosureState } from '../../utils/uiDisclosureState'

/**
 * 过程折叠 header：进行中自己走表，只有这一行因计时更新；children 不跟时钟走。
 */
const ProcessCollapseHeader = memo(function ProcessCollapseHeader({
  isActive,
  startedAt,
  durationMs,
  expanded,
  onToggle,
  headerRef,
}: {
  isActive: boolean
  startedAt?: number
  durationMs?: number
  expanded: boolean
  onToggle: () => void
  headerRef: React.RefObject<HTMLButtonElement | null>
}) {
  const { t } = useTranslation('message')
  const now = useNow(1000, isActive && startedAt != null)
  const liveMs = isActive && startedAt != null ? Math.max(0, now - startedAt) : null
  const lastLiveMsRef = useRef(0)
  if (liveMs != null) lastLiveMsRef.current = liveMs
  const displayMs =
    liveMs != null
      ? liveMs
      : durationMs != null && durationMs > 0
        ? durationMs
        : lastLiveMsRef.current
  // Working/Worked：整秒无小数；超过 1 分钟带 m（如 3m 12s）
  const durationLabel = formatProcessDuration(displayMs)
  const label = isActive
    ? t('processingWithDuration', { duration: durationLabel })
    : t('processedFor', { duration: durationLabel })

  return (
    <button
      ref={headerRef}
      type="button"
      onClick={onToggle}
      className="flex w-full items-center gap-1.5 rounded-md py-1 text-left text-[length:var(--fs-sm)] leading-5 text-text-400 hover:bg-bg-200/30 hover:text-text-200 transition-colors"
    >
      <span className={isActive ? 'reasoning-shimmer-text' : 'text-text-400'}>{label}</span>
      <span className="inline-flex items-center justify-center text-text-500">
        {expanded ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
      </span>
    </button>
  )
})

/** 过程折叠块：动画与 tool steps 一致（grid-rows + delayed body） */
export function ProcessCollapseBlock({
  children,
  durationMs,
  startedAt,
  isActive,
  stateKey,
}: {
  children: ReactNode
  durationMs?: number
  startedAt?: number
  isActive: boolean
  stateKey: string
}) {
  const [expanded, setExpanded] = useUiDisclosureState(stateKey, isActive)
  const shouldRenderBody = useDelayedRender(expanded)
  const rootRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLButtonElement>(null)
  const unlockScrollRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    setExpanded(isActive, { touched: false, respectUser: true })
  }, [isActive, setExpanded])

  useEffect(() => {
    return () => {
      unlockScrollRef.current?.()
      unlockScrollRef.current = null
    }
  }, [])

  const toggleExpanded = useCallback(() => {
    unlockScrollRef.current?.()
    unlockScrollRef.current = lockScrollAroundAnchor(headerRef.current, {
      observe: rootRef.current,
    })
    setExpanded(!expanded)
  }, [expanded, setExpanded])

  // 进行中默认展开：不要跑 grid 展开动画（否则每条新消息都带动画高度重排）
  // 用户手动折叠/展开、或结束后自动收起时再开动画
  // 挂载本身不另做入场生长——像普通消息一样直接出现
  const animateGrid = !isActive || expanded !== isActive

  return (
    <div ref={rootRef} className="flex flex-col">
      <ProcessCollapseHeader
        isActive={isActive}
        startedAt={startedAt}
        durationMs={durationMs}
        expanded={expanded}
        onToggle={toggleExpanded}
        headerRef={headerRef}
      />
      <div
        className={
          animateGrid
            ? `grid transition-[grid-template-rows] duration-300 ease-in-out ${
                expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
              }`
            : expanded
              ? 'grid grid-rows-[1fr]'
              : 'grid grid-rows-[0fr]'
        }
      >
        <div className="min-h-0 min-w-0 overflow-hidden" style={{ clipPath: 'inset(0 -100% 0 -100%)' }}>
          {shouldRenderBody && <div className="flex flex-col gap-2 pt-1">{children}</div>}
        </div>
      </div>
    </div>
  )
}

/**
 * 消息内容范围：
 * - all: 正常渲染
 * - process: 只渲染过程部分（进外层折叠块）
 * - final: 只渲染尾部最终 text
 * - inline: 完整渲染（已在外层过程块内）
 */
export type ProcessContentScope = 'all' | 'process' | 'final' | 'inline'

type ProcessSplit = {
  processItems: RenderItem[]
  finalItems: RenderItem[]
  hasProcess: boolean
  hasFinal: boolean
}

/**
 * 把 render items 拆成「过程」和「最终回答」。
 * 最终回答 = 消息中最后一段连续 text + 紧随的独立 step-finish。
 * reasoning / tool 永远进过程。
 */
export function splitProcessRenderItems(items: RenderItem[]): ProcessSplit {
  if (items.length === 0) {
    return { processItems: [], finalItems: [], hasProcess: false, hasFinal: false }
  }

  let lastTextIdx = -1
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    if (item.type === 'single' && item.part.type === 'text') {
      lastTextIdx = i
      break
    }
    if (item.type === 'single' && item.part.type === 'step-finish') continue
    break
  }

  if (lastTextIdx < 0) {
    return {
      processItems: items,
      finalItems: [],
      hasProcess: items.length > 0,
      hasFinal: false,
    }
  }

  let textRunStart = lastTextIdx
  while (textRunStart > 0) {
    const prev = items[textRunStart - 1]
    if (prev.type === 'single' && prev.part.type === 'text') {
      textRunStart -= 1
      continue
    }
    break
  }

  let textRunEnd = lastTextIdx
  while (textRunEnd + 1 < items.length) {
    const next = items[textRunEnd + 1]
    if (next.type === 'single' && next.part.type === 'step-finish') {
      textRunEnd += 1
      continue
    }
    break
  }

  const finalItems = items.slice(textRunStart, textRunEnd + 1)
  const before = items.slice(0, textRunStart)
  const after = items.slice(textRunEnd + 1)
  const afterProcess = after.filter(
    item => !(item.type === 'single' && item.part.type === 'step-finish'),
  )
  const afterStepFinish = after.filter(
    item => item.type === 'single' && item.part.type === 'step-finish',
  )
  const processItems = afterProcess.length > 0 ? [...before, ...afterProcess] : before
  const mergedFinal = afterStepFinish.length > 0 ? [...finalItems, ...afterStepFinish] : finalItems

  return {
    processItems,
    finalItems: mergedFinal,
    hasProcess: processItems.length > 0,
    hasFinal: mergedFinal.length > 0,
  }
}

/** 流式未完成时不拆 final：中间 text 后面还可能跟 tool */
export function messageStillStreamingProcess(message: Message): boolean {
  if (message.info.role !== 'assistant') return false
  return !!message.isStreaming || message.info.time.completed == null
}

/** 是否有可收进过程块的内容（tool / reasoning 等，不含尾部最终 text） */
export function messageHasProcessContent(message: Message): boolean {
  if (message.info.role !== 'assistant') return false
  if (messageStillStreamingProcess(message)) return true
  const items = groupPartsForRender(message.parts)
  if (items.length === 0) return false
  return splitProcessRenderItems(items).hasProcess
}

/** 是否有应留在折叠块外的最终 text（仅消息已结束后才拆） */
export function messageHasFinalContent(message: Message): boolean {
  if (message.info.role !== 'assistant') return false
  if (messageStillStreamingProcess(message)) return false
  return splitProcessRenderItems(groupPartsForRender(message.parts)).hasFinal
}

interface MessageRendererProps {
  message: Message
  allowStreamingLayoutAnimation?: boolean
  /** 回合总时长（毫秒），仅在回合最后一条 assistant 消息上有值 */
  turnDuration?: number
  /**
   * 是否为该用户回合的最后一条可见 assistant。
   * latestOnly 开启时，中间 assistant 不显示 step 完成信息。
   * 未传入时按 true 处理（单条消息场景）。
   */
  isTurnLatestAssistant?: boolean
  /** 过程折叠时的内容范围 */
  processContentScope?: ProcessContentScope
  onUndo?: (userMessageId: string) => void
  onFork?: (message: Message, forkMessageId?: string) => Promise<void> | void
  forkMessageId?: string
  canUndo?: boolean
  onEnsureParts?: (messageId: string) => void
  /** 用户消息入场生长完成（供过程壳等待挂载） */
  onEntryGrowComplete?: (messageId: string) => void
}

export const MessageRenderer = memo(function MessageRenderer({
  message,
  allowStreamingLayoutAnimation = false,
  turnDuration,
  isTurnLatestAssistant = true,
  processContentScope = 'all',
  onUndo,
  onFork,
  forkMessageId,
  canUndo,
  onEnsureParts,
  onEntryGrowComplete,
}: MessageRendererProps) {
  const { info } = message
  const isUser = info.role === 'user'

  if (isUser) {
    return (
      <UserMessageView
        message={message}
        onUndo={onUndo}
        onFork={onFork}
        forkMessageId={forkMessageId}
        canUndo={canUndo}
        onEntryGrowComplete={onEntryGrowComplete}
      />
    )
  }

  return (
    <AssistantMessageView
      message={message}
      allowStreamingLayoutAnimation={allowStreamingLayoutAnimation}
      turnDuration={turnDuration}
      isTurnLatestAssistant={isTurnLatestAssistant}
      processContentScope={processContentScope}
      onFork={onFork}
      forkMessageId={forkMessageId}
      onEnsureParts={onEnsureParts}
    />
  )
})

// ============================================
// 入场生长动画 hook — 新消息作为对话流的延续，从 height 0 平滑展开
// 完成后 markEntryGrowComplete，供过程壳「等用户登场完再挂」使用
// ============================================

function useEntryGrowAnimation(
  created: number,
  enabled = true,
  completeId?: string,
  onComplete?: (id: string) => void,
) {
  const ref = useRef<HTMLDivElement>(null)
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  useLayoutEffect(() => {
    const el = ref.current
    const finish = () => {
      if (!completeId) return
      if (!isEntryGrowComplete(completeId)) markEntryGrowComplete(completeId)
      onCompleteRef.current?.(completeId)
    }

    // 过程壳内消息禁止入场生长：会连着虚拟行反复 measure，造成整列高度抽搐
    if (!enabled || !el) {
      finish()
      return
    }
    // 已完成过（虚拟行复用 remount）或消息太旧：不播，直接放行
    if ((completeId && isEntryGrowComplete(completeId)) || !shouldPlayEntryGrow(created)) {
      finish()
      return
    }

    const targetHeight = el.scrollHeight
    el.style.height = '0px'
    el.style.clipPath = 'inset(0 -100% 0 -100%)'
    let cancelled = false
    animate(el, { height: `${targetHeight}px` }, { duration: ENTRY_GROW_DURATION_MS / 1000, ease: 'easeOut' }).then(
      () => {
        if (cancelled) return
        el.style.height = ''
        el.style.clipPath = ''
        finish()
      },
    )
    return () => {
      cancelled = true
      // 虚拟行中途卸载也放行，避免 Working 壳永远等不到入场完成
      el.style.height = ''
      el.style.clipPath = ''
      finish()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return ref
}

// ============================================
// Collapsible User Text
// ============================================

/** 默认预览 8 行 */
const COLLAPSE_PREVIEW_LINES = 8
const LEADING_RELAXED = 1.625
const USER_HTML_ARTIFACT_PATTERN = /(?:```(?:html|htm)\b|<!doctype\s+html\b|<html\b|<style\b|<script\b|<canvas\b|\son[a-z]+\s*=)/i

// 折叠状态缓存：消息是否溢出
const overflowStateCache = new Map<string, boolean>()

const CollapsibleUserText = memo(function CollapsibleUserText({
  text,
  collapseEnabled,
  renderMarkdown,
  messageId,
}: {
  text: string
  collapseEnabled: boolean
  renderMarkdown: boolean
  messageId: string
}) {
  const { t } = useTranslation('message')
  const contentRef = useRef<HTMLDivElement>(null)
  const { rootRef, headerRef, withScrollLock } = useDisclosureScrollLock()
  const overflowCacheKey = `${messageId}:${renderMarkdown ? 'markdown' : 'plain'}`
  const [expanded, setExpanded] = useUiDisclosureState(`message:${messageId}:user-text`, false)
  const [isOverflow, setIsOverflow] = useState(() => overflowStateCache.get(overflowCacheKey) ?? false)

  useLayoutEffect(() => {
    const el = contentRef.current
    if (!el) return

    let disposed = false
    const measure = () => {
      if (disposed) return
      const fsBase = Number.parseFloat(window.getComputedStyle(el).getPropertyValue('--fs-base'))
      if (!Number.isFinite(fsBase) || fsBase <= 0) return
      const collapsedHeight = fsBase * LEADING_RELAXED * COLLAPSE_PREVIEW_LINES
      const next = el.scrollHeight > collapsedHeight + 1
      overflowStateCache.set(overflowCacheKey, next)
      setIsOverflow(prev => (prev === next ? prev : next))
    }

    measure()
    const resizeObserver = new ResizeObserver(measure)
    resizeObserver.observe(el)
    document.fonts?.ready?.then(measure)

    return () => {
      disposed = true
      resizeObserver.disconnect()
    }
  }, [text, overflowCacheKey])

  const hasHtmlArtifact = renderMarkdown && USER_HTML_ARTIFACT_PATTERN.test(text)
  const showCollapse = collapseEnabled && !hasHtmlArtifact && isOverflow
  const isCollapsed = collapseEnabled && !hasHtmlArtifact && !expanded

  return (
    <div
      ref={rootRef}
      className={`px-4 py-2.5 bg-bg-300 rounded-2xl max-w-full ${hasHtmlArtifact ? 'w-full max-w-2xl' : ''}`}
    >
      <div className="relative">
        <div
          ref={node => {
            contentRef.current = node
            headerRef(node)
          }}
          className={`m-0 break-words text-[length:var(--fs-base)] text-text-100 leading-relaxed${
            renderMarkdown ? '' : ' whitespace-pre-wrap'
          }${
            isCollapsed ? ' overflow-hidden' : ''
          }`}
          style={
            isCollapsed
              ? {
                  maxHeight: `calc(var(--fs-base) * ${LEADING_RELAXED} * ${COLLAPSE_PREVIEW_LINES})`,
                  contain: 'layout paint',
                }
              : undefined
          }
        >
          {renderMarkdown ? <MarkdownRenderer content={text} /> : text}
        </div>
        {/* 底部渐变遮罩 */}
        {showCollapse && isCollapsed && (
          <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-bg-300 to-transparent pointer-events-none" />
        )}
      </div>
      {showCollapse && (
        <button
          type="button"
          onClick={() => withScrollLock(() => setExpanded(!expanded), !expanded)}
          className="mt-1 text-[length:var(--fs-sm)] text-text-400 hover:text-text-200 transition-colors"
          aria-expanded={expanded}
        >
          {expanded ? t('showLess') : t('showMore')}
        </button>
      )}
    </div>
  )
})

interface ForkActionButtonProps {
  message: Message
  onFork?: (message: Message, forkMessageId?: string) => Promise<void> | void
  forkMessageId?: string
}

const ForkActionButton = memo(function ForkActionButton({ message, onFork, forkMessageId }: ForkActionButtonProps) {
  const { t } = useTranslation('message')
  const [isForking, setIsForking] = useState(false)

  const handleFork = useCallback(async () => {
    if (!onFork || isForking) return

    setIsForking(true)

    try {
      await onFork(message, forkMessageId)
    } catch {
      // 业务错误由上层统一处理
    } finally {
      setIsForking(false)
    }
  }, [forkMessageId, isForking, message, onFork])

  if (!onFork) return null

  return (
    <button
      onClick={() => void handleFork()}
      disabled={isForking}
      className="p-1.5 rounded-md transition-colors duration-150 text-text-400 hover:text-text-200 disabled:cursor-default disabled:text-text-500"
      title={isForking ? t('forkingFromHere') : t('forkFromHere')}
      aria-label={isForking ? t('forkingFromHere') : t('forkFromHere')}
    >
      {isForking ? <SpinnerIcon className="animate-spin" /> : <SplitIcon />}
    </button>
  )
})

// ============================================
// User Message View
// ============================================

interface UserMessageViewProps {
  message: Message
  onUndo?: (userMessageId: string) => void
  onFork?: (message: Message, forkMessageId?: string) => Promise<void> | void
  forkMessageId?: string
  canUndo?: boolean
  onEntryGrowComplete?: (messageId: string) => void
}

/** PC 精细指针：默认隐藏，悬浮消息/聚焦时显示；触控优先设备始终显示 */
function useMessageActionBarClass() {
  const { preferTouchUi } = useInputCapabilities()
  return preferTouchUi
    ? 'flex items-center gap-1 transition-opacity'
    : 'flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100 pointer-events-none group-hover:pointer-events-auto group-focus-within:pointer-events-auto focus-within:pointer-events-auto transition-opacity'
}

const UserMessageView = memo(function UserMessageView({
  message,
  onUndo,
  onFork,
  forkMessageId,
  canUndo,
  onEntryGrowComplete,
}: UserMessageViewProps) {
  const { t } = useTranslation('message')
  const { parts, info } = message
  const [showSystemContext, setShowSystemContext] = useUiDisclosureState(
    `message:${info.id}:user-system-context`,
    false,
  )
  const shouldRenderSystemContext = useDelayedRender(showSystemContext)
  const {
    rootRef: systemContextRootRef,
    headerRef: systemContextHeaderRef,
    withScrollLock: withSystemContextScrollLock,
  } = useDisclosureScrollLock()
  const { collapseUserMessages, renderUserMarkdown } = useTheme()
  const actionBarClass = useMessageActionBarClass()

  const wrapperRef = useEntryGrowAnimation(info.time.created, true, info.id, onEntryGrowComplete)

  // 分离不同类型的 parts
  const textParts = parts.filter((p): p is TextPart => p.type === 'text' && !p.synthetic)
  const syntheticParts = parts.filter((p): p is TextPart => p.type === 'text' && !!p.synthetic)
  const fileParts = parts.filter((p): p is FilePart => p.type === 'file')
  const agentParts = parts.filter((p): p is AgentPart => p.type === 'agent')
  const compactionParts = parts.filter((p): p is CompactionPart => p.type === 'compaction')

  const hasSystemContext = syntheticParts.length > 0
  const messageText = textParts.map(p => p.text).join('')
  const hasUserHtmlArtifact = renderUserMarkdown && USER_HTML_ARTIFACT_PATTERN.test(messageText)

  return (
    <div
      ref={wrapperRef}
      data-user-html-artifact={hasUserHtmlArtifact ? '' : undefined}
      className={`flex flex-col items-end group ${hasUserHtmlArtifact ? 'w-full' : ''}`}
    >
      <div className="flex flex-col gap-1 items-end w-full">
        {/* 消息文本 */}
        {messageText && (
          <CollapsibleUserText
            text={messageText}
            collapseEnabled={collapseUserMessages}
            renderMarkdown={renderUserMarkdown}
            messageId={info.id}
          />
        )}

        {/* 用户附件 */}
        {(fileParts.length > 0 || agentParts.length > 0) && (
          <div className="mt-1 flex max-w-full min-w-0 flex-wrap gap-2 justify-end">
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
          <div ref={systemContextRootRef} className="flex flex-col items-end mt-1 w-full">
            <button
              type="button"
              ref={systemContextHeaderRef}
              onClick={() => withSystemContextScrollLock(() => setShowSystemContext(!showSystemContext), !showSystemContext)}
              className="flex items-center gap-1 text-[length:var(--fs-sm)] text-text-400 hover:text-text-300 transition-colors py-1 px-2 rounded hover:bg-bg-200"
            >
              <span>
                {showSystemContext ? t('hideSystemContext') : t('showSystemContext', { count: syntheticParts.length })}
              </span>
              <span className={`transition-transform duration-300 ${showSystemContext ? '' : '-rotate-90'}`}>
                <ChevronDownIcon size={10} />
              </span>
            </button>

            <div
              className={`grid w-full transition-[grid-template-rows,opacity] duration-300 ease-out ${
                showSystemContext ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
              }`}
            >
              <div className="overflow-hidden">
                {shouldRenderSystemContext && (
                  <div className="pt-2 flex max-w-full min-w-0 flex-wrap gap-2 justify-end">
                    {syntheticParts.map(part => (
                      <SyntheticTextPartView key={part.id} part={part} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {compactionParts.length > 0 && (
          <div className="w-full mt-1">
            {compactionParts.map(part => (
              <CompactionPartView key={part.id} part={part} />
            ))}
          </div>
        )}

        {/* Action buttons — PC 悬浮消息显示；触控设备始终显示 */}
        <div className={actionBarClass}>
          {/* Undo button */}
          {canUndo && onUndo && (
            <button
              onClick={() => onUndo(info.id)}
              className="p-1.5 rounded-md transition-colors duration-150 text-text-400 hover:text-text-200"
              title={t('undoFromHere')}
            >
              <UndoIcon />
            </button>
          )}
          <ForkActionButton message={message} onFork={onFork} forkMessageId={forkMessageId} />
          {/* Copy button */}
          {messageText && <CopyButton text={messageText} position="static" />}
        </div>
      </div>
    </div>
  )
})

// ============================================
// Assistant Message View
// ============================================

const AssistantMessageView = memo(function AssistantMessageView({
  message,
  allowStreamingLayoutAnimation = false,
  turnDuration,
  isTurnLatestAssistant = true,
  processContentScope = 'all',
  onFork,
  forkMessageId,
  onEnsureParts,
}: {
  message: Message
  allowStreamingLayoutAnimation?: boolean
  turnDuration?: number
  isTurnLatestAssistant?: boolean
  processContentScope?: ProcessContentScope
  onFork?: (message: Message, forkMessageId?: string) => Promise<void> | void
  forkMessageId?: string
  onEnsureParts?: (messageId: string) => void
}) {
  const { t } = useTranslation('message')
  const { parts, isStreaming, info } = message
  const { stepFinishDisplay, completedAtFormat, actionsOnLatestAssistantOnly } = useTheme()
  // 整轮最新 assistant 才允许显示 step 完成信息（latestOnly 时中间 assistant 全隐藏）
  const allowStepFinishOnMessage = !stepFinishDisplay.latestOnly || isTurnLatestAssistant
  // 分叉/复制：默认只在回合末尾助手消息显示，避免连续多条打断阅读
  // final 位始终显示操作；process/inline 不显示（避免壳内外重复）
  const showMessageActions =
    processContentScope !== 'process' &&
    processContentScope !== 'inline' &&
    (!actionsOnLatestAssistantOnly || isTurnLatestAssistant || processContentScope === 'final')
  const actionBarClass = useMessageActionBarClass()

  // 壳内（process/inline）和壳外 final 都别做 height 0→N：final 也是拆分后新挂载，动画会顶布局
  const allowEntryGrow = processContentScope === 'all'
  const wrapperRef = useEntryGrowAnimation(info.time.created, allowEntryGrow)

  useEffect(() => {
    if (parts.length === 0 && onEnsureParts) {
      onEnsureParts(message.info.id)
    }
  }, [parts.length, onEnsureParts, message.info.id])

  // 收集连续的 tool parts 合并渲染；过程折叠时按 scope 拆分
  const renderItems = useMemo(() => {
    const items = groupPartsForRender(parts)
    if (processContentScope === 'all' || processContentScope === 'inline') return items
    // 流式未完成：整袋当 process，不拆 final
    if (messageStillStreamingProcess(message)) {
      return processContentScope === 'process' ? items : []
    }
    const split = splitProcessRenderItems(items)
    if (processContentScope === 'process') return split.processItems
    if (processContentScope === 'final') return split.finalItems
    return items
  }, [parts, processContentScope, message])

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

  // 计算完整文本用于复制（缓存：parts 引用未变时复用，避免流式每帧重算字符串拼接）
  const fullText = useMemo(
    () =>
      parts
        .filter((p): p is TextPart => p.type === 'text' && !p.synthetic)
        .map(p => p.text)
        .join(''),
    [parts],
  )
  const hasCopyableText = fullText.trim().length > 0

  // 检查消息级别错误
  const messageError = (info as AssistantMessageInfo).error

  // 消息总耗时
  const { created, completed } = info.time
  const duration = completed != null ? completed - created : undefined

  // agent / model（仅 assistant 消息）
  const assistantInfo = info.role === 'assistant' ? (info as AssistantMessageInfo) : null
  const agent = assistantInfo?.agent || undefined
  const modelLabel = assistantInfo?.modelID || undefined

  const hasStepFinishPart = parts.some(part => part.type === 'step-finish')
  const showTurnDurationFooter =
    allowStepFinishOnMessage &&
    !isStreaming &&
    !hasStepFinishPart &&
    stepFinishDisplay.turnDuration &&
    turnDuration != null &&
    turnDuration > 0
  const showCompletedAtFooter =
    allowStepFinishOnMessage &&
    !isStreaming &&
    !hasStepFinishPart &&
    stepFinishDisplay.completedAt &&
    completed != null

  if (!isStreaming && parts.length === 0) {
    // process/final 空内容时不占位
    if (processContentScope === 'process' || processContentScope === 'final') return null
    // 有错误时直接显示错误信息
    if (messageError) {
      return (
        <div className="flex flex-col gap-2 w-full">
          <MessageErrorView error={messageError} stateKey={`message:${message.info.id}:error`} />
        </div>
      )
    }
    // parts 尚未 hydrate — 保留最小占位减少 CLS，不显示骨架/loading 文字
    // onEnsureParts 已在上方 useEffect 中触发 hydrate，parts 到位后自动 re-render
    return <div className="w-full min-h-[40px]" />
  }

  // process/final 拆完后可能为空
  if (renderItems.length === 0 && processContentScope !== 'all' && processContentScope !== 'inline') {
    return null
  }

  return (
    <div ref={wrapperRef} className="flex flex-col gap-2 w-full group">
      {/* 流式增高走自然撑开 + 贴底 scroll，默认不做 height 补间，避免每帧 layout/remeasure */}
      <SmoothHeight isActive={!!isStreaming && allowStreamingLayoutAnimation && processContentScope === 'all'}>
        <div className="flex flex-col gap-2">
          {renderItems.map((item: RenderItem, idx: number) => {
            // 本消息内最后一个含 stepFinish 的 item（耗时/完成时刻只挂这里）
            const isLastStepFinish =
              idx ===
              renderItems.findLastIndex(it =>
                it.type === 'tool-group' ? !!it.stepFinish : it.part.type === 'step-finish',
              )
            // latestOnly 开：整轮最后一条 assistant 的最后一个 step 才显示
            // latestOnly 关：本消息所有 step-finish 都显示（旧行为）
            const showStepFinish =
              allowStepFinishOnMessage && (!stepFinishDisplay.latestOnly || isLastStepFinish)
            // duration / turnDuration / completedAt 始终只挂在本消息最后一个 step
            const showTiming = showStepFinish && isLastStepFinish

            if (item.type === 'tool-group') {
              return (
                <ToolGroup
                  key={item.parts[0].id}
                  parts={item.parts}
                  stepFinish={showStepFinish ? item.stepFinish : undefined}
                  duration={showTiming ? duration : undefined}
                  turnDuration={showTiming ? turnDuration : undefined}
                  isStreaming={isStreaming}
                  agent={showStepFinish ? agent : undefined}
                  modelLabel={showStepFinish ? modelLabel : undefined}
                  completedAt={showTiming ? completed : undefined}
                />
              )
            }

            const part = item.part
            switch (part.type) {
              case 'text':
                return <TextPartView key={part.id} part={part} isStreaming={isStreaming} />
              case 'reasoning': {
                const reasoningDone = endedReasoningIds.has(part.id)
                return (
                  <ReasoningPartView
                    key={part.id}
                    part={part}
                    isStreaming={isStreaming && !reasoningDone}
                  />
                )
              }
              case 'step-finish':
                if (!showStepFinish) return null
                return (
                  <StepFinishPartView
                    key={part.id}
                    part={part}
                    duration={showTiming ? duration : undefined}
                    turnDuration={showTiming ? turnDuration : undefined}
                    agent={agent}
                    modelLabel={modelLabel}
                    completedAt={showTiming ? completed : undefined}
                  />
                )
              case 'subtask':
                return <SubtaskPartView key={part.id} part={part} />
              case 'retry':
                return <RetryPartView key={part.id} part={part} />
              case 'compaction':
                return <CompactionPartView key={part.id} part={part} />
              default:
                return null
            }
          })}
        </div>
      </SmoothHeight>

      {/* Message-level error：过程壳内不重复挂错误 */}
      {messageError && processContentScope !== 'process' && processContentScope !== 'inline' && (
        <MessageErrorView error={messageError} stateKey={`message:${info.id}:error`} />
      )}

      {processContentScope !== 'process' && processContentScope !== 'inline' && (showTurnDurationFooter || showCompletedAtFooter) && (
        <div className="flex items-center gap-3 py-0.5 text-[length:var(--fs-xxs)] text-text-500">
          {showTurnDurationFooter && (
            <span>{t('stepFinish.totalDuration', { duration: formatDuration(turnDuration!) })}</span>
          )}
          {showCompletedAtFooter && (
            <span title={formatDetailedDateTime(completed!)}>{formatCompletedAt(completed!, completedAtFormat)}</span>
          )}
        </div>
      )}

      {showMessageActions && hasCopyableText && (
        <div className={actionBarClass}>
          <ForkActionButton message={message} onFork={onFork} forkMessageId={forkMessageId} />
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
  isStreaming?: boolean
  agent?: string
  modelLabel?: string
  completedAt?: number
}

/** 用户需要阅读/交互的工具：沉浸模式下这些工具完成后保持展开 */
const READABLE_TOOL_PATTERNS = /bash|\bsh\b|cmd|terminal|shell|write|save|edit|replace|patch|todo|question|ask/i

function isReadableTool(toolName: string): boolean {
  return READABLE_TOOL_PATTERNS.test(toolName.toLowerCase())
}

const ToolGroup = memo(function ToolGroup({
  parts,
  stepFinish,
  duration,
  turnDuration,
  isStreaming,
  agent,
  modelLabel,
  completedAt,
}: ToolGroupProps) {
  const { t } = useTranslation('message')
  const { descriptiveToolSteps, inlineToolRequests, immersiveMode, processCollapseEnabled } = useTheme()
  const { pendingPermissions, pendingQuestions } = useInlineToolRequests()
  const hasPendingInteraction =
    inlineToolRequests &&
    parts.some(part => {
      const childSessionId = getTaskChildSessionId(part)
      return (
        findPermissionRequestForTool(pendingPermissions, part.callID, childSessionId) ||
        findQuestionRequestForTool(pendingQuestions, part.callID, childSessionId)
      )
    })

  const doneCount = parts.filter(p => p.state.status === 'completed').length
  const totalCount = parts.length
  const isAllDone = doneCount === totalCount
  const hasActiveTools = parts.some(isToolPartActive)
  const stepsSummary = descriptiveToolSteps ? buildDescriptiveToolStepsSummary(parts, t) : undefined

  // 汇总所有成功完成的工具的 diff stats（失败的不算）
  const totalDiffStats = useMemo(() => {
    if (!descriptiveToolSteps) return undefined
    let additions = 0,
      deletions = 0
    for (const part of parts) {
      if (part.state.status === 'error') continue
      const data = extractToolData(part)
      const stats = data.diffStats || computePartDiffStats(data)
      if (stats) {
        additions += stats.additions
        deletions += stats.deletions
      }
    }
    return additions || deletions ? { additions, deletions } : undefined
  }, [descriptiveToolSteps, parts])

  // 沉浸模式下：判断工具组是否包含需要用户阅读的工具
  const hasReadableTools = immersiveMode && parts.some(p => isReadableTool(p.tool))
  // 过程折叠：steps 默认收起，只有权限/提问才自动展开
  // 其它模式：活跃/流式/可读工具时展开
  const shouldStartExpanded = processCollapseEnabled
    ? !!hasPendingInteraction
    : !descriptiveToolSteps ||
      hasActiveTools ||
      hasPendingInteraction ||
      (immersiveMode && !!isStreaming && hasReadableTools)

  const groupStateKey = `message:${parts[0]?.messageID || 'unknown'}:tool-group:${parts[0]?.id || 'empty'}`
  const [expanded, setExpanded] = useUiDisclosureState(groupStateKey, shouldStartExpanded)
  const hasAutoExpandedReadableRef = useRef(
    !processCollapseEnabled && shouldStartExpanded && immersiveMode && hasReadableTools,
  )
  const { rootRef: stepsRootRef, headerRef: stepsHeaderRef, withScrollLock: withStepsScrollLock } =
    useDisclosureScrollLock()

  useEffect(() => {
    if (!descriptiveToolSteps) return

    // 权限/提问：必须展开让用户操作
    if (hasPendingInteraction) {
      setExpanded(true, { touched: false, respectUser: true })
      return
    }

    // 过程折叠：不因 active/streaming 自动展开 steps
    if (processCollapseEnabled) return

    // 沉浸模式下没有可读工具：始终收起
    if (immersiveMode && !hasReadableTools) {
      setExpanded(false, { touched: false, respectUser: true })
      return
    }
    if (hasActiveTools) {
      if (immersiveMode && hasReadableTools) {
        hasAutoExpandedReadableRef.current = true
      }
      setExpanded(true, { touched: false, respectUser: true })
      return
    }
    // 某些可读工具（如 todo）可能首帧已完成，错过 running 态；流仍在继续时也自动展开一次
    if (immersiveMode && isStreaming && hasReadableTools && !hasAutoExpandedReadableRef.current) {
      hasAutoExpandedReadableRef.current = true
      setExpanded(true, { touched: false, respectUser: true })
    }
  }, [
    descriptiveToolSteps,
    processCollapseEnabled,
    hasActiveTools,
    hasPendingInteraction,
    immersiveMode,
    hasReadableTools,
    isStreaming,
    setExpanded,
  ])

  const effectiveExpanded = expanded || hasPendingInteraction
  // Android expand: instant layout + max-height fake; collapse: original grid-rows.
  // Only animate at the steps shell level so nested ToolPartView does not double-animate.
  const {
    contentRef: stepsExpandContentRef,
    layoutOpen: stepsLayoutOpen,
    keepMounted: stepsKeepMounted,
    panelClassName: stepsPanelClassName,
  } = useCompositorExpand(effectiveExpanded)
  // 展开即挂工具行：默认展开时 header 与 body 同帧
  const shouldRenderBody = useDelayedRender(stepsKeepMounted)

  // compact: 单工具时用紧凑布局（图标内联，无 timeline 连接线）
  // 不区分 streaming 状态 — 单工具始终 compact，第二个工具到来时再自然过渡到 timeline
  const isSingleCompact = totalCount === 1 && !descriptiveToolSteps
  // steps header: 多工具始终显示；描述型 steps 模式下，单工具也显示
  const showStepsHeader = totalCount > 1 || descriptiveToolSteps

  // 统一容器结构 — ToolPartView 始终在同一 React 树位置，
  // streaming→idle / 1→N 工具切换时不 remount，expanded 状态不丢失
  return (
    <div ref={stepsRootRef} className="flex flex-col">
        {showStepsHeader &&
          (descriptiveToolSteps ? (
            <button
              type="button"
              ref={stepsHeaderRef}
              onClick={() => withStepsScrollLock(() => setExpanded(!expanded), !expanded)}
              className="flex w-full items-baseline rounded-md py-1 text-left hover:bg-bg-200/30 transition-colors"
            >
              <span className="text-[length:var(--fs-sm)] leading-5">
                {stepsSummary?.map((seg, i) => (
                  <span
                    key={i}
                    className={
                      seg.type === 'error'
                        ? 'text-danger-100'
                        : seg.type === 'active'
                          ? 'reasoning-shimmer-text'
                          : 'text-text-300'
                    }
                  >
                    {seg.text}
                  </span>
                ))}
              </span>
              {totalDiffStats && !hasActiveTools && (
                <span className="ml-1.5 inline-flex items-center gap-1 text-[length:var(--fs-xxs)] font-mono font-medium tabular-nums">
                  {totalDiffStats.additions > 0 && (
                    <span className="text-success-100">+{totalDiffStats.additions}</span>
                  )}
                  {totalDiffStats.deletions > 0 && <span className="text-danger-100">-{totalDiffStats.deletions}</span>}
                </span>
              )}
            </button>
          ) : (
            <button
              type="button"
              ref={stepsHeaderRef}
              onClick={() => withStepsScrollLock(() => setExpanded(!expanded), !expanded)}
              className="flex items-center gap-1.5 py-1.5 text-text-400 text-[length:var(--fs-base)] hover:text-text-200 hover:bg-bg-200/30 rounded-md transition-colors"
            >
              <span className="inline-flex w-[14px] items-center justify-center shrink-0">
                {effectiveExpanded ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
              </span>
              <span className="inline-flex items-baseline gap-2 whitespace-nowrap">
                <span className="text-[length:var(--fs-md)] font-medium leading-tight">
                  {isAllDone
                    ? t('stepsCount', { done: totalCount, total: totalCount })
                    : t('stepsCount', { done: doneCount, total: totalCount })}
                </span>
                {!effectiveExpanded && stepFinish && (
                  <span className="text-[length:var(--fs-sm)] text-text-500 font-mono opacity-70">
                    {formatTokens(stepFinish.tokens, t)}
                  </span>
                )}
              </span>
            </button>
          ))}

        <div
          className={
            showStepsHeader
              ? `grid ${stepsPanelClassName} ${stepsLayoutOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`
              : ''
          }
        >
          <div
            ref={showStepsHeader ? stepsExpandContentRef : undefined}
            className={showStepsHeader ? 'flex flex-col min-h-0 min-w-0 overflow-hidden' : 'flex flex-col'}
            style={showStepsHeader ? { clipPath: 'inset(0 -100% 0 -100%)' } : undefined}
          >
            {(!showStepsHeader || shouldRenderBody) &&
              parts.map((part, idx) => (
                <ToolPartView
                  key={part.id}
                  part={part}
                  isFirst={idx === 0}
                  isLast={idx === parts.length - 1}
                  compact={isSingleCompact}
                  descriptive={descriptiveToolSteps}
                  isStreaming={isStreaming}
                />
              ))}
          </div>
        </div>

        {stepFinish && (
          <div className="mt-2">
            <StepFinishPartView
              part={stepFinish}
              duration={duration}
              turnDuration={turnDuration}
              agent={agent}
              modelLabel={modelLabel}
              completedAt={completedAt}
            />
          </div>
        )}
    </div>
  )
})

// ============================================
// Helpers
// ============================================

function formatTokens(
  tokens: StepFinishPart['tokens'],
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const total = tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
  if (total >= 1000) {
    return t('tokensK', { count: (total / 1000).toFixed(1) })
  }
  return `${total} ${t('tokens')}`
}

type ToolSummaryCategory =
  | 'execute'
  | 'write'
  | 'edit'
  | 'read'
  | 'search'
  | 'list'
  | 'network'
  | 'task'
  | 'todo'
  | 'question'
  | 'skill'
  | 'think'
  | 'other'

type ToolSummaryPhase = 'done' | 'active' | 'failed'

interface SummarySegment {
  text: string
  type: 'normal' | 'error' | 'active'
}

function buildDescriptiveToolStepsSummary(
  parts: ToolPart[],
  t: (key: string, opts?: Record<string, unknown>) => string,
): SummarySegment[] {
  const sep = t('toolSteps.separator')
  const segments: SummarySegment[] = []
  const MAX_CATEGORIES = 3

  // ── 按类别汇总 done / failed / active ──
  const categoryOrder: ToolSummaryCategory[] = []
  const doneMap = new Map<ToolSummaryCategory, number>()
  const failedMap = new Map<ToolSummaryCategory, number>()
  const activeMap = new Map<ToolSummaryCategory, number>()

  for (const part of parts) {
    const cat = getToolSummaryCategory(part.tool)
    if (!doneMap.has(cat)) {
      categoryOrder.push(cat)
      doneMap.set(cat, 0)
      failedMap.set(cat, 0)
      activeMap.set(cat, 0)
    }
    if (part.state.status === 'completed') doneMap.set(cat, (doneMap.get(cat) || 0) + 1)
    else if (part.state.status === 'error') failedMap.set(cat, (failedMap.get(cat) || 0) + 1)
    else if (isToolPartActive(part)) activeMap.set(cat, (activeMap.get(cat) || 0) + 1)
  }

  // ── 已完成 + 失败（合并同类别）──
  // 先收集所有完成态类别（含纯失败的类别）
  const finishedCategories = categoryOrder.filter(cat => (doneMap.get(cat) || 0) > 0 || (failedMap.get(cat) || 0) > 0)

  const pushFinishedSegments = (cats: ToolSummaryCategory[]) => {
    for (const cat of cats) {
      const done = doneMap.get(cat) || 0
      const failed = failedMap.get(cat) || 0
      if (segments.length > 0) segments.push({ text: sep, type: 'normal' })

      if (done > 0 && failed > 0) {
        // 同类别既有成功又有失败：合并成一句
        const total = done + failed
        segments.push({ text: formatToolSummarySegment(cat, total, 'done', t), type: 'normal' })
        segments.push({ text: t('toolSteps.failedSuffix', { count: failed }), type: 'error' })
      } else if (done > 0) {
        segments.push({ text: formatToolSummarySegment(cat, done, 'done', t), type: 'normal' })
      } else {
        // 纯失败
        if (failed === 1) {
          segments.push({ text: formatToolSummarySegment(cat, failed, 'failed', t), type: 'error' })
        } else {
          segments.push({ text: formatToolSummarySegment(cat, failed, 'done', t), type: 'error' })
          segments.push({ text: t('toolSteps.failedAllSuffix'), type: 'error' })
        }
      }
    }
  }

  if (finishedCategories.length <= MAX_CATEGORIES) {
    pushFinishedSegments(finishedCategories)
  } else {
    pushFinishedSegments(finishedCategories.slice(0, MAX_CATEGORIES))
    const restCount = finishedCategories
      .slice(MAX_CATEGORIES)
      .reduce((sum, cat) => sum + (doneMap.get(cat) || 0) + (failedMap.get(cat) || 0), 0)
    segments.push({ text: sep, type: 'normal' })
    segments.push({ text: t('toolSteps.moreActions', { count: restCount }), type: 'normal' })
  }

  // ── 运行中 ──
  const activeCategories = categoryOrder.filter(cat => (activeMap.get(cat) || 0) > 0)
  for (const cat of activeCategories) {
    if (segments.length > 0) segments.push({ text: sep, type: 'normal' })
    segments.push({ text: formatToolSummarySegment(cat, activeMap.get(cat) || 0, 'active', t), type: 'active' })
  }

  if (segments.length === 0) {
    return [{ text: t('stepsCount', { done: 0, total: parts.length }), type: 'normal' }]
  }

  let isFirstContent = true
  for (const seg of segments) {
    if (seg.text === sep) continue
    if (isFirstContent) {
      isFirstContent = false
      continue
    }
    seg.text = seg.text.charAt(0).toLowerCase() + seg.text.slice(1)
  }

  return segments
}

function formatToolSummarySegment(
  category: ToolSummaryCategory,
  count: number,
  phase: ToolSummaryPhase,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const key = `toolSteps.${category}${phase.charAt(0).toUpperCase()}${phase.slice(1)}`
  return t(key, { count })
}

function getToolSummaryCategory(toolName: string): ToolSummaryCategory {
  const lower = toolName.toLowerCase()

  if (lower.includes('todo')) return 'todo'
  if (lower === 'task') return 'task'
  if (lower.includes('question') || lower.includes('ask')) return 'question'
  if (lower.includes('skill')) return 'skill'
  if (
    lower.includes('bash') ||
    lower === 'sh' ||
    lower.includes('cmd') ||
    lower.includes('terminal') ||
    lower.includes('shell')
  ) {
    return 'execute'
  }
  if (lower.includes('write') || lower.includes('save')) {
    return 'write'
  }
  if (lower.includes('edit') || lower.includes('replace') || lower.includes('patch')) {
    return 'edit'
  }
  if (
    lower.includes('web') ||
    lower.includes('fetch') ||
    lower.includes('http') ||
    lower.includes('browse') ||
    lower.includes('network') ||
    lower.includes('exa')
  ) {
    return 'network'
  }
  if (lower.includes('read') || lower.includes('cat')) return 'read'
  if (lower.includes('grep') || lower.includes('search')) return 'search'
  if (lower.includes('glob') || lower.includes('find')) return 'list'
  if (lower.includes('think') || lower.includes('reason') || lower.includes('plan')) return 'think'
  return 'other'
}

function isToolPartActive(part: ToolPart): boolean {
  return part.state.status === 'running' || part.state.status === 'pending'
}

function getTaskChildSessionId(part: ToolPart): string | undefined {
  if (part.tool.toLowerCase() !== 'task') return undefined
  const metadata = part.state.metadata as Record<string, unknown> | undefined
  return metadata?.sessionId as string | undefined
}

/** 从 extractToolData 的结果计算 diff stats（当 metadata 没给 diffStats 时） */
function computePartDiffStats(data: {
  diff?: { before: string; after: string } | string
  files?: Array<{ before?: string; after?: string; additions?: number; deletions?: number }>
}): { additions: number; deletions: number } | undefined {
  if (data.files?.length) {
    let a = 0,
      d = 0
    for (const f of data.files) {
      if (f.additions !== undefined) a += f.additions
      if (f.deletions !== undefined) d += f.deletions
      if (f.additions === undefined && f.before !== undefined && f.after !== undefined) {
        const s = diffPairStats(f.before, f.after)
        a += s.additions
        d += s.deletions
      }
    }
    return a || d ? { additions: a, deletions: d } : undefined
  }
  if (data.diff && typeof data.diff === 'object') {
    const s = diffPairStats(data.diff.before, data.diff.after)
    return s.additions || s.deletions ? s : undefined
  }
  return undefined
}

function diffPairStats(before: string, after: string): { additions: number; deletions: number } {
  const changes = diffLines(before, after)
  let additions = 0,
    deletions = 0
  for (const c of changes) {
    if (c.added) additions += c.count || 0
    if (c.removed) deletions += c.count || 0
  }
  return { additions, deletions }
}

// ============================================
// Helper: Group parts for rendering
// ============================================

type RenderItem =
  | { type: 'single'; part: Part }
  | { type: 'tool-group'; parts: ToolPart[]; stepFinish?: StepFinishPart }

/** parts[from..] 跳过基础设施和空内容后，下一个有意义的 part 是否为 tool */
function hasMoreToolsAhead(parts: Part[], from: number): boolean {
  for (let k = from; k < parts.length; k++) {
    const part = parts[k]
    if (part.type === 'step-start' || part.type === 'step-finish' || part.type === 'snapshot' || part.type === 'patch')
      continue
    if (part.type === 'text' && !isVisibleTextPart(part)) continue
    if (part.type === 'reasoning' && !isVisibleReasoningPart(part)) continue
    return part.type === 'tool'
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
    if (part.type === 'text' && !isVisibleTextPart(part)) continue
    if (part.type === 'reasoning' && !isVisibleReasoningPart(part)) continue

    if (isToolPart(part)) {
      toolGroup.push(part)
    } else if (part.type === 'step-finish') {
      if (toolGroup.length > 0 && hasMoreToolsAhead(parts, i + 1)) {
        // 中间 step-finish：后面还有 tool，暂存不 flush
        stepFinish = part
      } else if (toolGroup.length > 0) {
        // 最后一个 step-finish，结束 tool group
        flushToolGroup(part)
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
