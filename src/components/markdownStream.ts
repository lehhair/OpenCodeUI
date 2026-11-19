import { marked } from 'marked'
import type { Tokens } from 'marked'

export type MarkdownStreamBlock = {
  key: string
  src: string
  raw?: string
  mode: 'full' | 'live' | 'code' | 'table'
  language?: string
  complete?: boolean
}

export type MarkdownStreamProjection = {
  text: string
  blocks: MarkdownStreamBlock[]
  /** 未分组源块，尾部重解析只从最后一个源块起点开始 */
  sourceBlocks?: MarkdownSourceBlock[]
  /** 已收集的引用定义（尾部重解析需要继承） */
  referenceDefinitions?: string
}

const MARKUP_PREVIEW_LANGUAGES = new Set(['html', 'htm', 'xhtml', 'xml', 'svg'])

export function isMarkupPreviewLanguage(language?: string): boolean {
  return !!language && MARKUP_PREVIEW_LANGUAGES.has(language.toLowerCase())
}

function hashString(value: string) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index)
    hash |= 0
  }
  return hash.toString(36)
}

function getTrailingOpenFenceStart(markdown: string) {
  let openFence: { start: number; char: string; size: number } | null = null
  let offset = 0
  const lines = markdown.split('\n')

  for (let index = 0; index < lines.length; index += 1) {
    const text = lines[index] ?? ''
    const match = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(text)

    if (match?.[1] && !openFence) {
      openFence = { start: offset, char: match[1][0], size: match[1].length }
    } else if (openFence) {
      const closePattern = new RegExp(`^[ \\t]{0,3}${openFence.char}{${openFence.size},}[ \\t]*$`)
      if (closePattern.test(text)) openFence = null
    }

    offset += text.length + (index < lines.length - 1 ? 1 : 0)
  }

  return openFence?.start
}

function getOpeningFence(raw: string) {
  const match = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(raw)
  if (!match?.[1]) return null
  return { char: match[1][0], size: match[1].length }
}

/**
 * 围栏开头那一行是否已经换行。
 *
 * 没换行时语言名还在增长（` ```pytho` → ` ```python`），这一阶段必须重新切分；
 * 走「未闭合 fence 纯追加」会把剩下的字符拼进代码内容，语言永远停在半截。
 */
function hasFenceOpeningLineBreak(raw: string): boolean {
  return /^[ \t]{0,3}(?:`{3,}|~{3,})[^\n]*\n/.test(raw)
}

function hasOpenFence(raw: string) {
  return getTrailingOpenFenceStart(raw) === 0
}

function suffixClosesOpenFence(raw: string, suffix: string) {
  const fence = getOpeningFence(raw)
  if (!fence) return suffix.includes('```') || suffix.includes('~~~')
  // 用「当前行 + 后缀」判断：闭合围栏可能被拆成多次到达，也可能带缩进，
  // 只取末尾几个字符会丢掉行首和缩进信息。
  const lineStart = raw.lastIndexOf('\n') + 1
  const currentLine = raw.slice(lineStart)
  const closePattern = new RegExp(
    `(?:^|\\n)[ \\t]{0,3}${fence.char}{${fence.size},}[ \\t]*(?:\\n|$)`,
  )
  return closePattern.test(currentLine + suffix)
}

function getLanguage(value: string | undefined) {
  return value?.trim().split(/\s+/, 1)[0] || undefined
}

function appendReferenceDefinitions(src: string, referenceDefinitions: string) {
  const trimmed = src.trim()
  if (!referenceDefinitions || (trimmed.startsWith('$$') && trimmed.endsWith('$$'))) return src
  return `${src.replace(/\s+$/, '')}\n\n${referenceDefinitions}`
}

export function stripLeadingHtmlComments(source: string): string {
  let rest = source.trimStart()
  while (rest.startsWith('<!--')) {
    const commentEnd = rest.indexOf('-->', 4)
    if (commentEnd === -1) return rest
    rest = rest.slice(commentEnd + 3).trimStart()
  }
  return rest
}

export type MarkdownSourceBlock = { start: number; raw: string; src: string; token?: Tokens.Generic }
/** 相邻小段落合成块组的最小字符数：避免长回答被拆成几百个组件 */
const MARKDOWN_GROUP_MIN_CHARS = 800
/** 可以安全合并的 token：都是纯 Markdown 块；代码/表格/HTML artifact 必须保持独立 */
const GROUPABLE_TOKEN_TYPES = new Set(['paragraph', 'heading', 'list', 'blockquote', 'hr'])

function groupMarkdownBlocks(blocks: MarkdownSourceBlock[]): MarkdownSourceBlock[] {
  const grouped: MarkdownSourceBlock[] = []
  let buffer: MarkdownSourceBlock[] = []
  let bufferRaw = ''

  const flush = (force: boolean) => {
    if (buffer.length === 0) return
    if (buffer.length === 1 || (!force && bufferRaw.length < MARKDOWN_GROUP_MIN_CHARS)) {
      grouped.push(...buffer)
    } else {
      grouped.push({ start: buffer[0].start, raw: bufferRaw, src: bufferRaw })
    }
    buffer = []
    bufferRaw = ''
  }

  for (const block of blocks) {
    if (!block.token || !GROUPABLE_TOKEN_TYPES.has(block.token.type)) {
      flush(false)
      grouped.push(block)
      continue
    }
    buffer.push(block)
    bufferRaw += block.raw
    if (bufferRaw.length >= MARKDOWN_GROUP_MIN_CHARS) flush(true)
  }
  flush(false)
  return grouped
}

const BLOCK_HTML_CONTAINERS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'center',
  'details',
  'dialog',
  'div',
  'dl',
  'fieldset',
  'figure',
  'footer',
  'form',
  'header',
  'html',
  'main',
  'nav',
  'ol',
  'section',
  'svg',
  'table',
  'ul',
])
const HTML_RAW_TEXT_ELEMENTS = new Set([
  'iframe',
  'noembed',
  'noframes',
  'plaintext',
  'script',
  'style',
  'textarea',
  'title',
  'xmp',
])

