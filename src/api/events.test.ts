import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventTypes } from '../types/api/event'

vi.mock('./http', () => ({
  getApiBaseUrl: () => 'http://example.test',
  getAuthHeader: () => ({}),
}))

vi.mock('../utils/tauri', () => ({
  isTauri: () => false,
}))

const encoder = new TextEncoder()

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const result = new Uint8Array(total)
  let offset = 0

  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }

  return result
}

function createEventChunks(delta: string, splitAt: number): Uint8Array[] {
  const marker = '__DELTA__'
  const raw = `data: ${JSON.stringify({
    directory: 'global',
    payload: {
      type: EventTypes.MESSAGE_PART_DELTA,
      properties: {
        messageID: 'session-1',
        partID: 'part-1',
        field: 'text',
        delta: marker,
      },
    },
  })}\n\n`

  const [before, after] = raw.split(marker)
  const deltaBytes = encoder.encode(delta)

  return [
    concatBytes(encoder.encode(before), deltaBytes.slice(0, splitAt)),
    concatBytes(deltaBytes.slice(splitAt), encoder.encode(after)),
  ]
}

function createStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk)
      }
      controller.close()
    },
  })
}

function createFetchResponse(chunks: Uint8Array[]): Pick<Response, 'ok' | 'body'> {
  return {
    ok: true,
    body: createStream(chunks) as Response['body'],
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function createEventChunk(payload: object): Uint8Array[] {
  return [encoder.encode(`data: ${JSON.stringify({ directory: 'global', payload })}\n\n`)]
}

describe('subscribeToEvents', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('preserves Chinese text when UTF-8 bytes are split across chunks', async () => {
    const fetchMock = vi.fn().mockResolvedValue(createFetchResponse(createEventChunks('中文', 2)))
    vi.stubGlobal('fetch', fetchMock)

    const { subscribeToEvents } = await import('./events')

    const received = await new Promise<string>((resolve, reject) => {
      const unsubscribe = subscribeToEvents({
        onPartDelta(data) {
          unsubscribe()
          resolve(data.delta)
        },
        onError(error) {
          unsubscribe()
          reject(error)
        },
      })
    })

    expect(received).toBe('中文')
  })

  it('preserves four-byte characters when split in the middle', async () => {
    const fetchMock = vi.fn().mockResolvedValue(createFetchResponse(createEventChunks('𠮷😀', 3)))
    vi.stubGlobal('fetch', fetchMock)

    const { subscribeToEvents } = await import('./events')

    const received = await new Promise<string>((resolve, reject) => {
      const unsubscribe = subscribeToEvents({
        onPartDelta(data) {
          unsubscribe()
          resolve(data.delta)
        },
        onError(error) {
          unsubscribe()
          reject(error)
        },
      })
    })

    expect(received).toBe('𠮷😀')
  })

  it('dispatches server.connected payloads with timestamp', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createFetchResponse(
        createEventChunk({
          type: EventTypes.SERVER_CONNECTED,
          properties: { timestamp: '2026-04-22T15:00:00.000Z' },
        }),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const { subscribeToEvents } = await import('./events')

    const received = await new Promise<unknown>((resolve, reject) => {
      const unsubscribe = subscribeToEvents({
        onServerConnected(data) {
          unsubscribe()
          resolve(data.timestamp)
        },
        onError(error) {
          unsubscribe()
          reject(error)
        },
      })
    })

    expect(received).toBe('2026-04-22T15:00:00.000Z')
  })

  it('ignores stale server.connected events from an old browser SSE generation after reconnect', async () => {
    const firstFetch = createDeferred<Pick<Response, 'ok' | 'body'>>()
    const secondFetch = createDeferred<Pick<Response, 'ok' | 'body'>>()
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => firstFetch.promise)
      .mockImplementationOnce(() => secondFetch.promise)
    vi.stubGlobal('fetch', fetchMock)

    const { subscribeToEvents, reconnectSSE } = await import('./events')
    const received: string[] = []

    const unsubscribe = subscribeToEvents({
      onServerConnected(data) {
        if (typeof data.timestamp === 'string') {
          received.push(data.timestamp)
        }
      },
    })

    reconnectSSE()

    secondFetch.resolve(
      createFetchResponse(
        createEventChunk({
          type: EventTypes.SERVER_CONNECTED,
          properties: { timestamp: 'new-server-time' },
        }),
      ),
    )

    await vi.waitFor(() => {
      expect(received).toEqual(['new-server-time'])
    })

    firstFetch.resolve(
      createFetchResponse(
        createEventChunk({
          type: EventTypes.SERVER_CONNECTED,
          properties: { timestamp: 'stale-server-time' },
        }),
      ),
    )

    await Promise.resolve()
    await Promise.resolve()

    expect(received).toEqual(['new-server-time'])
    unsubscribe()
  })

  it('ignores stale browser fetch failures from an old SSE generation after reconnect', async () => {
    const firstFetch = createDeferred<Pick<Response, 'ok' | 'body'>>()
    const secondFetch = createDeferred<Pick<Response, 'ok' | 'body'>>()
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => firstFetch.promise)
      .mockImplementationOnce(() => secondFetch.promise)
    vi.stubGlobal('fetch', fetchMock)

    const { subscribeToEvents, reconnectSSE, getConnectionInfo } = await import('./events')
    const onError = vi.fn()

    const unsubscribe = subscribeToEvents({
      onError,
    })

    reconnectSSE()

    firstFetch.reject(new Error('stale failure'))

    await Promise.resolve()
    await Promise.resolve()

    expect(onError).not.toHaveBeenCalled()
    expect(getConnectionInfo().state).toBe('connecting')

    secondFetch.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    unsubscribe()
  })
})
