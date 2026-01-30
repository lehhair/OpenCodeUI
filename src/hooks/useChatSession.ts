// ============================================
// useChatSession - 聊天会话管理
// ============================================

import { useState, useCallback, useEffect } from 'react'
import { useMessageStore, messageStore, useSessionFamily } from '../store'
import { useSessionManager, useGlobalEvents } from '../hooks'
import { usePermissions, useRouter, usePermissionHandler, useMessageAnimation, useDirectory, useSessionContext } from '../hooks'
import { 
  sendMessage, abortSession, 
  getSelectableAgents, 
  getPendingPermissions, getPendingQuestions, 
  type ApiSession,
  type ApiAgent, type Attachment, type ModelInfo,
} from '../api'
import { createErrorHandler } from '../utils'
import { 
  PERMISSION_POLL_INTERVAL_MS,
  INITIAL_SCROLL_DELAY_MS,
  UNDO_SCROLL_DELAY_MS,
  AUTO_SCROLL_SUPPRESS_DURATION_MS,
} from '../constants'
import type { ChatAreaHandle } from '../features/chat'

const handleError = createErrorHandler('session')

interface UseChatSessionOptions {
  chatAreaRef: React.RefObject<ChatAreaHandle | null>
  currentModel: ModelInfo | undefined
}

export function useChatSession({ chatAreaRef, currentModel }: UseChatSessionOptions) {
  // Store State
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
  
  // Agents
  const [agents, setAgents] = useState<ApiAgent[]>([])
  const [selectedAgent, setSelectedAgent] = useState<string>('build')

  // Hooks
  const { resetPermissions } = usePermissions()
  const { sessionId: routeSessionId, navigateToSession, navigateHome } = useRouter()
  const { currentDirectory, sidebarExpanded, setSidebarExpanded } = useDirectory()
  const { createSession } = useSessionContext()
  
  // Session family for permission polling
  const sessionFamily = useSessionFamily(routeSessionId)

  // Session Manager
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
      }, INITIAL_SCROLL_DELAY_MS)
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

  // Global Events (SSE)
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

  // Effective directory
  const effectiveDirectory = sessionDirectory || currentDirectory
  
  // Poll pending permissions
  useEffect(() => {
    if (!routeSessionId || !isStreaming) return
    
    refreshPendingRequests(sessionFamily, effectiveDirectory)
    
    const interval = setInterval(() => {
      refreshPendingRequests(sessionFamily, effectiveDirectory)
    }, PERMISSION_POLL_INTERVAL_MS)
    
    return () => clearInterval(interval)
  }, [routeSessionId, isStreaming, effectiveDirectory, sessionFamily, refreshPendingRequests])

  // Load agents
  useEffect(() => {
    getSelectableAgents(currentDirectory)
      .then(setAgents)
      .catch(err => handleError('fetch agents', err))
  }, [currentDirectory])

  // Load pending permissions on session change
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

  // Send message handler
  const handleSend = useCallback(async (
    content: string, 
    attachments: Attachment[],
    options?: { agent?: string; variant?: string }
  ) => {
    if (!currentModel) {
      handleError('send message', new Error('No model selected'))
      return
    }

    // Clear revert state and truncate old messages
    if (routeSessionId) {
      messageStore.truncateAfterRevert(routeSessionId)
    }

    // Set streaming
    if (routeSessionId) {
      messageStore.setStreaming(routeSessionId, true)
    }

    let sessionId = routeSessionId

    try {
      if (!sessionId) {
        const newSession = await createSession()
        sessionId = newSession.id
        messageStore.setCurrentSession(sessionId)
        messageStore.setStreaming(sessionId, true)
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
      if (sessionId) {
        messageStore.setStreaming(sessionId, false)
      }
    }
  }, [currentModel, routeSessionId, currentDirectory, navigateToSession, createSession])

  // New chat handler
  const handleNewChat = useCallback(() => {
    if (routeSessionId) {
      messageStore.clearSession(routeSessionId)
    }
    resetPermissions()
    resetPendingRequests()
  }, [routeSessionId, resetPermissions, resetPendingRequests])

  // Abort handler
  const handleAbort = useCallback(async () => {
    if (!routeSessionId) return
    try {
      const directory = sessionDirectory || currentDirectory
      await abortSession(routeSessionId, directory)
      messageStore.handleSessionIdle(routeSessionId)
    } catch (error) {
      handleError('abort session', error)
    }
  }, [routeSessionId, sessionDirectory, currentDirectory])

  // Undo with animation
  const handleUndoWithAnimation = useCallback(async (userMessageId: string) => {
    chatAreaRef.current?.suppressAutoScroll(AUTO_SCROLL_SUPPRESS_DURATION_MS)
    
    const messageIndex = messages.findIndex(m => m.info.id === userMessageId)
    if (messageIndex === -1) return
    
    const messageIdsToRemove = messages.slice(messageIndex).map(m => m.info.id)
    
    await animateUndo(messageIdsToRemove)
    await handleUndo(userMessageId)
    
    setTimeout(() => {
      chatAreaRef.current?.scrollToLastMessage()
    }, UNDO_SCROLL_DELAY_MS)
  }, [messages, animateUndo, handleUndo])

  // Redo with animation
  const handleRedoWithAnimation = useCallback(async () => {
    chatAreaRef.current?.suppressAutoScroll(AUTO_SCROLL_SUPPRESS_DURATION_MS)
    await animateRedo()
    await handleRedo()
  }, [animateRedo, handleRedo])

  // Session selection
  const handleSelectSession = useCallback((session: ApiSession) => {
    navigateToSession(session.id)
  }, [navigateToSession])

  // New session
  const handleNewSession = useCallback(() => {
    navigateHome()
    handleNewChat()
  }, [navigateHome, handleNewChat])

  return {
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
    currentDirectory,
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
  }
}
