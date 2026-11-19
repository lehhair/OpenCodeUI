import { beforeEach, describe, expect, it } from 'vitest'
import { markCardEntered, resetCardEnterForTests, shouldPlayCardEnter } from './streamCardEnter'

const base = {
  id: 'tool-1',
  created: 1_000,
  enabled: true,
  now: 2_000,
}

describe('shouldPlayCardEnter', () => {
  beforeEach(() => {
    resetCardEnterForTests()
  })

  it('流式中新到的卡播一次', () => {
    expect(shouldPlayCardEnter(base)).toBe(true)
  })

  it('同一张卡不会重播', () => {
    markCardEntered('tool-1')
    expect(shouldPlayCardEnter(base)).toBe(false)
  })

  it('不在流式、或用户要求减少动效时不播', () => {
    expect(shouldPlayCardEnter({ ...base, enabled: false })).toBe(false)
    expect(shouldPlayCardEnter({ ...base, reducedMotion: true })).toBe(false)
  })

  it('超过入场上限的旧工具不播（历史消息挂载）', () => {
    expect(shouldPlayCardEnter({ ...base, created: 0, now: 60_000 })).toBe(false)
  })

  it('刚过上限边界仍然不播', () => {
    expect(shouldPlayCardEnter({ ...base, created: 0, now: 3_001 })).toBe(false)
    expect(shouldPlayCardEnter({ ...base, created: 0, now: 3_000 })).toBe(true)
  })
})
