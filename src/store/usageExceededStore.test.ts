import { beforeEach, describe, expect, it, vi } from 'vitest'

const storageMap = new Map<string, string>()

vi.mock('../utils/perServerStorage', () => ({
  serverStorage: {
    get: (key: string) => storageMap.get(key) ?? null,
    set: (key: string, value: string) => {
      storageMap.set(key, value)
    },
  },
}))

import { usageExceededStore } from './usageExceededStore'

function action(overrides: Record<string, unknown> = {}) {
  return {
    reason: 'free_tier_limit',
    provider: 'opencode',
    title: 'Limit reached',
    message: 'You are out of quota',
    label: 'Upgrade',
    link: 'https://opencode.ai/console',
    ...overrides,
  }
}

describe('usageExceededStore（官方 usage-exceeded-dialogs 同款判定）', () => {
  beforeEach(() => {
    storageMap.clear()
    usageExceededStore.dismiss(false)
  })

  it('free_tier_limit + opencode → 弹出请求', () => {
    usageExceededStore.report(action())
    expect(usageExceededStore.getSnapshot()?.reason).toBe('free_tier_limit')
  })

  it('非目标 provider / 非超限 reason → 不弹', () => {
    usageExceededStore.report(action({ provider: 'anthropic' }))
    usageExceededStore.report(action({ reason: 'other' }))
    usageExceededStore.report(undefined)
    expect(usageExceededStore.getSnapshot()).toBeNull()
  })

  it('24h 窗口内不重复提示', () => {
    usageExceededStore.report(action())
    expect(usageExceededStore.getSnapshot()).not.toBeNull()
    usageExceededStore.dismiss(false) // 记录本次已见

    usageExceededStore.report(action())
    expect(usageExceededStore.getSnapshot()).toBeNull()
  })

  it('「不再提示」持久化后不再弹', () => {
    usageExceededStore.report(action())
    usageExceededStore.dismiss(true)

    usageExceededStore.report(action())
    expect(usageExceededStore.getSnapshot()).toBeNull()
  })

  it('dismiss(false) 返回 true（引导连接），dismiss(true) 返回 false', () => {
    usageExceededStore.report(action())
    expect(usageExceededStore.dismiss(false)).toBe(true)

    usageExceededStore.report(action({ reason: 'account_rate_limit' }))
    expect(usageExceededStore.dismiss(true)).toBe(false)
  })

  it('free_tier 与 account_rate_limit 各有独立窗口', () => {
    usageExceededStore.report(action())
    usageExceededStore.dismiss(false)

    // free tier 在窗口内，但 account rate limit 是另一种 → 仍应弹
    usageExceededStore.report(action({ reason: 'account_rate_limit' }))
    expect(usageExceededStore.getSnapshot()?.reason).toBe('account_rate_limit')
  })

  it('已有 pending 时不覆盖（官方 dialog.active 门控同款）', () => {
    usageExceededStore.report(action({ provider: 'opencode' }))
    usageExceededStore.report(action({ reason: 'account_rate_limit', provider: 'opencode-go', title: 'Second' }))
    expect(usageExceededStore.getSnapshot()?.title).toBe('Limit reached')
  })
})
