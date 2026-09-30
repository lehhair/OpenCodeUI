import type { PointerEvent as ReactPointerEvent } from 'react'

export interface InternalFileMentionPayload {
  kind: 'file-mention'
  file: {
    type: 'file' | 'folder'
    path: string
    absolute: string
    name: string
  }
}

export interface InternalSessionPayload {
  kind: 'session'
  sessionId: string
  /** 源 session 所属服务器（多服务器模式；拖到分屏窗口时用它合成复合 key） */
  serverId?: string
  directory?: string
}

export interface InternalPanePayload {
  kind: 'pane'
  paneId: string
}

export interface InternalPreviewTabPayload {
  kind: 'preview-tab'
  id: string
}

export interface InternalPanelTabPayload {
  kind: 'panel-tab'
  position: 'right' | 'bottom'
  tabId: string
}

export type InternalDragPayload =
  | InternalFileMentionPayload
  | InternalSessionPayload
  | InternalPanePayload
  | InternalPreviewTabPayload
  | InternalPanelTabPayload

export interface InternalDragPoint {
  x: number
  y: number
}

export interface InternalActiveDrag {
  payload: InternalDragPayload
  start: InternalDragPoint
  current: InternalDragPoint
  offset: InternalDragPoint
  sourceRect: DOMRect
}

export interface InternalDragSnapshot {
  active: InternalActiveDrag | null
}

export interface InternalDropEvent {
  payload: InternalDragPayload
  point: InternalDragPoint
}

const DEFAULT_THRESHOLD = 2
const PREVIEW_MAX_WIDTH = 360
const subscribers = new Set<() => void>()
const dropSubscribers = new Set<(event: InternalDropEvent) => void>()
let snapshot: InternalDragSnapshot = { active: null }
let currentPreview: HTMLElement | null = null
let restoreUserSelect: string | null = null
let clickSuppressorArmed = false
let notifyRaf: number | null = null

function emitChange() {
  subscribers.forEach(listener => listener())
}

function setActiveDrag(active: InternalActiveDrag | null, immediate = false) {
  snapshot = { active }

  if (immediate) {
    if (notifyRaf !== null) {
      cancelAnimationFrame(notifyRaf)
      notifyRaf = null
    }
    emitChange()
    return
  }

  if (notifyRaf !== null) return
  notifyRaf = requestAnimationFrame(() => {
    notifyRaf = null
    emitChange()
  })
}

function distance(a: InternalDragPoint, b: InternalDragPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function armClickSuppressor() {
  if (clickSuppressorArmed) return
  clickSuppressorArmed = true

  const suppressClick = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    clickSuppressorArmed = false
    document.removeEventListener('click', suppressClick, true)
  }

  document.addEventListener('click', suppressClick, true)
}

function lockSelection() {
  if (restoreUserSelect !== null) return
  restoreUserSelect = document.body.style.userSelect
  document.body.style.userSelect = 'none'
  document.body.classList.add('internal-drag-active')
}

function unlockSelection() {
  if (restoreUserSelect !== null) {
    document.body.style.userSelect = restoreUserSelect
    restoreUserSelect = null
  }
  document.body.classList.remove('internal-drag-active')
}

function clonePreviewElement(element: HTMLElement): HTMLElement {
  const clone = element.cloneNode(true) as HTMLElement
  const rect = element.getBoundingClientRect()

  clone.removeAttribute('id')
  clone.removeAttribute('draggable')
  clone.style.pointerEvents = 'none'
  clone.style.margin = '0'
  clone.style.width = `${Math.min(rect.width, PREVIEW_MAX_WIDTH)}px`
  clone.style.maxWidth = `${PREVIEW_MAX_WIDTH}px`
  clone.style.boxSizing = 'border-box'

  clone.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'))
  clone.querySelectorAll('input, textarea, select').forEach(node => {
    const control = node as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    control.disabled = true
  })

  return clone
}

