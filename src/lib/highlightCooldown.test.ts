import { beforeEach, describe, expect, it } from 'vitest'
import {
  isHighlightLanguageCoolingDown,
  markHighlightLanguageFailed,
  resetHighlightCooldownsForTests,
} from './highlightCooldown'

describe('highlightCooldown', () => {
  beforeEach(() => {
    resetHighlightCooldownsForTests()
  })

  it('失败后进入冷却，窗口结束自动恢复', () => {
    markHighlightLanguageFailed('Wolfram', 1_000)
    expect(isHighlightLanguageCoolingDown('wolfram', 1_500)).toBe(true)
    expect(isHighlightLanguageCoolingDown('wolfram', 60_999)).toBe(true)
    expect(isHighlightLanguageCoolingDown('wolfram', 61_000)).toBe(false)
    expect(isHighlightLanguageCoolingDown('wolfram', 61_001)).toBe(false)
  })

  it('只影响失败的那门语言', () => {
    markHighlightLanguageFailed('wolfram', 1_000)
    expect(isHighlightLanguageCoolingDown('typescript', 2_000)).toBe(false)
  })

  it('重复失败会刷新窗口', () => {
    markHighlightLanguageFailed('php', 1_000)
    markHighlightLanguageFailed('php', 30_000)
    expect(isHighlightLanguageCoolingDown('php', 80_000)).toBe(true)
    expect(isHighlightLanguageCoolingDown('php', 90_001)).toBe(false)
  })
})
