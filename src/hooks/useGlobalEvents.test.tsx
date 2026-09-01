import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerSessionConsumer, useGlobalEvents } from './useGlobalEvents'

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res => {
    resolve = res
  })
  return { promise, resolve }
}

const {
  subscribeToEventsMock,
  getSessionStatusMock,
  getPendingPermissionsMock,
  getPendingQuestionsMock,
  replyPermissionMock,
  childBelongsToSessionMock,
  getFocusedSessionIdMock,
  getSessionAndDescendantsMock,
  notificationPushMock,
  playNotificationSoundDedupedMock,
  getSoundSnapshotMock,
  isSystemEnabledMock,
  activeSessionStoreMock,
  applyServerConnectedTimestampMock,
  getActiveServerIdMock,
  checkHealthMock,
  onServerChangeMock,
  serverChangeListeners,
  registeredServerIds,
  serverStoreListeners,
  multiServerMock,
  multiServerListeners,
  paneLeavesMock,
  autoApproveStoreMock,
  clearSessionRuntimeStateMock,
  clearPaneSessionMock,
} = vi.hoisted(() => {
  // onServerChange 是多播语义（effect 里注册多个监听器），mock 必须保存全部监听器；
  // 覆盖式单槽实现会静默丢掉先注册的监听器，让「只有最后注册者生效」的隐式依赖漏过测试
  const serverChangeListeners = new Set<(serverId: string, reason?: string) => void>()
  // serverStore.getServer 的注册表：collectActiveServerIds 过滤未注册 id 的判定源
  const registeredServerIds = new Set(['local'])
  const serverStoreListeners = new Set<() => void>()
  // 多服务器订阅白名单：可控开关 + 白名单集合，模拟 WSL 就绪注册时序
  const multiServerMock = { enabled: false, subscribedIds: [] as string[] }
  const multiServerListeners = new Set<() => void>()
  // paneLayoutStore.allLeaves 的可控数据源：测试可注入特定 pane 会话
  const paneLeavesMock: { current: Array<{ sessionId?: string }> } = { current: [] }
  return {
  subscribeToEventsMock: vi.fn(),
  getSessionStatusMock: vi.fn<(directory?: string) => Promise<Record<string, { type: string }>>>(() => Promise.resolve({})),
  getPendingPermissionsMock: vi.fn(() =>
    Promise.resolve([] as Array<{ id: string; sessionID: string; permission: string; patterns?: string[] }>),
  ),
  getPendingQuestionsMock: vi.fn(() => Promise.resolve([])),
  replyPermissionMock: vi.fn(() => Promise.resolve()),
  childBelongsToSessionMock: vi.fn<(sessionId: string, rootSessionId: string) => boolean>(() => false),
  getFocusedSessionIdMock: vi.fn<() => string | null>(() => null),
  getSessionAndDescendantsMock: vi.fn((sessionId: string) => [sessionId]),
  notificationPushMock: vi.fn(),
  playNotificationSoundDedupedMock: vi.fn(),
  isSystemEnabledMock: vi.fn((type: string) => type !== 'permission'),
  applyServerConnectedTimestampMock: vi.fn(),
  getActiveServerIdMock: vi.fn(() => 'local'),
  checkHealthMock: vi.fn(() => Promise.resolve({ status: 'online' })),
  onServerChangeMock: vi.fn((listener: (serverId: string, reason?: string) => void) => {
    serverChangeListeners.add(listener)
    return () => {
      serverChangeListeners.delete(listener)
    }
  }),
  serverChangeListeners,
  registeredServerIds,
  serverStoreListeners,
  multiServerMock,
  multiServerListeners,
  paneLeavesMock,
  clearSessionRuntimeStateMock: vi.fn(),
  clearPaneSessionMock: vi.fn(),
  getSoundSnapshotMock: vi.fn(() => ({
    currentSessionEnabled: true,
  })),
  activeSessionStoreMock: {
    initialize: vi.fn(),
    initializePendingRequests: vi.fn(),
    mergeStatusRefresh: vi.fn(),
    mergePendingRequests: vi.fn(),
    setSessionMetaBulk: vi.fn(),
    setSessionMeta: vi.fn(),
    getSessionMeta: vi.fn((sessionId?: string) => ({ title: sessionId || 'Child Session', directory: '/workspace' })),
    addPendingRequest: vi.fn(),
    resolvePendingRequest: vi.fn(),
    updateStatus: vi.fn(),
    getSnapshot: vi.fn(() => ({ statusMap: {} })),
  },
  autoApproveStoreMock: {
    fullAutoMode: 'off' as 'off' | 'session' | 'global',
    approvePendingOnFullAuto: false,
    subscribe: vi.fn((_listener: () => void) => vi.fn()),
    getPaneFullAutoMode: vi.fn((_paneId: string) => 'off' as 'off' | 'session' | 'global'),
    claimAutoReply: vi.fn((_requestId: string) => true),
    releaseAutoReply: vi.fn((_requestId: string) => undefined),
  },
  }
})

