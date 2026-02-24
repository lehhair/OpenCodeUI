import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { Header, InputBox, PermissionDialog, QuestionDialog, Sidebar, ChatArea, type ChatAreaHandle } from './features/chat'
import { type ModelSelectorHandle } from './features/chat/ModelSelector'
import { SettingsDialog } from './features/settings/SettingsDialog'
import { CommandPalette, type CommandItem } from './components/CommandPalette'
import { ToastContainer } from './components/ToastContainer'
import { RightPanel } from './components/RightPanel'
import { OutlineIndex } from './components/OutlineIndex'
import { BottomPanel } from './components/BottomPanel'
import { CloseServiceDialog } from './components/CloseServiceDialog'
import { useTheme, useModels, useModelSelection, useChatSession, useGlobalKeybindings } from './hooks'
import type { KeybindingHandlers } from './hooks/useKeybindings'
import { keybindingStore } from './store/keybindingStore'
import { layoutStore } from './store/layoutStore'
import { STORAGE_KEY_WIDE_MODE } from './constants'
import { restoreModelSelection } from './utils/sessionHelpers'
import { findModelByKey } from './utils/modelUtils'
import { isTauri } from './utils/tauri'
import type { Attachment } from './api'
import { createPtySession } from './api/pty'
import type { TerminalTab } from './store/layoutStore'