type HtmlContainerState = {
  stack: string[]
  rawTextTag: string | null
  inComment: boolean
  sawContainer: boolean
}

function updateHtmlContainerStack(raw: string, state: HtmlContainerState): number | null {
  const lower = raw.toLowerCase()
  let index = 0

  while (index < raw.length) {
    if (state.inComment) {
      const commentEnd = raw.indexOf('-->', index)
      if (commentEnd === -1) return null
      state.inComment = false
      index = commentEnd + 3
      continue
    }

    if (state.rawTextTag) {
      const closingPattern = new RegExp(`</${state.rawTextTag}(?=[\\s/>])`, 'g')
      closingPattern.lastIndex = index
      const closingMatch = closingPattern.exec(lower)
      if (!closingMatch) return null
      const closingIndex = closingMatch.index
      index = closingIndex
      state.rawTextTag = null
    }

    const openingIndex = raw.indexOf('<', index)
    if (openingIndex === -1) return null
    if (raw.startsWith('<!--', openingIndex)) {
      const commentEnd = raw.indexOf('-->', openingIndex + 4)
      if (commentEnd === -1) {
        state.inComment = true
        return null
      }
      index = commentEnd + 3
      continue
    }

    const tagMatch = /^<\s*(\/?)\s*([a-z][a-z0-9-]*)\b/i.exec(raw.slice(openingIndex))
    if (!tagMatch) {
      index = openingIndex + 1
      continue
    }

    let tagEnd = openingIndex + tagMatch[0].length
    let quote = ''
    while (tagEnd < raw.length) {
      const character = raw[tagEnd]
      if (quote) {
        if (character === quote) quote = ''
      } else if (character === '"' || character === "'") quote = character
      else if (character === '>') break
      tagEnd += 1
    }
    if (tagEnd >= raw.length) return null

    const tag = tagMatch[2].toLowerCase()
    const isClosing = !!tagMatch[1]
    const isSelfClosing = /\/\s*>$/.test(raw.slice(openingIndex, tagEnd + 1))
    if (BLOCK_HTML_CONTAINERS.has(tag) && !isSelfClosing) {
      state.sawContainer = true
      if (!isClosing) state.stack.push(tag)
      else {
        const stackIndex = state.stack.lastIndexOf(tag)
        if (stackIndex !== -1) state.stack.splice(stackIndex)
        if (state.sawContainer && !state.stack.length) return tagEnd + 1
      }
    }

    index = tagEnd + 1
    if (!isClosing && !isSelfClosing && HTML_RAW_TEXT_ELEMENTS.has(tag)) {
      state.rawTextTag = tag
    }
  }

  return null
}

