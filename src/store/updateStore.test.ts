import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  UpdateStore,
  compareVersions,
  hasUpdateAvailable,
  shouldShowUpdateToast,
  UPDATE_CHANNEL_FROZEN,
  type UpdateState,
} from './updateStore'

function releaseState(overrides: Partial<UpdateState> = {}): UpdateState {
  return {
    currentVersion: '0.5.1',
    latestRelease: {
      version: '0.5.2',
      tagName: 'v0.5.2',
      url: 'https://example.com',
      publishedAt: null,
      name: null,
    },
    lastCheckedAt: Date.now(),
    dismissedVersion: null,
    hiddenToastVersion: null,
    checking: false,
    error: null,
    ...overrides,
  }
}

describe('updateStore helpers', () => {
  it('compares versions with optional v prefix', () => {
    expect(compareVersions('v0.5.2', '0.5.1')).toBeGreaterThan(0)
    expect(compareVersions('0.5.1', 'v0.5.1')).toBe(0)
    expect(compareVersions('0.5', '0.5.1')).toBeLessThan(0)
  })
})

/**
 * v1 终版：更新通道冻结。
 *
 * v1 面向 OpenCode v1 协议，后续版本不再兼容，因此必须停止一切
 * 更新提示，否则会把用户引向无法运行的版本。
 */
describe('frozen update channel (v1 EOL)', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('ships with the channel frozen', () => {
    expect(UPDATE_CHANNEL_FROZEN).toBe(true)
  })

  it('never reports an available update or toast, even with a newer release loaded', () => {
    expect(hasUpdateAvailable(releaseState())).toBe(false)
    expect(shouldShowUpdateToast(releaseState())).toBe(false)
  })

  it('does not request GitHub releases', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const store = new UpdateStore('0.5.1')
    await store.checkForUpdates({ force: true })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(store.getSnapshot().latestRelease).toBeNull()
  })

  it('ignores a release cached by an earlier unfrozen build', () => {
    localStorage.setItem(
      'opencode:update-check',
      JSON.stringify({
        latestRelease: { version: '0.5.2', tagName: 'v0.5.2', url: 'https://example.com', publishedAt: null, name: null },
        lastCheckedAt: Date.now(),
        dismissedVersion: null,
      }),
    )

    const store = new UpdateStore('0.5.1')

    expect(store.getSnapshot().latestRelease).toBeNull()
    expect(hasUpdateAvailable(store.getSnapshot())).toBe(false)
  })
})
