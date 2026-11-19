import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDownIcon, ChevronRightIcon } from '../../../components/Icons'
import { useCompositorExpand, useDisclosureScrollLock } from '../../../hooks'
import { getResponsiveMaxHeight } from '../../../hooks/useResponsiveMaxHeight'
import { useNearViewport } from '../../../hooks/useInView'
import { useNow } from '../../../hooks/useNow'
import { serverStore } from '../../../store/serverStore'
import { useTheme } from '../../../hooks/useTheme'
import { formatToolName, formatDuration } from '../../../utils/formatUtils'
import { useUiDisclosureState } from '../../../utils/uiDisclosureState'
import {
  useInlineToolRequests,
  findPermissionRequestForTool,
  findQuestionRequestForTool,
  type TaskChildSessionRef,
} from '../../chat/InlineToolRequestContext'
import { InlinePermission } from '../../chat/InlinePermission'
import { InlineQuestion } from '../../chat/InlineQuestion'
import { extractPermissionDiff } from '../../chat/permissionDiff'
import {
  getToolIcon,
  extractToolData,
  getToolConfig,
  DefaultRenderer,
  TaskRenderer,
  type ToolViewPart,
  type ToolViewContext,
} from '../tools'
import { currentToolFailed, currentToolInput, currentToolMetadata } from '../../../types/api/toolState'
import { diffLineStats } from '../../../utils/diffUtils'
import { resolveTaskChildSessionRef } from '../../../utils/taskChildBinding'
import { executeSubCallSummary, parseCodeModeToolCalls } from './executeSubCallSummary'
import { MSG_SPACING } from '../messageSpacing'
import { MessageExpandPanel, useMessageExpandRender } from '../messageExpand'

// ============================================
// ToolPartView - 单个工具调用
// ============================================

interface ToolPartViewProps {
  /** v2 原生工具内容 + 所属 messageID */
  part: ToolViewPart
  /** 所属助手消息的计时上下文（工具自身没有起止时间，v2 只在消息上有） */
  context?: ToolViewContext
  isFirst?: boolean
  isLast?: boolean
  /** Compact layout: icon inline with text (14px column), no timeline connectors.
   *  Used for single-tool groups to align with ReasoningPartView. */
  compact?: boolean
  /** Descriptive steps mode: no icon/timeline, flat rows aligned with step summary. */
  descriptive?: boolean
  /** Parent assistant message is still streaming. */
  isStreaming?: boolean
  /**
   * 大工具组（几十条命令）里只挂视口附近的 body。
   * 小工具组保持原来的「展开即挂」行为，别为了性能牺牲可读性和可访问性。
   */
  lazyBody?: boolean
}

