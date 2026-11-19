import type { BundledTheme } from 'shiki/themes'
import type { WorkerRequest, WorkerResponse, WorkerToken } from '../workers/shikiWorker'
import type { HighlightTokens } from './highlightTypes'
import { buildHighlightRequest } from './shikiStreamRequest'
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

/**
 * 每个流式代码块一个 key。记录 worker 里这条流的位置（confirmedText），
 * 只有「没有在途请求且文本是前缀增长」时才发增量，否则发全量。
 * 长会话里 key 会一直累积，给个上限（被淘汰只会退化成发全量，不影响正确性）。
 */
type KeyStreamState = {
  latestId: number
  confirmedText: string
  inFlight: number
}

const keyStates = new Map<string, KeyStreamState>()
const MAX_TRACKED_KEYS = 800

function stateFor(key: string): KeyStreamState {
  const existing = keyStates.get(key)
  if (existing) {
    // 顺带做 LRU：重新插到末尾
    keyStates.delete(key)
    keyStates.set(key, existing)
    return existing
  }

  const state: KeyStreamState = { latestId: 0, confirmedText: '', inFlight: 0 }
  keyStates.set(key, state)
  while (keyStates.size > MAX_TRACKED_KEYS) {
    const oldest = keyStates.keys().next().value
    if (oldest === undefined) break
    keyStates.delete(oldest)
  }
  return state
}

function isSuperseded(key: string, id: number): boolean {
  const latest = keyStates.get(key)?.latestId
  return latest !== undefined && latest !== 0 && latest !== id
}

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
    typeof localStorage !== 'undefined' && localStorage.getItem('code-block-theme-light') || DEFAULT_CODE_BLOCK_THEME_LIGHT,
    DEFAULT_CODE_BLOCK_THEME_LIGHT,
  )
  const dark = normalizeCodeBlockTheme(
    typeof localStorage !== 'undefined' && localStorage.getItem('code-block-theme-dark') || DEFAULT_CODE_BLOCK_THEME_DARK,
    DEFAULT_CODE_BLOCK_THEME_DARK,
  )
  const themes = Array.from(new Set<BundledTheme>([light, dark]))
  getWorker().postMessage({ type: 'init', themes } satisfies WorkerRequest)
  return workerReady
}

export function splitTokensIntoLines(tokens: WorkerToken[]): HighlightTokens {
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
  forceReset?: boolean
}): Promise<Extract<WorkerResponse, { type: 'highlight' }>> {
  await ensureShikiWorkerReady()

  const id = nextId++
  const w = getWorker()
  const state = stateFor(params.key)
  state.latestId = id

  const message = buildHighlightRequest(
    {
      id,
      key: params.key,
      text: params.text,
      language: params.language,
      theme: params.theme,
      mode: params.mode,
      complete: params.complete,
      forceReset: params.forceReset,
    },
    state,
  )

  state.inFlight += 1
  try {
    const response = await new Promise<Extract<WorkerResponse, { type: 'highlight' }>>((resolve, reject) => {
      pendingRequests.set(id, { resolve: resolve as (response: WorkerResponse) => void, reject })
      w.postMessage(message)
    })
    // worker 顺序处理同一个 key，这条响应生效后流的位置就是本次请求的文本
    state.confirmedText = params.text
    return response
  } finally {
    state.inFlight = Math.max(0, state.inFlight - 1)
  }
}

export type HighlightTokensChunk = {
  id: number
  code: string
  reset: boolean
  stable: WorkerToken[]
  stableTotal: number
  unstable: WorkerToken[]
}

/**
 * 流式高亮：返回增量片段，由调用方用 `applyHighlightChunk` 累积。
 *
 * 不再在这里抛 `superseded`：worker 对同一个 key 是顺序处理的，
 * 迟到的响应也是流上一段合法前缀，丢给调用方按顺序应用即可；
 * 真正的过期由调用方检查 key 决定是否采用。
 */
export async function highlightTokensInWorker(params: {
  key: string
  text: string
  language: string
  theme: BundledTheme
  complete?: boolean
  forceReset?: boolean
}): Promise<HighlightTokensChunk> {
  const result = await workerHighlight({ ...params, mode: 'tokens' })
  return {
    id: result.id,
    code: params.text,
    reset: result.reset,
    stable: result.stable,
    stableTotal: result.stableTotal,
    unstable: result.unstable,
  }
}

export async function highlightHtmlInWorker(params: {
  key: string
  text: string
  language: string
  theme: BundledTheme
}): Promise<{ id: number; html: string }> {
  const result = await workerHighlight({ ...params, mode: 'html', complete: true })
  if (isSuperseded(params.key, result.id)) throw new Error('superseded')
  return { id: result.id, html: result.html ?? '' }
}

export function disposeShikiWorkerKey(key: string) {
  if (!worker) return

  worker.postMessage({ type: 'dispose', key } satisfies WorkerRequest)
  keyStates.delete(key)
}
