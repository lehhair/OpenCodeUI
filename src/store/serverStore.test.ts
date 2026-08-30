import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...init?.headers,
    },
  })
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res => {
    resolve = res
  })
  return { promise, resolve }
}

describe('serverStore clock calibration', () => {
  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
    sessionStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('derives calibrated now from a server timestamp and monotonic time', async () => {
    const { serverStore } = await import('./serverStore')
    const serverTimestamp = Date.parse('2026-04-22T15:00:00.000Z')
    const perfSpy = vi.spyOn(performance, 'now')

    perfSpy.mockReturnValueOnce(1_000)
    expect(
      serverStore.applyServerConnectedTimestamp(
        serverStore.getActiveServerId(),
        new Date(serverTimestamp).toISOString(),
      ),
    ).toBe(true)

    perfSpy.mockReturnValue(1_750)
    expect(serverStore.getActiveCalibratedNow()).toBe(serverTimestamp + 750)
  })

  it('ignores malformed timestamps', async () => {
    const { serverStore } = await import('./serverStore')

    expect(serverStore.applyServerConnectedTimestamp(serverStore.getActiveServerId(), 'not-a-date')).toBe(false)
    expect(serverStore.getActiveCalibratedNow()).toBeUndefined()
  })

  it('does not reuse calibration after switching to another server without calibration', async () => {
    const { serverStore } = await import('./serverStore')
    const perfSpy = vi.spyOn(performance, 'now')

    perfSpy.mockReturnValue(500)
    serverStore.applyServerConnectedTimestamp(serverStore.getActiveServerId(), '2026-04-22T15:00:00.000Z')

    const remote = serverStore.addServer({
      name: 'Remote',
      url: 'http://remote.test',
    })
    serverStore.setActiveServer(remote.id)

    expect(serverStore.getActiveCalibratedNow()).toBeUndefined()
  })
})

describe('serverStore local runtime URL', () => {
  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
    sessionStorage.clear()
  })

  it('uses the detected local service URL without persisting it as the configured URL', async () => {
    const { serverStore } = await import('./serverStore')

    expect(serverStore.getActiveBaseUrl()).toBe('http://127.0.0.1:4096')

    expect(serverStore.setLocalServerRuntimeUrl('http://127.0.0.1:58231/')).toBe(true)

    expect(serverStore.getActiveBaseUrl()).toBe('http://127.0.0.1:58231')
    expect(serverStore.getLocalServerUrl()).toBe('http://127.0.0.1:58231')
    expect(serverStore.getStoredServers().find(server => server.id === 'local')?.url).toBe('http://127.0.0.1:4096')
  })

  it('notifies listeners when the active local runtime URL changes', async () => {
    const { serverStore } = await import('./serverStore')
    const listener = vi.fn()
    serverStore.onServerChange(listener)

    expect(serverStore.setLocalServerRuntimeUrl('http://127.0.0.1:58231')).toBe(true)

    expect(listener).toHaveBeenCalledWith('local', 'local-runtime-url')
  })

  it('does not notify active endpoint listeners when local URL changes while remote is active', async () => {
    const { serverStore } = await import('./serverStore')
    const remote = serverStore.addServer({ name: 'Remote', url: 'http://remote.test' })
    const listener = vi.fn()

    serverStore.setActiveServer(remote.id)
    listener.mockClear()
    serverStore.onServerChange(listener)

    expect(serverStore.setLocalServerRuntimeUrl('http://127.0.0.1:58231')).toBe(true)

    expect(serverStore.getActiveBaseUrl()).toBe('http://remote.test')
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('serverStore WSL persistence', () => {
  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
    sessionStorage.clear()
  })

  it('does not persist wsl: servers into localStorage', async () => {
    const { serverStore } = await import('./serverStore')

    serverStore.upsertServer({
      id: 'wsl:Ubuntu-22.04',
      name: 'Ubuntu-22.04',
      url: 'http://127.0.0.1:58231',
      auth: { username: 'opencode', password: 'one-time' },
    })
    serverStore.upsertServer({ id: 'local', name: 'Local', url: 'http://127.0.0.1:4096' })

    const stored = JSON.parse(localStorage.getItem('opencode-servers') ?? '[]') as Array<{ id: string }>
    expect(stored.some(server => server.id.startsWith('wsl:'))).toBe(false)
    expect(stored.map(server => server.id)).toContain('local')
    // 内存里仍然可用（本会话照常连接）
    expect(serverStore.getServer('wsl:Ubuntu-22.04')).not.toBeNull()
  })

  it('cleans up legacy persisted wsl: entries on load', async () => {
    localStorage.setItem(
      'opencode-servers',
      JSON.stringify([
        { id: 'local', name: 'Local', url: 'http://127.0.0.1:4096', isDefault: true },
        {
          id: 'wsl:Ubuntu-22.04',
          name: 'Ubuntu-22.04',
          url: 'http://127.0.0.1:11111',
          auth: { username: 'opencode', password: 'stale' },
        },
      ]),
    )

    const { serverStore } = await import('./serverStore')

    expect(serverStore.getStoredServers().some(server => server.id.startsWith('wsl:'))).toBe(false)
    expect(serverStore.getServer('wsl:Ubuntu-22.04')).toBeNull()
  })

  it('keeps a persisted wsl: active id as boot intent and falls back to a list server', async () => {
    localStorage.setItem(
      'opencode-servers',
      JSON.stringify([{ id: 'local', name: 'Local', url: 'http://127.0.0.1:4096', isDefault: true }]),
    )
    localStorage.setItem('opencode-active-server', 'wsl:Ubuntu-22.04')

    const { serverStore } = await import('./serverStore')

    expect(serverStore.getBootIntentServerId()).toBe('wsl:Ubuntu-22.04')
    expect(serverStore.getActiveServerId()).toBe('local')
  })
})

