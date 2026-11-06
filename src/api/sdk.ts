// ============================================
// SDK Client — OpenCode v2 原生客户端
//
// 本层只做三件事：
//   1. 按当前活动服务器创建 v2 客户端（OpenCode.make）
//   2. 整合 baseUrl / Basic Auth / Tauri fetch
//   3. 提供按 serverId 的实例缓存与请求中断
//
// v2 的 promise 客户端**直接返回数据**（`Promise<T>`），不再有 v1 的
// `{ data, error }` 包装，因此这里没有 unwrap —— 失败直接是 reject。
// ============================================

import { OpenCode } from '@opencode/client/promise'
import type { OpenCodeClient } from '@opencode/client/promise'
import { serverStore, makeBasicAuthHeader } from '../store/serverStore'
import { isTauri } from '../utils/tauri'
import { toAbsoluteBaseUrl } from './http'

/** v2 客户端实例（内部 API 层的唯一形状） */
export type ServerApi = OpenCodeClient

// Tauri fetch 缓存
let _tauriFetch: typeof globalThis.fetch | null = null
let _tauriFetchLoading: Promise<typeof globalThis.fetch> | null = null
let _apiRequestGeneration = 0
const _apiRequestControllers = new Set<AbortController>()

async function getTauriFetch(): Promise<typeof globalThis.fetch> {
  if (_tauriFetch) return _tauriFetch
  if (_tauriFetchLoading) return _tauriFetchLoading
  _tauriFetchLoading = import('@tauri-apps/plugin-http').then(mod => {
    _tauriFetch = mod.fetch as unknown as typeof globalThis.fetch
    return _tauriFetch
  })
  return _tauriFetchLoading
}

/**
 * 解析本次请求实际使用的 fetch 实现。
 *
 * 桌面端必须用 Tauri 的 plugin-http：webview 里的原生 fetch 受 CORS 约束，
 * 而 opencode serve 默认不带 `--cors`，从 tauri:// 源打到 127.0.0.1 的首个
 * 请求会被浏览器直接拒绝。之前这里是「tauri fetch 已加载就用，否则用原生」，
 * 启动时请求只要比动态 import 先到，就会白打一次必败请求并进入重试退避——
 * 首屏会话/模型列表因此慢半拍甚至停在失败态。
 *
 * 现在改成等 import 落地（本身被缓存，之后是已 resolve 的 promise），
 * 保证第一次请求就走对通道。
 */
async function resolveFetchImpl(): Promise<typeof globalThis.fetch> {
  if (!isTauri()) return globalThis.fetch
  return await getTauriFetch()
}

function createAbortError(message: string) {
  return new DOMException(message, 'AbortError')
}

// ============================================
// 请求超时（headers 超时）
//
// fetch 自身没有任何超时：TCP 半开 / 代理黑洞 / 主机休眠时，等待响应头
// 可以挂到 OS 放弃 TCP 重传（几分钟）。挂起的 prompt POST 会堵死
// sendAdmission 的会话串行链，输入框永久锁死——「消息发不出去」的主因。
//
// 这里只给「等待响应头」设超时（官方 request-queue 同款 60s）：
// fetch 的 Promise 在响应头到达时即 resolve，之后 body 流式读取不受限，
// 因此 SSE 长连接也可以安全套用（仍显式豁免，交给 events.ts 的看门狗）。
// ============================================

const DEFAULT_HEADERS_TIMEOUT_MS = 60_000
/** worktree create 要跑 git 操作，官方给了 10 分钟预算 */
const LONG_REQUEST_TIMEOUT_MS = 10 * 60_000

