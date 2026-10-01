import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RetryStatusInline, type RetryStatusInlineData } from './RetryStatusInline'

// 倒计时依赖 useNow 的节拍；测试里让它返回一个固定时间点，结果才可断言
vi.mock('../../hooks/useNow', () => ({
  useNow: () => Date.now(),
}))

function makeStatus(overrides: Partial<RetryStatusInlineData> = {}): RetryStatusInlineData {
  return {
    sessionID: 'session-1',
    attempt: 2,
    message: 'provider overloaded',
    next: Date.now() + 5000,
    ...overrides,
  }
}

describe('RetryStatusInline', () => {
  it('把 next 当成绝对时间戳，算出剩余倒计时', () => {
    render(<RetryStatusInline status={makeStatus({ next: Date.now() + 5000 })} />)

    // 5s → formatRemaining 走 <10s 分支，显示 "5.0s"
    expect(screen.getByText(/5\.\ds/)).toBeTruthy()
    expect(screen.getByText(/2/)).toBeTruthy()
  })

  it('next 已经过去时不显示倒计时', () => {
    render(<RetryStatusInline status={makeStatus({ next: Date.now() - 5000 })} />)

    expect(screen.queryByText(/nextIn|5\.0s/)).toBeNull()
  })

  /**
   * v2 只声明 `next: number`，没有说明单位。若服务端给的是「延迟毫秒数」
   * 而不是时间戳，`next - now` 会算出天文数字。此时宁可不显示倒计时，
   * 也不要显示 "1758000000.0s" 这种荒谬结果。
   */
  it('next 大得不像时间戳时退回不显示倒计时（单位假设的保护）', () => {
    render(<RetryStatusInline status={makeStatus({ next: 5_000 })} />)

    expect(screen.queryByText(/s$/)).toBeNull()
  })
})