vi.mock('../api', () => ({
  subscribeToEvents: subscribeToEventsMock,
  // 透传 serverId 作为第二参数：测试需要区分「哪个服务器建了订阅」
  subscribeToServerEvents: (serverId: string, cb: unknown) => subscribeToEventsMock(cb, serverId),
  getSessionStatus: getSessionStatusMock,
  getPendingPermissions: getPendingPermissionsMock,
  getPendingQuestions: getPendingQuestionsMock,
}))

vi.mock('../store/multiServerStore', () => ({
  multiServerStore: {
    isEnabled: () => multiServerMock.enabled,
    getSubscribedServerIds: () => multiServerMock.subscribedIds,
    subscribe: (listener: () => void) => {
      multiServerListeners.add(listener)
      return () => {
        multiServerListeners.delete(listener)
      }
    },
  },
}))

vi.mock('../api/permission', () => ({
  replyPermission: replyPermissionMock,
}))

vi.mock('../store', () => ({
  messageStore: {
    handleMessageUpdated: vi.fn(),
    handlePartUpdated: vi.fn(),
    handlePartDelta: vi.fn(),
    handlePartRemoved: vi.fn(),
    handleSessionIdle: vi.fn(),
    handleSessionError: vi.fn(),
    getSessionState: vi.fn(() => null),
    updateSessionMetadata: vi.fn(),
  },
  childSessionStore: {
    belongsToSession: childBelongsToSessionMock,
    getSessionAndDescendants: getSessionAndDescendantsMock,
    markIdle: vi.fn(),
    markError: vi.fn(),
    registerChildSession: vi.fn(),
  },
  paneLayoutStore: {
    getFocusedSessionId: getFocusedSessionIdMock,
    clearSession: clearPaneSessionMock,
    allLeaves: () => paneLeavesMock.current,
    subscribe: () => () => {},
  },
  serverStore: {
    applyServerConnectedTimestamp: applyServerConnectedTimestampMock,
    getActiveServerId: getActiveServerIdMock,
    checkHealth: checkHealthMock,
    onServerChange: onServerChangeMock,
    // collectActiveServerIds 会过滤未注册服务器：mock 只认 local 与显式注册的 id
    getServer: (id: string) => (registeredServerIds.has(id) ? { id } : null),
    subscribe: (listener: () => void) => {
      serverStoreListeners.add(listener)
      return () => {
        serverStoreListeners.delete(listener)
      }
    },
  },
}))

vi.mock('../store/activeSessionStore', () => ({
  activeSessionStore: activeSessionStoreMock,
}))

vi.mock('../store/notificationStore', () => ({
  notificationStore: {
    push: notificationPushMock,
  },
}))

vi.mock('../store/soundStore', () => ({
  soundStore: {
    getSnapshot: () => getSoundSnapshotMock(),
  },
}))

vi.mock('../store/notificationEventSettingsStore', () => ({
  notificationEventSettingsStore: {
    isSystemEnabled: (type: 'completed' | 'permission' | 'question' | 'error') => isSystemEnabledMock(type),
  },
}))

vi.mock('../utils/notificationSoundBridge', () => ({
  playNotificationSoundDeduped: playNotificationSoundDedupedMock,
}))

vi.mock('../utils/sessionLifecycle', () => ({
  clearSessionRuntimeState: (...args: unknown[]) => clearSessionRuntimeStateMock(...args),
}))

vi.mock('../store/autoApproveStore', () => ({
  autoApproveStore: autoApproveStoreMock,
}))