describe('serverStore upsertServer runtime change', () => {
  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
    sessionStorage.clear()
  })

  it('notifies server-runtime-updated when the active server url changes', async () => {
    const { serverStore } = await import('./serverStore')
    const remote = serverStore.addServer({ name: 'Remote', url: 'http://127.0.0.1:11111' })
    serverStore.setActiveServer(remote.id)

    const listener = vi.fn()
    serverStore.onServerChange(listener)

    serverStore.upsertServer({ id: remote.id, name: 'Remote', url: 'http://127.0.0.1:22222' })

    expect(listener).toHaveBeenCalledWith(remote.id, 'server-runtime-updated')
    expect(serverStore.getActiveBaseUrl()).toBe('http://127.0.0.1:22222')
  })

  it('notifies server-runtime-updated when only the active server auth changes', async () => {
    const { serverStore } = await import('./serverStore')
    const remote = serverStore.addServer({ name: 'Remote', url: 'http://127.0.0.1:11111' })
    serverStore.setActiveServer(remote.id)

    const listener = vi.fn()
    serverStore.onServerChange(listener)

    serverStore.upsertServer({
      id: remote.id,
      name: 'Remote',
      url: 'http://127.0.0.1:11111',
      auth: { username: 'opencode', password: 'rotated' },
    })

    expect(listener).toHaveBeenCalledWith(remote.id, 'server-runtime-updated')
  })

  it('does not notify when url and auth are unchanged', async () => {
    const { serverStore } = await import('./serverStore')
    const remote = serverStore.addServer({
      name: 'Remote',
      url: 'http://127.0.0.1:11111',
      auth: { username: 'opencode', password: 'same' },
    })
    serverStore.setActiveServer(remote.id)

    const listener = vi.fn()
    serverStore.onServerChange(listener)

    // 尾部斜杠应被归一化掉，改名 + 相同 url/auth 不构成 runtime 变更
    serverStore.upsertServer({
      id: remote.id,
      name: 'Remote renamed',
      url: 'http://127.0.0.1:11111/',
      auth: { username: 'opencode', password: 'same' },
    })

    expect(listener).not.toHaveBeenCalled()
  })

  it('notifies server-runtime-updated when a non-active server url changes', async () => {
    // 信号语义是「端点事实变化」而非「active 在用谁」：非 active 的 WSL 服务器
    // sidecar 换端口后，侧边栏会话事件流（SSE）同样挂在其端点上，必须重连
    const { serverStore } = await import('./serverStore')
    const remote = serverStore.addServer({ name: 'Remote', url: 'http://127.0.0.1:11111' })

    const listener = vi.fn()
    serverStore.onServerChange(listener)

    serverStore.upsertServer({ id: remote.id, name: 'Remote', url: 'http://127.0.0.1:22222' })

    expect(listener).toHaveBeenCalledWith(remote.id, 'server-runtime-updated')
  })

  it('notifies server-runtime-updated when a new server is registered', async () => {
    // WSL 就绪注册：端点事实从无到有，消费方（SSE/SDK）需按新端点重建，
    // 否则启动窗口期建立的回退连接永远指向错误地址
    const { serverStore } = await import('./serverStore')

    const listener = vi.fn()
    serverStore.onServerChange(listener)

    serverStore.upsertServer({ id: 'wsl:Ubuntu-22.04', name: 'Ubuntu', url: 'http://127.0.0.1:33333' })

    expect(listener).toHaveBeenCalledWith('wsl:Ubuntu-22.04', 'server-runtime-updated')
    expect(serverStore.getServer('wsl:Ubuntu-22.04')?.url).toBe('http://127.0.0.1:33333')
  })
})

