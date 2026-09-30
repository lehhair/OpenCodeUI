// ============================================
// 阶段 2b 冒烟测试（**需要真实 V2 服务**）
// ============================================
//
// ⚠️ 默认**跳过**：依赖一个活着的 opencode 服务。要跑它：
//
//   OPENCODE_SERVER_PASSWORD=t1 opencode --log-level info serve --hostname 127.0.0.1 --port 4097
//   VITE_OPENCODE_SMOKE=1 npx vitest run src/features/message/phase2b.smoke.test.tsx
//
// 可用环境变量（都必须带 VITE_ 前缀，Vite 才会注入 import.meta.env）：
//   VITE_OPENCODE_SMOKE=1            开关（不开则整组 skip）
//   VITE_OPENCODE_SMOKE_URL          默认 http://127.0.0.1:4097
//   VITE_OPENCODE_SMOKE_PASSWORD     默认 t1
//   VITE_OPENCODE_SMOKE_DIRECTORY    默认仓库目录
//
// 本阶段要证明的四件事（对应任务 8）：
//   1. 订阅 `GET /api/event` 能收到 `server.connected` **首帧**
//   2. **15 秒心跳**正常（`: heartbeat` 注释行）
//   3. 发 `prompt` 后**事件流真的有数据**（流式事件逐帧到达）
//   4. **字段路径解析正确**：把真实帧交给事件层，断言每个回调拿到的字段
//      （含 part id 合成规则），并把消息真的落到 `messageStore` 里

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { V2EventUnion } from '../../types/api/event'
import { EventTypes } from '../../types/api/event'

const env = import.meta.env as Record<string, string | undefined>

const BASE_URL = env.VITE_OPENCODE_SMOKE_URL ?? 'http://127.0.0.1:4097'
const PASSWORD = env.VITE_OPENCODE_SMOKE_PASSWORD ?? 't1'
const DIRECTORY = env.VITE_OPENCODE_SMOKE_DIRECTORY ?? '/home/coder/project/OpenCodeUI'
const ENABLED = !!env.VITE_OPENCODE_SMOKE

/**
 * 抓帧窗口上限
 *
 * 必须 > 15 秒才能观察到心跳；同时要覆盖一整轮 agent loop（实测 20~60 秒）。
 * 实际会**提前结束**：看到 `session.execution.succeeded/failed/interrupted` 就停
 * （否则固定窗口会在慢回合上提前关闭，导致流式帧抓不到 → 测试假失败）。
 */
const CAPTURE_MAX_MS = 90000
/** 等一轮跑完的上限 */
const RUN_TIMEOUT_MS = 90000

const AUTH = { Authorization: 'Basic ' + btoa(`opencode:${PASSWORD}`) }

/**
 * 本冒烟**自己创建**的会话 id，结束时清理掉
 *
 * 为什么要清理：冒烟会在仓库目录里新建会话。跑几次之后这个目录就会堆几十个
 * 「只有 1~2 条消息」的会话，把 `phase2a.smoke` 的「找一个长会话」启发式挤到
 * 列表很后面（实测踩过：97 个会话时它扫不到老的长会话 → 4 条断言假失败）。
 * 这里只删**本次运行自己建的** id，不碰任何既有会话。
 */
const createdSessionIds: string[] = []

/** 建一个会话并登记，供 afterAll 清理 */
async function createTrackedSession(): Promise<{ id: string; directory: string }> {
  const { createSession } = await import('../../api/session')
  const session = await createSession({ directory: DIRECTORY })
  createdSessionIds.push(session.id)
  return session
}

afterAll(async () => {
  if (!ENABLED) return
  for (const id of createdSessionIds) {
    try {
      await fetch(`${BASE_URL}/api/session/${id}`, { method: 'DELETE', headers: AUTH })
    } catch {
      // 清理失败不影响测试结论（只会在数据目录里留一条测试会话）
    }
  }
}, 30000)

