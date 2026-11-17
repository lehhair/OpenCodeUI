import { describe, expect, it } from 'vitest'
import { cropContent, formatContentSize, INLINE_MAX_CHARS, INLINE_MAX_LINES } from './contentBudget'

function makeLines(count: number, width = 40): string {
  return Array.from({ length: count }, (_, index) => `line-${index}-${'x'.repeat(width)}`).join('\n')
}

describe('cropContent', () => {
  it('keep短文本原样', () => {
    const text = makeLines(20)
    const result = cropContent(text)
    expect(result.cropped).toBe(false)
    expect(result.text).toBe(text)
    expect(result.omittedChars).toBe(0)
  })

  it('按字符上限裁剪，保留头尾', () => {
    const text = makeLines(4000)
    const result = cropContent(text)
    expect(result.cropped).toBe(true)
    expect(result.text.length).toBeLessThanOrEqual(INLINE_MAX_CHARS)
    expect(result.text.startsWith('line-0-')).toBe(true)
    expect(result.text.endsWith(`line-3999-${'x'.repeat(40)}`)).toBe(true)
    expect(result.text).toContain('\n…\n')
    expect(result.omittedLines).toBeGreaterThan(0)
    expect(result.omittedChars).toBeGreaterThan(0)
  })

  it('行数超过上限也裁剪', () => {
    const text = Array.from({ length: INLINE_MAX_LINES + 200 }, (_, index) => `${index}`).join('\n')
    const result = cropContent(text)
    expect(result.cropped).toBe(true)
    expect(result.omittedLines).toBeGreaterThan(0)
  })

  it('裁剪点落在整行边界', () => {
    const text = makeLines(3000)
    const result = cropContent(text)
    const [head, ...rest] = result.text.split('\n…\n')
    expect(rest).toHaveLength(1)
    expect(head.endsWith('x')).toBe(true)
    // 头段每一行都是完整的 line-N-xxx
    for (const line of head.split('\n')) {
      expect(line).toMatch(/^line-\d+-x+$/)
    }
  })

  it('单行超长文本也能切', () => {
    const text = 'x'.repeat(INLINE_MAX_CHARS * 3)
    const result = cropContent(text, { marker: '[cut]' })
    expect(result.cropped).toBe(true)
    expect(result.text).toContain('[cut]')
    expect(result.text.length).toBeLessThan(text.length)
  })

  it('自定义预算', () => {
    const text = makeLines(100)
    const result = cropContent(text, { maxChars: 500, maxLines: 10 })
    expect(result.cropped).toBe(true)
    expect(result.text.length).toBeLessThanOrEqual(560)
  })

  it('行数上限下 omittedLines 按头尾实际行数计算', () => {
    const text = Array.from({ length: 1000 }, (_, index) => `l${index}`).join('\n')
    const result = cropContent(text)
    // 900 行预算：头 540 + 尾 270
    expect(result.cropped).toBe(true)
    expect(result.omittedLines).toBe(190)
  })

  it('CRLF 文本按行切，不会留下半行', () => {
    const text = Array.from({ length: 2000 }, (_, index) => `crlf-${index}-${'y'.repeat(40)}`).join('\r\n')
    const result = cropContent(text)
    expect(result.cropped).toBe(true)
    const [head, tail] = result.text.split('\n…\n')
    // split 会把标记前的换行吃掉，留下行尾的 \r；去掉它再按 CRLF 拆行
    const headText = head.endsWith('\r') ? head.slice(0, -1) : head
    for (const line of headText.split('\r\n')) {
      expect(line).toMatch(/^crlf-\d+-y+$/)
    }
    expect(tail.startsWith('crlf-')).toBe(true)
  })

  it('空文本', () => {
    expect(cropContent('').cropped).toBe(false)
  })
})

describe('formatContentSize', () => {
  it('按量级格式化', () => {
    expect(formatContentSize(900)).toBe('900 B')
    expect(formatContentSize(2048)).toBe('2 KB')
    expect(formatContentSize(2 * 1024 * 1024)).toBe('2 MB')
  })
})
