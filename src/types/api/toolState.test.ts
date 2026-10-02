import { describe, expect, it } from 'vitest'
import type { AssistantTool } from './message'
import {
  currentContentDefaultOpen,
  currentToolError,
  currentToolErrorStatus,
  currentToolFailed,
  currentToolFiles,
  currentToolHasLoadedFiles,
  currentToolInput,
  currentToolMetadata,
  currentToolOutput,
  executeToolFailed,
  shellResultFailed,
} from './toolState'

// ============================================
// 工具状态读取
//
// 这些规则来自官方 packages/session-ui/src/message/current-tool-state.ts。
// 重点：v2 的信息分布在 metadata / content / error 三处，
// 旧适配层曾压成 `output: string` 并 JSON.stringify 错误，丢掉了
// 文件附件、错误状态码、shell 退出码 —— 这里逐条锁住正确行为。
// ============================================

function tool(overrides: Partial<AssistantTool> & Pick<AssistantTool, 'state'>): AssistantTool {
  return {
    type: 'tool',
    id: 'tool_1',
    name: 'bash',
    time: { created: 1 },
    ...overrides,
  }
}

describe('currentToolInput', () => {
  it('streaming 时 input 是 JSON 字符串，需要解析', () => {
    expect(currentToolInput(tool({ state: { status: 'streaming', input: '{"a":1}' } }))).toEqual({ a: 1 })
  })

  it('streaming 的半截 JSON 解析失败时返回空对象（流式期间正常现象）', () => {
    expect(currentToolInput(tool({ state: { status: 'streaming', input: '{"a":' } }))).toEqual({})
  })

  it('running 时 input 已经是对象，直接返回', () => {
    expect(currentToolInput(tool({ state: { status: 'running', input: { b: 2 }, metadata: {} } }))).toEqual({ b: 2 })
  })
})

describe('currentToolMetadata', () => {
  it('streaming 没有 metadata → 空对象', () => {
    expect(currentToolMetadata(tool({ state: { status: 'streaming', input: '' } }))).toEqual({})
  })
  it('running / completed 取到 metadata', () => {
    expect(currentToolMetadata(tool({ state: { status: 'running', input: {}, metadata: { k: 1 } } }))).toEqual({ k: 1 })
  })
})

describe('currentToolOutput', () => {
  it('running 时从 metadata.output 取（shell 边跑边出）', () => {
    expect(currentToolOutput(tool({ state: { status: 'running', input: {}, metadata: { output: 'partial' } } }))).toBe(
      'partial',
    )
  })

  it('completed 时拼接 content 里的文本片段', () => {
    const t = tool({
      state: {
        status: 'completed',
        input: {},
        content: [
          { type: 'text', text: 'line1' },
          { type: 'text', text: 'line2' },
        ],
      },
    })
    expect(currentToolOutput(t)).toBe('line1\nline2')
  })

  it('文件类 content 不混进文本输出', () => {
    const t = tool({
      state: {
        status: 'completed',
        input: {},
        content: [
          { type: 'text', text: 'ok' },
          { type: 'file', uri: 'file:///a.png', mime: 'image/png', name: 'a.png' },
        ],
      },
    })
    expect(currentToolOutput(t)).toBe('ok')
  })

  it('没有内容时返回 undefined', () => {
    expect(
      currentToolOutput(tool({ state: { status: 'completed', input: {}, content: [{ type: 'text', text: '' }] } })),
    ).toBeUndefined()
    expect(currentToolOutput(tool({ state: { status: 'running', input: {}, metadata: {} } }))).toBeUndefined()
  })
})

describe('currentToolFiles', () => {
  it('取出文件类 content（旧适配层会整块丢掉）', () => {
    const t = tool({
      state: {
        status: 'completed',
        input: {},
        content: [
          { type: 'text', text: 'x' },
          { type: 'file', uri: 'file:///a.png', mime: 'image/png', name: 'a.png' },
        ],
      },
    })
    expect(currentToolFiles(t)).toEqual([{ type: 'file', uri: 'file:///a.png', mime: 'image/png', name: 'a.png' }])
  })

  it('streaming / running 没有文件内容', () => {
    expect(currentToolFiles(tool({ state: { status: 'streaming', input: '' } }))).toEqual([])
    expect(currentToolFiles(tool({ state: { status: 'running', input: {}, metadata: {} } }))).toEqual([])
  })
})

describe('currentToolError', () => {
  it('返回结构化 error 的 message（不是序列化后的 JSON）', () => {
    const t = tool({
      state: {
        status: 'error',
        input: {},
        error: { type: 'provider_error', message: 'command not found', status: 503 },
      },
    })
    expect(currentToolError(t)).toBe('command not found')
    expect(currentToolErrorStatus(t)).toBe(503)
    expect(currentToolError(t)).not.toContain('{')
  })

  it('非 error 状态没有错误信息', () => {
    expect(currentToolError(tool({ state: { status: 'running', input: {}, metadata: {} } }))).toBeUndefined()
    expect(currentToolErrorStatus(tool({ state: { status: 'running', input: {}, metadata: {} } }))).toBeUndefined()
  })
})

