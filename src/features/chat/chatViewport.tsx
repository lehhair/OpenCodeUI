/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useInputCapabilities } from '../../hooks/useInputCapabilities'

export type ChatSurfaceVariant = 'desktop' | 'compact'
export type ChatInteractionMode = 'pointer' | 'touch'
export type ChatPanelBehavior = 'docked' | 'overlay'

export const CHAT_SURFACE_MIN_WIDTH = 380
export const CHAT_SURFACE_COMPACT_BREAKPOINT = 680
export const CHAT_VIEWPORT_MOBILE_BREAKPOINT = 768
export const CHAT_SPLIT_TOUCH_MIN_WIDTH = 900

const SIDEBAR_STORAGE_KEY = 'sidebar-width'
const SIDEBAR_RAIL_WIDTH = 49
const SIDEBAR_DEFAULT_WIDTH = 288
const SIDEBAR_HARD_MIN_WIDTH = 160
const SIDEBAR_PREFERRED_MIN_WIDTH = 240
const SIDEBAR_MAX_WIDTH = 480
const SMALL_DESKTOP_BREAKPOINT = 1100

const RIGHT_PANEL_HARD_MIN_WIDTH = 160
const RIGHT_PANEL_DEFAULT_WIDTH = 450
const RIGHT_PANEL_MAX_WIDTH = 1280

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function getResponsiveSidebarMaxWidth(viewportWidth: number, preferTouchUi: boolean) {
  return viewportWidth < SMALL_DESKTOP_BREAKPOINT
    ? Math.floor(viewportWidth * (preferTouchUi ? 0.46 : 0.4))
    : SIDEBAR_MAX_WIDTH
}

function getResponsiveSidebarDefaultWidth(viewportWidth: number, preferTouchUi: boolean) {
  return viewportWidth < SMALL_DESKTOP_BREAKPOINT
    ? Math.floor(viewportWidth * (preferTouchUi ? 0.34 : 0.3))
    : SIDEBAR_DEFAULT_WIDTH
}

function getResponsiveRightPanelMaxWidth(viewportWidth: number, preferTouchUi: boolean) {
  return viewportWidth < SMALL_DESKTOP_BREAKPOINT
    ? Math.floor(viewportWidth * (preferTouchUi ? 0.46 : 0.42))
    : Math.max(RIGHT_PANEL_DEFAULT_WIDTH, viewportWidth - 320)
}

interface ComputedViewportInput {
  viewportWidth: number
  viewportHeight: number
  surfaceWidth: number
  sidebarExpanded: boolean
  requestedSidebarWidth: number
  sidebarHasCustomWidth: boolean
  rightPanelOpen: boolean
  requestedRightPanelWidth: number
  preferTouchUi: boolean
  touchCapable: boolean
}

export interface ChatViewportValue {
  presentation: {
    surfaceVariant: ChatSurfaceVariant
    isCompact: boolean
  }
  interaction: {
    mode: ChatInteractionMode
    touchCapable: boolean
    sidebarBehavior: ChatPanelBehavior
    rightPanelBehavior: ChatPanelBehavior
    bottomPanelBehavior: ChatPanelBehavior
    outlineInteraction: ChatInteractionMode
    enableCollapsedInputDock: boolean
  }
  layout: {
    viewportWidth: number
    viewportHeight: number
    surfaceWidth: number
    surfaceMinWidth: number
    sidebar: {
      railWidth: number
      requestedWidth: number
      openWidth: number
      dockedWidth: number
      overlayWidth: number
      hardMinWidth: number
      preferredMinWidth: number
      maxWidth: number
      resizeMaxWidth: number
    }
    rightPanel: {
      requestedWidth: number
      dockedWidth: number
      hardMinWidth: number
      maxWidth: number
      resizeMaxWidth: number
    }
    bottomPanel: {
      maxHeight: number
    }
  }
  actions: {
    setSidebarRequestedWidth: (width: number) => void
  }
}

export function canUseSplitPane(viewport: Pick<ChatViewportValue, 'interaction' | 'layout'>): boolean {
  if (!viewport.interaction.touchCapable) return true

  const { viewportWidth, viewportHeight } = viewport.layout
  return viewportWidth >= CHAT_SPLIT_TOUCH_MIN_WIDTH && viewportWidth > viewportHeight
}

