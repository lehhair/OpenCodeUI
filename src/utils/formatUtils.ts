/**
 * Shared formatting utilities.
 * Consolidated from duplicated functions across message parts, hooks, and renderers.
 */

import type { CompletedAtFormat } from '../store/themeStore'

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

/** Format a timestamp (ms) to local HH:MM time string */
export function formatTime(ms: number): string {
  const date = new Date(ms)
  const h = date.getHours().toString().padStart(2, '0')
  const m = date.getMinutes().toString().padStart(2, '0')
  return `${h}:${m}`
}

/** Format a timestamp (ms) to local YYYY-MM-DD HH:MM string */
export function formatDateTime(ms: number): string {
  const date = new Date(ms)
  const y = date.getFullYear().toString().padStart(4, '0')
  const mon = (date.getMonth() + 1).toString().padStart(2, '0')
  const d = date.getDate().toString().padStart(2, '0')
  return `${y}-${mon}-${d} ${formatTime(ms)}`
}

/** Format completed time according to the selected display mode */
export function formatCompletedAt(ms: number, format: CompletedAtFormat): string {
  return format === 'dateTime' ? formatDateTime(ms) : formatTime(ms)
}

/** Format a large number with k/M suffix */
export function formatNumber(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M'
  if (num >= 1000) return (num / 1000).toFixed(1) + 'k'
  return num.toString()
}