describe('currentToolFailed — 旧 UI 完全没有建模的情况', () => {
  it('status error 即失败', () => {
    expect(
      currentToolFailed(
        tool({ name: 'bash', state: { status: 'error', input: {}, error: { type: 'x', message: 'm' } } }),
      ),
    ).toBe(true)
  })

  it('shell 是 completed 但退出码非 0 → 仍算失败', () => {
    const t = tool({
      name: 'shell',
      state: { status: 'completed', input: {}, content: [{ type: 'text', text: 'x' }], metadata: { exit: 1 } },
    })
    expect(currentToolFailed(t)).toBe(true)
  })

  it('shell 超时 → 算失败', () => {
    const t = tool({
      name: 'shell',
      state: { status: 'completed', input: {}, content: [{ type: 'text', text: 'x' }], metadata: { timeout: true } },
    })
    expect(currentToolFailed(t)).toBe(true)
  })

  it('shell 退出码 0 → 不算失败', () => {
    const t = tool({
      name: 'shell',
      state: { status: 'completed', input: {}, content: [{ type: 'text', text: 'x' }], metadata: { exit: 0 } },
    })
    expect(currentToolFailed(t)).toBe(false)
  })

  it('execute 在 completed 里报告内部调用失败 → 算失败', () => {
    const t = tool({
      name: 'execute',
      state: {
        status: 'completed',
        input: {},
        content: [{ type: 'text', text: 'x' }],
        metadata: { toolCalls: [{ status: 'error' }] },
      },
    })
    expect(currentToolFailed(t)).toBe(true)
  })
})

describe('shellResultFailed / executeToolFailed', () => {
  it('shellResultFailed 只认 timeout 与非 0 exit', () => {
    expect(shellResultFailed({ exit: 0 })).toBe(false)
    expect(shellResultFailed({ exit: 2 })).toBe(true)
    expect(shellResultFailed({ timeout: true })).toBe(true)
    expect(shellResultFailed({})).toBe(false)
  })

  it('executeToolFailed 认 metadata.error 与内部 error 调用', () => {
    expect(executeToolFailed({ error: true })).toBe(true)
    expect(executeToolFailed({ toolCalls: [{ status: 'ok' }] })).toBe(false)
    expect(executeToolFailed({ toolCalls: 'nope' })).toBe(false)
  })
})

describe('currentToolHasLoadedFiles', () => {
  it('只有 read + completed + metadata.loaded 才算', () => {
    // completed 的 content 是**非空元组**（[ToolContent, ...ToolContent[]]），
    // 因此这里显式标注为单元素元组，否则 TS 会推成普通数组而报错。
    const base = {
      status: 'completed' as const,
      input: {},
      content: [{ type: 'text' as const, text: 'x' }] as [{ type: 'text'; text: string }],
    }
    expect(currentToolHasLoadedFiles(tool({ name: 'read', state: { ...base, metadata: { loaded: ['/a'] } } }))).toBe(
      true,
    )
    expect(currentToolHasLoadedFiles(tool({ name: 'read', state: { ...base, metadata: { loaded: [] } } }))).toBe(false)
    expect(currentToolHasLoadedFiles(tool({ name: 'bash', state: { ...base, metadata: { loaded: ['/a'] } } }))).toBe(
      false,
    )
  })
})

describe('currentContentDefaultOpen', () => {
  it('非 tool 内容不参与判断', () => {
    expect(currentContentDefaultOpen({ type: 'text', text: 'x' }, false, false)).toBeUndefined()
  })

  it('出错的工作默认收起', () => {
    const content = tool({ state: { status: 'error', input: {}, error: { type: 'x', message: 'm' } } })
    expect(currentContentDefaultOpen(content, true, true)).toBe(false)
  })

  it('shell / execute 跟随 shellExpanded，patch 跟随 editExpanded', () => {
    const shell = tool({ name: 'shell', state: { status: 'running', input: {}, metadata: {} } })
    expect(currentContentDefaultOpen(shell, true, false)).toBe(true)
    expect(currentContentDefaultOpen(shell, false, true)).toBe(false)

    const patch = tool({ name: 'patch', state: { status: 'running', input: {}, metadata: {} } })
    expect(currentContentDefaultOpen(patch, false, true)).toBe(true)
  })

  it('read 这类工具不干预展开状态', () => {
    const read = tool({ name: 'read', state: { status: 'running', input: {}, metadata: {} } })
    expect(currentContentDefaultOpen(read, true, true)).toBeUndefined()
  })

  it('edit 在 editExpanded 关闭时收起；无文件列表时展开', () => {
    const noFiles = tool({ name: 'edit', state: { status: 'running', input: {}, metadata: {} } })
    expect(currentContentDefaultOpen(noFiles, false, false)).toBe(false)
    expect(currentContentDefaultOpen(noFiles, false, true)).toBe(true)
  })

  it('edit 的文件全部 deleted 时收起', () => {
    const allDeleted = tool({
      name: 'edit',
      state: { status: 'running', input: {}, metadata: { files: [{ status: 'deleted' }] } },
    })
    expect(currentContentDefaultOpen(allDeleted, false, true)).toBe(false)

    const mixed = tool({
      name: 'edit',
      state: { status: 'running', input: {}, metadata: { files: [{ status: 'deleted' }, { status: 'modified' }] } },
    })
    expect(currentContentDefaultOpen(mixed, false, true)).toBe(true)
  })
})