function computeChatViewport(input: ComputedViewportInput): Omit<ChatViewportValue, 'actions'> {
  const {
    viewportWidth,
    viewportHeight,
    surfaceWidth,
    sidebarExpanded,
    requestedSidebarWidth,
    sidebarHasCustomWidth,
    rightPanelOpen,
    requestedRightPanelWidth,
    preferTouchUi,
    touchCapable,
  } = input

  const overlayPanels = viewportWidth < CHAT_VIEWPORT_MOBILE_BREAKPOINT
  const interactionMode: ChatInteractionMode = overlayPanels ? 'touch' : 'pointer'

  const sidebarMaxWidth = clamp(
    getResponsiveSidebarMaxWidth(viewportWidth, preferTouchUi),
    SIDEBAR_HARD_MIN_WIDTH,
    SIDEBAR_MAX_WIDTH,
  )
  const sidebarDefaultWidth = clamp(
    getResponsiveSidebarDefaultWidth(viewportWidth, preferTouchUi),
    SIDEBAR_PREFERRED_MIN_WIDTH,
    sidebarMaxWidth,
  )
  const requestedSidebarOpenWidth = sidebarHasCustomWidth
    ? clamp(requestedSidebarWidth, SIDEBAR_HARD_MIN_WIDTH, sidebarMaxWidth)
    : sidebarDefaultWidth

  const rightPanelMaxWidth = clamp(
    getResponsiveRightPanelMaxWidth(viewportWidth, preferTouchUi),
    RIGHT_PANEL_HARD_MIN_WIDTH,
    RIGHT_PANEL_MAX_WIDTH,
  )
  const requestedRightPanelDockedWidth = rightPanelOpen
    ? clamp(requestedRightPanelWidth, RIGHT_PANEL_HARD_MIN_WIDTH, rightPanelMaxWidth)
    : 0

  let dockedSidebarOpenWidth = requestedSidebarOpenWidth
  let dockedRightPanelWidth = requestedRightPanelDockedWidth
  const closedSidebarWidth = SIDEBAR_RAIL_WIDTH
  const requestedSidebarDockedWidth = sidebarExpanded ? dockedSidebarOpenWidth : closedSidebarWidth
  let remainingSurfaceWidth = viewportWidth - requestedSidebarDockedWidth - dockedRightPanelWidth

  if (!overlayPanels && remainingSurfaceWidth < CHAT_SURFACE_MIN_WIDTH) {
    let shortage = CHAT_SURFACE_MIN_WIDTH - remainingSurfaceWidth

    if (rightPanelOpen && dockedRightPanelWidth > RIGHT_PANEL_HARD_MIN_WIDTH) {
      const rightShrink = Math.min(shortage, dockedRightPanelWidth - RIGHT_PANEL_HARD_MIN_WIDTH)
      dockedRightPanelWidth -= rightShrink
      shortage -= rightShrink
    }

    if (shortage > 0 && sidebarExpanded && dockedSidebarOpenWidth > SIDEBAR_HARD_MIN_WIDTH) {
      const sidebarShrink = Math.min(shortage, dockedSidebarOpenWidth - SIDEBAR_HARD_MIN_WIDTH)
      dockedSidebarOpenWidth -= sidebarShrink
      shortage -= sidebarShrink
    }

    remainingSurfaceWidth =
      viewportWidth - (sidebarExpanded ? dockedSidebarOpenWidth : closedSidebarWidth) - dockedRightPanelWidth
  }

  const sidebarResizeMaxWidth = clamp(
    viewportWidth - CHAT_SURFACE_MIN_WIDTH - dockedRightPanelWidth,
    SIDEBAR_HARD_MIN_WIDTH,
    sidebarMaxWidth,
  )
  const rightPanelResizeMaxWidth = clamp(
    viewportWidth - CHAT_SURFACE_MIN_WIDTH - (sidebarExpanded ? dockedSidebarOpenWidth : closedSidebarWidth),
    RIGHT_PANEL_HARD_MIN_WIDTH,
    rightPanelMaxWidth,
  )

  const actualSurfaceWidth = overlayPanels ? surfaceWidth || viewportWidth : surfaceWidth || remainingSurfaceWidth
  const surfaceVariant: ChatSurfaceVariant =
    actualSurfaceWidth < CHAT_SURFACE_COMPACT_BREAKPOINT ? 'compact' : 'desktop'

  return {
    presentation: {
      surfaceVariant,
      isCompact: surfaceVariant === 'compact',
    },
    interaction: {
      mode: interactionMode,
      touchCapable,
      sidebarBehavior: overlayPanels ? 'overlay' : 'docked',
      rightPanelBehavior: overlayPanels ? 'overlay' : 'docked',
      bottomPanelBehavior: overlayPanels ? 'overlay' : 'docked',
      // Hybrid devices (touchscreen laptops, external touch monitors) can report
      // touch capability even when the user is actively using a mouse. For the
      // message outline rail, prefer pointer interaction whenever hover is
      // available; only switch to touch when the UI itself prefers touch.
      outlineInteraction: overlayPanels || preferTouchUi ? 'touch' : 'pointer',
      enableCollapsedInputDock: overlayPanels,
    },
    layout: {
      viewportWidth,
      viewportHeight,
      surfaceWidth: actualSurfaceWidth,
      surfaceMinWidth: CHAT_SURFACE_MIN_WIDTH,
      sidebar: {
        railWidth: SIDEBAR_RAIL_WIDTH,
        requestedWidth: requestedSidebarOpenWidth,
        openWidth: dockedSidebarOpenWidth,
        dockedWidth: overlayPanels ? 0 : sidebarExpanded ? dockedSidebarOpenWidth : closedSidebarWidth,
        overlayWidth: clamp(
          requestedSidebarOpenWidth,
          SIDEBAR_PREFERRED_MIN_WIDTH,
          Math.max(SIDEBAR_PREFERRED_MIN_WIDTH, viewportWidth - 48),
        ),
        hardMinWidth: SIDEBAR_HARD_MIN_WIDTH,
        preferredMinWidth: SIDEBAR_PREFERRED_MIN_WIDTH,
        maxWidth: sidebarMaxWidth,
        resizeMaxWidth: sidebarResizeMaxWidth,
      },
      rightPanel: {
        requestedWidth: requestedRightPanelDockedWidth,
        dockedWidth: overlayPanels ? 0 : dockedRightPanelWidth,
        hardMinWidth: RIGHT_PANEL_HARD_MIN_WIDTH,
        maxWidth: rightPanelMaxWidth,
        resizeMaxWidth: rightPanelResizeMaxWidth,
      },
      bottomPanel: {
        maxHeight: Math.floor(viewportHeight * (touchCapable ? 0.62 : 0.56)),
      },
    },
  }
}

