/**
 * 实时流式尾部的行内语法前瞻。
 *
 * 流式时 `**`、反引号、`~~` 只到一半就渲染，会先显示字面量、闭合后再突然变格式。
 * 这里把「还没闭合、且就在末尾附近」的那一段先藏起来，等闭合后再一次显示。
 *
 * 只处理低误判的标记（** / ~~ / `）：单个 `*`、`_`、`$` 在正常文本里出现得太频繁，
 * 不能拿来判断。超出 lookahead 仍未闭合就放行，避免一个孤立的 `**` 把尾巴永久藏住。
 */
export const INLINE_LOOKAHEAD_CHARS = 80

const MARKERS = ['**', '~~'] as const

function findUnmatchedStart(text: string, marker: string, lookahead: number): number {
  let count = 0
  let cursor = -1
  let index = text.indexOf(marker)
  while (index !== -1) {
    count += 1
    cursor = index
    index = text.indexOf(marker, index + marker.length)
  }
  if (count % 2 === 0) return -1
  return text.length - cursor <= lookahead ? cursor : -1
}

function findUnmatchedBacktick(text: string, lookahead: number): number {
  let count = 0
  let last = -1
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '`') continue
    count += 1
    last = index
  }
  if (count % 2 === 0) return -1
  return text.length - last <= lookahead ? last : -1
}

/** 返回可以安全渲染的前缀；没有未闭合标记时原样返回 */
export function trimUnstableInlineTail(src: string, lookahead = INLINE_LOOKAHEAD_CHARS): string {
  if (!src) return src

  // 行内语法不会跨空行；只看最后一个段落
  const paragraphBreak = src.lastIndexOf('\n\n')
  const paragraphStart = paragraphBreak === -1 ? 0 : paragraphBreak + 2
  const tail = src.slice(paragraphStart)
  if (tail.length < 3) return src

  let cut = -1
  for (const marker of MARKERS) {
    const start = findUnmatchedStart(tail, marker, lookahead)
    if (start !== -1 && (cut === -1 || start < cut)) cut = start
  }
  const backtick = findUnmatchedBacktick(tail, lookahead)
  if (backtick !== -1 && (cut === -1 || backtick < cut)) cut = backtick

  // cut === 0 表示未闭合标记就在段落开头：这时候藏起来会让整段先空一下，
  // 掉高度比看到字面量更难看，直接按原文渲染。
  if (cut <= 0) return src
  return src.slice(0, paragraphStart + cut)
}