vi.mock('../../store/serverStore', () => ({
  serverStore: {
    getActiveServerId: () => 'smoke',
    getActiveBaseUrl: () => BASE_URL,
    getActiveAuth: () => ({ username: 'opencode', password: PASSWORD }),
    getServerBaseUrl: () => BASE_URL,
    getServerAuth: () => ({ username: 'opencode', password: PASSWORD }),
    subscribe: () => () => {},
    onServerChange: () => () => {},
    getServers: () => [],
    getActiveServer: () => undefined,
  },
}))

vi.mock('../../utils/tauri', () => ({ isTauri: () => false }))

// ============================================
// 帧解析（镜像 wire 格式）
// ============================================

function parseEventFrame(frame: string): V2EventUnion | null {
  const dataLines: string[] = []
  for (const line of frame.split('\n')) {
    if (!line.startsWith('data:')) continue
    const rest = line.slice(5)
    dataLines.push(rest.startsWith(' ') ? rest.slice(1) : rest)
  }
  if (dataLines.length === 0) return null
  return JSON.parse(dataLines.join('\n')) as V2EventUnion
}

interface Capture {
  /** 原始帧（含 `: heartbeat` 注释行） */
  rawFrames: string[]
  /** 解析后的事件（心跳被过滤） */
  events: V2EventUnion[]
  /** 心跳帧到达的相对毫秒（用于验证 15 秒间隔） */
  heartbeatAt: number[]
  /** 事件层回调看到的载荷 */
  callbacks: {
    connected: Array<{ timestamp?: unknown }>
    partUpdated: Array<{ kind: string; messageID?: string; ordinal?: number; content?: unknown }>
    partDelta: Array<{ sessionID: string; messageID: string; partID: string; kind: string; delta: string }>
    invalidated: string[]
    idle: Array<{ sessionID: string }>
    statuses: Array<{ sessionID: string; status: { type: string } }>
    errors: Array<{ sessionID: string; error: { type: string; message: string } }>
  }
  sessionID: string
  /** 事件层是否收到过 server.connected */
  sawServerConnected: boolean
}

const capture: Capture = {
  rawFrames: [],
  events: [],
  heartbeatAt: [],
  callbacks: { connected: [], partUpdated: [], partDelta: [], invalidated: [], idle: [], statuses: [], errors: [] },
  sessionID: '',
  sawServerConnected: false,
}

const start = Date.now()

/** 读一条 SSE 流；每帧回调一次，`shouldStop()` 为真或超时即结束 */
async function readFrames(maxMs: number, onFrame: (frame: string) => void, shouldStop: () => boolean): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), maxMs)
  try {
    const response = await fetch(`${BASE_URL}/api/event`, {
      headers: { ...AUTH, Accept: 'text/event-stream' },
      signal: controller.signal,
    })
    expect(response.ok).toBe(true)
    const reader = response.body?.getReader()
    if (!reader) throw new Error('没有响应体')
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let boundary = buffer.indexOf('\n\n')
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        if (frame.trim()) onFrame(frame)
        boundary = buffer.indexOf('\n\n')
      }
      // 一轮跑完（或失败/中断）就收工，不等满窗口
      if (shouldStop()) {
        await reader.cancel().catch(() => {})
        return
      }
    }
  } catch (error) {
    // abort 是正常结束路径
    if ((error as { name?: string }).name !== 'AbortError') throw error
  } finally {
    clearTimeout(timer)
  }
}

async function waitUntil(predicate: () => boolean, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('等待条件成立超时')
}

