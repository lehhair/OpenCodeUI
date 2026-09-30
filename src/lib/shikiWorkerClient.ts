import type { BundledTheme } from 'shiki/themes'
import type { WorkerRequest, WorkerResponse, WorkerToken } from '../workers/shikiWorker'
import type { HighlightTokens } from './highlightTypes'
import {
  DEFAULT_CODE_BLOCK_THEME_DARK,
  DEFAULT_CODE_BLOCK_THEME_LIGHT,
  normalizeCodeBlockTheme,
} from './codeBlockThemes'

type PendingRequest = {
  resolve: (response: WorkerResponse) => void
  reject: (error: unknown) => void
}

let worker: Worker | null = null
let workerReady: Promise<void> | null = null
let workerReadyPromiseResolve: (() => void) | null = null
let workerReadyPromiseReject: ((error: unknown) => void) | null = null
let nextId = 1

const pendingRequests = new Map<number, PendingRequest>()
const latestRequestByKey = new Map<string, number>()

function getWorker(): Worker {
  if (worker) return worker

  worker = new Worker(new URL('../workers/shikiWorker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const msg = event.data
    if (msg.type === 'ready') {
      workerReadyPromiseResolve?.()
      workerReadyPromiseResolve = null
      workerReadyPromiseReject = null
      return
    }

    if (msg.type === 'init-error') {
      workerReadyPromiseReject?.(new Error(msg.message))
      workerReady = null
      workerReadyPromiseResolve = null
      workerReadyPromiseReject = null
      worker?.terminate()
      worker = null
      return
    }

    if (!('id' in msg)) return
    const pending = pendingRequests.get(msg.id)
    if (!pending) return

    pendingRequests.delete(msg.id)
    if (msg.type === 'error') {
      pending.reject(new Error(msg.message))
    } else if (msg.type === 'superseded') {
      pending.reject(new Error('superseded'))
    } else {
      pending.resolve(msg)
    }
  }

  worker.onerror = error => {
    workerReadyPromiseReject?.(error)
    pendingRequests.forEach(pending => pending.reject(error))
    pendingRequests.clear()
    workerReady = null
    workerReadyPromiseResolve = null
    workerReadyPromiseReject = null
    worker = null
  }

  return worker
}

export function ensureShikiWorkerReady(): Promise<void> {
  if (workerReady) return workerReady

  workerReady = new Promise((resolve, reject) => {
    workerReadyPromiseResolve = resolve
    workerReadyPromiseReject = reject
  })
  // 预加载用户当前选择的主题；其他主题在第一次 highlight 时 lazy load。
  // 用 localStorage 直接读避免循环依赖（themeStore 也会反向引用此模块树）。
  const light = normalizeCodeBlockTheme(
    (typeof localStorage !== 'undefined' && localStorage.getItem('code-block-theme-light')) ||
      DEFAULT_CODE_BLOCK_THEME_LIGHT,
    DEFAULT_CODE_BLOCK_THEME_LIGHT,
  )
  const dark = normalizeCodeBlockTheme(
    (typeof localStorage !== 'undefined' && localStorage.getItem('code-block-theme-dark')) ||
      DEFAULT_CODE_BLOCK_THEME_DARK,
    DEFAULT_CODE_BLOCK_THEME_DARK,
  )
  const themes = Array.from(new Set<BundledTheme>([light, dark]))
  getWorker().postMessage({ type: 'init', themes } satisfies WorkerRequest)
  return workerReady
}

function splitTokensIntoLines(tokens: WorkerToken[]): HighlightTokens {
  if (tokens.length === 0) return [[]]

  const lines: HighlightTokens = []
  let currentLine: HighlightTokens[number] = []

  for (const [content, color] of tokens) {
    const token = { content, color }
    const newlineIndex = content.indexOf('\n')
    if (newlineIndex === -1) {
      currentLine.push(token)
      continue
    }

    const segments = content.split('\n')
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index]
      if (segment) currentLine.push(index === 0 && segment === content ? token : { ...token, content: segment })
      if (index < segments.length - 1) {
        lines.push(currentLine)
        currentLine = []
      }
    }
  }

  if (currentLine.length > 0 || lines.length === 0) lines.push(currentLine)
  return lines
}

async function workerHighlight(params: {
  key: string
  text: string
  language: string
  theme: BundledTheme
  mode: 'tokens' | 'html'
  complete?: boolean
}): Promise<Extract<WorkerResponse, { type: 'highlight' }>> {
  await ensureShikiWorkerReady()

  const id = nextId++
  const w = getWorker()
  latestRequestByKey.set(params.key, id)

  return new Promise<Extract<WorkerResponse, { type: 'highlight' }>>((resolve, reject) => {
    pendingRequests.set(id, {
      resolve: resolve as (response: WorkerResponse) => void,
      reject,
    })
    w.postMessage({ type: 'highlight', id, ...params } satisfies WorkerRequest)
  })
}

export async function highlightTokensInWorker(params: {
  key: string
  text: string
  language: string
  theme: BundledTheme
  complete?: boolean
}): Promise<{ id: number; code: string; tokens: HighlightTokens }> {
  const result = await workerHighlight({ ...params, mode: 'tokens' })
  if (result.id !== latestRequestByKey.get(params.key)) throw new Error('superseded')
  return {
    id: result.id,
    code: result.code,
    tokens: splitTokensIntoLines([...result.stable, ...result.unstable]),
  }
}

export async function highlightHtmlInWorker(params: {
  key: string
  text: string
  language: string
  theme: BundledTheme
}): Promise<{ id: number; html: string }> {
  const result = await workerHighlight({ ...params, mode: 'html', complete: true })
  if (result.id !== latestRequestByKey.get(params.key)) throw new Error('superseded')
  return { id: result.id, html: result.html ?? '' }
}

export function disposeShikiWorkerKey(key: string) {
  if (!worker) return

  worker.postMessage({ type: 'dispose', key } satisfies WorkerRequest)
  latestRequestByKey.delete(key)
}
