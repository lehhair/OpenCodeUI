// ============================================
// SDK Client - 基于 @opencode/client 的统一客户端（OpenCode V2）
//
// 职责：
// 1. 根据当前活动服务器动态创建 client
// 2. 整合 baseUrl / auth / tauri fetch
// 3. 为上层 API 模块提供统一的 client 获取方式
//
// ⚠️ V2 与 V1 的关键差异（阶段 1 迁移）：
// - 包名：@opencode-ai/sdk → @opencode/client
// - 工厂：createOpencodeClient() → OpenCode.make()
// - 返回值：V1 是 { data, error, request, response } 需要 unwrap；
//          V2 **直接返回数据**，失败时直接 throw（ClientError）
// - 鉴权用户名：V2 服务端**硬编码为 "opencode"**（packages/server/src/auth.ts:20），
//          其他用户名一律 401 → 这里固定用 "opencode"，忽略 serverStore 里存的 username
// ============================================

import { OpenCode, type OpenCodeClient } from '@opencode/client'
import { serverStore } from '../store/serverStore'
import { isTauri } from '../utils/tauri'

/**
 * V2 服务端 Basic Auth 的固定用户名
 *
 * 依据：`packages/server/src/auth.ts:20`（tag v2.0.19）把用户名硬编码为 "opencode"；
 * `OPENCODE_SERVER_USERNAME` 在该版本中**没有任何读取处**。
 * 实测：`custom:pw` → 401，`opencode:pw` → 200。
 * 因此这里忽略用户填写的 username，一律用 "opencode" 生成凭证。
 */
export const OPENCODE_BASIC_AUTH_USERNAME = 'opencode'

/**
 * 用固定用户名 + 给定密码生成 Basic Auth 头
 *
 * 注意：与 serverStore.makeBasicAuthHeader() 的区别是**忽略 auth.username**。
 * 后者仍保留给历史用途；SDK 与健康检查统一走这个函数。
 */
export function makeOpencodeBasicAuthHeader(password: string): string {
  return 'Basic ' + btoa(`${OPENCODE_BASIC_AUTH_USERNAME}:${password}`)
}

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

function getFetchImpl(): typeof globalThis.fetch {
  return isTauri() && _tauriFetch ? _tauriFetch : globalThis.fetch
}

function createAbortError(message: string) {
  return new DOMException(message, 'AbortError')
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

  try {
    if (generation !== _apiRequestGeneration) {
      throw createAbortError('Stale API request')
    }

    return await getFetchImpl()(input, {
      ...init,
      signal: controller.signal,
    })
  } finally {
    externalSignal?.removeEventListener('abort', abortFromExternal)
    _apiRequestControllers.delete(controller)
  }
}

export function abortInFlightApiRequests(reason = 'Server endpoint changed'): void {
  _apiRequestGeneration++
  for (const controller of _apiRequestControllers) {
    controller.abort(createAbortError(reason))
  }
  _apiRequestControllers.clear()
}

// Client 缓存：按 serverId → "baseUrl + authHash" 缓存实例，避免重复创建
// 缺省 serverId（undefined）表示活动服务器
interface CachedClientEntry {
  key: string
  client: OpenCodeClient
}

const _cachedClients = new Map<string | undefined, CachedClientEntry>()

function buildCacheKey(serverId?: string): string {
  const baseUrl = serverId ? serverStore.getServerBaseUrl(serverId) : serverStore.getActiveBaseUrl()
  const auth = serverId ? serverStore.getServerAuth(serverId) : serverStore.getActiveAuth()
  const authPart = auth?.password ? `${OPENCODE_BASIC_AUTH_USERNAME}:${auth.password}` : ''
  return `${baseUrl}|${authPart}`
}

function buildHeaders(serverId?: string): Record<string, string> {
  const headers: Record<string, string> = {}
  const auth = serverId ? serverStore.getServerAuth(serverId) : serverStore.getActiveAuth()
  if (auth?.password) {
    headers['Authorization'] = makeOpencodeBasicAuthHeader(auth.password)
  }
  return headers
}

/**
 * 同步获取 SDK client（浏览器环境 or tauri fetch 已加载）
 * 如果 tauri fetch 还没加载完，先用原生 fetch
 * @param serverId 指定服务器（缺省用活动服务器）
 */
export function getSDKClient(serverId?: string): OpenCodeClient {
  const key = buildCacheKey(serverId)
  const cached = _cachedClients.get(serverId)
  if (cached && cached.key === key) {
    return cached.client
  }

  const baseUrl = serverId ? serverStore.getServerBaseUrl(serverId) : serverStore.getActiveBaseUrl()
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
 * 异步获取 SDK client（确保 tauri fetch 已加载）
 * 在应用初始化时应该先调一次这个
 * @param serverId 指定服务器（缺省用活动服务器）
 */
export async function getSDKClientAsync(serverId?: string): Promise<OpenCodeClient> {
  if (isTauri()) {
    await getTauriFetch()
  }
  // 使 cache 失效以便用新的 tauri fetch 重建
  _cachedClients.delete(serverId)
  return getSDKClient(serverId)
}

/**
 * 强制重建 client（服务器切换时调用）
 * @param serverId 指定服务器（缺省全部失效）
 */
export function invalidateSDKClient(serverId?: string): void {
  if (serverId) {
    _cachedClients.delete(serverId)
  } else {
    _cachedClients.clear()
  }
}