beforeAll(
  async () => {
    if (!ENABLED) return

    const { subscribeToEvents } = await import('../../api/events')

    // 1) 事件层订阅（真实 client → 真实服务）
    const unsubscribe = subscribeToEvents({
      onServerConnected: data => {
        capture.sawServerConnected = true
        capture.callbacks.connected.push(data)
      },
      onPartUpdated: data =>
        capture.callbacks.partUpdated.push(data as { kind: string; messageID?: string; ordinal?: number }),
      onPartDelta: data => capture.callbacks.partDelta.push(data),
      onMessagesInvalidated: id => capture.callbacks.invalidated.push(id),
      onSessionIdle: data => capture.callbacks.idle.push(data),
      onSessionStatus: data => capture.callbacks.statuses.push(data),
      onSessionError: data => capture.callbacks.errors.push(data),
    })

    // 2) 原始帧抓取（并行）
    const rawReading = readFrames(
      CAPTURE_MAX_MS,
      frame => {
        capture.rawFrames.push(frame)
        if (frame.trim() === ': heartbeat') {
          capture.heartbeatAt.push(Date.now() - start)
          return
        }
        const parsed = parseEventFrame(frame)
        if (parsed) capture.events.push(parsed)
      },
      () =>
        capture.events.some(
          event =>
            event.type === EventTypes.SESSION_EXECUTION_SUCCEEDED ||
            event.type === EventTypes.SESSION_EXECUTION_FAILED ||
            event.type === EventTypes.SESSION_EXECUTION_INTERRUPTED,
        ),
    )

    // 3) 建会话 + 发 prompt（用真实 REST，绕开本项目 API 层以便单独验证事件流）
    const created = (await (
      await fetch(`${BASE_URL}/api/session`, {
        method: 'POST',
        headers: { ...AUTH, 'content-type': 'application/json' },
        body: JSON.stringify({ location: { directory: DIRECTORY } }),
      })
    ).json()) as { data: { id: string } }
    capture.sessionID = created.data.id
    createdSessionIds.push(capture.sessionID)

    const prompted = await fetch(`${BASE_URL}/api/session/${capture.sessionID}/prompt`, {
      method: 'POST',
      headers: { ...AUTH, 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'Reply with exactly: SMOKE_OK', agent: 'build' }),
    })
    expect(prompted.ok).toBe(true)

    // 4) 等这轮跑完（或超时）
    try {
      await waitUntil(() => capture.callbacks.statuses.some(s => s.status.type === 'idle'), RUN_TIMEOUT_MS)
    } catch {
      // 超时不直接失败 —— 由下面各条用例分别断言，报错信息更精确
    }

    await rawReading
    unsubscribe()
  },
  RUN_TIMEOUT_MS + CAPTURE_MAX_MS + 20000,
)

