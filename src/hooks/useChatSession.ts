// ============================================
// useChatSession - 聊天会话管理
// ============================================

import { useState, useCallback, useEffect } from 'react'
import { useMessageStore, messageStore, useSessionFamily, autoApproveStore, childSessionStore } from '../store'
import { useSessionManager, useGlobalEvents } from '../hooks'
import { usePermissions, useRouter, usePermissionHandler, useMessageAnimation, useDirectory, useSessionContext } from '../hooks'
import { useNotification } from './useNotification'
import { 
  sendMessageAsync, abortSession, 
  getSelectableAgents, 
  getPendingPermissions, getPendingQuestions,
  getSessionChildren,
  executeCommand,
  updateSession,
  type ApiSession,
  type ApiAgent, type Attachment, type ModelInfo,
} from '../api'
import { getMessageText } from '../types/message'
import { createErrorHandler } from '../utils'
import { serverStorage } from '../utils/perServerStorage'
import { 
  PERMISSION_POLL_INTERVAL_MS,
  INITIAL_SCROLL_DELAY_MS,
  UNDO_SCROLL_DELAY_MS,
  AUTO_SCROLL_SUPPRESS_DURATION_MS,
  STORAGE_KEY_SELECTED_AGENT,
} from '../constants'
import type { ChatAreaHandle } from '../features/chat'

const handleError = createErrorHandler('session')

interface UseChatSessionOptions {
  chatAreaRef: React.RefObject<ChatAreaHandle | null>
  currentModel: ModelInfo | undefined
  refetchModels: () => Promise<void>
}