const HTML_ARTIFACT_ROOT_PATTERN = /^\s*(?:<!--[\s\S]*?-->\s*)*<(?:address|article|aside|blockquote|center|details|dialog|div|dl|fieldset|figure|footer|form|header|html|main|nav|ol|section|svg|table|ul)\b/i

function mergeHtmlArtifactBlocks(blocks: MarkdownSourceBlock[]): MarkdownSourceBlock[] {
  const merged: MarkdownSourceBlock[] = []

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]
    if (block.token?.type !== 'html') {
      merged.push(block)
      continue
    }

    const run = [block]
    const firstMarkup = stripLeadingHtmlComments(block.raw)
    let hasMarkupPrefix = /^<(?:style|script)\b/i.test(firstMarkup)
    let sawRoot = HTML_ARTIFACT_ROOT_PATTERN.test(block.raw)
    let sawTrailingScript = sawRoot && /^<script\b/i.test(firstMarkup)
    while (blocks[index + 1]) {
      const next = blocks[index + 1]
      const nextMarkup = stripLeadingHtmlComments(next.raw)
      const startsRoot = HTML_ARTIFACT_ROOT_PATTERN.test(next.raw)
      const startsActive = /^<(?:style|script)\b/i.test(nextMarkup)
      const canJoin = next.token?.type === 'html' || (hasMarkupPrefix && startsRoot)
      if (!canJoin || (sawTrailingScript && !startsActive)) break

      run.push(next)
      index += 1
      if (!sawRoot && startsActive) hasMarkupPrefix = true
      sawRoot ||= startsRoot
      if (sawRoot && /^<script\b/i.test(nextMarkup)) sawTrailingScript = true
    }
    const raw = run.map(item => item.raw).join('')
    if (run.length > 1 && /<(?:style|script)\b/i.test(raw)) {
      merged.push({ ...block, raw, src: raw, token: undefined })
    } else {
      merged.push(...run)
    }
  }

  return merged
}

function mergeMixedHtmlBlocks(blocks: MarkdownSourceBlock[]): MarkdownSourceBlock[] {
  const merged: MarkdownSourceBlock[] = []
  let state: HtmlContainerState = { stack: [], rawTextTag: null, inComment: false, sawContainer: false }
  let pending: MarkdownSourceBlock | null = null

  const resetState = () => {
    state = { stack: [], rawTextTag: null, inComment: false, sawContainer: false }
  }

  const pushSuffix = (block: MarkdownSourceBlock, rootEnd: number) => {
    const suffix = block.raw.slice(rootEnd)
    if (!suffix) return
    if (!suffix.trim()) {
      const previous = merged[merged.length - 1]
      if (previous) {
        previous.raw += suffix
        previous.src += suffix
      }
      return
    }
    merged.push({ start: block.start + rootEnd, raw: suffix, src: suffix })
  }

  for (const block of blocks) {
    if (!pending) {
      if (/^\s*<!doctype\s+html\b/i.test(block.raw)) {
        pending = { ...block, src: block.raw, token: undefined }
        const rootEnd = updateHtmlContainerStack(block.raw, state)
        if (rootEnd != null) {
          pending.raw = block.raw.slice(0, rootEnd)
          pending.src = pending.raw
          merged.push(pending)
          pending = null
          resetState()
          pushSuffix(block, rootEnd)
        }
        continue
      }
      if (block.token?.type !== 'html' && !HTML_ARTIFACT_ROOT_PATTERN.test(block.raw)) {
        merged.push(block)
        continue
      }
      const rootEnd = updateHtmlContainerStack(block.raw, state)
      if (rootEnd != null && rootEnd < block.raw.length) {
        const artifact = block.raw.slice(0, rootEnd)
        merged.push({ ...block, raw: artifact, src: artifact, token: undefined })
        resetState()
        pushSuffix(block, rootEnd)
        continue
      }
      if (!state.stack.length) {
        merged.push(block)
        resetState()
        continue
      }
      pending = { ...block, src: block.raw, token: undefined }
      continue
    }

    const rootEnd = block.token?.type === 'code' ? null : updateHtmlContainerStack(block.raw, state)
    const artifactPart = rootEnd == null ? block.raw : block.raw.slice(0, rootEnd)
    pending.raw += artifactPart
    pending.src += artifactPart
    if (rootEnd != null) {
      merged.push(pending)
      pending = null
      resetState()
      pushSuffix(block, rootEnd)
    }
  }

  if (pending) merged.push(pending)
  return merged
}

