import { describe, expect, it, vi } from 'vitest'
import { finishPerf, measurePerf, startPerf } from './perfTrace'

describe('perfTrace', () => {
  it('measurePerf 返回函数结果', () => {
    const fn = vi.fn(() => 42)
    expect(measurePerf('test', fn)).toBe(42)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('测试环境下不产出计时值', () => {
    // Vitest 的 MODE 是 test，整个打点应当关闭
    expect(startPerf()).toBeNull()
    finishPerf('test', null, 0)
  })
})