describe('serverStore default server preference', () => {
  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
    sessionStorage.clear()
  })

  it('persists the preference without touching the active server', async () => {
    const { serverStore } = await import('./serverStore')
    const remote = serverStore.addServer({ name: 'Remote', url: 'http://remote.test' })

    serverStore.setDefaultServer(remote.id)

    expect(serverStore.getDefaultServerId()).toBe(remote.id)
    expect(localStorage.getItem('opencode-default-server')).toBe(remote.id)
    expect(serverStore.getActiveServerId()).toBe('local')
  })

  it('accepts a wsl: preference that is not in the list yet and can be cleared', async () => {
    const { serverStore } = await import('./serverStore')

    serverStore.setDefaultServer('wsl:Ubuntu-22.04')
    expect(serverStore.getDefaultServerId()).toBe('wsl:Ubuntu-22.04')

    serverStore.setDefaultServer(null)
    expect(serverStore.getDefaultServerId()).toBeNull()
    expect(localStorage.getItem('opencode-default-server')).toBeNull()
  })

  it('applies a list default preference over the persisted active id on load', async () => {
    localStorage.setItem(
      'opencode-servers',
      JSON.stringify([
        { id: 'local', name: 'Local', url: 'http://127.0.0.1:4096', isDefault: true },
        { id: 'remote', name: 'Remote', url: 'http://remote.test' },
      ]),
    )
    localStorage.setItem('opencode-active-server', 'remote')
    localStorage.setItem('opencode-default-server', 'local')

    const { serverStore } = await import('./serverStore')

    expect(serverStore.getActiveServerId()).toBe('local')
  })

  it('keeps a wsl: default preference without forcing it as active on load', async () => {
    localStorage.setItem(
      'opencode-servers',
      JSON.stringify([{ id: 'local', name: 'Local', url: 'http://127.0.0.1:4096', isDefault: true }]),
    )
    localStorage.setItem('opencode-default-server', 'wsl:Ubuntu-22.04')

    const { serverStore } = await import('./serverStore')

    expect(serverStore.getDefaultServerId()).toBe('wsl:Ubuntu-22.04')
    expect(serverStore.getActiveServerId()).toBe('local')
  })

  it('drops a default preference that points to a removed server', async () => {
    localStorage.setItem(
      'opencode-servers',
      JSON.stringify([{ id: 'local', name: 'Local', url: 'http://127.0.0.1:4096', isDefault: true }]),
    )
    localStorage.setItem('opencode-default-server', 'gone')

    const { serverStore } = await import('./serverStore')

    expect(serverStore.getDefaultServerId()).toBeNull()
  })
})

