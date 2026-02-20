// ============================================
// PTY (Pseudo Terminal) API Types
// 基于 OpenAPI 规范
// ============================================

/**
 * PTY 尺寸
 */
export interface PtySize {
  rows: number
  cols: number
}

/**
 * PTY 会话
 */
export interface Pty {
  id: string
  title?: string
  command: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  size?: PtySize
  running: boolean
  status?: string
  pid?: number
  exitCode?: number
}

/**
 * PTY 创建参数
 */
export interface PtyCreateParams {
  command?: string
  args?: string[]
  cwd?: string
  title?: string
  env?: Record<string, string>
}

/**
 * PTY 更新参数
 */
export interface PtyUpdateParams {
  title?: string
  size?: PtySize
}
