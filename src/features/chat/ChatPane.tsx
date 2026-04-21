/**
 * ChatPane — The single chat surface primitive.
 *
 * Single-pane and split-pane both render ChatPane. The only difference is displayMode:
 * single mode uses the full header and app viewport, split mode uses PaneHeader and a
 * compact viewport wrapper.
 */

import { memo, useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { Trans, useTranslation } from 'react-i18next'

import { ChatArea, Header, InputBox, PermissionDialog, QuestionDialog, type ChatAreaHandle } from '.'
import { type ModelSelectorHandle } from './ModelSelector'
import { OutlineIndex } from '../../components/OutlineIndex'
import { PaneHeader } from './PaneHeader'
import { PaneDropOverlay, resolveDropZone, type DropZone, type PaneDropOverlayHandle } from './PaneDropOverlay'
import { useChatSession, useModels, useModelSelection } from '../../hooks'
import { useCancelHint } from '../../hooks/useCancelHint'
import { InlineToolRequestContext, type InlineToolRequestContextValue } from './InlineToolRequestContext'
import { ChatViewportProvider, canUseSplitPane, useChatViewportMaybe, type ChatViewportValue } from './chatViewport'
import { SessionNavigationContext } from '../../contexts/SessionNavigationContext'
import { paneLayoutStore } from '../../store/paneLayoutStore'
import { autoApproveStore } from '../../store/autoApproveStore'
import { messageStore, paneControllerStore, useHiddenModelKeys } from '../../store'
import { restoreModelSelection } from '../../utils/sessionHelpers'
import { findModelByKey, getModelKey } from '../../utils/modelUtils'
import { useTheme } from '../../hooks/useTheme'
import type { Attachment } from '../../api'

interface ChatPaneProps {
  paneId: string
  sessionId: string | null
  isFocused: boolean
  paneCount: number
  displayMode: 'single' | 'split'
  isPaneFullscreen?: boolean
  onOpenSidebar?: () => void
  showSidebarButton?: boolean
  onSplitPane?: () => void
  onTogglePaneFullscreen?: () => void
  navigatePaneToSession: (paneId: string, sessionId: string, directory?: string) => void
  navigatePaneHome: (paneId: string) => void
}

// ============================================
// Compact viewport value (constant, never changes)
// ============================================
const PANE_VIEWPORT: ChatViewportValue = {
  presentation: {
    surfaceVariant: 'compact',
    isCompact: true,
  },
  interaction: {
    mode: 'pointer',
    touchCapable: false,
    sidebarBehavior: 'overlay',
    rightPanelBehavior: 'overlay',
    bottomPanelBehavior: 'overlay',
    outlineInteraction: 'pointer',
    enableCollapsedInputDock: false,
  },
  layout: {
    viewportWidth: 800,
    viewportHeight: 600,
    surfaceWidth: 800,
    surfaceMinWidth: 380,
    sidebar: {
      railWidth: 0,
      requestedWidth: 0,
      openWidth: 0,
      dockedWidth: 0,
      overlayWidth: 0,
      hardMinWidth: 0,
      preferredMinWidth: 0,
      maxWidth: 0,
      resizeMaxWidth: 0,
    },
    rightPanel: {
      requestedWidth: 0,
      dockedWidth: 0,
      hardMinWidth: 0,
      maxWidth: 0,
      resizeMaxWidth: 0,
    },
    bottomPanel: {
      maxHeight: 0,
    },
  },
  actions: {
    setSidebarRequestedWidth: () => {},
  },
}

export const ChatPane = memo(function ChatPane({
  paneId,
  sessionId,
  isFocused,
  paneCount,
  displayMode,
  isPaneFullscreen = false,
  onOpenSidebar,
  showSidebarButton = false,
  onSplitPane,
  onTogglePaneFullscreen,
  navigatePaneToSession,
  navigatePaneHome,
}: ChatPaneProps) {
  const { t } = useTranslation(['chat', 'common'])
  const showCompactShell = displayMode === 'split' && !isPaneFullscreen

  // Read the outer (App-level) viewport BEFORE this component's own Provider shadows it.
  // When fullscreen we pass this through so children keep the real desktop viewport;
  // in normal split mode we use the static PANE_VIEWPORT instead.
  const outerViewport = useChatViewportMaybe()
  const splitPaneEnabled = canUseSplitPane(outerViewport ?? PANE_VIEWPORT)

  // ============================================
  // Refs
  // ============================================
  const chatAreaRef = useRef<ChatAreaHandle>(null)
  const modelSelectorRef = useRef<ModelSelectorHandle>(null)

  // ============================================
  // Models
  // ============================================
  const { models, isLoading: modelsLoading, refetch: refetchModels } = useModels()
  const hiddenModelKeys = useHiddenModelKeys()
  const visibleModels = useMemo(
    () => models.filter(model => !hiddenModelKeys.includes(getModelKey(model))),
    [models, hiddenModelKeys],
  )
  const {
    selectedModelKey,
    selectedVariant,
    currentModel,
    handleModelChange,
    handleVariantChange,
    restoreFromMessage,
  } = useModelSelection({ models: visibleModels, sessionId })

  // ============================================
  // Full Auto Hint
  // ============================================
  const [fullAutoHint, setFullAutoHint] = useState<string | null>(null)
  const fullAutoHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return autoApproveStore.onFullAutoChange((mode, changePaneId) => {
      // 只响应全局变更（changePaneId 为 undefined）或本 pane 的变更
      if (changePaneId && changePaneId !== paneId) return
      if (fullAutoHintTimerRef.current) clearTimeout(fullAutoHintTimerRef.current)
      const label =
        mode === 'global'
          ? t('chat:hints.autoApproveAll')
          : mode === 'session'
            ? t('chat:hints.autoApproveSession')
            : t('chat:hints.autoApproveOffHint')
      setFullAutoHint(label)
      fullAutoHintTimerRef.current = setTimeout(() => setFullAutoHint(null), 2000)
    })
  }, [t, paneId])

  // ============================================
  // Pane-local navigation
  // ============================================
  const navigateToSession = useCallback(
    (sid: string, directory?: string) => {
      navigatePaneToSession(paneId, sid, directory)
    },
    [paneId, navigatePaneToSession],
  )

  const navigateHome = useCallback(() => {
    navigatePaneHome(paneId)
  }, [paneId, navigatePaneHome])

  // ============================================
  // Visible Message IDs (for outline index)
  // ============================================
  const [visibleMessageIds, setVisibleMessageIds] = useState<string[]>([])
  const visibleMessageIdsRef = useRef<string[]>([])
  const setVisibleMessageIdsStable = useCallback((ids: string[]) => {
    const prev = visibleMessageIdsRef.current
    if (prev.length === ids.length && prev.every((id, i) => id === ids[i])) return
    visibleMessageIdsRef.current = ids
    setVisibleMessageIds(ids)
  }, [])
  const [isAtBottom, setIsAtBottom] = useState(true)

  const handleOutlineScrollToMessage = useCallback((messageId: string) => {
    chatAreaRef.current?.scrollToMessageId(messageId)
  }, [])

  // ============================================
  // Input Box Height
  // ============================================
  const [inputBoxHeight, setInputBoxHeight] = useState(0)
  const inputBoxWrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = inputBoxWrapperRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        setInputBoxHeight(entry.contentRect.height)
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ============================================
  // Chat Session
  // ============================================
  const {
    messages,
    isStreaming,
    canUndo,
    canRedo,
    redoSteps,
    revertedContent,
    restoredContent,
    agents,
    selectedAgent,
    setSelectedAgent,
    routeSessionId,
    loadState,
    hasMoreHistory,
    retryStatus,
    effectiveDirectory,

    pendingPermissionRequests,
    pendingQuestionRequests,
    handlePermissionReply,
    handleQuestionReply,
    handleQuestionReject,
    isReplying,

    loadMoreHistory,
    handleRedoAll,
    clearRevert,

    registerMessage,
    registerInputBox,

    handleSend,
    handleAbort,
    handleCommand,
    handleUndoWithAnimation,
    handleRedoWithAnimation,
    handleForkMessage,
    handleNewSession,
    handleVisibleMessageIdsChange,
    handleArchiveSession,
    handlePreviousSession,
    handleNextSession,
    handleCopyLastResponse,
    restoreAgentFromMessage,
  } = useChatSession({
    paneId,
    chatAreaRef,
    currentModel,
    refetchModels,
    sessionId,
    navigateToSession,
    navigateHome,
  })

  const navigationCtx = useMemo(
    () => ({ navigateToSession, currentSessionId: routeSessionId, currentDirectory: effectiveDirectory }),
    [navigateToSession, routeSessionId, effectiveDirectory],
  )

  // ============================================
  // Protect session from eviction while this pane is viewing it
  // ============================================
  useEffect(() => {
    if (routeSessionId) {
      messageStore.protectSession(routeSessionId)
    }
    return () => {
      if (routeSessionId) {
        messageStore.unprotectSession(routeSessionId)
      }
    }
  }, [routeSessionId])

  // ============================================
  // Cancel Hint
  // ============================================
  const { showCancelHint, handleCancelMessage } = useCancelHint(isStreaming, handleAbort)

  // ============================================
  // Visible IDs bridge
  // ============================================
  const handleVisibleMessageIdsChangeRef = useRef<((ids: string[]) => void) | null>(null)
  useEffect(() => {
    handleVisibleMessageIdsChangeRef.current = handleVisibleMessageIdsChange
  }, [handleVisibleMessageIdsChange])

  const handleVisibleIdsChange = useCallback(
    (ids: string[]) => {
      handleVisibleMessageIdsChangeRef.current?.(ids)
      setVisibleMessageIdsStable(ids)
    },
    [setVisibleMessageIdsStable],
  )

  // ============================================
  // Agent Change with Model Sync
  // ============================================
  const syncModelForAgent = useCallback(
    (agentName: string) => {
      const agent = agents.find(a => a.name === agentName)
      if (agent?.model) {
        const modelKey = `${agent.model.providerID}:${agent.model.modelID}`
        const model = findModelByKey(visibleModels, modelKey)
        if (model) {
          handleModelChange(modelKey, model)
        }
      }
    },
    [agents, visibleModels, handleModelChange],
  )

  const handleAgentChange = useCallback(
    (agentName: string) => {
      setSelectedAgent(agentName)
      syncModelForAgent(agentName)
    },
    [setSelectedAgent, syncModelForAgent],
  )

  const handleToggleAgentWithSync = useCallback(() => {
    const primaryAgents = agents.filter(a => a.mode !== 'subagent' && !a.hidden)
    if (primaryAgents.length <= 1) return
    const currentIndex = primaryAgents.findIndex(a => a.name === selectedAgent)
    const nextIndex = (currentIndex + 1) % primaryAgents.length
    handleAgentChange(primaryAgents[nextIndex].name)
  }, [agents, selectedAgent, handleAgentChange])

  // ============================================
  // Model Restoration Effect
  // --
  // 只在 session 切换（routeSessionId 变化）或 revert/undo 恢复时执行一次。
  // 流式输出期间 messages 变化不会触发，避免覆盖用户的模型选择。
  // ============================================
  const inputRestoreContent = revertedContent ?? restoredContent

  // revert/undo 恢复：inputRestoreContent 变化时立即恢复
  useEffect(() => {
    if (!inputRestoreContent?.model) return
    const modelSelection = restoreModelSelection(
      inputRestoreContent.model,
      inputRestoreContent.variant ?? null,
      visibleModels,
    )
    if (modelSelection) {
      restoreFromMessage(inputRestoreContent.model, inputRestoreContent.variant)
    }
  }, [inputRestoreContent, visibleModels, restoreFromMessage])

  // session 切换：只在 routeSessionId 变化时，从最后一条 user 消息恢复模型
  const restoredSessionRef = useRef<string | null>(null)
  useEffect(() => {
    // 没有 session、或者这个 session 已经恢复过了 → 跳过
    if (!routeSessionId || restoredSessionRef.current === routeSessionId) return
    // messages 还没加载完 → 等下次
    if (messages.length === 0) return

    restoredSessionRef.current = routeSessionId

    const lastUserMsg = [...messages].reverse().find(m => m.info.role === 'user')
    if (lastUserMsg && 'model' in lastUserMsg.info) {
      const userInfo = lastUserMsg.info as {
        model?: { providerID: string; modelID: string; variant?: string }
        variant?: string
      }
      restoreFromMessage(userInfo.model, userInfo.variant ?? userInfo.model?.variant)
    }
    // 依赖 routeSessionId 和 messages.length（等加载完），不依赖 messages 引用
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeSessionId, messages.length, visibleModels, restoreFromMessage])

  // ============================================
  // Agent Restoration Effect
  // ============================================
  useEffect(() => {
    if (inputRestoreContent?.agent) {
      restoreAgentFromMessage(inputRestoreContent.agent)
      return
    }
    if (messages.length === 0) return
    const lastUserMsg = [...messages].reverse().find(m => m.info.role === 'user')
    if (lastUserMsg && 'agent' in lastUserMsg.info) {
      restoreAgentFromMessage((lastUserMsg.info as { agent?: string }).agent)
    }
  }, [inputRestoreContent, messages, restoreAgentFromMessage])

  // ============================================
  // Focus handling
  // ============================================
  const handlePaneFocus = useCallback(() => {
    paneLayoutStore.focusPane(paneId)
  }, [paneId])

  // ============================================
  // Drag & Drop — receive a session dragged from the sidebar list
  // Center drop → replace current session; edge drops → split in that direction
  //
  // IMPORTANT: zone state lives in PaneDropOverlay (imperative handle). We do
  // NOT put it in ChatPane state — dragover fires every mouse move, and
  // re-rendering ChatPane on each move is very expensive once several panes
  // exist (ChatArea / messages / hooks). rAF also throttles DOM writes to one
  // per frame for smoothness.
  //
  // Zone resolution has two refs on purpose:
  //   - pendingZoneRef: written synchronously by every dragover (most recent)
  //   - currentZoneRef: what the overlay is actually showing (written by rAF)
  // drop() prefers the pending value so it never loses a last-frame move.
  // ============================================
  const overlayRef = useRef<PaneDropOverlayHandle>(null)
  const currentZoneRef = useRef<DropZone | null>(null)
  const pendingZoneRef = useRef<DropZone | null>(null)
  const dropRafRef = useRef<number | null>(null)

  const writeZone = useCallback((zone: DropZone | null) => {
    if (currentZoneRef.current === zone) return
    currentZoneRef.current = zone
    overlayRef.current?.setZone(zone)
  }, [])

  const cancelPendingZone = useCallback(() => {
    if (dropRafRef.current !== null) {
      cancelAnimationFrame(dropRafRef.current)
      dropRafRef.current = null
    }
    pendingZoneRef.current = null
  }, [])

  const resetDropState = useCallback(() => {
    cancelPendingZone()
    writeZone(null)
  }, [cancelPendingZone, writeZone])

  // Drag end can fire on the source (SessionListItem) — we listen globally so
  // the overlay always clears even if the user aborts with ESC inside the pane.
  useEffect(() => {
    const handleGlobalDragEnd = () => resetDropState()
    window.addEventListener('dragend', handleGlobalDragEnd)
    return () => {
      window.removeEventListener('dragend', handleGlobalDragEnd)
      if (dropRafRef.current !== null) cancelAnimationFrame(dropRafRef.current)
    }
  }, [resetDropState])

  const readSessionDragPayload = useCallback((e: React.DragEvent): { sessionId: string; directory: string } | null => {
    if (!e.dataTransfer.types.includes('text/x-session-id')) return null
    const sessionId = e.dataTransfer.getData('text/x-session-id')
    if (!sessionId) return null
    const directory = e.dataTransfer.getData('text/x-session-directory') || ''
    return { sessionId, directory }
  }, [])

  const handlePaneDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (!splitPaneEnabled) return
      if (!e.dataTransfer.types.includes('text/x-session-id')) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'

      const rect = e.currentTarget.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      const xRel = (e.clientX - rect.left) / rect.width
      const yRel = (e.clientY - rect.top) / rect.height
      pendingZoneRef.current = resolveDropZone({ xRel, yRel })

      if (dropRafRef.current === null) {
        dropRafRef.current = requestAnimationFrame(() => {
          dropRafRef.current = null
          writeZone(pendingZoneRef.current)
        })
      }
    },
    [splitPaneEnabled, writeZone],
  )

  const handlePaneDragLeave = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      // Ignore bubbles that stay within the pane
      const related = e.relatedTarget as Node | null
      if (related && e.currentTarget.contains(related)) return
      resetDropState()
    },
    [resetDropState],
  )

  const handlePaneDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      // Prefer pending (freshly-written by the last dragover) over current
      // (what rAF had a chance to commit) so we never miss a last-frame move.
      const zone = pendingZoneRef.current ?? currentZoneRef.current
      resetDropState()

      const payload = readSessionDragPayload(e)
      if (!payload || !zone) return
      e.preventDefault()

      // Same session dropped onto its own pane → nothing to do
      if (payload.sessionId === routeSessionId && zone === 'center') return

      if (zone === 'center') {
        navigatePaneToSession(paneId, payload.sessionId, payload.directory || undefined)
        return
      }

      // Split: create new pane on the chosen side, then route the new pane to the session
      const newPaneId = paneLayoutStore.splitPaneToSide(paneId, zone, null)
      if (newPaneId) {
        navigatePaneToSession(newPaneId, payload.sessionId, payload.directory || undefined)
      }
    },
    [paneId, routeSessionId, navigatePaneToSession, readSessionDragPayload, resetDropState],
  )

  const handleToggleFullAuto = useCallback(() => {
    autoApproveStore.cyclePaneFullAutoMode(paneId)
  }, [paneId])

  const openModelSelector = useCallback(() => {
    modelSelectorRef.current?.openMenu()
  }, [])

  const contextLimit = currentModel?.contextLimit

  const controllerActionsRef = useRef({
    newSession: handleNewSession,
    archiveSession: handleArchiveSession,
    previousSession: handlePreviousSession,
    nextSession: handleNextSession,
    toggleAgent: handleToggleAgentWithSync,
    copyLastResponse: handleCopyLastResponse,
    cancelMessage: handleCancelMessage,
    openModelSelector,
    toggleFullAuto: handleToggleFullAuto,
  })

  useEffect(() => {
    controllerActionsRef.current = {
      newSession: handleNewSession,
      archiveSession: handleArchiveSession,
      previousSession: handlePreviousSession,
      nextSession: handleNextSession,
      toggleAgent: handleToggleAgentWithSync,
      copyLastResponse: handleCopyLastResponse,
      cancelMessage: handleCancelMessage,
      openModelSelector,
      toggleFullAuto: handleToggleFullAuto,
    }
  }, [
    handleNewSession,
    handleArchiveSession,
    handlePreviousSession,
    handleNextSession,
    handleToggleAgentWithSync,
    handleCopyLastResponse,
    handleCancelMessage,
    openModelSelector,
    handleToggleFullAuto,
  ])

  const stableControllerActions = useMemo(
    () => ({
      newSession: () => controllerActionsRef.current.newSession(),
      archiveSession: () => controllerActionsRef.current.archiveSession(),
      previousSession: () => controllerActionsRef.current.previousSession(),
      nextSession: () => controllerActionsRef.current.nextSession(),
      toggleAgent: () => controllerActionsRef.current.toggleAgent(),
      copyLastResponse: () => controllerActionsRef.current.copyLastResponse(),
      cancelMessage: () => controllerActionsRef.current.cancelMessage(),
      openModelSelector: () => controllerActionsRef.current.openModelSelector(),
      toggleFullAuto: () => controllerActionsRef.current.toggleFullAuto(),
    }),
    [],
  )

  useEffect(() => {
    return () => {
      paneControllerStore.removeController(paneId)
    }
  }, [paneId])

  useEffect(() => {
    paneControllerStore.setController(paneId, {
      paneId,
      sessionId: routeSessionId,
      effectiveDirectory: effectiveDirectory || '',
      contextLimit,
      newSession: stableControllerActions.newSession,
      archiveSession: stableControllerActions.archiveSession,
      previousSession: stableControllerActions.previousSession,
      nextSession: stableControllerActions.nextSession,
      toggleAgent: stableControllerActions.toggleAgent,
      copyLastResponse: stableControllerActions.copyLastResponse,
      cancelMessage: stableControllerActions.cancelMessage,
      openModelSelector: stableControllerActions.openModelSelector,
      toggleFullAuto: stableControllerActions.toggleFullAuto,
      isStreaming,
    })
  }, [paneId, routeSessionId, effectiveDirectory, contextLimit, stableControllerActions, isStreaming])

  // ============================================
  // Dialog Collapsed State
  // ============================================
  const [permissionCollapsed, setPermissionCollapsed] = useState(false)
  const [questionCollapsed, setQuestionCollapsed] = useState(false)

  const permissionRequestId = pendingPermissionRequests[0]?.id
  const questionRequestId = pendingQuestionRequests[0]?.id
  useEffect(() => {
    if (permissionRequestId) setPermissionCollapsed(false)
  }, [permissionRequestId])
  useEffect(() => {
    if (questionRequestId) setQuestionCollapsed(false)
  }, [questionRequestId])

  const { inlineToolRequests } = useTheme()

  const inlineToolRequestCtx = useMemo<InlineToolRequestContextValue>(
    () => ({
      pendingPermissions: pendingPermissionRequests,
      pendingQuestions: pendingQuestionRequests,
      onPermissionReply: (requestId, reply) => handlePermissionReply(requestId, reply, effectiveDirectory),
      onQuestionReply: (requestId, answers) => handleQuestionReply(requestId, answers, effectiveDirectory),
      onQuestionReject: requestId => handleQuestionReject(requestId, effectiveDirectory),
      isReplying,
    }),
    [
      pendingPermissionRequests,
      pendingQuestionRequests,
      handlePermissionReply,
      handleQuestionReply,
      handleQuestionReject,
      isReplying,
      effectiveDirectory,
    ],
  )

  const revertedMessage = inputRestoreContent
    ? {
        text: inputRestoreContent.text,
        attachments: inputRestoreContent.attachments as Attachment[],
      }
    : undefined

  // ============================================
  // Render
  // ============================================
  const chatContent = (
    <div className="flex-1 relative overflow-hidden flex flex-col min-h-0">
      {displayMode === 'single' && (
        <div className="absolute top-0 left-0 right-0 z-20 pointer-events-none">
          <div className="pointer-events-auto">
            <Header
              models={visibleModels}
              modelsLoading={modelsLoading}
              selectedModelKey={selectedModelKey}
              onModelChange={handleModelChange}
              onOpenSidebar={onOpenSidebar}
              onSplitPane={onSplitPane}
              isPaneFullscreen={isPaneFullscreen}
              onTogglePaneFullscreen={onTogglePaneFullscreen}
              modelSelectorRef={modelSelectorRef}
            />
          </div>
        </div>
      )}

      <div className="absolute inset-0">
        <InlineToolRequestContext.Provider value={inlineToolRequestCtx}>
          <ChatArea
            ref={chatAreaRef}
            messages={messages}
            sessionId={routeSessionId}
            isStreaming={isStreaming}
            allowStreamingLayoutAnimation={isAtBottom}
            loadState={loadState}
            hasMoreHistory={hasMoreHistory}
            onLoadMore={loadMoreHistory}
            onUndo={handleUndoWithAnimation}
            onFork={handleForkMessage}
            canUndo={canUndo}
            registerMessage={registerMessage}
            retryStatus={retryStatus}
            bottomPadding={inputBoxHeight}
            onVisibleMessageIdsChange={handleVisibleIdsChange}
            onAtBottomChange={setIsAtBottom}
          />
        </InlineToolRequestContext.Provider>
      </div>

      <OutlineIndex
        messages={messages}
        visibleMessageIds={visibleMessageIds}
        onScrollToMessageId={handleOutlineScrollToMessage}
      />

      <div ref={inputBoxWrapperRef} className="absolute bottom-0 left-0 right-0 z-10 pointer-events-none">
        {(showCancelHint || (fullAutoHint && !showCancelHint)) && (
          <div className="absolute bottom-full inset-x-0 flex justify-center pb-2 pointer-events-none z-20">
            <div className="px-3 py-1.5 glass border border-border-200/60 rounded-lg shadow-lg text-[length:var(--fs-sm)] text-text-300 animate-in fade-in slide-in-from-bottom-2 duration-150">
              {showCancelHint ? (
                <Trans
                  i18nKey="chat:hints.pressEscAgain"
                  components={{
                    1: (
                      <kbd className="mx-0.5 px-1.5 py-0.5 bg-bg-200 border border-border-200 rounded text-[length:var(--fs-xs)] font-mono font-medium text-text-200" />
                    ),
                  }}
                />
              ) : (
                fullAutoHint
              )}
            </div>
          </div>
        )}
        <InputBox
          paneId={paneId}
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
          fileCapabilities={
            currentModel
              ? {
                  image: currentModel.supportsImages,
                  pdf: currentModel.supportsPdf,
                  audio: currentModel.supportsAudio,
                  video: currentModel.supportsVideo,
                }
              : undefined
          }
          models={visibleModels}
          selectedModelKey={selectedModelKey}
          onModelChange={handleModelChange}
          modelsLoading={modelsLoading}
          modelSelectorRef={modelSelectorRef}
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
            !inlineToolRequests && pendingPermissionRequests.length > 0 && permissionCollapsed
              ? {
                  label: t('chat:permissionDialog.permission', {
                    permission: pendingPermissionRequests[0].permission,
                  }),
                  queueLength: pendingPermissionRequests.length,
                  onExpand: () => setPermissionCollapsed(false),
                }
              : undefined
          }
          collapsedQuestion={
            !inlineToolRequests &&
            pendingPermissionRequests.length === 0 &&
            pendingQuestionRequests.length > 0 &&
            questionCollapsed
              ? {
                  label: t('chat:questionDialog.title'),
                  queueLength: pendingQuestionRequests.length,
                  onExpand: () => setQuestionCollapsed(false),
                }
              : undefined
          }
        />
      </div>

      {!inlineToolRequests && pendingPermissionRequests.length > 0 && (
        <PermissionDialog
          request={pendingPermissionRequests[0]}
          onReply={reply => handlePermissionReply(pendingPermissionRequests[0].id, reply, effectiveDirectory)}
          queueLength={pendingPermissionRequests.length}
          isReplying={isReplying}
          currentSessionId={routeSessionId}
          collapsed={permissionCollapsed}
          onCollapsedChange={setPermissionCollapsed}
        />
      )}

      {!inlineToolRequests && pendingPermissionRequests.length === 0 && pendingQuestionRequests.length > 0 && (
        <QuestionDialog
          request={pendingQuestionRequests[0]}
          onReply={answers => handleQuestionReply(pendingQuestionRequests[0].id, answers, effectiveDirectory)}
          onReject={() => handleQuestionReject(pendingQuestionRequests[0].id, effectiveDirectory)}
          queueLength={pendingQuestionRequests.length}
          isReplying={isReplying}
          collapsed={questionCollapsed}
          onCollapsedChange={setQuestionCollapsed}
        />
      )}
    </div>
  )

  const content = (
    <SessionNavigationContext.Provider value={navigationCtx}>
      <div
        className={
          showCompactShell
            ? `relative h-full flex flex-col overflow-hidden rounded-lg transition-all duration-200 ${
                isFocused
                  ? 'ring-1 ring-accent-main-100/60 bg-bg-100'
                  : 'ring-1 ring-border-200/30 bg-bg-100 hover:ring-border-200/50'
              }`
            : 'relative h-full flex flex-col overflow-hidden bg-bg-100'
        }
        onClick={handlePaneFocus}
        onDragOver={handlePaneDragOver}
        onDragLeave={handlePaneDragLeave}
        onDrop={handlePaneDrop}
      >
        {showCompactShell && (
          <PaneHeader
            paneId={paneId}
            sessionId={routeSessionId}
            isFocused={isFocused}
            paneCount={paneCount}
            showSidebarButton={showSidebarButton}
            onOpenSidebar={onOpenSidebar}
            canSplitPane={splitPaneEnabled}
            isPaneFullscreen={isPaneFullscreen}
            onTogglePaneFullscreen={onTogglePaneFullscreen}
            onFocus={handlePaneFocus}
          />
        )}
        {chatContent}
        <PaneDropOverlay ref={overlayRef} />
      </div>
    </SessionNavigationContext.Provider>
  )

  // Always wrap with ChatViewportProvider to keep the React tree structure stable
  // across fullscreen toggles. Only the value changes — compact pane vs full viewport.
  const viewportValue = showCompactShell ? PANE_VIEWPORT : (outerViewport ?? PANE_VIEWPORT)

  return <ChatViewportProvider value={viewportValue}>{content}</ChatViewportProvider>
})
