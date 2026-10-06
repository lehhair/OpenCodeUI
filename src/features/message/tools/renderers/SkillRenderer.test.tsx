import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SkillRenderer, skillToolName } from './SkillRenderer'
import { extractToolData } from '../registry'
import type { ToolViewPart } from '../types'

function tool(name: string, state: Record<string, unknown>): ToolViewPart {
  return { type: 'tool', id: 'p1', messageID: 'm1', name, state, time: { created: 1 } } as unknown as ToolViewPart
}

describe('SkillRenderer（官方 session-ui:2172 同款）', () => {
  it('completed：一行「Loaded skill <name>」', () => {
    render(<SkillRenderer part={tool('skill', { status: 'completed', input: { name: 'commit' }, content: [] })} data={{}} />)
    expect(screen.getByText('Loaded skill')).toBeInTheDocument()
    expect(screen.getByText('commit')).toBeInTheDocument()
  })

  it('running：无名字时 shimmer 占位，带名字时名字 shimmer', () => {
    const { container } = render(
      <SkillRenderer part={tool('skill', { status: 'running', input: { name: 'review-pr' } })} data={{}} />,
    )
    expect(screen.getByText('review-pr')).toBeInTheDocument()
    expect(container.querySelector('.reasoning-shimmer-text')).toBeTruthy()
  })

  it('skillToolName：input.name 优先，metadata.name 兜底', () => {
    expect(skillToolName({ name: 'a' }, {})).toBe('a')
    expect(skillToolName({}, { name: 'b' })).toBe('b')
    expect(skillToolName({}, {})).toBeUndefined()
  })
})

describe('list/skill 提取器', () => {
  it('list：completed 只留 output，压掉 input JSON dump（官方同款）', () => {
    const data = extractToolData(
      tool('list', {
        status: 'completed',
        input: { path: '/repo/src' },
        content: [{ type: 'text', text: 'a.ts\nb.ts' }],
      }),
    )
    expect(data.output).toBe('a.ts\nb.ts')
    expect(data.input).toBeUndefined()
  })

  it('list：streaming 保留原始 input 预览', () => {
    const data = extractToolData(tool('list', { status: 'streaming', input: '{"path":"/re' }))
    expect(data.input).toBe('{"path":"/re')
  })

  it('skill：input/output 都不进提取数据（官方整卡只有状态行）', () => {
    const data = extractToolData(
      tool('skill', { status: 'completed', input: { name: 'commit' }, content: [{ type: 'text', text: 'x' }] }),
    )
    expect(data.input).toBeUndefined()
    expect(data.output).toBeUndefined()
  })
})
