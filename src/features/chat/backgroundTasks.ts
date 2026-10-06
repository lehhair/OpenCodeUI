// ============================================
// 阻塞回合的后台任务检测（v2 session.background 的前置）
//
// 对齐官方 session/requests/background.ts 的 blocking 计算：
// 取**最新一条未完成的 assistant 消息**，其中仍处于 running 的
// shell / subagent（我们服务端工具名是 task）工具调用即为阻塞项。
// ============================================

import type { SessionMessageInfo } from '../../types/api/message'
import type { ShellInfo } from '@opencode/client/promise'
import { useEffect, useState } from 'react'
import { listShells } from '../../api/shell'

export interface BlockingBackgroundTask {
  type: 'shell' | 'task'
  /** 工具 part id（或 shell id） */
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

/**
 * 并入服务端 running shells（官方 requests/background.ts:100-109 同款）：
 * shell.list 里 status==='running' 且属于本会话的 shell 也是后台化候选，
 * 与消息工具态推导的结果按 id / label 去重。
 *
 * @param rawSessionId 服务端原始 session id（非 scoped key）——shell 的
 *   metadata.sessionID 是原始 id
 */
export function mergeRunningShells(
  tasks: BlockingBackgroundTask[],
  shells: ShellInfo[],
  rawSessionId: string,
): BlockingBackgroundTask[] {
  const running = shells.flatMap((shell): BlockingBackgroundTask[] => {
    if (shell.status !== 'running') return []
    if ((shell.metadata as Record<string, unknown> | undefined)?.sessionID !== rawSessionId) return []
    if (tasks.some(task => task.type === 'shell' && (task.id === shell.id || (!!task.label && shell.command === task.label))))
      return []
    return [{ type: 'shell', id: shell.id, label: shell.command }]
  })
  return [...tasks, ...running]
}

/**
 * 会话 busy 期间轮询 shell.list（官方 data 层的 shell 清单同步的轻量等价物）：
 * 「移到后台」候选需要并入服务端 running shells——比如模型上一轮启动、
 * 事件流尚未物化进消息工具态的 shell。
 */
export function useRunningShells(sessionId: string | null, active: boolean, serverId?: string): ShellInfo[] {
  const [shells, setShells] = useState<ShellInfo[]>([])
  useEffect(() => {
    if (!sessionId || !active) {
      setShells([])
      return
    }
    let cancelled = false
    const load = async () => {
      try {
        const list = await listShells(serverId)
        if (!cancelled) setShells(list)
      } catch {
        // 失败不影响主流程，下一轮再试
      }
    }
    void load()
    const timer = setInterval(() => void load(), 3_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [sessionId, active, serverId])
  return shells
}