describe('useGlobalEvents', () => {
  beforeEach(() => {
    subscribeToEventsMock.mockReset()
    getSessionStatusMock.mockClear()
    getPendingPermissionsMock.mockClear()
    getPendingQuestionsMock.mockClear()
    replyPermissionMock.mockClear()
    childBelongsToSessionMock.mockReset()
    getFocusedSessionIdMock.mockReset()
    getSessionAndDescendantsMock.mockReset()
    notificationPushMock.mockReset()
    playNotificationSoundDedupedMock.mockReset()
    getSoundSnapshotMock.mockReset()
    isSystemEnabledMock.mockReset()
    applyServerConnectedTimestampMock.mockReset()
    getActiveServerIdMock.mockReset()
    checkHealthMock.mockReset()
    onServerChangeMock.mockReset()
    clearSessionRuntimeStateMock.mockReset()
    clearPaneSessionMock.mockReset()
    autoApproveStoreMock.fullAutoMode = 'off'
    autoApproveStoreMock.approvePendingOnFullAuto = false
    autoApproveStoreMock.subscribe.mockReset()
    autoApproveStoreMock.getPaneFullAutoMode.mockReset()
    autoApproveStoreMock.claimAutoReply.mockReset()
    autoApproveStoreMock.releaseAutoReply.mockReset()
    Object.values(activeSessionStoreMock).forEach(value => {
      if (typeof value === 'function' && 'mockClear' in value) value.mockClear()
    })

    subscribeToEventsMock.mockImplementation(() => vi.fn())
    getSoundSnapshotMock.mockReturnValue({
      currentSessionEnabled: true,
    })
    isSystemEnabledMock.mockImplementation((type: string) => type !== 'permission')
    getActiveServerIdMock.mockReturnValue('local')
    checkHealthMock.mockResolvedValue({ status: 'online' })
    serverChangeListeners.clear()
    registeredServerIds.clear()
    registeredServerIds.add('local')
    serverStoreListeners.clear()
    multiServerMock.enabled = false
    multiServerMock.subscribedIds = []
    multiServerListeners.clear()
    paneLeavesMock.current = []
    onServerChangeMock.mockImplementation(listener => {
      serverChangeListeners.add(listener)
      return () => {
        serverChangeListeners.delete(listener)
      }
    })
    getSessionAndDescendantsMock.mockImplementation((sessionId: string) => [sessionId])
    autoApproveStoreMock.subscribe.mockReturnValue(vi.fn())
    autoApproveStoreMock.getPaneFullAutoMode.mockReturnValue('off')
    autoApproveStoreMock.claimAutoReply.mockReturnValue(true)
    activeSessionStoreMock.getSessionMeta.mockReturnValue({ title: 'Child Session', directory: '/workspace' })
    activeSessionStoreMock.getSnapshot.mockReturnValue({ statusMap: {} })
  })

  it('stores server clock calibration when server.connected arrives', async () => {
    let callbacks: Parameters<typeof subscribeToEventsMock>[0] | undefined
    subscribeToEventsMock.mockImplementation(cb => {
      callbacks = cb
      return vi.fn()
    })

    renderHook(() => useGlobalEvents())

    await waitFor(() => expect(callbacks).toBeDefined())

    callbacks!.onServerConnected?.({ timestamp: '2026-04-22T15:00:00.000Z' })

    expect(applyServerConnectedTimestampMock).toHaveBeenCalledWith('local', '2026-04-22T15:00:00.000Z')
  })

  it('refreshes active server health on mount', async () => {
    renderHook(() => useGlobalEvents())

    await waitFor(() => expect(checkHealthMock).toHaveBeenCalledWith('local'))
  })

  it('refreshes health for the selected server when active server changes', async () => {
    renderHook(() => useGlobalEvents())

    await waitFor(() => expect(onServerChangeMock).toHaveBeenCalled())
    checkHealthMock.mockClear()

    // 多播广播：effect 里注册的每个监听器（健康检查、runtime 重连等）都会收到信号
    serverChangeListeners.forEach(listener => listener('remote'))

    expect(checkHealthMock).toHaveBeenCalledWith('remote')
  })

  it('refreshes active server health when SSE reconnects', async () => {
    let callbacks: Parameters<typeof subscribeToEventsMock>[0] | undefined
    subscribeToEventsMock.mockImplementation(cb => {
      callbacks = cb
      return vi.fn()
    })

    renderHook(() => useGlobalEvents())

    await waitFor(() => expect(callbacks).toBeDefined())
    checkHealthMock.mockClear()

    callbacks!.onReconnected?.('network')

    expect(checkHealthMock).toHaveBeenCalledWith('local')
  })

  it('clears runtime state and panes when a session is deleted', async () => {
    let callbacks: Parameters<typeof subscribeToEventsMock>[0] | undefined
    subscribeToEventsMock.mockImplementation(cb => {
      callbacks = cb
      return vi.fn()
    })
    getSessionAndDescendantsMock.mockReturnValue(['local::deleted-session', 'local::child-session'])

    renderHook(() => useGlobalEvents())

    await waitFor(() => expect(callbacks).toBeDefined())

    callbacks!.onSessionDeleted?.('deleted-session')

    expect(clearSessionRuntimeStateMock).toHaveBeenCalledWith('local::deleted-session')
    expect(clearPaneSessionMock).toHaveBeenCalledWith('local::deleted-session')
    expect(clearPaneSessionMock).toHaveBeenCalledWith('local::child-session')
  })

  it('ignores stale initialization responses after directories change', async () => {
    const statusDeferreds = new Map<string, ReturnType<typeof createDeferred<Record<string, { type: string }>>>>()
    getPendingPermissionsMock.mockResolvedValue([])
    getPendingQuestionsMock.mockResolvedValue([])
    getSessionStatusMock.mockImplementation(directory => {
      const key = directory || 'root'
      const deferred = createDeferred<Record<string, { type: string }>>()
      statusDeferreds.set(key, deferred)
      return deferred.promise
    })

    const { rerender } = renderHook(({ directories }) => useGlobalEvents(directories), {
      initialProps: { directories: ['/one'] as string[] | undefined },
    })

    await waitFor(() => expect(getSessionStatusMock).toHaveBeenCalledWith('/one', 'local'))

    rerender({ directories: ['/two'] })

    await waitFor(() => expect(getSessionStatusMock).toHaveBeenCalledWith('/two', 'local'))

    statusDeferreds.get('/two')?.resolve({ 'new-session': { type: 'busy' } })

    await waitFor(() => {
      expect(activeSessionStoreMock.mergeStatusRefresh).toHaveBeenCalledTimes(1)
      expect(activeSessionStoreMock.mergeStatusRefresh).toHaveBeenCalledWith({ 'local::new-session': { type: 'busy' } })
    })

    statusDeferreds.get('/one')?.resolve({ 'old-session': { type: 'idle' } })
    await Promise.resolve()
    await Promise.resolve()

    expect(activeSessionStoreMock.mergeStatusRefresh).toHaveBeenCalledTimes(1)
    expect(activeSessionStoreMock.mergeStatusRefresh).not.toHaveBeenCalledWith({ 'local::old-session': { type: 'idle' } })
  })

  it('replays pending requests that arrive while initialization is in flight', async () => {
    let callbacks: Parameters<typeof subscribeToEventsMock>[0] | undefined
    const statusDeferred = createDeferred<Record<string, { type: string }>>()

    subscribeToEventsMock.mockImplementation(cb => {
      callbacks = cb
      return vi.fn()
    })
    getSessionStatusMock.mockImplementation(() => statusDeferred.promise)
    getPendingPermissionsMock.mockResolvedValue([])
    getPendingQuestionsMock.mockResolvedValue([])

    renderHook(() => useGlobalEvents(['/workspace']))

    await waitFor(() => expect(getSessionStatusMock).toHaveBeenCalledWith('/workspace', 'local'))
    await waitFor(() => expect(callbacks).toBeDefined())

    callbacks!.onPermissionAsked?.({
      id: 'perm-1',
      sessionID: 'child-session',
      permission: 'edit',
      patterns: ['src/app.tsx'],
    } as never)

    statusDeferred.resolve({})

    await waitFor(() => expect(activeSessionStoreMock.initializePendingRequests).toHaveBeenCalled())

    expect(activeSessionStoreMock.addPendingRequest).toHaveBeenNthCalledWith(
      1,
      'perm-1',
      'local::child-session',
      'permission',
      'edit: src/app.tsx',
    )
    expect(activeSessionStoreMock.addPendingRequest).toHaveBeenNthCalledWith(
      2,
      'perm-1',
      'local::child-session',
      'permission',
      'edit: src/app.tsx',
    )
  })

  it('keeps replaying pending requests across overlapping initialization fetches', async () => {
    let callbacks: Parameters<typeof subscribeToEventsMock>[0] | undefined
    const statusDeferreds = new Map<string, ReturnType<typeof createDeferred<Record<string, { type: string }>>>>()

    subscribeToEventsMock.mockImplementation(cb => {
      callbacks = cb
      return vi.fn()
    })
    activeSessionStoreMock.getSessionMeta.mockImplementation((sessionId?: string) => {
      if (sessionId === 'local::child-session') return { title: 'Child Session', directory: '/one' }
      if (sessionId === 'local::question-session') return { title: 'Question Session', directory: '/two' }
      return { title: 'Session', directory: '/workspace' }
    })
    getSessionStatusMock.mockImplementation(directory => {
      const key = directory || 'root'
      const deferred = createDeferred<Record<string, { type: string }>>()
      statusDeferreds.set(key, deferred)
      return deferred.promise
    })
    getPendingPermissionsMock.mockResolvedValue([])
    getPendingQuestionsMock.mockResolvedValue([])

    const { rerender } = renderHook(({ directories }) => useGlobalEvents(directories), {
      initialProps: { directories: ['/one'] as string[] | undefined },
    })

    await waitFor(() => expect(getSessionStatusMock).toHaveBeenCalledWith('/one', 'local'))
    await waitFor(() => expect(callbacks).toBeDefined())

    callbacks!.onPermissionAsked?.({
      id: 'perm-1',
      sessionID: 'child-session',
      permission: 'edit',
      patterns: ['src/app.tsx'],
    } as never)

    rerender({ directories: ['/two'] })

    await waitFor(() => expect(getSessionStatusMock).toHaveBeenCalledWith('/two', 'local'))

    callbacks!.onQuestionAsked?.({
      id: 'question-1',
      sessionID: 'question-session',
      questions: [{ header: 'Need input' }],
    } as never)

    statusDeferreds.get('/two')?.resolve({})

    await waitFor(() => expect(activeSessionStoreMock.mergePendingRequests).toHaveBeenCalledTimes(1))

    expect(activeSessionStoreMock.addPendingRequest.mock.calls.filter(call => call[0] === 'perm-1')).toHaveLength(1)
    expect(activeSessionStoreMock.addPendingRequest.mock.calls.filter(call => call[0] === 'question-1')).toHaveLength(2)
  })

  it('does not play current-session sound for child session events when parent session is focused', async () => {
    let callbacks: Parameters<typeof subscribeToEventsMock>[0] | undefined
    subscribeToEventsMock.mockImplementation(cb => {
      callbacks = cb
      return vi.fn()
    })
    getFocusedSessionIdMock.mockReturnValue('local::parent-session')
    childBelongsToSessionMock.mockImplementation((sessionId: string, rootSessionId: string) => {
      return sessionId === 'local::child-session' && rootSessionId === 'local::parent-session'
    })

    renderHook(() => useGlobalEvents())

    await waitFor(() => expect(callbacks).toBeDefined())

    callbacks!.onPermissionAsked?.({
      id: 'perm-1',
      sessionID: 'child-session',
      permission: 'bash',
      patterns: [],
    })

    expect(notificationPushMock).not.toHaveBeenCalled()
    expect(playNotificationSoundDedupedMock).not.toHaveBeenCalled()
  })

  it('keeps later pending question requests for the same session after one reply arrives', async () => {
    let callbacks: Parameters<typeof subscribeToEventsMock>[0] | undefined
    const consumerAskedMock = vi.fn()
    subscribeToEventsMock.mockImplementation(cb => {
      callbacks = cb
      return vi.fn()
    })

    renderHook(() => useGlobalEvents())

    await waitFor(() => expect(callbacks).toBeDefined())

    callbacks!.onQuestionAsked?.({
      id: 'question-1',
      sessionID: 'child-session',
      questions: [{ header: 'First question' }],
    })
    callbacks!.onQuestionAsked?.({
      id: 'question-2',
      sessionID: 'child-session',
      questions: [{ header: 'Second question' }],
    })

    expect(consumerAskedMock).not.toHaveBeenCalled()

    callbacks!.onQuestionReplied?.({
      sessionID: 'child-session',
      requestID: 'question-1',
    })

    getFocusedSessionIdMock.mockReturnValue('local::parent-session')
    childBelongsToSessionMock.mockImplementation((sessionId: string, rootSessionId: string) => {
      return sessionId === 'local::child-session' && rootSessionId === 'local::parent-session'
    })

    const unregister = registerSessionConsumer('pane-1', 'local::parent-session', {
      onQuestionAsked: consumerAskedMock,
    })

    callbacks!.onSessionCreated?.({
      id: 'child-session',
      parentID: 'parent-session',
      title: 'Child Session',
      directory: '/workspace',
    } as never)

    expect(consumerAskedMock).toHaveBeenCalledTimes(1)
    expect(consumerAskedMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'question-2', sessionID: 'local::child-session' }),
    )

    unregister()
  })

  it('approves already waiting permissions when global full auto pending sweep is enabled', async () => {
    const consumerRepliedMock = vi.fn()
    const unregister = registerSessionConsumer('pane-global', 'local::background-session', {
      onPermissionReplied: consumerRepliedMock,
    })
    autoApproveStoreMock.fullAutoMode = 'global'
    autoApproveStoreMock.approvePendingOnFullAuto = true
    getPendingPermissionsMock.mockResolvedValue([
      {
        id: 'perm-global',
        sessionID: 'background-session',
        permission: 'bash',
        patterns: ['npm test'],
      },
    ])
    activeSessionStoreMock.getSessionMeta.mockReturnValue({ title: 'Background', directory: '/workspace' })

    renderHook(() => useGlobalEvents(['/workspace']))

    await waitFor(() => {
      expect(replyPermissionMock).toHaveBeenCalledWith(
        'perm-global',
        'once',
        undefined,
        '/workspace',
        'background-session',
        'local',
      )
    })
    expect(autoApproveStoreMock.claimAutoReply).toHaveBeenCalledWith('perm-global')
    await waitFor(() => {
      expect(consumerRepliedMock).toHaveBeenCalledWith({ sessionID: 'local::background-session', requestID: 'perm-global' })
    })
    expect(activeSessionStoreMock.resolvePendingRequest).toHaveBeenCalledWith('perm-global')

    unregister()
  })

  it('broadcasts permission replied events to consumers even when the current session does not match', async () => {
    const consumerRepliedMock = vi.fn()
    const unregister = registerSessionConsumer('pane-mismatch', 'local::other-session', {
      onPermissionReplied: consumerRepliedMock,
    })
    autoApproveStoreMock.fullAutoMode = 'global'
    autoApproveStoreMock.approvePendingOnFullAuto = true
    getPendingPermissionsMock.mockResolvedValue([
      {
        id: 'perm-mismatch',
        sessionID: 'background-session',
        permission: 'bash',
        patterns: ['npm test'],
      },
    ])
    activeSessionStoreMock.getSessionMeta.mockReturnValue({ title: 'Background', directory: '/workspace' })

    renderHook(() => useGlobalEvents(['/workspace']))

    await waitFor(() => {
      expect(replyPermissionMock).toHaveBeenCalledWith(
        'perm-mismatch',
        'once',
        undefined,
        '/workspace',
        'background-session',
        'local',
      )
    })
    await waitFor(() => {
      expect(consumerRepliedMock).toHaveBeenCalledWith({ sessionID: 'local::background-session', requestID: 'perm-mismatch' })
    })

    unregister()
  })

  it('does not approve already waiting permissions when the pending sweep is disabled', async () => {
    autoApproveStoreMock.fullAutoMode = 'global'
    autoApproveStoreMock.approvePendingOnFullAuto = false
    getPendingPermissionsMock.mockResolvedValue([
      {
        id: 'perm-global',
        sessionID: 'background-session',
        permission: 'bash',
        patterns: ['npm test'],
      },
    ])

    renderHook(() => useGlobalEvents(['/workspace']))

    await waitFor(() => expect(getPendingPermissionsMock).toHaveBeenCalled())
    expect(replyPermissionMock).not.toHaveBeenCalled()
  })

  it('still plays current-session sound for the directly focused session', async () => {
    let callbacks: Parameters<typeof subscribeToEventsMock>[0] | undefined
    subscribeToEventsMock.mockImplementation(cb => {
      callbacks = cb
      return vi.fn()
    })
    getFocusedSessionIdMock.mockReturnValue('local::child-session')

    renderHook(() => useGlobalEvents())

    await waitFor(() => expect(callbacks).toBeDefined())

    callbacks!.onPermissionAsked?.({
      id: 'perm-2',
      sessionID: 'child-session',
      permission: 'bash',
      patterns: [],
    })

    expect(notificationPushMock).not.toHaveBeenCalled()
    expect(playNotificationSoundDedupedMock).toHaveBeenCalledWith('permission')
  })

  it('still plays current-session sound when the matching system notification toggle is disabled', async () => {
    let callbacks: Parameters<typeof subscribeToEventsMock>[0] | undefined
    subscribeToEventsMock.mockImplementation(cb => {
      callbacks = cb
      return vi.fn()
    })
    getFocusedSessionIdMock.mockReturnValue('local::child-session')
    isSystemEnabledMock.mockImplementation(type => type !== 'permission')

    renderHook(() => useGlobalEvents())

    await waitFor(() => expect(callbacks).toBeDefined())

    callbacks!.onPermissionAsked?.({
      id: 'perm-sound',
      sessionID: 'child-session',
      permission: 'bash',
      patterns: [],
    })

    expect(notificationPushMock).not.toHaveBeenCalled()
    expect(playNotificationSoundDedupedMock).toHaveBeenCalledWith('permission')
  })

  it('does not play permission sound for a session full-auto pane', async () => {
    let callbacks: Parameters<typeof subscribeToEventsMock>[0] | undefined
    subscribeToEventsMock.mockImplementation(cb => {
      callbacks = cb
      return vi.fn()
    })
    getFocusedSessionIdMock.mockReturnValue('local::child-session')
    autoApproveStoreMock.getPaneFullAutoMode.mockImplementation(paneId => (paneId === 'test-pane' ? 'session' : 'off'))
    const unregister = registerSessionConsumer('test-pane', 'local::child-session', {})

    renderHook(() => useGlobalEvents())

    await waitFor(() => expect(callbacks).toBeDefined())

    callbacks!.onPermissionAsked?.({
      id: 'perm-session-auto',
      sessionID: 'child-session',
      permission: 'bash',
      patterns: [],
    })

    expect(notificationPushMock).not.toHaveBeenCalled()
    expect(playNotificationSoundDedupedMock).not.toHaveBeenCalled()

    unregister()
  })

  it('does not play permission sound for a child session of a session full-auto pane', async () => {
    let callbacks: Parameters<typeof subscribeToEventsMock>[0] | undefined
    subscribeToEventsMock.mockImplementation(cb => {
      callbacks = cb
      return vi.fn()
    })
    childBelongsToSessionMock.mockImplementation((sessionId, rootSessionId) => {
      return sessionId === 'local::child-session' && rootSessionId === 'local::parent-session'
    })
    getFocusedSessionIdMock.mockReturnValue('local::child-session')
    autoApproveStoreMock.getPaneFullAutoMode.mockImplementation(paneId => (paneId === 'test-pane' ? 'session' : 'off'))
    const unregister = registerSessionConsumer('test-pane', 'local::parent-session', {})

    renderHook(() => useGlobalEvents())

    await waitFor(() => expect(callbacks).toBeDefined())

    callbacks!.onPermissionAsked?.({
      id: 'perm-child-session-auto',
      sessionID: 'child-session',
      permission: 'bash',
      patterns: [],
    })

    expect(notificationPushMock).not.toHaveBeenCalled()
    expect(playNotificationSoundDedupedMock).not.toHaveBeenCalled()

    unregister()
  })

  it('still plays permission sound for another pane without session full auto', async () => {
    let callbacks: Parameters<typeof subscribeToEventsMock>[0] | undefined
    subscribeToEventsMock.mockImplementation(cb => {
      callbacks = cb
      return vi.fn()
    })
    getFocusedSessionIdMock.mockReturnValue('local::other-session')
    autoApproveStoreMock.getPaneFullAutoMode.mockImplementation(paneId => (paneId === 'auto-pane' ? 'session' : 'off'))
    const unregisterAutoPane = registerSessionConsumer('auto-pane', 'local::auto-session', {})
    const unregisterOtherPane = registerSessionConsumer('other-pane', 'local::other-session', {})

    renderHook(() => useGlobalEvents())

    await waitFor(() => expect(callbacks).toBeDefined())

    callbacks!.onPermissionAsked?.({
      id: 'perm-other-pane',
      sessionID: 'other-session',
      permission: 'bash',
      patterns: [],
    })

    expect(notificationPushMock).not.toHaveBeenCalled()
    expect(playNotificationSoundDedupedMock).toHaveBeenCalledWith('permission')

    unregisterAutoPane()
    unregisterOtherPane()
  })

  it.each([
    {
      disabledType: 'permission',
      trigger: 'onPermissionAsked',
      payload: { id: 'perm-3', sessionID: 'background-session', permission: 'bash', patterns: [] },
    },
    {
      disabledType: 'question',
      trigger: 'onQuestionAsked',
      payload: {
        id: 'question-3',
        sessionID: 'background-session',
        questions: [{ header: 'Need input' }],
      },
    },
    {
      disabledType: 'completed',
      trigger: 'onSessionStatus',
      beforeTrigger: () => {
        activeSessionStoreMock.getSnapshot.mockReturnValue({ statusMap: { 'local::background-session': { type: 'busy' } } })
      },
      payload: { sessionID: 'background-session', status: { type: 'idle' } },
    },
    {
      disabledType: 'error',
      trigger: 'onSessionError',
      payload: { sessionID: 'background-session', name: 'Error' },
    },
  ])(
    'keeps background notifications working when the $disabledType system notification toggle is disabled',
    async ({ disabledType, trigger, payload, beforeTrigger }) => {
      let callbacks: Parameters<typeof subscribeToEventsMock>[0] | undefined
      subscribeToEventsMock.mockImplementation(cb => {
        callbacks = cb
        return vi.fn()
      })
      isSystemEnabledMock.mockImplementation(type => type !== disabledType)
      beforeTrigger?.()

      renderHook(() => useGlobalEvents())

      await waitFor(() => expect(callbacks).toBeDefined())

      callbacks![trigger as keyof typeof callbacks]?.(payload as never)

      expect(notificationPushMock).toHaveBeenCalledTimes(1)
      expect(playNotificationSoundDedupedMock).not.toHaveBeenCalled()
    },
  )

  it('does not subscribe unregistered whitelist servers and attaches them incrementally on registration', async () => {
    // 启动竞态：WSL 白名单 id 在 sidecar 就绪前就存在于持久化配置。
    // 未注册时不得订阅（getServerBaseUrl 会回退 local → 数据串服）；
    // 注册进 serverStore 后由 notify 触发增量接入，且不重连已有服务器
    multiServerMock.enabled = true
    multiServerMock.subscribedIds = ['local', 'wsl:Ubuntu']
    const unsubscribes: Record<string, Array<() => void>> = { local: [], 'wsl:Ubuntu': [] }
    subscribeToEventsMock.mockImplementation((_cb, serverId: string) => {
      const off = vi.fn()
      unsubscribes[serverId].push(off)
      return off
    })

    renderHook(() => useGlobalEvents())

    await waitFor(() => expect(subscribeToEventsMock).toHaveBeenCalledTimes(1))
    expect(subscribeToEventsMock.mock.calls[0][1]).toBe('local')

    // WSL 就绪注册：入注册表 + notify → 集合重算 → 只新增 wsl 订阅，local 连接不动
    registeredServerIds.add('wsl:Ubuntu')
    act(() => {
      multiServerListeners.forEach(listener => listener())
      serverStoreListeners.forEach(listener => listener())
    })

    await waitFor(() => expect(subscribeToEventsMock).toHaveBeenCalledTimes(2))
    expect(subscribeToEventsMock.mock.calls[1][1]).toBe('wsl:Ubuntu')
    expect(unsubscribes.local[0]).not.toHaveBeenCalled()
  })

  it('rebuilds only the changed server subscription on server-runtime-updated', async () => {
    // sidecar 重启换端口：定向拆旧建新，其余服务器的 SSE 不受牵连
    multiServerMock.enabled = true
    multiServerMock.subscribedIds = ['local', 'wsl:Ubuntu']
    registeredServerIds.add('wsl:Ubuntu')
    const unsubscribes: Record<string, Array<() => void>> = { local: [], 'wsl:Ubuntu': [] }
    subscribeToEventsMock.mockImplementation((_cb, serverId: string) => {
      const off = vi.fn()
      unsubscribes[serverId].push(off)
      return off
    })

    renderHook(() => useGlobalEvents())

    await waitFor(() => expect(unsubscribes['wsl:Ubuntu']).toHaveLength(1))
    checkHealthMock.mockClear()

    serverChangeListeners.forEach(listener => listener('wsl:Ubuntu', 'server-runtime-updated'))

    await waitFor(() => expect(unsubscribes['wsl:Ubuntu']).toHaveLength(2))
    expect(unsubscribes['wsl:Ubuntu'][0]).toHaveBeenCalledTimes(1)
    expect(unsubscribes.local).toHaveLength(1)
    expect(unsubscribes.local[0]).not.toHaveBeenCalled()
  })

  it('backfills the active server when filtering leaves an empty set', async () => {
    // F1 回归：pane 仍指向已失效的服务器（sidecar 崩溃后未清理），
    // 单服务器模式下过滤后集合为空——必须兜底回退 active server，
    // 否则全应用一条 SSE 都没有（聊天静默）
    paneLeavesMock.current = [{ sessionId: 'wsl:Ubuntu::ses-1' }]
    const unsubscribes: string[] = []
    subscribeToEventsMock.mockImplementation((_cb, serverId: string) => {
      unsubscribes.push(serverId)
      return vi.fn()
    })

    renderHook(() => useGlobalEvents())

    await waitFor(() => expect(subscribeToEventsMock).toHaveBeenCalledTimes(1))
    expect(unsubscribes).toEqual(['local'])
  })
})
