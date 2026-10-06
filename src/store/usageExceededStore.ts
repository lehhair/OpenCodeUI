// ============================================
// UsageExceededStore — 用量超限对话框调度
//
// 对齐官方 packages/app/src/session/usage-exceeded-dialogs.tsx：
//   session.status(retry + action) 且 provider ∈ {opencode, opencode-go}
//   - reason=free_tier_limit      → 免费额度超限对话框
//   - reason=account_rate_limit   → 账号速率超限对话框
//   24h 窗口内不重复提示；「不再提示」持久化。
// ============================================

import { useSyncExternalStore } from 'react'
import { serverStorage } from '../utils/perServerStorage'

const GO_UPSELL_PROVIDERS = new Set(['opencode', 'opencode-go'])
const GO_UPSELL_WINDOW = 86_400_000 // 24 hrs（官方 GO_UPSELL_WINDOW 同款）

const KEY_FREE_LAST_SEEN = 'go_upsell_last_seen_at'
const KEY_FREE_DONT_SHOW = 'go_upsell_dont_show'
const KEY_RATE_LAST_SEEN = 'go_upsell_account_rate_limit_last_seen_at'
const KEY_RATE_DONT_SHOW = 'go_upsell_account_rate_limit_dont_show'

export type UsageExceededReason = 'free_tier_limit' | 'account_rate_limit'

export interface UsageExceededRequest {
  reason: UsageExceededReason
  provider: string
  title: string
  message: string
  label: string
  link?: string
}

interface RetryAction {
  reason: string
  provider: string
  title: string
  message: string
  label: string
  link?: string
}

function readNumber(key: string): number | null {
  const raw = serverStorage.get(key)
  if (raw === null) return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

class UsageExceededStore {
  private pending: UsageExceededRequest | null = null
  private listeners = new Set<() => void>()

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): UsageExceededRequest | null => this.pending

  private emit() {
    this.listeners.forEach(listener => listener())
  }

  /** session.status(retry) 的 action 上报（官方 goUpsellKeys 同款判定） */
  report(action: RetryAction | undefined) {
    if (!action || this.pending) return
    if (!GO_UPSELL_PROVIDERS.has(action.provider)) return
    if (action.reason !== 'free_tier_limit' && action.reason !== 'account_rate_limit') return

    const lastSeenKey = action.reason === 'free_tier_limit' ? KEY_FREE_LAST_SEEN : KEY_RATE_LAST_SEEN
    const dontShowKey = action.reason === 'free_tier_limit' ? KEY_FREE_DONT_SHOW : KEY_RATE_DONT_SHOW

    const seen = readNumber(lastSeenKey)
    if (seen !== null && Date.now() - seen < GO_UPSELL_WINDOW) return
    if (readNumber(dontShowKey) !== null) return

    this.pending = {
      reason: action.reason,
      provider: action.provider,
      title: action.title,
      message: action.message,
      label: action.label,
      link: action.link,
    }
    this.emit()
  }

  /**
   * 关闭对话框（官方 onClose 同款）：
   * - dontShowAgain=true → 记住「不再提示」
   * - 否则仅记录本次已见，并返回 true（调用方据此引导连接 provider）
   */
  dismiss(dontShowAgain: boolean): boolean {
    const current = this.pending
    this.pending = null
    this.emit()
    if (!current) return false

    const lastSeenKey = current.reason === 'free_tier_limit' ? KEY_FREE_LAST_SEEN : KEY_RATE_LAST_SEEN
    const dontShowKey = current.reason === 'free_tier_limit' ? KEY_FREE_DONT_SHOW : KEY_RATE_DONT_SHOW
    serverStorage.set(lastSeenKey, String(Date.now()))
    if (dontShowAgain) serverStorage.set(dontShowKey, String(Date.now()))
    return !dontShowAgain
  }
}

export const usageExceededStore = new UsageExceededStore()

export function useUsageExceededRequest(): UsageExceededRequest | null {
  return useSyncExternalStore(usageExceededStore.subscribe, usageExceededStore.getSnapshot)
}
