// ============================================
// VCS (Version Control System) API Types
// 基于 OpenAPI 规范
// ============================================

/**
 * VCS 信息
 */
export interface VcsInfo {
  type: 'git'
  branch?: string
  commit?: string
  dirty?: boolean
  ahead?: number
  behind?: number
  remote?: string
}
