// ============================================
// HTTP Client Utilities
// 统一的 HTTP 请求工具
// ============================================

import { API_BASE_URL } from '../constants'

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
  return `${API_BASE}${path}${buildQueryString(params)}`
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
 */
export async function request<T>(
  path: string,
  params: Record<string, QueryValue> = {},
  options: RequestOptions = {}
): Promise<T> {
  const { method = 'GET', body, headers = {} } = options
  
  const init: RequestInit = {
    method,
    headers: {
      ...headers,
    },
  }
  
  if (body !== undefined) {
    init.headers = {
      ...init.headers,
      'Content-Type': 'application/json',
    }
    init.body = JSON.stringify(body)
  }
  
  const response = await fetch(buildUrl(path, params), init)
  
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
  params: Record<string, QueryValue> = {}
): Promise<T> {
  return request<T>(path, params, { method: 'DELETE' })
}
