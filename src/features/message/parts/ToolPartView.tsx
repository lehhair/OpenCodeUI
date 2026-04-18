import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { diffLines } from 'diff'
import { ChevronDownIcon, ChevronRightIcon } from '../../../components/Icons'
import type { ToolPart } from '../../../types/message'
import { useDelayedRender } from '../../../hooks'
import { useTheme } from '../../../hooks/useTheme'
import { formatToolName, formatDuration } from '../../../utils/formatUtils'
import {
  useInlineToolRequests,
  findPermissionRequestForTool,
  findQuestionRequestForTool,
} from '../../chat/InlineToolRequestContext'
import { InlinePermission } from '../../chat/InlinePermission'
import { InlineQuestion } from '../../chat/InlineQuestion'
import {
  getToolIcon,
  extractToolData,
  getToolConfig,
  DefaultRenderer,
  TodoRenderer,
  TaskRenderer,
  hasTodos,
} from '../tools'

// ============================================
// ToolPartView - 单个工具调用
// ============================================

interface ToolPartViewProps {
  part: ToolPart
  isFirst?: boolean
  isLast?: boolean
  /** Compact layout: icon inline with text (14px column), no timeline connectors.
   *  Used for single-tool groups to align with ReasoningPartView. */
  compact?: boolean
  /** Descriptive steps mode: no icon/timeline, flat rows aligned with step summary. */
  descriptive?: boolean
  /** Parent assistant message is still streaming. */
  isStreaming?: boolean
}

