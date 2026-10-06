// ============================================
// SkillRenderer — skill 工具渲染（官方 session-ui tool-renderer.tsx:2172 同款）
//
// 官方把 skill 调用渲染成一行「Loaded skill <name>」的紧凑条目
// （tool-loaded-item），running 时名字带 shimmer。
// ============================================

import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { currentToolInput, currentToolMetadata } from '../../../../types/api/toolState'
import type { ToolRendererProps } from '../types'

/** 技能名：input.name 优先，metadata.name 兜底（官方 skillToolName 同款） */
export function skillToolName(input: Record<string, unknown>, metadata: Record<string, unknown>): string | undefined {
  const name = input.name ?? metadata.name
  return typeof name === 'string' && name ? name : undefined
}

export const SkillRenderer = memo(function SkillRenderer({ part }: ToolRendererProps) {
  const { t } = useTranslation('message')
  const name = skillToolName(currentToolInput(part), currentToolMetadata(part))
  const running = part.state.status === 'running' || part.state.status === 'streaming'

  return (
    <div
      data-component="tool-loaded-item"
      aria-label={name ? `${t('toolPart.loadedSkill')} ${name}` : t('toolPart.skill')}
      className="flex items-baseline gap-1.5 text-[length:var(--fs-sm)]"
    >
      <span className="text-text-400">{t('toolPart.loadedSkill')}</span>
      <span className={running ? 'reasoning-shimmer-text font-medium' : 'font-medium text-text-200'}>
        {name ?? t('toolPart.skill')}
      </span>
    </div>
  )
})
