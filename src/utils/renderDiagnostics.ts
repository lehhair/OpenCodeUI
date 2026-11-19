/**
 * 渲染链路的失败分类（开发期诊断用）。
 *
 * 以前很多地方 catch 之后只写一句 console.warn 就结束，出问题时无法区分
 * 「降级但还能看」「下次还能重试」「彻底没救了」。这里统一三类：
 *
 * - degraded：功能降级但内容仍在（比如高亮失败退回纯文本、解析交给主线程）
 * - retryable：这次失败，下一次数据/渲染循环还能再试
 * - terminal：这个环境或实例已经不可用，不应再反复尝试
 *
 * 只在 dev 记录并打印，生产构建里调用会被裁剪成一次判断。
 */
const ENABLED = import.meta.env.DEV && import.meta.env.MODE !== 'test'
const MAX_RECORDS = 100

export type RenderScope = 'highlight' | 'markdown' | 'mermaid' | 'html-preview' | 'stream'
export type RenderFailureKind = 'degraded' | 'retryable' | 'terminal'

export type RenderFailure = {
  scope: RenderScope
  kind: RenderFailureKind
  reason: string
  at: number
}

const records: RenderFailure[] = []

export function reportRenderFailure(scope: RenderScope, kind: RenderFailureKind, reason: unknown): void {
  if (!ENABLED) return
  const message = reason instanceof Error ? reason.message : String(reason)
  records.push({ scope, kind, reason: message, at: Date.now() })
  if (records.length > MAX_RECORDS) records.splice(0, records.length - MAX_RECORDS)
  console.warn(`[render:${kind}] ${scope}: ${message}`)
}

export function getRecentRenderFailures(): readonly RenderFailure[] {
  return records
}

export function clearRenderFailures(): void {
  records.length = 0
}

if (ENABLED && typeof window !== 'undefined') {
  // 开着 devtools 时可以直接看最近的失败记录
  ;(window as Window & { __opencodeRenderFailures?: typeof getRecentRenderFailures }).__opencodeRenderFailures =
    getRecentRenderFailures
}
