import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NotificationPushListener } from '../store/notificationStore'

const { claimGlobalSideEffectLockedMock, getSoundSnapshotMock, getCustomAudioBlobMock, playSoundMock, onPushMock } =
  vi.hoisted(() => ({
    claimGlobalSideEffectLockedMock: vi.fn(() => Promise.resolve(true)),
    getSoundSnapshotMock: vi.fn(() => ({
      enabled: true,
      volume: 0.5,
      events: {
        permission: { soundId: 'ding' },
        question: { soundId: 'ding' },
        completed: { soundId: 'ding' },
        error: { soundId: 'ding' },
      },
    })),
    getCustomAudioBlobMock: vi.fn(() => null),
    playSoundMock: vi.fn(),
    onPushMock: vi.fn(),
  }))

vi.mock('./globalEventSideEffects', () => ({
  claimGlobalSideEffectLocked: claimGlobalSideEffectLockedMock,
}))

vi.mock('../store/notificationStore', () => ({
  notificationStore: {
    onPush: onPushMock,
  },
}))

vi.mock('../store/soundStore', () => ({
  soundStore: {
    getSnapshot: () => getSoundSnapshotMock(),
    getCustomAudioBlob: getCustomAudioBlobMock,
  },
}))

vi.mock('./soundPlayer', () => ({
  playSound: playSoundMock,
}))

describe('notificationSoundBridge', () => {
  beforeEach(() => {
    claimGlobalSideEffectLockedMock.mockReset()
    getSoundSnapshotMock.mockClear()
    getCustomAudioBlobMock.mockClear()
    playSoundMock.mockReset()
    onPushMock.mockReset()
    claimGlobalSideEffectLockedMock.mockResolvedValue(true)
    getSoundSnapshotMock.mockReturnValue({
      enabled: true,
      volume: 0.5,
      events: {
        permission: { soundId: 'ding' },
        question: { soundId: 'ding' },
        completed: { soundId: 'ding' },
        error: { soundId: 'ding' },
      },
    })
  })

  it('plays notification sound when the push sound key is claimed', async () => {
    const { initNotificationSound } = await import('./notificationSoundBridge')
    let listener: NotificationPushListener | undefined
    onPushMock.mockImplementation(cb => {
      listener = cb
      return vi.fn()
    })

    initNotificationSound()

    listener?.('permission', { soundKey: 'sound:permission:perm-1' })

    await vi.waitFor(() => expect(playSoundMock).toHaveBeenCalled())
    expect(claimGlobalSideEffectLockedMock).toHaveBeenCalledWith('sound:permission:perm-1')
    expect(playSoundMock).toHaveBeenCalledWith({
      soundId: 'ding',
      customAudioData: null,
      volume: 0.5,
    })
  })

  it('skips notification sound when another window already claimed the same sound key', async () => {
    const { initNotificationSound } = await import('./notificationSoundBridge')
    let listener: NotificationPushListener | undefined
    onPushMock.mockImplementation(cb => {
      listener = cb
      return vi.fn()
    })
    claimGlobalSideEffectLockedMock.mockResolvedValue(false)

    initNotificationSound()

    listener?.('permission', { soundKey: 'sound:permission:perm-1' })

    await vi.waitFor(() => expect(claimGlobalSideEffectLockedMock).toHaveBeenCalledWith('sound:permission:perm-1'))
    expect(playSoundMock).not.toHaveBeenCalled()
  })

  it('uses the locked claim for current-session sounds', async () => {
    const { playNotificationSoundClaimed } = await import('./notificationSoundBridge')

    playNotificationSoundClaimed('completed', 'sound:completed:session-1')

    await vi.waitFor(() => expect(playSoundMock).toHaveBeenCalledTimes(1))
    expect(claimGlobalSideEffectLockedMock).toHaveBeenCalledWith('sound:completed:session-1')
  })
})