function headersTimeoutMs(url: string): number | null {
  // SSE 事件流：生命周期由 events.ts 的看门狗/重连循环管理
  if (url.includes('/api/event')) return null
  // session.wait 是长轮询，响应头要等会话空闲才返回
  if (url.includes('/wait')) return null
  if (url.includes('/worktree')) return LONG_REQUEST_TIMEOUT_MS
  return DEFAULT_HEADERS_TIMEOUT_MS
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

async function trackedFetch(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  generation: number,
): Promise<Response> {
  const controller = new AbortController()
  const externalSignal = init?.signal
  const abortFromExternal = () => controller.abort(externalSignal?.reason)

  if (externalSignal?.aborted) {
    abortFromExternal()
  } else {
    externalSignal?.addEventListener('abort', abortFromExternal, { once: true })
  }

  _apiRequestControllers.add(controller)

  const timeoutMs = headersTimeoutMs(requestUrl(input))
  let timeoutTimer: ReturnType<typeof setTimeout> | null = null

  try {
    if (generation !== _apiRequestGeneration) {
      throw createAbortError('Stale API request')
    }

    const fetchImpl = await resolveFetchImpl()
    // 等待 import 期间可能又发生了端点切换：起飞前再校验一次代次
    if (generation !== _apiRequestGeneration) {
      throw createAbortError('Stale API request')
    }
    // 等待期间外部取消（切会话 / 断连）也要在起飞前生效
    if (controller.signal.aborted) {
      throw controller.signal.reason ?? createAbortError('Request aborted')
    }

    const fetchPromise = fetchImpl(input, {
      ...init,
      signal: controller.signal,
    })
    if (timeoutMs === null) {
      return await fetchPromise
    }

    return await Promise.race([
      fetchPromise,
      new Promise<never>((_, reject) => {
        timeoutTimer = setTimeout(() => {
          const error = new DOMException(`Request timed out after ${timeoutMs}ms`, 'TimeoutError')
          controller.abort(error)
          reject(error)
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timeoutTimer) clearTimeout(timeoutTimer)
    externalSignal?.removeEventListener('abort', abortFromExternal)
    _apiRequestControllers.delete(controller)
  }
}

/**
 * 中断所有在途请求（服务器端点变化时调用）。
 * 通过递增代次让旧请求在起飞前就失败，避免响应乱序落库。
 *
 * 注意必须同时清空客户端缓存：缓存 client 的 generation 是建实例时的
 * 快照，不清缓存的话它永远落后于新代次，之后每个请求都会抛
 * 'Stale API request'——一次 abort 就把缓存 client 永久毒化。
 * 清缓存后：旧引用仍然失效（代次检查保留，防乱序），
 * 而新 getSDKClient() 会按新代次重建实例，正常工作。
 */
export function abortInFlightApiRequests(reason = 'Server endpoint changed'): void {
  _apiRequestGeneration++
  for (const controller of _apiRequestControllers) {
    controller.abort(createAbortError(reason))
  }
  _apiRequestControllers.clear()
  _cachedClients.clear()
}

// Client 缓存：按 serverId → "baseUrl + authHash" 缓存实例，避免重复创建
// 缺省 serverId（undefined）表示活动服务器
interface CachedClientEntry {
  key: string
  client: ServerApi
}

const _cachedClients = new Map<string | undefined, CachedClientEntry>()

/**
 * 读取当前服务器的 baseUrl，并补成 SDK 要求的绝对地址。
 *
 * standalone 部署的 `VITE_API_BASE_URL=/api` 是相对前缀，直接用会被
 * `new URL('/api')` 判为 Invalid URL；缓存 key 也必须用补全后的值，
 * 否则相对/绝对两种写法会各建一份客户端。
 */
function resolveClientBaseUrl(serverId?: string): string {
  const raw = serverId ? serverStore.getServerBaseUrl(serverId) : serverStore.getActiveBaseUrl()
  return toAbsoluteBaseUrl(raw)
}

function buildCacheKey(serverId?: string): string {
  const baseUrl = resolveClientBaseUrl(serverId)
  const auth = serverId ? serverStore.getServerAuth(serverId) : serverStore.getActiveAuth()
  const authPart = auth?.password ? `${auth.username}:${auth.password}` : ''
  return `${baseUrl}|${authPart}`
}

function buildHeaders(serverId?: string): Record<string, string> {
  const headers: Record<string, string> = {}
  const auth = serverId ? serverStore.getServerAuth(serverId) : serverStore.getActiveAuth()
  if (auth?.password) {
    headers['Authorization'] = makeBasicAuthHeader(auth)
  }
  return headers
}

/**
 * 同步获取 v2 客户端（浏览器环境 or tauri fetch 已加载）
 * 如果 tauri fetch 还没加载完，先用原生 fetch
 * @param serverId 指定服务器（缺省用活动服务器）
 */
export function getSDKClient(serverId?: string): ServerApi {
  const key = buildCacheKey(serverId)
  const cached = _cachedClients.get(serverId)
  if (cached && cached.key === key) {
    return cached.client
  }

  const baseUrl = resolveClientBaseUrl(serverId)
  const headers = buildHeaders(serverId)
  const generation = _apiRequestGeneration

  const client = OpenCode.make({
    baseUrl,
    headers,
    fetch: (input, init) => trackedFetch(input, init, generation),
  })
  _cachedClients.set(serverId, { key, client })
  return client
}

/**
 * 异步获取 v2 客户端（确保 tauri fetch 已加载）
 * 在应用初始化时应该先调一次这个
 * @param serverId 指定服务器（缺省用活动服务器）
 */
export async function getSDKClientAsync(serverId?: string): Promise<ServerApi> {
  if (isTauri()) {
    await getTauriFetch()
  }
  // 使 cache 失效以便用新的 tauri fetch 重建
  _cachedClients.delete(serverId)
  return getSDKClient(serverId)
}

/**
 * 强制重建客户端（服务器切换时调用）
 * @param serverId 指定服务器（缺省全部失效）
 */
export function invalidateSDKClient(serverId?: string): void {
  if (serverId) {
    _cachedClients.delete(serverId)
  } else {
    _cachedClients.clear()
  }
}
