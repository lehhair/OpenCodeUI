import { describe, expect, it } from 'vitest'
import type { SessionMessageInfo } from '../types/api/message'
import { estimateMessageChars, estimateMessagesChars } from './messageSize'

function asMessage(value: object): SessionMessageInfo {
  return value as SessionMessageInfo
}

const base = { id: 'msg', time: { created: 1 } }

function tool(state: object) {
  return { type: 'tool', id: 'tool-1', name: 'bash', state, time: { created: 1 } }
}

describe('messageSize', () => {
  it('用户 / 系统 / 合成消息按正文长度算', () => {
    expect(estimateMessageChars(asMessage({ ...base, type: 'user', text: '你好' }))).toBe(2)
    expect(estimateMessageChars(asMessage({ ...base, type: 'system', text: 'note' }))).toBe(4)
    expect(estimateMessageChars(asMessage({ ...base, type: 'synthetic', text: 'abc' }))).toBe(3)
  })

  it('助手消息累加正文、推理和工具产出文本', () => {
    const message = asMessage({
      ...base,
      type: 'assistant',
      content: [
        { type: 'text', text: '123' },
        { type: 'reasoning', text: '45' },
        {
          ...tool({
            status: 'completed',
            input: {},
            content: [
              { type: 'text', text: '6789' },
              { type: 'file', uri: 'file://x', mime: 'text/plain' },
            ],
          }),
        },
      ],
    })

    expect(estimateMessageChars(message)).toBe(3 + 2 + 4)
  })

  it('运行中的工具按 metadata.output 估算，流式工具按半截 input', () => {
    const running = asMessage({
      ...base,
      type: 'assistant',
      content: [{ ...tool({ status: 'running', input: {}, metadata: { output: 'abcdef' } }) }],
    })
    expect(estimateMessageChars(running)).toBe(6)

    const streaming = asMessage({
      ...base,
      type: 'assistant',
      content: [{ ...tool({ status: 'streaming', input: '{"a":1}' }) }],
    })
    expect(estimateMessageChars(streaming)).toBe(7)
  })

  it('shell 消息算命令加输出', () => {
    const message = asMessage({
      ...base,
      type: 'shell',
      shellID: 'sh',
      command: 'ls -la',
      status: 'exited',
      output: { output: 'total 0', cursor: 0, size: 7, truncated: false },
    })
    expect(estimateMessageChars(message)).toBe(6 + 7)
  })

  it('列表求和', () => {
    const messages = [
      asMessage({ ...base, type: 'user', text: 'aa' }),
      asMessage({ ...base, type: 'synthetic', text: 'bbb' }),
    ]
    expect(estimateMessagesChars(messages)).toBe(5)
  })
})
