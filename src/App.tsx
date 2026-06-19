import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { invoke } from '@tauri-apps/api/core'
import { Sidebar } from './features/chat'
import { ChatPane } from './features/chat/ChatPane'
import { SplitContainer } from './features/chat/SplitContainer'
import type { CommandItem } from './components/CommandPalette'
import { ToastContainer } from './components/ToastContainer'
import { RightPanel } from './components/RightPanel'
import { BottomPanel } from './components/BottomPanel'
import { DesktopTitlebar } from './components/DesktopTitlebar'
import { useDirectory, useGlobalEvents, useGlobalKeybindings, useRouter } from './hooks'
import { useViewportHeight } from './hooks/useViewportHeight'
import { useCloseServiceDialog } from './hooks/useCloseServiceDialog'
import { useWakeLock } from './hooks/useWakeLock'
import type { KeybindingHandlers } from './hooks/useKeybindings'
import { keybindingStore } from './store/keybindingStore'
import {
  layoutStore,
  paneLayoutStore,
  useLayoutStore,
  usePaneController,
  usePaneControllers,
  usePaneLayout,
  updateStore,
} from './store'
import {
  ChatViewportProvider,
  CHAT_SURFACE_MIN_WIDTH,
  canUseSplitPane,
  useChatViewportController,
} from './features/chat/chatViewport'
import { uiErrorHandler, isSameDirectory, collectActiveDirectories } from './utils'
import { initNotificationSound } from './utils/notificationSoundBridge'
import { createPtySession } from './api/pty'
import type { TerminalTab } from './store/layoutStore'
import type { SettingsTab } from './features/settings/SettingsDialog'
import { isTauri, isTauriMobile } from './utils/tauri'
import { InternalDragLayer } from './components/InternalDragLayer'

const SettingsDialog = lazy(() =>
  import('./features/settings/SettingsDialog').then(module => ({ default: module.SettingsDialog })),
)
const CommandPalette = lazy(() =>
  import('./components/CommandPalette').then(module => ({ default: module.CommandPalette })),
)
const CloseServiceDialog = lazy(() =>
  import('./components/CloseServiceDialog').then(module => ({ default: module.CloseServiceDialog })),
)

const MOBILE_PAGER_SCROLL_END_MS = 120
const MOBILE_RIGHT_PANEL_UNMOUNT_MS = 420

type MobilePagerPage = 'left' | 'chat' | 'right'

