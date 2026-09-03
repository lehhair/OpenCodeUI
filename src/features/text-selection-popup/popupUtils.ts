/**
 * Pure helpers for the text-selection floating popup. Kept dependency-free so
 * they can be unit-tested without a DOM or React runtime.
 */

/**
 * Format a selection as a Markdown blockquote prefix. Each line gets a `> `
 * (or a single `>` for blank lines), matching the convention used by GitHub,
 * Slack and other Markdown dialects.
 */
export function formatQuote(text: string): string {
  if (text.length === 0) return ''
  return text
    .split('\n')
    .map(line => (line.length > 0 ? `> ${line}` : '>'))
    .join('\n')
}

/**
 * Count the newlines needed before the quote so it lands on its own blank
 * line in the rendered Markdown.
 *   - empty `before`        → 0 (quote at the very start, nothing above it)
 *   - ends with `\n\n`+     → 0 (blank line already exists)
 *   - ends with `\n`        → 1 (add one more for a blank line)
 *   - ends with non-newline → 2 (full blank line)
 */
function leadNewlinesFor(before: string): string {
  if (before.length === 0) return ''
  if (/\n\s*\n\s*$/.test(before)) return ''
  if (/\n\s*$/.test(before)) return '\n'
  return '\n\n'
}

/**
 * Newlines needed after the quote so it is always separated from what follows
 * by a blank line — including when nothing follows, so the user can type a
 * reply below the blockquote instead of appending to its last line.
 *   - empty `after`         → 2 (blank line, lands cursor on a fresh line)
 *   - starts with `\n\n`+   → 0 (blank line already exists)
 *   - starts with `\n`      → 1 (add one more for a blank line)
 *   - starts with non-newline → 2 (full blank line)
 */
function trailingNewlinesFor(after: string): string {
  if (after.length === 0) return '\n\n'
  if (/^\s*\n\s*\n/.test(after)) return ''
  if (/^\s*\n/.test(after)) return '\n'
  return '\n\n'
}

/**
 * Build a text patch that inserts a quoted version of `selected` into
 * `existing` at `cursor`, returning the next text + the cursor position just
 * past the trailing separator (so the user can keep typing a reply below the
 * blockquote).
 */
export function buildQuotePatch(
  existing: string,
  cursor: number,
  selected: string,
): { newText: string; newCursor: number } {
  const safeCursor = Math.max(0, Math.min(cursor, existing.length))
  const before = existing.slice(0, safeCursor)
  const after = existing.slice(safeCursor)
  const quoted = formatQuote(selected)

  const lead = leadNewlinesFor(before)
  const trail = trailingNewlinesFor(after)

  const newText = `${before}${lead}${quoted}${trail}${after}`
  const newCursor = before.length + lead.length + quoted.length + trail.length

  return { newText, newCursor }
}

/**
 * Locate the target `<textarea>` for a Selection. Walks up from the
 * `selection.anchorNode` until it finds an element with `data-pane-id`, then
 * returns the textarea inside that element. Returns `null` when the selection
 * is not inside a chat pane (e.g. inside the sidebar, terminal or a
 * contenteditable editor).
 */
export function findTargetTextarea(selection: Selection | null): HTMLTextAreaElement | null {
  if (!selection || selection.rangeCount === 0) return null
  const anchor = selection.anchorNode
  if (!anchor) return null

  const startElement = anchor.nodeType === Node.ELEMENT_NODE ? (anchor as Element) : anchor.parentElement
  if (!startElement) return null

  const pane = startElement.closest<HTMLElement>('[data-pane-id]')
  if (!pane) return null

  return pane.querySelector<HTMLTextAreaElement>('textarea')
}

/**
 * Decide whether the current selection is "interesting" enough to surface a
 * floating popup. Excludes collapsed selections, selections inside form fields
 * or contenteditable surfaces, and text inside elements explicitly opted out
 * via `data-no-selection-popup`.
 */
export function shouldShowPopupForSelection(selection: Selection | null): boolean {
  if (!selection || selection.rangeCount === 0) return false
  if (selection.isCollapsed) return false
  const text = selection.toString().trim()
  if (text.length === 0) return false

  const anchor = selection.anchorNode
  if (!anchor) return false
  const startElement = anchor.nodeType === Node.ELEMENT_NODE ? (anchor as Element) : anchor.parentElement
  if (!startElement) return false

  const pane = startElement.closest<HTMLElement>('[data-pane-id]')
  if (!pane) return false

  if (startElement.closest<HTMLElement>('input, textarea, [contenteditable="true"]')) {
    return false
  }
  if (startElement.closest<HTMLElement>('[data-no-selection-popup]')) {
    return false
  }

  return true
}

/**
 * Position the popup near a pointer release point (mouse / touch) or a
 * fallback anchor rect (keyboard selection). Sits above the anchor with a
 * small gap; flips below when there's no room above. Clamps horizontally to
 * the viewport.
 */
export function computePopupPosition(
  anchor: { top: number; bottom: number; left: number },
  popupHeight: number,
  popupWidth: number,
  viewportWidth: number,
  gap = 8,
  viewportHeight: number = typeof window !== 'undefined' ? window.innerHeight : 800,
): { top: number; left: number; placement: 'above' | 'below' } {
  const desiredTop = anchor.top - popupHeight - gap
  const placement: 'above' | 'below' =
    desiredTop >= 8
      ? 'above'
      : anchor.bottom + gap + popupHeight <= viewportHeight
        ? 'below'
        : 'above'

  const top =
    placement === 'above' ? Math.max(8, anchor.top - popupHeight - gap) : anchor.bottom + gap

  const maxLeft = Math.max(8, viewportWidth - popupWidth - 8)
  const left = Math.max(8, Math.min(anchor.left, maxLeft))

  return { top, left, placement }
}
