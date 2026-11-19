import { describe, expect, it } from 'vitest'
import type { AssistantContent, AssistantMessage, ToolState } from '../../types/api/message'
import { getProcessSplit, groupContentForRender, splitProcessRenderItems } from './contentGrouping'

let sequence = 0

function assistant(content: AssistantContent[], completed?: number): AssistantMessage {
  sequence += 1
  return {
    type: 'assistant',
    id: `assistant-${sequence}`,
    agent: 'build',
    model: { id: 'model', providerID: 'provider' },
    content,
    time: completed == null ? { created: sequence } : { created: sequence, completed },
  }
}

const text = (value: string): Extract<AssistantContent, { type: 'text' }> => ({ type: 'text', text: value })
const reasoning = (value: string): Extract<AssistantContent, { type: 'reasoning' }> => ({
  type: 'reasoning',
  text: value,
})

function tool(name: string, state: ToolState = { status: 'completed', input: {}, content: [{ type: 'text', text: 'ok' }] }) {
  sequence += 1
  return { type: 'tool', id: `tool-${sequence}`, name, state, time: { created: sequence } } as AssistantContent
}

describe('contentGrouping', () => {
  it('连续工具合并成一组，文本会打断分组', () => {
    const message = assistant([tool('read'), tool('bash'), text('done')], 10)
    const items = groupContentForRender(message)

    expect(items.map(item => item.type)).toEqual(['tool-group', 'single'])
    expect(items[0]).toMatchObject({ type: 'tool-group' })
    if (items[0]?.type === 'tool-group') expect(items[0].tools).toHaveLength(2)
  })

  it('todowrite 卡片不渲染', () => {
    const items = groupContentForRender(assistant([tool('read'), tool('todowrite'), tool('bash')], 10))
    expect(items).toHaveLength(1)
    if (items[0]?.type !== 'tool-group') throw new Error('expected tool group')
    expect(items[0].tools.map(entry => entry.content.name)).toEqual(['read', 'bash'])
  })

  it('流式中的空文本片段保留，结束后丢弃', () => {
    const streaming = assistant([text('hello'), text('   ')])
    expect(groupContentForRender(streaming)).toHaveLength(2)

    const completed = assistant([text('hello'), text('   ')], 10)
    expect(groupContentForRender(completed)).toHaveLength(1)
  })

  it('同一快照复用分组结果，内容变化后重建', () => {
    const message = assistant([text('hello')], 10)
    const first = groupContentForRender(message)
    expect(groupContentForRender(message)).toBe(first)

    message.content = [...message.content, reasoning('thinking')]
    const rebuilt = groupContentForRender(message)
    expect(rebuilt).not.toBe(first)
    expect(rebuilt).toHaveLength(2)
  })

  it('尾部连续文本划成最终回答，其余进过程', () => {
    const split = getProcessSplit(assistant([reasoning('plan'), tool('read'), text('a'), text('b')], 10))

    expect(split.hasProcess).toBe(true)
    expect(split.hasFinal).toBe(true)
    expect(split.finalItems).toHaveLength(2)
    expect(split.processItems).toHaveLength(2)
  })

  it('splitProcessRenderItems 在没有文本时全部归入过程', () => {
    const split = splitProcessRenderItems([
      { type: 'single', id: 'r', content: reasoning('plan') },
      { type: 'tool-group', tools: [] },
    ])

    expect(split).toEqual({
      processItems: expect.any(Array),
      finalItems: [],
      hasProcess: true,
      hasFinal: false,
    })
  })
})
