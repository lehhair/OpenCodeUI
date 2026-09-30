import { marked } from 'marked'
import type { Tokens } from 'marked'
import DOMPurify from 'dompurify'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { inferImageDimensions } from './imageDimensions'
import { MATH_DELIMITERS, getFootnoteId, isEscapedAt, scanTextSegments } from './markdownSegments'
import type { MarkdownSegment } from './markdownSegments'

const LOCAL_FILE_LINK_PREFIX = '#opencode-local-file:'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, '&#96;')
}

function decodeHref(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function getWindowsAbsolutePath(value: string): string | null {
  const decoded = decodeHref(value)
  return /^[A-Za-z]:[\\/]/.test(decoded) ? decoded : null
}

function encodeLocalFileHref(filePath: string): string {
  return `${LOCAL_FILE_LINK_PREFIX}${encodeURIComponent(filePath)}`
}

function decodeLocalFileHref(href?: string): string | null {
  if (!href?.startsWith(LOCAL_FILE_LINK_PREFIX)) return null
  try {
    return decodeURIComponent(href.slice(LOCAL_FILE_LINK_PREFIX.length))
  } catch {
    return null
  }
}

function isUnsafeHref(href?: string): boolean {
  if (!href) return false
  const normalized = Array.from(href.trim())
    .filter(char => {
      const code = char.charCodeAt(0)
      return code > 0x1f && code !== 0x7f && !/\s/.test(char)
    })
    .join('')
    .toLowerCase()
  return normalized.startsWith('javascript:') || normalized.startsWith('vbscript:') || normalized.startsWith('data:')
}

function isUnsafeImageSrc(src?: string): boolean {
  if (!src) return false
  const trimmed = src.trim()
  if (/^data:/i.test(trimmed)) return true
  return isUnsafeHref(src)
}

function normalizeAlignedMath(source: string): string {
  return source.replace(/\\begin\{aligned\}([\s\S]*?)\\end\{aligned\}/g, (environment, body: string) => {
    if ((body.match(/&/g)?.length ?? 0) < 2) return environment

    // Tolerate model output that collapses an aligned row break from `\\` to `\ `.
    const normalizedBody = body.replace(
      /(^|[^\\])\\([ \t\r\n]+)(?=\\[A-Za-z])/g,
      (_match, prefix: string, whitespace: string) => `${prefix}\\\\${whitespace}`,
    )
    return `\\begin{aligned}${normalizedBody}\\end{aligned}`
  })
}

function renderKatexHtml(source: string, displayMode: boolean, fallback?: string): string {
  try {
    return katex.renderToString(displayMode ? normalizeAlignedMath(source) : source, {
      displayMode,
      throwOnError: false,
      strict: false,
      trust: false,
    })
  } catch {
    return escapeHtml(fallback ?? (displayMode ? `$$${source}$$` : `$${source}$`))
  }
}

export { renderKatexHtml }

/**
 * \(...\) / \[...\] 是否按 LaTeX 公式处理。
 * 只接受明显的公式内容，避免把转义括号（\(注意\)、\[0\]）误当成数学。
 */
function looksLikeMath(source: string): boolean {
  if (!source) return false
  if (/[\u4e00-\u9fff\u3040-\u30ff]/.test(source)) return false
  return /[=^_{}<>\\]/.test(source) || /[\p{L}\p{N}][+\-*/][\p{L}\p{N}]/u.test(source)
}

// marked v18（CommonMark 0.31+）会把单 ~ 对也切成 del（删除线），而中文对话里 ~ 常用作
// 范围/约数符（1~2、3~5个、TGP021~024、8.85~9.16），导致 1~2 被误渲染成下标/删除线。
// 这里只让双 ~~ 生成 del；单 ~ 保留为文本，由下方 subscript 逻辑决定是否按下标渲染。
// 数学扩展由 MATH_DELIMITERS 清单（markdownSegments.ts）驱动生成。
// 块级（$$、\\[）在 lheading/paragraph 之前整体捕获，避免公式内容被块级规则
// （如 Setext 标题的 `=` 行、列表、引用）拆散；行内（\\(、\\[）在 escape/em 之前拦截。
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const MARKED_BLOCK_MATH_DELIMITERS = MATH_DELIMITERS.filter(delimiter => delimiter.block)
// 行内数学由 marked 扩展在 emStrong / escape 之前拦截，数学内容不会被 `_`/`*`/`\` 拆散。
// 覆盖 $、$$、\(、\[ 四种 delimiter。
const MARKED_INLINE_MATH_DELIMITERS = MATH_DELIMITERS.filter(
  delimiter => delimiter.left === '$' || delimiter.left === '$$' || delimiter.left.startsWith('\\'),
)
// 正则预编译：block/inline tokenizer 每次调用不再构造 RegExp
const BLOCK_MATH_PATTERNS = MARKED_BLOCK_MATH_DELIMITERS.map(delimiter => ({
  display: delimiter.display,
  pattern: new RegExp(`^${escapeRegex(delimiter.left)}([\\s\\S]*?)${escapeRegex(delimiter.right)}`),
}))
const INLINE_MATH_PATTERNS = MARKED_INLINE_MATH_DELIMITERS.map(delimiter => ({
  display: delimiter.display,
  // `$` / `$$` 保持宽松（货币、简写也能渲染，与原 text 层行为一致）；
  // `\(` / `\[` 需要明显的公式内容（避免转义括号被误判）。
  gate: delimiter.left.startsWith('\\'),
  pattern: new RegExp(
    `^${escapeRegex(delimiter.left)}${delimiter.left === '$' ? '(?!\\$)' : ''}(${delimiter.display ? '[\\s\\S]*?' : '[^\\n]*?'})${escapeRegex(delimiter.right)}`,
  ),
}))

marked.use({
  tokenizer: {
    del(src: string) {
      const cap = /^~~(?=[^\s~])((?:\\[\s\S]|[^\\])*?(?:\\[\s\S]|[^\s~\\]))~~(?=[^~]|$)/.exec(src)
      if (!cap) return undefined
      return {
        type: 'del',
        raw: cap[0],
        text: cap[1],
        tokens: this.lexer.inlineTokens(cap[1]),
      }
    },
  },
  extensions: [
    {
      name: 'displayMath',
      level: 'block',
      tokenizer(src: string) {
        for (const { display, pattern } of BLOCK_MATH_PATTERNS) {
          const match = pattern.exec(src)
          if (match?.[1] && looksLikeMath(match[1])) {
            return { type: 'displayMath', raw: match[0], text: match[1], display }
          }
        }
        return undefined
      },
      renderer(token: Tokens.Generic) {
        const text = String(token.text ?? '')
        return renderKatexHtml(text, true, `\\[${text}\\]`)
      },
    },
    {
      name: 'math',
      level: 'inline',
      start(src: string) {
        let index = -1
        for (const delimiter of MARKED_INLINE_MATH_DELIMITERS) {
          let found = src.indexOf(delimiter.left)
          if (delimiter.left === '$$') {
            // `$$` 必须成对闭合才作为数学起点；无闭合时跳过（否则第二个 `$` 会被 `$` 项误用）
            while (found !== -1) {
              const escaped = isEscapedAt(src, found)
              const hasClose = src.indexOf('$$', found + 2) !== -1
              if (!escaped && hasClose) break
              found = src.indexOf('$$', found + 2)
            }
          } else if (delimiter.left === '$') {
            // 转义美元（\$）与 `$$` 的成员（前/后紧跟 `$`）不作为数学起点
            while (found !== -1 && (isEscapedAt(src, found) || src[found - 1] === '$' || src[found + 1] === '$')) {
              found = src.indexOf('$', found + 1)
            }
          }
          if (found !== -1 && (index === -1 || found < index)) index = found
        }
        return index
      },
      tokenizer(src: string) {
        for (const { display, gate, pattern } of INLINE_MATH_PATTERNS) {
          const match = pattern.exec(src)
          if (match?.[1] && (!gate || looksLikeMath(match[1]))) {
            return { type: 'math', raw: match[0], text: match[1], display }
          }
        }
        return undefined
      },
      renderer(token: Tokens.Generic) {
        const text = String(token.text ?? '')
        const display = token.display === true
        return renderKatexHtml(text, display, display ? `\\[${text}\\]` : `\\(${text}\\)`)
      },
    },
  ],
})

function renderFootnoteReferenceHtml(label: string, isReasoning: boolean): string {
  const id = getFootnoteId(label)
  const className = isReasoning
    ? 'align-super text-[0.75em] text-accent-main-200/80'
    : 'align-super text-[0.75em] text-accent-main-100'
  return `<sup id="fnref-${escapeAttribute(id)}" class="${className}"><a href="#fn-${escapeAttribute(id)}" class="font-medium underline underline-offset-2">${escapeHtml(label)}</a></sup>`
}

/** 把统一扫描出的 segments 渲染成 HTML 字符串（正文路径）。 */
function renderSegmentsToHtml(segments: MarkdownSegment[], isReasoning: boolean): string {
  return segments
    .map(segment => {
      switch (segment.type) {
        case 'text':
          return escapeHtml(segment.text)
        case 'math':
          return renderKatexHtml(segment.latex, segment.display)
        case 'mark': {
          const className = isReasoning
            ? 'rounded-sm bg-bg-300/70 px-0.5 text-text-300'
            : 'rounded-sm bg-accent-main-100/15 px-0.5 text-text-100'
          return `<mark class="${className}">${renderSegmentsToHtml(segment.children, isReasoning)}</mark>`
        }
        case 'sup':
          return `<sup>${renderSegmentsToHtml(segment.children, isReasoning)}</sup>`
        case 'sub':
          return `<sub>${renderSegmentsToHtml(segment.children, isReasoning)}</sub>`
        case 'footnoteRef':
          return renderFootnoteReferenceHtml(segment.label, isReasoning)
      }
    })
    .join('')
}

function getDisplayMathSource(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('$$') || !trimmed.endsWith('$$') || trimmed.length < 4) return null
  return trimmed.slice(2, -2).trim()
}

