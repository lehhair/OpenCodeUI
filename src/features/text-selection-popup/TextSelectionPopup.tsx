/**
 * TextSelectionPopup — global floating popup that surfaces "Quote" and "Copy"
 * actions when the user highlights text inside a chat pane.
 *
 *  - selectionchange tracks a *pending* selection into a ref. The popup
 *    never appears during a drag — it only commits on mouseup / touchend /
 *    keyboard Shift+arrow release so the toolbar never flickers mid-drag.
 *  - Positions near the pointer release point (mouse / touch), or near the
 *    selection's bounding rect for keyboard selections.
 *  - Renders into document.body via createPortal so its fixed position is
 *    unaffected by ancestor transform / overflow.
 *  - Auto-hides on: outside pointerdown, scroll, resize, Esc.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { CheckIcon, CopyIcon, QuoteIcon } from '../../components/Icons'
import { copyTextToClipboard } from '../../utils/clipboard'
import { clipboardErrorHandler } from '../../utils/errorHandling'
import {
  buildQuotePatch,
  computePopupPosition,
  findTargetTextarea,
  shouldShowPopupForSelection,
} from './popupUtils'

const POPUP_WIDTH_ESTIMATE = 180
const POPUP_HEIGHT_ESTIMATE = 30
const COPIED_FEEDBACK_MS = 1500

type PendingSelection = {
  text: string
  rect: DOMRect
  textarea: HTMLTextAreaElement
}

type PlacedPopup = PendingSelection & {
  /** Pointer release point in viewport coordinates; null for keyboard selection. */
  pointer: { x: number; y: number } | null
}

