import { memo } from 'react'
import { CpuIcon, DollarSignIcon } from '../../../components/Icons'
import type { StepFinishPart } from '../../../types/message'

interface StepFinishPartViewProps {
  part: StepFinishPart
  showUsageStats?: boolean
}

/**
 * 格式化数字，如 1234 -> 1.2k
 */
function formatNumber(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M'
  if (num >= 1000) return (num / 1000).toFixed(1) + 'k'
  return num.toString()
}

/**
 * 格式化 cost
 */
function formatCost(cost: number): string {
  if (cost < 0.01) return '<$0.01'
  return '$' + cost.toFixed(3)
}

export const StepFinishPartView = memo(function StepFinishPartView({ part, showUsageStats = true }: StepFinishPartViewProps) {
  if (!showUsageStats) return null

  const { tokens, cost } = part
  const totalTokens = tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
  const cacheHit = tokens.cache.read
  
  return (
    <div className="flex items-center gap-3 text-[10px] text-text-500 px-1 py-0.5">
      {/* Tokens */}
      <div className="flex items-center gap-1.5">
        <CpuIcon size={10} className="opacity-50" />
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
      </div>
      
      {/* Cost */}
      {cost > 0 && (
        <div className="flex items-center gap-1">
          <DollarSignIcon size={10} className="opacity-50" />
          <span>{formatCost(cost)}</span>
        </div>
      )}
    </div>
  )
})
