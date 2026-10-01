// ============================================
// Tool Types — OpenCode v2
//
// v2 **没有** `tool.list` / `tool.ids` 端点：工具清单不再由服务器暴露。
// 工具在 v2 里只以「助手消息 content 中的 tool 片段」形式出现
// （见 message.ts 的 AssistantTool），渲染所需信息全在那一份数据里。
//
// 本文件保留类型名以便旧引用平滑收敛，但运行时没有任何来源。
// ============================================

/** v2 不再提供工具清单列表 */
export type ToolIDs = string[]

export type ToolListItem = {
  id: string
  description?: string
}

export type ToolList = ToolListItem[]
