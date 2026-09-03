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

describe('serverStore removeServer', () => {
  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
    sessionStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('removes the default server when other servers exist', async () => {
    const { serverStore } = await import('./serverStore')
    serverStore.addServer({ name: 'Remote', url: 'http://remote.test' })

    expect(serverStore.removeServer('local')).toBe(true)
    expect(serverStore.getStoredServers().some(s => s.id === 'local')).toBe(false)
  })

  it('switches the active server when removing the active default', async () => {
    const { serverStore } = await import('./serverStore')
    const remote = serverStore.addServer({ name: 'Remote', url: 'http://remote.test' })

    serverStore.removeServer('local')

    expect(serverStore.getActiveServerId()).toBe(remote.id)
  })

  it('refuses to remove the default server when it is the only one', async () => {
    const { serverStore } = await import('./serverStore')

    expect(serverStore.removeServer('local')).toBe(false)
    expect(serverStore.getStoredServers().some(s => s.id === 'local')).toBe(true)
  })

  it('refuses to remove the default server on Tauri desktop', async () => {
    vi.stubGlobal('__TAURI_INTERNALS__', { invoke: vi.fn() })
    const { serverStore } = await import('./serverStore')
    serverStore.addServer({ name: 'Remote', url: 'http://remote.test' })

    expect(serverStore.removeServer('local')).toBe(false)
    expect(serverStore.getStoredServers().some(s => s.id === 'local')).toBe(true)
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
