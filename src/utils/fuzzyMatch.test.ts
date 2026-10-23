// ============================================
// fuzzyMatch 核心契约测试
// ============================================

import { describe, expect, it } from 'vitest'
import { fuzzyScore } from './fuzzyMatch'

describe('fuzzyScore 分级语义', () => {
  it('名字全等得分最高', () => {
    const exact = fuzzyScore('compact', 'compact', 'some description containing compact')
    const other = fuzzyScore('compact', 'other-cmd', 'some description containing compact')
    expect(exact).toBeGreaterThan(other)
  })

  it('名字前缀命中压过描述命中 —— /goa 必须让 goal 排第一', () => {
    const goal = fuzzyScore('goa', 'goal', 'Set, show goals')
    const reviewWork = fuzzyScore('goa', 'review-work', 'check the goal of post-implementation')
    expect(goal).toBeGreaterThan(reviewWork)
    expect(reviewWork).toBeGreaterThan(0) // 描述命中仍然可见，但排后面
  })

  it('名字子串命中压过描述命中 —— /comp 必须让 compact 压过一堆 skill', () => {
    const compact = fuzzyScore('comp', 'compact', '通过总结对话历史压缩上下文')
    const skillWithCompInDesc = fuzzyScore('comp', 'agent-lane-orchestrator', 'compare components and compose reports')
    expect(compact).toBeGreaterThan(skillWithCompInDesc)
  })

  it('词边界命中：stats 能搜到 session-stats', () => {
    const score = fuzzyScore('stats', 'session-stats')
    expect(score).toBeGreaterThan(0)
    const substringOnly = fuzzyScore('stats', 'statistician')
    expect(score).toBeGreaterThan(substringOnly)
  })

  it('缩写（子序列）命中：cmp 能搜到 compact —— 打不完整也能找到', () => {
    const score = fuzzyScore('cmp', 'compact')
    expect(score).toBeGreaterThan(0)
    // 更紧凑的匹配得分更高：compact 比 c-o-m-p 分散的词得分高
    const tighter = fuzzyScore('cmp', 'cmp')
    expect(tighter).toBeGreaterThan(score)
  })

  it('子序列必须保持字符顺序，乱序不匹配', () => {
    expect(fuzzyScore('pmc', 'compact')).toBe(0)
  })

  it('完全无关的内容不匹配', () => {
    expect(fuzzyScore('xyz', 'compact')).toBe(0)
    expect(fuzzyScore('xyz', 'compact', '关于对话历史的总结')).toBe(0)
  })

  it('空 query 返回 0 分（调用方应视为「全部可见」）', () => {
    expect(fuzzyScore('', 'compact')).toBe(0)
    expect(fuzzyScore('  ', 'compact')).toBe(0)
  })

  it('描述子序列兜底需要 query 至少 2 个字符', () => {
    expect(fuzzyScore('c', 'review-work', 'check components')).toBe(0)
    expect(fuzzyScore('co', 'review-work', 'check components')).toBeGreaterThan(0)
  })
})

describe('fuzzyScore 排序契约（模拟真实命令面板）', () => {
  interface Cmd {
    name: string
    description?: string
  }

  function rank(query: string, cmds: Cmd[]): string[] {
    return cmds
      .map(c => ({ name: c.name, score: fuzzyScore(query, c.name, c.description) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(x => x.name)
  }

  it('场景还原：输入 comp 时 compact 排第一，描述里碰巧有 comp 的 skill 靠后', () => {
    const ranked = rank('comp', [
      { name: 'agent-lane-orchestrator', description: 'compare components and reports' },
      { name: 'compact', description: '通过总结对话历史压缩上下文' },
      { name: 'review-work', description: 'post implementation review' },
    ])
    expect(ranked[0]).toBe('compact')
    expect(ranked).toContain('agent-lane-orchestrator')
  })

  it('场景还原：输入 goa 时 goal 排在 review-work 前面', () => {
    const ranked = rank('goa', [
      { name: 'review-work', description: 'Post-implementation review of the goal' },
      { name: 'goal', description: 'Set, show goals' },
    ])
    expect(ranked[0]).toBe('goal')
  })
})
