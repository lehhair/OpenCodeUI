// ============================================
// Todo — OpenCode v2 说明
//
// ## v2 已彻底移除 session.todo
//
// v1 有 `session.todo({ sessionID })` 与 `todo.updated` 事件，
// 服务器维护每个会话的待办清单。
//
// **v2 完全没有 todo**：`@opencode/client` 里连字符串 `todo` 都不存在
// （不是改名，是删除），`V2Event` 联合里也没有任何 `todo.*` 成员。
// 因此：
//   - 没有 todo 查询接口
//   - 没有 todo 更新事件
//   - `src/store/todoStore.ts` 失去数据来源
//
// ## v2 里待办信息的唯一来源
//
// Agent 在对话中调用 `todowrite` 工具时，待办内容会出现在助手消息的
// tool 片段里（`SessionMessageAssistantTool`）：
//     { type: 'tool', name: 'todowrite', state: { status: 'completed', input, content } }
// 需要展示待办时，应从消息流中提取最近一次 `todowrite` 调用的
// `state.input` / `state.metadata`，而不是向服务器查询。
//
// ## 本文件
//
// 保留 `TodoItem` 类型与一个纯函数式解析器，供 UI 从工具调用中派生待办。
// 不再有任何网络请求。
// ============================================

/** 待办条目（UI 展示用，由 todowrite 工具调用派生） */
export interface TodoItem {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  priority: 'high' | 'medium' | 'low'
}

type RawTodo = {
  content?: unknown
  status?: unknown
  priority?: unknown
}

function buildTodoId(todo: RawTodo, index: number): string {
  const content = String(todo.content ?? '').slice(0, 32)
  const status = String(todo.status ?? '')
  const priority = String(todo.priority ?? '')
  return `todo-${index}-${content}-${status}-${priority}`
}

function isTodoStatus(status: string): status is TodoItem['status'] {
  return status === 'pending' || status === 'in_progress' || status === 'completed' || status === 'cancelled'
}

function isTodoPriority(priority: string): priority is TodoItem['priority'] {
  return priority === 'high' || priority === 'medium' || priority === 'low'
}

/**
 * 规范化待办数组（从 todowrite 工具的入参派生）。
 */
export function normalizeTodoItems(todos: unknown): TodoItem[] {
  if (!Array.isArray(todos)) return []
  return (todos as RawTodo[]).map((todo, index) => ({
    id: buildTodoId(todo, index),
    content: String(todo.content ?? ''),
    status: isTodoStatus(String(todo.status)) ? (todo.status as TodoItem['status']) : 'pending',
    priority: isTodoPriority(String(todo.priority)) ? (todo.priority as TodoItem['priority']) : 'medium',
  }))
}