function splitMarkdownBlocks(markdown: string) {
  const blocks: MarkdownSourceBlock[] = []
  const referenceDefinitions: string[] = []
  let offset = 0

  for (const token of marked.lexer(markdown)) {
    const raw = typeof token.raw === 'string' ? token.raw : ''
    const start = offset
    offset += raw.length
    if (!raw) continue
    if (token.type === 'def' && !String((token as Tokens.Def).tag ?? '').startsWith('^')) {
      referenceDefinitions.push(raw)
      continue
    }

    if (raw.trim() === '' && blocks.length > 0) {
      blocks[blocks.length - 1].raw += raw
      if (blocks[blocks.length - 1].token?.type !== 'code') blocks[blocks.length - 1].src += raw
      continue
    }

    blocks.push({
      start,
      raw,
      src: token.type === 'code' ? String((token as Tokens.Code).text ?? '') : raw,
      token: token as Tokens.Generic,
    })
  }

  if (offset < markdown.length) {
    const rest = markdown.slice(offset)
    if (blocks.length > 0) {
      blocks[blocks.length - 1].raw += rest
      blocks[blocks.length - 1].src += rest
    } else blocks.push({ start: offset, raw: rest, src: rest })
  }

  return {
    blocks: mergeMixedHtmlBlocks(
      mergeHtmlArtifactBlocks(blocks.length > 0 ? blocks : [{ start: 0, raw: markdown, src: markdown }]),
    ),
    referenceDefinitions: referenceDefinitions.join('\n'),
  }
}

function buildStreamBlocks(
  sourceBlocks: MarkdownSourceBlock[],
  referenceDefinitions: string,
  isStreaming: boolean,
  fenceStart: number | null,
): MarkdownStreamBlock[] {
  if (!isStreaming) {
    if (sourceBlocks.length === 0) return [{ key: 'html:0', src: '', mode: 'full' }]
    const first = sourceBlocks[0]!
    if (sourceBlocks.length === 1 && first.token?.type !== 'code' && first.token?.type !== 'table') {
      return [{ key: 'html:0', src: appendReferenceDefinitions(first.raw, referenceDefinitions), mode: 'full' }]
    }
    return groupMarkdownBlocks(sourceBlocks).map(block => {
      if (block.token?.type === 'code') {
        const language = getLanguage((block.token as Tokens.Code).lang)
        return {
          key: isMarkupPreviewLanguage(language)
            ? `html-code:${block.start}`
            : `code:${block.start}:${hashString(block.raw)}`,
          raw: block.raw,
          src: block.src,
          mode: 'code' as const,
          language,
          complete: true,
        }
      }
      if (block.token?.type === 'table') {
        return {
          key: `table:${block.start}:${hashString(block.raw)}`,
          raw: block.raw,
          src: block.raw,
          mode: 'table' as const,
        }
      }
      return {
        key: `html:${block.start}`,
        raw: block.raw,
        src: appendReferenceDefinitions(block.raw, referenceDefinitions),
        mode: 'full' as const,
      }
    })
  }

  if (sourceBlocks.length === 0) return [{ key: 'html:0', src: '', mode: 'live' }]

  const first = sourceBlocks[0]!
  if (sourceBlocks.length === 1 && first.token?.type !== 'code' && first.token?.type !== 'table') {
    return [{ key: 'html:0', src: appendReferenceDefinitions(first.raw, referenceDefinitions), mode: 'live' }]
  }

  // 流式时最后一块永远是 live 尾，不能并进稳定块组
  const groupedBlocks = groupMarkdownBlocks(sourceBlocks.slice(0, -1))
  const liveTail = sourceBlocks[sourceBlocks.length - 1]
  if (liveTail) groupedBlocks.push(liveTail)

  return groupedBlocks.map(block => {
    const isLiveTail =
      block === sourceBlocks[sourceBlocks.length - 1] || (fenceStart != null && block.start >= fenceStart)
    if (block.token?.type === 'code') {
      const complete = fenceStart == null || block.start < fenceStart
      const language = getLanguage((block.token as Tokens.Code).lang)
      return {
        key: isMarkupPreviewLanguage(language)
          ? `html-code:${block.start}`
          : `code:${block.start}:${complete ? hashString(block.raw) : ''}`,
        raw: block.raw,
        src: block.src,
        mode: 'code' as const,
        language,
        complete,
      }
    }
    if (block.token?.type === 'table') {
      return {
        key: `table:${block.start}:${hashString(block.raw)}`,
        raw: block.raw,
        src: block.raw,
        mode: 'table' as const,
      }
    }
    return {
      key: `html:${block.start}`,
      src: appendReferenceDefinitions(block.src, referenceDefinitions),
      mode: isLiveTail ? ('live' as const) : ('full' as const),
    }
  })
}

