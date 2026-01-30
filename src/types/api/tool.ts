// ============================================
// Tool API Types
// 基于 OpenAPI 规范
// ============================================

/**
 * 工具 ID 列表
 */
export interface ToolIDs {
  ids: string[]
}

/**
 * 工具列表项
 */
export interface ToolListItem {
  id: string
  name: string
  description?: string
  parameters?: Record<string, unknown>
}

/**
 * 工具列表
 */
export interface ToolList {
  tools: ToolListItem[]
}
