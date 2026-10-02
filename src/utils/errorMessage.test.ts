import { describe, expect, it } from 'vitest'
import { isInterruptedError, unwrapErrorMessage } from './errorMessage'

// ============================================
// 错误文案解包（移植自官方 unwrapErrorMessage / isInterrupted）
// ============================================

describe('unwrapErrorMessage', () => {
  it('解不出结构时原样返回输入（官方行为：连 "Error: " 前缀一起保留）', () => {
    // 官方 data.ts:741 `if (!record(json)) return message` —— 返回的是**原始** message，
    // 不是去掉前缀的 text。因此这里断言保留前缀。
    expect(unwrapErrorMessage('Error: something broke')).toBe('Error: something broke')
  })

  it('解出 { error: { type, message } } 并拼成 type: message', () => {
    expect(unwrapErrorMessage('{"error":{"type":"ProviderError","message":"rate limited"}}')).toBe(
      'ProviderError: rate limited',
    )
  })

  it('只有 error.message 时返回 message', () => {
    expect(unwrapErrorMessage('{"error":{"message":"boom"}}')).toBe('boom')
  })

  it('只有 error.type 时返回 type', () => {
    expect(unwrapErrorMessage('{"error":{"type":"Aborted"}}')).toBe('Aborted')
  })

  it('回退到顶层 message', () => {
    expect(unwrapErrorMessage('{"message":"top level"}')).toBe('top level')
  })

  it('error 是字符串时返回它', () => {
    expect(unwrapErrorMessage('{"error":"plain reason"}')).toBe('plain reason')
  })

  it('字符串里套 JSON 串时再解一层', () => {
    expect(unwrapErrorMessage('"{\\"message\\":\\"nested\\"}"')).toBe('nested')
  })

  it('JSON 前后有杂文时取大括号区间', () => {
    expect(unwrapErrorMessage('request failed: {"message":"inner"} (trace 123)')).toBe('inner')
  })

  it('解不出来时原样返回（不吞掉信息）', () => {
    expect(unwrapErrorMessage('totally plain text')).toBe('totally plain text')
  })

  it('结果里不应残留 JSON 结构', () => {
    const out = unwrapErrorMessage('{"error":{"type":"X","message":"readable"}}')
    expect(out).not.toContain('{')
    expect(out).not.toContain('"')
  })
})

describe('isInterruptedError', () => {
  it('type 含 abort / interrupt（大小写不敏感）才算中断', () => {
    expect(isInterruptedError({ type: 'MessageAbortedError' })).toBe(true)
    expect(isInterruptedError({ type: 'execution.interrupted' })).toBe(true)
    expect(isInterruptedError({ type: 'ABORT' })).toBe(true)
  })

  it('其它错误不算中断', () => {
    expect(isInterruptedError({ type: 'ProviderError' })).toBe(false)
    expect(isInterruptedError({})).toBe(false)
    expect(isInterruptedError(undefined)).toBe(false)
  })
})
