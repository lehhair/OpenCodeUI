// 一次性发送链路验证（不提交）：复刻 UI 的真实调用序列
//   getActiveModels → 选 free 模型 → createSession → sendMessage → 等助手回复事件
// 运行：VITE_OPENCODE_LIVE_E2E=1 npx vitest run src/test/e2e.send.live.test.ts
import { describe, it, expect, beforeAll } from 'vitest'
import { serverStore } from '../store/serverStore'
import { getActiveModels } from '../api/client'
import { createSession, deleteSession } from '../api/session'
import { sendMessage } from '../api/message'
import { subscribeToServerEvents } from '../api/events'
import { messageStore } from '../store/messageStore'

const SERVER_ID = 'e2e-live'
const LIVE = import.meta.env.VITE_OPENCODE_LIVE_E2E === '1'
const DIRECTORY = 'E:\\dev\\re_agent_UI\\OpenCodeUI'

beforeAll(() => {
  serverStore.upsertServer({
    id: SERVER_ID,
    name: 'e2e',
    url: 'http://127.0.0.1:4096',
    auth: { username: 'opencode', password: 'test123' },
  })
})

describe.skipIf(!LIVE)('live send message flow', () => {
  it('loads models with usable free model projection', async () => {
    const models = await getActiveModels(DIRECTORY, SERVER_ID)
    const free = models.filter(m => m.providerID === 'opencode')
    console.log('[send e2e] total models:', models.length, 'opencode free:', free.map(m => m.id).join(', '))
    expect(free.length).toBeGreaterThan(0)
    expect(free[0].id).toBeTruthy()
    expect(free[0].providerID).toBe('opencode')
  }, 30000)

  it('creates session, sends message, receives assistant reply', async () => {
    const models = await getActiveModels(DIRECTORY, SERVER_ID)
    const freeModel = models.find(m => m.providerID === 'opencode')
    expect(freeModel).toBeDefined()

    const session = await createSession({ directory: DIRECTORY, title: 'send-flow probe' }, SERVER_ID)
    console.log('[send e2e] session:', session.id)

    try {
      // 订阅事件，等 assistant 文本或执行结束
      let sawText = ''
      let sawFailed: unknown = null
      const finished = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('timeout waiting for assistant reply')), 90_000)
        const unsubscribe = subscribeToServerEvents(SERVER_ID, {
          onTextDelta: data => {
            sawText += (data as { delta?: string }).delta ?? ''
          },
          onExecutionSucceeded: data => {
            if ((data as { sessionID?: string }).sessionID !== session.id) return
            clearTimeout(timeout)
            unsubscribe()
            resolve()
          },
          onExecutionFailed: data => {
            if ((data as { sessionID?: string }).sessionID !== session.id) return
            sawFailed = data
            clearTimeout(timeout)
            unsubscribe()
            resolve()
          },
        })
      })

      // 与 UI 完全一致的调用：sendMessage（内部 switchModel + prompt）
      await sendMessage(
        {
          sessionId: session.id,
          text: 'Reply with exactly: pong',
          attachments: [],
          model: { providerID: freeModel!.providerID, modelID: freeModel!.id },
          directory: DIRECTORY,
        },
        SERVER_ID,
      )
      console.log('[send e2e] prompt enqueued')

      await finished
      console.log('[send e2e] sawText:', JSON.stringify(sawText.slice(0, 200)), 'sawFailed:', JSON.stringify(sawFailed)?.slice(0, 300))
      expect(sawFailed).toBeNull()
      expect(sawText.toLowerCase()).toContain('pong')
    } finally {
      await deleteSession(session.id, undefined, SERVER_ID).catch(() => undefined)
    }
  }, 120_000)

  it('messageStore receives streaming events for the session', async () => {
    const models = await getActiveModels(DIRECTORY, SERVER_ID)
    const freeModel = models.find(m => m.providerID === 'opencode')!
    const session = await createSession({ directory: DIRECTORY, title: 'store-flow probe' }, SERVER_ID)

    try {
      const finished = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('timeout')), 90_000)
        const unsubscribe = subscribeToServerEvents(SERVER_ID, {
          onTextStarted: data => messageStore.handleTextStarted(data as never),
          onTextDelta: data => messageStore.handleTextDelta(data as never),
          onTextEnded: data => messageStore.handleTextEnded(data as never),
          onExecutionSucceeded: data => {
            if ((data as { sessionID?: string }).sessionID !== session.id) return
            clearTimeout(timeout)
            unsubscribe()
            resolve()
          },
          onExecutionFailed: () => {
            clearTimeout(timeout)
            unsubscribe()
            reject(new Error('execution failed'))
          },
        })
      })

      await sendMessage(
        {
          sessionId: session.id,
          text: 'Reply with exactly: pong',
          attachments: [],
          model: { providerID: freeModel.providerID, modelID: freeModel.id },
          directory: DIRECTORY,
        },
        SERVER_ID,
      )
      await finished

      const state = messageStore.getSessionState(session.id)
      // v2 消息是 type 判别联合：assistant 的文本在 content[] 里
      const assistant = state?.messages.find(m => (m as { type?: string }).type === 'assistant') as
        | { content?: Array<{ type: string; text?: string }> }
        | undefined
      const text = assistant?.content?.filter(c => c.type === 'text').map(c => c.text ?? '').join('') ?? ''
      console.log('[store e2e] assistant text:', JSON.stringify(text.slice(0, 200)))
      expect(text.toLowerCase()).toContain('pong')
    } finally {
      await deleteSession(session.id, undefined, SERVER_ID).catch(() => undefined)
    }
  }, 120_000)
})