function splitMarkdownStreamDetailed(
  markdown: string,
  isStreaming: boolean,
): Required<Pick<MarkdownStreamProjection, 'blocks' | 'sourceBlocks' | 'referenceDefinitions'>> {
  const { blocks, referenceDefinitions } = splitMarkdownBlocks(markdown)
  const fenceStart = isStreaming ? (getTrailingOpenFenceStart(markdown) ?? null) : null
  return {
    blocks: buildStreamBlocks(blocks, referenceDefinitions, isStreaming, fenceStart),
    sourceBlocks: blocks,
    referenceDefinitions,
  }
}

export function splitMarkdownStream(markdown: string, isStreaming: boolean): MarkdownStreamBlock[] {
  return splitMarkdownStreamDetailed(markdown, isStreaming).blocks
}

/**
 * 只从最后一个源块开始重解析。
 *
 * 前面的源块已经收尾，新的文本只可能扩展/改变最后一个块；把尾部切片重新 lex，
 * 再和稳定源块拼起来重新分组。引用定义出现在尾部时会影响稳定块的链接，
 * 这种情况返回 null，让调用方走全量切分。
 */
function projectTail(
  previous: MarkdownStreamProjection,
  markdown: string,
  isStreaming: boolean,
): MarkdownStreamProjection | null {
  const sources = previous.sourceBlocks
  const tailStart = sources?.at(-1)?.start
  if (!sources || tailStart === undefined) return null

  const tailText = markdown.slice(tailStart)
  const { blocks: tailSources, referenceDefinitions: tailDefinitions } = splitMarkdownBlocks(tailText)
  // 新定义会影响已经稳定的块，走全量
  if (tailDefinitions && tailDefinitions !== (previous.referenceDefinitions ?? '')) return null
  if (tailSources.length === 0) return null

  const combined = [
    ...sources.slice(0, -1),
    ...tailSources.map(block => ({ ...block, start: block.start + tailStart })),
  ]
  const tailFenceOffset = getTrailingOpenFenceStart(tailText)
  const fenceStart = tailFenceOffset === undefined ? null : tailFenceOffset + tailStart

  return {
    text: markdown,
    blocks: buildStreamBlocks(combined, previous.referenceDefinitions ?? '', isStreaming, fenceStart),
    sourceBlocks: combined,
    referenceDefinitions: previous.referenceDefinitions ?? '',
  }
}

/**
 * 未闭合代码块的代码文本。
 *
 * marked 对开放围栏的处理是：取开头围栏行之后的全部内容，只裁掉末尾一个换行。
 * 这里按同一规则从 raw 派生，避免累积拼接和解析器不一致（空行、行尾换行都会偏差）。
 */
