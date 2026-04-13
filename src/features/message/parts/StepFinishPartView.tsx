import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../../hooks/useTheme'
import type { StepFinishPart } from '../../../types/message'
import { formatNumber, formatCost, formatDuration } from '../../../utils/formatUtils'

interface StepFinishPartViewProps {
  part: StepFinishPart
  /** 单条消息耗时（毫秒） */
  duration?: number
  /** 整个回合总耗时（毫秒），从用户发送到最后一条 assistant 完成 */
  turnDuration?: number
}

export const StepFinishPartView = memo(function StepFinishPartView({
  part,
  duration,
  turnDuration,
}: StepFinishPartViewProps) {
  const { t } = useTranslation('message')
  const { stepFinishDisplay: show } = useTheme()
  const { tokens, cost } = part
  const totalTokens = tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
  const cacheHit = tokens.cache.read

  // 所有项都关闭时不渲染
  const hasAny =
    (show.tokens && totalTokens > 0) ||
    (show.cache && cacheHit > 0) ||
    (show.cost && cost > 0) ||
    (show.duration && duration != null && duration > 0) ||
    (show.turnDuration && turnDuration != null && turnDuration > 0)
  if (!hasAny) return null

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-0.5 text-[length:var(--fs-xxs)] leading-4 text-text-500">
      {show.tokens && totalTokens > 0 && (
        <span
          title={`${t('stepFinish.inputTokens', { input: tokens.input })}, ${t('stepFinish.outputTokens', { output: tokens.output })}, ${t('stepFinish.reasoningTokens', { reasoning: tokens.reasoning })}, ${t('stepFinish.cacheRead', { read: tokens.cache.read })}, ${t('stepFinish.cacheWrite', { write: tokens.cache.write })}`}
        >
          {formatNumber(totalTokens)} {t('tokens')}
        </span>
      )}
      {show.cache && cacheHit > 0 && (
        <span
          className="text-text-600"
          title={`${t('stepFinish.cacheRead', { read: tokens.cache.read })}, ${t('stepFinish.cacheWrite', { write: tokens.cache.write })}`}
        >
          ({t('stepFinish.cached', { count: cacheHit })})
        </span>
      )}
      {show.cost && cost > 0 && <span>{formatCost(cost)}</span>}
      {show.duration && duration != null && duration > 0 && <span>{formatDuration(duration)}</span>}
      {show.turnDuration && turnDuration != null && turnDuration > 0 && (
        <span>{t('stepFinish.totalDuration', { duration: formatDuration(turnDuration) })}</span>
      )}
    </div>
  )
})
