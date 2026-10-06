// ============================================
// 队列 mutation 投影（官方 queue.ts 的 rows() 同款思路）
//
// 编辑/重排的服务端落地是「重新 admit + cancel + 后缀重写」——事件逐条
// 到达时队列会先变多（新条目入队）再变少（旧条目取消），UI 上抖一下。
// 投影在 mutation 期间直接展示期望的最终文本序列：
//   - 有活体条目匹配的槽位用它（拿到真实 id/操作）
//   - 还没到的槽位用占位条目（同样的虚线气泡外观）
// 数量与顺序全程恒定，事件落地与投影一致后清除 mutation，切换无跳变。
// ============================================

import { queuedPromptText, type QueuedUserPrompt } from '../../store/inboxStore'

export interface QueueMutation {
  /** 期望的最终文本序列（queuedPromptText 口径） */
  expected: string[]
}

export interface ProjectedQueueEntry {
  item: QueuedUserPrompt
}

/** 占位条目的合成 id（mutation 期间稳定，避免 React 重挂载闪烁） */
const placeholderId = (index: number) => `queue-mutation:${index}`

export function projectQueueItems(items: QueuedUserPrompt[], mutation: QueueMutation | null): ProjectedQueueEntry[] {
  if (!mutation) return items.map(item => ({ item }))

  // 文本 → 活体条目池（同文本多条按到达顺序消费）
  const pool = new Map<string, QueuedUserPrompt[]>()
  for (const entry of items) {
    const text = queuedPromptText(entry)
    const bucket = pool.get(text)
    if (bucket) bucket.push(entry)
    else pool.set(text, [entry])
  }

  return mutation.expected.map((text, index) => {
    const bucket = pool.get(text)
    const live = bucket?.shift()
    if (live) return { item: live }
    // 占位：尚未到达的槽位（id 是合成的，操作上屏前无服务端对应物）
    return {
      item: {
        id: placeholderId(index),
        sessionID: '',
        time: { created: 0 },
        type: 'user',
        delivery: 'queue',
        payload: { text },
      } as unknown as QueuedUserPrompt,
    }
  })
}

/** mutation 是否已落地（可以清除投影）：当前队列文本序列与期望一致 */
export function queueMutationSettled(items: QueuedUserPrompt[], mutation: QueueMutation): boolean {
  if (items.length !== mutation.expected.length) return false
  return items.every((entry, index) => queuedPromptText(entry) === mutation.expected[index])
}
