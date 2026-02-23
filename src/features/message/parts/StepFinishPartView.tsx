import { memo } from 'react'
import type { StepFinishPart } from '../../../types/message'

interface StepFinishPartViewProps {
  part: StepFinishPart
  /** 消息总耗时（毫秒），从外部传入 */
  duration?: number
}

function formatNumber(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M'
  if (num >= 1000) return (num / 1000).toFixed(1) + 'k'
  return num.toString()
}

function formatCost(cost: number): string {
  if (cost < 0.01) return '<$0.01'
  return '$' + cost.toFixed(3)
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  const rem = Math.round(s % 60)
  return rem > 0 ? `${m}m${rem}s` : `${m}m`
}

export const StepFinishPartView = memo(function StepFinishPartView({ part, duration }: StepFinishPartViewProps) {
  const { tokens, cost } = part
  const totalTokens = tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
  const cacheHit = tokens.cache.read
  
  return (
    <div className="flex items-center gap-3 text-[10px] text-text-500 px-1 py-0.5">
      {/* Tokens */}
      <span
        title={`Input: ${tokens.input}, Output: ${tokens.output}, Reasoning: ${tokens.reasoning}, Cache read: ${tokens.cache.read}, Cache write: ${tokens.cache.write}`}
      >
        {formatNumber(totalTokens)} tokens
      </span>
      {cacheHit > 0 && (
        <span className="text-text-600" title={`Cache read: ${tokens.cache.read}, write: ${tokens.cache.write}`}>
          ({formatNumber(cacheHit)} cached)
        </span>
      )}

      {/* Cost */}
      {cost > 0 && (
        <span>{formatCost(cost)}</span>
      )}

      {/* Duration */}
      {duration != null && duration > 0 && (
        <span>{formatDuration(duration)}</span>
      )}
    </div>
  )
})
