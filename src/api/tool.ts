// ============================================
// Tool API — OpenCode v2
//
// ## v2 已移除工具清单端点
//
// v1 有 `tool.ids()` / `tool.list({ provider, model })`，用于列举
// 当前模型可用的工具。**v2 没有 `tool` 命名空间**，也没有等价端点。
//
// v2 里工具只以「助手消息 content 中的 tool 片段」形式出现
// （`SessionMessageAssistantTool`），渲染所需信息（name / state / content）
// 全在那一份数据里，不需要预先拉取工具清单。
//
// 本文件保留同名导出以免调用点悬空，返回空清单。
// ============================================

import type { ToolIDs, ToolList } from '../types/api/tool'

/**
 * v2 无工具清单端点；返回空列表。
 */
export async function getToolIds(_directory?: string, _serverId?: string): Promise<ToolIDs> {
  return []
}

/**
 * v2 无工具清单端点；返回空列表。
 */
export async function getTools(
  _provider: string,
  _model: string,
  _directory?: string,
  _serverId?: string,
): Promise<ToolList> {
  return []
}