describe.skipIf(!ENABLED)('阶段 2b 冒烟：事件流（真实 V2 服务）', () => {
  it('订阅 /api/event 能收到 server.connected 首帧', () => {
    const firstDataFrame = capture.rawFrames.find(frame => frame.includes('data:'))
    expect(firstDataFrame).toBeDefined()
    const first = parseEventFrame(firstDataFrame!)
    expect(first?.type).toBe(EventTypes.SERVER_CONNECTED)
    // V2 的首帧 data 是空对象，没有 created
    expect((first as { data: unknown }).data).toEqual({})
    expect(capture.sawServerConnected).toBe(true)
  })

  it('心跳正常（: heartbeat 注释行，不是数据行；间隔 15 秒）', () => {
    const heartbeats = capture.rawFrames.filter(frame => frame.trim() === ': heartbeat')
    // 抓帧窗口 22 秒 → 正常应看到 2 次（首帧后立刻一次 + 15 秒一次）
    expect(heartbeats.length).toBeGreaterThanOrEqual(1)
    // 心跳行必须是**注释**：解析不出事件
    for (const beat of heartbeats) expect(parseEventFrame(beat)).toBeNull()

    // 🔴 阶段 2b 实测修正：迁移文档 §6.1 只写了「每 15 秒一行 `: heartbeat`」，
    //    但实测**连接后立刻**就会收到一行心跳（≈0.01s），之后才是严格 15 秒间隔：
    //      0.00s server.connected / 0.01s HEARTBEAT / 15.00s / 30.00s / 45.00s
    //    所以这里只断言「首帧心跳在 5 秒内」，间隔断言从第 2 个心跳开始算。
    expect(capture.heartbeatAt[0]).toBeLessThan(5000)

    for (let i = 1; i < capture.heartbeatAt.length; i++) {
      const gap = capture.heartbeatAt[i] - capture.heartbeatAt[i - 1]
      // 服务端固定 15 秒；留足容器调度抖动
      expect(gap).toBeGreaterThan(12000)
      expect(gap).toBeLessThan(20000)
    }
  })

  it('发 prompt 后事件流真的有数据（流式事件逐帧到达）', () => {
    const types = new Set(capture.events.map(event => event.type))
    expect(types.has(EventTypes.SESSION_EXECUTION_STARTED)).toBe(true)
    expect(types.has(EventTypes.SESSION_STEP_STARTED)).toBe(true)
    expect(types.has(EventTypes.SESSION_TEXT_STARTED)).toBe(true)
    expect(types.has(EventTypes.SESSION_TEXT_DELTA)).toBe(true)
    expect(types.has(EventTypes.SESSION_TEXT_ENDED)).toBe(true)
    expect(types.has(EventTypes.SESSION_EXECUTION_SUCCEEDED)).toBe(true)
    // 事件总数应当远超「只有首帧 + 心跳」的量
    expect(capture.events.length).toBeGreaterThan(8)
  })

  it('🔴 实测：session.idle / session.status 从未下发，改用 session.execution.* 表达「一轮结束」', () => {
    const types = new Set(capture.events.map(event => event.type))
    expect(types.has(EventTypes.SESSION_IDLE)).toBe(false)
    expect(types.has(EventTypes.SESSION_STATUS)).toBe(false)
    // 事件层的映射：execution.started → busy、succeeded → idle + onSessionIdle
    expect(capture.callbacks.statuses.map(s => s.status.type)).toContain('busy')
    expect(capture.callbacks.statuses.map(s => s.status.type)).toContain('idle')
    expect(capture.callbacks.idle.length).toBeGreaterThanOrEqual(1)
  })

  it('🔴 实测：session.message.content.updated 也不下发（只有 session.text.* / session.tool.*）', () => {
    const types = new Set(capture.events.map(event => event.type))
    expect(types.has(EventTypes.SESSION_MESSAGE_CONTENT_UPDATED)).toBe(false)
  })

  it('字段路径解析正确：text / reasoning 的 delta 合成了 UI part id', () => {
    const textDeltas = capture.callbacks.partDelta.filter(d => d.kind === 'text')
    expect(textDeltas.length).toBeGreaterThanOrEqual(1)

    const rawTextDelta = capture.events.find(event => event.type === EventTypes.SESSION_TEXT_DELTA) as
      | { data: { assistantMessageID: string; ordinal: number; delta: string } }
      | undefined
    expect(rawTextDelta).toBeDefined()

    // 事件层合成的 partID 必须等于「消息id:content:下标」
    expect(textDeltas[0].partID).toBe(`${rawTextDelta!.data.assistantMessageID}:content:${rawTextDelta!.data.ordinal}`)
    expect(textDeltas[0].messageID).toBe(rawTextDelta!.data.assistantMessageID)
    expect(textDeltas[0].sessionID).toBe(capture.sessionID)
  })

  it('字段路径解析正确：step.started 带 agent/model，step.ended 带 finish/cost/tokens', () => {
    const stepStart = capture.callbacks.partUpdated.find(p => p.kind === 'step-start')
    expect(stepStart).toBeDefined()
    const rawStepStart = capture.events.find(event => event.type === EventTypes.SESSION_STEP_STARTED) as
      | { data: { assistantMessageID: string } }
      | undefined
    expect(stepStart!.messageID).toBe(rawStepStart!.data.assistantMessageID)

    const stepEnd = capture.callbacks.partUpdated.find(p => p.kind === 'step')
    expect(stepEnd).toBeDefined()
  })

  it('事件层收到的 part 更新都带正确的 messageID（真实 assistant 消息 id）', () => {
    const contentUpdates = capture.callbacks.partUpdated.filter(p => p.kind === 'content')
    expect(contentUpdates.length).toBeGreaterThanOrEqual(1)
    for (const update of contentUpdates) {
      expect(update.messageID).toMatch(/^msg_/)
    }
  })
})

