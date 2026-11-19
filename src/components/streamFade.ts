/**
 * 流式文本的尾部淡入。
 *
 * 不逐字符建 span（长文本会爆炸），而是每个揭示节拍给新追加的一段包一个
 * 短命 span，做 200ms 透明度动画，结束后并回普通文本节点。
 * 这样同时最多只有几个 span，长回答也不会把 DOM 撑大。
 */
import { prefersReducedMotion } from '../utils/motion'

export const STREAM_FADE_DURATION_MS = 200
const FADE_FROM_OPACITY = 0.35
const FADE_CLEANUP_DELAY_MS = 30
const APPENDABLE_PARENT = /^(P|LI|TD|TH|H[1-6]|BLOCKQUOTE|DIV)$/

export interface StreamFadeState {
  parent: HTMLElement | null
  anchor: Node | null
  timers: Set<number>
}

export function createStreamFadeState(): StreamFadeState {
  return { parent: null, anchor: null, timers: new Set() }
}

export function resetStreamFade(state: StreamFadeState): void {
  for (const timer of state.timers) window.clearTimeout(timer)
  state.timers.clear()
  state.parent = null
  state.anchor = null
}

function canAnimate(): boolean {
  return typeof Element !== 'undefined' && typeof (Element.prototype as { animate?: unknown }).animate === 'function'
}

function resolveAnchor(root: HTMLElement, state: StreamFadeState): { parent: HTMLElement; anchor: Node } | null {
  if (
    state.parent &&
    root.contains(state.parent) &&
    state.anchor &&
    state.anchor.parentNode === state.parent &&
    state.parent.lastChild === state.anchor
  ) {
    return { parent: state.parent, anchor: state.anchor }
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let last: Text | null = null
  let node = walker.nextNode()
  while (node) {
    last = node as Text
    node = walker.nextNode()
  }
  if (!last) return null

  const parent = last.parentElement
  if (!parent || !APPENDABLE_PARENT.test(parent.tagName) || parent.lastChild !== last) return null

  state.parent = parent
  state.anchor = last
  return { parent, anchor: last }
}

function finalizeSpan(span: HTMLSpanElement, state: StreamFadeState): void {
  const parent = span.parentNode
  if (!parent) return
  const previous = span.previousSibling
  const text = document.createTextNode(span.textContent ?? '')
  span.replaceWith(text)
  if (state.anchor === span) state.anchor = text

  if (previous && previous.nodeType === Node.TEXT_NODE) {
    const previousText = previous as Text
    previousText.appendData(text.data)
    text.remove()
    if (state.anchor === text) state.anchor = previousText
  }
}

/**
 * 把一段新文本以淡入方式追加到 live 块的末尾。
 * 返回 false 表示当前环境/结构不适合做动画，调用方应回退到普通文本追加。
 */
export function appendStreamingTextWithFade(root: HTMLElement, suffix: string, state: StreamFadeState): boolean {
  if (!suffix || !canAnimate() || prefersReducedMotion()) return false
  const resolved = resolveAnchor(root, state)
  if (!resolved) return false

  const span = document.createElement('span')
  span.textContent = suffix
  resolved.parent.appendChild(span)
  state.anchor = span

  span.animate(
    [{ opacity: FADE_FROM_OPACITY }, { opacity: 1 }],
    { duration: STREAM_FADE_DURATION_MS, easing: 'ease-out', fill: 'none' },
  )

  const timer = window.setTimeout(() => {
    state.timers.delete(timer)
    // 全量 parse 可能已经把 span 整个换掉
    if (span.parentNode) finalizeSpan(span, state)
  }, STREAM_FADE_DURATION_MS + FADE_CLEANUP_DELAY_MS)
  state.timers.add(timer)
  return true
}