const MARKDOWN_ALERTS = {
  NOTE: {
    label: 'Note',
    className: 'border-accent-secondary-100/35 border-l-accent-secondary-100 bg-accent-secondary-100/10',
    labelClassName: 'text-accent-secondary-100',
  },
  TIP: {
    label: 'Tip',
    className: 'border-success-100/35 border-l-success-100 bg-success-bg/45',
    labelClassName: 'text-success-100',
  },
  IMPORTANT: {
    label: 'Important',
    className: 'border-accent-main-100/35 border-l-accent-main-100 bg-accent-main-100/10',
    labelClassName: 'text-accent-main-100',
  },
  WARNING: {
    label: 'Warning',
    className: 'border-warning-100/35 border-l-warning-100 bg-warning-bg/45',
    labelClassName: 'text-warning-100',
  },
  CAUTION: {
    label: 'Caution',
    className: 'border-danger-100/35 border-l-danger-100 bg-danger-bg/45',
    labelClassName: 'text-danger-100',
  },
} as const

function createMarkdownHtmlRenderer(isReasoning: boolean) {
  const renderer = new marked.Renderer()

  renderer.heading = function ({ tokens, depth }) {
    const text = this.parser.parseInline(tokens)
    const className = isReasoning
      ? 'text-[length:var(--fs-sm)] font-semibold text-text-300 mt-2 mb-1 first:mt-0 last:mb-0'
      : depth === 1
        ? 'text-[length:var(--fs-heading-1)] font-bold text-text-100 mt-8 mb-4 first:mt-0 last:mb-0 tracking-tight'
        : depth === 2
          ? 'text-[length:var(--fs-heading-2)] font-bold text-text-100 mt-6 mb-3 first:mt-0 last:mb-0 tracking-tight pb-1.5 border-b border-border-100/40'
          : depth === 3
            ? 'text-[length:var(--fs-heading-3)] font-semibold text-text-100 mt-5 mb-2 first:mt-0 last:mb-0 tracking-tight'
            : 'text-[length:var(--fs-base)] font-semibold text-text-100 mt-4 mb-2 first:mt-0 last:mb-0 tracking-tight'
    const tag = Math.min(Math.max(depth, 1), 4)
    return `<h${tag} class="${className}">${text}</h${tag}>`
  }

  renderer.paragraph = function ({ tokens }) {
    const text = this.parser.parseInline(tokens)
    const className = isReasoning
      ? 'text-[length:var(--fs-sm)] mb-2 last:mb-0 leading-5 text-text-400'
      : 'mb-4 last:mb-0 leading-7 text-text-200'
    return `<p class="${className}">${text}</p>`
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  renderer.text = function (this: any, { text, tokens }: any) {
    if (tokens && tokens.length > 0) return this.parser.parseInline(tokens)
    return renderSegmentsToHtml(scanTextSegments(text), isReasoning)
  }

  renderer.codespan = ({ text }) => {
    const className = isReasoning
      ? 'font-mono text-accent-main-100 text-[0.9em] align-baseline break-words'
      : 'text-accent-main-100 text-[0.9em] font-mono align-baseline break-words'
    return `<code class="${className}">${escapeHtml(text)}</code>`
  }

  renderer.strong = function ({ tokens }) {
    const className = isReasoning ? 'font-semibold text-text-300' : 'font-semibold text-text-100'
    return `<strong class="${className}">${this.parser.parseInline(tokens)}</strong>`
  }

  renderer.em = function ({ tokens }) {
    const className = isReasoning ? 'italic text-text-300' : 'italic text-text-200'
    return `<em class="${className}">${this.parser.parseInline(tokens)}</em>`
  }

  // 删除线只来自 ~~...~~（tokenizer 已限制单 ~ 不产生 del）
  renderer.del = function ({ tokens }) {
    const className = isReasoning
      ? 'text-[length:var(--fs-sm)] text-text-500 line-through decoration-text-500/50'
      : 'text-text-400 line-through decoration-text-400/50'
    return `<del class="${className}">${this.parser.parseInline(tokens)}</del>`
  }

  renderer.link = function ({ href, title, tokens }) {
    const content = this.parser.parseInline(tokens)
    if (isUnsafeHref(href)) return `${content} [blocked]`
    const localPath = decodeLocalFileHref(href) ?? getWindowsAbsolutePath(href)
    const normalizedHref = localPath ? encodeLocalFileHref(localPath) : href
    const className = isReasoning
      ? 'text-[length:var(--fs-sm)] font-medium text-accent-main-200/80 hover:text-accent-main-200 underline underline-offset-2 transition-colors'
      : 'font-medium text-accent-main-100 hover:text-accent-main-200 underline underline-offset-2 transition-colors'
    const attrs = [
      `href="${escapeAttribute(normalizedHref)}"`,
      `class="${className}"`,
      localPath ? `title="${escapeAttribute(localPath)}"` : 'target="_blank" rel="noopener noreferrer"',
      title && !localPath ? `title="${escapeAttribute(title)}"` : '',
    ]
      .filter(Boolean)
      .join(' ')
    return `<a ${attrs}>${content}</a>`
  }

  renderer.image = ({ href, title, text }) => {
    if (!href || isUnsafeImageSrc(href)) return `[Image blocked: ${escapeHtml(text || '')}]`
    const safeTitle = title || text || undefined
    const titleAttr = safeTitle ? ` title="${escapeAttribute(safeTitle)}"` : ''
    const imgTitleAttr = title ? ` title="${escapeAttribute(title)}"` : ''
    const dimensions = inferImageDimensions(href)
    const dimensionsAttr = dimensions ? ` width="${dimensions.width}" height="${dimensions.height}"` : ''
    return `<a href="${escapeAttribute(href)}" target="_blank" rel="noopener noreferrer" class="inline-block max-w-full align-top"${titleAttr}><img src="${escapeAttribute(href)}" alt="${escapeAttribute(text || '')}"${imgTitleAttr}${dimensionsAttr} loading="eager" decoding="async" class="block max-w-full rounded-md"></a>`
  }

  renderer.blockquote = function ({ tokens, text }) {
    const alertMatch = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\n|$)/i.exec(text)
    if (alertMatch) {
      const kind = alertMatch[1].toUpperCase() as keyof typeof MARKDOWN_ALERTS
      const alert = MARKDOWN_ALERTS[kind]
      const body = marked.parse(text.slice(alertMatch[0].length), { renderer, async: false }) as string
      const spacingClass = isReasoning ? 'my-2 px-3 py-2' : 'my-4 px-4 py-3'
      return `<aside data-markdown-alert="${kind.toLowerCase()}" class="${spacingClass} first:mt-0 last:mb-0 rounded-md border border-l-4 not-italic ${alert.className}"><p class="mb-1 font-semibold ${alert.labelClassName}">${alert.label}</p><div class="text-text-300 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">${body}</div></aside>`
    }

    const className = isReasoning
      ? 'border-l-2 border-text-500/30 pl-3 py-0.5 my-2 first:mt-0 last:mb-0 text-text-400'
      : 'border-l-2 border-accent-main-100/60 pl-4 py-1 my-4 first:mt-0 last:mb-0 text-text-300 italic'
    return `<blockquote class="${className}">${this.parser.parse(tokens)}</blockquote>`
  }

  renderer.list = function ({ ordered, start, items }) {
    const tag = ordered ? 'ol' : 'ul'
    const className = isReasoning
      ? ordered
        ? 'text-[length:var(--fs-sm)] list-decimal list-outside mb-2 last:mb-0 space-y-0.5 marker:text-text-500/60'
        : 'text-[length:var(--fs-sm)] list-disc list-outside ml-4 mb-2 last:mb-0 space-y-0.5 marker:text-text-500/60'
      : ordered
        ? 'list-decimal list-outside mb-4 last:mb-0 space-y-1 marker:text-text-400/80'
        : 'list-disc list-outside ml-5 mb-4 last:mb-0 space-y-1 marker:text-text-400/80'
    const startAttr = ordered && start && start !== 1 ? ` start="${start}"` : ''
    const itemsHtml = items.map(item => renderer.listitem(item)).join('')
    return `<${tag}${startAttr} class="${className}">${itemsHtml}</${tag}>`
  }

  renderer.listitem = function ({ tokens, task, checked }) {
    const className = isReasoning
      ? 'text-[length:var(--fs-sm)] text-text-400 pl-1 leading-5'
      : 'text-text-200 pl-1 leading-7'
    const checkbox = task
      ? `<input type="checkbox" ${checked ? 'checked' : ''} disabled class="mr-2 align-middle">`
      : ''
    const content = tokens ? this.parser.parse(tokens) : ''
    return `<li class="${className}">${checkbox}${content}</li>`
  }

  renderer.hr = () => {
    const className = isReasoning
      ? 'border-border-200/40 my-4 first:mt-0 last:mb-0'
      : 'border-border-200/60 my-8 first:mt-0 last:mb-0'
    return `<hr class="${className}">`
  }

  return renderer
}

