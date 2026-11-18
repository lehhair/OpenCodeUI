/**
 * 内联渲染的内容预算。
 *
 * 工具输出可以任意大（一次 CodeMode 跑几十条命令、读一个几 MB 的文件），
 * 而内联渲染是**同步**的：文本进 DOM 就要排版，Shiki 进 worker 就要切 token，
 * CodeMirror 进装饰就要给每个 token 建 range。手机上一个几 MB 的工具卡能把
 * 渲染进程直接顶死。
 *
 * 这里只做一件事：给「直接铺在消息流里」的文本一个上限，超出部分保留头尾，
 * 中间用一行省略标记代替。完整内容仍然在：
 * - 「复制」按钮（复制原始文本）
 * - 全屏查看器（单个实例，按需挂载）
 *
 * 头尾都按整行切，避免把一行撕成两半；ANSI 调用方自己补 reset。
 */

export const INLINE_MAX_CHARS = 64 * 1024
export const INLINE_MAX_LINES = 900

export interface CropOptions {
  /** 字符上限，默认 64KB */
  maxChars?: number
  /** 行数上限，默认 900 行 */
  maxLines?: number
  /** 头段占比，默认 0.6；尾段占 0.3，剩下留给省略标记 */
  headRatio?: number
  /** 中间那一行标记，默认一个省略号 */
  marker?: string
}

export interface CroppedContent {
  text: string
  cropped: boolean
  /** 被省掉的字符数（含标记自身，仅用于展示量级） */
  omittedChars: number
  /** 被省掉的行数 */
  omittedLines: number
}

const EMPTY: CroppedContent = { text: '', cropped: false, omittedChars: 0, omittedLines: 0 }

function countNewlines(text: string, limit = Number.POSITIVE_INFINITY): number {
  let count = 0
  let index = text.indexOf('\n')
  while (index !== -1) {
    count += 1
    if (count >= limit) return count
    index = text.indexOf('\n', index + 1)
  }
  return count
}

/** 找到 start 之前（含）最近的换行，返回下一行的起点；没有换行就返回 start */
function cutAfterNewline(text: string, start: number): number {
  const index = text.lastIndexOf('\n', start)
  return index > 0 ? index + 1 : start
}

/** 找到 start 之后（含）最近的换行，返回下一行的起点；没有换行就返回 start */
function cutAtNextNewline(text: string, start: number): number {
  const index = text.indexOf('\n', start)
  return index === -1 ? start : index + 1
}

/** 第 lineIndex 行（0 基）的起始偏移；越界返回文本长度 */
function lineStartOffset(text: string, lineIndex: number): number {
  if (lineIndex <= 0) return 0
  let offset = 0
  for (let index = 0; index < lineIndex; index++) {
    const newline = text.indexOf('\n', offset)
    if (newline === -1) return text.length
    offset = newline + 1
  }
  return offset
}

export function cropContent(text: string, options: CropOptions = {}): CroppedContent {
  if (!text) return EMPTY

  const maxChars = options.maxChars ?? INLINE_MAX_CHARS
  const maxLines = options.maxLines ?? INLINE_MAX_LINES
  const headRatio = Math.min(0.9, Math.max(0.2, options.headRatio ?? 0.6))
  const marker = options.marker ?? '…'

  // 先只数到行数上限：大块输出通常在 900 行内就够判断，
  // 没必要为了一个「没超预算」的结论把整段文本扫两遍。
  const probedNewlines = countNewlines(text, maxLines + 1)
  if (text.length <= maxChars && probedNewlines <= maxLines) {
    return { text, cropped: false, omittedChars: 0, omittedLines: 0 }
  }
  const totalLineCount = probedNewlines > maxLines ? countNewlines(text) + 1 : probedNewlines + 1

  const headBudget = Math.floor(maxChars * headRatio)
  const tailBudget = Math.floor(maxChars * 0.3)

  let headEnd = cutAfterNewline(text, headBudget)
  let tailStart = cutAtNextNewline(text, Math.max(headEnd, text.length - tailBudget))

  // 行数超限：按行切，再用字符预算收紧（单行超长文本走字符预算）
  if (totalLineCount > maxLines) {
    const headLines = Math.max(1, Math.floor(maxLines * headRatio))
    const tailLines = Math.max(1, Math.floor(maxLines * 0.3))
    headEnd = lineStartOffset(text, headLines)
    tailStart = lineStartOffset(text, Math.max(headLines + 1, totalLineCount - tailLines))
    if (headEnd > headBudget) headEnd = cutAfterNewline(text, headBudget)
    if (text.length - tailStart > tailBudget) tailStart = cutAtNextNewline(text, text.length - tailBudget)
  }

  // 切出来的区间不成立：保持原样
  if (tailStart <= headEnd) {
    return { text, cropped: false, omittedChars: 0, omittedLines: 0 }
  }

  const head = text.slice(0, headEnd)
  const tail = text.slice(tailStart)
  // 头/尾都从行边界切；末尾没有换行时最后一行也算一行
  const headLines = countNewlines(head) + (head.endsWith('\n') ? 0 : 1)
  const tailLines = countNewlines(tail) + (tail.endsWith('\n') ? 0 : 1)
  const omittedLines = Math.max(0, totalLineCount - headLines - tailLines)
  const omittedChars = Math.max(0, text.length - head.length - tail.length)

  return {
    text: `${head}${head.endsWith('\n') ? '' : '\n'}${marker}\n${tail}`,
    cropped: true,
    omittedChars,
    omittedLines,
  }
}

/** 人类可读的体积，给省略提示用 */
export function formatContentSize(chars: number): string {
  if (chars < 1024) return `${chars} B`
  if (chars < 1024 * 1024) return `${Math.round((chars / 1024) * 10) / 10} KB`
  return `${Math.round((chars / (1024 * 1024)) * 10) / 10} MB`
}
