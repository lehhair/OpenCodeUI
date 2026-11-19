import { describe, expect, it } from 'vitest'
import { buildHighlightRequest, type HighlightRequestParams } from './shikiStreamRequest'

const baseParams: HighlightRequestParams = {
  id: 7,
  key: 'block:ts:github-dark-default',
  text: 'const a = 1\n',
  language: 'ts',
  theme: 'github-dark-default',
  mode: 'tokens',
}

describe('buildHighlightRequest', () => {
  it('无在途请求且只是前缀增长时只发新增片段', () => {
    const message = buildHighlightRequest(baseParams, { confirmedText: 'const a', inFlight: 0 })

    expect(message.append).toBe(' = 1\n')
    expect(message.baseLength).toBe(7)
    expect(message.text).toBeUndefined()
  })

  it('有在途请求时发全量，避免 worker 位置和客户端认知错位', () => {
    const message = buildHighlightRequest(baseParams, { confirmedText: 'const a', inFlight: 1 })

    expect(message.text).toBe(baseParams.text)
    expect(message.append).toBeUndefined()
  })

  it('文本不是前缀增长时发全量', () => {
    const message = buildHighlightRequest(
      { ...baseParams, text: 'let b = 2' },
      { confirmedText: 'const a', inFlight: 0 },
    )

    expect(message.text).toBe('let b = 2')
    expect(message.append).toBeUndefined()
  })

  it('强制重开、一次性完整排版、html 模式都发全量', () => {
    expect(buildHighlightRequest({ ...baseParams, forceReset: true }, { confirmedText: 'const a', inFlight: 0 }).text).toBe(
      baseParams.text,
    )
    expect(buildHighlightRequest({ ...baseParams, complete: true }, { confirmedText: 'const a', inFlight: 0 }).text).toBe(
      baseParams.text,
    )
    expect(
      buildHighlightRequest({ ...baseParams, mode: 'html' }, { confirmedText: 'const a', inFlight: 0 }).text,
    ).toBe(baseParams.text)
  })

  it('还没有确认过前缀时发全量', () => {
    const message = buildHighlightRequest(baseParams, { confirmedText: '', inFlight: 0 })

    expect(message.text).toBe(baseParams.text)
    expect(message.append).toBeUndefined()
  })
})
