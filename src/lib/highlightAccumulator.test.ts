import { describe, expect, it } from 'vitest'
import { applyHighlightChunk, createHighlightAccumulator } from './highlightAccumulator'
import { splitTokensIntoLines } from './shikiWorkerClient'
import type { WorkerToken } from '../workers/shikiWorker'
import type { HighlightTokens } from './highlightTypes'

function plainLines(tokens: HighlightTokens): string[][] {
  return tokens.map(line => line.map(token => `${token.content}|${token.color ?? ''}`))
}

describe('highlightAccumulator', () => {
  it('reset 一次性建出完整行，含跨行 token 拆分', () => {
    const acc = createHighlightAccumulator()
    const stable: WorkerToken[] = [
      ['const a', '#111'],
      [' = 1;\nconst b', '#222'],
      [' = 2;', '#333'],
    ]

    const result = applyHighlightChunk(acc, { reset: true, stable, stableTotal: 3, unstable: [] })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(plainLines(result.tokens)).toEqual([
      ['const a|#111', ' = 1;|#222'],
      ['const b|#222', ' = 2;|#333'],
    ])
  })

  it('增量追加与全量切分结果一致，且不复制旧 token', () => {
    const acc = createHighlightAccumulator()
    const first: WorkerToken[] = [['const a', '#111']]
    const firstResult = applyHighlightChunk(acc, { reset: true, stable: first, stableTotal: 1, unstable: [] })
    expect(firstResult.ok).toBe(true)
    if (!firstResult.ok) return

    const second: WorkerToken[] = [[' = 1;\nconst b', '#222']]
    const result = applyHighlightChunk(acc, { reset: false, stable: second, stableTotal: 2, unstable: [] })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    // 旧 token 对象被复用，没有重新构造
    expect(result.tokens[0][0]).toBe(firstResult.tokens[0][0])
    expect(plainLines(result.tokens)).toEqual(plainLines(splitTokensIntoLines([...first, ...second])))
  })

  it('unstable 尾巴每拍整体替换，不会重复堆叠', () => {
    const acc = createHighlightAccumulator()
    const stable: WorkerToken[] = [['let x', '#111']]
    applyHighlightChunk(acc, { reset: true, stable, stableTotal: 1, unstable: [[' =', '#222']] })

    const result = applyHighlightChunk(acc, {
      reset: false,
      stable: [],
      stableTotal: 1,
      unstable: [[' = 1', '#222']],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(plainLines(result.tokens)).toEqual([['let x|#111', ' = 1|#222']])
  })

  it('stableTotal 对不上时报告 desync，且不污染累积状态', () => {
    const acc = createHighlightAccumulator()
    applyHighlightChunk(acc, { reset: true, stable: [['a', '#111']], stableTotal: 1, unstable: [] })

    const result = applyHighlightChunk(acc, {
      reset: false,
      stable: [['b', '#222']],
      stableTotal: 3,
      unstable: [],
    })

    expect(result).toEqual({ ok: false, reason: 'desync' })
    expect(acc.stableCount).toBe(1)
  })

  it('desync 后用 reset 全量重建即可恢复', () => {
    const acc = createHighlightAccumulator()
    applyHighlightChunk(acc, { reset: true, stable: [['a', '#111']], stableTotal: 1, unstable: [] })
    applyHighlightChunk(acc, { reset: false, stable: [['b', '#222']], stableTotal: 3, unstable: [] })

    const rebuilt = applyHighlightChunk(acc, {
      reset: true,
      stable: [['a', '#111'], ['b', '#222'], ['c', '#333']],
      stableTotal: 3,
      unstable: [],
    })

    expect(rebuilt.ok).toBe(true)
    if (!rebuilt.ok) return
    expect(plainLines(rebuilt.tokens)).toEqual([['a|#111', 'b|#222', 'c|#333']])
  })

  it('unstable 里有换行时按行展开', () => {
    const acc = createHighlightAccumulator()
    const result = applyHighlightChunk(acc, {
      reset: true,
      stable: [['x', '#111']],
      stableTotal: 1,
      unstable: [['\ny', '#222']],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(plainLines(result.tokens)).toEqual([['x|#111'], ['y|#222']])
  })
})
