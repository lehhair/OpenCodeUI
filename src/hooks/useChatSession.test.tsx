import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatSession } from './useChatSession'
import { inboxStore } from '../store/inboxStore'
import { sendMessageAsync } from '../api'

const sendMessageAsyncMock = vi.mocked(sendMessageAsync)

const {
  createSessionMock,
  summarizeSessionMock,
  executeCommandMock,
  getSelectableAgentsMock,
  registerSessionConsumerMock,
  updateConsumerSessionIdMock,
  sendNotificationMock,
  isSystemEnabledMock,
  errorHandlerMock,
  getPaneFullAutoModeMock,
  onFullAutoChangeMock,
  autoApproveSubscribeMock,
  shouldAutoApproveMock,
  claimAutoReplyMock,
  releaseAutoReplyMock,
  useSessionFamilyMock,
  childBelongsToSessionMock,
  pendingPermissionRequestsMock,
  handlePermissionReplyMock,
  refreshPendingRequestsMock,
  useSessionStateMock,
  activeSessionStatusMap,
  handleUndoMock,
  handleRedoMock,
  forkSessionMock,
  exportSessionMock,
  saveDataMock,
} = vi.hoisted(() => ({
  createSessionMock: vi.fn(),
  summarizeSessionMock: vi.fn(),
  executeCommandMock: vi.fn(),
  getSelectableAgentsMock: vi.fn(),
  registerSessionConsumerMock: vi.fn(),
  updateConsumerSessionIdMock: vi.fn(),
  sendNotificationMock: vi.fn(),
  isSystemEnabledMock: vi.fn((type: string) => type !== 'permission'),
  errorHandlerMock: vi.fn(),
  getPaneFullAutoModeMock: vi.fn((_paneId: string) => 'off'),
  onFullAutoChangeMock: vi.fn((_listener: unknown) => vi.fn()),
  autoApproveSubscribeMock: vi.fn((_listener: unknown) => vi.fn()),
  shouldAutoApproveMock: vi.fn((_sessionId: string, _permission: string, _patterns: string[]) => false),
  claimAutoReplyMock: vi.fn((_requestId: string) => true),
  releaseAutoReplyMock: vi.fn((_requestId: string) => undefined),
  useSessionFamilyMock: vi.fn((_sessionId: string | null) => [] as string[]),
  childBelongsToSessionMock: vi.fn((_sessionId: string, _rootSessionId: string) => false),
  pendingPermissionRequestsMock: [] as Array<{ id: string; sessionID: string; permission: string; patterns?: string[] }>,
  handlePermissionReplyMock: vi.fn(
    (_requestId: string, _reply: string, _directory?: string, _sessionId?: string) => Promise.resolve(true),
  ),
  refreshPendingRequestsMock: vi.fn((_sessionIds?: string | string[], _directory?: string) => Promise.resolve()),
  useSessionStateMock: vi.fn((_sessionId: string | null) => null as null | { isStreaming: boolean; messages: unknown[] }),
  activeSessionStatusMap: {} as Record<string, { type: string; attempt?: number; message?: string; next?: number }>,
  handleUndoMock: vi.fn((_messageId: string) => Promise.resolve()),
  handleRedoMock: vi.fn(() => Promise.resolve()),
  forkSessionMock: vi.fn((_sessionId?: string, _messageId?: string, _directory?: string, _serverId?: string) =>
    Promise.resolve({ id: 'ses-forked', location: { directory: '/workspace/demo' } }),
  ),
  exportSessionMock: vi.fn((_sessionId?: string, _directory?: string, _serverId?: string) =>
    Promise.resolve({ info: {}, messages: [] }),
  ),
  saveDataMock: vi.fn(),
}))

const autoApproveState = vi.hoisted(() => ({
  approvePendingOnFullAuto: false,
}))

