// ============================================
// UI Types - UI 层专用类型
// ============================================
//
// 这些类型扩展了 API 类型，添加了 UI 层特有的状态
//

import type { Message as ApiMessage, Part as ApiPart } from './api'

/**
 * UI 层消息类型
 * 扩展 API 消息，添加 UI 状态
 */
export interface UIMessage {
  /** API 消息信息 */
  info: ApiMessage
  /** 消息内容部分 */
  parts: ApiPart[]
  /** 是否正在流式传输 */
  isStreaming?: boolean
}

// ============================================
// Attachment Types - 从现有组件导出
// ============================================

// 直接从 features/attachment 导出，保持向后兼容
export type { Attachment, AttachmentType } from '../features/attachment/types'

// ============================================
// Model Types
// ============================================

/**
 * 模型信息（UI 层简化版本）
 */
export interface ModelInfo {
  id: string
  name: string
  providerId: string
  providerName: string
  family: string
  contextLimit: number
  outputLimit: number
  supportsReasoning: boolean
  supportsImages: boolean
  supportsToolcall: boolean
  variants: string[]
}

// ============================================
// Router Types
// ============================================

/**
 * 路由状态
 */
export interface RouteState {
  sessionId: string | null
  directory: string | null
}

// ============================================
// Theme Types
// ============================================

/**
 * 主题模式
 */
export type ThemeMode = 'light' | 'dark' | 'system'

// ============================================
// Revert Types
// ============================================

import type { Attachment } from '../features/attachment/types'

/**
 * 撤销历史项
 */
export interface RevertHistoryItem {
  messageId: string
  text: string
  attachments: Attachment[]
  model?: { providerID: string; modelID: string }
  variant?: string
}

/**
 * 撤销状态
 */
export interface RevertState {
  messageId: string
  history: RevertHistoryItem[]
}
