import { memo } from 'react'
import { useTheme } from '../../../hooks/useTheme'
import type { StepFinishPart } from '../../../types/message'

interface StepFinishPartViewProps {
  part: StepFinishPart
  /** 单条消息耗时（毫秒） */
  duration?: number
  /** 整个回合总耗时（毫秒），从用户发送到最后一条 assistant 完成 */
  turnDuration?: number
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

export const StepFinishPartView = memo(function StepFinishPartView({ part, duration, turnDuration }: StepFinishPartViewProps) {
  const { stepFinishDisplay: show } = useTheme()
  const { tokens, cost } = part
  const totalTokens = tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
  const cacheHit = tokens.cache.read
  
  // 所有项都关闭时不渲染
  const hasAny = (show.tokens && totalTokens > 0)
    || (show.cache && cacheHit > 0)
    || (show.cost && cost > 0)
    || (show.duration && duration != null && duration > 0)
    || (show.turnDuration && turnDuration != null && turnDuration > 0)
  if (!hasAny) return null
  
  return (
    <div className="flex items-center gap-3 text-[10px] text-text-500 px-1 py-0.5">
      {show.tokens && totalTokens > 0 && (
        <span
          title={`Input: ${tokens.input}, Output: ${tokens.output}, Reasoning: ${tokens.reasoning}, Cache read: ${tokens.cache.read}, Cache write: ${tokens.cache.write}`}
        >
          {formatNumber(totalTokens)} tokens
        </span>
      )}
      {show.cache && cacheHit > 0 && (
        <span className="text-text-600" title={`Cache read: ${tokens.cache.read}, write: ${tokens.cache.write}`}>
          ({formatNumber(cacheHit)} cached)
        </span>
      )}
      {show.cost && cost > 0 && (
        <span>{formatCost(cost)}</span>
      )}
      {show.duration && duration != null && duration > 0 && (
        <span>{formatDuration(duration)}</span>
      )}
      {show.turnDuration && turnDuration != null && turnDuration > 0 && (
        <span>total {formatDuration(turnDuration)}</span>
      )}
    </div>
  )
})