vi.mock('../store', () => ({
  messageStore: {
    markAllSessionsStale: vi.fn(),
    getSessionState: vi.fn(() => ({ messages: [] })),
    setStreaming: vi.fn(),
    createSendRollbackSnapshot: vi.fn(),
    truncateAfterRevert: vi.fn(),
    restoreSendRollback: vi.fn(),
    handleMessageUpdated: vi.fn(),
    handlePartUpdated: vi.fn(),
    upsertLocalMessage: vi.fn(),
    removeMessage: vi.fn(),
    extractUserText: vi.fn(() => 'forked prompt text'),
    extractUserAttachments: vi.fn(() => []),
  },
  useSessionFamily: (sessionId: string | null) => useSessionFamilyMock(sessionId),
  useSessionState: (sessionId: string | null) => useSessionStateMock(sessionId),
  autoApproveStore: {
    getPaneFullAutoMode: (paneId: string) => getPaneFullAutoModeMock(paneId),
    onFullAutoChange: (listener: unknown) => onFullAutoChangeMock(listener),
    subscribe: (listener: unknown) => autoApproveSubscribeMock(listener),
    get approvePendingOnFullAuto() {
      return autoApproveState.approvePendingOnFullAuto
    },
    enabled: false,
    shouldAutoApprove: (sessionId: string, permission: string, patterns: string[]) =>
      shouldAutoApproveMock(sessionId, permission, patterns),
    claimAutoReply: (requestId: string) => claimAutoReplyMock(requestId),
    releaseAutoReply: (requestId: string) => releaseAutoReplyMock(requestId),
  },
  childSessionStore: {
    getChildSessionIds: vi.fn(() => []),
    registerChildSession: vi.fn(),
    getSessionAndDescendants: vi.fn(() => []),
    // 系统通知去重要用：请求所属 session 是否在当前 pane 的会话 family 内
    belongsToSession: (sessionId: string, rootSessionId: string) =>
      childBelongsToSessionMock(sessionId, rootSessionId),
  },
  useActiveSessionStore: () => ({ statusMap: activeSessionStatusMap }),
}))

vi.mock('../hooks', () => ({
  useSessionManager: () => ({
    loadSession: vi.fn(),
    loadMoreHistory: vi.fn(),
    handleUndo: handleUndoMock,
    handleRedo: handleRedoMock,
    handleRedoAll: vi.fn(),
    clearRevert: vi.fn(),
  }),
  registerSessionConsumer: (...args: unknown[]) => registerSessionConsumerMock(...args),
  updateConsumerSessionId: (...args: unknown[]) => updateConsumerSessionIdMock(...args),
  hasOtherConsumerForSession: vi.fn(() => false),
  usePermissions: () => ({ resetPermissions: vi.fn() }),
  usePermissionHandler: () => ({
    pendingPermissionRequests: pendingPermissionRequestsMock,
    pendingQuestionRequests: [],
    setPendingPermissionRequests: vi.fn(),
    setPendingQuestionRequests: vi.fn(),
    handlePermissionReply: handlePermissionReplyMock,
    // v2：question 由 form 取代
    handleFormReply: vi.fn(),
    handleFormCancel: vi.fn(),
    refreshPendingRequests: refreshPendingRequestsMock,
    resetPendingRequests: vi.fn(),
    // 已解决标记（防止旧快照复活已通过的权限）
    markPermissionResolved: vi.fn(),
    isPermissionResolved: vi.fn(() => false),
    isReplying: false,
  }),
  useMessageAnimation: () => ({
    registerMessage: vi.fn(),
    registerInputBox: vi.fn(),
    animateUndo: vi.fn(),
    animateRedo: vi.fn(),
  }),
  useDirectory: () => ({ currentDirectory: '/workspace/demo' }),
  // agents 现在来自共享 store（useAgents）；测试中给固定列表
  useAgents: () => ({
    agents: [{ name: 'build', mode: 'primary', hidden: false }],
    isLoading: false,
    error: null,
    refetch: vi.fn(() => Promise.resolve()),
  }),
  useSessionContext: () => ({
    createSession: createSessionMock,
    sessions: [],
  }),
}))

vi.mock('./useNotification', () => ({
  useNotification: () => ({ sendNotification: sendNotificationMock }),
}))

vi.mock('../store/notificationEventSettingsStore', () => ({
  notificationEventSettingsStore: {
    isSystemEnabled: (type: string) => isSystemEnabledMock(type),
  },
}))

