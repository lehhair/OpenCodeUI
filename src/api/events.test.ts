// ============================================
// 事件层单测（V2，阶段 2b 重写）
// ============================================
//
// 分三块：
//   A. **真实帧解析** —— 用 `src/test/fixtures/v2EventFrames.ts`（真实抓包）验证
//      wire 格式与字段路径。这是「事件字段路径是否解析正确」的直接证据。
//   B. **分发** —— 把真实帧喂进 `subscribeToEvents`，断言每个回调收到的载荷
//      （重点是 text/reasoning 的 part id 规则、tool 的 id 复用、step 的用量）。
//   C. **连接管理** —— 重连退避、代次防串扰、服务器切换迁移、订阅计数。
//
// ⚠️ 传输层已被刻意隔离：`events.ts` 只通过
//    `getSDKClient(serverId).event.subscribe({signal, onActivity})` 拿事件流，
//    所以这里 mock 掉 `./sdk` 就能完整驱动连接状态机。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { V2EventUnion } from '../types/api/event'
import { EventTypes } from '../types/api/event'
import { HEARTBEAT_FRAME, RAW_EVENT_FRAMES } from '../test/fixtures/v2EventFrames'

// ============================================
// 真实帧 → 事件（镜像 wire 格式，生产路径由 @opencode/client 解析）
// ============================================

/**
 * 解析一个 SSE 帧文本
 *
 * 镜像 `@opencode/client` 的 sse 解析器行为（也是
 * `packages/server/src/event-feed.ts` 的 `frame()` 的输出格式）：
 *   - 只取 `data:` 行，多行用 `\n` 连接
 *   - `: heartbeat` 这类**注释行**被忽略 → 返回 null
 *   - 去掉 `data:` 后的一个前导空格，再 `JSON.parse` **一次**
 */
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

/** 所有真实帧解析出的事件（心跳被过滤掉） */
const REAL_EVENTS: V2EventUnion[] = RAW_EVENT_FRAMES.map(parseEventFrame).filter(
  (event): event is V2EventUnion => event !== null,
)

function eventOfType<T extends string>(type: T): Extract<V2EventUnion, { type: T }> {
  const found = REAL_EVENTS.find(event => event.type === type)
  if (!found) throw new Error(`夹具里没有 ${type} 帧`)
  return found as Extract<V2EventUnion, { type: T }>
}

/**
 * 克隆一个真实帧并改写字段
 *
 * 用途：真实抓包一次只产生一条 `session.text.delta`，但「多 delta 合并」需要多帧。
 * 这里**保留真实帧的全部字段路径**，只改要变化的值 —— 比手写假事件更能反映线上形状。
 */
function cloneFrame(frame: string, patch: Record<string, unknown>): V2EventUnion {
  const parsed = JSON.parse(frame.split('data:')[1].trim()) as V2EventUnion
  return { ...parsed, data: { ...(parsed as { data: object }).data, ...patch } } as V2EventUnion
}

// ============================================
// 受控事件流（替代官方 client.event.subscribe）
// ============================================

const sdkMocks = vi.hoisted(() => ({
  streams: [] as Array<{
    push: (event: unknown) => void
    activity: () => void
    finish: () => void
    fail: (error: unknown) => void
    activityHandler: { set: (fn: () => void) => void }
  }>,
  subscribeCalls: 0,
  lastSubscribeOptions: null as { hasSignal: boolean; hasOnActivity: boolean } | null,
}))

vi.mock('./sdk', () => ({
  getSDKClient: () => ({
    event: {
      subscribe: (options?: { signal?: AbortSignal; onActivity?: () => void }) => {
        sdkMocks.subscribeCalls += 1
        sdkMocks.lastSubscribeOptions = {
          hasSignal: !!options?.signal,
          hasOnActivity: !!options?.onActivity,
        }
        // 用与 makeControlledStream 相同的实现，但把 onActivity 挂进去
        const items: unknown[] = []
        let waiter: (() => void) | null = null
        let finished = false
        let failure: unknown = null

        const notify = () => {
          const w = waiter
          waiter = null
          w?.()
        }

        const stream = {
          push(item: unknown) {
            items.push(item)
            notify()
          },
          activity() {
            options?.onActivity?.()
          },
          finish() {
            finished = true
            notify()
          },
          fail(error: unknown) {
            failure = error
            notify()
          },
          activityHandler: { set: () => {} },
          async *[Symbol.asyncIterator]() {
            while (true) {
              while (items.length > 0) {
                await Promise.resolve()
                yield items.shift()
              }
              if (failure) throw failure
              if (finished) return
              await new Promise<void>(resolve => {
                waiter = resolve
              })
            }
          },
        }
        sdkMocks.streams.push(stream)
        return stream
      },
    },
  }),
}))

const storeMocks = vi.hoisted(() => ({
  activeServerId: 'local',
  changeListeners: [] as Array<(serverId: string, reason: string) => void>,
}))

