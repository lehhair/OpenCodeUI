import { describe, expect, it } from 'vitest'
import { healthToConnectionDisplay } from './connectionDisplay'
import type { ServerHealth } from '../store/serverStore'

function health(status: ServerHealth['status']): ServerHealth {
  return { status }
}

describe('healthToConnectionDisplay', () => {
  it('在线 → 绿色', () => {
    expect(healthToConnectionDisplay(health('online'))).toBe('connected')
  })

  it('检查中 → 过渡态', () => {
    expect(healthToConnectionDisplay(health('checking'))).toBe('connecting')
  })

  it('离线 → 灰色', () => {
    expect(healthToConnectionDisplay(health('offline'))).toBe('disconnected')
  })

  it('凭据错误 / 探测错误 → 红色', () => {
    expect(healthToConnectionDisplay(health('unauthorized'))).toBe('error')
    expect(healthToConnectionDisplay(health('error'))).toBe('error')
  })

  it('还没查过 → 过渡态（随后会发起检查）', () => {
    expect(healthToConnectionDisplay(undefined)).toBe('connecting')
    expect(healthToConnectionDisplay(null)).toBe('connecting')
  })
})
