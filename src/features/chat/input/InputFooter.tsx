import { memo, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import type { RefObject } from 'react'
import { FastForwardIcon } from '../../../components/Icons'
import { autoApproveStore, type FullAutoMode } from '../../../store/autoApproveStore'

// ============================================
// Full Auto 状态 hook
// ============================================

function useFullAutoMode(paneId: string): FullAutoMode {
  return useSyncExternalStore(
    cb => autoApproveStore.onFullAutoChange(cb),
    () => autoApproveStore.getPaneFullAutoMode(paneId),
  )
}

// ============================================
// InputFooter - disclaimer + full auto toggle
//
// v2 移除了 todo 能力（连 "todo" 字符串都不存在），因此这里原本的
// todo 进度环、任务列表与悬浮面板一并删除，只保留免责声明与
// Full Auto 三态开关。
// ============================================

interface InputFooterProps {
  paneId: string
  sessionId?: string | null
  onNewChat?: () => void
  inputContainerRef?: RefObject<HTMLDivElement | null>
  /** 阻塞中的后台任务（非空时显示「移到后台」入口，官方 BackgroundMoveHint 同款克制呈现） */
  backgroundTasks?: Array<{ label: string }>
  onMoveToBackground?: () => void
  backgroundMoving?: boolean
}

export const InputFooter = memo(function InputFooter({
  paneId,
  onNewChat,
  backgroundTasks,
  onMoveToBackground,
  backgroundMoving,
}: InputFooterProps) {
  const { t } = useTranslation(['chat', 'common'])
  const fullAutoMode = useFullAutoMode(paneId)

  return (
    <div className="relative flex h-full w-full items-center justify-center gap-2 text-[length:var(--fs-xs)] leading-none text-text-500">
      {/* Full Auto 三态切换: off -> session -> global -> off */}
      <button
        onClick={() => autoApproveStore.cyclePaneFullAutoMode(paneId)}
        className="shrink-0 flex items-center justify-center hover:text-text-300 transition-colors"
        title={
          fullAutoMode === 'off'
            ? t('inputFooter.autoApproveOff')
            : fullAutoMode === 'session'
              ? t('inputFooter.autoApproveSession')
              : t('inputFooter.autoApproveGlobal')
        }
      >
        <FastForwardIcon
          size={11}
          className={`transition-colors ${
            fullAutoMode === 'global'
              ? 'text-danger-100 drop-shadow-[0_0_4px_var(--color-danger-100)]'
              : fullAutoMode === 'session'
                ? 'text-warning-100 drop-shadow-[0_0_4px_var(--color-warning-100)]'
                : ''
          }`}
        />
      </button>

      <span className="text-text-500/30 shrink-0">·</span>

      <button onClick={onNewChat} className="hover:text-text-300 transition-colors">
        {t('inputFooter.pleaseVerify')}
      </button>

      {/* 移到后台（官方 BackgroundMoveHint 同款位置与重量：页脚一行的小字入口） */}
      {backgroundTasks && backgroundTasks.length > 0 && onMoveToBackground && (
        <>
          <span className="text-text-500/30 shrink-0">·</span>
          <button
            onClick={onMoveToBackground}
            disabled={backgroundMoving}
            className="hover:text-text-300 transition-colors disabled:opacity-50"
            title={backgroundTasks.map(task => task.label).join('、')}
          >
            {t('chat:sessionBackground.move', { count: backgroundTasks.length })}
          </button>
        </>
      )}
    </div>
  )
})
