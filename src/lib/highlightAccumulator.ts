import type { WorkerToken } from '../workers/shikiWorker'
import type { HighlightTokens } from './highlightTypes'

/**
 * 流式高亮的增量累积器。
 *
 * worker 每拍只回传「新稳定下来的 token + 当前 unstable 尾巴」，客户端在这里按行累积。
 * 只在 reset 或不同步（stableTotal 对不上）时才需要全量重建。
 */
export type HighlightAccumulator = {
  /** 已稳定的行，最后一行可能为空行 */
  lines: HighlightTokens
  /** 已累积的 stable token 数，对应 worker 响应里的 stableTotal */
  stableCount: number
}

export type HighlightChunk = {
  reset: boolean
  stable: WorkerToken[]
  stableTotal: number
  unstable: WorkerToken[]
}

export type ApplyHighlightResult =
  | { ok: true; tokens: HighlightTokens }
  | { ok: false; reason: 'desync' }

export function createHighlightAccumulator(): HighlightAccumulator {
  return { lines: [[]], stableCount: 0 }
}

function appendToken(lines: HighlightTokens, [content, color]: WorkerToken) {
  const segments = content.split('\n')
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]
    if (segment) {
      const token = { content: segment, color }
      lines[lines.length - 1].push(token)
    }
    if (index < segments.length - 1) lines.push([])
  }
}

function appendTokens(lines: HighlightTokens, tokens: WorkerToken[]) {
  for (const token of tokens) {
    if (!token[0]) continue
    appendToken(lines, token)
  }
}

/** 把 unstable 尾巴接在 stable 行后面，返回给渲染用的完整行；不修改稳定区 */
function withTail(stableLines: HighlightTokens, unstable: WorkerToken[]): HighlightTokens {
  const lines = stableLines.slice(0, -1)
  const last = stableLines[stableLines.length - 1] ?? []
  lines.push(last.slice())
  appendTokens(lines, unstable)
  return lines
}

export function applyHighlightChunk(accumulator: HighlightAccumulator, chunk: HighlightChunk): ApplyHighlightResult {
  if (chunk.reset) {
    accumulator.lines = [[]]
    appendTokens(accumulator.lines, chunk.stable)
    accumulator.stableCount = chunk.stable.length
  } else {
    if (accumulator.stableCount + chunk.stable.length !== chunk.stableTotal) {
      return { ok: false, reason: 'desync' }
    }
    if (chunk.stable.length > 0) {
      appendTokens(accumulator.lines, chunk.stable)
      accumulator.stableCount += chunk.stable.length
    }
  }

  return { ok: true, tokens: withTail(accumulator.lines, chunk.unstable) }
}