const ChatViewportContext = createContext<ChatViewportValue | null>(null)

export function ChatViewportProvider({ value, children }: { value: ChatViewportValue; children: ReactNode }) {
  return <ChatViewportContext.Provider value={value}>{children}</ChatViewportContext.Provider>
}

export function useChatViewport() {
  const value = useContext(ChatViewportContext)
  if (!value) {
    throw new Error('useChatViewport must be used within ChatViewportProvider')
  }
  return value
}

/** Read the outer viewport context without throwing — returns null outside a provider. */
export function useChatViewportMaybe(): ChatViewportValue | null {
  return useContext(ChatViewportContext)
}

export function useChatViewportController({
  sidebarExpanded,
  rightPanelOpen,
  requestedRightPanelWidth,
}: {
  sidebarExpanded: boolean
  rightPanelOpen: boolean
  requestedRightPanelWidth: number
}) {
  const { preferTouchUi, hasCoarsePointer, hasTouch } = useInputCapabilities()
  const touchCapable = preferTouchUi || hasCoarsePointer || hasTouch
  const surfaceRef = useRef<HTMLDivElement>(null)
  const [viewportWidth, setViewportWidth] = useState(() => (typeof window === 'undefined' ? 1280 : window.innerWidth))
  const [viewportHeight, setViewportHeight] = useState(() => (typeof window === 'undefined' ? 800 : window.innerHeight))
  const [surfaceWidth, setSurfaceWidth] = useState(0)
  const [sidebarHasCustomWidth, setSidebarHasCustomWidth] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_STORAGE_KEY) !== null
    } catch {
      return false
    }
  })
  const [requestedSidebarWidth, setRequestedSidebarWidthState] = useState(() => {
    try {
      const saved = localStorage.getItem(SIDEBAR_STORAGE_KEY)
      return saved ? parseInt(saved, 10) || SIDEBAR_DEFAULT_WIDTH : SIDEBAR_DEFAULT_WIDTH
    } catch {
      return SIDEBAR_DEFAULT_WIDTH
    }
  })

  useEffect(() => {
    const handleResize = () => {
      setViewportWidth(window.innerWidth)
      setViewportHeight(window.innerHeight)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    const el = surfaceRef.current
    if (!el) return

    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        setSurfaceWidth(entry.contentRect.width)
      }
    })

    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const setSidebarRequestedWidth = useCallback((width: number) => {
    setSidebarHasCustomWidth(true)
    setRequestedSidebarWidthState(width)
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, String(width))
    } catch {
      // ignore
    }
  }, [])

  const computed = useMemo(
    () =>
      computeChatViewport({
        viewportWidth,
        viewportHeight,
        surfaceWidth,
        sidebarExpanded,
        requestedSidebarWidth,
        sidebarHasCustomWidth,
        rightPanelOpen,
        requestedRightPanelWidth,
        preferTouchUi,
        touchCapable,
      }),
    [
      viewportWidth,
      viewportHeight,
      surfaceWidth,
      sidebarExpanded,
      requestedSidebarWidth,
      sidebarHasCustomWidth,
      rightPanelOpen,
      requestedRightPanelWidth,
      preferTouchUi,
      touchCapable,
    ],
  )

  const value = useMemo<ChatViewportValue>(
    () => ({
      ...computed,
      actions: {
        setSidebarRequestedWidth,
      },
    }),
    [computed, setSidebarRequestedWidth],
  )

  return {
    surfaceRef,
    value,
  }
}
