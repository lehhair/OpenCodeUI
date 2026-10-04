import { describe, expect, it } from 'vitest'
import { findBlockingBackgroundTasks } from './backgroundTasks'
import type { SessionMessageInfo } from '../../types/api/message'

function assistant(overrides: {
  completed?: number
  content?: SessionMessageInfo extends never ? never : any[]
}): SessionMessageInfo {
  return {
    id: 'msg_a',
    type: 'assistant',
    role: 'assistant',
    time: { created: 1, ...(overrides.completed !== undefined ? { completed: overrides.completed } : {}) },
    content: overrides.content ?? [],
  } as unknown as SessionMessageInfo
}

function toolPart(name: string, status: string, input?: Record<string, unknown>) {
  return { type: 'tool', id: `part_${name}`, name, state: { status, input } }
}

describe('findBlockingBackgroundTasks', () => {
  it('空消息列表返回空', () => {
    expect(findBlockingBackgroundTasks([])).toEqual([])
  })

  it('最新 assistant 运行中且有 running shell 工具 → 阻塞项', () => {
    const tasks = findBlockingBackgroundTasks([
      assistant({ content: [toolPart('shell', 'running', { command: 'npm run build' })] }),
    ])
    expect(tasks).toEqual([{ type: 'shell', id: 'part_shell', label: 'npm run build' }])
  })

  it('task/subagent 工具（两种命名）都识别', () => {
    const tasks = findBlockingBackgroundTasks([
      assistant({
        content: [
          toolPart('task', 'running', { description: '探索代码库' }),
          toolPart('subagent', 'running', { description: '审查 PR' }),
        ],
      }),
    ])
    expect(tasks.map(t => t.type)).toEqual(['task', 'task'])
    expect(tasks.map(t => t.label)).toEqual(['探索代码库', '审查 PR'])
  })

  it('最新 assistant 已 completed → 空', () => {
    const tasks = findBlockingBackgroundTasks([
      assistant({ completed: 2, content: [toolPart('shell', 'running', { command: 'x' })] }),
    ])
    expect(tasks).toEqual([])
  })

  it('已完成的工具不算阻塞；非 shell/task 工具不算', () => {
    const tasks = findBlockingBackgroundTasks([
      assistant({
        content: [toolPart('shell', 'completed', { command: 'x' }), toolPart('edit', 'running', { filePath: 'a.ts' })],
      }),
    ])
    expect(tasks).toEqual([])
  })

  it('只看最新 assistant；更早消息里的 running shell 不算', () => {
    const tasks = findBlockingBackgroundTasks([
      assistant({ content: [toolPart('shell', 'running', { command: 'old' })] }),
      assistant({ completed: 2, content: [{ type: 'text', text: 'done' }] }),
    ])
    expect(tasks).toEqual([])
  })
})
