import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NotificationPushListener } from '../store/notificationStore'

const { claimGlobalSideEffectMock, getSoundSnapshotMock, getCustomAudioBlobMock, playSoundMock, onPushMock } =
  vi.hoisted(() => ({
    claimGlobalSideEffectMock: vi.fn(() => true),
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
  claimGlobalSideEffect: claimGlobalSideEffectMock,
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
    claimGlobalSideEffectMock.mockReset()
    getSoundSnapshotMock.mockClear()
    getCustomAudioBlobMock.mockClear()
    playSoundMock.mockReset()
    onPushMock.mockReset()
    claimGlobalSideEffectMock.mockReturnValue(true)
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

    expect(claimGlobalSideEffectMock).toHaveBeenCalledWith('sound:permission:perm-1')
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
    claimGlobalSideEffectMock.mockReturnValue(false)

    initNotificationSound()

    listener?.('permission', { soundKey: 'sound:permission:perm-1' })

    expect(claimGlobalSideEffectMock).toHaveBeenCalledWith('sound:permission:perm-1')
    expect(playSoundMock).not.toHaveBeenCalled()
  })
})
