/**
 * 流式期间的掉帧采样（仅开发期使用）。
 *
 * 用 1ms 桶记录每帧间隔，内存固定；结束时给出 p95、最长帧、掉帧比例。
 * 只在 dev 里由 ChatArea 在流式开始/结束时启停，生产构建不会实例化。
 */
const FRAME_BUDGET_MS = 1000 / 60
/** 超过这个间隔就算一次明显卡顿（3 帧以上） */
const LONG_FRAME_MS = 50
const BUCKET_COUNT = 200

export type FrameStats = {
  frames: number
  spanMs: number
  avgFrameMs: number
  p95FrameMs: number
  longestFrameMs: number
  droppedFrames: number
  longFrameRatio: number
}

export type FrameStatsAccumulator = {
  add: (deltaMs: number) => void
  snapshot: () => FrameStats | null
}

export function createFrameStatsAccumulator(): FrameStatsAccumulator {
  const buckets = new Uint32Array(BUCKET_COUNT)
  let frames = 0
  let spanMs = 0
  let longestMs = 0
  let droppedFrames = 0

  return {
    add(deltaMs) {
      if (!Number.isFinite(deltaMs) || deltaMs < 0) return
      frames += 1
      spanMs += deltaMs
      if (deltaMs > longestMs) longestMs = deltaMs
      droppedFrames += Math.max(0, Math.round(deltaMs / FRAME_BUDGET_MS) - 1)
      const bucket = Math.min(BUCKET_COUNT - 1, Math.floor(deltaMs))
      buckets[bucket] += 1
    },
    snapshot() {
      if (frames === 0) return null

      let longFrames = 0
      for (let index = LONG_FRAME_MS; index < BUCKET_COUNT; index += 1) longFrames += buckets[index]

      const p95Rank = Math.ceil(frames * 0.95)
      let seen = 0
      let p95FrameMs = 0
      for (let index = 0; index < BUCKET_COUNT; index += 1) {
        seen += buckets[index]
        if (seen >= p95Rank) {
          p95FrameMs = index
          break
        }
      }

      return {
        frames,
        spanMs,
        avgFrameMs: spanMs / frames,
        p95FrameMs,
        longestFrameMs: longestMs,
        droppedFrames,
        longFrameRatio: longFrames / frames,
      }
    },
  }
}

export type FrameSampler = {
  start: () => void
  stop: () => FrameStats | null
}

/** 采样器本身不判断环境，调用方决定是否启用 */
export function createFrameSampler(): FrameSampler {
  let handle: number | null = null
  let lastTime = 0
  let accumulator: FrameStatsAccumulator | null = null

  const tick = (time: number) => {
    if (!accumulator) return
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      // 后台标签页的 rAF 间隔没有意义，跳过这一段
      lastTime = time
    } else if (lastTime > 0) {
      accumulator.add(time - lastTime)
      lastTime = time
    } else {
      lastTime = time
    }
    handle = requestAnimationFrame(tick)
  }

  return {
    start() {
      if (typeof requestAnimationFrame === 'undefined') return
      if (handle !== null) return
      accumulator = createFrameStatsAccumulator()
      lastTime = 0
      handle = requestAnimationFrame(tick)
    },
    stop() {
      if (handle !== null) cancelAnimationFrame(handle)
      handle = null
      lastTime = 0
      const stats = accumulator?.snapshot() ?? null
      accumulator = null
      return stats
    },
  }
}

let lastFrameReport: { label: string; stats: FrameStats; at: number } | null = null

/** 最近一次流式帧统计（dev 诊断面板用） */
export function getLastFrameStats(): { label: string; stats: FrameStats; at: number } | null {
  return lastFrameReport
}

export function reportFrameStats(label: string, stats: FrameStats | null): void {
  if (!stats) return
  lastFrameReport = { label, stats, at: Date.now() }
  if (stats.frames < 10) return
  if (stats.longFrameRatio < 0.02 && stats.p95FrameMs < 32) return
  console.warn(
    `[perf] ${label} frames=${stats.frames} avg=${stats.avgFrameMs.toFixed(1)}ms ` +
      `p95=${stats.p95FrameMs}ms max=${stats.longestFrameMs.toFixed(1)}ms ` +
      `dropped=${stats.droppedFrames} long=${(stats.longFrameRatio * 100).toFixed(1)}%`,
  )
}
