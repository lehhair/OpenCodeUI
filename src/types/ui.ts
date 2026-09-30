// ============================================
// UI Types - UI 层专用类型
// ============================================
//
// 这些类型扩展了 API 类型，添加了 UI 层特有的状态
//
// ── 阶段 2b 的清理 ────────────────────────────────────────────────────
//
// 这里原先有一个 `UIMessage`（`{info: ApiMessage, parts: ApiPart[], isStreaming?}`）
// 和它依赖的 V1 `ApiMessage` / `ApiPart` 别名。它们是**阶段 2a 之前**的产物：
// 阶段 2a 已经把 UI 展示模型正式落到 `src/types/message.ts`
// （`Message = {info: MessageInfo, parts: Part[], isStreaming?}`），
// 渲染层与 store 全部用那一份。
//
// `UIMessage` 全仓库零引用（阶段 2b 逐个 grep 核对），其依赖的 V1 别名
// 又随 `v1Model.ts` 的 A 桶一起删除 → 一并删除。
// 需要 UI 消息类型请用 `import type { Message } from './message'`。

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
  supportsPdf: boolean
  supportsAudio: boolean
  supportsVideo: boolean
  supportsToolcall: boolean
  variants: string[]
}

/**
 * 模型文件输入能力 — 决定可以附加哪些文件类型
 */
export interface FileCapabilities {
  image: boolean
  pdf: boolean
  audio: boolean
  video: boolean
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

// ⛔ 阶段 3b 已删除本文件里重复的 Revert 类型（`RevertState` / `RevertHistoryItem`）：
//    它们是阶段 2a 之前的产物，**全仓库零引用**（逐个 grep 核对）。
//    真正在用的那份定义在 `src/store/messageStoreTypes.ts`（`messageStore` 与
//    `useSessionManager` 消费它）。此处删除以免两处定义漂移。
