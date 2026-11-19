import { describe, expect, it } from 'vitest'
import type { ToolState } from '../../types/api/message'
import {
  buildDescriptiveToolStepsSummary,
  getToolSummaryCategory,
  isToolPartActive,
  type ToolEntry,
} from './toolSummary'

let sequence = 0

function tool(name: string, state: ToolState): ToolEntry {
  sequence += 1
  return {
    id: `${name}-${sequence}`,
    content: { type: 'tool', id: `tool-${sequence}`, name, state, time: { created: sequence } },
  }
}

const completed = (): ToolState => ({ status: 'completed', input: {}, content: [{ type: 'text', text: 'ok' }] })
const running = (): ToolState => ({ status: 'running', input: {}, metadata: {} })
const failed = (): ToolState => ({ status: 'error', input: {}, error: { type: 'unknown', message: 'boom' } })

const t = (key: string, opts?: Record<string, unknown>) => {
  if (!opts) return key
  if (typeof opts.count === 'number') return `${key}#${opts.count}`
  if (typeof opts.done === 'number') return `${key}#${opts.done}`
  return key
}

describe('toolSummary', () => {
  it('按工具名归类', () => {
    expect(getToolSummaryCategory('bash')).toBe('execute')
    expect(getToolSummaryCategory('shell')).toBe('execute')
    expect(getToolSummaryCategory('execute')).toBe('code')
    expect(getToolSummaryCategory('read')).toBe('read')
    expect(getToolSummaryCategory('glob')).toBe('list')
    expect(getToolSummaryCategory('grep')).toBe('search')
    expect(getToolSummaryCategory('webfetch')).toBe('network')
    expect(getToolSummaryCategory('edit')).toBe('edit')
    expect(getToolSummaryCategory('write')).toBe('write')
    expect(getToolSummaryCategory('task')).toBe('task')
    expect(getToolSummaryCategory('question')).toBe('question')
    expect(getToolSummaryCategory('mystery')).toBe('other')
  })

  it('running / streaming 算活跃，completed / error 不算', () => {
    expect(isToolPartActive(tool('read', running()).content)).toBe(true)
    expect(isToolPartActive(tool('read', { status: 'streaming', input: '' }).content)).toBe(true)
    expect(isToolPartActive(tool('read', completed()).content)).toBe(false)
    expect(isToolPartActive(tool('read', failed()).content)).toBe(false)
  })

  it('同类工具合并计数，按出现顺序输出', () => {
    const summary = buildDescriptiveToolStepsSummary(
      [tool('read', completed()), tool('read', completed()), tool('bash', completed())],
      t,
    )

    expect(summary.map(segment => segment.text)).toEqual([
      'toolSteps.readDone#2',
      'toolSteps.separator',
      'toolSteps.executeDone#1',
    ])
  })

  it('同类别既有成功又有失败时合并成一句并带失败数', () => {
    const summary = buildDescriptiveToolStepsSummary([tool('read', completed()), tool('read', failed())], t)

    expect(summary).toEqual([
      { text: 'toolSteps.readDone#2', type: 'normal' },
      { text: 'toolSteps.failedSuffix#1', type: 'error' },
    ])
  })

  it('运行中的工具单独追加为非错误段', () => {
    const summary = buildDescriptiveToolStepsSummary([tool('bash', running())], t)

    expect(summary).toEqual([{ text: 'toolSteps.executeActive#1', type: 'active' }])
  })

  it('超过三类已完成的工具折叠成 moreActions', () => {
    const summary = buildDescriptiveToolStepsSummary(
      [
        tool('read', completed()),
        tool('bash', completed()),
        tool('edit', completed()),
        tool('write', completed()),
      ],
      t,
    )

    expect(summary[summary.length - 1]).toEqual({ text: 'toolSteps.moreActions#1', type: 'normal' })
  })

  it('空列表退化成 stepsCount', () => {
    expect(buildDescriptiveToolStepsSummary([], t)).toEqual([{ text: 'stepsCount#0', type: 'normal' }])
  })
})