export const ToolPartView = memo(function ToolPartView({
  part,
  context,
  isFirst = false,
  isLast = false,
  compact = false,
  descriptive = false,
  isStreaming = false,
  lazyBody = false,
}: ToolPartViewProps) {
  const { t } = useTranslation('message')
  const { state, name: toolName } = part
  const metadata = currentToolMetadata(part)
  const title = (metadata.title as string) || getInputDescription(part) || ''

  const isActive = state.status === 'running' || state.status === 'streaming'
  // 失败判定含「completed 但进程失败」（shell 非零退出 / 超时）
  const isError = currentToolFailed(part)
  const now = useNow(250, isActive)
  // v2 的工具状态里没有起止时间：running 用消息创建时间兜底，
  // 完成后只有消息级 completed（同一消息里多个工具无法各自计时）。
  const startTime = context?.created
  const calibratedNow = isActive ? serverStore.getActiveCalibratedNow() : undefined
  const endTime = isActive ? (calibratedNow ?? now) : context?.completed
  const rawDuration = startTime !== undefined && endTime !== undefined ? endTime - startTime : undefined
  const duration = rawDuration !== undefined && isActive ? Math.max(0, rawDuration) : rawDuration
  const { inlineToolRequests, immersiveMode, compactInlinePermission } = useTheme()

  const { serverId, pendingPermissions, pendingQuestions, onPermissionReply, onFormReply, onFormCancel, isReplying } =
    useInlineToolRequests()
  const childSession = getTaskChildSessionRef(part, serverId)
  const permissionRequest = inlineToolRequests
    ? findPermissionRequestForTool(pendingPermissions, part.id, childSession)
    : undefined
  const questionRequest = inlineToolRequests
    ? findQuestionRequestForTool(pendingQuestions, part.id, childSession)
    : undefined

  const toolDone = state.status === 'completed' || state.status === 'error'
  // ── 延迟卸载 edit/write 权限组件 ──
  // 用户授权后 permissionRequest 会立即消失，但工具结果可能还没到，
  // 为了避免 "权限消失→空白→结果出现" 的跳动，缓存最后一次权限请求，
  // 在工具完成之前继续渲染（以 resolved 状态）
  const [cachedPermissionRequest, setCachedPermissionRequest] = useState(permissionRequest)
  useEffect(() => {
    let frameId: number | null = null

    if (permissionRequest) {
      frameId = requestAnimationFrame(() => {
        setCachedPermissionRequest(permissionRequest)
      })
    } else {
      // 权限已处理（本端或他端批准/拒绝）：edit/write 等工具完成再清缓存，
      // 避免 "权限消失→空白→结果出现" 的跳动；其余权限立即清缓存让卡片消失，
      // 命令/输出交给 ToolBody 展示，否则按钮会一直残留到工具跑完。
      frameId = requestAnimationFrame(() => {
        setCachedPermissionRequest(prev => {
          if (!prev) return prev
          const cachedIsFile = prev.action === 'edit' || prev.action === 'write'
          return cachedIsFile && !toolDone ? prev : undefined
        })
      })
    }

    return () => {
      if (frameId !== null) cancelAnimationFrame(frameId)
    }
  }, [permissionRequest, toolDone])

  const effectivePermissionRequest = permissionRequest || cachedPermissionRequest
  const isFilePermission =
    effectivePermissionRequest?.action === 'edit' || effectivePermissionRequest?.action === 'write'
  // 权限已批准但工具还没完成 → 保留渲染
  const permissionResolved = !permissionRequest && !!cachedPermissionRequest && isFilePermission && !toolDone

  const hasPendingInteraction = !!permissionRequest || !!questionRequest
  // 精简模式：非 edit/write 权限时不隐藏 ToolBody（ToolBody 已经渲染了命令内容）
  const isEditWritePermission =
    permissionRequest?.action === 'edit' || permissionRequest?.action === 'write' || permissionResolved
  // metadata 里有 diff → 交给 InlinePermission 显示（藏 ToolBody，避免重复渲染）；
  // metadata 缺 diff（官方 edit 多匹配未给 preview）→ ToolBody 用 input 派生兜底。
  const permissionDiff = isEditWritePermission ? extractPermissionDiff(effectivePermissionRequest?.metadata) : null
  const permissionHasDiff = !!(
    permissionDiff &&
    (permissionDiff.diff || (permissionDiff.before !== undefined && permissionDiff.after !== undefined))
  )
  const hideToolBodyForPermission = isEditWritePermission && permissionHasDiff
  // 精简模式：ToolBody 已渲染时，InlinePermission 只显示按钮
  // task/subagent 工具除外：其 renderer 无法显示详细的工具请求内容，需要完整展示权限信息
  const toolNameLower = toolName.toLowerCase()
  const isTaskTool = toolNameLower === 'task' || toolNameLower === 'subagent'
  const permissionContentHidden =
    compactInlinePermission && !isTaskTool && !!permissionRequest && (isEditWritePermission ? !permissionHasDiff : true)
  const isReadable = isReadableTool(toolName)
  const shouldStartExpanded =
    isActive ||
    hasPendingInteraction ||
    permissionResolved ||
    (immersiveMode && descriptive && isStreaming && isReadable)

  const [expanded, setExpanded] = useUiDisclosureState(`message:${part.messageID}:tool:${part.id}`, shouldStartExpanded)
  const hasAutoExpandedReadableRef = useRef(shouldStartExpanded && immersiveMode && descriptive && isReadable)
  const [isChildFullscreen, setIsChildFullscreen] = useState(false)
  const { rootRef, headerRef, withScrollLock } = useDisclosureScrollLock()
  // 长工具组（几十上百条命令）展开时，body 只挂视口附近的：
  // 93 张卡同时挂 100KB 输出会让渲染进程直接卡死/崩溃。
  // 提前量取 2 屏，和虚拟列表预渲染窗口对齐，滚到时输出已经挂好了。
  const { ref: nearRef, near } = useNearViewport('200% 0px', lazyBody)
  const setRootRef = useCallback(
    (node: HTMLDivElement | null) => {
      rootRef(node)
      nearRef(node)
    },
    [nearRef, rootRef],
  )
  const forcedExpanded = hasPendingInteraction || permissionResolved || isChildFullscreen
  const effectiveExpanded = expanded || forcedExpanded
  // Android expand: instant layout + max-height fake; collapse: original grid-rows.
  const {
    contentRef: expandContentRef,
    layoutOpen,
    keepMounted,
    panelClassName,
  } = useCompositorExpand(effectiveExpanded)
  // 展开即挂 body：默认展开的工具 header/body 同帧，不再先 header 后 body。
  // 只有大组才按视口门控；权限/全屏这类必须保持挂载。
  const shouldRenderBody = useMessageExpandRender(keepMounted && (!lazyBody || near || forcedExpanded))
  // 离屏卸载后留一个等高占位，避免长列表高度抖动
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const [bodyHeight, setBodyHeight] = useState<number | null>(null)
  useEffect(() => {
    if (!lazyBody || !shouldRenderBody) return
    const node = bodyRef.current
    if (!node) return
    const measure = () => setBodyHeight(node.offsetHeight)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [lazyBody, shouldRenderBody])
  const toggleExpanded = useCallback(() => {
    withScrollLock(() => setExpanded(!expanded))
  }, [expanded, setExpanded, withScrollLock])

  useEffect(() => {
    let frameId: number | null = null

    if (isActive || hasPendingInteraction || permissionResolved) {
      if (immersiveMode && descriptive && isReadable) {
        hasAutoExpandedReadableRef.current = true
      }
      frameId = requestAnimationFrame(() => {
        setExpanded(true, { touched: false, respectUser: true })
      })
    } else if (immersiveMode && descriptive && !isReadable) {
      frameId = requestAnimationFrame(() => {
        setExpanded(false, { touched: false, respectUser: true })
      })
    } else if (immersiveMode && descriptive && isStreaming && isReadable && !hasAutoExpandedReadableRef.current) {
      hasAutoExpandedReadableRef.current = true
      frameId = requestAnimationFrame(() => {
        setExpanded(true, { touched: false, respectUser: true })
      })
    }

    return () => {
      if (frameId !== null) cancelAnimationFrame(frameId)
    }
  }, [
    isActive,
    hasPendingInteraction,
    permissionResolved,
    immersiveMode,
    descriptive,
    isStreaming,
    isReadable,
    setExpanded,
  ])

  // Shared icon element
  const toolIcon = (
    <div
      className={`
      relative flex items-center justify-center transition-colors duration-200
      ${isActive ? 'text-text-300' : ''}
      ${isError ? 'text-danger-100' : ''}
      {state.status === 'completed' && !isError ? 'text-text-400 group-hover:text-text-300' : ''}
    `}
    >
      {getToolIcon(toolName)}
    </div>
  )

  // 需要渲染权限组件的请求对象：优先用活跃的，否则用缓存的（resolved 态）
  const displayPermission = permissionRequest || (permissionResolved ? cachedPermissionRequest : undefined)

  // Memoize once — shared by both the descriptive header (diffStats) and ToolBody.
  const toolData = useMemo(() => extractToolData(part), [part])

  // 还没量过的展开卡给一个估计高度：大多数工具输出都会被 maxHeight 截住，
  // 用 0 会让列表先塌成 header、IO 一次命中一大片，反而一锅端挂载。
  const placeholderHeight = useMemo(() => {
    if (!lazyBody || !effectiveExpanded) return 0
    // null = 还没量过；0 是量过的真实高度（例如 todowrite / skill 这类没有 body 的卡）
    if (bodyHeight !== null) return bodyHeight
    const capped = getResponsiveMaxHeight() + 50
    // diff 类 body 基本都是 maxHeight 量级
    if (toolData.files?.length || toolData.diff) return capped
    const outputChars = toolData.output?.length ?? 0
    if (outputChars <= 0) return 110
    if (outputChars > 600) return capped
    return Math.min(capped, Math.ceil(outputChars / 80) * 19 + 90)
  }, [bodyHeight, effectiveExpanded, lazyBody, toolData.diff, toolData.files, toolData.output])

  const handleFullscreenChange = useCallback((isFullscreen: boolean) => {
    setIsChildFullscreen(isFullscreen)
  }, [])

  const bodyContent = (
    <>
      {!hideToolBodyForPermission && (
        <ToolBody part={part} data={toolData} context={context} onFullscreenChange={handleFullscreenChange} />
      )}
      {displayPermission && (
        <div className={hideToolBodyForPermission && !permissionContentHidden ? '' : MSG_SPACING.inner}>
          <InlinePermission
            request={displayPermission}
            onReply={onPermissionReply}
            isReplying={isReplying}
            resolved={permissionResolved}
            contentHidden={permissionContentHidden}
          />
        </div>
      )}
      {questionRequest && (
        <div className={MSG_SPACING.inner}>
          <InlineQuestion
            form={questionRequest}
            onReply={(_formId, answer) => onFormReply(questionRequest, answer)}
            onCancel={() => onFormCancel(questionRequest)}
            isReplying={isReplying}
          />
        </div>
      )}
    </>
  )

  const expandBody = (padClass: string) => (
    <MessageExpandPanel
      open={layoutOpen}
      panelClassName={panelClassName}
      contentRef={expandContentRef}
      innerClassName="overflow-hidden min-h-0"
      contentClassName={padClass}
    >
      {shouldRenderBody ? (
        <div ref={bodyRef}>{bodyContent}</div>
      ) : placeholderHeight > 0 ? (
        <div style={{ height: placeholderHeight }} aria-hidden />
      ) : null}
    </MessageExpandPanel>
  )

  if (descriptive) {
    const hasDiffFiles = !!toolData.files?.length
    // diffStats 可能从 metadata 来，也可能需要从 diff 数据计算
    const diffStats = toolData.diffStats || computeDiffStatsFromData(toolData)

    return (
      <div ref={setRootRef} className={`group ${MSG_SPACING.item}`}>
        <button
          type="button"
          ref={headerRef}
          className={`flex w-full items-center gap-3 rounded-md px-0 ${MSG_SPACING.header} text-left hover:bg-bg-200/30 transition-colors group/header`}
          onClick={toggleExpanded}
        >
          <div className="flex min-w-0 flex-1 items-baseline gap-2 overflow-hidden">
            <span
              className={`shrink-0 font-medium text-[length:var(--fs-md)] leading-tight ${
                isActive
                  ? 'reasoning-shimmer-text'
                  : isError
                    ? 'text-danger-100'
                    : 'text-text-200 group-hover/header:text-text-100'
              }`}
            >
              {formatToolName(toolName)}
            </span>

            {title && (
              <span
                className={`min-w-0 truncate font-mono text-[length:var(--fs-code)] ${
                  isActive ? 'reasoning-shimmer-text' : isError ? 'text-danger-100/80' : 'text-text-400'
                }`}
              >
                {title}
              </span>
            )}

            {/* Diff stats — 紧跟 title，收起时且非失败时显示 */}
            {!effectiveExpanded && !isActive && !isError && (diffStats || hasDiffFiles) && (
              <span className="shrink-0 flex items-center gap-1 text-[length:var(--fs-xxs)] font-mono font-medium tabular-nums">
                {(diffStats?.additions ?? 0) > 0 && <span className="text-success-100">+{diffStats!.additions}</span>}
                {(diffStats?.deletions ?? 0) > 0 && <span className="text-danger-100">-{diffStats!.deletions}</span>}
              </span>
            )}
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            {duration !== undefined && (state.status === 'completed' || isActive) && (
              <span
                className={`text-[length:var(--fs-xxs)] font-mono tabular-nums ${isError ? 'text-danger-100/70' : isActive ? 'reasoning-shimmer-text' : 'text-text-500'}`}
              >
                {formatDuration(duration)}
              </span>
            )}
          </div>
        </button>

        {expandBody(MSG_SPACING.body)}
      </div>
    )
  }

  // ── Compact layout (single-tool, no timeline) ──
  // Grid: [14px icon] [gap 6px] [content] — mirrors ReasoningPartView alignment
  if (compact) {
    return (
      <div
        ref={setRootRef}
        className={`group relative grid grid-cols-[14px_minmax(0,1fr)] gap-x-1.5 items-start ${MSG_SPACING.item}`}
      >
        {/* Icon column — fixed, outside of interactive area */}
        <span className="inline-flex h-9 w-[14px] items-center justify-center shrink-0">{toolIcon}</span>

        {/* Content column */}
        <div className="min-w-0">
          <button
            type="button"
            ref={headerRef}
            className="flex items-center gap-2 w-full h-9 text-left pl-2 pr-0 hover:bg-bg-200/40 rounded-sm transition-colors group/header"
            onClick={toggleExpanded}
          >
            <div className="flex items-baseline gap-2 overflow-hidden flex-1 min-w-0">
              <span
                className={`font-medium text-[length:var(--fs-md)] leading-tight transition-colors duration-300 shrink-0 ${
                  isActive
                    ? 'reasoning-shimmer-text'
                    : isError
                      ? 'text-danger-100'
                      : 'text-text-200 group-hover/header:text-text-100'
                }`}
              >
                {formatToolName(toolName)}
              </span>
              {title && (
                <span
                  className={`text-[length:var(--fs-sm)] truncate min-w-0 flex-1 font-mono ${
                    isActive ? 'reasoning-shimmer-text' : 'text-text-400 opacity-70'
                  }`}
                >
                  {title}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 ml-auto shrink-0">
              {duration !== undefined && (state.status === 'completed' || isActive) && (
                <span
                  className={`text-[length:var(--fs-xxs)] font-mono tabular-nums ${
                    isActive ? 'reasoning-shimmer-text' : 'text-text-500'
                  }`}
                >
                  {formatDuration(duration)}
                </span>
              )}
              <span
                className={`text-[length:var(--fs-xxs)] font-medium transition-all duration-300 ${
                  isActive ? 'opacity-100 text-text-400' : 'opacity-0 w-0 overflow-hidden'
                }`}
              >
                {t('toolPart.running')}
              </span>
              <span
                className={`text-[length:var(--fs-xxs)] font-medium transition-all duration-300 ${
                  isError ? 'opacity-100 text-danger-100' : 'opacity-0 w-0 overflow-hidden'
                }`}
              >
                {t('toolPart.failed')}
              </span>
              <span className="text-text-500">
                {effectiveExpanded ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
              </span>
            </div>
          </button>

          {expandBody(MSG_SPACING.toolBodyInset)}
        </div>
      </div>
    )
  }

  // ── Timeline layout (multi-tool groups) ──
  // 根节点不加垂直 padding，连接线要贴 icon
  return (
    <div ref={setRootRef} className="group relative flex min-w-0">
      {/* Timeline Column */}
      <div className="w-8 shrink-0 relative">
        {/* Top connector — 留 4px gap 到 icon */}
        {!isFirst && <div className="absolute left-1/2 -translate-x-1/2 top-0 h-[7px] w-px bg-border-300/40" />}

        {/* Tool icon — h-9 和右侧 header 等高，flex 自然居中 */}
        <div className="h-9 flex items-center justify-center relative z-10">{toolIcon}</div>

        {/* Bottom connector — 留 4px gap 到 icon */}
        {!isLast && <div className="absolute left-1/2 -translate-x-1/2 top-[29px] bottom-0 w-px bg-border-300/40" />}
      </div>

      {/* Content Column */}
      <div className="flex-1 min-w-0">
        {/* Header - h-9 和 timeline 图标行等高 */}
        <button
          type="button"
          ref={headerRef}
          className="flex items-center gap-2.5 w-full h-9 text-left pl-2 pr-0 hover:bg-bg-200/40 rounded-sm transition-colors group/header"
          onClick={toggleExpanded}
        >
          <div className="flex items-baseline gap-2 overflow-hidden flex-1 min-w-0">
            <span
              className={`font-medium text-[length:var(--fs-md)] leading-tight transition-colors duration-300 shrink-0 ${
                isActive
                  ? 'reasoning-shimmer-text'
                  : isError
                    ? 'text-danger-100'
                    : 'text-text-200 group-hover/header:text-text-100'
              }`}
            >
              {formatToolName(toolName)}
            </span>

            {title && (
              <span
                className={`text-[length:var(--fs-sm)] truncate min-w-0 flex-1 font-mono ${
                  isActive ? 'reasoning-shimmer-text' : 'text-text-400 opacity-70'
                }`}
              >
                {title}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 ml-auto shrink-0">
            {duration !== undefined && (state.status === 'completed' || isActive) && (
              <span
                className={`text-[length:var(--fs-xxs)] font-mono tabular-nums transition-opacity duration-300 ${
                  isActive ? 'reasoning-shimmer-text' : 'text-text-500'
                }`}
              >
                {formatDuration(duration)}
              </span>
            )}
            <span
              className={`text-[length:var(--fs-xxs)] font-medium transition-all duration-300 ${
                isActive ? 'opacity-100 text-text-400' : 'opacity-0 w-0 overflow-hidden'
              }`}
            >
              {t('toolPart.running')}
            </span>
            <span
              className={`text-[length:var(--fs-xxs)] font-medium transition-all duration-300 ${
                isError ? 'opacity-100 text-danger-100' : 'opacity-0 w-0 overflow-hidden'
              }`}
            >
              {t('toolPart.failed')}
            </span>
            <span className="text-text-500">
              {effectiveExpanded ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
            </span>
          </div>
        </button>

        {expandBody(MSG_SPACING.toolBodyInset)}
      </div>
    </div>
  )
})

// ============================================
// Helpers
// ============================================

/** 用户需要阅读/交互的工具 */
const READABLE_TOOL_PATTERNS = /bash|\bsh\b|cmd|terminal|shell|write|save|edit|replace|patch|question|ask/i

function isReadableTool(toolName: string): boolean {
  return READABLE_TOOL_PATTERNS.test(toolName.toLowerCase())
}

/** 从 diff 数据计算 diffStats（当 metadata 没给 diffStats 时用） */
const diffStatsCache = new WeakMap<object, { additions: number; deletions: number } | undefined>()

function computeDiffStatsFromData(data: {
  diff?: { before: string; after: string } | string
  files?: Array<{ before?: string; after?: string; additions?: number; deletions?: number }>
}): { additions: number; deletions: number } | undefined {
  if (diffStatsCache.has(data)) return diffStatsCache.get(data)
  const stats = computeDiffStatsUncached(data)
  diffStatsCache.set(data, stats)
  return stats
}

function computeDiffStatsUncached(data: {
  diff?: { before: string; after: string } | string
  files?: Array<{ before?: string; after?: string; additions?: number; deletions?: number }>
}): { additions: number; deletions: number } | undefined {
  // 多文件
  if (data.files?.length) {
    let additions = 0,
      deletions = 0
    for (const f of data.files) {
      if (f.additions !== undefined) additions += f.additions
      if (f.deletions !== undefined) deletions += f.deletions
      if (f.additions === undefined && f.before !== undefined && f.after !== undefined) {
        const s = diffLineStats(f.before, f.after)
        if (s) {
          additions += s.additions
          deletions += s.deletions
        }
      }
    }
    return additions || deletions ? { additions, deletions } : undefined
  }

  // 单个 diff
  if (data.diff && typeof data.diff === 'object') {
    const s = diffLineStats(data.diff.before, data.diff.after)
    return s && (s.additions || s.deletions) ? s : undefined
  }

  return undefined
}

// ============================================
// ToolBody - 根据工具类型选择渲染器
// ============================================

const ToolBody = memo(function ToolBody({
  part,
  data,
  context,
  onFullscreenChange,
}: {
  part: ToolViewPart
  data: ReturnType<typeof extractToolData>
  context?: ToolViewContext
  onFullscreenChange?: (isFullscreen: boolean) => void
}) {
  const lowerTool = part.name.toLowerCase()

  // todowrite：官方整卡不渲染（session-ui/tool-renderer.tsx:1197）
  if (lowerTool === 'todowrite') return null

  if (lowerTool === 'task' || lowerTool === 'subagent') {
    return <TaskRenderer part={part} data={data} context={context} onFullscreenChange={onFullscreenChange} />
  }

  const config = getToolConfig(part.name)
  if (config?.renderer) {
    const CustomRenderer = config.renderer
    return <CustomRenderer part={part} data={data} context={context} onFullscreenChange={onFullscreenChange} />
  }

  return <DefaultRenderer part={part} data={data} context={context} onFullscreenChange={onFullscreenChange} />
})

/** task/subagent 工具派出的子 session：metadata 权威值 + 早期绑定表兜底（刷新后 progress 不可回放） */
function getTaskChildSessionRef(part: ToolViewPart, serverId: string): TaskChildSessionRef | undefined {
  return resolveTaskChildSessionRef(part, serverId)
}

/** Extract description from tool input as title fallback (available while running) */
function getInputDescription(part: ToolViewPart): string | undefined {
  const input = currentToolInput(part)
  if (typeof input.description === 'string' && input.description) return input.description
  // 文件名：官方 getFilename 同款（basename，兼容正反斜杠）
  const filename = (value: unknown) =>
    typeof value === 'string' && value ? value.split(/[\\/]/).filter(Boolean).pop() : undefined
  const name = part.name.toLowerCase()
  // 文件类工具：官方 v2 subtitle 是文件名（tool-renderer getToolInfo 同款）——
  // v1 靠 metadata.title 提供描述，v2 没有了，必须从 input 派生
  if (name === 'read' || name === 'edit' || name === 'write') return filename(input.path)
  // list：官方 subtitle 是目录路径（session-ui tool-renderer.tsx:1392-1412 同款）
  if (name === 'list' && typeof input.path === 'string') return input.path || '/'
  // glob/grep：官方 subtitle 是 pattern
  if ((name === 'glob' || name === 'grep') && typeof input.pattern === 'string' && input.pattern) {
    return input.pattern
  }
  // webfetch/websearch：官方 subtitle 是 url/query
  if (name === 'webfetch' && typeof input.url === 'string' && input.url) return input.url
  if (name === 'websearch' && typeof input.query === 'string' && input.query) return input.query
  // shell：官方 subtitle 是 command
  if ((name === 'shell' || name === 'bash') && typeof input.command === 'string' && input.command) {
    return input.command
  }
  // skill：官方 loadedSkill 行带技能名（input.name，session-ui:2178 同款）
  if (name === 'skill' && typeof input.name === 'string' && input.name) return input.name
  // execute（v2 CodeMode）：优先运行时子调用记录（metadata.toolCalls，带真实状态），
  // 其次静态解析 code 里的 tools.xxx(...) 调用点（流式早期即可用），
  // 最后退回官方做法——code 首行
  if (name === 'execute') {
    const chain =
      executeSubCallSummary(currentToolMetadata(part)) ??
      (typeof input.code === 'string' ? parseCodeModeToolCalls(input.code) : undefined)
    if (chain) return chain
    if (typeof input.code === 'string' && input.code.trim()) return input.code.trim().split('\n', 1)[0]
  }
  return undefined
}

// ============================================
// Helpers
// ============================================
