import type { MarkdownWorkerRequest, MarkdownWorkerResponse } from '../workers/markdownWorker'

export type MarkdownParseResult =
  /** 解析成功；`src` 是这次解析的输入，调用方据此判断是否已经过期 */
  | { status: 'ok'; src: string; html: string }
  /** worker 不可用（环境不支持或连续失败），调用方回退到主线程同步解析 */
  | { status: 'unavailable' }
  /** 同一个块已经有更新的请求，这次结果可以丢弃 */
  | { status: 'superseded' }

export type MarkdownParseParams = {
  /** 每个 Markdown 块一个稳定的 key，用于合并同一块的连续请求 */
  key: string
  src: string
  isReasoning: boolean
  renderHtml: boolean
}

type Waiter = (result: MarkdownParseResult) => void

type ParseJob = {
  id: number
  key: string
  src: string
  isReasoning: boolean
  renderHtml: boolean
  waiters: Waiter[]
}

let worker: Worker | null = null
let nextId = 1
let draining = false
/** worker 创建失败后冷却一段时间，避免每个大块都尝试新建一次 */
let unavailableUntil = 0

const UNAVAILABLE_COOLDOWN_MS = 5000

const queue: ParseJob[] = []
const queuedByKey = new Map<string, ParseJob>()
const pending = new Map<number, { job: ParseJob; resolve: Waiter }>()

function isAvailable(): boolean {
  return performance.now() >= unavailableUntil
}

function markUnavailable() {
  unavailableUntil = performance.now() + UNAVAILABLE_COOLDOWN_MS
}

function resolveJob(job: ParseJob, result: MarkdownParseResult) {
  for (const waiter of job.waiters) waiter(result)
  job.waiters = []
}

function failPending() {
  worker?.terminate()
  worker = null
  markUnavailable()
  pending.forEach(({ resolve }) => resolve({ status: 'unavailable' }))
  pending.clear()
  for (const job of queue) resolveJob(job, { status: 'unavailable' })
  queue.length = 0
  queuedByKey.clear()
}

function getWorker(): Worker | null {
  if (worker) return worker
  if (!isAvailable()) return null

  try {
    worker = new Worker(new URL('../workers/markdownWorker.ts', import.meta.url), { type: 'module' })
  } catch {
    markUnavailable()
    return null
  }

  worker.onmessage = (event: MessageEvent<MarkdownWorkerResponse>) => {
    const msg = event.data
    const entry = pending.get(msg.id)
    if (!entry) return
    pending.delete(msg.id)
    if (msg.type === 'parsed') {
      entry.resolve({ status: 'ok', src: entry.job.src, html: msg.html })
    } else {
      // 解析抛错：让调用方走同步路径，行为与以前一致
      entry.resolve({ status: 'unavailable' })
    }
  }

  worker.onerror = event => {
    event.preventDefault?.()
    failPending()
  }

  return worker
}

function sendJob(job: ParseJob): Promise<MarkdownParseResult> {
  const w = getWorker()
  if (!w) return Promise.resolve({ status: 'unavailable' })

  return new Promise<MarkdownParseResult>(resolve => {
    pending.set(job.id, { job, resolve })
    w.postMessage({
      type: 'parse',
      id: job.id,
      key: job.key,
      src: job.src,
      isReasoning: job.isReasoning,
      renderHtml: job.renderHtml,
    } satisfies MarkdownWorkerRequest)
  })
}

async function drain() {
  if (draining) return
  draining = true
  try {
    while (queue.length > 0) {
      const job = queue.shift()
      if (!job) break
      queuedByKey.delete(job.key)
      const result = await sendJob(job)
      resolveJob(job, result)
    }
  } finally {
    draining = false
  }
}

/**
 * 把 Markdown 解析交给 worker。
 *
 * 同一个 key 的请求在排队阶段会合并：只解析最新的内容，旧请求统一拿最新结果
 * （调用方按 `src` 判断是否过期）。worker 不可用时返回 `unavailable`。
 */
export function parseMarkdownInWorker(params: MarkdownParseParams): Promise<MarkdownParseResult> {
  const existing = queuedByKey.get(params.key)
  if (existing) {
    existing.src = params.src
    existing.isReasoning = params.isReasoning
    existing.renderHtml = params.renderHtml
    return new Promise(resolve => existing.waiters.push(resolve))
  }

  const job: ParseJob = {
    id: nextId++,
    key: params.key,
    src: params.src,
    isReasoning: params.isReasoning,
    renderHtml: params.renderHtml,
    waiters: [],
  }
  const result = new Promise<MarkdownParseResult>(resolve => job.waiters.push(resolve))
  queue.push(job)
  queuedByKey.set(job.key, job)
  void drain()
  return result
}

/** 块卸载或内容回退时取消排队中的解析，已在解析的请求结果由调用方忽略 */
export function cancelMarkdownParse(key: string) {
  const job = queuedByKey.get(key)
  if (!job) return
  queuedByKey.delete(key)
  const index = queue.indexOf(job)
  if (index >= 0) queue.splice(index, 1)
  resolveJob(job, { status: 'superseded' })
}

/** 仅测试用：重置内部状态 */
export function resetMarkdownWorkerClientForTests() {
  worker?.terminate()
  worker = null
  unavailableUntil = 0
  queue.length = 0
  queuedByKey.clear()
  pending.clear()
  draining = false
}
