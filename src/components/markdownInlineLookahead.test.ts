import { describe, expect, it } from 'vitest'
import { INLINE_LOOKAHEAD_CHARS, trimUnstableInlineTail } from './markdownInlineLookahead'

describe('trimUnstableInlineTail', () => {
  it('未闭合的粗体标记先藏起来', () => {
    expect(trimUnstableInlineTail('hello **bo')).toBe('hello ')
  })

  it('闭合后原样返回', () => {
    const text = 'hello **bold** done'
    expect(trimUnstableInlineTail(text)).toBe(text)
  })

  it('未闭合的反引号和删除线也会藏', () => {
    expect(trimUnstableInlineTail('run `np')).toBe('run ')
    expect(trimUnstableInlineTail('a ~~del')).toBe('a ')
  })

  it('单个星号、下划线、美元符不算未闭合（误判太多）', () => {
    const text = '价格 $5，3 * 4，snake_case'
    expect(trimUnstableInlineTail(text)).toBe(text)
  })

  it('未闭合标记离末尾太远就放行，避免永久藏住尾巴', () => {
    const text = '**开头 ' + 'x'.repeat(INLINE_LOOKAHEAD_CHARS + 10)
    expect(trimUnstableInlineTail(text)).toBe(text)
  })

  it('只看最后一个段落', () => {
    const text = '上一段 **没闭合\n\n这一段是正常的'
    expect(trimUnstableInlineTail(text)).toBe(text)
  })

  it('取多个未闭合标记里最靠前的那个', () => {
    expect(trimUnstableInlineTail('a `code **bold')).toBe('a ')
  })

  it('空字符串和短文本原样返回', () => {
    expect(trimUnstableInlineTail('')).toBe('')
    expect(trimUnstableInlineTail('ab')).toBe('ab')
  })
})

describe('段落边界', () => {
  it('没有空行时从 0 开始，不会切掉第一个字符', () => {
    expect(trimUnstableInlineTail('**粗体**')).toBe('**粗体**')
  })

  it('未闭合标记就在段首时按原文渲染，避免整段空一下', () => {
    expect(trimUnstableInlineTail('**粗体')).toBe('**粗体')
  })
})