function renderFootnoteDefinitionsHtml(src: string, isReasoning: boolean): string | null {
  const lines = src.trim().split(/\n+/)
  const items: string[] = []
  const renderer = getRenderer(isReasoning)

  for (const line of lines) {
    const match = /^\[\^([^\]]+)\]:\s+([\s\S]+)$/.exec(line.trim())
    if (!match) return null
    const [, label, content] = match
    const id = getFootnoteId(label)
    const body = marked.parseInline(content, { renderer }) as string
    const className = isReasoning ? 'text-[length:var(--fs-sm)] text-text-400 leading-5' : 'text-text-300 leading-6'
    items.push(
      `<li id="fn-${escapeAttribute(id)}" class="${className}"><span class="font-medium text-text-400">${escapeHtml(label)}.</span> ${body} <a href="#fnref-${escapeAttribute(id)}" class="font-medium text-accent-main-100 underline underline-offset-2">back</a></li>`,
    )
  }

  const listClass = isReasoning
    ? 'my-2 list-decimal list-inside space-y-1 border-t border-border-200/30 pt-2'
    : 'my-4 list-decimal list-inside space-y-1 border-t border-border-200/40 pt-3'
  return `<section class="footnotes"><ol class="${listClass}">${items.join('')}</ol></section>`
}

