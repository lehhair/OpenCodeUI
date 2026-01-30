import { useRef, useEffect } from 'react'
import { Header, InputBox, PermissionDialog, QuestionDialog, Sidebar, ChatArea, type ChatAreaHandle } from './features/chat'
import { useTheme, useModels, useModelSelection, useChatSession } from './hooks'
import { restoreModelSelection } from './utils'
import { STORAGE_KEY_WIDE_MODE } from './constants'
import { useState, useCallback } from 'react'
import type { Attachment } from './api'

function App() {
  // ============================================
  // Refs
  // ============================================
  const chatAreaRef = useRef<ChatAreaHandle>(null)

  // ============================================
  // Theme
  // ============================================
  const { mode: themeMode, setThemeWithAnimation } = useTheme()

  // ============================================
  // Models
  // ============================================
  const { models, isLoading: modelsLoading } = useModels()
  const {
    selectedModelKey,
    selectedVariant,
    currentModel,
    handleModelChange,
    handleVariantChange,
    restoreFromMessage,
  } = useModelSelection({ models })

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
  // Chat Session
  // ============================================
  const {
    // State
    messages,
    isStreaming,
    prependedCount,
    sessionDirectory,
    canUndo,
    canRedo,
    redoSteps,
    revertedContent,
    agents,
    selectedAgent,
    setSelectedAgent,
    routeSessionId,
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
    handleUndoWithAnimation,
    handleRedoWithAnimation,
    handleSelectSession,
    handleNewSession,
  } = useChatSession({ chatAreaRef, currentModel })

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
  // Render
  // ============================================
  const isIdle = !isStreaming

  const revertedMessage = revertedContent ? {
    text: revertedContent.text,
    attachments: revertedContent.attachments as Attachment[],
  } : undefined

  return (
    <div className="relative h-screen flex bg-bg-100 overflow-hidden">
      {/* Sidebar */}
      <Sidebar
        isOpen={sidebarExpanded}
        selectedSessionId={routeSessionId}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        onClose={() => setSidebarExpanded(false)}
      />

      {/* Main Content Area Wrapper */}
      <div className="flex-1 flex min-w-0 h-screen overflow-hidden">
        {/* Main Chat Column */}
        <div className="flex-1 flex flex-col relative min-w-0 transition-all duration-300">
          <div className="flex-1 relative overflow-hidden flex flex-col">
            {/* Header Overlay */}
            <div className="absolute top-0 left-0 right-0 z-20 pointer-events-none">
              <div className="pointer-events-auto">
                <Header
                  models={models}
                  modelsLoading={modelsLoading}
                  selectedModelKey={selectedModelKey}
                  onModelChange={handleModelChange}
                  onNewChat={handleNewSession}
                  onToggleSidebar={() => setSidebarExpanded(!sidebarExpanded)}
                  themeMode={themeMode}
                  onThemeChange={setThemeWithAnimation}
                  isWideMode={isWideMode}
                  onToggleWideMode={toggleWideMode}
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
                onLoadMore={loadMoreHistory}
                onUndo={handleUndoWithAnimation}
                canUndo={canUndo}
                registerMessage={registerMessage}
                isWideMode={isWideMode}
              />
            </div>

            {/* Floating Input Box */}
            <div className="absolute bottom-0 left-0 right-0 z-10 pointer-events-none">
              <InputBox 
                onSend={handleSend} 
                onAbort={handleAbort}
                disabled={!isIdle}
                isStreaming={isStreaming}
                agents={agents}
                selectedAgent={selectedAgent}
                onAgentChange={setSelectedAgent}
                variants={currentModel?.variants ?? []}
                selectedVariant={selectedVariant}
                onVariantChange={handleVariantChange}
                supportsImages={currentModel?.supportsImages ?? false}
                rootPath={sessionDirectory}
                revertedText={revertedMessage?.text}
                revertedAttachments={revertedMessage?.attachments}
                canRedo={canRedo}
                revertSteps={redoSteps}
                onRedo={handleRedoWithAnimation}
                onRedoAll={handleRedoAll}
                onClearRevert={clearRevert}
                registerInputBox={registerInputBox}
              />
            </div>
          </div>

          {/* Permission Dialog */}
          {pendingPermissionRequests.length > 0 && (
            <PermissionDialog
              request={pendingPermissionRequests[0]}
              onReply={(reply) => handlePermissionReply(pendingPermissionRequests[0].id, reply, effectiveDirectory)}
              queueLength={pendingPermissionRequests.length}
              isReplying={isReplying}
              currentSessionId={routeSessionId}
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
            />
          )}
        </div>
      </div>
    </div>
  )
}

export default App
