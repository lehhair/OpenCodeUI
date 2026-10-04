// 一次性重连验证（不提交）：订阅事件后，外部会杀掉并重启服务端，
// 验证断线后能自动重连且广播 onReconnected（驱动补偿拉取）。
// 需要本机跑着 v2 服务端（127.0.0.1:4096，密码 test123），默认跳过：
//   VITE_OPENCODE_LIVE_E2E=1 npx vitest run src/test/e2e.reconnect.live.test.ts
import { describe, it, expect, beforeAll } from 'vitest'
import { serverStore } from '../store/serverStore'
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

describe.skipIf(!LIVE)('live reconnect', () => {
  it('reconnects and broadcasts onReconnected after server restart', async () => {
    const events: string[] = []
    let unsubscribe: (() => void) | undefined

    const done = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`timeout; states seen: ${events.join(' → ') || '(none)'}`))
      }, 90_000)

      unsubscribe = subscribeToServerEvents(SERVER_ID, {
        onServerConnected: () => {
          events.push(`connected@${Math.round(performance.now() / 1000)}s`)
        },
        onReconnected: reason => {
          events.push(`reconnected(${reason})`)
          clearTimeout(timeout)
          resolve()
        },
      })
    })

    await done
    unsubscribe?.()
    console.log('[reconnect e2e] events:', events.join(' → '))
    expect(events.filter(e => e.startsWith('connected')).length).toBeGreaterThanOrEqual(2)
    expect(events.some(e => e.startsWith('reconnected'))).toBe(true)
    expect(getServerConnectionInfo(SERVER_ID).state).not.toBe('connected') // 退订后主动断开
  }, 100_000)
})