describe('serverStore settings backup', () => {
  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
    sessionStorage.clear()
  })

  it('exports without wsl: servers and with the default preference', async () => {
    const { serverStore, exportServerSettingsBackup } = await import('./serverStore')
    serverStore.upsertServer({ id: 'wsl:Ubuntu-22.04', name: 'Ubuntu-22.04', url: 'http://127.0.0.1:58231' })
    serverStore.setDefaultServer('wsl:Ubuntu-22.04')

    const backup = exportServerSettingsBackup()

    expect(backup.servers.some(server => server.id.startsWith('wsl:'))).toBe(false)
    expect(backup.defaultServerId).toBe('wsl:Ubuntu-22.04')
  })

  it('imports a legacy backup without defaultServerId and cleans wsl: entries', async () => {
    const serverStoreModule = await import('./serverStore')
    serverStoreModule.importServerSettingsBackup({
      servers: [
        { id: 'local', name: 'Local', url: 'http://127.0.0.1:4096', isDefault: true },
        { id: 'wsl:Ubuntu-22.04', name: 'Ubuntu-22.04', url: 'http://127.0.0.1:11111' },
      ],
      activeServerId: 'wsl:Ubuntu-22.04',
    })

    // 导入即清洗：持久层落盘时就不带 wsl: 条目
    const stored = JSON.parse(localStorage.getItem('opencode-servers') ?? '[]') as Array<{ id: string }>
    expect(stored.map(server => server.id)).toEqual(['local'])
    expect(localStorage.getItem('opencode-default-server')).toBeNull()

    // 重新加载 store：active 回退到列表内服务器，偏好为空
    vi.resetModules()
    const { serverStore } = await import('./serverStore')
    expect(serverStore.getStoredServers().some(server => server.id.startsWith('wsl:'))).toBe(false)
    expect(serverStore.getActiveServerId()).toBe('local')
    expect(serverStore.getDefaultServerId()).toBeNull()
  })

  it('imports a backup with defaultServerId', async () => {
    const serverStoreModule = await import('./serverStore')
    serverStoreModule.importServerSettingsBackup({
      servers: [{ id: 'local', name: 'Local', url: 'http://127.0.0.1:4096', isDefault: true }],
      activeServerId: 'local',
      defaultServerId: 'wsl:Ubuntu-22.04',
    })

    expect(localStorage.getItem('opencode-default-server')).toBe('wsl:Ubuntu-22.04')
  })
})

describe('serverStore removeServer active fallback', () => {
  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
    sessionStorage.clear()
  })

  it('notifies server-switch to the fallback server when the active server is removed', async () => {
    const { serverStore } = await import('./serverStore')
    const remote = serverStore.addServer({ name: 'Remote', url: 'http://remote.test' })
    serverStore.setActiveServer(remote.id)

    const listener = vi.fn()
    serverStore.onServerChange(listener)

    expect(serverStore.removeServer(remote.id)).toBe(true)

    // SSE 等消费方依赖该通知从死掉/被删的服务器优雅降级到回退目标
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith('local', 'server-switch')
    expect(serverStore.getActiveServerId()).toBe('local')
  })

  it('does not notify when removing a non-active server', async () => {
    const { serverStore } = await import('./serverStore')
    const remote = serverStore.addServer({ name: 'Remote', url: 'http://remote.test' })

    const listener = vi.fn()
    serverStore.onServerChange(listener)

    expect(serverStore.removeServer(remote.id)).toBe(true)

    expect(listener).not.toHaveBeenCalled()
    expect(serverStore.getActiveServerId()).toBe('local')
  })
})

describe('serverStore health check', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('fetch', vi.fn())
    localStorage.clear()
    sessionStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('marks a valid OpenCode health response as online', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ healthy: true, version: '1.16.0' }))
    const { serverStore } = await import('./serverStore')

    const health = await serverStore.checkHealth('local')

    expect(health.status).toBe('online')
    expect(health.version).toBe('1.16.0')
  })

  it('rejects HTML responses even when the status is 200', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('<!doctype html><title>OpenCode</title>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    )
    const { serverStore } = await import('./serverStore')

    const health = await serverStore.checkHealth('local')

    expect(health.status).toBe('error')
    expect(health.error).toMatch(/HTML/)
  })

  it('rejects JSON that is not an OpenCode health response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ok: true }))
    const { serverStore } = await import('./serverStore')

    const health = await serverStore.checkHealth('local')

    expect(health.status).toBe('error')
    expect(health.error).toBe('Not an OpenCode server')
  })

  it('reports unauthorized credentials separately', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ name: 'Unauthorized' }, { status: 401 }))
    const { serverStore } = await import('./serverStore')

    const health = await serverStore.checkHealth('local')

    expect(health.status).toBe('unauthorized')
  })

  it('does not let stale health checks overwrite newer results', async () => {
    const staleResponse = createDeferred<Response>()
    vi.mocked(fetch)
      .mockImplementationOnce(() => staleResponse.promise)
      .mockResolvedValueOnce(jsonResponse({ healthy: true, version: '1.16.0' }))

    const { serverStore } = await import('./serverStore')

    const staleCheck = serverStore.checkHealth('local')
    const freshHealth = await serverStore.checkHealth('local')

    expect(freshHealth.status).toBe('online')
    expect(serverStore.getHealth('local')?.status).toBe('online')

    staleResponse.resolve(
      new Response('<!doctype html><title>OpenCode</title>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    )
    const staleHealth = await staleCheck

    expect(staleHealth.status).toBe('error')
    expect(serverStore.getHealth('local')?.status).toBe('online')
  })
})
