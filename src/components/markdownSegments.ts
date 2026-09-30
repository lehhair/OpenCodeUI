// ─── 内联文本统一扫描层 ─────────────────────────────────────────
// 目的：==高亮==、^上标^、~化学下标~、[^脚注]、$数学 的"判定规则"只在这里写一份，
// HTML 渲染（markdownHtmlRenderer.ts）与 React 表格渲染（MarkdownRenderer.tsx）
// 各自消费扫描出的 segments，不再各维护一套扫描逻辑。
//
// 支持的语法清单（对齐 GitHub / Obsidian 约定，见 README 或仓库文档）：
//   - 数学：$...$（行内）、$$...$$（块级）、\(...\) / \[...\]（由 marked 扩展处理）
//   - 高亮：==...==（Obsidian 约定）
//   - 上标：^...^（LLM 输出约定）
//   - 化学式下标：~...~ 且内容为数字（H~2~O）；字母内容（x~y~z）视为范围保持字面
//   - 脚注引用：[^label]（GFM 约定）
//
// 注意：$ / $$ 数学的主要路径是 marked inline 扩展（在 emStrong / escape 之前拦截，
// 避免 `_`、`*`、`\` 拆散数学内容）；这里的 tryMatchMath 是 text token 层的兑底
// （处理转义残留 `\$` 与未配对 `$`，保证它们保持字面）。

export type MarkdownSegment =
  | { type: 'text'; text: string }
  | { type: 'math'; latex: string; display: boolean }
  | { type: 'mark'; children: MarkdownSegment[] }
  | { type: 'sup'; children: MarkdownSegment[] }
  | { type: 'sub'; children: MarkdownSegment[] }
  | { type: 'footnoteRef'; label: string }

export type MathDelimiter = {
  left: string
  right: string
  display: boolean
  block: boolean
}

// 数学定界符清单（单一事实来源）：
//   - block 级（行首、可跨多行）：$$、\[   → marked block 扩展
//   - 行内 $（text token 内扫描）           → scanTextSegments
//   - 行内 \( / \[（段落中间）              → marked inline 扩展
export const MATH_DELIMITERS: readonly MathDelimiter[] = [
  { left: '$$', right: '$$', display: true, block: true },
  { left: '\\[', right: '\\]', display: true, block: true },
  { left: '$', right: '$', display: false, block: false },
  { left: '\\(', right: '\\)', display: false, block: false },
]

export function isEscapedAt(text: string, index: number): boolean {
  let slashCount = 0
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) slashCount += 1
  return slashCount % 2 === 1
}

export function isAsciiDigitAt(text: string, index: number): boolean {
  const char = text[index]
  return char !== undefined && char >= '0' && char <= '9'
}

export function findUnescaped(text: string, marker: string, start: number): number {
  let cursor = start
  while (cursor < text.length) {
    const index = text.indexOf(marker, cursor)
    if (index === -1) return -1
    if (!isEscapedAt(text, index)) return index
    cursor = index + marker.length
  }
  return -1
}

export function getFootnoteId(label: string): string {
  const normalized = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
  return normalized || 'note'
}

/** 尝试在 cursor 处匹配 $...$ / $$...$$ 数学 span（不匹配返回 null） */
function tryMatchMath(text: string, cursor: number): { type: 'math'; latex: string; display: boolean } | null {
  if (text[cursor] !== '$' || isEscapedAt(text, cursor)) return null
  const display = text[cursor + 1] === '$'
  const marker = display ? '$$' : '$'
  const start = cursor + marker.length
  const close = findUnescaped(text, marker, start)
  if (close === -1) return null
  const latex = text.slice(start, close)
  // 行内 $ 不允许跨行；$$ 允许（display）
  if (!display && (!latex || latex.includes('\n'))) return null
  return { type: 'math', latex, display }
}

/**
 * 化学式下标判定（H~2~O、SO~4~、CO~2~）：
 * 内容必须是以数字为主的短串；字母内容的 ~x~ 对（x~y~z）更可能是范围/命名写法，保持字面；
 * 两侧紧邻数字视为范围/约数写法（1~2、3~5个、版本1.0~2.0），保持字面。
 */
function isChemicalSubscript(text: string, open: number, close: number): boolean {
  const content = text.slice(open + 1, close)
  return (
    content.length > 0 &&
    content.length <= 5 &&
    !/\s/.test(content) &&
    !/[\u4e00-\u9fff\u3040-\u30ff]/.test(content) &&
    /^[0-9]+$/.test(content) &&
    !isAsciiDigitAt(text, open - 1) &&
    !isAsciiDigitAt(text, close + 1)
  )
}

/** 把一段内联文本切成语义 segment；mark/sup/sub 的内容递归扫描（含 $ 数学）。 */
export function scanTextSegments(text: string): MarkdownSegment[] {
  const segments: MarkdownSegment[] = []
  let cursor = 0
  let textStart = 0

  const pushText = (end: number) => {
    if (end > textStart) segments.push({ type: 'text', text: text.slice(textStart, end) })
  }

  while (cursor < text.length) {
    if (isEscapedAt(text, cursor)) {
      cursor += 1
      continue
    }

    // 数学 $ / $$（主路径是 marked inline 扩展；这里是 text token 层兑底）
    if (text[cursor] === '$') {
      const math = tryMatchMath(text, cursor)
      if (math) {
        pushText(cursor)
        segments.push(math)
        const markerLen = math.display ? 2 : 1
        cursor = cursor + markerLen + math.latex.length + markerLen
        textStart = cursor
        continue
      }
      // 不匹配时跳过整个 marker（$$ 跳 2 个），避免 `$$` 的第二个 `$` 被当成 `$` 起点
      cursor += text[cursor + 1] === '$' ? 2 : 1
      continue
    }

    // 脚注引用 [^label]
    if (text.startsWith('[^', cursor)) {
      const close = text.indexOf(']', cursor + 2)
      const label = close === -1 ? '' : text.slice(cursor + 2, close)
      if (label && !/\s/.test(label)) {
        pushText(cursor)
        segments.push({ type: 'footnoteRef', label })
        cursor = close + 1
        textStart = cursor
        continue
      }
    }

    // 高亮 ==...==
    if (text.startsWith('==', cursor)) {
      const close = findUnescaped(text, '==', cursor + 2)
      const content = close === -1 ? '' : text.slice(cursor + 2, close)
      if (content && !content.includes('\n')) {
        pushText(cursor)
        segments.push({ type: 'mark', children: scanTextSegments(content) })
        cursor = close + 2
        textStart = cursor
        continue
      }
    }

    // 上标 ^...^
    if (text[cursor] === '^') {
      const close = findUnescaped(text, '^', cursor + 1)
      const content = close === -1 ? '' : text.slice(cursor + 1, close)
      if (content && !/\s/.test(content)) {
        pushText(cursor)
        segments.push({ type: 'sup', children: scanTextSegments(content) })
        cursor = close + 1
        textStart = cursor
        continue
      }
    }

    // 化学式下标 ~...~（仅数字内容）
    if (text[cursor] === '~' && text[cursor + 1] !== '~') {
      const close = findUnescaped(text, '~', cursor + 1)
      if (close !== -1 && isChemicalSubscript(text, cursor, close)) {
        pushText(cursor)
        segments.push({ type: 'sub', children: scanTextSegments(text.slice(cursor + 1, close)) })
        cursor = close + 1
        textStart = cursor
        continue
      }
    }

    cursor += 1
  }

  pushText(text.length)
  return segments
}