function App() {
  const { t } = useTranslation(['commands', 'chat', 'common', 'components'])
  const router = useRouter()
  const {
    sessionId: routeSessionId,
    directory: routeDirectory,
    navigateToSession: navigateRouteToSession,
    navigateHome: navigateRouteHome,
    replaceSession,
  } = router
  const { currentDirectory, savedDirectories, sidebarExpanded, setSidebarExpanded } = useDirectory()
  const { rightPanelOpen, rightPanelWidth, wakeLock } = useLayoutStore()
  const { surfaceRef, value: chatViewport } = useChatViewportController({
    sidebarExpanded,
    rightPanelOpen,
    requestedRightPanelWidth: rightPanelWidth,
  })
  const splitPaneEnabled = canUseSplitPane(chatViewport)
  const paneLayout = usePaneLayout()
  const focusedController = usePaneController(paneLayout.focusedPaneId)
  const paneControllers = usePaneControllers()
  const syncingFromRouteRef = useRef(false)
  const lastRouteSessionIdRef = useRef<string | null | undefined>(undefined)
  // 当 currentDirectory 为 undefined 时表示全局模式，
  // 不应 fallback 到 session 自身的 directory，否则 replaceSession 会把 dir 参数写回 URL
  const focusedRouteDirectory =
    currentDirectory !== undefined
      ? paneLayout.focusedSessionId === routeSessionId
        ? routeDirectory || focusedController?.effectiveDirectory || currentDirectory
        : focusedController?.effectiveDirectory || currentDirectory
      : undefined

  useEffect(() => {
    const cleanup = initNotificationSound()
    return cleanup
  }, [])

  useEffect(() => {
    if (!isTauri() || isTauriMobile()) return

    void invoke('desktop_window_ready').catch(() => {
      // best effort only
    })
  }, [])

  useEffect(() => {
    if (import.meta.env.DEV) return
    void updateStore.checkForUpdates()
  }, [])

  useViewportHeight()
  useWakeLock(wakeLock)

  const activeDirectories = useMemo(
    () =>
      collectActiveDirectories({
        routeDirectory,
        currentDirectory,
        paneDirectories: paneControllers
          .map(controller => controller.effectiveDirectory)
          .filter((directory): directory is string => Boolean(directory)),
        projectDirectories: (Array.isArray(savedDirectories) ? savedDirectories : []).map(directory => directory.path),
      }),
    [routeDirectory, currentDirectory, paneControllers, savedDirectories],
  )

  // 全局唯一 SSE 连接。所有 pane 通过 consumer 机制接收自己的 session 事件。
  useGlobalEvents(activeDirectories)

  // URL -> focused pane session
  useEffect(() => {
    if (lastRouteSessionIdRef.current === routeSessionId) return
    lastRouteSessionIdRef.current = routeSessionId
    if (paneLayoutStore.getFocusedSessionId() === routeSessionId) return
    syncingFromRouteRef.current = true
    paneLayoutStore.setFocusedSession(routeSessionId)
  }, [routeSessionId])

  // focused pane session -> URL（路由只反映当前 focused pane）
  useEffect(() => {
    if (syncingFromRouteRef.current) {
      syncingFromRouteRef.current = false
      return
    }
    if (paneLayoutStore.getFocusedSessionId() !== paneLayout.focusedSessionId) return
    if (paneLayout.focusedSessionId === routeSessionId && isSameDirectory(routeDirectory, focusedRouteDirectory)) return
    replaceSession(paneLayout.focusedSessionId, focusedRouteDirectory)
  }, [
    paneLayout.focusedPaneId,
    paneLayout.focusedSessionId,
    routeSessionId,
    routeDirectory,
    replaceSession,
    focusedRouteDirectory,
  ])

  const navigatePaneToSession = useCallback(
    (paneId: string, sessionId: string, directory?: string) => {
      paneLayoutStore.focusPane(paneId)
      paneLayoutStore.setPaneSession(paneId, sessionId)
      navigateRouteToSession(sessionId, directory)
    },
    [navigateRouteToSession],
  )

  const navigatePaneHome = useCallback(
    (paneId: string) => {
      paneLayoutStore.focusPane(paneId)
      paneLayoutStore.setPaneSession(paneId, null)
      navigateRouteHome()
    },
    [navigateRouteHome],
  )

  const handleSelectSession = useCallback(
    (session: { id: string; directory?: string }) => {
      const paneId = paneLayout.focusedPaneId ?? paneLayoutStore.getFocusedPaneId()
      if (!paneId) return
      navigatePaneToSession(paneId, session.id, session.directory)
    },
    [paneLayout.focusedPaneId, navigatePaneToSession],
  )

  const handleNewSession = useCallback(() => {
    const paneId = paneLayout.focusedPaneId ?? paneLayoutStore.getFocusedPaneId()
    if (!paneId) return
    navigatePaneHome(paneId)
  }, [paneLayout.focusedPaneId, navigatePaneHome])

  const handleEnterSplitMode = useCallback(() => {
    paneLayoutStore.enterSplitMode(paneLayout.focusedSessionId)
  }, [paneLayout.focusedSessionId])

  const handleToggleFocusedPaneFullscreen = useCallback(() => {
    const paneId = paneLayout.focusedPaneId ?? paneLayoutStore.getFocusedPaneId()
    if (!paneId) return
    paneLayoutStore.togglePaneFullscreen(paneId)
  }, [paneLayout.focusedPaneId])

  const isMobilePanelLayout = chatViewport.interaction.sidebarBehavior === 'overlay'
  const mobileLeftPanelWidth = chatViewport.layout.sidebar.overlayWidth
  const mobilePageWidth = Math.max(1, chatViewport.layout.viewportWidth)
  const mobileChatScrollLeft = mobileLeftPanelWidth
  const mobileRightScrollLeft = mobileLeftPanelWidth + mobilePageWidth
  const mobilePagerRef = useRef<HTMLDivElement | null>(null)
  const mobilePagerInitializedRef = useRef(false)
  const mobileScrollEndTimerRef = useRef<number | null>(null)
  const mobileRightUnmountTimerRef = useRef<number | null>(null)
  const shouldRenderMobileRightPanelRef = useRef(false)
  const [shouldRenderMobileRightPanel, setShouldRenderMobileRightPanel] = useState(false)

  const setMobileRightPanelRendered = useCallback((rendered: boolean) => {
    if (shouldRenderMobileRightPanelRef.current === rendered) return
    shouldRenderMobileRightPanelRef.current = rendered
    setShouldRenderMobileRightPanel(rendered)
  }, [])

  const clearMobileRightUnmountTimer = useCallback(() => {
    if (mobileRightUnmountTimerRef.current === null) return
    window.clearTimeout(mobileRightUnmountTimerRef.current)
    mobileRightUnmountTimerRef.current = null
  }, [])

  const ensureMobileRightPanelRendered = useCallback(() => {
    clearMobileRightUnmountTimer()
    setMobileRightPanelRendered(true)
  }, [clearMobileRightUnmountTimer, setMobileRightPanelRendered])

  const getMobilePagerTarget = useCallback(() => {
    if (rightPanelOpen) return mobileRightScrollLeft
    if (sidebarExpanded) return 0
    return mobileChatScrollLeft
  }, [mobileChatScrollLeft, mobileRightScrollLeft, rightPanelOpen, sidebarExpanded])

  const scrollMobilePagerTo = useCallback(
    (page: MobilePagerPage, behavior: ScrollBehavior = 'smooth') => {
      const pager = mobilePagerRef.current
      if (!pager) return

      const left = page === 'left' ? 0 : page === 'right' ? mobileRightScrollLeft : mobileChatScrollLeft
      pager.scrollTo({ left, behavior })
    },
    [mobileChatScrollLeft, mobileRightScrollLeft],
  )

  const getNearestMobilePage = useCallback(
    (scrollLeft: number): MobilePagerPage => {
      const leftDistance = Math.abs(scrollLeft)
      const chatDistance = Math.abs(scrollLeft - mobileChatScrollLeft)
      const rightDistance = Math.abs(scrollLeft - mobileRightScrollLeft)

      if (leftDistance <= chatDistance && leftDistance <= rightDistance) return 'left'
      if (rightDistance <= chatDistance) return 'right'
      return 'chat'
    },
    [mobileChatScrollLeft, mobileRightScrollLeft],
  )

  const syncMobilePagerState = useCallback(() => {
    const pager = mobilePagerRef.current
    if (!pager) return

    const page = getNearestMobilePage(pager.scrollLeft)
    if (page === 'left') {
      if (!sidebarExpanded) setSidebarExpanded(true)
      if (rightPanelOpen) layoutStore.closeRightPanel()
      return
    }

    if (page === 'right') {
      ensureMobileRightPanelRendered()
      if (sidebarExpanded) setSidebarExpanded(false)
      if (!rightPanelOpen) layoutStore.openRightPanel('files')
      return
    }

    if (sidebarExpanded) setSidebarExpanded(false)
    if (rightPanelOpen) layoutStore.closeRightPanel()
  }, [ensureMobileRightPanelRendered, getNearestMobilePage, rightPanelOpen, setSidebarExpanded, sidebarExpanded])

  const handleMobilePagerScroll = useCallback(() => {
    const pager = mobilePagerRef.current
    if (!pager) return

    if (pager.scrollLeft > mobileChatScrollLeft + 24) {
      ensureMobileRightPanelRendered()
    }

    if (mobileScrollEndTimerRef.current !== null) {
      window.clearTimeout(mobileScrollEndTimerRef.current)
    }

    mobileScrollEndTimerRef.current = window.setTimeout(() => {
      mobileScrollEndTimerRef.current = null
      syncMobilePagerState()
    }, MOBILE_PAGER_SCROLL_END_MS)
  }, [ensureMobileRightPanelRendered, mobileChatScrollLeft, syncMobilePagerState])

  useLayoutEffect(() => {
    if (!isMobilePanelLayout) {
      mobilePagerInitializedRef.current = false
      return
    }

    const pager = mobilePagerRef.current
    if (!pager) return

    const target = getMobilePagerTarget()
    pager.scrollTo({ left: target, behavior: mobilePagerInitializedRef.current ? 'smooth' : 'auto' })
    mobilePagerInitializedRef.current = true
  }, [getMobilePagerTarget, isMobilePanelLayout])

  useEffect(() => {
    if (!isMobilePanelLayout) {
      clearMobileRightUnmountTimer()
      const frameId = window.requestAnimationFrame(() => setMobileRightPanelRendered(false))
      return () => window.cancelAnimationFrame(frameId)
    }

    if (rightPanelOpen) {
      clearMobileRightUnmountTimer()
      const frameId = window.requestAnimationFrame(() => setMobileRightPanelRendered(true))
      return () => window.cancelAnimationFrame(frameId)
    }

    clearMobileRightUnmountTimer()
    mobileRightUnmountTimerRef.current = window.setTimeout(() => {
      setMobileRightPanelRendered(false)
      mobileRightUnmountTimerRef.current = null
    }, MOBILE_RIGHT_PANEL_UNMOUNT_MS)

    return clearMobileRightUnmountTimer
  }, [clearMobileRightUnmountTimer, isMobilePanelLayout, rightPanelOpen, setMobileRightPanelRendered])

  useEffect(() => {
    if (!isMobilePanelLayout || !rightPanelOpen || !sidebarExpanded) return

    const frameId = window.requestAnimationFrame(() => setSidebarExpanded(false))
    return () => window.cancelAnimationFrame(frameId)
  }, [isMobilePanelLayout, rightPanelOpen, setSidebarExpanded, sidebarExpanded])

  useEffect(() => {
    return () => {
      if (mobileScrollEndTimerRef.current !== null) window.clearTimeout(mobileScrollEndTimerRef.current)
      if (mobileRightUnmountTimerRef.current !== null) window.clearTimeout(mobileRightUnmountTimerRef.current)
    }
  }, [])

  const handleOpenSidebar = useCallback(() => {
    if (isMobilePanelLayout && rightPanelOpen) {
      layoutStore.closeRightPanel()
    }
    if (isMobilePanelLayout) {
      scrollMobilePagerTo('left')
    }
    setSidebarExpanded(true)
  }, [isMobilePanelLayout, rightPanelOpen, scrollMobilePagerTo, setSidebarExpanded])

  const handleCloseSidebar = useCallback(() => {
    if (isMobilePanelLayout) {
      scrollMobilePagerTo('chat')
    }
    setSidebarExpanded(false)
  }, [isMobilePanelLayout, scrollMobilePagerTo, setSidebarExpanded])

  const handleToggleRightPanel = useCallback(() => {
    if (!isMobilePanelLayout) {
      layoutStore.toggleRightPanel()
      return
    }

    if (rightPanelOpen) {
      scrollMobilePagerTo('chat')
      layoutStore.closeRightPanel()
      return
    }

    ensureMobileRightPanelRendered()
    if (sidebarExpanded) setSidebarExpanded(false)
    scrollMobilePagerTo('right')
    layoutStore.openRightPanel('files')
  }, [ensureMobileRightPanelRendered, isMobilePanelLayout, rightPanelOpen, scrollMobilePagerTo, setSidebarExpanded, sidebarExpanded])

  const focusedDirectory = focusedRouteDirectory || ''

  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false)
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTab>('servers')
  const openSettingsTab = useCallback((tab: SettingsTab) => {
    setSettingsInitialTab(tab)
    setSettingsDialogOpen(true)
  }, [])
  const openSettings = useCallback(() => {
    openSettingsTab('servers')
  }, [openSettingsTab])
  const openAboutSettings = useCallback(() => {
    openSettingsTab('about')
  }, [openSettingsTab])
  const closeSettings = useCallback(() => setSettingsDialogOpen(false), [])

  const renderPaneLeaf = useCallback(
    (paneId: string, paneSessionId: string | null) => (
      <ChatPane
        key={paneId}
        paneId={paneId}
        sessionId={paneSessionId}
        isFocused={paneLayout.focusedPaneId === paneId}
        paneCount={paneLayout.paneCount}
        displayMode={paneLayout.isSplit && paneLayout.fullscreenPaneId !== paneId ? 'split' : 'single'}
        isPaneFullscreen={paneLayout.fullscreenPaneId === paneId}
        onOpenSidebar={handleOpenSidebar}
        onToggleRightPanel={handleToggleRightPanel}
        showSidebarButton={chatViewport.interaction.sidebarBehavior === 'overlay'}
        onSplitPane={splitPaneEnabled && !paneLayout.fullscreenPaneId ? handleEnterSplitMode : undefined}
        onTogglePaneFullscreen={paneLayout.isSplit ? handleToggleFocusedPaneFullscreen : undefined}
        onOpenSettings={openSettings}
        navigatePaneToSession={navigatePaneToSession}
        navigatePaneHome={navigatePaneHome}
      />
    ),
    [
      paneLayout.focusedPaneId,
      paneLayout.paneCount,
      paneLayout.isSplit,
      paneLayout.fullscreenPaneId,
      chatViewport.interaction.sidebarBehavior,
      splitPaneEnabled,
      handleOpenSidebar,
      handleToggleRightPanel,
      handleEnterSplitMode,
      handleToggleFocusedPaneFullscreen,
      openSettings,
      navigatePaneToSession,
      navigatePaneHome,
    ],
  )

  const [projectDialogOpen, setProjectDialogOpen] = useState(false)
  const openProject = useCallback(() => setProjectDialogOpen(true), [])
  const closeProjectDialog = useCallback(() => setProjectDialogOpen(false), [])

  // 桌面标题栏通过 CustomEvent 触发打开项目/设置
  useEffect(() => {
    const onOpenProject = () => openProject()
    const onOpenSettings = () => openSettings()
    window.addEventListener('titlebar:open-project', onOpenProject)
    window.addEventListener('titlebar:open-settings', onOpenSettings)
    return () => {
      window.removeEventListener('titlebar:open-project', onOpenProject)
      window.removeEventListener('titlebar:open-settings', onOpenSettings)
    }
  }, [openProject, openSettings])

  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)

  const handleNewTerminal = useCallback(async () => {
    try {
      const pty = await createPtySession({ cwd: focusedDirectory }, focusedDirectory)
      const tab: TerminalTab = {
        id: pty.id,
        title: pty.title || t('components:terminal.terminal'),
        status: 'connecting',
      }
      layoutStore.addTerminalTab(tab, true)
    } catch (error) {
      uiErrorHandler('create terminal', error)
    }
  }, [focusedDirectory, t])

  const keybindingHandlers = useMemo<KeybindingHandlers>(
    () => ({
      openSettings,
      openProject,
      commandPalette: () => setCommandPaletteOpen(true),
      toggleSidebar: () => setSidebarExpanded(!sidebarExpanded),
      toggleRightPanel: handleToggleRightPanel,
      focusInput: () => {
        const input = document.querySelector<HTMLTextAreaElement>('[data-input-box] textarea')
        input?.focus()
      },
      newSession: () => focusedController?.newSession(),
      archiveSession: () => focusedController?.archiveSession(),
      previousSession: () => focusedController?.previousSession(),
      nextSession: () => focusedController?.nextSession(),
      toggleTerminal: () => layoutStore.toggleBottomPanel(),
      newTerminal: handleNewTerminal,
      selectModel: () => focusedController?.openModelSelector(),
      toggleAgent: () => focusedController?.toggleAgent(),
      cancelMessage: () => focusedController?.cancelMessage(),
      copyLastResponse: () => focusedController?.copyLastResponse(),
      toggleFullAuto: () => focusedController?.toggleFullAuto(),
      // Pane
      focusNextPane: () => {
        paneLayoutStore.focusNextPane()
        requestAnimationFrame(() => {
          const pid = paneLayoutStore.getFocusedPaneId()
          if (pid) {
            const input = document.querySelector<HTMLTextAreaElement>(`[data-pane-id="${pid}"] textarea`)
            input?.focus()
          }
        })
      },
      focusPrevPane: () => {
        paneLayoutStore.focusPrevPane()
        requestAnimationFrame(() => {
          const pid = paneLayoutStore.getFocusedPaneId()
          if (pid) {
            const input = document.querySelector<HTMLTextAreaElement>(`[data-pane-id="${pid}"] textarea`)
            input?.focus()
          }
        })
      },
      splitRight: () => {
        const pid = paneLayout.focusedPaneId ?? paneLayoutStore.getFocusedPaneId()
        if (pid && splitPaneEnabled) paneLayoutStore.splitPane(pid, 'horizontal')
      },
      splitDown: () => {
        const pid = paneLayout.focusedPaneId ?? paneLayoutStore.getFocusedPaneId()
        if (pid && splitPaneEnabled) paneLayoutStore.splitPane(pid, 'vertical')
      },
      closePane: () => {
        const pid = paneLayout.focusedPaneId ?? paneLayoutStore.getFocusedPaneId()
        if (pid && paneLayout.isSplit) paneLayoutStore.closePane(pid)
      },
      togglePaneFullscreen: () => {
        if (paneLayout.isSplit) handleToggleFocusedPaneFullscreen()
      },
    }),
    [
      openSettings,
      openProject,
      sidebarExpanded,
      setSidebarExpanded,
      focusedController,
      handleToggleRightPanel,
      handleNewTerminal,
      paneLayout.focusedPaneId,
      paneLayout.isSplit,
      splitPaneEnabled,
      handleToggleFocusedPaneFullscreen,
    ],
  )

  useGlobalKeybindings(keybindingHandlers)

  const commands = useMemo<CommandItem[]>(() => {
    const getShortcut = (action: string) =>
      keybindingStore.getKey(action as import('./store/keybindingStore').KeybindingAction)

    return [
      {
        id: 'openSettings',
        label: t('commands:openSettings'),
        description: t('commands:openSettingsDesc'),
        category: t('commands:categories.general'),
        shortcut: getShortcut('openSettings'),
        action: openSettings,
      },
      {
        id: 'openProject',
        label: t('commands:openProject'),
        description: t('commands:openProjectDesc'),
        category: t('commands:categories.general'),
        shortcut: getShortcut('openProject'),
        action: openProject,
      },
      {
        id: 'openSettingsShortcuts',
        label: t('commands:openShortcutsSettings'),
        description: t('commands:openShortcutsSettingsDesc'),
        category: t('commands:categories.general'),
        action: () => {
          openSettingsTab('keybindings')
        },
      },
      {
        id: 'toggleSidebar',
        label: t('commands:toggleSidebar'),
        description: t('commands:toggleSidebarDesc'),
        category: t('commands:categories.general'),
        shortcut: getShortcut('toggleSidebar'),
        action: () => setSidebarExpanded(!sidebarExpanded),
      },
      {
        id: 'toggleRightPanel',
        label: t('commands:toggleRightPanel'),
        description: t('commands:toggleRightPanelDesc'),
        category: t('commands:categories.general'),
        shortcut: getShortcut('toggleRightPanel'),
        action: handleToggleRightPanel,
      },
      {
        id: 'focusInput',
        label: t('commands:focusInput'),
        description: t('commands:focusInputDesc'),
        category: t('commands:categories.general'),
        shortcut: getShortcut('focusInput'),
        action: () => {
          const input = document.querySelector<HTMLTextAreaElement>('[data-input-box] textarea')
          input?.focus()
        },
      },
      {
        id: 'newSession',
        label: t('commands:newSession'),
        description: t('commands:newSessionDesc'),
        category: t('commands:categories.session'),
        shortcut: getShortcut('newSession'),
        action: () => focusedController?.newSession(),
      },
      {
        id: 'archiveSession',
        label: t('commands:archiveSession'),
        description: t('commands:archiveSessionDesc'),
        category: t('commands:categories.session'),
        shortcut: getShortcut('archiveSession'),
        action: () => focusedController?.archiveSession(),
      },
      {
        id: 'previousSession',
        label: t('commands:previousSession'),
        description: t('commands:previousSessionDesc'),
        category: t('commands:categories.session'),
        shortcut: getShortcut('previousSession'),
        action: () => focusedController?.previousSession(),
      },
      {
        id: 'nextSession',
        label: t('commands:nextSession'),
        description: t('commands:nextSessionDesc'),
        category: t('commands:categories.session'),
        shortcut: getShortcut('nextSession'),
        action: () => focusedController?.nextSession(),
      },
      {
        id: 'toggleTerminal',
        label: t('commands:toggleTerminal'),
        description: t('commands:toggleTerminalDesc'),
        category: t('commands:categories.terminal'),
        shortcut: getShortcut('toggleTerminal'),
        action: () => layoutStore.toggleBottomPanel(),
      },
      {
        id: 'newTerminal',
        label: t('commands:newTerminal'),
        description: t('commands:newTerminalDesc'),
        category: t('commands:categories.terminal'),
        shortcut: getShortcut('newTerminal'),
        action: handleNewTerminal,
      },
      {
        id: 'selectModel',
        label: t('commands:selectModel'),
        description: t('commands:selectModelDesc'),
        category: t('commands:categories.model'),
        shortcut: getShortcut('selectModel'),
        action: () => focusedController?.openModelSelector(),
      },
      {
        id: 'toggleAgent',
        label: t('commands:toggleAgent'),
        description: t('commands:toggleAgentDesc'),
        category: t('commands:categories.model'),
        shortcut: getShortcut('toggleAgent'),
        action: () => focusedController?.toggleAgent(),
      },
      {
        id: 'copyLastResponse',
        label: t('commands:copyLastResponse'),
        description: t('commands:copyLastResponseDesc'),
        category: t('commands:categories.message'),
        shortcut: getShortcut('copyLastResponse'),
        action: () => focusedController?.copyLastResponse(),
      },
      {
        id: 'cancelMessage',
        label: t('commands:cancelMessage'),
        description: t('commands:cancelMessageDesc'),
        category: t('commands:categories.message'),
        shortcut: getShortcut('cancelMessage'),
        action: () => focusedController?.cancelMessage(),
        when: () => !!focusedController?.isStreaming,
      },
      // Pane
      {
        id: 'focusNextPane',
        label: t('commands:focusNextPane'),
        description: t('commands:focusNextPaneDesc'),
        category: t('commands:categories.pane'),
        shortcut: getShortcut('focusNextPane'),
        action: () => paneLayoutStore.focusNextPane(),
      },
      {
        id: 'focusPrevPane',
        label: t('commands:focusPrevPane'),
        description: t('commands:focusPrevPaneDesc'),
        category: t('commands:categories.pane'),
        shortcut: getShortcut('focusPrevPane'),
        action: () => paneLayoutStore.focusPrevPane(),
      },
      {
        id: 'splitRight',
        label: t('commands:splitRight'),
        description: t('commands:splitRightDesc'),
        category: t('commands:categories.pane'),
        shortcut: getShortcut('splitRight'),
        action: () => {
          const pid = paneLayout.focusedPaneId ?? paneLayoutStore.getFocusedPaneId()
          if (pid && splitPaneEnabled) paneLayoutStore.splitPane(pid, 'horizontal')
        },
      },
      {
        id: 'splitDown',
        label: t('commands:splitDown'),
        description: t('commands:splitDownDesc'),
        category: t('commands:categories.pane'),
        shortcut: getShortcut('splitDown'),
        action: () => {
          const pid = paneLayout.focusedPaneId ?? paneLayoutStore.getFocusedPaneId()
          if (pid && splitPaneEnabled) paneLayoutStore.splitPane(pid, 'vertical')
        },
      },
      {
        id: 'closePane',
        label: t('commands:closePane'),
        description: t('commands:closePaneDesc'),
        category: t('commands:categories.pane'),
        shortcut: getShortcut('closePane'),
        action: () => {
          const pid = paneLayout.focusedPaneId ?? paneLayoutStore.getFocusedPaneId()
          if (pid && paneLayout.isSplit) paneLayoutStore.closePane(pid)
        },
        when: () => paneLayout.isSplit,
      },
      {
        id: 'togglePaneFullscreen',
        label: t('commands:togglePaneFullscreen'),
        description: t('commands:togglePaneFullscreenDesc'),
        category: t('commands:categories.pane'),
        shortcut: getShortcut('togglePaneFullscreen'),
        action: () => {
          if (paneLayout.isSplit) handleToggleFocusedPaneFullscreen()
        },
        when: () => paneLayout.isSplit,
      },
    ]
  }, [
    t,
    openSettings,
    openProject,
    openSettingsTab,
    handleToggleRightPanel,
    sidebarExpanded,
    setSidebarExpanded,
    focusedController,
    handleNewTerminal,
    paneLayout.focusedPaneId,
    paneLayout.isSplit,
    splitPaneEnabled,
    handleToggleFocusedPaneFullscreen,
  ])

  const { showCloseDialog, handleCloseDialogConfirm, handleCloseDialogCancel } = useCloseServiceDialog()

  return (
    <div className="relative flex h-full flex-col bg-bg-100 overflow-hidden">
      <DesktopTitlebar />
      <InternalDragLayer />
      <ChatViewportProvider value={chatViewport}>
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          {isMobilePanelLayout ? (
            <>
              <div
                ref={mobilePagerRef}
                className="mobile-chat-pager absolute inset-0 flex h-full overflow-x-auto overflow-y-hidden bg-bg-100"
                style={{
                  scrollSnapType: 'x mandatory',
                  overscrollBehaviorX: 'contain',
                  scrollbarWidth: 'none',
                  WebkitOverflowScrolling: 'touch',
                }}
                onScroll={handleMobilePagerScroll}
              >
                <section
                  className="h-full shrink-0 overflow-hidden bg-bg-100"
                  style={{
                    width: `${mobileLeftPanelWidth}px`,
                    flexBasis: `${mobileLeftPanelWidth}px`,
                    scrollSnapAlign: 'start',
                    scrollSnapStop: 'always',
                  }}
                >
                  <Sidebar
                    isOpen={sidebarExpanded}
                    selectedSessionId={paneLayout.focusedSessionId}
                    onSelectSession={handleSelectSession}
                    onNewSession={handleNewSession}
                    onOpen={handleOpenSidebar}
                    onClose={handleCloseSidebar}
                    contextLimit={focusedController?.contextLimit}
                    onOpenSettings={openSettings}
                    projectDialogOpen={projectDialogOpen}
                    onProjectDialogClose={closeProjectDialog}
                    mobileInline
                  />
                </section>

                <section
                  ref={surfaceRef}
                  className="relative flex h-full shrink-0 flex-col overflow-hidden bg-bg-100"
                  style={{
                    width: `${mobilePageWidth}px`,
                    flexBasis: `${mobilePageWidth}px`,
                    scrollSnapAlign: 'start',
                    scrollSnapStop: 'always',
                  }}
                >
                  <div className={paneLayout.isSplit && !paneLayout.fullscreenPaneId ? 'flex-1 min-h-0 p-2' : 'flex-1 min-h-0'}>
                    <SplitContainer
                      node={paneLayout.root}
                      renderLeaf={renderPaneLeaf}
                      fullscreenPaneId={paneLayout.fullscreenPaneId}
                    />
                  </div>

                  {sidebarExpanded && (
                    <button
                      type="button"
                      aria-label={t('chat:sidebar.collapseSidebar')}
                      className="absolute inset-0 z-[70] cursor-default bg-transparent"
                      onClick={handleCloseSidebar}
                    />
                  )}
                </section>

                <section
                  className="h-full shrink-0 overflow-hidden bg-bg-100"
                  style={{
                    width: `${mobilePageWidth}px`,
                    flexBasis: `${mobilePageWidth}px`,
                    scrollSnapAlign: 'start',
                    scrollSnapStop: 'always',
                  }}
                >
                  <RightPanel
                    directory={focusedDirectory}
                    sessionId={paneLayout.focusedSessionId}
                    inline
                    renderPanelContent={rightPanelOpen || shouldRenderMobileRightPanel}
                  />
                </section>
              </div>

              <BottomPanel directory={focusedDirectory} />
            </>
          ) : (
            <>
              <Sidebar
                isOpen={sidebarExpanded}
                selectedSessionId={paneLayout.focusedSessionId}
                onSelectSession={handleSelectSession}
                onNewSession={handleNewSession}
                onOpen={handleOpenSidebar}
                onClose={handleCloseSidebar}
                contextLimit={focusedController?.contextLimit}
                onOpenSettings={openSettings}
                projectDialogOpen={projectDialogOpen}
                onProjectDialogClose={closeProjectDialog}
              />

              <div className="flex-1 flex min-w-0 h-full overflow-hidden">
                <div
                  ref={surfaceRef}
                  className="flex-1 flex flex-col min-w-0 overflow-hidden"
                  style={{ minWidth: `${CHAT_SURFACE_MIN_WIDTH}px` }}
                >
                  <div className={paneLayout.isSplit && !paneLayout.fullscreenPaneId ? 'flex-1 min-h-0 p-2' : 'flex-1 min-h-0'}>
                    <SplitContainer
                      node={paneLayout.root}
                      renderLeaf={renderPaneLeaf}
                      fullscreenPaneId={paneLayout.fullscreenPaneId}
                    />
                  </div>

                  <BottomPanel directory={focusedDirectory} />
                </div>

                <RightPanel directory={focusedDirectory} sessionId={paneLayout.focusedSessionId} />
              </div>
            </>
          )}
          <ToastContainer onOpenAbout={openAboutSettings} />
        </div>

        <Suspense fallback={null}>
          <SettingsDialog isOpen={settingsDialogOpen} onClose={closeSettings} initialTab={settingsInitialTab} />
          <CommandPalette
            isOpen={commandPaletteOpen}
            onClose={() => setCommandPaletteOpen(false)}
            commands={commands}
          />
        </Suspense>

        <Suspense fallback={null}>
          <CloseServiceDialog
            isOpen={showCloseDialog}
            onConfirm={handleCloseDialogConfirm}
            onCancel={handleCloseDialogCancel}
          />
        </Suspense>
      </ChatViewportProvider>
    </div>
  )
}

export default App
