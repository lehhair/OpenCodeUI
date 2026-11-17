import { createTwoFilesPatch, diffLines } from 'diff'
import { describe, expect, it } from 'vitest'
import { diffLineStats, MAX_DIFF_DETAIL_CHARS, reconstructBeforeAfterFromPatch } from './diffUtils'

/** 构造 n 行文件，changes 里指定某些行的内容 */
function makeFile(lineCount: number, changes: Record<number, string> = {}): string {
  const lines: string[] = []
  for (let i = 1; i <= lineCount; i++) lines.push(changes[i] ?? `line${i}`)
  return lines.join('\n')
}

/** 对还原结果重算 diff，返回所有变更的绝对行号（old/new 两侧） */
function changePositions(before: string, after: string) {
  const positions: { kind: 'del' | 'add'; line: number; text: string; count: number }[] = []
  let oldIdx = 0
  let newIdx = 0
  for (const change of diffLines(before, after)) {
    const count = change.count ?? 0
    const firstLine = change.value.split('\n')[0]
    if (change.removed) {
      positions.push({ kind: 'del', line: oldIdx + 1, text: firstLine, count })
    } else if (change.added) {
      positions.push({ kind: 'add', line: newIdx + 1, text: firstLine, count })
    }
    if (!change.added) oldIdx += count
    if (!change.removed) newIdx += count
  }
  return positions
}

describe('reconstructBeforeAfterFromPatch', () => {
  it('单 hunk：变更落在绝对行号，而不是从 1 开始', () => {
    const before = makeFile(100)
    const after = makeFile(100, { 40: 'CHANGED40' })
    const patch = createTwoFilesPatch('f.ts', 'f.ts', before, after)

    const result = reconstructBeforeAfterFromPatch(patch)
    expect(result).not.toBeNull()

    const positions = changePositions(result!.before, result!.after)
    expect(positions).toEqual([
      { kind: 'del', line: 40, text: 'line40', count: 1 },
      { kind: 'add', line: 40, text: 'CHANGED40', count: 1 },
    ])
  })

  it('多 hunk：间隙补齐后各 hunk 的变更都落在绝对行号', () => {
    const before = makeFile(100)
    const after = makeFile(100, { 10: 'CHANGED10', 50: 'CHANGED50', 100: 'CHANGED100' })
    const patch = createTwoFilesPatch('f.ts', 'f.ts', before, after)

    const result = reconstructBeforeAfterFromPatch(patch)
    expect(result).not.toBeNull()

    const positions = changePositions(result!.before, result!.after)
    expect(positions).toEqual([
      { kind: 'del', line: 10, text: 'line10', count: 1 },
      { kind: 'add', line: 10, text: 'CHANGED10', count: 1 },
      { kind: 'del', line: 50, text: 'line50', count: 1 },
      { kind: 'add', line: 50, text: 'CHANGED50', count: 1 },
      { kind: 'del', line: 100, text: 'line100', count: 1 },
      { kind: 'add', line: 100, text: 'CHANGED100', count: 1 },
    ])
  })

  it('纯新增（新文件）：行号与内容对齐', () => {
    const after = makeFile(5)
    const patch = createTwoFilesPatch('f.ts', 'f.ts', '', after)

    const result = reconstructBeforeAfterFromPatch(patch)
    expect(result).not.toBeNull()

    const positions = changePositions(result!.before, result!.after)
    expect(positions).toEqual([{ kind: 'add', line: 1, text: 'line1', count: 5 }])
  })

  it('非法 patch 返回 null', () => {
    expect(reconstructBeforeAfterFromPatch('not a diff at all')).toBeNull()
    expect(reconstructBeforeAfterFromPatch('')).toBeNull()
  })

  it('无 hunk 的 patch 返回 null', () => {
    expect(reconstructBeforeAfterFromPatch('--- a.ts\n+++ a.ts\n')).toBeNull()
  })
})

describe('diffLineStats', () => {
  it('统计新增与删除行数', () => {
    expect(diffLineStats('a\n', 'a\nb\n')).toEqual({ additions: 1, deletions: 0 })
    expect(diffLineStats('a\nb\n', 'a\n')).toEqual({ additions: 0, deletions: 1 })
  })

  it('相同内容返回 0/0（不是 null）', () => {
    expect(diffLineStats('same\nlines', 'same\nlines')).toEqual({ additions: 0, deletions: 0 })
  })

  it('超过体量上限返回 null，调用方不显示统计', () => {
    const huge = 'x'.repeat(MAX_DIFF_DETAIL_CHARS)
    expect(diffLineStats(huge, 'y')).toBeNull()
  })
})
