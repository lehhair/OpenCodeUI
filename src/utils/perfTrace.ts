/**
 * 开发期的轻量耗时打点。
 *
 * 只在 dev 生效：超过阈值的渲染步骤直接打一条带标签和耗时的警告，
 * 省得靠肉眼猜“这一帧到底慢在 Markdown 解析、morph 还是视图模型构建”。
 * 生产构建里整个函数体只剩一次同步调用，没有计时和字符串拼接。
 */
const ENABLED = import.meta.env.DEV && import.meta.env.MODE !== 'test'

export function startPerf(): number | null {
  return ENABLED ? performance.now() : null
}

export function finishPerf(label: string, startedAt: number | null, warnAfterMs = 8, detail?: string): void {
  if (startedAt == null) return
  const elapsed = performance.now() - startedAt
  if (elapsed < warnAfterMs) return
  const suffix = detail ? ` (${detail})` : ''
  console.warn(`[perf] ${label} ${elapsed.toFixed(1)}ms${suffix}`)
}

export function measurePerf<T>(label: string, fn: () => T, warnAfterMs = 8, detail?: string): T {
  if (!ENABLED) return fn()
  const startedAt = performance.now()
  try {
    return fn()
  } finally {
    finishPerf(label, startedAt, warnAfterMs, detail)
  }
}
