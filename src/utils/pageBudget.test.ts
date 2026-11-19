import { describe, expect, it } from 'vitest'
import type { SessionMessageInfo } from '../types/api/message'
import { MIN_PAGE_LIMIT, PAGE_CHAR_BUDGET, derivePageLimit } from './pageBudget'

function message(text: string): SessionMessageInfo {
  return { id: `m-${text.length}`, type: 'user', time: { created: 1 }, text } as SessionMessageInfo
}

function messages(count: number, textLength: number): SessionMessageInfo[] {
  return Array.from({ length: count }, () => message('x'.repeat(textLength)))
}

describe('derivePageLimit', () => {
  it('普通大小的消息不改变页大小', () => {
    expect(derivePageLimit(messages(50, 500), 50)).toBe(50)
  })

  it('肥页按正文字符预算缩到能放下的条数', () => {
    // 每条 20KB，256KB 预算大约放得下 12 条
    const limit = derivePageLimit(messages(50, 20 * 1024), 50)
    expect(limit).toBe(Math.floor(PAGE_CHAR_BUDGET / (20 * 1024)))
  })

  it('单条就超过整页预算时不低于最小页', () => {
    expect(derivePageLimit(messages(10, PAGE_CHAR_BUDGET * 2), 50)).toBe(MIN_PAGE_LIMIT)
  })

  it('不会超过调用方给的上限', () => {
    expect(derivePageLimit(messages(10, 1), 5)).toBe(5)
  })

  it('空页或非法上限原样返回', () => {
    expect(derivePageLimit([], 50)).toBe(50)
    expect(derivePageLimit(messages(10, 100), 0)).toBe(0)
  })
})
