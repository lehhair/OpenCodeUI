import type { AssistantContent } from '../../types/api/message'
import type { ContentEntry } from '../../types/api/message'
import { currentToolFailed } from '../../types/api/toolState'
import { expandCodeModeSubCalls } from './parts/executeSubCallSummary'

export type ToolEntry = ContentEntry<Extract<AssistantContent, { type: 'tool' }>>

export type ToolSummaryCategory =
  | 'execute'
  | 'code'
  | 'write'
  | 'edit'
  | 'read'
  | 'search'
  | 'list'
  | 'network'
  | 'task'
  | 'question'
  | 'skill'
  | 'think'
  | 'other'

export type ToolSummaryPhase = 'done' | 'active' | 'failed'

export type SummarySegment = {
  text: string
  type: 'normal' | 'error' | 'active'
}

/** 工具是否仍在执行中（v2 的活跃态是 streaming / running） */
export function isToolPartActive(tool: Extract<AssistantContent, { type: 'tool' }>): boolean {
  return tool.state.status === 'running' || tool.state.status === 'streaming'
}

export function getToolSummaryCategory(toolName: string): ToolSummaryCategory {
  const lower = toolName.toLowerCase()

  // v2 CodeMode 的 execute 工具是「运行一段编排其它工具的代码」，区别于 shell 命令
  if (lower === 'execute') return 'code'
  if (lower === 'task' || lower === 'subagent') return 'task'
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

function formatToolSummarySegment(
  category: ToolSummaryCategory,
  count: number,
  phase: ToolSummaryPhase,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const key = `toolSteps.${category}${phase.charAt(0).toUpperCase()}${phase.slice(1)}`
  return t(key, { count })
}

/**
 * 把一组工具调用汇总成一句人话：「读取了 2 个文件，运行了 1 条命令」。
 * 纯函数，翻译函数由调用方注入。
 */
export function buildDescriptiveToolStepsSummary(
  tools: ToolEntry[],
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

  for (const tool of tools) {
    // v2 CodeMode（execute）：展开成实际调用的子工具分别归类计数，
    // 摘要显示「读取了 2 个文件，写入了 1 个文件」而不是「运行了 1 段代码」
    const subCalls = expandCodeModeSubCalls(tool.content)
    if (subCalls) {
      const parentActive = isToolPartActive(tool.content)
      const parentFailed = currentToolFailed(tool.content)
      for (const sub of subCalls) {
        const cat = getToolSummaryCategory(sub.tool)
        if (!doneMap.has(cat)) {
          categoryOrder.push(cat)
          doneMap.set(cat, 0)
          failedMap.set(cat, 0)
          activeMap.set(cat, 0)
        }
        // 有运行时状态用真实状态；纯代码静态解析的继承父工具状态
        const status = sub.status ?? (parentActive ? 'running' : parentFailed ? 'error' : 'completed')
        if (status === 'running') activeMap.set(cat, (activeMap.get(cat) || 0) + 1)
        else if (status === 'error') failedMap.set(cat, (failedMap.get(cat) || 0) + 1)
        else doneMap.set(cat, (doneMap.get(cat) || 0) + 1)
      }
      continue
    }

    const cat = getToolSummaryCategory(tool.content.name)
    if (!doneMap.has(cat)) {
      categoryOrder.push(cat)
      doneMap.set(cat, 0)
      failedMap.set(cat, 0)
      activeMap.set(cat, 0)
    }
    if (isToolPartActive(tool.content)) activeMap.set(cat, (activeMap.get(cat) || 0) + 1)
    else if (currentToolFailed(tool.content)) failedMap.set(cat, (failedMap.get(cat) || 0) + 1)
    else doneMap.set(cat, (doneMap.get(cat) || 0) + 1)
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
    return [{ text: t('stepsCount', { done: 0, total: tools.length }), type: 'normal' }]
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