vi.mock('../store/serverStore', () => ({
  serverStore: {
    getActiveServerId: () => storeMocks.activeServerId,
    getActiveBaseUrl: () => 'http://local.test',
    getServerBaseUrl: () => 'http://local.test',
    getActiveAuth: () => undefined,
    getServerAuth: () => undefined,
    onServerChange: (fn: (serverId: string, reason: string) => void) => {
      storeMocks.changeListeners.push(fn)
      return () => {
        const index = storeMocks.changeListeners.indexOf(fn)
        if (index >= 0) storeMocks.changeListeners.splice(index, 1)
      }
    },
  },
}))

vi.mock('../utils/tauri', () => ({ isTauri: () => false }))

// ============================================
// 测试辅助
// ============================================

async function loadEventsModule() {
  // ⚠️ 必须用**字面量**动态 import：写成变量会让 TS 无法解析模块类型，
  //    回调参数会全部退化成隐式 any（tsc 会报一堆 TS7006）。
  return import('./events')
}

function latestStream() {
  const stream = sdkMocks.streams[sdkMocks.streams.length - 1]
  if (!stream) throw new Error('还没有创建事件流')
  return stream
}

/** 等到连接状态变成期望值（或超时） */
async function waitForState(getInfo: () => { state: string }, expected: string, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (getInfo().state === expected) return
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  throw new Error(`等待状态 ${expected} 超时，当前是 ${getInfo().state}`)
}

/** 让已排队的微任务全部跑完 */
async function flushMicrotasks(times = 20) {
  for (let i = 0; i < times; i++) await Promise.resolve()
}

/**
 * 轮询等待条件成立
 *
 * ⚠️ 事件分发链路里每一跳都要过微任务（官方迭代器 → 批量 flush → coalesce → 分发），
 *    固定次数的 `await Promise.resolve()` 很容易在事件还没走完时就断言 → 假失败。
 */
async function waitUntil(predicate: () => boolean, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  throw new Error('等待条件成立超时')
}

