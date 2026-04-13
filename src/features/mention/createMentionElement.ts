import type { MentionItem } from './types'
import { formatMentionLabel } from './utils'
import { clipboardErrorHandler, copyTextToClipboard } from '../../utils'

export function createMentionElement(item: MentionItem): { element: HTMLSpanElement; cleanup: () => void } {
  const span = document.createElement('span')
  const label = formatMentionLabel(item.type, item.displayName)

  span.className =
    'mention-tag inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[length:var(--fs-sm)] font-medium border cursor-pointer select-none'
  span.contentEditable = 'false'
  span.dataset.mentionType = item.type
  span.dataset.mentionValue = item.value
  span.dataset.mentionDisplay = item.displayName
  span.textContent = label
  span.title = `Click to copy: ${item.value}`

  let copyTimeoutId: ReturnType<typeof setTimeout> | null = null

  const handleClick = async (e: Event) => {
    e.preventDefault()
    e.stopPropagation()

    try {
      await copyTextToClipboard(item.value)
      const originalContent = span.innerHTML
      const checkIcon =
        '<svg class="w-3 h-3 inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>'
      span.innerHTML = `${checkIcon}<span>${label}</span>`

      if (copyTimeoutId) {
        clearTimeout(copyTimeoutId)
      }
      copyTimeoutId = setTimeout(() => {
        span.innerHTML = originalContent
        copyTimeoutId = null
      }, 1200)
    } catch (err) {
      clipboardErrorHandler('copy mention', err)
    }
  }

  span.addEventListener('click', handleClick)

  return {
    element: span,
    cleanup: () => {
      span.removeEventListener('click', handleClick)
      if (copyTimeoutId) {
        clearTimeout(copyTimeoutId)
        copyTimeoutId = null
      }
    },
  }
}