vi.mock('../api', () => ({
  sendMessageAsync: vi.fn(),
  getSessionMessages: vi.fn(),
  abortSession: vi.fn(),
  getSelectableAgents: (...args: unknown[]) => getSelectableAgentsMock(...args),
  getPendingPermissions: vi.fn(() => Promise.resolve([])),
  // v2：question 由 form 取代
  getPendingForms: vi.fn(() => Promise.resolve([])),
  prefetchCommands: vi.fn(() => Promise.resolve()),
  prefetchRootDirectory: vi.fn(() => Promise.resolve()),
  getSessionChildren: vi.fn(() => Promise.resolve([])),
  executeCommand: (...args: unknown[]) => executeCommandMock(...args),
  summarizeSession: (...args: unknown[]) => summarizeSessionMock(...args),
  updateSession: vi.fn(),
  forkSession: (...args: unknown[]) => forkSessionMock(...(args as [string, string?, string?, string?])),
  exportSession: (...args: unknown[]) => exportSessionMock(...(args as [string, string?, string?])),
  getSessionInbox: vi.fn(() => Promise.resolve([])),
  cancelInboxItem: vi.fn(() => Promise.resolve()),
  steerInboxItem: vi.fn(() => Promise.resolve()),
  extractUserMessageContent: vi.fn(),
  subscribeToServerConnectionState: vi.fn(() => () => {}),
}))

vi.mock('../utils', () => ({
  clipboardErrorHandler: vi.fn(),
  copyTextToClipboard: vi.fn(),
  createErrorHandler: vi.fn(() => errorHandlerMock),
}))

vi.mock('../utils/perServerStorage', () => ({
  serverStorage: {
    get: vi.fn(() => 'build'),
    set: vi.fn(),
  },
}))

vi.mock('../utils/downloadUtils', () => ({
  saveData: (...args: unknown[]) => saveDataMock(...args),
}))

