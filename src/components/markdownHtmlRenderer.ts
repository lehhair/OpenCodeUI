import DOMPurify from 'dompurify'
import 'katex/dist/katex.min.css'
import {
  decodeLocalFileHref,
  encodeLocalFileHref,
  getWindowsAbsolutePath,
  isUnsafeHref,
  parseMarkdownInlineToHtml,
  parseMarkdownToHtml,
  renderKatexHtml,
} from './markdownParseCore'

export { renderKatexHtml }
export { extractFootnoteDefinitions, maskCjkEmphasisClose } from './markdownParseCore'

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
  template.content.querySelectorAll<HTMLMediaElement | HTMLSourceElement>('audio[src], video[src], source[src]').forEach(media => {
    const src = media.getAttribute('src')?.trim() ?? ''
    if (src && !/^(?:https?:|\/)/i.test(src)) media.removeAttribute('src')
  })
}

export function sanitizeHtml(html: string): string {
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

export function renderMarkdownToHtml(src: string, isReasoning: boolean, renderHtml = true): string {
  const html = parseMarkdownToHtml(src, isReasoning, renderHtml)
  // 关闭 HTML 渲染时，裸 HTML 已在渲染器里转义，输出完全由本地渲染器构造；
  // 再跑一遍 DOMPurify 只会让流式每帧多一次整棵 DOM 的遍历。
  return renderHtml ? sanitizeHtml(html) : html
}

export function renderMarkdownInlineToHtml(src: string, isReasoning: boolean, renderHtml = true): string {
  const html = parseMarkdownInlineToHtml(src, isReasoning, renderHtml)
  return renderHtml ? sanitizeHtml(html) : html
}
