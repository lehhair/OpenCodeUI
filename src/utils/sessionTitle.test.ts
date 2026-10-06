import { describe, expect, it } from 'vitest'
import { sessionDisplayTitle } from './sessionTitle'

const labels = { newSession: '新会话', childSession: '子会话' }

describe('sessionDisplayTitle（官方 displayLabel 同款）', () => {
  it('无标题 → 根会话 / 子会话标签', () => {
    expect(sessionDisplayTitle({ title: undefined }, labels)).toBe('新会话')
    expect(sessionDisplayTitle({ title: null }, labels)).toBe('新会话')
    expect(sessionDisplayTitle({ title: undefined, parentID: 'ses_parent' }, labels)).toBe('子会话')
  })

  it('普通标题原样展示', () => {
    expect(sessionDisplayTitle({ title: '重构队列 UI' }, labels)).toBe('重构队列 UI')
  })

  it('历史时间戳兜底标题折叠为简洁标签', () => {
    expect(
      sessionDisplayTitle({ title: 'New session - 2026-07-30T18:45:03.662Z' }, labels),
    ).toBe('新会话')
    expect(
      sessionDisplayTitle({ title: 'Child session - 2026-07-30T18:45:03.662Z' }, labels),
    ).toBe('子会话')
  })

  it('自定义标题（恰好以前缀开头但非时间戳格式）不折叠', () => {
    expect(sessionDisplayTitle({ title: 'New session - custom' }, labels)).toBe('New session - custom')
  })
})
