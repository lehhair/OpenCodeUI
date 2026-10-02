import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================
// 事件订阅测试（OpenCode v2）
//
// v1 时期这里测试的是**手写的 SSE 解析器**：UTF-8 分块、事件合并、
// 迟到的旧代次事件丢弃等。v2 把这些交给客户端的 `event.subscribe()`
// （内部 `/api/event` + text/event-stream），因此那些用例连同实现一起删除了。
//
// 仍然属于本仓库职责、值得测试的是：
//   1. 扁平 v2 事件被正确分派到对应的 EventCallbacks
//   2. 订阅生命周期（订阅/退订 / 连接状态广播 / 活动服务器迁移）
// ============================================

/** 一个可控的事件流：测试里手动往里推事件 */
function createEventStream() {
  let push: ((event: unknown) => void) | null = null
  let closed = false

  const stream = {
    [Symbol.asyncIterator]() {
      const queue: unknown[] = []
      const waiters: Array<(value: IteratorResult<unknown>) => void> = []

      push = (event: unknown) => {
        const waiter = waiters.shift()
        if (waiter) waiter({ value: event, done: false })
        else queue.push(event)
      }

      return {
        next(): Promise<IteratorResult<unknown>> {
          if (queue.length > 0) {
            return Promise.resolve({ value: queue.shift(), done: false })
          }
          if (closed) return Promise.resolve({ value: undefined, done: true })
          return new Promise(resolve => waiters.push(resolve))
        },
        return(): Promise<IteratorResult<unknown>> {
          closed = true
          return Promise.resolve({ value: undefined, done: true })
        },
      }
    },
  }

  return {
    stream,
    emit(event: unknown) {
      push?.(event)
    },
    close() {
      closed = true
    },
  }
}

const subscribeMock = vi.hoisted(() => vi.fn())

vi.mock('./sdk', () => ({
  getSDKClient: () => ({
    event: { subscribe: subscribeMock },
  }),
  invalidateSDKClient: () => {},
}))

/** 构造一个 v2 扁平事件 */
function v2Event(type: string, data: unknown) {
  return { id: `evt-${type}`, created: Date.now(), type, data }
}

describe('v2 event dispatch', () => {
  beforeEach(() => {
    vi.resetModules()
    subscribeMock.mockReset()
    localStorage.clear()
    sessionStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('dispatches flat v2 events to the matching callbacks', async () => {
    const harness = createEventStream()
    subscribeMock.mockReturnValue(harness.stream)

    const { subscribeToServerEvents } = await import('./events')

    const onTextDelta = vi.fn()
    const onToolCalled = vi.fn()
    const onSessionIdle = vi.fn()
    const onFormCreated = vi.fn()

    const unsubscribe = subscribeToServerEvents('test-server', {
      onTextDelta,
      onToolCalled,
      onSessionIdle,
      onFormCreated,
    })

    // 让 connectServer 的 for-await 真正挂上
    await Promise.resolve()

    harness.emit(
      v2Event('session.text.delta', {
        sessionID: 's1',
        assistantMessageID: 'm1',
        ordinal: 0,
        delta: 'hello',
      }),
    )
    harness.emit(
      v2Event('session.tool.called', {
        sessionID: 's1',
        assistantMessageID: 'm1',
        id: 'tool-1',
        input: {},
        executed: false,
      }),
    )
    harness.emit(v2Event('session.idle', { sessionID: 's1' }))
    harness.emit(v2Event('form.created', { id: 'f1', sessionID: 's1', title: 'Q', fields: [] }))

    await new Promise(resolve => setTimeout(resolve, 0))

    // 第二个参数是信封 facts（id / created / metadata），store 用它派生消息 id 与时间
    const facts = expect.objectContaining({ id: expect.any(String), created: expect.any(Number) })

    expect(onTextDelta).toHaveBeenCalledWith(
      expect.objectContaining({ sessionID: 's1', ordinal: 0, delta: 'hello' }),
      facts,
    )
    expect(onToolCalled).toHaveBeenCalledWith(expect.objectContaining({ id: 'tool-1' }), facts)
    expect(onSessionIdle).toHaveBeenCalledWith({ sessionID: 's1' }, facts)
    expect(onFormCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'f1' }), facts)

    unsubscribe()
  })

  it('ignores event types the UI does not consume', async () => {
    const harness = createEventStream()
    subscribeMock.mockReturnValue(harness.stream)

    const { subscribeToServerEvents } = await import('./events')
    const onTextDelta = vi.fn()

    const unsubscribe = subscribeToServerEvents('test-server', { onTextDelta })
    await Promise.resolve()

    // v2 有 100 种事件；UI 只消费其中一部分，其余的必须安全忽略
    harness.emit(v2Event('models-dev.refreshed', {}))
    harness.emit(v2Event('credential.updated', {}))
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(onTextDelta).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('reports connection state transitions', async () => {
    const harness = createEventStream()
    subscribeMock.mockReturnValue(harness.stream)

    const { subscribeToServerEvents, getServerConnectionInfo } = await import('./events')

    expect(getServerConnectionInfo('test-server').state).toBe('disconnected')

    const unsubscribe = subscribeToServerEvents('test-server', {})
    await Promise.resolve()
    expect(getServerConnectionInfo('test-server').state).toBe('connecting')

    // 收到任意事件后标记为已连接
    harness.emit(v2Event('session.idle', { sessionID: 's1' }))
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(getServerConnectionInfo('test-server').state).toBe('connected')
    unsubscribe()
  })

  it('stops delivering after unsubscribe', async () => {
    const harness = createEventStream()
    subscribeMock.mockReturnValue(harness.stream)

    const { subscribeToServerEvents, getServerConnectionInfo } = await import('./events')
    const onTextDelta = vi.fn()

    const unsubscribe = subscribeToServerEvents('test-server', { onTextDelta })
    await Promise.resolve()

    harness.emit(v2Event('session.text.delta', { sessionID: 's', assistantMessageID: 'm', ordinal: 0, delta: 'a' }))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(onTextDelta).toHaveBeenCalledTimes(1)

    unsubscribe()
    expect(getServerConnectionInfo('test-server').state).toBe('disconnected')
  })
})
