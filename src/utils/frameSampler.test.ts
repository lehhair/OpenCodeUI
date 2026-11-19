import { describe, expect, it } from 'vitest'
import { createFrameStatsAccumulator } from './frameSampler'

describe('frameSampler', () => {
  it('没有采样时返回 null', () => {
    expect(createFrameStatsAccumulator().snapshot()).toBeNull()
  })

  it('统计平均帧、最长帧与掉帧数', () => {
    const accumulator = createFrameStatsAccumulator()
    // 16.7ms 连续 10 帧 + 一帧 50ms
    for (let index = 0; index < 10; index += 1) accumulator.add(16.7)
    accumulator.add(50)

    const stats = accumulator.snapshot()
    expect(stats).not.toBeNull()
    if (!stats) return

    expect(stats.frames).toBe(11)
    expect(stats.longestFrameMs).toBe(50)
    // 16.7ms ≈ 1 帧预算，不额外掉帧；50ms ≈ 3 帧预算，掉 2 帧
    expect(stats.droppedFrames).toBe(2)
    expect(stats.longFrameRatio).toBeCloseTo(1 / 11, 5)
    expect(stats.avgFrameMs).toBeCloseTo((16.7 * 10 + 50) / 11, 5)
  })

  it('p95 落在慢帧桶上', () => {
    const accumulator = createFrameStatsAccumulator()
    for (let index = 0; index < 94; index += 1) accumulator.add(8)
    for (let index = 0; index < 6; index += 1) accumulator.add(40)

    const stats = accumulator.snapshot()
    expect(stats?.p95FrameMs).toBe(40)
  })

  it('忽略非法间隔，超大间隔落在最后一个桶', () => {
    const accumulator = createFrameStatsAccumulator()
    accumulator.add(-1)
    accumulator.add(Number.NaN)
    accumulator.add(5000)

    const stats = accumulator.snapshot()
    expect(stats?.frames).toBe(1)
    expect(stats?.longestFrameMs).toBe(5000)
    expect(stats?.p95FrameMs).toBe(199)
  })
})