export function useChatSession({ chatAreaRef, currentModel, refetchModels }: UseChatSessionOptions) {
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
    loadState,
    hasMoreHistory,
  } = useMessageStore()
  
  // Agents
  const [agents, setAgents] = useState<ApiAgent[]>([])
  const [selectedAgent, setSelectedAgentRaw] = useState<string>(() => {
    return serverStorage.get(STORAGE_KEY_SELECTED_AGENT) || ''
  })

  // 封装 setSelectedAgent：同步写入 serverStorage（按服务器隔离）
  const setSelectedAgent = useCallback((agentName: string) => {
    setSelectedAgentRaw(agentName)
    serverStorage.set(STORAGE_KEY_SELECTED_AGENT, agentName)
  }, [])

  // Hooks
  const { resetPermissions } = usePermissions()
  const { sessionId: routeSessionId, navigateToSession, navigateHome } = useRouter()
  const { currentDirectory, sidebarExpanded, setSidebarExpanded } = useDirectory()
  const { createSession, sessions } = useSessionContext()
  const { sendNotification } = useNotification()

  const getSessionTitle = useCallback((sessionId?: string) => {
    const session = sessions.find(s => s.id === sessionId)
    if (session?.title) return session.title
    if (sessionId) return `Session ${sessionId.slice(0, 6)}`
    return 'OpenCode'
  }, [sessions])

  const buildNotificationTitle = useCallback((sessionId: string | undefined, label: string) => {
    const base = getSessionTitle(sessionId)
    return `${base} - ${label}`
  }, [getSessionTitle])
  
  // Session family for permission polling
  const sessionFamily = useSessionFamily(routeSessionId)

  // Session Manager
  const {
    loadSession,
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

  // Effective directory (used in multiple places)
  const effectiveDirectory = sessionDirectory || currentDirectory

  // Global Events (SSE)
  useGlobalEvents({
    onPermissionAsked: (request) => {
      // 自动批准检查（实验性功能）
      if (autoApproveStore.enabled && autoApproveStore.shouldAutoApprove(
        request.sessionID,
        request.permission,
        request.patterns
      )) {
        // 匹配规则，自动用 once 批准，不弹框
        handlePermissionReply(request.id, 'once', effectiveDirectory)
        return
      }
      
      setPendingPermissionRequests(prev => {
        if (prev.some(r => r.id === request.id)) return prev
        return [...prev, request]
      })

      // 页面不在前台时通知用户有权限请求等待批准
      const permDesc = request.patterns?.length
        ? `${request.permission}: ${request.patterns[0]}`
        : request.permission
      const title = buildNotificationTitle(request.sessionID, 'Permission Required')
      sendNotification(title, permDesc, {
        sessionId: request.sessionID,
        directory: effectiveDirectory,
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

      // 页面不在前台时通知用户有问题等待回答
      const questionDesc = request.questions?.[0]?.header || 'AI is waiting for your input'
      const title = buildNotificationTitle(request.sessionID, 'Question')
      sendNotification(title, questionDesc, {
        sessionId: request.sessionID,
        directory: effectiveDirectory,
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
    onSessionIdle: (sessionID) => {
      // 页面不在前台时发送浏览器通知
      const title = buildNotificationTitle(sessionID, 'Session completed')
      sendNotification(title, 'Session completed', {
        sessionId: sessionID,
        directory: effectiveDirectory,
      })
    },
    onSessionError: (sessionID) => {
      // 页面不在前台时通知用户 session 出错
      const title = buildNotificationTitle(sessionID, 'Session error')
      sendNotification(title, 'Session error', {
        sessionId: sessionID,
        directory: effectiveDirectory,
      })
    },
    onReconnected: (_reason) => {
      // SSE 重连后重新加载当前会话，补齐断连期间可能丢失的消息
      if (routeSessionId) {
        // 使用 force 模式，确保覆盖本地可能不完整的数据
        loadSession(routeSessionId, { force: true })
        // 重连后刷新待处理的权限请求和问题，避免用户错过后台产生的请求
        refreshPendingRequests(sessionFamily, effectiveDirectory)
      }
      refetchModels().catch(() => {})
    },
  })

  const handleVisibleMessageIdsChange = useCallback((ids: string[]) => {
    if (!routeSessionId || ids.length === 0) return
    messageStore.prefetchMessageParts(routeSessionId, ids)
    messageStore.evictMessageParts(routeSessionId, ids)
  }, [routeSessionId])
  
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

  // agents 列表加载后，校验当前选中的 agent 是否存在于列表中
  useEffect(() => {
    if (agents.length === 0) return
    const primaryAgents = agents.filter(a => a.mode === 'primary' && !a.hidden)
    if (primaryAgents.length === 0) return

    // 当前选中的 agent 在列表中存在就不动
    if (selectedAgent && primaryAgents.some(a => a.name === selectedAgent)) return

    // 否则选第一个 primary agent
    setSelectedAgent(primaryAgents[0].name)
  }, [agents]) // 故意不依赖 selectedAgent，只在 agents 列表变化时校验

  // Load child sessions and pending permissions on session change
  // 页面刷新时 childSessionStore 是空的，需要先从 API 恢复子 session 关系
  // 然后再加载权限请求（包括子 session 的权限）
  useEffect(() => {
    if (!routeSessionId) {
      resetPendingRequests()
      return
    }

    let cancelled = false

    async function loadChildSessionsAndPermissions() {
      // Step 1: 恢复子 session 关系（如果 store 中还没有）
      const existingChildren = childSessionStore.getChildSessionIds(routeSessionId!)
      if (existingChildren.length === 0) {
        try {
          const children = await getSessionChildren(routeSessionId!, effectiveDirectory)
          if (cancelled) return
          // 注册所有子 session 到 store
          for (const child of children) {
            childSessionStore.registerChildSession(child)
          }
        } catch {
          // 获取子 session 失败不影响主流程
        }
      }

      if (cancelled) return

      // Step 2: 获取完整的 session family（主 session + 所有子孙）
      const family = new Set(childSessionStore.getSessionAndDescendants(routeSessionId!))

      // Step 3: 获取所有待处理请求，然后用 family 过滤
      // GET /permission 和 GET /question 返回全量数据，不传 sessionId 避免 N 次重复请求
      const [allPerms, allQuestions] = await Promise.all([
        getPendingPermissions(undefined, effectiveDirectory).catch(() => []),
        getPendingQuestions(undefined, effectiveDirectory).catch(() => []),
      ])

      if (cancelled) return

      // 只保留属于当前 session family 的请求
      setPendingPermissionRequests(allPerms.filter(p => family.has(p.sessionID)))
      setPendingQuestionRequests(allQuestions.filter(q => family.has(q.sessionID)))
    }

    loadChildSessionsAndPermissions()

    return () => { cancelled = true }
  }, [routeSessionId, effectiveDirectory, resetPendingRequests, setPendingPermissionRequests, setPendingQuestionRequests])

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

      await sendMessageAsync({
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

  // Command handler (slash commands)
  const handleCommand = useCallback(async (commandStr: string) => {
    // 解析命令："/help arg1 arg2" => command="help", args="arg1 arg2"
    const trimmed = commandStr.trim()
    const withoutSlash = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed
    const spaceIndex = withoutSlash.indexOf(' ')
    const command = spaceIndex > 0 ? withoutSlash.slice(0, spaceIndex) : withoutSlash
    const args = spaceIndex > 0 ? withoutSlash.slice(spaceIndex + 1) : ''
    
    if (!command) return
    
    let sessionId = routeSessionId
    
    try {
      // Create session if needed (like handleSend does)
      if (!sessionId) {
        const newSession = await createSession()
        sessionId = newSession.id
        messageStore.setCurrentSession(sessionId)
        navigateToSession(sessionId)
      }
      
      await executeCommand(sessionId, command, args, effectiveDirectory)
    } catch (err) {
      handleError('execute command', err)
    }
  }, [routeSessionId, effectiveDirectory, createSession, navigateToSession])

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

  // Archive current session
  const handleArchiveSession = useCallback(async () => {
    if (!routeSessionId) return
    try {
      await updateSession(routeSessionId, { time: { archived: Date.now() } }, effectiveDirectory)
      navigateHome()
      handleNewChat()
    } catch (error) {
      handleError('archive session', error)
    }
  }, [routeSessionId, effectiveDirectory, navigateHome, handleNewChat])

  // Navigate to previous session
  const handlePreviousSession = useCallback(() => {
    if (!sessions.length) return
    const currentIndex = sessions.findIndex(s => s.id === routeSessionId)
    if (currentIndex > 0) {
      navigateToSession(sessions[currentIndex - 1].id)
    } else if (currentIndex === -1 && sessions.length > 0) {
      // Not in any session, go to first
      navigateToSession(sessions[0].id)
    }
  }, [sessions, routeSessionId, navigateToSession])

  // Navigate to next session
  const handleNextSession = useCallback(() => {
    if (!sessions.length) return
    const currentIndex = sessions.findIndex(s => s.id === routeSessionId)
    if (currentIndex >= 0 && currentIndex < sessions.length - 1) {
      navigateToSession(sessions[currentIndex + 1].id)
    }
  }, [sessions, routeSessionId, navigateToSession])

  // Toggle agent (cycle through primary agents only, matching toolbar display)
  const handleToggleAgent = useCallback(() => {
    const primaryAgents = agents.filter(a => a.mode === 'primary' && !a.hidden)
    if (primaryAgents.length <= 1) return
    const currentIndex = primaryAgents.findIndex(a => a.name === selectedAgent)
    const nextIndex = (currentIndex + 1) % primaryAgents.length
    setSelectedAgent(primaryAgents[nextIndex].name)
  }, [agents, selectedAgent, setSelectedAgent])

  // 从消息中恢复 agent 选择（用于切换 session 时）
  const restoreAgentFromMessage = useCallback((agentName: string | null | undefined) => {
    if (!agentName) return
    // 只有当 agent 存在于列表中时才恢复
    const exists = agents.some(a => a.name === agentName && a.mode === 'primary' && !a.hidden)
    if (exists) {
      setSelectedAgent(agentName)
    }
  }, [agents, setSelectedAgent])

  // Copy last AI response to clipboard
  const handleCopyLastResponse = useCallback(async () => {
    const lastAssistant = [...messages].reverse().find(m => m.info.role === 'assistant')
    if (!lastAssistant) return
    
    const text = getMessageText(lastAssistant)
    if (text) {
      try {
        await navigator.clipboard.writeText(text)
      } catch {
        // Fallback for older browsers
        const textArea = document.createElement('textarea')
        textArea.value = text
        document.body.appendChild(textArea)
        textArea.select()
        document.execCommand('copy')
        document.body.removeChild(textArea)
      }
    }
  }, [messages])

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
    loadState,
    hasMoreHistory,
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
    handleCommand,
    handleUndoWithAnimation,
    handleRedoWithAnimation,
    handleSelectSession,
    handleNewSession,
    handleVisibleMessageIdsChange,
    handleArchiveSession,
    handlePreviousSession,
    handleNextSession,
    handleToggleAgent,
    handleCopyLastResponse,
    restoreAgentFromMessage,
  }
}