export function TextSelectionPopup() {
  const { t } = useTranslation('chat')
  const [placed, setPlaced] = useState<PlacedPopup | null>(null)
  const [copied, setCopied] = useState(false)
  const [popupWidth, setPopupWidth] = useState(POPUP_WIDTH_ESTIMATE)
  const [popupHeight, setPopupHeight] = useState(POPUP_HEIGHT_ESTIMATE)
  const popupRef = useRef<HTMLDivElement | null>(null)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /**
   * Latest valid selection, kept current via selectionchange. The popup
   * never renders from this — only from mouseup/touchend/keyup commits.
   */
  const pendingRef = useRef<PendingSelection | null>(null)

  // ── selectionchange: maintain pending ref only, never show popup ──
  useEffect(() => {
    if (typeof document === 'undefined') return
    const handler = () => {
      const selection = window.getSelection()
      if (!selection || !shouldShowPopupForSelection(selection)) {
        pendingRef.current = null
        return
      }
      const textarea = findTargetTextarea(selection)
      const range = selection.getRangeAt(0)
      const rect = range.getBoundingClientRect()
      // Zero-by-zero rect = browser hasn't laid out the selection (display:none
      // content, or the jsdom test env). The toolbar needs real geometry.
      if (!textarea || (rect.width === 0 && rect.height === 0)) {
        pendingRef.current = null
        return
      }
      pendingRef.current = { text: selection.toString(), rect, textarea }
    }
    document.addEventListener('selectionchange', handler)
    return () => document.removeEventListener('selectionchange', handler)
  }, [])

  // ── pointerdown outside popup: dismiss + clear pending ──
  useEffect(() => {
    if (typeof document === 'undefined') return
    const handler = (e: PointerEvent) => {
      const popup = popupRef.current
      if (popup && e.target instanceof Node && popup.contains(e.target)) return
      setPlaced(null)
      pendingRef.current = null
    }
    document.addEventListener('pointerdown', handler)
    return () => document.removeEventListener('pointerdown', handler)
  }, [])

  // ── mouseup / touchend: commit pending + position at pointer ──
  useEffect(() => {
    if (typeof document === 'undefined') return
    const commit = (pointer: { x: number; y: number } | null) => {
      const pending = pendingRef.current
      if (!pending) return
      setPlaced({ ...pending, pointer })
    }
    const onMouseUp = (e: MouseEvent) => commit({ x: e.clientX, y: e.clientY })
    const onTouchEnd = (e: TouchEvent) => {
      const t = e.changedTouches[0]
      if (t) commit({ x: t.clientX, y: t.clientY })
    }
    document.addEventListener('mouseup', onMouseUp)
    document.addEventListener('touchend', onTouchEnd)
    return () => {
      document.removeEventListener('mouseup', onMouseUp)
      document.removeEventListener('touchend', onTouchEnd)
    }
  }, [])

  // ── keyboard Shift+arrow: commit pending, no pointer coords ──
  useEffect(() => {
    if (typeof document === 'undefined') return
    const SELECTION_KEYS = new Set([
      'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
      'Home', 'End', 'PageUp', 'PageDown',
    ])
    const handler = (e: KeyboardEvent) => {
      if (!e.shiftKey || !SELECTION_KEYS.has(e.key)) return
      const pending = pendingRef.current
      if (!pending) return
      setPlaced({ ...pending, pointer: null })
    }
    document.addEventListener('keyup', handler)
    return () => document.removeEventListener('keyup', handler)
  }, [])

  // ── dismiss on scroll / resize / Escape (only while popup is open) ──
  useEffect(() => {
    if (!placed) return
    const hide = () => setPlaced(null)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPlaced(null)
        window.getSelection()?.removeAllRanges()
      }
    }
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    document.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
      document.removeEventListener('keydown', onKey)
    }
  }, [placed])

  // ── measure actual popup size for accurate positioning ──
  useLayoutEffect(() => {
    if (!placed) return
    const popup = popupRef.current
    if (!popup) return
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        if (width > 0) setPopupWidth(width)
        if (height > 0) setPopupHeight(height)
      }
    })
    ro.observe(popup)
    return () => ro.disconnect()
  }, [placed])

  // ── cleanup copied feedback timer on unmount ──
  useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null) clearTimeout(copiedTimerRef.current)
    }
  }, [])

  const handleCopy = useCallback(async () => {
    if (!placed) return
    try {
      await copyTextToClipboard(placed.text)
      setCopied(true)
      if (copiedTimerRef.current !== null) clearTimeout(copiedTimerRef.current)
      copiedTimerRef.current = setTimeout(() => {
        setCopied(false)
        copiedTimerRef.current = null
      }, COPIED_FEEDBACK_MS)
    } catch (err) {
      clipboardErrorHandler('copy selection', err)
    }
  }, [placed])

  const handleQuote = useCallback(() => {
    if (!placed) return
    const textarea = placed.textarea
    const existing = textarea.value
    const cursor = typeof textarea.selectionStart === 'number' ? textarea.selectionStart : existing.length
    const { newText, newCursor } = buildQuotePatch(existing, cursor, placed.text)

    // Drive the textarea via its native value setter so React sees a real
    // input event and syncs the controlled state on the next render.
    const valueSetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(textarea), 'value')?.set
    if (valueSetter) valueSetter.call(textarea, newText)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))

    requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(newCursor, newCursor)
    })

    window.getSelection()?.removeAllRanges()
    setPlaced(null)
  }, [placed])

  // Position: use pointer coords when available (mouse/touch), otherwise
  // the selection's bounding rect (keyboard).
  const position = useMemo(() => {
    if (!placed) return null
    const anchor = placed.pointer
      ? { top: placed.pointer.y, bottom: placed.pointer.y, left: placed.pointer.x }
      : { top: placed.rect.top, bottom: placed.rect.bottom, left: placed.rect.left }
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1024
    return computePopupPosition(anchor, popupHeight, popupWidth, vw)
  }, [placed, popupHeight, popupWidth])

  if (!placed || !position) return null

  return createPortal(
    <div
      ref={popupRef}
      role="toolbar"
      aria-label={t('textSelectionPopup.label')}
      data-text-selection-popup="true"
      style={{
        position: 'fixed',
        top: `${position.top}px`,
        left: `${position.left}px`,
        zIndex: 70,
      }}
      onMouseDown={e => e.preventDefault()}
    >
      <div className="glass rounded-md shadow-lg border border-border-200/60 px-1 py-0.5 flex items-center gap-0.5">
        <button
          type="button"
          onClick={handleQuote}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[length:var(--fs-xs)] text-text-200 hover:bg-bg-200 transition-colors"
          aria-label={t('textSelectionPopup.quote')}
        >
          <QuoteIcon size={12} aria-hidden="true" />
          <span>{t('textSelectionPopup.quote')}</span>
        </button>
        <div className="w-px h-4 bg-border-200/50" aria-hidden="true" />
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[length:var(--fs-xs)] text-text-200 hover:bg-bg-200 transition-colors"
          aria-label={copied ? t('textSelectionPopup.copied') : t('textSelectionPopup.copy')}
          aria-live="polite"
        >
          {copied ? (
            <>
              <CheckIcon size={12} aria-hidden="true" className="text-success-100" />
              <span className="text-success-100">{t('textSelectionPopup.copied')}</span>
            </>
          ) : (
            <>
              <CopyIcon size={12} aria-hidden="true" />
              <span>{t('textSelectionPopup.copy')}</span>
            </>
          )}
        </button>
      </div>
    </div>,
    document.body,
  )
}
