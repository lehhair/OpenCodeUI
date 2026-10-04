// ============================================
// 阻塞回合的后台任务检测（v2 session.background 的前置）
//
// 对齐官方 session/requests/background.ts 的 blocking 计算：
// 取**最新一条未完成的 assistant 消息**，其中仍处于 running 的
// shell / subagent（我们服务端工具名是 task）工具调用即为阻塞项。
// ============================================

import type { SessionMessageInfo } from '../../types/api/message'

export interface BlockingBackgroundTask {
  type: 'shell' | 'task'
  /** 工具 part id */
  id: string
  /** 展示标签（命令或任务描述） */
  label: string
}

/**
 * 找出当前正在阻塞回合的后台化候选任务。
 *
 * - 没有 assistant 消息，或最新 assistant 已 completed → 空
 * - 只看最新那条未完成 assistant 的 running 工具（官方同款）
 */
export function findBlockingBackgroundTasks(messages: SessionMessageInfo[]): BlockingBackgroundTask[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.type !== 'assistant') continue
    // 最新 assistant 已完成 → 回合没在被工具阻塞
    if (message.time?.completed !== undefined) return []
    return message.content.flatMap((part): BlockingBackgroundTask[] => {
      if (part.type !== 'tool' || part.state.status !== 'running') return []
      const name = part.name.toLowerCase()
      if (name === 'shell') {
        const command = (part.state.input as Record<string, unknown> | undefined)?.command
        return [{ type: 'shell', id: part.id, label: typeof command === 'string' ? command : part.id }]
      }
      // 服务端 subagent 工具名：v2 为 task（官方新代码称 subagent，兼容两种）
      if (name === 'task' || name === 'subagent') {
        const description = (part.state.input as Record<string, unknown> | undefined)?.description
        return [{ type: 'task', id: part.id, label: typeof description === 'string' ? description : part.id }]
      }
      return []
    })
  }
  return []
}
