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
})