export function getInternalDragSnapshot(): InternalDragSnapshot {
  return snapshot
}

export function subscribeInternalDrag(listener: () => void) {
  subscribers.add(listener)
  return () => {
    subscribers.delete(listener)
  }
}

export function subscribeInternalDrop(listener: (event: InternalDropEvent) => void) {
  dropSubscribers.add(listener)
  return () => {
    dropSubscribers.delete(listener)
  }
}

export function getInternalDragPreviewElement() {
  return currentPreview
}

export function startInternalDrag(event: ReactPointerEvent<HTMLElement>, payload: InternalDragPayload) {
  if (event.button !== 0 || !event.isPrimary) return
  if (event.pointerType === 'touch') return

  event.preventDefault()

  const sourceElement = event.currentTarget
  const sourceRect = sourceElement.getBoundingClientRect()
  const start = { x: event.clientX, y: event.clientY }
  const pointerId = event.pointerId
  let active: InternalActiveDrag | null = null

  const offset = {
    x: event.clientX - sourceRect.left,
    y: event.clientY - sourceRect.top,
  }

  const cleanup = () => {
    document.removeEventListener('pointermove', handlePointerMove, true)
    document.removeEventListener('pointerup', handlePointerUp, true)
    document.removeEventListener('pointercancel', handlePointerCancel, true)
    document.removeEventListener('keydown', handleKeyDown, true)
    window.removeEventListener('blur', cancel, true)
    unlockSelection()
    try {
      if (sourceElement.hasPointerCapture?.(pointerId)) {
        sourceElement.releasePointerCapture(pointerId)
      }
    } catch {
      // best effort only
    }
  }

  const cancel = () => {
    cleanup()
    currentPreview = null
    setActiveDrag(null, true)
  }

  function beginDrag(point: InternalDragPoint) {
    const previewElement = clonePreviewElement(sourceElement)
    currentPreview = previewElement
    active = {
      payload,
      start,
      current: point,
      offset,
      sourceRect,
    }

    lockSelection()
    setActiveDrag(active, true)
  }

  function updatePosition(point: InternalDragPoint) {
    if (!active) {
      if (distance(start, point) < DEFAULT_THRESHOLD) return
      beginDrag(point)
      return
    }

    active = { ...active, current: point }
    setActiveDrag(active)
  }

  function handlePointerMove(pointerEvent: PointerEvent) {
    if (pointerEvent.pointerId !== pointerId) return
    updatePosition({ x: pointerEvent.clientX, y: pointerEvent.clientY })
  }

  function handlePointerUp(pointerEvent: PointerEvent) {
    if (pointerEvent.pointerId !== pointerId) return
    const shouldDrop = Boolean(active)
    const point = { x: pointerEvent.clientX, y: pointerEvent.clientY }
    const payloadToDrop = active?.payload

    cleanup()
    currentPreview = null
    setActiveDrag(null, true)

    if (shouldDrop && payloadToDrop) {
      armClickSuppressor()
      dropSubscribers.forEach(listener => listener({ payload: payloadToDrop, point }))
    }
  }

  function handlePointerCancel(pointerEvent: PointerEvent) {
    if (pointerEvent.pointerId === pointerId) cancel()
  }

  function handleKeyDown(keyEvent: KeyboardEvent) {
    if (keyEvent.key === 'Escape') cancel()
  }

  try {
    sourceElement.setPointerCapture?.(pointerId)
  } catch {
    // Some nested controls do not support capture in every WebView.
  }

  document.addEventListener('pointermove', handlePointerMove, true)
  document.addEventListener('pointerup', handlePointerUp, true)
  document.addEventListener('pointercancel', handlePointerCancel, true)
  document.addEventListener('keydown', handleKeyDown, true)
  window.addEventListener('blur', cancel, true)
}

export function isPointInsideElement(point: InternalDragPoint, element: HTMLElement | null): boolean {
  if (!element) return false
  const rect = element.getBoundingClientRect()
  return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
}