beforeEach(() => {
  vi.resetModules()
  vi.useRealTimers()
  sdkMocks.streams.length = 0
  sdkMocks.subscribeCalls = 0
  sdkMocks.lastSubscribeOptions = null
  storeMocks.changeListeners.length = 0
  storeMocks.activeServerId = 'local'
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

// ============================================
// A. 真实帧解析
// ============================================

describe('A. 真实事件帧解析（wire 格式）', () => {
  it('帧里只有 data: 行，没有 event: / id: 行', () => {
    for (const frame of RAW_EVENT_FRAMES) {
      if (frame === HEARTBEAT_FRAME) continue
      for (const line of frame.split('\n')) {
        expect(line.startsWith('data:')).toBe(true)
      }
      expect(frame).not.toMatch(/^event:/m)
      expect(frame).not.toMatch(/^id:/m)
    }
  })

  it('心跳是注释行（不是数据行），解析后应被忽略', () => {
    expect(HEARTBEAT_FRAME.startsWith(':')).toBe(true)
    expect(parseEventFrame(HEARTBEAT_FRAME)).toBeNull()
  })

  it('data 后面是**一层** JSON（parse 一次即可），且事件结构是扁平的', () => {
    const event = parseEventFrame(RAW_EVENT_FRAMES.find(f => f.includes('"session.text.delta"'))!)
    expect(event).not.toBeNull()
    // 扁平结构：type 与 data 是**同级**，不是 V1 的 { directory, payload: { type, properties } }
    expect(event).toHaveProperty('type')
    expect(event).toHaveProperty('data')
    expect(event).not.toHaveProperty('payload')
    expect(event).not.toHaveProperty('directory')
  })

  it('首帧是 server.connected，data 为空对象且没有 created', () => {
    const connected = eventOfType(EventTypes.SERVER_CONNECTED)
    expect(connected.data).toEqual({})
    expect((connected as { created?: number }).created).toBeUndefined()
    // 首帧在夹具里排在第一位
    expect(REAL_EVENTS[0]?.type).toBe(EventTypes.SERVER_CONNECTED)
  })

  it('session.created 的字段路径：sessionID / slug / version / projectID / location.directory', () => {
    const created = eventOfType(EventTypes.SESSION_CREATED)
    expect(created.data.sessionID).toMatch(/^ses_/)
    expect(typeof created.data.slug).toBe('string')
    expect(typeof created.data.version).toBe('string')
    expect(typeof created.data.projectID).toBe('string')
    expect(created.data.location.directory).toContain('/')
    // ⚠️ 事件里**没有** time（REST 的 Session.Info 才有）→ 由分发层用事件的 created 兜底
    expect((created.data as { time?: unknown }).time).toBeUndefined()
    expect(typeof (created as { created?: number }).created).toBe('number')
  })

  it('session.text.* 的字段路径：assistantMessageID / ordinal / delta / text', () => {
    const started = eventOfType(EventTypes.SESSION_TEXT_STARTED)
    expect(started.data.sessionID).toMatch(/^ses_/)
    expect(started.data.assistantMessageID).toMatch(/^msg_/)
    expect(started.data.ordinal).toBe(0)

    const delta = eventOfType(EventTypes.SESSION_TEXT_DELTA)
    expect(delta.data.assistantMessageID).toBe(started.data.assistantMessageID)
    expect(delta.data.ordinal).toBe(0)
    expect(typeof delta.data.delta).toBe('string')

    const ended = eventOfType(EventTypes.SESSION_TEXT_ENDED)
    expect(typeof ended.data.text).toBe('string')
    expect(ended.data.ordinal).toBe(0)
  })

  it('session.reasoning.* 与 text 同构，但 ended 额外带 state', () => {
    const started = eventOfType(EventTypes.SESSION_REASONING_STARTED)
    expect(started.data.ordinal).toBe(0)
    expect(started.data.assistantMessageID).toMatch(/^msg_/)
    const ended = eventOfType(EventTypes.SESSION_REASONING_ENDED)
    expect(typeof ended.data.text).toBe('string')
    expect(ended.data.state).toBeDefined()
  })

  it('session.tool.* 的字段路径：id 是工具调用 id，input.ended 给原始串', () => {
    const inputStarted = eventOfType(EventTypes.SESSION_TOOL_INPUT_STARTED)
    expect(inputStarted.data.id).toMatch(/^call_/)
    expect(typeof inputStarted.data.name).toBe('string')

    const inputEnded = eventOfType(EventTypes.SESSION_TOOL_INPUT_ENDED)
    // ⚠️ input.ended **不带 name**（只有 input.started 带）→ store 必须保留已有的 name
    expect((inputEnded.data as { name?: unknown }).name).toBeUndefined()
    expect(typeof inputEnded.data.text).toBe('string')

    const called = eventOfType(EventTypes.SESSION_TOOL_CALLED)
    expect(called.data.id).toBe(inputStarted.data.id)
    expect(typeof called.data.input).toBe('object')

    const success = eventOfType(EventTypes.SESSION_TOOL_SUCCESS)
    expect(Array.isArray(success.data.content)).toBe(true)
    expect(success.data.content[0]?.type).toBe('text')
  })

  it('session.step.ended 的字段路径：finish / rawFinish / cost / tokens', () => {
    const ended = eventOfType(EventTypes.SESSION_STEP_ENDED)
    expect(typeof ended.data.finish).toBe('string')
    expect(typeof ended.data.rawFinish).toBe('string')
    expect(typeof ended.data.cost).toBe('number')
    expect(ended.data.tokens).toMatchObject({
      input: expect.any(Number),
      output: expect.any(Number),
      reasoning: expect.any(Number),
      cache: { read: expect.any(Number), write: expect.any(Number) },
    })
  })

  it('session.step.started 带 agent / model（新建 assistant 消息的权威信号）', () => {
    const started = eventOfType(EventTypes.SESSION_STEP_STARTED)
    expect(started.data.assistantMessageID).toMatch(/^msg_/)
    expect(typeof started.data.agent).toBe('string')
    expect(typeof started.data.model.id).toBe('string')
    expect(typeof started.data.model.providerID).toBe('string')
    expect(typeof started.data.started).toBe('number')
  })

  it('session.execution.* 的字段路径（V2 真正的「一轮开始/结束」信号）', () => {
    expect(eventOfType(EventTypes.SESSION_EXECUTION_STARTED).data.sessionID).toMatch(/^ses_/)
    expect(eventOfType(EventTypes.SESSION_EXECUTION_SUCCEEDED).data.sessionID).toMatch(/^ses_/)
    const interrupted = eventOfType(EventTypes.SESSION_EXECUTION_INTERRUPTED)
    expect(interrupted.data.sessionID).toMatch(/^ses_/)
    expect(interrupted.data.reason).toBe('user')
  })

  it('🔴 实测：session.idle / session.status / session.message.content.updated 都不在下发集合里', () => {
    const types = new Set(REAL_EVENTS.map(event => event.type))
    // 前两个在 schema 里存在（idle 还标了 deprecated），但 v2.0.19 实测从未下发
    expect(types.has(EventTypes.SESSION_IDLE)).toBe(false)
    expect(types.has(EventTypes.SESSION_STATUS)).toBe(false)
    // 第三个有 schema 类型、但不在 V2Event 联合里，实测也不下发
    expect(types.has(EventTypes.SESSION_MESSAGE_CONTENT_UPDATED)).toBe(false)
    // 而 execution.* 一定会下发 → 它就是「一轮结束」的可用信号
    expect(types.has(EventTypes.SESSION_EXECUTION_SUCCEEDED)).toBe(true)
  })
})

// ============================================
// B. 事件合并（背压）
// ============================================

describe('B. coalesceEvents 批量合并', () => {
  it('同一 (session, message, part, kind) 的 delta 合并成一个', async () => {
    const { coalesceEvents } = await loadEventsModule()
    const base = RAW_EVENT_FRAMES.find(f => f.includes('"session.text.delta"'))!
    const a = cloneFrame(base, { delta: 'PON' })
    const b = cloneFrame(base, { delta: 'G' })

    const merged = coalesceEvents([a, b])
    expect(merged).toHaveLength(1)
    expect((merged[0].data as { delta: string }).delta).toBe('PONG')
  })

  it('不同 ordinal 的 delta 不会被合并（part id 不同）', async () => {
    const { coalesceEvents } = await loadEventsModule()
    const base = RAW_EVENT_FRAMES.find(f => f.includes('"session.text.delta"'))!
    const merged = coalesceEvents([
      cloneFrame(base, { ordinal: 0, delta: 'A' }),
      cloneFrame(base, { ordinal: 1, delta: 'B' }),
    ])
    expect(merged).toHaveLength(2)
  })

  it('text 与 reasoning 的 delta 即使 ordinal 相同也不会互相合并', async () => {
    const { coalesceEvents } = await loadEventsModule()
    const textFrame = RAW_EVENT_FRAMES.find(f => f.includes('"session.text.delta"'))!
    const reasoningFrame = RAW_EVENT_FRAMES.find(f => f.includes('"session.reasoning.delta"'))!
    const merged = coalesceEvents([cloneFrame(textFrame, { delta: 'A' }), cloneFrame(reasoningFrame, { delta: 'B' })])
    expect(merged).toHaveLength(2)
  })

  it('整块更新（text.ended）到达后，该 part 在途的 delta 被丢弃', async () => {
    const { coalesceEvents } = await loadEventsModule()
    const delta = cloneFrame(RAW_EVENT_FRAMES.find(f => f.includes('"session.text.delta"'))!, { delta: 'PON' })
    const ended = eventOfType(EventTypes.SESSION_TEXT_ENDED)

    const merged = coalesceEvents([delta, ended])
    // delta 与 ended 的 (session, message, ordinal) 相同 → delta 是多余的
    expect(merged).toHaveLength(1)
    expect(merged[0].type).toBe(EventTypes.SESSION_TEXT_ENDED)
  })

  it('工具整块更新会作废该工具的 input delta（按工具 id 匹配）', async () => {
    const { coalesceEvents } = await loadEventsModule()
    const inputDeltaBase = {
      id: 'evt_x',
      created: 1,
      type: 'session.tool.input.delta',
      data: {
        sessionID: 'ses_a',
        assistantMessageID: 'msg_a',
        id: 'call_a',
        delta: '{"a"',
      },
    }
    const inputEnded = {
      id: 'evt_y',
      created: 2,
      type: 'session.tool.input.ended',
      data: { sessionID: 'ses_a', assistantMessageID: 'msg_a', id: 'call_a', text: '{"a":1}' },
    }
    const merged = coalesceEvents([inputDeltaBase, inputEnded] as V2EventUnion[])
    expect(merged).toHaveLength(1)
    expect(merged[0].type).toBe(EventTypes.SESSION_TOOL_INPUT_ENDED)
  })

  it('单个事件直接返回，不做任何处理', async () => {
    const { coalesceEvents } = await loadEventsModule()
    const one = [eventOfType(EventTypes.SERVER_CONNECTED)]
    expect(coalesceEvents(one)).toBe(one)
  })
})

// ============================================
// C. 分发（真实帧 → 回调）
// ============================================

describe('C. 事件分发（真实帧驱动）', () => {
  it('订阅时会向官方 client 传 signal 与 onActivity', async () => {
    const { subscribeToEvents } = await loadEventsModule()
    const unsubscribe = subscribeToEvents({})
    await waitUntil(() => sdkMocks.lastSubscribeOptions !== null)
    expect(sdkMocks.lastSubscribeOptions).toEqual({ hasSignal: true, hasOnActivity: true })
    unsubscribe()
  })

  it('session.text.started / delta / ended → onPartUpdated + onPartDelta（part id = 消息id:content:下标）', async () => {
    const { subscribeToEvents } = await loadEventsModule()
    const parts: Array<{ kind: string; messageID: string; ordinal?: number; content?: unknown }> = []
    const deltas: Array<{ messageID: string; partID: string; kind: string; delta: string }> = []

    const unsubscribe = subscribeToEvents({
      onPartUpdated: data => parts.push(data as never),
      onPartDelta: data => deltas.push(data),
    })

    const stream = latestStream()
    stream.push(eventOfType(EventTypes.SESSION_TEXT_STARTED))
    stream.push(eventOfType(EventTypes.SESSION_TEXT_DELTA))
    stream.push(eventOfType(EventTypes.SESSION_TEXT_ENDED))
    await waitUntil(() => parts.length === 2 && deltas.length === 1)

    const started = eventOfType(EventTypes.SESSION_TEXT_STARTED)
    const expectedPartId = `${started.data.assistantMessageID}:content:0`

    expect(parts.map(p => p.kind)).toEqual(['content', 'content'])
    expect(parts[0].messageID).toBe(started.data.assistantMessageID)
    expect(parts[0].ordinal).toBe(0)
    expect(parts[1].content).toEqual({ type: 'text', text: eventOfType(EventTypes.SESSION_TEXT_ENDED).data.text })

    // ⚠️ delta 的 partID 必须是**合成**出来的 UI part id，而不是 V2 的字段
    expect(deltas).toHaveLength(1)
    expect(deltas[0].partID).toBe(expectedPartId)
    expect(deltas[0].kind).toBe('text')
    expect(deltas[0].delta).toBe(eventOfType(EventTypes.SESSION_TEXT_DELTA).data.delta)

    unsubscribe()
  })

  it('reasoning 的 delta 走同一个 part id 规则，但 kind 是 reasoning', async () => {
    const { subscribeToEvents } = await loadEventsModule()
    const deltas: Array<{ partID: string; kind: string }> = []
    const unsubscribe = subscribeToEvents({ onPartDelta: data => deltas.push(data) })

    const stream = latestStream()
    stream.push(eventOfType(EventTypes.SESSION_REASONING_DELTA))
    await waitUntil(() => deltas.length === 1)

    const reasoning = eventOfType(EventTypes.SESSION_REASONING_DELTA)
    expect(deltas[0].partID).toBe(`${reasoning.data.assistantMessageID}:content:${reasoning.data.ordinal}`)
    expect(deltas[0].kind).toBe('reasoning')
    unsubscribe()
  })

  it('tool 的 delta 用**工具自己的 id** 作为 partID（不是合成的下标 id）', async () => {
    const { subscribeToEvents } = await loadEventsModule()
    const deltas: Array<{ partID: string; kind: string }> = []
    const unsubscribe = subscribeToEvents({ onPartDelta: data => deltas.push(data) })

    const stream = latestStream()
    stream.push({
      id: 'evt_tool_delta',
      created: 1,
      type: EventTypes.SESSION_TOOL_INPUT_DELTA,
      data: { sessionID: 'ses_a', assistantMessageID: 'msg_a', id: 'call_x', delta: '{"a"' },
    } as V2EventUnion)
    await waitUntil(() => deltas.length === 1)

    expect(deltas[0].partID).toBe('call_x')
    expect(deltas[0].kind).toBe('input')
    unsubscribe()
  })

  it('session.tool.called / success → onPartUpdated（content 块），tool 块带 id 与状态', async () => {
    const { subscribeToEvents } = await loadEventsModule()
    const parts: Array<{ kind: string; content?: { type?: string; id?: string; state?: { status?: string } } }> = []
    const unsubscribe = subscribeToEvents({ onPartUpdated: data => parts.push(data as never) })

    const stream = latestStream()
    stream.push(eventOfType(EventTypes.SESSION_TOOL_CALLED))
    stream.push(eventOfType(EventTypes.SESSION_TOOL_SUCCESS))
    await waitUntil(() => parts.length === 2)

    const called = eventOfType(EventTypes.SESSION_TOOL_CALLED)
    expect(parts[0].content?.type).toBe('tool')
    expect(parts[0].content?.id).toBe(called.data.id)
    expect(parts[0].content?.state?.status).toBe('running')

    const success = eventOfType(EventTypes.SESSION_TOOL_SUCCESS)
    expect(parts[1].content?.id).toBe(success.data.id)
    expect(parts[1].content?.state?.status).toBe('completed')
    unsubscribe()
  })

  it('session.step.started / ended → onPartUpdated 的 step-start / step 变体', async () => {
    const { subscribeToEvents } = await loadEventsModule()
    const parts: Array<{ kind: string; model?: { id: string }; finish?: string; cost?: number }> = []
    const unsubscribe = subscribeToEvents({ onPartUpdated: data => parts.push(data as never) })

    const stream = latestStream()
    stream.push(eventOfType(EventTypes.SESSION_STEP_STARTED))
    stream.push(eventOfType(EventTypes.SESSION_STEP_ENDED))
    await waitUntil(() => parts.length === 2)

    expect(parts[0].kind).toBe('step-start')
    expect(parts[0].model?.id).toBe(eventOfType(EventTypes.SESSION_STEP_STARTED).data.model.id)
    expect(parts[1].kind).toBe('step')
    expect(parts[1].finish).toBe(eventOfType(EventTypes.SESSION_STEP_ENDED).data.finish)
    expect(parts[1].cost).toBe(eventOfType(EventTypes.SESSION_STEP_ENDED).data.cost)
    unsubscribe()
  })

  it('session.execution.succeeded → onSessionIdle + onSessionStatus(idle)', async () => {
    const { subscribeToEvents } = await loadEventsModule()
    const idles: Array<{ sessionID: string }> = []
    const statuses: Array<{ sessionID: string; status: { type: string } }> = []
    const unsubscribe = subscribeToEvents({
      onSessionIdle: data => idles.push(data),
      onSessionStatus: data => statuses.push(data),
    })

    const stream = latestStream()
    stream.push(eventOfType(EventTypes.SESSION_EXECUTION_STARTED))
    stream.push(eventOfType(EventTypes.SESSION_EXECUTION_SUCCEEDED))
    await waitUntil(() => idles.length === 1 && statuses.length === 2)

    const succeeded = eventOfType(EventTypes.SESSION_EXECUTION_SUCCEEDED)
    expect(statuses.map(s => s.status.type)).toEqual(['busy', 'idle'])
    expect(idles).toEqual([{ sessionID: succeeded.data.sessionID }])
    unsubscribe()
  })

  it('session.execution.failed → onSessionError（V2 的扁平错误）+ 状态 idle', async () => {
    const { subscribeToEvents } = await loadEventsModule()
    const errors: Array<{ sessionID: string; error: { type: string; message: string } }> = []
    const statuses: Array<{ status: { type: string } }> = []
    const unsubscribe = subscribeToEvents({
      onSessionError: data => errors.push(data),
      onSessionStatus: data => statuses.push(data),
    })

    const stream = latestStream()
    stream.push({
      id: 'evt_failed',
      created: 1,
      type: EventTypes.SESSION_EXECUTION_FAILED,
      data: { sessionID: 'ses_a', error: { type: 'provider.error', message: 'boom', status: 500 } },
    } as V2EventUnion)
    await waitUntil(() => errors.length === 1)

    expect(errors).toEqual([{ sessionID: 'ses_a', error: { type: 'provider.error', message: 'boom', status: 500 } }])
    expect(statuses[0].status.type).toBe('idle')
    unsubscribe()
  })

  it('session.execution.interrupted → onMessagesInvalidated + onSessionIdle + 状态 idle', async () => {
    const { subscribeToEvents } = await loadEventsModule()
    const invalidated: string[] = []
    const idles: Array<{ sessionID: string }> = []
    const statuses: Array<{ status: { type: string } }> = []
    const unsubscribe = subscribeToEvents({
      onMessagesInvalidated: id => invalidated.push(id),
      onSessionIdle: data => idles.push(data),
      onSessionStatus: data => statuses.push(data),
    })

    const stream = latestStream()
    stream.push(eventOfType(EventTypes.SESSION_EXECUTION_INTERRUPTED))
    await waitUntil(() => invalidated.length === 1)

    const sessionID = eventOfType(EventTypes.SESSION_EXECUTION_INTERRUPTED).data.sessionID
    // 中断也必须让 isStreaming 落回 false（否则界面会一直停在"生成中"）
    expect(invalidated).toEqual([sessionID])
    expect(idles).toEqual([{ sessionID }])
    expect(statuses.map(s => s.status.type)).toEqual(['idle'])
    unsubscribe()
  })

  it('session.revert.* → onMessagesInvalidated（触发重拉）', async () => {
    const { subscribeToEvents } = await loadEventsModule()
    const invalidated: string[] = []
    const unsubscribe = subscribeToEvents({ onMessagesInvalidated: id => invalidated.push(id) })

    const stream = latestStream()
    stream.push({
      id: 'evt_revert',
      created: 1,
      type: EventTypes.SESSION_REVERT_STAGED,
      data: { sessionID: 'ses_revert' },
    } as V2EventUnion)
    await waitUntil(() => invalidated.length === 1)

    expect(invalidated).toEqual(['ses_revert'])
    unsubscribe()
  })

  it('session.created → onSessionCreated（事件字段映射成内部 ApiSession）', async () => {
    const { subscribeToEvents } = await loadEventsModule()
    const created: Array<{
      id: string
      directory: string
      title: string
      parentID?: string
      time: { created: number }
    }> = []
    const unsubscribe = subscribeToEvents({ onSessionCreated: session => created.push(session) })

    const stream = latestStream()
    stream.push(eventOfType(EventTypes.SESSION_CREATED))
    await waitUntil(() => created.length === 1)

    const event = eventOfType(EventTypes.SESSION_CREATED)
    expect(created).toHaveLength(1)
    // ⚠️ 事件里是 sessionID，内部模型用 id
    expect(created[0].id).toBe(event.data.sessionID)
    expect(created[0].directory).toBe(event.data.location.directory)
    // 事件里没有 time → 用事件自身的 created 兜底
    expect(created[0].time.created).toBe((event as { created?: number }).created)
    unsubscribe()
  })

  it('session.renamed / moved → onSessionUpdated 的**部分补丁**', async () => {
    const { subscribeToEvents } = await loadEventsModule()
    const patches: Array<{ id: string; title?: string; directory?: string }> = []
    const unsubscribe = subscribeToEvents({ onSessionUpdated: patch => patches.push(patch) })

    const stream = latestStream()
    stream.push(eventOfType(EventTypes.SESSION_RENAMED))
    stream.push({
      id: 'evt_moved',
      created: 1,
      type: EventTypes.SESSION_MOVED,
      data: { sessionID: 'ses_a', location: { directory: '/tmp/x' }, projectID: 'p' },
    } as V2EventUnion)
    await waitUntil(() => patches.length === 2)

    expect(patches[0]).toEqual({
      id: eventOfType(EventTypes.SESSION_RENAMED).data.sessionID,
      title: eventOfType(EventTypes.SESSION_RENAMED).data.title,
    })
    expect(patches[1]).toEqual({ id: 'ses_a', directory: '/tmp/x' })
    unsubscribe()
  })

  it('session.deleted → onSessionDeleted({sessionID})', async () => {
    const { subscribeToEvents } = await loadEventsModule()
    const deleted: Array<{ sessionID: string }> = []
    const unsubscribe = subscribeToEvents({ onSessionDeleted: data => deleted.push(data) })

    const stream = latestStream()
    stream.push({
      id: 'evt_del',
      created: 1,
      type: EventTypes.SESSION_DELETED,
      data: { sessionID: 'ses_gone' },
    } as V2EventUnion)
    await waitUntil(() => deleted.length === 1)

    expect(deleted).toEqual([{ sessionID: 'ses_gone' }])
    unsubscribe()
  })

  it('server.connected → onServerConnected（V2 没有 timestamp，尽力而为地给 created）', async () => {
    const { subscribeToEvents } = await loadEventsModule()
    const connected: Array<{ timestamp?: unknown }> = []
    const unsubscribe = subscribeToEvents({ onServerConnected: data => connected.push(data) })

    const stream = latestStream()
    stream.push(eventOfType(EventTypes.SERVER_CONNECTED))
    await waitUntil(() => connected.length === 1)

    expect(connected).toHaveLength(1)
    // 首帧没有 created → timestamp 为 undefined（serverStore 会静默忽略）
    expect(connected[0].timestamp).toBeUndefined()
    unsubscribe()
  })

  it('未处理的事件类型被静默忽略（不会抛错）', async () => {
    const { subscribeToEvents } = await loadEventsModule()
    const onError = vi.fn()
    const parts: unknown[] = []
    const unsubscribe = subscribeToEvents({ onError, onPartUpdated: data => parts.push(data) })

    const stream = latestStream()
    stream.push({ id: 'evt_x', created: 1, type: 'agent.updated', data: {} } as V2EventUnion)
    stream.push(eventOfType(EventTypes.SESSION_TEXT_ENDED))
    await waitUntil(() => parts.length === 1)

    expect(onError).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('真实帧整批喂进去不会抛错，且 server.connected 是第一个被分发的', async () => {
    const { subscribeToEvents } = await loadEventsModule()
    const order: string[] = []
    const unsubscribe = subscribeToEvents({
      onServerConnected: () => order.push('connected'),
      onSessionCreated: () => order.push('session.created'),
      onPartUpdated: () => order.push('part'),
      onPartDelta: () => order.push('delta'),
      onSessionIdle: () => order.push('idle'),
      onSessionUpdated: () => order.push('session.updated'),
      onError: error => order.push(`error:${error.message}`),
    })

    const stream = latestStream()
    for (const event of REAL_EVENTS) stream.push(event)
    await waitUntil(() => order.includes('idle') && order.includes('session.updated'))

    expect(order[0]).toBe('connected')
    expect(order).not.toContain('error')
    unsubscribe()
  })
})

// ============================================
// D. 连接管理
// ============================================

describe('D. 连接管理', () => {
  it('第一个订阅者触发连接，取消最后一个订阅者会拆掉连接', async () => {
    const { subscribeToEvents, getConnectionInfo, getServerConnectionInfo } = await loadEventsModule()

    const unsubscribe = subscribeToEvents({})
    await waitUntil(() => sdkMocks.subscribeCalls === 1)
    expect(sdkMocks.subscribeCalls).toBe(1)

    latestStream().push(eventOfType(EventTypes.SERVER_CONNECTED))
    await waitForState(getConnectionInfo, 'connected')

    unsubscribe()
    expect(getServerConnectionInfo('local').state).toBe('disconnected')
    expect(sdkMocks.streams).toHaveLength(1)
  })

  it('连接成功会广播 onReconnected(network)（驱动上层重拉）', async () => {
    const { subscribeToEvents } = await loadEventsModule()
    const reasons: string[] = []
    const unsubscribe = subscribeToEvents({ onReconnected: reason => reasons.push(reason) })

    latestStream().push(eventOfType(EventTypes.SERVER_CONNECTED))
    await waitUntil(() => reasons.length === 1)

    expect(reasons).toEqual(['network'])
    unsubscribe()
  })

  it('流结束 → 状态 disconnected，并按退避重连（新建第二条流）', async () => {
    // ⚠️ 这里**不用假定时器**：重连退避是真实 setTimeout，
    //    而 waitUntil 依赖真实时钟推进；用假定时器会让两者互相卡死。
    //    RECONNECT_DELAYS[0] = 1000ms，等 1 秒是可接受的测试成本。
    const { subscribeToEvents, getConnectionInfo } = await loadEventsModule()
    const unsubscribe = subscribeToEvents({})

    latestStream().push(eventOfType(EventTypes.SERVER_CONNECTED))
    await waitUntil(() => getConnectionInfo().state === 'connected')
    expect(getConnectionInfo().state).toBe('connected')

    latestStream().finish()
    await waitUntil(() => getConnectionInfo().state === 'disconnected')
    expect(getConnectionInfo().state).toBe('disconnected')

    await waitUntil(() => sdkMocks.subscribeCalls === 2, 4000)
    expect(sdkMocks.subscribeCalls).toBe(2)
    expect(getConnectionInfo().reconnectAttempt).toBe(1)

    unsubscribe()
  })

  it('流出错 → onError + 状态 error，并安排重连', async () => {
    const { subscribeToEvents, getConnectionInfo } = await loadEventsModule()
    const onError = vi.fn()
    const unsubscribe = subscribeToEvents({ onError })

    latestStream().push(eventOfType(EventTypes.SERVER_CONNECTED))
    await waitUntil(() => getConnectionInfo().state === 'connected')

    latestStream().fail(new Error('stream exploded'))
    await waitUntil(() => onError.mock.calls.length === 1)

    expect(onError).toHaveBeenCalledTimes(1)
    expect(getConnectionInfo().state).toBe('error')

    // 退避 1000ms 后应重连
    await waitUntil(() => sdkMocks.subscribeCalls === 2, 4000)
    expect(sdkMocks.subscribeCalls).toBe(2)
    unsubscribe()
  })

  it('代次防串扰：reconnect 之后旧流的事件被丢弃', async () => {
    const { subscribeToEvents, reconnectServerSSE, getConnectionInfo } = await loadEventsModule()
    const parts: unknown[] = []
    const unsubscribe = subscribeToEvents({ onPartUpdated: data => parts.push(data) })

    const first = latestStream()
    first.push(eventOfType(EventTypes.SERVER_CONNECTED))
    await waitUntil(() => getConnectionInfo().state === 'connected')

    reconnectServerSSE('local')
    await waitUntil(() => sdkMocks.subscribeCalls === 2)
    const second = latestStream()
    expect(second).not.toBe(first)

    // 新流的事件应当到达
    second.push(eventOfType(EventTypes.SESSION_TEXT_ENDED))
    await waitUntil(() => parts.length === 1)
    expect(parts).toHaveLength(1)

    // 旧流再推事件应被丢弃
    first.push(eventOfType(EventTypes.SESSION_TEXT_STARTED))
    await flushMicrotasks(10)
    expect(parts).toHaveLength(1)

    unsubscribe()
  })

  it('reconnectServerSSE 成功后广播 onReconnected(server-switch)', async () => {
    const { subscribeToEvents, reconnectServerSSE } = await loadEventsModule()
    const reasons: string[] = []
    const unsubscribe = subscribeToEvents({ onReconnected: reason => reasons.push(reason) })

    latestStream().push(eventOfType(EventTypes.SERVER_CONNECTED))
    await waitUntil(() => reasons.length === 1)

    reconnectServerSSE('local')
    await waitUntil(() => sdkMocks.subscribeCalls === 2)
    latestStream().push(eventOfType(EventTypes.SERVER_CONNECTED))
    await waitUntil(() => reasons.length === 2)

    expect(reasons).toEqual(['network', 'server-switch'])
    unsubscribe()
  })

  it('onActivity（含心跳）会刷新 lastEventTime', async () => {
    const { subscribeToEvents, getConnectionInfo } = await loadEventsModule()
    const unsubscribe = subscribeToEvents({})
    latestStream().push(eventOfType(EventTypes.SERVER_CONNECTED))
    await waitUntil(() => getConnectionInfo().state === 'connected')

    const before = getConnectionInfo().lastEventTime
    await new Promise(resolve => setTimeout(resolve, 5))
    latestStream().activity()
    expect(getConnectionInfo().lastEventTime).toBeGreaterThanOrEqual(before)
    unsubscribe()
  })

  it('subscribeToEvents 跟随活动服务器迁移订阅（真实切换）', async () => {
    const { subscribeToEvents } = await loadEventsModule()
    const unsubscribe = subscribeToEvents({})
    await waitUntil(() => sdkMocks.subscribeCalls === 1)
    expect(sdkMocks.subscribeCalls).toBe(1)

    // 非 active 服务器的 runtime 变化：不动订阅
    storeMocks.activeServerId = 'wsl:Ubuntu'
    for (const listener of storeMocks.changeListeners) listener('wsl:Ubuntu', 'server-runtime-updated')
    await flushMicrotasks(10)
    expect(sdkMocks.subscribeCalls).toBe(1)

    // 真实切换：拆旧建新
    storeMocks.activeServerId = 'wsl:Ubuntu'
    for (const listener of storeMocks.changeListeners) listener('wsl:Ubuntu', 'server-switch')
    await waitUntil(() => sdkMocks.subscribeCalls === 2)
    expect(sdkMocks.subscribeCalls).toBe(2)

    unsubscribe()
  })

  it('没有订阅者时不重连', async () => {
    const { subscribeToEvents, getConnectionInfo } = await loadEventsModule()
    const unsubscribe = subscribeToEvents({})
    latestStream().push(eventOfType(EventTypes.SERVER_CONNECTED))
    await waitUntil(() => getConnectionInfo().state === 'connected')

    latestStream().finish()
    await flushMicrotasks(10)
    unsubscribe()
    await flushMicrotasks(10)

    // 退避窗口（1000ms）过后仍应只有一条流
    await new Promise(resolve => setTimeout(resolve, 1300))
    await flushMicrotasks(10)
    expect(sdkMocks.subscribeCalls).toBe(1)
  })
})