export const ToolPartView = memo(function ToolPartView({
  part,
  isFirst = false,
  isLast = false,
  compact = false,
  descriptive = false,
  isStreaming = false,
}: ToolPartViewProps) {
  const { t } = useTranslation('message')
  const { state, tool: toolName } = part
  const title = state.title || getInputDescription(part) || ''

  const duration = state.time?.start && state.time?.end ? state.time.end - state.time.start : undefined

  const isActive = state.status === 'running' || state.status === 'pending'
  const isError = state.status === 'error'
  const { inlineToolRequests, immersiveMode, compactInlinePermission } = useTheme()

  const { pendingPermissions, pendingQuestions, onPermissionReply, onQuestionReply, onQuestionReject, isReplying } =
    useInlineToolRequests()
  const childSessionId = getTaskChildSessionId(part)
  const permissionRequest = inlineToolRequests
    ? findPermissionRequestForTool(pendingPermissions, part.callID, childSessionId)
    : undefined
  const questionRequest = inlineToolRequests
    ? findQuestionRequestForTool(pendingQuestions, part.callID, childSessionId)
    : undefined

  const toolDone = state.status === 'completed' || state.status === 'error'
  // ── 延迟卸载 edit/write 权限组件 ──
  // 用户授权后 permissionRequest 会立即消失，但工具结果可能还没到，
  // 为了避免 "权限消失→空白→结果出现" 的跳动，缓存最后一次权限请求，
  // 在工具完成之前继续渲染（以 resolved 状态）
  const [cachedPermissionRequest, setCachedPermissionRequest] = useState(permissionRequest)
  useEffect(() => {
    if (permissionRequest) {
      setCachedPermissionRequest(permissionRequest)
      return
    }
    if (toolDone) {
      setCachedPermissionRequest(undefined)
    }
  }, [permissionRequest, toolDone])

  const effectivePermissionRequest = permissionRequest || cachedPermissionRequest
  const isFilePermission =
    effectivePermissionRequest?.permission === 'edit' || effectivePermissionRequest?.permission === 'write'
  // 权限已批准但工具还没完成 → 保留渲染
  const permissionResolved = !permissionRequest && !!cachedPermissionRequest && isFilePermission && !toolDone

  const hasPendingInteraction = !!permissionRequest || !!questionRequest
  // 精简模式：非 edit/write 权限时不隐藏 ToolBody（ToolBody 已经渲染了命令内容）
  const isEditWritePermission =
    permissionRequest?.permission === 'edit' || permissionRequest?.permission === 'write' || permissionResolved
  const hideToolBodyForPermission = isEditWritePermission
  // 精简模式：ToolBody 已渲染时，InlinePermission 只显示按钮
  // task 工具除外：task renderer 无法显示详细的工具请求内容，需要完整展示权限信息
  const isTaskTool = toolName.toLowerCase() === 'task'
  const permissionContentHidden =
    compactInlinePermission && !isEditWritePermission && !isTaskTool && !!permissionRequest
  const isReadable = isReadableTool(toolName)
  const shouldStartExpanded =
    isActive ||
    hasPendingInteraction ||
    permissionResolved ||
    (immersiveMode && descriptive && isStreaming && isReadable)

  const [expanded, setExpanded] = useState(() => shouldStartExpanded)
  const hasAutoExpandedReadableRef = useRef(shouldStartExpanded && immersiveMode && descriptive && isReadable)
  const effectiveExpanded = expanded || hasPendingInteraction || permissionResolved
  const shouldRenderBody = useDelayedRender(effectiveExpanded)

  useEffect(() => {
    if (isActive || hasPendingInteraction || permissionResolved) {
      if (immersiveMode && descriptive && isReadable) {
        hasAutoExpandedReadableRef.current = true
      }
      setExpanded(true)
    } else if (immersiveMode && descriptive && !isReadable) {
      setExpanded(false)
    } else if (immersiveMode && descriptive && isStreaming && isReadable && !hasAutoExpandedReadableRef.current) {
      hasAutoExpandedReadableRef.current = true
      setExpanded(true)
    }
  }, [isActive, hasPendingInteraction, permissionResolved, immersiveMode, descriptive, isStreaming, isReadable])

  // Shared icon element
  const toolIcon = (
    <div
      className={`
      relative flex items-center justify-center transition-colors duration-200
      ${isActive ? 'text-accent-main-100' : ''}
      ${isError ? 'text-danger-100' : ''}
      ${state.status === 'completed' ? 'text-text-400 group-hover:text-text-300' : ''}
    `}
    >
      {isActive && (
        <span
          className="absolute inset-0 rounded-full bg-accent-main-100/20 animate-ping"
          style={{ animationDuration: '1.5s' }}
        />
      )}
      {getToolIcon(toolName)}
    </div>
  )

  // 需要渲染权限组件的请求对象：优先用活跃的，否则用缓存的（resolved 态）
  const displayPermission = permissionRequest || (permissionResolved ? cachedPermissionRequest : undefined)

  // Memoize once — shared by both the descriptive header (diffStats) and ToolBody.
  const toolData = useMemo(() => extractToolData(part), [part])

  const bodyContent = (
    <>
      {!hideToolBodyForPermission && <ToolBody part={part} data={toolData} />}
      {displayPermission && (
        <div className={hideToolBodyForPermission && !permissionContentHidden ? '' : 'pt-2'}>
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
        <div className="pt-2">
          <InlineQuestion
            request={questionRequest}
            onReply={onQuestionReply}
            onReject={onQuestionReject}
            isReplying={isReplying}
          />
        </div>
      )}
    </>
  )

  if (descriptive) {
    const hasDiffFiles = !!toolData.files?.length
    // diffStats 可能从 metadata 来，也可能需要从 diff 数据计算
    const diffStats = toolData.diffStats || computeDiffStatsFromData(toolData)

    return (
      <div className="group py-0.5">
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-md px-0 py-1 text-left hover:bg-bg-200/30 transition-colors group/header"
          onClick={() => setExpanded(!expanded)}
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
            {duration !== undefined && state.status === 'completed' && (
              <span
                className={`text-[length:var(--fs-xxs)] font-mono tabular-nums ${isError ? 'text-danger-100/70' : 'text-text-500'}`}
              >
                {formatDuration(duration)}
              </span>
            )}
          </div>
        </button>

        <div
          className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
            effectiveExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
          }`}
        >
          <div className="overflow-hidden">{shouldRenderBody && <div className="pb-2 pt-1">{bodyContent}</div>}</div>
        </div>
      </div>
    )
  }

  // ── Compact layout (single-tool, no timeline) ──
  // Grid: [14px icon] [gap 6px] [content] — mirrors ReasoningPartView alignment
  if (compact) {
    return (
      <div className="group relative grid grid-cols-[14px_minmax(0,1fr)] gap-x-1.5 items-start py-1">
        {/* Icon column — fixed, outside of interactive area */}
        <span className="inline-flex h-9 w-[14px] items-center justify-center shrink-0">{toolIcon}</span>

        {/* Content column */}
        <div className="min-w-0">
          <button
            className="flex items-center gap-2 w-full h-9 text-left pl-2 pr-0 hover:bg-bg-200/40 rounded-sm transition-colors group/header"
            onClick={() => setExpanded(!expanded)}
          >
            <div className="flex items-baseline gap-2 overflow-hidden flex-1 min-w-0">
              <span
                className={`font-medium text-[length:var(--fs-md)] leading-tight transition-colors duration-300 shrink-0 ${
                  isActive
                    ? 'text-accent-main-100'
                    : isError
                      ? 'text-danger-100'
                      : 'text-text-200 group-hover/header:text-text-100'
                }`}
              >
                {formatToolName(toolName)}
              </span>
              {title && (
                <span className="text-[length:var(--fs-sm)] text-text-400 truncate min-w-0 flex-1 font-mono opacity-70">
                  {title}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 ml-auto shrink-0">
              {duration !== undefined && state.status === 'completed' && (
                <span className="text-[length:var(--fs-xxs)] font-mono text-text-500 tabular-nums">
                  {formatDuration(duration)}
                </span>
              )}
              <span
                className={`text-[length:var(--fs-xxs)] font-medium transition-all duration-300 ${
                  isActive ? 'opacity-100 text-accent-main-100' : 'opacity-0 w-0 overflow-hidden'
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

          {/* Body */}
          <div
            className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
              effectiveExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
            }`}
          >
            <div className="overflow-hidden">
              {shouldRenderBody && <div className="pl-2 pr-2.5 pb-2 pt-1">{bodyContent}</div>}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Timeline layout (multi-tool groups) ──
  return (
    <div className="group relative flex min-w-0">
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
          className="flex items-center gap-2.5 w-full h-9 text-left pl-2 pr-0 hover:bg-bg-200/40 rounded-sm transition-colors group/header"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex items-baseline gap-2 overflow-hidden flex-1 min-w-0">
            <span
              className={`font-medium text-[length:var(--fs-md)] leading-tight transition-colors duration-300 shrink-0 ${
                isActive
                  ? 'text-accent-main-100'
                  : isError
                    ? 'text-danger-100'
                    : 'text-text-200 group-hover/header:text-text-100'
              }`}
            >
              {formatToolName(toolName)}
            </span>

            {title && (
              <span className="text-[length:var(--fs-sm)] text-text-400 truncate min-w-0 flex-1 font-mono opacity-70">
                {title}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 ml-auto shrink-0">
            {duration !== undefined && state.status === 'completed' && (
              <span className="text-[length:var(--fs-xxs)] font-mono text-text-500 tabular-nums transition-opacity duration-300">
                {formatDuration(duration)}
              </span>
            )}
            <span
              className={`text-[length:var(--fs-xxs)] font-medium transition-all duration-300 ${
                isActive ? 'opacity-100 text-accent-main-100' : 'opacity-0 w-0 overflow-hidden'
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

        {/* Body - grid collapse */}
        <div
          className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
            effectiveExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
          }`}
        >
          <div className="overflow-hidden">
            {shouldRenderBody && <div className="pl-2 pr-2.5 pb-2 pt-1">{bodyContent}</div>}
          </div>
        </div>
      </div>
    </div>
  )
})

// ============================================
// Helpers
// ============================================

/** 用户需要阅读/交互的工具 */
const READABLE_TOOL_PATTERNS = /bash|\bsh\b|cmd|terminal|shell|write|save|edit|replace|patch|todo|question|ask/i

function isReadableTool(toolName: string): boolean {
  return READABLE_TOOL_PATTERNS.test(toolName.toLowerCase())
}

/** 从 diff 数据计算 diffStats（当 metadata 没给 diffStats 时用） */
function computeDiffStatsFromData(data: {
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
        const s = computeDiffPair(f.before, f.after)
        additions += s.additions
        deletions += s.deletions
      }
    }
    return additions || deletions ? { additions, deletions } : undefined
  }

  // 单个 diff
  if (data.diff && typeof data.diff === 'object') {
    const s = computeDiffPair(data.diff.before, data.diff.after)
    return s.additions || s.deletions ? s : undefined
  }

  return undefined
}

function computeDiffPair(before: string, after: string): { additions: number; deletions: number } {
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
// ToolBody - 根据工具类型选择渲染器
// ============================================

const ToolBody = memo(function ToolBody({ part, data }: { part: ToolPart; data: ReturnType<typeof extractToolData> }) {
  const { tool } = part
  const lowerTool = tool.toLowerCase()

  if (lowerTool === 'task') {
    return <TaskRenderer part={part} data={data} />
  }

  if (lowerTool.includes('todo') && hasTodos(part)) {
    return <TodoRenderer part={part} data={data} />
  }

  const config = getToolConfig(tool)
  if (config?.renderer) {
    const CustomRenderer = config.renderer
    return <CustomRenderer part={part} data={data} />
  }

  return <DefaultRenderer part={part} data={data} />
})

function getTaskChildSessionId(part: ToolPart): string | undefined {
  if (part.tool.toLowerCase() !== 'task') return undefined
  const metadata = part.state.metadata as Record<string, unknown> | undefined
  return metadata?.sessionId as string | undefined
}

/** Extract description from tool input as title fallback (available while running) */
function getInputDescription(part: ToolPart): string | undefined {
  const input = part.state.input as Record<string, unknown> | undefined
  return (input?.description as string) || undefined
}

// ============================================
// Helpers
// ============================================
