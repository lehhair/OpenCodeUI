// ============================================
// 会话占位对象
//
// 有些场景只有会话的部分信息（标题/目录），却需要一个完整的 SessionInfo：
//   - 侧栏列表里有某个 session 的条目，但它不在当前服务器的查询结果里
//     （例如属于另一台服务器）
//   - v2 的 session.created 事件负载是「创建记录」，缺少 cost/tokens/time.updated
//
// v2 的 SessionInfo 字段较多且部分为品牌类型，因此这里显式补齐必填项，
// 已知信息照填，其余用零值占位。
//
// 放在 utils 而不是 api 层：这是纯构造函数，不该经由 api 桶文件导出，
// 否则任何 mock 了 api 模块的测试都会拿到 undefined（已经踩过一次）。
// ============================================

import type { Session } from '../types/api/session'

export interface SessionPlaceholderInput {
  id: string
  title?: string
  /** 工作区目录 */
  directory?: string
  parentID?: string
  projectID?: string
}

export function createSessionPlaceholder(input: SessionPlaceholderInput): Session {
  const now = Date.now()
  return {
    id: input.id,
    projectID: input.projectID ?? '',
    ...(input.parentID ? { parentID: input.parentID } : {}),
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: now, updated: now },
    title: input.title,
    location: { directory: input.directory ?? '' },
  } as unknown as Session
}
