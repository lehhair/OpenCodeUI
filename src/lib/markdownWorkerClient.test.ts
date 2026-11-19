import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { MarkdownWorkerRequest } from '../workers/markdownWorker'
import {
  parseMarkdownInWorker,
  resetMarkdownWorkerClientForTests,
  type MarkdownParseResult,
} from './markdownWorkerClient'

class FakeWorker {
  static instances: FakeWorker[] = []
  static throwOnCreate = false

  posted: MarkdownWorkerRequest[] = []
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: ((event: { preventDefault?: () => void }) => void) | null = null
  terminated = false

  constructor() {
    if (FakeWorker.throwOnCreate) throw new Error('Worker unavailable')
    FakeWorker.instances.push(this)
  }

  postMessage(message: MarkdownWorkerRequest) {
    this.posted.push(message)
  }

  terminate() {
    this.terminated = true
  }

  respond(message: unknown) {
    this.onmessage?.({ data: message })
  }
}

const originalWorker = globalThis.Worker

function flush() {
  return new Promise<void>(resolve => {
    setTimeout(resolve, 0)
  })
}

beforeEach(() => {
  resetMarkdownWorkerClientForTests()
  FakeWorker.instances = []
  FakeWorker.throwOnCreate = false
  globalThis.Worker = FakeWorker as unknown as typeof Worker
})

afterEach(() => {
  resetMarkdownWorkerClientForTests()
  globalThis.Worker = originalWorker
})

describe('markdownWorkerClient', () => {
  it('返回解析结果并带上对应的 src', async () => {
    const promise = parseMarkdownInWorker({ key: 'a', src: '# hi', isReasoning: false, renderHtml: true })
    const worker = FakeWorker.instances[0]!
    expect(worker.posted[0]?.src).toBe('# hi')

    worker.respond({ type: 'parsed', id: worker.posted[0]!.id, key: 'a', html: '<h1>hi</h1>' })

    await expect(promise).resolves.toEqual({ status: 'ok', src: '# hi', html: '<h1>hi</h1>' })
  })

  it('排队中的同一块只解析最新内容', async () => {
    const first = parseMarkdownInWorker({ key: 'a', src: 'first', isReasoning: false, renderHtml: true })
    const second = parseMarkdownInWorker({ key: 'b', src: 'old', isReasoning: false, renderHtml: true })
    const third = parseMarkdownInWorker({ key: 'b', src: 'new', isReasoning: false, renderHtml: true })

    const worker = FakeWorker.instances[0]!
    worker.respond({ type: 'parsed', id: worker.posted[0]!.id, key: 'a', html: 'first' })
    await flush()

    expect(worker.posted).toHaveLength(2)
    expect(worker.posted[1]?.src).toBe('new')

    worker.respond({ type: 'parsed', id: worker.posted[1]!.id, key: 'b', html: 'new' })

    expect(await first).toEqual({ status: 'ok', src: 'first', html: 'first' })
    const merged: Array<MarkdownParseResult> = [await second, await third]
    expect(merged).toEqual([
      { status: 'ok', src: 'new', html: 'new' },
      { status: 'ok', src: 'new', html: 'new' },
    ])
  })

  it('worker 创建失败时返回 unavailable，交给主线程兜底', async () => {
    FakeWorker.throwOnCreate = true
    await expect(
      parseMarkdownInWorker({ key: 'a', src: 'x', isReasoning: false, renderHtml: true }),
    ).resolves.toEqual({ status: 'unavailable' })
  })

  it('worker 崩溃时结算所有等待者并进入冷却', async () => {
    const promise = parseMarkdownInWorker({ key: 'a', src: 'x', isReasoning: false, renderHtml: true })
    const worker = FakeWorker.instances[0]!
    worker.onerror?.({})

    await expect(promise).resolves.toEqual({ status: 'unavailable' })
    await expect(
      parseMarkdownInWorker({ key: 'b', src: 'y', isReasoning: false, renderHtml: true }),
    ).resolves.toEqual({ status: 'unavailable' })
  })
})
