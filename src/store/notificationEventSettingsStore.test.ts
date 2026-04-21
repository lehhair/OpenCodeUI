import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('notificationEventSettingsStore', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  it('persists system notification toggles', async () => {
    const { notificationEventSettingsStore } = await import('./notificationEventSettingsStore')

    notificationEventSettingsStore.setSystemEnabled('completed', false)
    notificationEventSettingsStore.setSystemEnabled('question', false)

    const persisted = JSON.parse(localStorage.getItem('opencode:notification-event-settings') || 'null')
    expect(persisted).toEqual({
      events: {
        completed: { systemEnabled: false },
        permission: { systemEnabled: true },
        question: { systemEnabled: false },
        error: { systemEnabled: true },
      },
    })
  })
})
