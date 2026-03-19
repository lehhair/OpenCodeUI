/**
 * Shared formatting utilities.
 * Consolidated from duplicated functions across message parts, hooks, and renderers.
 */

/** Format a tool name for display: "my-tool_name" → "My Tool Name" */
export function formatToolName(name: string): string {
  return name.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

/** Format a duration in ms to human-readable string */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`

  const totalSeconds = Math.round(s)
  const d = Math.floor(totalSeconds / (60 * 60 * 24))
  const h = Math.floor((totalSeconds % (60 * 60 * 24)) / (60 * 60))
  const m = Math.floor((totalSeconds % (60 * 60)) / 60)
  const remS = totalSeconds % 60

  if (d > 0) return [`${d}d`, h > 0 ? `${h}h` : '', m > 0 ? `${m}m` : ''].filter(Boolean).join(' ')
  if (h > 0) return [`${h}h`, m > 0 ? `${m}m` : '', remS > 0 ? `${remS}s` : ''].filter(Boolean).join(' ')
  return [`${m}m`, remS > 0 ? `${remS}s` : ''].filter(Boolean).join(' ')
}

/** Format a cost in dollars */
export function formatCost(cost: number): string {
  if (cost === 0) return '$0'
  if (cost < 0.001) return '<$0.001'
  if (cost < 0.01) return '$' + cost.toFixed(3)
  if (cost < 1) return '$' + cost.toFixed(2)
  return '$' + cost.toFixed(2)
}

/** Format a large number with k/M suffix */
export function formatNumber(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M'
  if (num >= 1000) return (num / 1000).toFixed(1) + 'k'
  return num.toString()
}
