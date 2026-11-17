import { diffLines, parsePatch } from 'diff'

/** 重建行数上限：超出则退回片段提取，避免超大文件的 diff/高亮开销 */
const MAX_RECONSTRUCTED_LINES = 20000

/**
 * 超过这个体量就不再跑同步行级 diff，也不铺逐行 diff 视图。
 *
 * jsdiff 与 `computePairedLines/unified` 都是同步的，几百 KB 的文件就能让主线程
 * 卡几百毫秒；调用方拿 null 表示「不给统计」，不要用 0/0 冒充「没有改动」。
 */
export const MAX_DIFF_DETAIL_CHARS = 192 * 1024

export function diffLineStats(before: string, after: string): { additions: number; deletions: number } | null {
  if (before.length + after.length > MAX_DIFF_DETAIL_CHARS) return null
  const changes = diffLines(before, after)
  let additions = 0
  let deletions = 0
  for (const change of changes) {
    if (change.added) additions += change.count || 0
    if (change.removed) deletions += change.count || 0
  }
  return { additions, deletions }
}

/**
 * 占位行的标记内容：私有使用区字符，真实代码行不可能恰好是它。
 * 折叠逻辑据此识别"合成区域"（patch 里不存在的内容），渲染成不可展开的折叠条——
 * 展开了也没有真实内容可看（官方同样不提供这种展开）。
 */
export const SYNTHETIC_PAD_LINE = ''

export function isSyntheticPadLine(content: string): boolean {
  return content === SYNTHETIC_PAD_LINE
}

/** 超大 patch 不做完整还原（parsePatch + join 是同步的），调用方退回片段提取 */
const MAX_PATCH_CHARS = 1024 * 1024

/**
 * 把 unified diff（带 `@@ -oldStart,n +newStart,n @@` 绝对行号）还原成"完整" before/after：
 * hunk 之间未变化的行用空行占位补齐，使后续 diffLines 重算后变更落在真实行号上，
 * 且折叠/高亮/行号宽度全部沿用现有管线，无需改渲染组件。
 *
 * 解析失败、hunk 乱序/重叠、或超出行数/字节上限时返回 null，调用方退回 extractContentFromUnifiedDiff。
 */
export function reconstructBeforeAfterFromPatch(patch: string): { before: string; after: string } | null {
  if (patch.length > MAX_PATCH_CHARS) return null
  let files
  try {
    files = parsePatch(patch)
  } catch {
    return null
  }
  const file = files?.[0]
  if (!file || !file.hunks || file.hunks.length === 0) return null

  const beforeLines: string[] = []
  const afterLines: string[] = []
  let oldPos = 1
  let newPos = 1

  for (const hunk of file.hunks) {
    // hunk 之前的未变化行（前导 + hunk 间隙）用空行占位，保持绝对行号对齐。
    // 正常 patch 中 gapOld === gapNew（未变化段两侧行数相同），不等则说明 patch 异常。
    const gapOld = hunk.oldStart - oldPos
    const gapNew = hunk.newStart - newPos
    if (gapOld < 0 || gapNew < 0) return null
    for (let i = 0; i < gapOld; i++) beforeLines.push(SYNTHETIC_PAD_LINE)
    for (let i = 0; i < gapNew; i++) afterLines.push(SYNTHETIC_PAD_LINE)
    oldPos += gapOld
    newPos += gapNew

    for (const raw of hunk.lines) {
      const tag = raw[0]
      const text = raw.slice(1)
      if (tag === ' ') {
        beforeLines.push(text)
        afterLines.push(text)
        oldPos++
        newPos++
      } else if (tag === '-') {
        beforeLines.push(text)
        oldPos++
      } else if (tag === '+') {
        afterLines.push(text)
        newPos++
      }
      // '\'（No newline at end of file）标记忽略
    }
  }

  if (beforeLines.length > MAX_RECONSTRUCTED_LINES || afterLines.length > MAX_RECONSTRUCTED_LINES) {
    return null
  }

  return { before: beforeLines.join('\n'), after: afterLines.join('\n') }
}

export function extractContentFromUnifiedDiff(diff: string): { before: string; after: string } {
  let before = ''
  let after = ''

  for (const line of diff.split('\n')) {
    if (
      line.startsWith('---') ||
      line.startsWith('+++') ||
      line.startsWith('Index:') ||
      line.startsWith('===') ||
      line.startsWith('@@') ||
      line.startsWith('\\ No newline')
    ) {
      continue
    }

    if (line.startsWith('-')) {
      before += line.slice(1) + '\n'
    } else if (line.startsWith('+')) {
      after += line.slice(1) + '\n'
    } else if (line.startsWith(' ')) {
      before += line.slice(1) + '\n'
      after += line.slice(1) + '\n'
    }
  }

  return { before: before.trimEnd(), after: after.trimEnd() }
}
