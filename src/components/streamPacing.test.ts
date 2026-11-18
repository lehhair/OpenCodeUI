import { describe, expect, it, afterEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  DEFAULT_STREAM_PACING,
  safeRevealIndex,
  stepStreamPacing,
  usePacedStreamContent,
  type StreamPacingConfig,
} from './streamPacing'

/** 模拟持续按固定节拍推进，返回揭示到 target 所需的总时长 */
function revealDuration(target: number, tickMs = 32, config: Partial<StreamPacingConfig> = {}) {
  let revealed = 0
  let rate = 0
  let elapsed = 0
  for (let guard = 0; guard < 10_000; guard += 1) {
    const step = stepStreamPacing(target, revealed, rate, tickMs, config)
    revealed = step.revealed
    rate = step.rate
    elapsed += tickMs
    if (step.settled) return elapsed
  }
  throw new Error('pacing did not settle')
}

describe('stepStreamPacing', () => {
  it('settles immediately when nothing is pending', () => {
    expect(stepStreamPacing(10, 10, 120, 32)).toEqual({
      revealed: 10,
      rate: 0,
      settled: true,
      jumped: false,
    })
  })

  it('reveals a small append within roughly one window', () => {
    const duration = revealDuration(40)
    expect(duration).toBeLessThanOrEqual(700)
    expect(duration).toBeGreaterThan(0)
  })

  it('keeps a burst within the reveal window instead of dumping it at once', () => {
    const target = 300
    const first = stepStreamPacing(target, 0, 0, 32)
    // 第一拍不能直接铺满，否则等于没有节奏
    expect(first.revealed).toBeGreaterThan(0)
    expect(first.revealed).toBeLessThan(target)

    const duration = revealDuration(target)
    // 目标 450ms 内揭示完，缓动收尾会略长一点
    expect(duration).toBeGreaterThanOrEqual(320)
    expect(duration).toBeLessThanOrEqual(900)
  })

  it('caps catch-up speed for a long burst', () => {
    const step = stepStreamPacing(2000, 0, 0, 32)
    const revealedInOneTick = step.revealed
    // 上限 600 字符/秒，单拍 32ms 最多推进约 19.2 字符
    expect(revealedInOneTick).toBeLessThanOrEqual(DEFAULT_STREAM_PACING.maxCharsPerSecond * 0.032 + 0.001)
  })

  it('never advances slower than the minimum rate while catching up', () => {
    const step = stepStreamPacing(10, 0, 0, 32)
    expect(step.revealed).toBeGreaterThanOrEqual(DEFAULT_STREAM_PACING.minCharsPerSecond * 0.032 - 0.001)
  })

  it('jumps to the target when the backlog is too large', () => {
    const step = stepStreamPacing(DEFAULT_STREAM_PACING.jumpLagChars + 1, 0, 100, 32)
    expect(step.jumped).toBe(true)
    expect(step.settled).toBe(true)
    expect(step.revealed).toBe(DEFAULT_STREAM_PACING.jumpLagChars + 1)
  })

  it('clamps an oversized elapsed time so a background tab does not overshoot', () => {
    const step = stepStreamPacing(200, 0, 0, 10_000)
    expect(step.revealed).toBeLessThanOrEqual(
      (DEFAULT_STREAM_PACING.maxCharsPerSecond * DEFAULT_STREAM_PACING.maxStepMs) / 1000,
    )
  })

  it('eases the rate down when the backlog shrinks', () => {
    let rate = 600
    let revealed = 0
    const target = 60
    let previousRate = rate
    for (let tick = 0; tick < 20; tick += 1) {
      const step = stepStreamPacing(target, revealed, rate, 32)
      revealed = step.revealed
      rate = step.rate
      expect(rate).toBeLessThanOrEqual(previousRate + 1e-9)
      previousRate = rate
      if (step.settled) break
    }
  })
})

describe('safeRevealIndex', () => {
  it('clamps to the text bounds', () => {
    expect(safeRevealIndex('abc', -1)).toBe(0)
    expect(safeRevealIndex('abc', 99)).toBe(3)
  })

  it('does not split a surrogate pair', () => {
    const text = 'a😀b'
    // 😀 占用索引 1、2，切在 2 会把它劈成两半
    expect(safeRevealIndex(text, 2)).toBe(1)
    expect(safeRevealIndex(text, 3)).toBe(3)
  })

  it('keeps ordinary CJK boundaries untouched', () => {
    expect(safeRevealIndex('你好世界', 2)).toBe(2)
  })

  it('does not leave a dangling carriage return before a line feed', () => {
    expect(safeRevealIndex('line\r\nnext', 5)).toBe(4)
  })
})

describe('usePacedStreamContent', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('reveals an append over time instead of showing it in one frame', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(
      ({ content, enabled }: { content: string; enabled: boolean }) => usePacedStreamContent(content, enabled),
      { initialProps: { content: '你好', enabled: true } },
    )

    expect(result.current).toBe('你好')
    rerender({ content: '你好世界，欢迎回来', enabled: true })
    expect(result.current).toBe('你好')

    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(result.current).toBe('你好世界，欢迎回来')
  })

  it('snaps immediately when the stream ends', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(
      ({ content, enabled }: { content: string; enabled: boolean }) => usePacedStreamContent(content, enabled),
      { initialProps: { content: 'a', enabled: true } },
    )

    rerender({ content: 'a much longer tail that would otherwise be paced', enabled: true })
    expect(result.current).toBe('a')

    rerender({ content: 'a much longer tail that would otherwise be paced', enabled: false })
    expect(result.current).toBe('a much longer tail that would otherwise be paced')
  })

  it('snaps when the content is replaced rather than extended', () => {
    const { result, rerender } = renderHook(
      ({ content }: { content: string }) => usePacedStreamContent(content, true),
      { initialProps: { content: 'first version' } },
    )

    rerender({ content: 'a completely different version' })
    expect(result.current).toBe('a completely different version')
  })
})