describe.skipIf(!ENABLED)('阶段 2b 冒烟：发消息链路（真实 V2 服务）', () => {
  it('sendMessageAsync 走 POST /api/session/{id}/prompt，prompt 本身非阻塞', async () => {
    const { sendMessageAsync } = await import('../../api/message')

    const session = await createTrackedSession()
    expect(session.id).toMatch(/^ses_/)
    // ⚠️ 目录必须写进 body 的 location，否则会静默落到服务进程 cwd
    expect(session.directory).toContain('OpenCodeUI')

    const before = Date.now()
    await sendMessageAsync({
      sessionId: session.id,
      text: 'Reply with exactly: ASYNC_OK',
      attachments: [],
      model: { providerID: 'opencode', modelID: 'mimo-v2.6-flash-free' },
      agent: 'build',
      directory: DIRECTORY,
    })
    // 非阻塞：投递完立刻返回（不做「等这轮跑完」）
    expect(Date.now() - before).toBeLessThan(15000)

    // 投递后转录里应很快出现 user 消息
    const { getSessionMessages } = await import('../../api/message')
    await waitUntil(() => true, 100)
    let sawUser = false
    for (let attempt = 0; attempt < 30 && !sawUser; attempt++) {
      const page = await getSessionMessages(session.id, { limit: 10 }, DIRECTORY)
      sawUser = page.messages.some(m => m.type === 'user')
      if (!sawUser) await new Promise(resolve => setTimeout(resolve, 500))
    }
    expect(sawUser).toBe(true)
  }, 40000)

  it('sendMessage 走 prompt + POST /api/experimental/session/{id}/wait（等这轮跑完）', async () => {
    const { sendMessage, getSessionMessages } = await import('../../api/message')
    const { toUIMessages } = await import('../../utils/messageConversion')

    const session = await createTrackedSession()
    const response = await sendMessage({
      sessionId: session.id,
      text: 'Reply with exactly: WAIT_OK',
      attachments: [],
      model: { providerID: 'opencode', modelID: 'mimo-v2.6-flash-free' },
      agent: 'build',
      directory: DIRECTORY,
    })
    // 返回的是**入队记录**（V2 没有「一次请求拿回复」的接口）
    expect(response.parts).toEqual([])

    // wait 返回后这一轮应已结束 → 转录里应当有 assistant 消息
    const page = await getSessionMessages(session.id, { limit: 20 }, DIRECTORY)
    const uiMessages = toUIMessages(page.messages, session.id)
    const assistant = uiMessages.find(m => m.info.role === 'assistant')
    expect(assistant).toBeDefined()
    expect(assistant!.parts.length).toBeGreaterThan(0)
  }, 120000)

  it('附件 / agent 参数按 openapi 形状构造（buildPromptParams 纯函数）', async () => {
    const { buildPromptParams } = await import('../../api/message')
    const built = buildPromptParams('ses_x', {
      sessionId: 'ses_x',
      text: 'hi',
      attachments: [
        {
          id: 'a1',
          type: 'file',
          displayName: 'shot.png',
          url: 'data:image/png;base64,AAAA',
          mime: 'image/png',
          textRange: { value: '@shot.png', start: 0, end: 10 },
        },
      ],
      model: { providerID: 'opencode', modelID: 'mimo-v2.6-flash-free' },
      agent: 'build',
    })
    expect(built.text).toBe('hi')
    expect(built.files).toEqual([
      {
        uri: 'data:image/png;base64,AAAA',
        name: 'shot.png',
        mention: { start: 0, end: 10, text: '@shot.png' },
      },
    ])
    expect(built.metadata).toMatchObject({
      agent: 'build',
      model: { providerID: 'opencode', modelID: 'mimo-v2.6-flash-free' },
    })
  })
})
