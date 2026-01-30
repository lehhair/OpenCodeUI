// ============================================
// Project API Types
// 基于 OpenAPI 规范
// ============================================

import type { TimeInfo } from './common'

/**
 * 项目图标
 */
export interface ProjectIcon {
  url?: string
  override?: string
  color?: string
}

/**
 * 项目命令
 */
export interface ProjectCommands {
  /** 创建新工作区时运行的启动脚本 */
  start?: string
}

/**
 * 项目实体
 */
export interface Project {
  id: string
  worktree: string
  vcs?: 'git'
  name?: string
  icon?: ProjectIcon
  time: TimeInfo
  sandboxes: string[]
}

/**
 * 项目更新参数
 */
export interface ProjectUpdateParams {
  name?: string
  icon?: ProjectIcon
  commands?: ProjectCommands
}

/**
 * 路径信息响应
 */
export interface PathResponse {
  home: string
  state: string
  config: string
  worktree: string
  directory: string
}
