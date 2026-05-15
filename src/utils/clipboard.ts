function fallbackCopyText(text: string): boolean {
  if (typeof document === 'undefined' || !document.body) {
    return false
  }

  const textArea = document.createElement('textarea')
  textArea.value = text
  textArea.setAttribute('readonly', '')
  textArea.setAttribute('aria-hidden', 'true')
  textArea.style.position = 'fixed'
  textArea.style.top = '0'
  textArea.style.left = '-9999px'
  textArea.style.opacity = '0'
  textArea.style.pointerEvents = 'none'

  const selection = document.getSelection()
  const savedRanges = selection
    ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange())
    : []
  const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null

  document.body.appendChild(textArea)
  textArea.focus()
  textArea.select()
  textArea.setSelectionRange(0, text.length)

  const copied = typeof document.execCommand === 'function' && document.execCommand('copy')

  document.body.removeChild(textArea)

  if (selection) {
    selection.removeAllRanges()
    savedRanges.forEach(range => selection.addRange(range))
  }
  activeElement?.focus()

  return copied
}

export async function copyTextToClipboard(text: string): Promise<void> {
  let clipboardError: unknown

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch (error) {
      clipboardError = error
    }
  }

  if (fallbackCopyText(text)) {
    return
  }

  throw clipboardError instanceof Error ? clipboardError : new Error('Failed to copy text to clipboard')
}

export async function readTextFromClipboard(): Promise<string> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
    return navigator.clipboard.readText()
  }
  throw new Error('Clipboard read API is not available')
}
