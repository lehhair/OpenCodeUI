// ============================================
// Project Types — OpenCode v2 原生
//
// v2 的 Project 自带 projectID 之外的完整信息：
//   { id, canonical, vcs?, name?, icon?, commands?, time, sandboxes }
//
// 变化：
//   - v1 的 `project.current()` / `initGit()` 在 v2 不存在。
//     当前项目由 `location.get()` 的 `project` 字段给出，
//     项目列表走 `project.list()`（无参数）。
//   - v1 的 `Path` 类型（{cwd, root, ...}）在 v2 由 `location.get()` 的
//     LocationPublicInfo 取代。
// ============================================

import type {
  LocationPublicInfo,
  Project as V2Project,
  ProjectCommands as V2ProjectCommands,
  ProjectIcon as V2ProjectIcon,
  ProjectListOutput,
  ProjectUpdateInput as V2ProjectUpdateInput,
  ProjectVcs as V2ProjectVcs,
} from '@opencode/client/promise'

export type Project = V2Project

export type ProjectIcon = V2ProjectIcon

export type ProjectCommands = V2ProjectCommands

export type ProjectVcs = V2ProjectVcs

export type ProjectList = ProjectListOutput

/** `project.update()` 的入参 */
export type ProjectUpdateParams = V2ProjectUpdateInput

/**
 * 位置信息（取代 v1 的 Path）。
 *
 * v2 用 `location.get()` 描述「当前工作目录 + 所属项目」：
 *   { directory, project: { id, directory, canonical } }
 */
export type PathResponse = LocationPublicInfo
