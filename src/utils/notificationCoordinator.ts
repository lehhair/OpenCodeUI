// ============================================
// NotificationCoordinator — 通知声音跨标签页去重
//
// 对齐官方 packages/app/src/shell/notifications/coordinator.ts 的
// `once("sound", eventID, run)` 路径：
// - 同一事件 id 在所有标签页只播一次声音（每个标签页各有自己的 SSE
//   连接，同一事件会被每页各收到一次）
// - 本页 Set + localStorage 认领清单（最近 500 条）双保险；
//   navigator.locks 可用时用锁串行化认领
// ============================================

const MAX_CLAIMED = 500
const CLAIM_KEY = 'opencode:notification-sound'

class NotificationCoordinator {
  private claimed = new Set<string>()
  private locks = typeof navigator === 'undefined' ? undefined : navigator.locks

  /** 认领（本页内存 + localStorage 清单；官方 claim 同款） */
  private claim(eventID: string): boolean {
    if (this.claimed.has(eventID)) return false
    try {
      const value: unknown = JSON.parse(localStorage.getItem(CLAIM_KEY) ?? '[]')
      const events = Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
      if (events.includes(eventID)) {
        this.claimed.add(eventID)
        return false
      }
      localStorage.setItem(CLAIM_KEY, JSON.stringify([...events, eventID].slice(-MAX_CLAIMED)))
    } catch {
      // 存储不可用时本页内存认领仍防本页重复
    }
    this.claimed.add(eventID)
    return true
  }

  /**
   * 同一事件 id 跨标签页只执行一次（官方 coordinator.once 同款）。
   * 没有事件 id 时直接执行（无从对账，保持原行为）。
   */
  async once(eventID: string | undefined, run: () => void): Promise<void> {
    if (!eventID) {
      run()
      return
    }
    const execute = () => {
      if (this.claim(eventID)) run()
    }
    if (!this.locks) {
      execute()
      return
    }
    try {
      await this.locks.request(`opencode:notification:sound:${eventID}`, execute)
    } catch {
      execute()
    }
  }
}

export const notificationCoordinator = new NotificationCoordinator()
