import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SubtaskPart } from '../../../types/message'
import { useChildSessions, type ChildSessionInfo } from '../../../store'
import { useRouter } from '../../../hooks/useRouter'
import { useDelayedRender } from '../../../hooks'
import { UsersIcon, ChevronDownIcon, LayersIcon, TerminalIcon, ReturnIcon } from '../../../components/Icons'

interface SubtaskPartViewProps {
  part: SubtaskPart
}

/**
 * 子任务 Part 视图
 *
 * 显示子 agent 任务的状态，支持：
 * 1. 折叠/展开查看进度
 * 2. 点击进入子 session 全屏视图
 */
export const SubtaskPartView = memo(function SubtaskPartView({ part }: SubtaskPartViewProps) {
  const { t } = useTranslation('message')
  const [expanded, setExpanded] = useState(false)
  const shouldRenderBody = useDelayedRender(expanded)
  const { navigateToSession } = useRouter()

  // 获取子 session 信息（如果已创建）
  // 注意：part.sessionID 是父 session，我们需要找到这个 subtask 创建的子 session
  // 子 session 的 parentID 应该等于 part.sessionID
  const childSessions = useChildSessions(part.sessionID)

  // 找到匹配这个 subtask 的子 session
  // 通常是最近创建的那个，或者通过 agent 名称匹配
  const childSession = findMatchingChildSession(childSessions, part)

  const status = childSession?.status ?? 'running'
  const isRunning = status === 'running'

  // 进入子 session
  const handleEnter = () => {
    if (childSession) {
      navigateToSession(childSession.id)
    }
  }

  return (
    <div className="rounded-xl border border-border-200/60 bg-bg-100/50 overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-bg-200/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {/* Status indicator */}
        <div
          className={`flex-shrink-0 w-2 h-2 rounded-full ${
            isRunning ? 'bg-info-100 animate-pulse' : status === 'error' ? 'bg-danger-100' : 'bg-success-100'
          }`}
        />

        {/* Agent icon & name */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <UsersIcon size={16} className="text-text-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-text-200 truncate">{part.agent}</span>
              {isRunning && (
                <span className="text-[10px] text-info-100 bg-info-100/10 px-1.5 py-0.5 rounded">
                  {t('subtask.running')}
                </span>
              )}
              {status === 'idle' && (
                <span className="text-[10px] text-success-100 bg-success-100/10 px-1.5 py-0.5 rounded">
                  {t('subtask.done')}
                </span>
              )}
              {status === 'error' && (
                <span className="text-[10px] text-danger-100 bg-danger-100/10 px-1.5 py-0.5 rounded">
                  {t('subtask.error')}
                </span>
              )}
            </div>
            <p className="text-xs text-text-400 truncate mt-0.5">{part.description}</p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {childSession && (
            <button
              onClick={e => {
                e.stopPropagation()
                handleEnter()
              }}
              className="px-2.5 py-1 text-xs font-medium text-text-300 hover:text-text-100 hover:bg-bg-200 rounded-lg transition-colors"
            >
              {t('subtask.enter')}
            </button>
          )}
          <ChevronDownIcon
            className={`text-text-400 transition-transform duration-200 ${expanded ? '' : '-rotate-90'}`}
          />
        </div>
      </div>

      {/* Expanded content */}
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-out ${
          expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden">
          {shouldRenderBody && (
            <div className="px-4 py-3 border-t border-border-200/40 space-y-3">
              {/* Prompt preview */}
              <div>
                <p className="text-[10px] text-text-500 uppercase tracking-wider mb-1">{t('subtask.task')}</p>
                <p className="text-xs text-text-300 whitespace-pre-wrap line-clamp-4">{part.prompt}</p>
              </div>

              {/* Model info */}
              {part.model && (
                <div className="flex items-center gap-2 text-[10px] text-text-500">
                  <LayersIcon size={12} />
                  <span>
                    {part.model.providerID}/{part.model.modelID}
                  </span>
                </div>
              )}

              {/* Command (if slash command) */}
              {part.command && (
                <div className="flex items-center gap-2 text-[10px] text-text-500">
                  <TerminalIcon size={12} />
                  <span className="font-mono">{part.command}</span>
                </div>
              )}

              {/* Child session info */}
              {childSession && (
                <div className="pt-2 border-t border-border-200/30">
                  <button
                    onClick={handleEnter}
                    className="w-full flex items-center justify-center gap-2 py-2 text-xs font-medium text-accent-main-100 hover:bg-accent-main-100/10 rounded-lg transition-colors"
                  >
                    <ReturnIcon size={14} />
                    {t('subtask.viewFullSession')}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
})

/**
 * 找到匹配 subtask 的子 session
 * 策略：匹配 agent 名称，取最近创建的
 */
function findMatchingChildSession(childSessions: ChildSessionInfo[], part: SubtaskPart): ChildSessionInfo | undefined {
  if (childSessions.length === 0) return undefined

  // 优先匹配 agent 名称
  const matchingAgent = childSessions.filter(s => s.agent === part.agent)
  if (matchingAgent.length > 0) {
    // 取最近创建的
    return matchingAgent.sort((a, b) => b.createdAt - a.createdAt)[0]
  }

  // 没有匹配的 agent，取最近创建的
  return childSessions.sort((a, b) => b.createdAt - a.createdAt)[0]
}