function App() {
  // ============================================
  // Refs
  // ============================================
  const chatAreaRef = useRef<ChatAreaHandle>(null)
  const modelSelectorRef = useRef<ModelSelectorHandle>(null)
  const lastEscTimeRef = useRef(0)
  const escHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ============================================
  // Cancel Hint (double-Esc to abort)
  // ============================================
  const [showCancelHint, setShowCancelHint] = useState(false)

  // ============================================
  // Theme
  // ============================================
  const { 
    mode: themeMode, setThemeWithAnimation,
    presetId, setPresetWithAnimation, availablePresets,
    customCSS, setCustomCSS,
  } = useTheme()

  // ============================================
  // Models
  // ============================================
  const { models, isLoading: modelsLoading, refetch: refetchModels } = useModels()
  const {
    selectedModelKey,
    selectedVariant,
    currentModel,
    handleModelChange,
    handleVariantChange,
    restoreFromMessage,
  } = useModelSelection({ models })

  // ============================================
  // Visible Message IDs (for outline index)
  // ============================================
  const [visibleMessageIds, setVisibleMessageIds] = useState<string[]>([])
  const [isAtBottom, setIsAtBottom] = useState(true)

  // ============================================
  // Input Box Height (动态测量，用于 ChatArea 底部留白)
  // ============================================
  const [inputBoxHeight, setInputBoxHeight] = useState(0)
  const inputBoxWrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = inputBoxWrapperRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setInputBoxHeight(entry.contentRect.height)
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Viewport height tracking
  // - Tauri Android: 原生 setPadding 让 WebView 自动 resize，直接用 window.innerHeight
  // - Browser/PWA: 通过 visualViewport 计算键盘遮挡区域
  useEffect(() => {
    const root = document.documentElement
    const isTauriApp = root.classList.contains('tauri-app')

    if (isTauriApp) {
      // Tauri: 原生层已处理键盘 resize，只需跟踪 innerHeight
      const updateAppHeight = () => {
        root.style.setProperty('--app-height', `${window.innerHeight}px`)
      }
      updateAppHeight()
      window.addEventListener('resize', updateAppHeight)
      return () => window.removeEventListener('resize', updateAppHeight)
    }

    // Browser/PWA: 用 visualViewport 检测键盘
    const updateViewport = () => {
      const viewport = window.visualViewport
      if (!viewport) return
      const inset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
      root.style.setProperty('--keyboard-inset-bottom', `${Math.round(inset)}px`)
    }
    updateViewport()
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', updateViewport)
      window.visualViewport.addEventListener('scroll', updateViewport)
    }
    return () => {
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', updateViewport)
        window.visualViewport.removeEventListener('scroll', updateViewport)
      }
    }
  }, [])

  // ============================================
  // Wide Mode
  // ============================================
  const [isWideMode, setIsWideMode] = useState(() => {
    return localStorage.getItem(STORAGE_KEY_WIDE_MODE) === 'true'
  })

  const toggleWideMode = useCallback(() => {
    setIsWideMode(prev => {
      const next = !prev
      localStorage.setItem(STORAGE_KEY_WIDE_MODE, String(next))
      return next
    })
  }, [])

  // ============================================
  // Settings Dialog
  // ============================================
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false)
  const [settingsInitialTab, setSettingsInitialTab] = useState<'appearance' | 'chat' | 'notifications' | 'service' | 'servers' | 'keybindings'>('servers')
  const openSettings = useCallback(() => { setSettingsInitialTab('servers'); setSettingsDialogOpen(true) }, [])
  const closeSettings = useCallback(() => setSettingsDialogOpen(false), [])

  // ============================================
  // Project Dialog (triggered externally via keybinding)
  // ============================================
  const [projectDialogOpen, setProjectDialogOpen] = useState(false)
  const openProject = useCallback(() => setProjectDialogOpen(true), [])
  const closeProjectDialog = useCallback(() => setProjectDialogOpen(false), [])

  // ============================================
  // Command Palette
  // ============================================
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)

  // ============================================
  // Chat Session
  // ============================================
  const {
    // State
    messages,
    isStreaming,
    prependedCount,
    canUndo,
    canRedo,
    redoSteps,
    revertedContent,
    agents,
    selectedAgent,
    setSelectedAgent,
    routeSessionId,
    loadState,
    hasMoreHistory,
    sidebarExpanded,
    setSidebarExpanded,
    effectiveDirectory,
    
    // Permissions
    pendingPermissionRequests,
    pendingQuestionRequests,
    handlePermissionReply,
    handleQuestionReply,
    handleQuestionReject,
    isReplying,
    
    // Session management
    loadMoreHistory,
    handleRedoAll,
    clearRevert,
    
    // Animation
    registerMessage,
    registerInputBox,
    
    // Handlers
    handleSend,
    handleAbort,
    handleCommand,
    handleUndoWithAnimation,
    handleRedoWithAnimation,
    handleSelectSession,
    handleNewSession,
    handleVisibleMessageIdsChange,
    handleArchiveSession,
    handlePreviousSession,
    handleNextSession,
    handleCopyLastResponse,
    restoreAgentFromMessage,
  } = useChatSession({ chatAreaRef, currentModel, refetchModels })

  // ============================================
  // Agent Change with Model Sync
  // ============================================
  // 切换 agent 时，如果 agent 绑定了模型，同步切换左上角模型选择
  const syncModelForAgent = useCallback((agentName: string) => {
    const agent = agents.find(a => a.name === agentName)
    if (agent?.model) {
      const modelKey = `${agent.model.providerID}:${agent.model.modelID}`
      const model = findModelByKey(models, modelKey)
      if (model) {
        handleModelChange(modelKey, model)
      }
    }
  }, [agents, models, handleModelChange])

  const handleAgentChange = useCallback((agentName: string) => {
    setSelectedAgent(agentName)
    syncModelForAgent(agentName)
  }, [setSelectedAgent, syncModelForAgent])

  // 包装 handleToggleAgent，切换后同步模型
  const handleToggleAgentWithSync = useCallback(() => {
    const primaryAgents = agents.filter(a => a.mode !== 'subagent' && !a.hidden)
    if (primaryAgents.length <= 1) return
    const currentIndex = primaryAgents.findIndex(a => a.name === selectedAgent)
    const nextIndex = (currentIndex + 1) % primaryAgents.length
    const nextAgentName = primaryAgents[nextIndex].name
    handleAgentChange(nextAgentName)
  }, [agents, selectedAgent, handleAgentChange])

  // ============================================
  // Model Restoration Effect
  // ============================================
  useEffect(() => {
    // 1. 优先从 revertedContent 恢复（Undo/Redo 场景）
    if (revertedContent?.model) {
      const modelSelection = restoreModelSelection(
        revertedContent.model, 
        revertedContent.variant ?? null,
        models
      )
      if (modelSelection) {
        restoreFromMessage(revertedContent.model, revertedContent.variant)
        return
      }
    }

    // 2. 其次从历史消息恢复
    if (messages.length === 0) return
    
    const lastUserMsg = [...messages].reverse().find(m => m.info.role === 'user')
    if (lastUserMsg && 'model' in lastUserMsg.info) {
      const userInfo = lastUserMsg.info as { model?: { providerID: string; modelID: string }; variant?: string }
      restoreFromMessage(userInfo.model, userInfo.variant)
    }
  }, [messages, models, revertedContent, restoreFromMessage])

  // ============================================
  // Agent Restoration Effect
  // ============================================
  useEffect(() => {
    // 1. 优先从 revertedContent 恢复（Undo/Redo 场景）
    if (revertedContent?.agent) {
      restoreAgentFromMessage(revertedContent.agent)
      return
    }

    // 2. 从历史消息恢复（切换 session 时）
    if (messages.length === 0) return

    const lastUserMsg = [...messages].reverse().find(m => m.info.role === 'user')
    if (lastUserMsg && 'agent' in lastUserMsg.info) {
      restoreAgentFromMessage((lastUserMsg.info as { agent?: string }).agent)
    }
  }, [messages, revertedContent, restoreAgentFromMessage])

  // ============================================
  // Global Keybindings
  // ============================================
  
  // Create new terminal handler
  const handleNewTerminal = useCallback(async () => {
    try {
      const pty = await createPtySession({ cwd: effectiveDirectory }, effectiveDirectory)
      const tab: TerminalTab = {
        id: pty.id,
        title: pty.title || 'Terminal',
        status: 'connecting',
      }
      layoutStore.addTerminalTab(tab, true)
    } catch (error) {
      console.error('[App] Failed to create terminal:', error)
    }
  }, [effectiveDirectory])
  
  const keybindingHandlers = useMemo<KeybindingHandlers>(() => ({
    // General
    openSettings,
    openProject,
    commandPalette: () => setCommandPaletteOpen(true),
    toggleSidebar: () => setSidebarExpanded(!sidebarExpanded),
    toggleRightPanel: () => layoutStore.toggleRightPanel(),
    focusInput: () => {
      const input = document.querySelector<HTMLTextAreaElement>('[data-input-box] textarea')
      input?.focus()
    },
    
    // Session
    newSession: handleNewSession,
    archiveSession: handleArchiveSession,
    previousSession: handlePreviousSession,
    nextSession: handleNextSession,
    
    // Terminal
    toggleTerminal: () => layoutStore.toggleBottomPanel(),
    newTerminal: handleNewTerminal,
    
    // Model
    selectModel: () => modelSelectorRef.current?.openMenu(),
    toggleAgent: handleToggleAgentWithSync,
    
    // Message
    cancelMessage: () => {
      if (!isStreaming) return
      
      const now = Date.now()
      const elapsed = now - lastEscTimeRef.current
      
      if (elapsed < 600) {
        // 双击确认 → 真正取消
        lastEscTimeRef.current = 0
        setShowCancelHint(false)
        if (escHintTimerRef.current) clearTimeout(escHintTimerRef.current)
        handleAbort()
      } else {
        // 第一次按 → 显示提示
        lastEscTimeRef.current = now
        setShowCancelHint(true)
        if (escHintTimerRef.current) clearTimeout(escHintTimerRef.current)
        escHintTimerRef.current = setTimeout(() => {
          setShowCancelHint(false)
          lastEscTimeRef.current = 0
        }, 1500)
      }
    },
    copyLastResponse: handleCopyLastResponse,
  }), [
    openSettings,
    openProject,
    sidebarExpanded, 
    setSidebarExpanded, 
    handleNewSession,
    handleArchiveSession,
    handlePreviousSession,
    handleNextSession,
    handleNewTerminal,
    handleToggleAgentWithSync,
    isStreaming, 
    handleAbort,
    handleCopyLastResponse,
  ])

  useGlobalKeybindings(keybindingHandlers)

  // ============================================
  // Command Palette - Commands List
  // ============================================
  const commands = useMemo<CommandItem[]>(() => {
    const getShortcut = (action: string) => keybindingStore.getKey(action as import('./store/keybindingStore').KeybindingAction)

    return [
      // General
      { id: 'openSettings', label: 'Open Settings', description: 'Open settings dialog', category: 'General', shortcut: getShortcut('openSettings'), action: openSettings },
      { id: 'openProject', label: 'Open Project', description: 'Open project selector', category: 'General', shortcut: getShortcut('openProject'), action: openProject },
      { id: 'openSettingsShortcuts', label: 'Open Shortcuts Settings', description: 'Open settings to shortcuts tab', category: 'General', action: () => { setSettingsInitialTab('keybindings'); setSettingsDialogOpen(true) } },
      { id: 'toggleSidebar', label: 'Toggle Sidebar', description: 'Show or hide sidebar', category: 'General', shortcut: getShortcut('toggleSidebar'), action: () => setSidebarExpanded(!sidebarExpanded) },
      { id: 'toggleRightPanel', label: 'Toggle Right Panel', description: 'Show or hide right panel', category: 'General', shortcut: getShortcut('toggleRightPanel'), action: () => layoutStore.toggleRightPanel() },
      { id: 'focusInput', label: 'Focus Input', description: 'Focus message input', category: 'General', shortcut: getShortcut('focusInput'), action: () => { const input = document.querySelector<HTMLTextAreaElement>('[data-input-box] textarea'); input?.focus() } },

      // Session
      { id: 'newSession', label: 'New Session', description: 'Create new chat session', category: 'Session', shortcut: getShortcut('newSession'), action: handleNewSession },
      { id: 'archiveSession', label: 'Archive Session', description: 'Archive current session', category: 'Session', shortcut: getShortcut('archiveSession'), action: handleArchiveSession },
      { id: 'previousSession', label: 'Previous Session', description: 'Switch to previous session', category: 'Session', shortcut: getShortcut('previousSession'), action: handlePreviousSession },
      { id: 'nextSession', label: 'Next Session', description: 'Switch to next session', category: 'Session', shortcut: getShortcut('nextSession'), action: handleNextSession },

      // Terminal
      { id: 'toggleTerminal', label: 'Toggle Terminal', description: 'Show or hide terminal panel', category: 'Terminal', shortcut: getShortcut('toggleTerminal'), action: () => layoutStore.toggleBottomPanel() },
      { id: 'newTerminal', label: 'New Terminal', description: 'Open new terminal tab', category: 'Terminal', shortcut: getShortcut('newTerminal'), action: handleNewTerminal },

      // Model
      { id: 'selectModel', label: 'Select Model', description: 'Open model selector', category: 'Model', shortcut: getShortcut('selectModel'), action: () => modelSelectorRef.current?.openMenu() },
      { id: 'toggleAgent', label: 'Toggle Agent', description: 'Switch agent mode', category: 'Model', shortcut: getShortcut('toggleAgent'), action: handleToggleAgentWithSync },

      // Message
      { id: 'copyLastResponse', label: 'Copy Last Response', description: 'Copy last AI response to clipboard', category: 'Message', shortcut: getShortcut('copyLastResponse'), action: handleCopyLastResponse },
      { id: 'cancelMessage', label: 'Cancel Message', description: 'Cancel current response', category: 'Message', shortcut: getShortcut('cancelMessage'), action: () => { if (isStreaming) handleAbort() }, when: () => isStreaming },
    ]
  }, [
    openSettings, openProject, sidebarExpanded, setSidebarExpanded,
    handleNewSession, handleArchiveSession, handlePreviousSession, handleNextSession,
    handleNewTerminal, handleToggleAgentWithSync, handleCopyLastResponse,
    isStreaming, handleAbort,
  ])

  // ============================================
  // Render
  // ============================================

  // ============================================
  // Close Service Dialog (Tauri desktop only)
  // 监听 Rust 侧的 close-requested 事件
  // ============================================
  const [showCloseDialog, setShowCloseDialog] = useState(false)

  useEffect(() => {
    if (!isTauri()) return

    let unlisten: (() => void) | undefined

    // 动态 import Tauri event API
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen('close-requested', () => {
        setShowCloseDialog(true)
      }).then(fn => { unlisten = fn })
    })

    return () => { unlisten?.() }
  }, [])

  const handleCloseDialogConfirm = useCallback(async (stopService: boolean) => {
    if (!isTauri()) return
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('confirm_close_app', { stopService })
    } catch (e) {
      console.error('[CloseDialog] Failed to close app:', e)
    }
  }, [])

  // ============================================
  // Dialog Collapsed State
  // ============================================
  const [permissionCollapsed, setPermissionCollapsed] = useState(false)
  const [questionCollapsed, setQuestionCollapsed] = useState(false)

  // 新的 request 到来时自动展开
  const permissionRequestId = pendingPermissionRequests[0]?.id
  const questionRequestId = pendingQuestionRequests[0]?.id
  useEffect(() => {
    if (permissionRequestId) setPermissionCollapsed(false)
  }, [permissionRequestId])
  useEffect(() => {
    if (questionRequestId) setQuestionCollapsed(false)
  }, [questionRequestId])

  // streaming 结束时清理 cancel hint
  useEffect(() => {
    if (!isStreaming) {
      setShowCancelHint(false)
      lastEscTimeRef.current = 0
      if (escHintTimerRef.current) {
        clearTimeout(escHintTimerRef.current)
        escHintTimerRef.current = null
      }
    }
  }, [isStreaming])

  const revertedMessage = revertedContent ? {
    text: revertedContent.text,
    attachments: revertedContent.attachments as Attachment[],
  } : undefined

  return (
    <div className="relative h-[var(--app-height)] flex bg-bg-100 overflow-hidden" style={{ paddingTop: 'var(--safe-area-inset-top)' }}>
      {/* Sidebar */}
      <Sidebar
        isOpen={sidebarExpanded}
        selectedSessionId={routeSessionId}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        onOpen={() => setSidebarExpanded(true)}
        onClose={() => setSidebarExpanded(false)}
        contextLimit={currentModel?.contextLimit}
        onOpenSettings={openSettings}
        themeMode={themeMode}
        onThemeChange={setThemeWithAnimation}
        isWideMode={isWideMode}
        onToggleWideMode={toggleWideMode}
        projectDialogOpen={projectDialogOpen}
        onProjectDialogClose={closeProjectDialog}
      />

      {/* Main Content Area: Chat Column + Right Panel */}
      <div className="flex-1 flex min-w-0 h-full overflow-hidden">
        {/* Left Column: Chat + Bottom Panel */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Chat Area */}
          <div className="flex-1 relative overflow-hidden flex flex-col min-h-0">
            {/* Header Overlay */}
            <div className="absolute top-0 left-0 right-0 z-20 pointer-events-none">
              <div className="pointer-events-auto">
                <Header
                  models={models}
                  modelsLoading={modelsLoading}
                  selectedModelKey={selectedModelKey}
                  onModelChange={handleModelChange}
                  onOpenSidebar={() => setSidebarExpanded(true)}
                  modelSelectorRef={modelSelectorRef}
                />
              </div>
            </div>

            {/* Scrollable Area */}
            <div className="absolute inset-0">
              <ChatArea 
                ref={chatAreaRef} 
                messages={messages}
                sessionId={routeSessionId}
                isStreaming={isStreaming}
                prependedCount={prependedCount}
                loadState={loadState}
                hasMoreHistory={hasMoreHistory}
                onLoadMore={loadMoreHistory}
                onUndo={handleUndoWithAnimation}
                canUndo={canUndo}
                registerMessage={registerMessage}
                isWideMode={isWideMode}
                bottomPadding={inputBoxHeight}
                onVisibleMessageIdsChange={(ids) => {
                  handleVisibleMessageIdsChange(ids)
                  setVisibleMessageIds(ids)
                }}
                onAtBottomChange={setIsAtBottom}
              />
            </div>

            {/* Outline Index - 消息目录索引 */}
            <OutlineIndex
              messages={messages}
              onScrollToIndex={(index) => chatAreaRef.current?.scrollToMessageIndex(index)}
              visibleMessageIds={visibleMessageIds}
            />

            {/* Floating Input Box */}
            <div
              ref={inputBoxWrapperRef}
              className="absolute bottom-0 left-0 right-0 z-10 pointer-events-none"
            >
              {/* Double-Esc cancel hint */}
              {showCancelHint && (
                <div className="flex justify-center mb-2 pointer-events-none">
                  <div className="px-3 py-1.5 bg-bg-000/95 border border-border-200 rounded-lg shadow-lg text-xs text-text-300 backdrop-blur-sm animate-in fade-in slide-in-from-bottom-2 duration-150">
                    Press <kbd className="mx-0.5 px-1.5 py-0.5 bg-bg-200 border border-border-200 rounded text-[11px] font-mono font-medium text-text-200">Esc</kbd> again to stop
                  </div>
                </div>
              )}
              <InputBox 
                onSend={handleSend} 
                onAbort={handleAbort}
                onCommand={handleCommand}
                onNewChat={handleNewSession}
                disabled={false}
                isStreaming={isStreaming}
                agents={agents}
                selectedAgent={selectedAgent}
                onAgentChange={handleAgentChange}
                variants={currentModel?.variants ?? []}
                selectedVariant={selectedVariant}
                onVariantChange={handleVariantChange}
                supportsImages={currentModel?.supportsImages ?? false}
                models={models}
                selectedModelKey={selectedModelKey}
                onModelChange={handleModelChange}
                modelsLoading={modelsLoading}
                rootPath={effectiveDirectory}
                sessionId={routeSessionId}
                revertedText={revertedMessage?.text}
                revertedAttachments={revertedMessage?.attachments}
                canRedo={canRedo}
                revertSteps={redoSteps}
                onRedo={handleRedoWithAnimation}
                onRedoAll={handleRedoAll}
                onClearRevert={clearRevert}
                registerInputBox={registerInputBox}
                isAtBottom={isAtBottom}
                showScrollToBottom={!isAtBottom}
                onScrollToBottom={() => chatAreaRef.current?.scrollToBottom()}
                collapsedPermission={
                  pendingPermissionRequests.length > 0 && permissionCollapsed
                    ? { label: `Permission: ${pendingPermissionRequests[0].permission}`, queueLength: pendingPermissionRequests.length, onExpand: () => setPermissionCollapsed(false) }
                    : undefined
                }
                collapsedQuestion={
                  pendingPermissionRequests.length === 0 && pendingQuestionRequests.length > 0 && questionCollapsed
                    ? { label: 'Question', queueLength: pendingQuestionRequests.length, onExpand: () => setQuestionCollapsed(false) }
                    : undefined
                }
              />
            </div>

            {/* Permission Dialog */}
            {pendingPermissionRequests.length > 0 && (
              <PermissionDialog
                request={pendingPermissionRequests[0]}
                onReply={(reply) => handlePermissionReply(pendingPermissionRequests[0].id, reply, effectiveDirectory)}
                queueLength={pendingPermissionRequests.length}
                isReplying={isReplying}
                currentSessionId={routeSessionId}
                collapsed={permissionCollapsed}
                onCollapsedChange={setPermissionCollapsed}
              />
            )}

            {/* Question Dialog */}
            {pendingPermissionRequests.length === 0 && pendingQuestionRequests.length > 0 && (
              <QuestionDialog
                request={pendingQuestionRequests[0]}
                onReply={(answers) => handleQuestionReply(pendingQuestionRequests[0].id, answers, effectiveDirectory)}
                onReject={() => handleQuestionReject(pendingQuestionRequests[0].id, effectiveDirectory)}
                queueLength={pendingQuestionRequests.length}
                isReplying={isReplying}
                collapsed={questionCollapsed}
                onCollapsedChange={setQuestionCollapsed}
              />
            )}
          </div>

          {/* Bottom Panel */}
          <BottomPanel directory={effectiveDirectory} />
        </div>

        {/* Right Panel - 占满整个高度 */}
        <RightPanel />
      </div>

      {/* Settings Dialog */}
      <SettingsDialog
        isOpen={settingsDialogOpen}
        onClose={closeSettings}
        themeMode={themeMode}
        onThemeChange={setThemeWithAnimation}
        isWideMode={isWideMode}
        onToggleWideMode={toggleWideMode}
        initialTab={settingsInitialTab}
        presetId={presetId}
        onPresetChange={setPresetWithAnimation}
        availablePresets={availablePresets}
        customCSS={customCSS}
        onCustomCSSChange={setCustomCSS}
      />

      {/* Command Palette */}
      <CommandPalette
        isOpen={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        commands={commands}
      />

      {/* Toast Notifications */}
      <ToastContainer />

      {/* Close Service Dialog (Tauri desktop) */}
      <CloseServiceDialog
        isOpen={showCloseDialog}
        onConfirm={handleCloseDialogConfirm}
        onCancel={() => setShowCloseDialog(false)}
      />
    </div>
  )
}

export default App
