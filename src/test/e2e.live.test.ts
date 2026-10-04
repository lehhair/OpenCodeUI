// 一次性端到端探针（不提交）：直连本机 v2 服务端验证 API 层。
// 需要本机跑着 v2 服务端（127.0.0.1:4096，密码 test123），默认跳过：
//   VITE_OPENCODE_LIVE_E2E=1 npx vitest run src/test/e2e.live.test.ts
import { describe, it, expect, beforeAll } from 'vitest'
import { serverStore } from '../store/serverStore'
import { getSessions, createSession, deleteSession } from '../api/session'
import { getSessionMessages } from '../api/message'
import { getLocationInfo } from '../api/global'
import { subscribeToServerEvents, getServerConnectionInfo } from '../api/events'

const SERVER_ID = 'e2e-live'
const LIVE = import.meta.env.VITE_OPENCODE_LIVE_E2E === '1'

beforeAll(() => {
  serverStore.upsertServer({
    id: SERVER_ID,
    name: 'e2e',
    url: 'http://127.0.0.1:4096',
    auth: { username: 'opencode', password: 'test123' },
  })
})

describe.skipIf(!LIVE)('live v2 server e2e', () => {
  it('health check passes against /api/info', async () => {
    const health = await serverStore.checkHealth(SERVER_ID)
    expect(health.status).toBe('online')
    expect(health.version).toBeTruthy()
  }, 15000)

  it('reads location info', async () => {
    const loc = await getLocationInfo(undefined, SERVER_ID)
    expect(loc.directory).toBeTruthy()
    expect(loc.project.id).toBeTruthy()
  }, 15000)

  it('creates, lists, reads and deletes a session', async () => {
    const created = await createSession({ title: 'e2e live probe' }, SERVER_ID)
    expect(created.id).toMatch(/^ses_/)

    const sessions = await getSessions({ limit: 5 }, SERVER_ID)
    expect(sessions.some(s => s.id === created.id)).toBe(true)

    const messages = await getSessionMessages(created.id, undefined, undefined, SERVER_ID)
    expect(Array.isArray(messages)).toBe(true)

    expect(await deleteSession(created.id, undefined, SERVER_ID)).toBe(true)
  }, 30000)

  it('receives server.connected over the SSE stream', async () => {
    let unsubscribe: (() => void) | undefined
    const connected = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timed out waiting for server.connected')), 10000)
      unsubscribe = subscribeToServerEvents(SERVER_ID, {
        onServerConnected: () => {
          clearTimeout(timeout)
          resolve()
        },
      })
    })
    await connected
    // 注意：断言必须在取消订阅之前——最后一个订阅者退订会主动断开连接
    expect(getServerConnectionInfo(SERVER_ID).state).toBe('connected')
    unsubscribe?.()
  }, 20000)
})
