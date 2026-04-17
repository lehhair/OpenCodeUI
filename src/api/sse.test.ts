import { describe, expect, it } from 'vitest'
import { createSseTextParser } from './sse'

describe('createSseTextParser', () => {
  it('keeps multiline event data across chunk boundaries', () => {
    const parser = createSseTextParser()

    expect(parser.push('data: {"text":"中')).toEqual([])
    expect(parser.push('文"}\n')).toEqual([])
    expect(parser.push('data: 第二行\n\n')).toEqual(['{"text":"中文"}\n第二行'])
  })

  it('normalizes CRLF-delimited SSE blocks', () => {
    const parser = createSseTextParser()

    expect(parser.push('data: 你好\r\n')).toEqual([])
    expect(parser.push('data: 世界\r\n\r\n')).toEqual(['你好\n世界'])
  })
})
