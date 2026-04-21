import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('settingsBackup', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    vi.resetModules()
  })

  it('exports settings as module snapshots', async () => {
    localStorage.setItem('theme-preset', 'claude')
    localStorage.setItem('theme-mode', 'dark')
    localStorage.setItem('opencode-sidebar-expanded', 'false')
    localStorage.setItem('opencode-right-panel-width', '512')
    localStorage.setItem('notifications-enabled', 'true')
    localStorage.setItem('opencode:toast-enabled', 'false')
    localStorage.setItem('srv:local:last-directory', '/workspace/project')
    localStorage.setItem('srv:local:opencode-auto-approve-enabled', 'true')

    const { exportSettingsBackup } = await import('./settingsBackup')
    const { data } = await exportSettingsBackup()
    const backup = JSON.parse(new TextDecoder().decode(data)) as {
      schemaVersion: number
      modules: Record<string, unknown>
    }

    expect(backup.schemaVersion).toBe(2)
    expect((backup.modules.theme as { presetId: string }).presetId).toBe('claude')
    expect((backup.modules.layout as { rightPanelWidth: number }).rightPanelWidth).toBe(512)
    expect((backup.modules.notifications as { browserNotificationsEnabled: boolean }).browserNotificationsEnabled).toBe(
      true,
    )
    expect(
      (backup.modules.perServerStorage as { entries: Record<string, string> }).entries['srv:local:last-directory'],
    ).toBe('/workspace/project')
  })

  it('restores settings from module snapshots', async () => {
    localStorage.setItem('theme-preset', 'claude')
    localStorage.setItem('theme-mode', 'dark')
    localStorage.setItem('opencode-sidebar-expanded', 'false')
    localStorage.setItem('opencode-right-panel-width', '512')
    localStorage.setItem('notifications-enabled', 'true')
    localStorage.setItem('opencode:toast-enabled', 'false')
    localStorage.setItem('srv:local:last-directory', '/workspace/project')
    localStorage.setItem('srv:local:opencode-auto-approve-enabled', 'true')

    const { exportSettingsBackup, importSettingsBackup } = await import('./settingsBackup')
    const { data, fileName } = await exportSettingsBackup()
    const file = new File([new TextDecoder().decode(data)], fileName, { type: 'application/json' })

    localStorage.clear()
    sessionStorage.clear()

    await importSettingsBackup(file)

    expect(localStorage.getItem('theme-preset')).toBe('claude')
    expect(localStorage.getItem('theme-mode')).toBe('dark')
    expect(localStorage.getItem('opencode-sidebar-expanded')).toBe('false')
    expect(localStorage.getItem('opencode-right-panel-width')).toBe('512')
    expect(localStorage.getItem('notifications-enabled')).toBe('true')
    expect(localStorage.getItem('srv:local:last-directory')).toBe('/workspace/project')
    expect(localStorage.getItem('srv:local:opencode-auto-approve-enabled')).toBe('true')
    expect(localStorage.getItem('opencode:toast-enabled')).toBe('false')
    expect(sessionStorage.getItem('opencode-active-server')).toBe('local')
  })
})