function rewriteRawHtmlLocalLinks(html: string): string {
  if (typeof document === 'undefined') return html
  const template = document.createElement('template')
  template.innerHTML = html
  template.content.querySelectorAll<HTMLAnchorElement>('a[href]').forEach(anchor => {
    const href = anchor.getAttribute('href') ?? ''
    const localPath = decodeLocalFileHref(href) ?? getWindowsAbsolutePath(href)
    if (!localPath) return
    anchor.setAttribute('href', encodeLocalFileHref(localPath))
    anchor.setAttribute('title', localPath)
  })
  return template.innerHTML
}

function stripUnsafeHtmlLinks(html: string): string {
  if (typeof document === 'undefined' || !/<a\s/i.test(html)) return html
  const template = document.createElement('template')
  template.innerHTML = html
  template.content.querySelectorAll<HTMLAnchorElement>('a[href]').forEach(anchor => {
    const href = anchor.getAttribute('href') ?? ''
    if (isUnsafeHref(href)) {
      const text = anchor.textContent ?? ''
      const replacement = document.createTextNode(`${text} [blocked]`)
      anchor.replaceWith(replacement)
    }
  })
  return template.innerHTML
}

const UNSAFE_INLINE_STYLE_PROPERTIES = new Set([
  'position',
  'z-index',
  'inset',
  'inset-block',
  'inset-inline',
  'top',
  'right',
  'bottom',
  'left',
  'transform',
  'translate',
  'scale',
  'rotate',
  'filter',
  'float',
  'backdrop-filter',
  'clip-path',
  'mask',
  'pointer-events',
  'opacity',
  'content',
])

