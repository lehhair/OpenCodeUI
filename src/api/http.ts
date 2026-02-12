// ============================================
// HTTP Client Utilities
// 统一的 HTTP 请求工具
// Tauri 环境下自动使用 Rust 后端发请求（绕过 CORS）
// ============================================

import { API_BASE_URL } from '../constants'
import { serverStore, makeBasicAuthHeader } from '../store/serverStore'
import { isTauri } from '../utils/tauri'

/**
 * 获取 fetch 函数
 * Tauri 环境下使用 plugin-http 的 fetch（通过 Rust 发请求，无 CORS 限制）
 * 浏览器环境下使用原生 fetch
 */
let _tauriFetch: typeof globalThis.fetch | null = null
let _tauriFetchLoading: Promise<typeof globalThis.fetch> | null = null

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
 * 统一 fetch 入口
 * 自动选择 Tauri fetch 或原生 fetch
 */
export async function unifiedFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  if (isTauri()) {
    const f = await getTauriFetch()
    return f(input, init)
  }
  return globalThis.fetch(input, init)
}

/**
 * 获取当前 API Base URL
 * 优先使用 serverStore 中的活动服务器，回退到常量
 */
export function getApiBaseUrl(): string {
  return serverStore.getActiveBaseUrl()
}

/**
 * 获取当前活动服务器的 Authorization header
 * 如果服务器配置了密码则返回 Basic Auth header，否则返回 undefined
 */
export function getAuthHeader(): Record<string, string> {
  const auth = serverStore.getActiveAuth()
  if (auth?.password) {
    return { 'Authorization': makeBasicAuthHeader(auth) }
  }
  return {}
}

/** @deprecated 使用 getApiBaseUrl() 代替 */
export const API_BASE = API_BASE_URL

// ============================================
// URL Building
// ============================================

type QueryValue = string | number | boolean | undefined

/**
 * 构建查询字符串（不进行 URL 编码，直接拼接）
 * 后端不解码，所以我们不编码
 */
export function buildQueryString(params: Record<string, QueryValue>): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      parts.push(`${key}=${value}`)
    }
  }
  return parts.length > 0 ? '?' + parts.join('&') : ''
}

/**
 * 构建完整 URL
 */
export function buildUrl(
  path: string,
  params: Record<string, QueryValue> = {}
): string {
  return `${getApiBaseUrl()}${path}${buildQueryString(params)}`
}

// ============================================
// HTTP Methods
// ============================================

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  headers?: Record<string, string>
}

/**
 * 通用 HTTP 请求函数
 * 
 * 如果活动服务器配置了密码，会自动添加 Authorization header
 * 注意：跨域场景下 Authorization header 会触发 CORS 预检请求，
 * 需要后端正确处理 OPTIONS 请求
 */
export async function request<T>(
  path: string,
  params: Record<string, QueryValue> = {},
  options: RequestOptions = {}
): Promise<T> {
  const { method = 'GET', body, headers = {} } = options
  
  const requestHeaders: Record<string, string> = {
    ...getAuthHeader(),
    ...headers,
  }
  
  const init: RequestInit = {
    method,
    headers: requestHeaders,
  }
  
  if (body !== undefined) {
    init.headers = {
      ...init.headers,
      'Content-Type': 'application/json',
    }
    init.body = JSON.stringify(body)
  }
  
  const response = await unifiedFetch(buildUrl(path, params), init)
  
  if (!response.ok) {
    let errorMsg = `Request failed: ${response.status}`
    try {
      const errorText = await response.text()
      if (errorText) {
        errorMsg += ` - ${errorText}`
      }
    } catch {
      // ignore
    }
    throw new Error(errorMsg)
  }
  
  // 204 No Content
  if (response.status === 204) {
    return undefined as T
  }
  
  const text = await response.text()
  if (!text) {
    return undefined as T
  }
  
  return JSON.parse(text)
}

/**
 * GET 请求
 */
export async function get<T>(
  path: string,
  params: Record<string, QueryValue> = {}
): Promise<T> {
  return request<T>(path, params, { method: 'GET' })
}

/**
 * POST 请求
 */
export async function post<T>(
  path: string,
  params: Record<string, QueryValue> = {},
  body?: unknown
): Promise<T> {
  return request<T>(path, params, { method: 'POST', body })
}

/**
 * PATCH 请求
 */
export async function patch<T>(
  path: string,
  params: Record<string, QueryValue> = {},
  body?: unknown
): Promise<T> {
  return request<T>(path, params, { method: 'PATCH', body })
}

/**
 * PUT 请求
 */
export async function put<T>(
  path: string,
  params: Record<string, QueryValue> = {},
  body?: unknown
): Promise<T> {
  return request<T>(path, params, { method: 'PUT', body })
}

/**
 * DELETE 请求
 */
export async function del<T>(
  path: string,
  params: Record<string, QueryValue> = {},
  body?: unknown
): Promise<T> {
  return request<T>(path, params, { method: 'DELETE', body })
}
