// ============================================
// 工具状态读取（v2 原生）
//
// 移植自官方 packages/session-ui/src/message/current-tool-state.ts。
//
// 为什么需要这一层：v2 的 tool.state 是判别联合，且信息分布在
// metadata / content / error 三个不同位置：
//   streaming → input 是**字符串**（未解析的 JSON）
//   running   → input 是对象，metadata 里可能有 output
//   completed → content 是 ToolContent[]（文本或文件）
//   error     → error 是结构化对象 { type, message, status? }
//
// v1 的适配层曾把它压成 `output: string` 并 JSON.stringify 掉错误，
// 丢掉了「文件附件」「错误状态码」「shell 退出码」等信息。
// 因此这里按官方方式直接从原生结构读取，不再压平。
//
// 唯一改动：官方用 effect 的 Schema 解析流式 input 的 JSON 字符串，
// 这里换成等价的普通 try/catch（行为一致：解析失败返回空对象）。
// ============================================

import type { AssistantMessage, AssistantTool, ToolContent } from './message'

const EMPTY: Record<string, unknown> = {}

/** 解析流式 input 的 JSON 字符串；失败则返回空对象（与官方 decodeInput 等价） */
function parseStreamingInput(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // 流式过程中 JSON 往往还不完整，解析失败是正常的
  }
  return EMPTY
}

/** 工具当前的 input（streaming 时是半截 JSON 字符串，需要解析） */
export function currentToolInput(tool: AssistantTool): Record<string, unknown> {
  if (tool.state.status !== 'streaming') return tool.state.input
  return parseStreamingInput(tool.state.input)
}

/** 工具当前的 metadata（streaming 状态没有 metadata） */
export function currentToolMetadata(tool: AssistantTool): Record<string, unknown> {
  if (!('metadata' in tool.state)) return EMPTY
  return tool.state.metadata ?? EMPTY
}

/**
 * 工具产出文本。
 *
 * running 时官方从 `metadata.output` 取（shell 类工具边跑边出）；
 * completed/error 时把 `content` 里的文本片段拼起来。
 * 文件类 content 不拼成文本（由渲染层单独展示）。
 */
export function currentToolOutput(tool: AssistantTool): string | undefined {
  if (tool.state.status === 'running') {
    const output = tool.state.metadata.output
    return typeof output === 'string' ? output : undefined
  }
  if (!('content' in tool.state) || !tool.state.content) return undefined
  const text = tool.state.content.flatMap((item: ToolContent) => (item.type === 'text' ? [item.text] : [])).join('\n')
  return text || undefined
}

/** 工具产出的文件类内容（官方在 file-media 里单独渲染） */
export function currentToolFiles(tool: AssistantTool): Array<Extract<ToolContent, { type: 'file' }>> {
  if (!('content' in tool.state) || !tool.state.content) return []
  return tool.state.content.filter((item): item is Extract<ToolContent, { type: 'file' }> => item.type === 'file')
}

/** 工具错误信息（结构化 error 的 message —— 不是 JSON 串） */
export function currentToolError(tool: AssistantTool): string | undefined {
  if (tool.state.status !== 'error') return undefined
  return tool.state.error.message
}

/** 错误状态码（若有），用于错误卡片展示 */
export function currentToolErrorStatus(tool: AssistantTool): number | undefined {
  if (tool.state.status !== 'error') return undefined
  return tool.state.error.status
}

/** shell/execute 类工具的进程级失败（状态是 completed 但退出码非 0 或超时） */
export function shellResultFailed(metadata: Record<string, unknown>): boolean {
  // shell 的成败在 metadata 里，不在 tool status 里
  return metadata.timeout === true || (typeof metadata.exit === 'number' && metadata.exit !== 0)
}

/** 工具是否算失败（含 completed 但进程失败的情况） */
export function currentToolFailed(tool: AssistantTool): boolean {
  return (
    tool.state.status === 'error' ||
    (tool.name === 'execute' && executeToolFailed(currentToolMetadata(tool))) ||
    (tool.name === 'shell' && tool.state.status === 'completed' && shellResultFailed(currentToolMetadata(tool)))
  )
}

/** Code Mode 可能在 completed 里报告内部调用失败 */
export function executeToolFailed(metadata: Record<string, unknown>): boolean {
  const calls = metadata.toolCalls
  return (
    metadata.error === true ||
    (Array.isArray(calls) &&
      calls.some(
        call =>
          call !== null &&
          typeof call === 'object' &&
          !Array.isArray(call) &&
          'status' in call &&
          (call as { status?: unknown }).status === 'error',
      ))
  )
}

/** read 工具是否已加载文件（用于决定默认展开） */
export function currentToolHasLoadedFiles(tool: AssistantTool): boolean {
  if (tool.name !== 'read' || tool.state.status !== 'completed') return false
  const loaded = tool.state.metadata?.loaded
  return Array.isArray(loaded) && loaded.some(path => typeof path === 'string')
}

/** 内容默认是否展开（官方 currentContentDefaultOpen） */
export function currentContentDefaultOpen(
  content: AssistantMessage['content'][number],
  shellExpanded: boolean,
  editExpanded: boolean,
): boolean | undefined {
  if (content.type !== 'tool') return undefined
  // 出错的工具渲染错误卡片，默认收起
  if (content.state.status === 'error') return false
  if (content.name === 'shell' || content.name === 'execute') return shellExpanded
  if (content.name === 'patch') return editExpanded
  if (content.name !== 'edit' && content.name !== 'write') return undefined
  if (!editExpanded) return false
  const files = currentToolMetadata(content).files
  if (!Array.isArray(files) || files.length === 0) return true
  return !files.every(
    file =>
      !!file && typeof file === 'object' && 'status' in file && (file as { status?: unknown }).status === 'deleted',
  )
}
