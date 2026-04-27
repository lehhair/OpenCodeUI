import { renderHook, waitFor } from '@testing-library/react'
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
  notificationPushMock,
  playNotificationSoundDedupedMock,
  getSoundSnapshotMock,
  isSystemEnabledMock,
  activeSessionStoreMock,
  applyServerConnectedTimestampMock,
  getActiveServerIdMock,
} = vi.hoisted(() => ({
  subscribeToEventsMock: vi.fn(),
  getSessionStatusMock: vi.fn<(directory?: string) => Promise<Record<string, { type: string }>>>(() => Promise.resolve({})),
  getPendingPermissionsMock: vi.fn(() => Promise.resolve([])),
  getPendingQuestionsMock: vi.fn(() => Promise.resolve([])),
  replyPermissionMock: vi.fn(() => Promise.resolve()),
  childBelongsToSessionMock: vi.fn<(sessionId: string, rootSessionId: string) => boolean>(() => false),
  getFocusedSessionIdMock: vi.fn<() => string | null>(() => null),
  notificationPushMock: vi.fn(),
  playNotificationSoundDedupedMock: vi.fn(),
  isSystemEnabledMock: vi.fn((type: string) => type !== 'permission'),
  applyServerConnectedTimestampMock: vi.fn(),
  getActiveServerIdMock: vi.fn(() => 'local'),
  getSoundSnapshotMock: vi.fn(() => ({
    currentSessionEnabled: true,
  })),
  activeSessionStoreMock: {
    initialize: vi.fn(),
    initializePendingRequests: vi.fn(),
    setSessionMetaBulk: vi.fn(),
    setSessionMeta: vi.fn(),
    getSessionMeta: vi.fn(() => ({ title: 'Child Session', directory: '/workspace' })),
    addPendingRequest: vi.fn(),
    resolvePendingRequest: vi.fn(),
    updateStatus: vi.fn(),
    getSnapshot: vi.fn(() => ({ statusMap: {} })),
  },
}))

vi.mock('../api', () => ({
  subscribeToEvents: subscribeToEventsMock,
  getSessionStatus: getSessionStatusMock,
  getPendingPermissions: getPendingPermissionsMock,
  getPendingQuestions: getPendingQuestionsMock,
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
    markIdle: vi.fn(),
    markError: vi.fn(),
    registerChildSession: vi.fn(),
  },
  paneLayoutStore: {
    getFocusedSessionId: getFocusedSessionIdMock,
  },
  serverStore: {
    applyServerConnectedTimestamp: applyServerConnectedTimestampMock,
    getActiveServerId: getActiveServerIdMock,
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

vi.mock('../store/autoApproveStore', () => ({
  autoApproveStore: {
    fullAutoMode: 'off',
  },
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
    notificationPushMock.mockReset()
    playNotificationSoundDedupedMock.mockReset()
    getSoundSnapshotMock.mockReset()
    isSystemEnabledMock.mockReset()
    applyServerConnectedTimestampMock.mockReset()
    getActiveServerIdMock.mockReset()
    Object.values(activeSessionStoreMock).forEach(value => {
      if (typeof value === 'function' && 'mockClear' in value) value.mockClear()
    })

    subscribeToEventsMock.mockImplementation(() => vi.fn())
    getSoundSnapshotMock.mockReturnValue({
      currentSessionEnabled: true,
    })
    isSystemEnabledMock.mockImplementation((type: string) => type !== 'permission')
    getActiveServerIdMock.mockReturnValue('local')
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

    await waitFor(() => expect(getSessionStatusMock).toHaveBeenCalledWith('/one'))

    rerender({ directories: ['/two'] })

    await waitFor(() => expect(getSessionStatusMock).toHaveBeenCalledWith('/two'))

    statusDeferreds.get('/two')?.resolve({ 'new-session': { type: 'busy' } })

    await waitFor(() => {
      expect(activeSessionStoreMock.initialize).toHaveBeenCalledTimes(1)
      expect(activeSessionStoreMock.initialize).toHaveBeenCalledWith({ 'new-session': { type: 'busy' } })
    })

    statusDeferreds.get('/one')?.resolve({ 'old-session': { type: 'idle' } })
    await Promise.resolve()
    await Promise.resolve()

    expect(activeSessionStoreMock.initialize).toHaveBeenCalledTimes(1)
    expect(activeSessionStoreMock.initialize).not.toHaveBeenCalledWith({ 'old-session': { type: 'idle' } })
  })

  it('does not play current-session sound for child session events when parent session is focused', async () => {
    let callbacks: Parameters<typeof subscribeToEventsMock>[0] | undefined
    subscribeToEventsMock.mockImplementation(cb => {
      callbacks = cb
      return vi.fn()
    })
    getFocusedSessionIdMock.mockReturnValue('parent-session')
    childBelongsToSessionMock.mockImplementation((sessionId: string, rootSessionId: string) => {
      return sessionId === 'child-session' && rootSessionId === 'parent-session'
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

    getFocusedSessionIdMock.mockReturnValue('parent-session')
    childBelongsToSessionMock.mockImplementation((sessionId: string, rootSessionId: string) => {
      return sessionId === 'child-session' && rootSessionId === 'parent-session'
    })

    const unregister = registerSessionConsumer('pane-1', 'parent-session', {
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
      expect.objectContaining({ id: 'question-2', sessionID: 'child-session' }),
    )

    unregister()
  })

  it('still plays current-session sound for the directly focused session', async () => {
    let callbacks: Parameters<typeof subscribeToEventsMock>[0] | undefined
    subscribeToEventsMock.mockImplementation(cb => {
      callbacks = cb
      return vi.fn()
    })
    getFocusedSessionIdMock.mockReturnValue('child-session')

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
    getFocusedSessionIdMock.mockReturnValue('child-session')
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
        activeSessionStoreMock.getSnapshot.mockReturnValue({ statusMap: { 'background-session': { type: 'busy' } } })
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
})