describe('useChatSession handleCommand', () => {
  beforeEach(() => {
    createSessionMock.mockReset()
    summarizeSessionMock.mockReset()
    executeCommandMock.mockReset()
    getSelectableAgentsMock.mockReset()
    registerSessionConsumerMock.mockReset()
    updateConsumerSessionIdMock.mockReset()
    sendNotificationMock.mockReset()
    isSystemEnabledMock.mockReset()
    errorHandlerMock.mockReset()
    getPaneFullAutoModeMock.mockReset()
    onFullAutoChangeMock.mockReset()
    autoApproveSubscribeMock.mockReset()
    shouldAutoApproveMock.mockReset()
    claimAutoReplyMock.mockReset()
    releaseAutoReplyMock.mockReset()
    useSessionFamilyMock.mockReset()
    childBelongsToSessionMock.mockReset()
    childBelongsToSessionMock.mockReturnValue(false)
    handlePermissionReplyMock.mockReset()
    refreshPendingRequestsMock.mockReset()
    useSessionStateMock.mockReset()
    handleUndoMock.mockClear()
    handleRedoMock.mockClear()
    forkSessionMock.mockClear()
    exportSessionMock.mockClear()
    saveDataMock.mockClear()
    pendingPermissionRequestsMock.length = 0
    for (const key of Object.keys(activeSessionStatusMap)) {
      delete activeSessionStatusMap[key]
    }

    registerSessionConsumerMock.mockReturnValue(vi.fn())
    getPaneFullAutoModeMock.mockReturnValue('off')
    onFullAutoChangeMock.mockReturnValue(vi.fn())
    autoApproveSubscribeMock.mockReturnValue(vi.fn())
    shouldAutoApproveMock.mockReturnValue(false)
    claimAutoReplyMock.mockReturnValue(true)
    useSessionFamilyMock.mockReturnValue([])
    useSessionStateMock.mockReturnValue(null)
    handlePermissionReplyMock.mockResolvedValue(true)
    refreshPendingRequestsMock.mockResolvedValue(undefined)
    autoApproveState.approvePendingOnFullAuto = false
    getSelectableAgentsMock.mockResolvedValue([{ name: 'build', mode: 'primary', hidden: false }])
    isSystemEnabledMock.mockImplementation((type: string) => type !== 'permission')

    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => window.setTimeout(() => cb(0), 16))
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => {
      clearTimeout(id)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('treats compact as sent before summarize finishes', async () => {
    summarizeSessionMock.mockReturnValue(new Promise<boolean>(() => {}))

    const { result } = renderHook(() =>
      useChatSession({
        paneId: 'pane-1',
        chatAreaRef: { current: null },
        currentModel: { id: 'model-1', providerID: 'provider-1', variants: [] } as never,
        refetchModels: vi.fn(async () => {}),
        sessionId: 'session-1',
        navigateToSession: vi.fn(),
        navigateHome: vi.fn(),
      }),
    )

    let settled = false
    let commandResult: boolean | undefined

    await act(async () => {
      const promise = result.current.handleCommand('/compact')
      promise.then(value => {
        settled = true
        commandResult = value
      })
      await Promise.resolve()
    })

    expect(summarizeSessionMock).toHaveBeenCalledWith(
      'session-1',
      { providerID: 'provider-1', modelID: 'model-1' },
      '/workspace/demo',
      'local',
    )
    expect(settled).toBe(true)
    expect(commandResult).toBe(true)
  })

  it('treats api commands as sent before execution finishes', async () => {
    executeCommandMock.mockReturnValue(new Promise(() => {}))

    const { result } = renderHook(() =>
      useChatSession({
        paneId: 'pane-1',
        chatAreaRef: { current: null },
        currentModel: { id: 'model-1', providerID: 'provider-1', variants: [] } as never,
        refetchModels: vi.fn(async () => {}),
        sessionId: 'session-1',
        navigateToSession: vi.fn(),
        navigateHome: vi.fn(),
      }),
    )

    let settled = false
    let commandResult: boolean | undefined

    await act(async () => {
      const promise = result.current.handleCommand('/review src/App.tsx')
      promise.then(value => {
        settled = true
        commandResult = value
      })
      await Promise.resolve()
    })

    expect(executeCommandMock).toHaveBeenCalledWith('session-1', 'review', 'src/App.tsx', '/workspace/demo', 'local')
    expect(settled).toBe(true)
    expect(commandResult).toBe(true)
  })

  it('客户端命令族：/undo /redo /fork /export 不走后端 command 路由', async () => {
    useSessionStateMock.mockReturnValue({
      isStreaming: false,
      canRedo: true,
      messages: [
        { id: 'u1', type: 'user', text: 'first', time: { created: 1 } },
        { id: 'a1', type: 'assistant', parts: [], time: { created: 2 } },
        { id: 'u2', type: 'user', text: 'second', time: { created: 3 } },
      ],
    } as never)
    const navigateToSession = vi.fn()

    const { result } = renderHook(() =>
      useChatSession({
        paneId: 'pane-1',
        chatAreaRef: { current: null },
        currentModel: { id: 'model-1', providerID: 'provider-1', variants: [] } as never,
        refetchModels: vi.fn(async () => {}),
        sessionId: 'session-1',
        navigateToSession,
        navigateHome: vi.fn(),
      }),
    )

    // /undo → 回到最后一条用户消息（官方 session.undo 同款）
    let ok = false
    await act(async () => {
      ok = (await result.current.handleCommand('/undo')) ?? false
    })
    expect(ok).toBe(true)
    expect(handleUndoMock).toHaveBeenCalledWith('u2')
    expect(executeCommandMock).not.toHaveBeenCalled()

    // /redo → handleRedo
    await act(async () => {
      ok = (await result.current.handleCommand('/redo')) ?? false
    })
    expect(ok).toBe(true)
    expect(handleRedoMock).toHaveBeenCalled()

    // /fork → fork 整个会话（不传 messageID）并跳转
    await act(async () => {
      ok = (await result.current.handleCommand('/fork')) ?? false
    })
    expect(ok).toBe(true)
    expect(forkSessionMock).toHaveBeenCalledWith('session-1', undefined, '/workspace/demo', 'local')
    expect(navigateToSession).toHaveBeenCalledWith('ses-forked', '/workspace/demo')

    // /export → 导出转写并下载（官方 session.export 同款）
    await act(async () => {
      ok = (await result.current.handleCommand('/export')) ?? false
    })
    expect(ok).toBe(true)
    expect(exportSessionMock).toHaveBeenCalledWith('session-1', '/workspace/demo', 'local')
    expect(saveDataMock).toHaveBeenCalled()

    expect(executeCommandMock).not.toHaveBeenCalled()
  })

  it('fork 用户消息后，带服务器前缀的新会话能恢复输入框预填内容', async () => {
    useSessionStateMock.mockReturnValue({
      isStreaming: false,
      canRedo: false,
      messages: [{ id: 'u1', type: 'user', text: 'forked prompt text', time: { created: 1 } }],
    } as never)
    const navigateToSession = vi.fn()

    const { result, rerender } = renderHook(
      ({ sessionId }: { sessionId: string }) =>
        useChatSession({
          paneId: 'pane-1',
          chatAreaRef: { current: null },
          currentModel: { id: 'model-1', providerID: 'provider-1', variants: [] } as never,
          refetchModels: vi.fn(async () => {}),
          sessionId,
          navigateToSession,
          navigateHome: vi.fn(),
        }),
      { initialProps: { sessionId: 'session-1' } },
    )

    // fork 一条用户消息 → fork 接口返回原始 id（ses-forked），并跳转到新会话
    await act(async () => {
      await result.current.handleForkMessage({ id: 'u1', type: 'user', sessionID: 'session-1' } as never)
    })
    expect(forkSessionMock).toHaveBeenCalledWith('session-1', 'u1', '/workspace/demo', 'local')
    expect(navigateToSession).toHaveBeenCalledWith('ses-forked', '/workspace/demo')

    // 模拟导航完成：route 变为带服务器前缀的复合 key（local::ses-forked）
    rerender({ sessionId: 'local::ses-forked' })

    // 预填内容应能按原始 id 匹配上。
    // 回归：restoredContent.sessionId（原始 ses-forked）与 routeSessionId（local::ses-forked）
    // 直接全等比较永远不匹配，导致 fork 后输入框预填丢失。
    expect(result.current.restoredContent?.text).toBe('forked prompt text')
  })

  it('/undo 在无用户消息时不动作；/redo 在不可 redo 时不动作', async () => {
    useSessionStateMock.mockReturnValue({
      isStreaming: false,
      canRedo: false,
      messages: [{ id: 'a1', type: 'assistant', parts: [], time: { created: 2 } }],
    } as never)

    const { result } = renderHook(() =>
      useChatSession({
        paneId: 'pane-1',
        chatAreaRef: { current: null },
        currentModel: { id: 'model-1', providerID: 'provider-1', variants: [] } as never,
        refetchModels: vi.fn(async () => {}),
        sessionId: 'session-1',
        navigateToSession: vi.fn(),
        navigateHome: vi.fn(),
      }),
    )

    let ok: boolean | undefined
    await act(async () => {
      ok = await result.current.handleCommand('/undo')
    })
    expect(ok).toBe(false)
    expect(handleUndoMock).not.toHaveBeenCalled()

    await act(async () => {
      ok = await result.current.handleCommand('/redo')
    })
    expect(ok).toBe(false)
    expect(handleRedoMock).not.toHaveBeenCalled()
    expect(executeCommandMock).not.toHaveBeenCalled()
  })

  it('refreshes pending permissions when session full auto pending sweep is enabled', async () => {
    getPaneFullAutoModeMock.mockReturnValue('session')
    autoApproveState.approvePendingOnFullAuto = true
    useSessionFamilyMock.mockReturnValue(['session-1', 'child-session'])

    renderHook(() =>
      useChatSession({
        paneId: 'pane-1',
        chatAreaRef: { current: null },
        currentModel: { id: 'model-1', providerID: 'provider-1', variants: [] } as never,
        refetchModels: vi.fn(async () => {}),
        sessionId: 'session-1',
        navigateToSession: vi.fn(),
        navigateHome: vi.fn(),
      }),
    )

    await waitFor(() => {
      expect(refreshPendingRequestsMock).toHaveBeenCalledWith(['session-1', 'child-session'], '/workspace/demo')
    })
  })

  it('approves already pending permissions when session full auto pending sweep is enabled', async () => {
    getPaneFullAutoModeMock.mockReturnValue('session')
    autoApproveState.approvePendingOnFullAuto = true
    pendingPermissionRequestsMock.push({
      id: 'perm-1',
      sessionID: 'session-1',
      permission: 'bash',
      patterns: ['npm test'],
    })

    renderHook(() =>
      useChatSession({
        paneId: 'pane-1',
        chatAreaRef: { current: null },
        currentModel: { id: 'model-1', providerID: 'provider-1', variants: [] } as never,
        refetchModels: vi.fn(async () => {}),
        sessionId: 'session-1',
        navigateToSession: vi.fn(),
        navigateHome: vi.fn(),
      }),
    )

    await waitFor(() => {
      expect(claimAutoReplyMock).toHaveBeenCalledWith('perm-1')
      expect(handlePermissionReplyMock).toHaveBeenCalledWith('perm-1', 'once', '/workspace/demo', 'session-1')
    })
  })

  it.each([
    {
      disabledType: 'permission',
      trigger: 'onPermissionAsked',
      payload: { id: 'perm-1', sessionID: 'session-1', permission: 'bash', patterns: [] },
    },
    {
      disabledType: 'question',
      trigger: 'onQuestionAsked',
      payload: {
        id: 'question-1',
        sessionID: 'session-1',
        questions: [{ header: 'Need input' }],
      },
    },
    {
      disabledType: 'completed',
      trigger: 'onSessionIdle',
      payload: 'session-1',
    },
    {
      disabledType: 'error',
      trigger: 'onSessionError',
      payload: 'session-1',
    },
  ])(
    'does not send browser notification when the $disabledType event is disabled',
    async ({ disabledType, trigger, payload }) => {
      let callbacks: Record<string, ((payload: unknown) => void) | undefined> | undefined
      registerSessionConsumerMock.mockImplementation((_paneId, _sessionId, consumerCallbacks) => {
        callbacks = consumerCallbacks as typeof callbacks
        return vi.fn()
      })
      isSystemEnabledMock.mockImplementation((type: string) => type !== disabledType)

      renderHook(() =>
        useChatSession({
          paneId: 'pane-1',
          chatAreaRef: { current: null },
          currentModel: { id: 'model-1', providerID: 'provider-1', variants: [] } as never,
          refetchModels: vi.fn(async () => {}),
          sessionId: 'session-1',
          navigateToSession: vi.fn(),
          navigateHome: vi.fn(),
        }),
      )

      act(() => {
        callbacks?.[trigger]?.(payload)
      })

      expect(sendNotificationMock).not.toHaveBeenCalled()
    },
  )

  it('子会话（父链上是当前会话）的权限不发系统通知——它就挂在你眼前的界面上', () => {
    let callbacks: Record<string, ((payload: unknown) => void) | undefined> | undefined
    registerSessionConsumerMock.mockImplementation((_paneId, _sessionId, consumerCallbacks) => {
      callbacks = consumerCallbacks as typeof callbacks
      return vi.fn()
    })
    isSystemEnabledMock.mockReturnValue(true)
    // 父子关系从子会话创建起就存在（与 session 列表同源）
    childBelongsToSessionMock.mockImplementation((sessionId: string) => sessionId.includes('child-session'))

    renderHook(() =>
      useChatSession({
        paneId: 'pane-1',
        chatAreaRef: { current: null },
        currentModel: { id: 'model-1', providerID: 'provider-1', variants: [] } as never,
        refetchModels: vi.fn(async () => {}),
        sessionId: 'session-1',
        navigateToSession: vi.fn(),
        navigateHome: vi.fn(),
      }),
    )

    act(() => {
      callbacks?.onPermissionAsked?.({
        id: 'perm-child',
        sessionID: 'local::child-session',
        action: 'bash',
        resources: ['npm test'],
      })
    })

    expect(sendNotificationMock).not.toHaveBeenCalled()
  })

  it('别的会话（父链上不是当前会话）的权限仍然通知', () => {
    let callbacks: Record<string, ((payload: unknown) => void) | undefined> | undefined
    registerSessionConsumerMock.mockImplementation((_paneId, _sessionId, consumerCallbacks) => {
      callbacks = consumerCallbacks as typeof callbacks
      return vi.fn()
    })
    isSystemEnabledMock.mockReturnValue(true)
    childBelongsToSessionMock.mockReturnValue(false)

    renderHook(() =>
      useChatSession({
        paneId: 'pane-1',
        chatAreaRef: { current: null },
        currentModel: { id: 'model-1', providerID: 'provider-1', variants: [] } as never,
        refetchModels: vi.fn(async () => {}),
        sessionId: 'session-1',
        navigateToSession: vi.fn(),
        navigateHome: vi.fn(),
      }),
    )

    act(() => {
      callbacks?.onPermissionAsked?.({
        id: 'perm-other',
        sessionID: 'local::other-session',
        action: 'bash',
        resources: ['npm test'],
      })
    })

    expect(sendNotificationMock).toHaveBeenCalled()
  })
})

describe('useChatSession busy UI signal', () => {
  beforeEach(() => {
    createSessionMock.mockReset()
    summarizeSessionMock.mockReset()
    executeCommandMock.mockReset()
    getSelectableAgentsMock.mockReset()
    registerSessionConsumerMock.mockReset()
    updateConsumerSessionIdMock.mockReset()
    sendNotificationMock.mockReset()
    isSystemEnabledMock.mockReset()
    errorHandlerMock.mockReset()
    getPaneFullAutoModeMock.mockReset()
    onFullAutoChangeMock.mockReset()
    autoApproveSubscribeMock.mockReset()
    shouldAutoApproveMock.mockReset()
    claimAutoReplyMock.mockReset()
    releaseAutoReplyMock.mockReset()
    useSessionFamilyMock.mockReset()
    childBelongsToSessionMock.mockReset()
    childBelongsToSessionMock.mockReturnValue(false)
    handlePermissionReplyMock.mockReset()
    refreshPendingRequestsMock.mockReset()
    useSessionStateMock.mockReset()
    handleUndoMock.mockClear()
    handleRedoMock.mockClear()
    forkSessionMock.mockClear()
    exportSessionMock.mockClear()
    saveDataMock.mockClear()
    pendingPermissionRequestsMock.length = 0
    for (const key of Object.keys(activeSessionStatusMap)) {
      delete activeSessionStatusMap[key]
    }

    registerSessionConsumerMock.mockReturnValue(vi.fn())
    getPaneFullAutoModeMock.mockReturnValue('off')
    onFullAutoChangeMock.mockReturnValue(vi.fn())
    autoApproveSubscribeMock.mockReturnValue(vi.fn())
    shouldAutoApproveMock.mockReturnValue(false)
    claimAutoReplyMock.mockReturnValue(true)
    useSessionFamilyMock.mockReturnValue([])
    useSessionStateMock.mockReturnValue(null)
    handlePermissionReplyMock.mockResolvedValue(true)
    refreshPendingRequestsMock.mockResolvedValue(undefined)
    autoApproveState.approvePendingOnFullAuto = false
    getSelectableAgentsMock.mockResolvedValue([{ name: 'build', mode: 'primary', hidden: false }])
    isSystemEnabledMock.mockImplementation((type: string) => type !== 'permission')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps UI isStreaming true from session.status when message streaming is false', () => {
    useSessionStateMock.mockReturnValue({ isStreaming: false, messages: [] })
    activeSessionStatusMap['session-1'] = { type: 'busy' }

    const { result } = renderHook(() =>
      useChatSession({
        paneId: 'pane-1',
        chatAreaRef: { current: null },
        currentModel: { id: 'model-1', providerID: 'provider-1', variants: [] } as never,
        refetchModels: vi.fn(async () => {}),
        sessionId: 'session-1',
        navigateToSession: vi.fn(),
        navigateHome: vi.fn(),
      }),
    )

    expect(result.current.isStreaming).toBe(true)
    expect(result.current.messageIsStreaming).toBe(false)
  })

  it('keeps UI isStreaming true while session is in retry between agent steps', () => {
    useSessionStateMock.mockReturnValue({ isStreaming: false, messages: [] })
    activeSessionStatusMap['session-1'] = {
      type: 'retry',
      attempt: 1,
      message: 'retrying',
      next: Date.now() + 1000,
    }

    const { result } = renderHook(() =>
      useChatSession({
        paneId: 'pane-1',
        chatAreaRef: { current: null },
        currentModel: { id: 'model-1', providerID: 'provider-1', variants: [] } as never,
        refetchModels: vi.fn(async () => {}),
        sessionId: 'session-1',
        navigateToSession: vi.fn(),
        navigateHome: vi.fn(),
      }),
    )

    expect(result.current.isStreaming).toBe(true)
    expect(result.current.messageIsStreaming).toBe(false)
    expect(result.current.retryStatus?.attempt).toBe(1)
  })

  it('falls back to message streaming when session status is idle', () => {
    useSessionStateMock.mockReturnValue({ isStreaming: true, messages: [] })

    const { result } = renderHook(() =>
      useChatSession({
        paneId: 'pane-1',
        chatAreaRef: { current: null },
        currentModel: { id: 'model-1', providerID: 'provider-1', variants: [] } as never,
        refetchModels: vi.fn(async () => {}),
        sessionId: 'session-1',
        navigateToSession: vi.fn(),
        navigateHome: vi.fn(),
      }),
    )

    expect(result.current.isStreaming).toBe(true)
    expect(result.current.messageIsStreaming).toBe(true)
  })

  it('admits a local inbox item on busy send so the queue bubble shows immediately', async () => {
    useSessionStateMock.mockReturnValue({ isStreaming: false, messages: [] })
    activeSessionStatusMap['session-1'] = { type: 'busy' }
    inboxStore.reset()
    const upsertSpy = vi.spyOn(inboxStore, 'upsertItem')
    sendMessageAsyncMock.mockResolvedValue(undefined)

    const { result } = renderHook(() =>
      useChatSession({
        paneId: 'pane-1',
        chatAreaRef: { current: null },
        currentModel: { id: 'model-1', providerID: 'provider-1', variants: [] } as never,
        refetchModels: vi.fn(async () => {}),
        sessionId: 'session-1',
        navigateToSession: vi.fn(),
        navigateHome: vi.fn(),
      }),
    )

    await act(async () => {
      await result.current.handleSend('queued prompt', [])
    })

    // busy 发送时同步 admit 本地 inbox 条目（官方 admitLocal）：
    // 转写投影立刻隐藏回声 → 队列气泡一步到位，不会先闪实心气泡
    expect(upsertSpy).toHaveBeenCalledTimes(1)
    const [sessionArg, itemArg] = upsertSpy.mock.calls[0] as [
      string,
      { id: string; type: string; delivery: string; payload: { text: string } },
    ]
    expect(sessionArg).toBe('session-1')
    expect(itemArg.type).toBe('user')
    // busyDelivery 默认 steer（queueFollowupMessages 默认关）
    expect(itemArg.delivery).toBe('steer')
    expect(itemArg.payload.text).toBe('queued prompt')
    // inboxID 与乐观消息 id 同值，转写投影靠它对账
    const sendArgs = sendMessageAsyncMock.mock.calls.at(-1)?.[0] as { id: string; delivery?: string }
    expect(sendArgs.delivery).toBe('steer')
    expect(itemArg.id).toBe(sendArgs.id)
    upsertSpy.mockRestore()
    inboxStore.reset()
  })

  it('does not admit an inbox item when idle（idle 发送不入队）', async () => {
    useSessionStateMock.mockReturnValue({ isStreaming: false, messages: [] })
    inboxStore.reset()
    const upsertSpy = vi.spyOn(inboxStore, 'upsertItem')
    sendMessageAsyncMock.mockResolvedValue(undefined)

    const { result } = renderHook(() =>
      useChatSession({
        paneId: 'pane-1',
        chatAreaRef: { current: null },
        currentModel: { id: 'model-1', providerID: 'provider-1', variants: [] } as never,
        refetchModels: vi.fn(async () => {}),
        sessionId: 'session-1',
        navigateToSession: vi.fn(),
        navigateHome: vi.fn(),
      }),
    )

    await act(async () => {
      await result.current.handleSend('idle prompt', [])
    })

    expect(upsertSpy).not.toHaveBeenCalled()
    const sendArgs = sendMessageAsyncMock.mock.calls.at(-1)?.[0] as { delivery?: string }
    expect(sendArgs.delivery).toBeUndefined()
    upsertSpy.mockRestore()
  })
})