function filterInlineStyles(element: HTMLElement) {
  if (element.closest('.katex')) return
  const safeDeclarations: Array<{ property: string; value: string; priority: string }> = []
  for (const property of Array.from(element.style)) {
    const value = element.style.getPropertyValue(property)
    const unsafe =
      property.startsWith('--') ||
      UNSAFE_INLINE_STYLE_PROPERTIES.has(property) ||
      (property.startsWith('margin') && /(^|[\s,(])-/.test(value)) ||
      /url\s*\(|expression\s*\(|behavior\s*:|-moz-binding\s*:/i.test(value)
    if (!unsafe) safeDeclarations.push({ property, value, priority: element.style.getPropertyPriority(property) })
  }
  element.removeAttribute('style')
  for (const { property, value, priority } of safeDeclarations) {
    element.style.setProperty(property, value, priority)
  }
  if (!safeDeclarations.length) element.removeAttribute('style')
}

function enhanceSafeHtml(template: HTMLTemplateElement) {
  template.content.querySelectorAll<HTMLElement>('[style]').forEach(filterInlineStyles)

  template.content.querySelectorAll<HTMLDetailsElement>('details').forEach(details => {
    details.classList.add('markdown-html-details')
  })
  template.content.querySelectorAll<HTMLElement>('summary').forEach(summary => {
    summary.classList.add('markdown-html-summary')
  })
  template.content.querySelectorAll<HTMLElement>('dl').forEach(list => {
    list.classList.add('markdown-html-definition-list')
  })
  template.content.querySelectorAll<HTMLElement>('input, textarea, select, button').forEach(control => {
    control.classList.add('markdown-html-control')
  })
  template.content.querySelectorAll<HTMLProgressElement>('progress').forEach(progress => {
    progress.classList.add('markdown-html-progress')
  })
  template.content.querySelectorAll<HTMLMediaElement>('audio, video').forEach(media => {
    media.classList.add('markdown-html-media')
  })

  template.content.querySelectorAll<HTMLTableElement>('table').forEach(table => {
    if (table.parentElement?.classList.contains('markdown-html-table-scroll')) return
    const wrapper = document.createElement('div')
    wrapper.className = 'markdown-html-table-scroll'
    table.classList.add('markdown-html-table')
    table.before(wrapper)
    wrapper.append(table)
  })

  template.content.querySelectorAll<HTMLFormElement>('form').forEach(form => {
    form.removeAttribute('action')
    form.removeAttribute('method')
    form.removeAttribute('target')
  })
  template.content.querySelectorAll<HTMLElement>('[formaction]').forEach(element => {
    element.removeAttribute('formaction')
  })
  template.content.querySelectorAll<HTMLButtonElement>('button:not([type])').forEach(button => {
    button.type = 'button'
  })

  template.content.querySelectorAll<HTMLMediaElement>('audio, video').forEach(media => {
    media.removeAttribute('autoplay')
  })
  template.content
    .querySelectorAll<HTMLMediaElement | HTMLSourceElement>('audio[src], video[src], source[src]')
    .forEach(media => {
      const src = media.getAttribute('src')?.trim() ?? ''
      if (src && !/^(?:https?:|\/)/i.test(src)) media.removeAttribute('src')
    })
}

function sanitizeHtml(html: string): string {
  if (!DOMPurify.isSupported) return ''
  const clean = DOMPurify.sanitize(stripUnsafeHtmlLinks(rewriteRawHtmlLocalLinks(html)), {
    USE_PROFILES: { html: true, mathMl: true, svg: true },
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur'],
  }) as unknown as string

  if (typeof document === 'undefined') return clean

  const template = document.createElement('template')
  template.innerHTML = clean
  enhanceSafeHtml(template)

  template.content.querySelectorAll<HTMLAnchorElement>('a[href]').forEach(anchor => {
    const href = anchor.getAttribute('href') ?? ''
    if (isUnsafeHref(href)) {
      const text = anchor.textContent ?? ''
      anchor.replaceWith(document.createTextNode(`${text} [blocked]`))
      return
    }

    const localPath = decodeLocalFileHref(href) ?? getWindowsAbsolutePath(href)
    if (localPath) {
      anchor.setAttribute('href', encodeLocalFileHref(localPath))
      anchor.setAttribute('title', localPath)
      anchor.removeAttribute('target')
      anchor.removeAttribute('rel')
      return
    }

    if (!href.startsWith('#')) {
      anchor.setAttribute('target', '_blank')
      anchor.setAttribute('rel', 'noopener noreferrer')
    }
  })

  return template.innerHTML
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let rendererCache: { default: any; reasoning: any } | null = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getRenderer(isReasoning: boolean): any {
  if (!rendererCache) {
    rendererCache = {
      default: createMarkdownHtmlRenderer(false),
      reasoning: createMarkdownHtmlRenderer(true),
    }
  }
  return isReasoning ? rendererCache.reasoning : rendererCache.default
}

export function renderMarkdownToHtml(src: string, isReasoning: boolean): string {
  const displayMath = getDisplayMathSource(src)
  if (displayMath != null) {
    const className = isReasoning ? 'my-2 overflow-x-auto text-text-400' : 'my-4 overflow-x-auto text-text-200'
    return `<div class="${className}">${renderKatexHtml(displayMath, true)}</div>`
  }

  const footnotes = renderFootnoteDefinitionsHtml(src, isReasoning)
  if (footnotes != null) return sanitizeHtml(footnotes)

  const renderer = getRenderer(isReasoning)
  const html = marked.parse(src, { renderer, async: false }) as string
  return sanitizeHtml(html)
}

export function renderMarkdownInlineToHtml(src: string, isReasoning: boolean): string {
  const renderer = getRenderer(isReasoning)
  const html = marked.parseInline(src, { renderer }) as string
  return sanitizeHtml(html)
}
