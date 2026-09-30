import { beforeEach, describe, expect, it, vi } from 'vitest'

const STORAGE_SUFFIX = 'opencode-pinned-sessions'

function serverKey(serverId: string) {
  return `srv:${serverId}:${STORAGE_SUFFIX}`
}

function readPinned(serverId: string) {
  const raw = localStorage.getItem(serverKey(serverId))
  return raw ? (JSON.parse(raw) as unknown[]) : null
}

describe('pinnedSessionsStore', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    vi.resetModules()
  })

  it('isolates pinned sessions per active server', async () => {
    const { serverStore } = await import('./serverStore')
    const remote = serverStore.addServer({ name: 'Remote', url: 'http://remote.example' })

    const { pinnedSessionsStore } = await import('./pinnedSessionsStore')

    pinnedSessionsStore.pin({
      sessionId: 'local-session',
      directory: '/local',
      title: 'Local Pin',
    })
    expect(pinnedSessionsStore.isPinned('local-session')).toBe(true)

    serverStore.setActiveServer(remote.id)
    expect(pinnedSessionsStore.isPinned('local-session')).toBe(false)

    pinnedSessionsStore.pin({
      sessionId: 'remote-session',
      directory: '/remote',
      title: 'Remote Pin',
    })
    expect(readPinned(remote.id)).toEqual([{ sessionId: 'remote-session', directory: '/remote', title: 'Remote Pin' }])
    expect(readPinned('local')).toEqual([{ sessionId: 'local-session', directory: '/local', title: 'Local Pin' }])

    serverStore.setActiveServer('local')
    expect(pinnedSessionsStore.isPinned('local-session')).toBe(true)
    expect(pinnedSessionsStore.isPinned('remote-session')).toBe(false)
  })

  it('stays silent when a non-active server registers or changes endpoint', async () => {
    const { serverStore } = await import('./serverStore')
    const { pinnedSessionsStore } = await import('./pinnedSessionsStore')

    pinnedSessionsStore.pin({ sessionId: 'local-session', directory: '/local', title: 'Local Pin' })

    const notify = vi.fn()
    const off = pinnedSessionsStore.subscribe(notify)

    // upsert 新服务器 / 端点变化都会无条件广播 server-runtime-updated（WSL 就绪与重启的常规路径），
    // 但置顶数据按 serverId 分片跟随 active：非 active 的变化不得触发 reload + emit 造成无谓重渲染
    serverStore.upsertServer({ id: 'wsl:ubuntu', name: 'WSL', url: 'http://127.0.0.1:59001' })
    serverStore.upsertServer({ id: 'wsl:ubuntu', name: 'WSL', url: 'http://127.0.0.1:59002' })
    expect(notify).not.toHaveBeenCalled()
    expect(pinnedSessionsStore.isPinned('local-session')).toBe(true)

    // active 切换仍须重载新服务器数据并通知订阅方
    serverStore.setActiveServer('wsl:ubuntu')
    expect(notify).toHaveBeenCalledTimes(1)
    expect(pinnedSessionsStore.isPinned('local-session')).toBe(false)

    off()
  })

  it('migrates legacy global pins to the current server once', async () => {
    localStorage.setItem(
      STORAGE_SUFFIX,
      JSON.stringify([{ sessionId: 'legacy-1', directory: '/old', title: 'Legacy' }]),
    )

    const { pinnedSessionsStore } = await import('./pinnedSessionsStore')

    expect(pinnedSessionsStore.getSnapshot()).toEqual([{ sessionId: 'legacy-1', directory: '/old', title: 'Legacy' }])
    expect(readPinned('local')).toEqual([{ sessionId: 'legacy-1', directory: '/old', title: 'Legacy' }])
    expect(localStorage.getItem(STORAGE_SUFFIX)).toBeNull()
  })
})