function openFenceCodeText(raw: string): string {
  const lineEnd = raw.indexOf('\n')
  if (lineEnd === -1) return ''
  const content = raw.slice(lineEnd + 1)
  return content.endsWith('\n') ? content.slice(0, -1) : content
}
/**
 * live 段能否纯追加。
 *
 * 块类型只可能在换行处改变，所以只放行「同一行内继续写」这一种情况：
 * - 后缀里有换行 → 可能开始新的块，重新切分
 * - 当前段已经停在行首 → 下一个字符可能开启块，重新切分
 * - 当前行正在补围栏开头（``` / ~~~）→ 重新切分，让 launcher 尽早变成 code
 *
 * 同一行内的追加只影响行内语法，块渲染器会重新解析这一段，类型不会漂移。
 */
function canAppendToLiveTail(tail: MarkdownStreamBlock, suffix: string): boolean {
  if (!suffix || suffix.includes('\n')) return false
  if (!tail.src || tail.src.endsWith('\n')) return false

  const lastLine = tail.src.slice(tail.src.lastIndexOf('\n') + 1)
  // 已经是 3 个以上的围栏字符：这一段应该是代码块，不能继续当段落追加
  if (/^[ \t]{0,3}(?:`{3,}|~{3,})/.test(lastLine)) return false
  // 正在补齐围栏开头（例如两个反引号 + 新的反引号）
  if (/^[ \t]{0,3}[`~]+$/.test(lastLine) && /^[ \t]*[`~]/.test(suffix)) return false
  // 链接/脚注定义是在同一行内变成 def 的，会让这一块从 blocks 里消失
  if (/^[ \t]{0,3}\[[^\]\n]+\]:/.test(lastLine + suffix)) return false

  // 行首块标记也可能在同一行内完成（"-" -> "- "、"--" -> "---"、"#" -> "# "），
  // 只有当前行还停在「纯标记」状态时才需要重新切分；一旦标记后面有内容，类型已定。
  const combinedLine = (lastLine + suffix).replace(/^ {0,3}/, '')
  if (/^(?:[-*+>]|#{1,6}|\d{1,9}[.)])[ \t]*$/.test(combinedLine)) return false
  if (/^(?:`{1,2}|~{1,2})$/.test(combinedLine)) return false
  if (/^(?:=+|-+|\*{3,}|_{3,})$/.test(combinedLine)) return false

  return true
}

export function projectMarkdownStream(
  previous: MarkdownStreamProjection | undefined,
  markdown: string,
  isStreaming: boolean,
): MarkdownStreamProjection {
  if (!isStreaming || !previous || !markdown.startsWith(previous.text)) {
    return { text: markdown, ...splitMarkdownStreamDetailed(markdown, isStreaming) }
  }

  const suffix = markdown.slice(previous.text.length)
  if (!suffix) return previous

  const tail = previous.blocks.at(-1)
  const stablePrefix = previous.blocks.slice(0, -1)

  // 未闭合 code fence：纯追加不 re-lex
  if (
    tail?.mode === 'code' &&
    !tail.complete &&
    tail.raw &&
    hasOpenFence(tail.raw) &&
    !suffixClosesOpenFence(tail.raw, suffix)
  ) {
    // 开头围栏行还没换行 → 语言名可能还在长，重新切分
    if (!hasFenceOpeningLineBreak(tail.raw)) {
      return (
        projectTail(previous, markdown, isStreaming) ?? {
          text: markdown,
          ...splitMarkdownStreamDetailed(markdown, isStreaming),
        }
      )
    }
    const nextRaw = tail.raw + suffix
    return {
      text: markdown,
      blocks: [
        ...stablePrefix,
        {
          ...tail,
          raw: nextRaw,
          src: openFenceCodeText(nextRaw),
        },
      ],
      sourceBlocks: previous.sourceBlocks,
      referenceDefinitions: previous.referenceDefinitions,
    }
  }

  // live 尾段纯追加：只在同一行内继续写时成立
  if (tail?.mode === 'live' && canAppendToLiveTail(tail, suffix)) {
    return {
      text: markdown,
      blocks: [
        ...stablePrefix,
        {
          ...tail,
          src: tail.src + suffix,
        },
      ],
      sourceBlocks: previous.sourceBlocks,
      referenceDefinitions: previous.referenceDefinitions,
    }
  }

  // 只需要重解析最后一个源块；不稳定时退回全量
  return (
    projectTail(previous, markdown, isStreaming) ?? {
      text: markdown,
      ...splitMarkdownStreamDetailed(markdown, isStreaming),
    }
  )
}
