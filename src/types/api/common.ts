// ============================================
// Common API Types - 通用类型定义
// 基于 OpenAPI 规范
// ============================================

/**
 * 时间戳信息
 */
export interface TimeInfo {
  created: number
  updated?: number
  completed?: number
  archived?: number
  initialized?: number
}

/**
 * Token 使用统计
 */
export interface TokenUsage {
  input: number
  output: number
  reasoning: number
  cache: {
    read: number
    write: number
  }
}

/**
 * 模型引用
 */
export interface ModelRef {
  providerID: string
  modelID: string
}

/**
 * 路径信息
 */
export interface PathInfo {
  cwd: string
  root: string
}

/**
 * 错误信息
 */
export interface ErrorInfo {
  name: string
  data: unknown
}

/**
 * 文本范围（用于引用源码片段）
 */
export interface TextRange {
  value: string
  start: number
  end: number
}

// ============================================
// API Error Types
// ============================================

export interface BadRequestError {
  error: 'bad_request'
  message: string
}

export interface NotFoundError {
  error: 'not_found'
  message: string
}

export interface ProviderAuthError {
  name: 'ProviderAuthError'
  data: {
    providerID: string
  }
}

export interface UnknownError {
  name: 'UnknownError'
  data: {
    message: string
    stack?: string
  }
}

export interface MessageOutputLengthError {
  name: 'MessageOutputLengthError'
  data: Record<string, never>
}

export interface MessageAbortedError {
  name: 'MessageAbortedError'
  data: Record<string, never>
}

export interface APIError {
  name: 'APIError'
  data: {
    status: number
    body: string
    providerID: string
    modelID: string
  }
}
