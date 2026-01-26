import { useState, useCallback, useRef, useEffect } from 'react'
import { Header, InputBox, PermissionDialog, QuestionDialog, Sidebar, ChatArea, type ChatAreaHandle } from './features/chat'
import { useMessageStore, messageStore } from './store'
import { useSessionManager, useGlobalEvents } from './hooks'
import { usePermissions, useTheme, useModels, useRouter, usePermissionHandler, useMessageAnimation, useDirectory, useSessionContext } from './hooks'
import { 
  sendMessage, abortSession, 
  getSelectableAgents, 
  getPendingPermissions, getPendingQuestions, 
  type ApiSession,
  type ApiAgent, type Attachment, 
} from './api'
import { restoreModelSelection, createErrorHandler } from './utils'

const handleError = createErrorHandler('session')

function App() {
  // ============================================
  // Store State (响应式订阅)
  // ============================================
  const {
    messages,
    isStreaming,
    prependedCount,
    sessionDirectory,
    canUndo,
    canRedo,
    redoSteps,
    revertedContent,
  } = useMessageStore()
  
  // ============================================
  // UI State
  // ============================================
  const [selectedModelId, setSelectedModelId] = useState<string | null>(() => {
    return localStorage.getItem('selected-model-id')
  })
  const [agents, setAgents] = useState<ApiAgent[]>([])
  const [selectedAgent, setSelectedAgent] = useState<string>('build')
  const [selectedVariant, setSelectedVariant] = useState<string | undefined>(undefined)

  // ============================================
  // Refs
  // ============================================
  const chatAreaRef = useRef<ChatAreaHandle>(null)

  // ============================================
  // Hooks
  // ============================================
  const { resetPermissions } = usePermissions()
  const { mode: themeMode, setTheme } = useTheme()
  const { models, isLoading: modelsLoading } = useModels()
  const { sessionId: routeSessionId, navigateToSession, navigateHome } = useRouter()
  const { currentDirectory, sidebarExpanded, setSidebarExpanded } = useDirectory()
  const { createSession } = useSessionContext()

  // Session Manager (加载、undo/redo)
  const {
    loadMoreHistory,
    handleUndo,
    handleRedo,
    handleRedoAll,
    clearRevert,
  } = useSessionManager({
    sessionId: routeSessionId,
    directory: currentDirectory,
    onLoadComplete: () => {
      setTimeout(() => {
        chatAreaRef.current?.scrollToBottom(true)
      }, 20)
    },
  })

  // Permission handling
  const {
    pendingPermissionRequests,
    pendingQuestionRequests,
    setPendingPermissionRequests,
    setPendingQuestionRequests,
    handlePermissionReply,
    handleQuestionReply,
    handleQuestionReject,
    refreshPendingRequests,
    resetPendingRequests,
    isReplying,
  } = usePermissionHandler()

  // Message animations
  const { registerMessage, registerInputBox, animateUndo, animateRedo } = useMessageAnimation()

  // ============================================
  // Global Events (SSE)
  // ============================================
  useGlobalEvents({
    onPermissionAsked: (request) => {
      setPendingPermissionRequests(prev => {
        if (prev.some(r => r.id === request.id)) return prev
        return [...prev, request]
      })
    },
    onPermissionReplied: (data) => {
      setPendingPermissionRequests(prev => 
        prev.filter(r => r.id !== data.requestID)
      )
    },
    onQuestionAsked: (request) => {
      setPendingQuestionRequests(prev => {
        if (prev.some(r => r.id === request.id)) return prev
        return [...prev, request]
      })
    },
    onQuestionReplied: (data) => {
      setPendingQuestionRequests(prev => 
        prev.filter(r => r.id !== data.requestID)
      )
    },
    onQuestionRejected: (data) => {
      setPendingQuestionRequests(prev => 
        prev.filter(r => r.id !== data.requestID)
      )
    },
    onScrollRequest: () => {
      chatAreaRef.current?.scrollToBottomIfAtBottom()
    },
  })

  // ============================================
  // Effects
  // ============================================

  // 轮询 pending 权限请求
  useEffect(() => {
    if (!routeSessionId || !isStreaming) return
    
    refreshPendingRequests(routeSessionId, currentDirectory)
    
    const interval = setInterval(() => {
      refreshPendingRequests(routeSessionId, currentDirectory)
    }, 5000)
    
    return () => clearInterval(interval)
  }, [routeSessionId, isStreaming, currentDirectory, refreshPendingRequests])

  // Model 自动选择
  const handleModelChange = useCallback((modelId: string) => {
    setSelectedModelId(modelId)
    localStorage.setItem('selected-model-id', modelId)
    setSelectedVariant(undefined)
  }, [])

  useEffect(() => {
    if (models.length === 0) return
    if (selectedModelId) {
      const exists = models.some(m => m.id === selectedModelId)
      if (!exists) handleModelChange(models[0].id)
    } else {
      handleModelChange(models[0].id)
    }
  }, [models, selectedModelId, handleModelChange])

  // 加载 agents
  useEffect(() => {
    getSelectableAgents(currentDirectory)
      .then(setAgents)
      .catch(err => handleError('fetch agents', err))
  }, [currentDirectory])

  // 加载 pending 权限（session 切换时）
  useEffect(() => {
    if (!routeSessionId) {
      resetPendingRequests()
      return
    }

    Promise.all([
      getPendingPermissions(routeSessionId).catch(() => []),
      getPendingQuestions(routeSessionId).catch(() => []),
    ]).then(([perms, questions]) => {
      setPendingPermissionRequests(perms)
      setPendingQuestionRequests(questions)
    })
  }, [routeSessionId, resetPendingRequests, setPendingPermissionRequests, setPendingQuestionRequests])

  // 恢复模型选择（从最后一条用户消息）
  useEffect(() => {
    if (messages.length === 0) return
    
    const lastUserMsg = [...messages].reverse().find(m => m.info.role === 'user')
    if (lastUserMsg && 'model' in lastUserMsg.info) {
      const userInfo = lastUserMsg.info as { model?: { providerID: string; modelID: string }; variant?: string }
      const modelSelection = restoreModelSelection(
        userInfo.model ?? null,
        userInfo.variant ?? null,
        models
      )
      if (modelSelection) {
        setSelectedModelId(modelSelection.modelId)
        setSelectedVariant(modelSelection.variant)
      }
    }
  }, [messages, models])

  // ============================================
  // Handlers
  // ============================================

  const handleSend = useCallback(async (
    content: string, 
    attachments: Attachment[],
    options?: { agent?: string; variant?: string }
  ) => {
    const currentModel = models.find(m => m.id === selectedModelId)
    if (!currentModel) {
      console.error('No model selected')
      return
    }

    // 清除 revert 状态
    if (routeSessionId) {
      clearRevert()
    }

    // 设置为 streaming
    if (routeSessionId) {
      messageStore.setStreaming(routeSessionId, true)
    }

    try {
      let sessionId = routeSessionId
      if (!sessionId) {
        const newSession = await createSession()
        sessionId = newSession.id
        // 立即设置当前 session，不等待 useEffect
        messageStore.setCurrentSession(sessionId)
        navigateToSession(sessionId)
      }

      await sendMessage({
        sessionId,
        text: content,
        attachments,
        model: {
          providerID: currentModel.providerId,
          modelID: currentModel.id,
        },
        agent: options?.agent,
        variant: options?.variant,
        directory: currentDirectory,
      })
    } catch (error) {
      handleError('send message', error)
      if (routeSessionId) {
        messageStore.setStreaming(routeSessionId, false)
      }
    }
  }, [models, selectedModelId, routeSessionId, currentDirectory, navigateToSession, createSession, clearRevert])

  const handleNewChat = useCallback(() => {
    if (routeSessionId) {
      messageStore.clearSession(routeSessionId)
    }
    resetPermissions()
    resetPendingRequests()
  }, [routeSessionId, resetPermissions, resetPendingRequests])

  const handleAbort = useCallback(async () => {
    if (!routeSessionId) return
    try {
      await abortSession(routeSessionId)
      messageStore.handleSessionIdle(routeSessionId)
    } catch (error) {
      handleError('abort session', error)
    }
  }, [routeSessionId])

  // Undo with animation
  const handleUndoWithAnimation = useCallback(async (userMessageId: string) => {
    chatAreaRef.current?.suppressAutoScroll(1000)
    
    // 找到要删除的消息 IDs
    const messageIndex = messages.findIndex(m => m.info.id === userMessageId)
    if (messageIndex === -1) return
    
    const messageIdsToRemove = messages.slice(messageIndex).map(m => m.info.id)
    
    // 播放动画
    await animateUndo(messageIdsToRemove)
    
    // 执行 undo
    await handleUndo(userMessageId)
    
    // 滚动到末尾
    setTimeout(() => {
      chatAreaRef.current?.scrollToLastMessage()
    }, 50)
  }, [messages, animateUndo, handleUndo])

  const handleRedoWithAnimation = useCallback(async () => {
    chatAreaRef.current?.suppressAutoScroll(1000)
    await animateRedo()
    await handleRedo()
  }, [animateRedo, handleRedo])

  // Session selection
  const handleSelectSession = useCallback((session: ApiSession) => {
    navigateToSession(session.id)
  }, [navigateToSession])

  const handleNewSession = useCallback(() => {
    navigateHome()
    handleNewChat()
  }, [navigateHome, handleNewChat])

  // ============================================
  // Render
  // ============================================

  // isIdle 计算（streaming 的反面）
  const isIdle = !isStreaming

  // Reverted message 格式转换
  const revertedMessage = revertedContent ? {
    text: revertedContent.text,
    attachments: revertedContent.attachments as Attachment[],
  } : undefined

  return (
    <div className="relative h-screen flex">
      {/* Sidebar */}
      <Sidebar
        isOpen={sidebarExpanded}
        selectedSessionId={routeSessionId}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        onClose={() => setSidebarExpanded(false)}
      />

      {/* Main Content */}
      <div className="flex-1 flex flex-col h-screen bg-bg-100 relative overflow-hidden">
        <div className="flex-1 relative overflow-hidden flex flex-col">
          {/* Header Overlay */}
          <div className="absolute top-0 left-0 right-0 z-20 pointer-events-none">
            <div className="pointer-events-auto">
              <Header
                models={models}
                modelsLoading={modelsLoading}
                selectedModelId={selectedModelId}
                onModelChange={handleModelChange}
                onNewChat={handleNewChat}
                onToggleSidebar={() => setSidebarExpanded(!sidebarExpanded)}
                themeMode={themeMode}
                onThemeChange={setTheme}
              />
            </div>
          </div>

          {/* Scrollable Area */}
          <div className="absolute inset-0">
            <ChatArea 
              ref={chatAreaRef} 
              messages={messages} 
              prependedCount={prependedCount}
              onLoadMore={loadMoreHistory}
              onUndo={handleUndoWithAnimation}
              canUndo={canUndo}
              registerMessage={registerMessage}
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
              variants={models.find(m => m.id === selectedModelId)?.variants ?? []}
              selectedVariant={selectedVariant}
              onVariantChange={setSelectedVariant}
              supportsImages={models.find(m => m.id === selectedModelId)?.supportsImages ?? false}
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
            onReply={(reply) => handlePermissionReply(pendingPermissionRequests[0].id, reply, currentDirectory)}
            queueLength={pendingPermissionRequests.length}
            isReplying={isReplying}
          />
        )}

        {/* Question Dialog */}
        {pendingPermissionRequests.length === 0 && pendingQuestionRequests.length > 0 && (
          <QuestionDialog
            request={pendingQuestionRequests[0]}
            onReply={(answers) => handleQuestionReply(pendingQuestionRequests[0].id, answers, currentDirectory)}
            onReject={() => handleQuestionReject(pendingQuestionRequests[0].id, currentDirectory)}
            queueLength={pendingQuestionRequests.length}
            isReplying={isReplying}
          />
        )}
      </div>
    </div>
  )
}

export default App
