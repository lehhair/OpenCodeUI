import { describe, expect, it } from 'vitest'
import { leadingTurnNeedsParent } from './useSessionManager'
import type { SessionMessageInfo } from '../types/api/message'

function msg(id: string, type: string): SessionMessageInfo {
  return { id, type } as unknown as SessionMessageInfo
}

describe('leadingTurnNeedsParent（官方 timeline/model.ts:90-95 同款）', () => {
  it('窗口里没有 assistant → 不需要补翻', () => {
    expect(leadingTurnNeedsParent([msg('u1', 'user')])).toBe(false)
    expect(leadingTurnNeedsParent([])).toBe(false)
  })

  it('首条 assistant 之前已有 user 边界 → 回合完整，不补翻', () => {
    expect(leadingTurnNeedsParent([msg('u1', 'user'), msg('a1', 'assistant')])).toBe(false)
  })

  it('窗口以 assistant 开头（父 user 在更深历史页）→ 需要补翻', () => {
    expect(leadingTurnNeedsParent([msg('a1', 'assistant'), msg('a2', 'assistant')])).toBe(true)
  })

  it('assistant 出现在 user 边界之前 → 需要补翻', () => {
    expect(leadingTurnNeedsParent([msg('a1', 'assistant'), msg('u1', 'user')])).toBe(true)
  })

  it('shell 消息也算边界（! 命令发起的回合）', () => {
    expect(leadingTurnNeedsParent([msg('s1', 'shell'), msg('a1', 'assistant')])).toBe(false)
  })
})
