import { describe, expect, it } from 'vitest'
import { nextPrependAdjustment, pickPrependAnchor } from './chatAreaUtils'

describe('pickPrependAnchor', () => {
  it('取视口内最靠上的可见行', () => {
    const anchor = pickPrependAnchor(
      [
        { key: 'a', top: -200, bottom: -40 }, // 完全在上方
        { key: 'b', top: -30, bottom: 20 }, // 跨过视口顶，最靠上
        { key: 'c', top: 40, bottom: 120 },
        { key: 'd', top: 500, bottom: 560 }, // 在下方
      ],
      0,
      400,
    )

    expect(anchor).toEqual({ key: 'b', offset: -30 })
  })

  it('跳过没有 key 的行', () => {
    const anchor = pickPrependAnchor(
      [
        { top: -10, bottom: 30 },
        { key: 'c', top: 50, bottom: 90 },
      ],
      0,
      400,
    )

    expect(anchor).toEqual({ key: 'c', offset: 50 })
  })

  it('没有可见行时返回 undefined', () => {
    expect(pickPrependAnchor([{ key: 'a', top: 500, bottom: 600 }], 0, 400)).toBeUndefined()
  })
})

describe('nextPrependAdjustment', () => {
  it('第一帧不看漂移，直接应用实测位移', () => {
    const decision = nextPrependAdjustment(
      { frames: 0, stable: 0 },
      { scrollTop: 120, delta: -40 },
    )

    expect(decision).toEqual({ stop: false, delta: -40, frames: 1, stable: 0 })
  })

  it('视口被外部改动时让位，不再写回', () => {
    const decision = nextPrependAdjustment(
      { frames: 1, stable: 0, expectedScrollTop: 100 },
      { scrollTop: 260, delta: 12 },
    )

    expect(decision).toEqual({ stop: true, delta: 0, frames: 2, stable: 0 })
  })

  it('位置连续稳定到上限就结束', () => {
    const decision = nextPrependAdjustment(
      { frames: 5, stable: 2, expectedScrollTop: 100 },
      { scrollTop: 100, delta: 0.2 },
      { stableFrames: 3 },
    )

    expect(decision.stop).toBe(true)
    expect(decision.delta).toBe(0)
  })

  it('跑满帧数上限就结束', () => {
    const decision = nextPrependAdjustment(
      { frames: 179, stable: 0, expectedScrollTop: 100 },
      { scrollTop: 100, delta: 8 },
      { maxFrames: 180 },
    )

    expect(decision.stop).toBe(true)
    expect(decision.delta).toBe(8)
  })

  it('锚点行还没渲染时计为稳定帧，不做位移', () => {
    const decision = nextPrependAdjustment(
      { frames: 0, stable: 0, expectedScrollTop: 10 },
      { scrollTop: 10, delta: undefined },
    )

    expect(decision).toEqual({ stop: false, delta: 0, frames: 1, stable: 1 })
  })
})
